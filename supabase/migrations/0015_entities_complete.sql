-- 0015_entities_complete.sql  (Fase 3, passo 0: completare la copia per riga `public.entities`)
--
-- NON ANCORA APPLICATA. Va applicata a mano (MCP apply_migration o editor SQL, in UNA transazione) dopo aver letto
-- supabase/db-snapshot/2026-10-21-piano-0015.md. NON usare `supabase db push`: i file 0015_*_rollback, 0015b e 0015c
-- stanno nella stessa cartella ma NON vanno eseguiti in automatico.
--
-- Cosa fa (tutto leggero, nessun lock lungo):
--   1. colonne NULLABLE senza default su entities: unit_id, guest_id, group_id, ota_code (+ ext_id, vedi piano)
--   2. nuovi kind: 'rates', 'activities', 'tombs', 'leadtombs' (formato righe: vedi entities_extra_rows)
--   3. entities_sync_row diventa un involucro: la vecchia funzione viene RINOMINATA entities_sync_row_core (stesso testo,
--      stessi permessi: nessun kind esistente cambia comportamento) e l'involucro, dopo averla chiamata, aggiorna i nuovi kind
--      con la stessa logica non bloccante (solo i campi cambiati rispetto a p_old, confronto del contenuto, errori mai propagati)
--   4. un trigger BEFORE su entities popola le colonne delle prenotazioni a ogni scrittura di kind='bookings'
--   5. entities_backfill_extra(p_batch) = popolamento/riconciliazione a lotti, idempotente
--   6. entities_verify_extra() = confronto blocco/tabella per i nuovi kind (la vecchia entities_verify NON e' toccata)
-- Gli indici sono in 0015b_indexes.sql (CREATE INDEX CONCURRENTLY, fuori transazione).
-- I trigger snapshot_* NON sono toccati.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------------------------
-- 0. Controlli preliminari: se qualcosa non corrisponde la migrazione si ferma PRIMA di cambiare qualsiasi cosa
-- ---------------------------------------------------------------------------------------------------------------
do $pre$
declare
  v_n int; v_c int; v_oid oid; v_names text[]; v_ident text; v_ret text; v_src text; v_col text;
begin
  foreach v_col in array array['owner_type','owner_id','kind','id','structure_id','data','updated_ms','check_in','check_out','status','channel','synced_at'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entities' and column_name = v_col) then
      raise exception '0015: la tabella public.entities non ha la colonna % (stato diverso dal documento di stato)', v_col;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_state' and column_name in ('user_id')) then
    raise exception '0015: app_state.user_id non trovata';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'org_state' and column_name in ('org_id')) then
    raise exception '0015: org_state.org_id non trovata';
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'entities_sync_row';
  select count(*) into v_c from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'entities_sync_row_core';
  if v_n > 1 or v_c > 1 then raise exception '0015: entities_sync_row / _core esistono con piu'' firme (overload): non so quale avvolgere'; end if;
  if v_n = 0 and v_c = 0 then raise exception '0015: entities_sync_row non trovata'; end if;

  -- la funzione "vera" e' quella originale (prima applicazione) oppure il _core (ri-esecuzione)
  select p.oid, p.proargnames, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid), p.prosrc
    into v_oid, v_names, v_ident, v_ret, v_src
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = case when v_c = 1 then 'entities_sync_row_core' else 'entities_sync_row' end;
  if v_c = 0 and position('_entities_sync_extra' in v_src) > 0 then
    raise exception '0015: entities_sync_row sembra gia'' un involucro ma entities_sync_row_core non esiste: stato incoerente';
  end if;
  if v_names is distinct from array['p_owner','p_type','p_blob','p_old']::text[] then
    raise exception '0015: argomenti inattesi di entities_sync_row: % (attesi p_owner, p_type, p_blob, p_old)', v_ident;
  end if;
  if position('p_blob jsonb' in v_ident) = 0 or position('p_old jsonb' in v_ident) = 0 then
    raise exception '0015: p_blob e p_old devono essere jsonb, firma trovata: %', v_ident;
  end if;
  if v_ret <> 'void' then
    raise exception '0015: entities_sync_row restituisce %, atteso void', v_ret;
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Colonne nuove (nullable, senza default: operazione di solo catalogo, istantanea)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.entities
  add column if not exists unit_id   text,
  add column if not exists guest_id  text,
  add column if not exists group_id  text,
  add column if not exists ota_code  text,   -- codice prenotazione dell'OTA (Booking.code, es. "ota_reservation_code" di Channex) o codice XEN-...
  add column if not exists ext_id    text;   -- Booking.extId (es. "channex:<id>", UID iCal): chiave di idempotenza degli import

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Registro errori delle funzioni nuove (separato da entities_sync_errors, di cui non conosco le colonne)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.entities_extra_errors (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  owner_type char(1),
  owner_id   uuid,
  step       text,
  sqlstate   text,
  message    text
);
alter table public.entities_extra_errors enable row level security;
revoke all on public.entities_extra_errors from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Funzioni di supporto
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.entities_safe_date(t text)
returns date language plpgsql immutable set search_path = public, pg_temp
as $fn$
begin
  return t::date;
exception when others then
  return null;
end
$fn$;

-- il valore della chiave spigolestay:data:v1 e' una STRINGA json (a volte potrebbe essere gia' un oggetto): restituisce l'oggetto o null
create or replace function public._entities_parse_v1(j jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp
as $fn$
declare v jsonb;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'string' then v := (j #>> '{}')::jsonb; else v := j; end if;
  if jsonb_typeof(v) = 'object' then return v; end if;
  return null;
end
$fn$;

-- Righe che un oggetto data:v1 deve avere in entities per un nuovo kind. UNICA definizione del formato, usata da
-- sync, backfill e verifica.
--   rates      id = chiave ("roomTypeId|AAAA-MM-GG" oppure "AAAA-MM-GG"), data = valore (numero) ; check_in = giorno della chiave
--   activities id = activity.id, data = oggetto, updated_ms = ts, structure_id = structureId   (duplicati: vince il ts piu' alto)
--   tombs      id = 'collezione:id', data = {"coll":..,"id":..}
--   leadtombs  id = la stringa, data = la stringa (json)
create or replace function public.entities_extra_rows(v jsonb, k text)
returns table (id text, data jsonb, structure_id text, updated_ms bigint, check_in date)
language plpgsql immutable set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
begin
  if v is null or jsonb_typeof(v) is distinct from 'object' then return; end if;

  if k = 'rates' then
    if jsonb_typeof(v -> 'rateOverrides') is distinct from 'object' then return; end if;
    return query
      select e.key::text, e.value, null::text, 0::bigint,
             public.entities_safe_date(case when e.key ~ '(^|\|)\d{4}-\d{2}-\d{2}$' then right(e.key, 10) end)
        from jsonb_each(v -> 'rateOverrides') e;

  elsif k = 'activities' then
    if jsonb_typeof(v -> 'activities') is distinct from 'array' then return; end if;
    return query
      select distinct on (x.x_id) x.x_id, x.x_obj, x.x_sid, x.x_ts, null::date
        from (
          select a.value ->> 'id' as x_id,
                 a.value as x_obj,
                 a.value ->> 'structureId' as x_sid,
                 case when (a.value ->> 'ts') ~ '^\d{1,15}(\.\d+)?$' then floor((a.value ->> 'ts')::numeric)::bigint else 0 end as x_ts
            from jsonb_array_elements(v -> 'activities') a
           where jsonb_typeof(a.value) = 'object'
        ) x
       where x.x_id is not null and length(x.x_id) < 1000
       order by x.x_id, x.x_ts desc, x.x_obj::text;

  elsif k = 'tombs' then
    if jsonb_typeof(v -> '_deleted') is distinct from 'object' then return; end if;
    return query
      select distinct on (z.z_key) z.z_key, jsonb_build_object('coll', z.z_coll, 'id', z.z_id), null::text, 0::bigint, null::date
        from (
          select c.key || ':' || t.value as z_key, c.key as z_coll, t.value as z_id
            from jsonb_each(v -> '_deleted') c
            cross join lateral jsonb_array_elements_text(
              case when jsonb_typeof(c.value) = 'array' then c.value else '[]'::jsonb end) t
           where t.value is not null
        ) z
       where length(z.z_key) < 1000
       order by z.z_key;

  elsif k = 'leadtombs' then
    if jsonb_typeof(v -> '_deletedLeads') is distinct from 'array' then return; end if;
    return query
      select distinct on (s.value) s.value, to_jsonb(s.value), null::text, 0::bigint, null::date
        from jsonb_array_elements_text(v -> '_deletedLeads') s
       where s.value is not null and length(s.value) < 1000
       order by s.value;
  end if;
end
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Trigger: colonne delle prenotazioni derivate da data (a ogni INSERT/UPDATE di una riga kind='bookings')
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.entities_bk_cols()
returns trigger language plpgsql set search_path = public, pg_temp
as $fn$
begin
  new.unit_id  := nullif(new.data ->> 'unitId', '');
  new.guest_id := nullif(new.data ->> 'guestId', '');
  new.group_id := nullif(new.data ->> 'groupId', '');
  new.ota_code := nullif(btrim(new.data ->> 'code'), '');
  new.ext_id   := nullif(new.data ->> 'extId', '');
  return new;
end
$fn$;

drop trigger if exists entities_bk_cols_trg on public.entities;
create trigger entities_bk_cols_trg
  before insert or update on public.entities
  for each row when (new.kind = 'bookings')
  execute function public.entities_bk_cols();

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Sincronizzazione dei nuovi kind (chiamata dall'involucro di entities_sync_row)
--    Lavora SOLO sui campi cambiati rispetto a p_old; se data:v1 e' identico esce subito (nessun parse).
--    Non propaga mai errori: li scrive in entities_extra_errors.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public._entities_sync_extra(p_owner_type text, p_owner_id uuid, p_blob jsonb, p_old jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  c_key constant text := 'spigolestay:data:v1';
  v_ot    char(1) := left(p_owner_type, 1);
  v_new   jsonb;
  v_old   jsonb;
  v_kind  text;
  v_field text;
  v_up    int;
  v_dl    int;
begin
  if p_blob is null or p_owner_id is null then return; end if;
  -- scritture che non toccano data:v1 (thread, impostazioni...): costo = un confronto di stringhe
  if (p_blob -> c_key) is not distinct from (p_old -> c_key) then return; end if;

  begin
    v_new := public._entities_parse_v1(p_blob -> c_key);
    v_old := public._entities_parse_v1(p_old -> c_key);
  exception when others then
    insert into public.entities_extra_errors (owner_type, owner_id, step, sqlstate, message)
    values (v_ot, p_owner_id, 'parse', sqlstate, left(sqlerrm, 500));
    return;
  end;
  if v_new is null then return; end if;   -- blocco assente/non valido: non si cancella nulla

  for v_kind, v_field in
    select t.k, t.f from (values ('rates', 'rateOverrides'), ('activities', 'activities'), ('tombs', '_deleted'), ('leadtombs', '_deletedLeads')) as t (k, f)
  loop
    if not jsonb_exists(v_new, v_field) then continue; end if;                    -- campo assente = nessuna informazione: non si tocca
    if (v_new -> v_field) is not distinct from (v_old -> v_field) then continue; end if;   -- invariato

    begin
      with n as materialized (select * from public.entities_extra_rows(v_new, v_kind)),
           o as materialized (select * from public.entities_extra_rows(v_old, v_kind)),
           up as (
             insert into public.entities as t (owner_type, owner_id, kind, id, structure_id, data, updated_ms, check_in, synced_at)
             select v_ot, p_owner_id, v_kind, n.id, n.structure_id, n.data, n.updated_ms, n.check_in, now()
               from n left join o on o.id = n.id
              where o.id is null
                 or o.data is distinct from n.data
                 or o.structure_id is distinct from n.structure_id
                 or o.updated_ms is distinct from n.updated_ms
                 or o.check_in is distinct from n.check_in
             on conflict (owner_type, owner_id, kind, id) do update
               set structure_id = excluded.structure_id, data = excluded.data, updated_ms = excluded.updated_ms,
                   check_in = excluded.check_in, synced_at = excluded.synced_at
             where t.data is distinct from excluded.data
                or t.structure_id is distinct from excluded.structure_id
                or t.updated_ms is distinct from excluded.updated_ms
                or t.check_in is distinct from excluded.check_in
             returning 1
           ),
           dl as (
             delete from public.entities x
              where x.owner_type = v_ot and x.owner_id = p_owner_id and x.kind = v_kind
                and x.id in (select o.id from o where not exists (select 1 from n where n.id = o.id))
             returning 1
           )
      select (select count(*) from up), (select count(*) from dl) into v_up, v_dl;
    exception when others then
      insert into public.entities_extra_errors (owner_type, owner_id, step, sqlstate, message)
      values (v_ot, p_owner_id, 'sync:' || v_kind, sqlstate, left(sqlerrm, 500));
    end;
  end loop;
end
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Popolamento / riconciliazione a lotti. Si richiama piu' volte (ognuna in una transazione propria) finche'
--    restituisce "done": true. Idempotente. Tocca al massimo p_batch righe per chiamata (+ eventuali cancellazioni di
--    righe in eccesso, anch'esse limitate a p_batch per kind). Per ogni proprietario prende un FOR SHARE SKIP LOCKED
--    sulla riga di app_state/org_state (blocca per pochi ms un eventuale scrittore concorrente, evita di
--    sovrascrivere una scrittura piu' recente con dati letti prima).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.entities_backfill_extra(p_batch int default 2000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_batch  int := greatest(coalesce(p_batch, 2000), 1);
  v_budget int;
  v_cols int := 0; v_up int := 0; v_del int := 0; v_busy int := 0; v_err int := 0;
  v_t0 timestamptz := clock_timestamp();
  r record; v_raw jsonb; v jsonb; v_found boolean;
  v_kind text; v_field text; v_u int; v_d int;
begin
  v_budget := v_batch;

  -- A. colonne delle prenotazioni (righe in cui non coincidono con data)
  with c as (
    select e.owner_type, e.owner_id, e.id
      from public.entities e
     where e.kind = 'bookings'
       and (   e.unit_id  is distinct from nullif(e.data ->> 'unitId', '')
            or e.guest_id is distinct from nullif(e.data ->> 'guestId', '')
            or e.group_id is distinct from nullif(e.data ->> 'groupId', '')
            or e.ota_code is distinct from nullif(btrim(e.data ->> 'code'), '')
            or e.ext_id   is distinct from nullif(e.data ->> 'extId', ''))
     limit v_budget
       for update skip locked
  ), u as (
    update public.entities t
       set unit_id  = nullif(t.data ->> 'unitId', ''),
           guest_id = nullif(t.data ->> 'guestId', ''),
           group_id = nullif(t.data ->> 'groupId', ''),
           ota_code = nullif(btrim(t.data ->> 'code'), ''),
           ext_id   = nullif(t.data ->> 'extId', '')
      from c
     where t.owner_type = c.owner_type and t.owner_id = c.owner_id and t.kind = 'bookings' and t.id = c.id
    returning 1
  )
  select count(*) into v_cols from u;
  v_budget := greatest(v_budget - v_cols, 0);

  -- B. nuovi kind, un proprietario alla volta
  for r in
    select 'u'::char(1) as ot, a.user_id as oid from public.app_state a
    union all
    select 'o'::char(1), s.org_id from public.org_state s
  loop
    exit when v_budget <= 0;
    v_raw := null; v_found := null;
    if r.ot = 'u' then
      select a.data -> 'spigolestay:data:v1', true into v_raw, v_found
        from public.app_state a where a.user_id = r.oid for share skip locked;
    else
      select s.data -> 'spigolestay:data:v1', true into v_raw, v_found
        from public.org_state s where s.org_id = r.oid for share skip locked;
    end if;
    if v_found is null then v_busy := v_busy + 1; continue; end if;   -- riga occupata da uno scrittore: si riprova alla chiamata dopo

    begin
      v := public._entities_parse_v1(v_raw);
      if v is null then continue; end if;

      for v_kind, v_field in
        select t.k, t.f from (values ('rates', 'rateOverrides'), ('activities', 'activities'), ('tombs', '_deleted'), ('leadtombs', '_deletedLeads')) as t (k, f)
      loop
        exit when v_budget <= 0;
        if not jsonb_exists(v, v_field) then continue; end if;

        with d as materialized (select * from public.entities_extra_rows(v, v_kind)),
             up as (
               insert into public.entities as t (owner_type, owner_id, kind, id, structure_id, data, updated_ms, check_in, synced_at)
               select r.ot, r.oid, v_kind, d.id, d.structure_id, d.data, d.updated_ms, d.check_in, now()
                 from d
                 left join public.entities e
                        on e.owner_type = r.ot and e.owner_id = r.oid and e.kind = v_kind and e.id = d.id
                where e.id is null
                   or e.data is distinct from d.data
                   or e.structure_id is distinct from d.structure_id
                   or e.updated_ms is distinct from d.updated_ms
                   or e.check_in is distinct from d.check_in
                limit v_budget
               on conflict (owner_type, owner_id, kind, id) do update
                 set structure_id = excluded.structure_id, data = excluded.data, updated_ms = excluded.updated_ms,
                     check_in = excluded.check_in, synced_at = excluded.synced_at
               returning 1
             ),
             dl as (
               delete from public.entities x
                using (select e2.id
                         from public.entities e2
                        where e2.owner_type = r.ot and e2.owner_id = r.oid and e2.kind = v_kind
                          and not exists (select 1 from d where d.id = e2.id)
                        limit v_budget) z
                where x.owner_type = r.ot and x.owner_id = r.oid and x.kind = v_kind and x.id = z.id
               returning 1
             )
        select (select count(*) from up), (select count(*) from dl) into v_u, v_d;

        v_up := v_up + v_u; v_del := v_del + v_d;
        v_budget := greatest(v_budget - v_u - v_d, 0);
      end loop;
    exception when others then
      v_err := v_err + 1;
      insert into public.entities_extra_errors (owner_type, owner_id, step, sqlstate, message)
      values (r.ot, r.oid, 'backfill', sqlstate, left(sqlerrm, 500));
    end;
  end loop;

  return jsonb_build_object(
    'done', (v_cols + v_up + v_del = 0 and v_busy = 0 and v_err = 0),
    'bookings_cols', v_cols, 'upserted', v_up, 'deleted', v_del, 'busy_owners', v_busy, 'errors', v_err,
    'ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000)
  );
end
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Verifica dei nuovi kind (stesso spirito di entities_verify; la funzione esistente NON viene modificata)
--    una riga per proprietario e kind + una riga 'bookings:cols' per proprietario (differenze nelle colonne derivate)
--    Tutto 0 in missing/extra/different = ok. Una riga kind='parse_error' = blocco non leggibile.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.entities_verify_extra()
returns table (owner_type char(1), owner_id uuid, kind text, blob_n int, table_n int, missing int, extra int, different int)
language plpgsql security definer stable set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  r record; v jsonb; v_bad boolean; v_kind text; v_field text;
begin
  for r in
    select 'u'::char(1) as ot, a.user_id as oid, a.data -> 'spigolestay:data:v1' as raw from public.app_state a
    union all
    select 'o'::char(1), s.org_id, s.data -> 'spigolestay:data:v1' from public.org_state s
  loop
    v_bad := false; v := null;
    begin
      v := public._entities_parse_v1(r.raw);
    exception when others then
      v_bad := true;
    end;
    if v_bad then
      return query select r.ot, r.oid, 'parse_error'::text, null::int, null::int, 0, 0, 1;
      continue;
    end if;

    for v_kind, v_field in
      select t.k, t.f from (values ('rates', 'rateOverrides'), ('activities', 'activities'), ('tombs', '_deleted'), ('leadtombs', '_deletedLeads')) as t (k, f)
    loop
      return query
        with d as materialized (select * from public.entities_extra_rows(coalesce(v, '{}'::jsonb), v_kind)),
             tb as materialized (
               select e.id as t_id, e.data as t_data
                 from public.entities e
                where e.owner_type = r.ot and e.owner_id = r.oid and e.kind = v_kind)
        select r.ot, r.oid, v_kind,
               (select count(*) from d)::int,
               (select count(*) from tb)::int,
               (select count(*) from d where not exists (select 1 from tb where tb.t_id = d.id))::int,
               (select count(*) from tb where not exists (select 1 from d where d.id = tb.t_id))::int,
               (select count(*) from d join tb on tb.t_id = d.id where d.data is distinct from tb.t_data)::int;
    end loop;
  end loop;

  return query
    select e.owner_type, e.owner_id, 'bookings:cols'::text, null::int, count(*)::int, 0, 0,
           (count(*) filter (where e.unit_id  is distinct from nullif(e.data ->> 'unitId', '')
                               or e.guest_id is distinct from nullif(e.data ->> 'guestId', '')
                               or e.group_id is distinct from nullif(e.data ->> 'groupId', '')
                               or e.ota_code is distinct from nullif(btrim(e.data ->> 'code'), '')
                               or e.ext_id   is distinct from nullif(e.data ->> 'extId', '')))::int
      from public.entities e
     where e.kind = 'bookings'
     group by e.owner_type, e.owner_id;
end
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. entities_sync_row: la funzione originale diventa entities_sync_row_core (stesso corpo, stessi permessi),
--    entities_sync_row diventa l'involucro con la STESSA firma (argomenti, default, void).
--    Ri-eseguibile: se il _core esiste gia' rigenera solo l'involucro.
-- ---------------------------------------------------------------------------------------------------------------
do $swap$
declare
  v_c int; v_oid oid; v_ident text; v_full text; v_acl aclitem[]; a record; v_made boolean := false;
begin
  select count(*) into v_c from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'entities_sync_row_core';

  if v_c = 0 then
    select p.oid into v_oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = 'entities_sync_row';
    v_ident := pg_get_function_identity_arguments(v_oid);
    execute format('alter function public.entities_sync_row(%s) rename to entities_sync_row_core', v_ident);
    v_made := true;
  end if;

  select p.oid, p.proacl into v_oid, v_acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'entities_sync_row_core';
  v_ident := pg_get_function_identity_arguments(v_oid);
  v_full  := pg_get_function_arguments(v_oid);     -- con eventuali DEFAULT

  execute format($f$
    create or replace function public.entities_sync_row(%s)
    returns void
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $b$
    begin
      perform public.entities_sync_row_core(p_owner, p_type, p_blob, p_old);
      begin
        perform public._entities_sync_extra(p_type::text, p_owner::text::uuid, to_jsonb(p_blob), to_jsonb(p_old));
      exception when others then
        raise warning 'entities_sync_row: passo extra fallito (vedi entities_extra_errors)';
      end;
    end;
    $b$
  $f$, v_full);

  -- stessi permessi di EXECUTE della funzione originale
  if v_made and v_acl is not null then
    execute format('revoke all on function public.entities_sync_row(%s) from public, anon, authenticated, service_role', v_ident);
    for a in select x.grantee, x.privilege_type from aclexplode(v_acl) x where x.privilege_type = 'EXECUTE' loop
      if a.grantee = 0 then
        execute format('grant execute on function public.entities_sync_row(%s) to public', v_ident);
      else
        execute format('grant execute on function public.entities_sync_row(%s) to %I', v_ident,
                       (select r.rolname from pg_roles r where r.oid = a.grantee));
      end if;
    end loop;
  end if;
end
$swap$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Permessi delle funzioni nuove: solo il proprietario e service_role (mai anon/authenticated via PostgREST)
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.entities_safe_date(text)                              from public, anon, authenticated;
revoke all on function public._entities_parse_v1(jsonb)                              from public, anon, authenticated;
revoke all on function public.entities_extra_rows(jsonb, text)                       from public, anon, authenticated;
revoke all on function public.entities_bk_cols()                                     from public, anon, authenticated;
revoke all on function public._entities_sync_extra(text, uuid, jsonb, jsonb)         from public, anon, authenticated;
revoke all on function public.entities_backfill_extra(int)                           from public, anon, authenticated;
revoke all on function public.entities_verify_extra()                                from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. entities_verify(): il confronto notturno contava TUTTE le righe di entities per kind: con le righe dei nuovi kind le avrebbe
--     segnalate come «in più». Si limita il lato tabella ai 7 kind di prima (testo originale letto da pg_get_functiondef il 21/10/2026;
--     UNICA modifica: la clausola `where kind = any(...)` nel CTE `ts`). Per i nuovi kind c'è entities_verify_extra().
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.entities_verify()
 returns table(owner_type character, owner_id uuid, kind text, blob_n bigint, table_n bigint, missing bigint, extra bigint, different bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with blobs as (
    select 'u'::char t, a.user_id oid, (a.data->>'spigolestay:data:v1')::jsonb b from public.app_state a
    union all select 'o'::char, o.org_id, (o.data->>'spigolestay:data:v1')::jsonb from public.org_state o
  ), flat as (
    select t, oid, c.coll kind, e->>'id' id, e from blobs, unnest(array['structures','roomTypes','units','bookings','guests','directReviews','events']) as c(coll),
    lateral jsonb_array_elements(case when jsonb_typeof(b->c.coll) = 'array' then b->c.coll else '[]'::jsonb end) e
    where b is not null and jsonb_typeof(e) = 'object' and coalesce(e->>'id','') <> ''
  ), bs as (
    select t, oid, kind, count(*) n from flat group by 1,2,3
  ), ts as (
    select owner_type t, owner_id oid, kind, count(*) n from public.entities
    where kind = any(array['structures','roomTypes','units','bookings','guests','directReviews','events'])
    group by 1,2,3
  ), keys as (select t, oid, kind from bs union select t, oid, kind from ts)
  select k.t, k.oid, k.kind, coalesce(bs.n,0), coalesce(ts.n,0),
    (select count(*) from flat f where f.t = k.t and f.oid = k.oid and f.kind = k.kind and not exists (select 1 from public.entities en where en.owner_type = f.t and en.owner_id = f.oid and en.kind = f.kind and en.id = f.id)),
    (select count(*) from public.entities en where en.owner_type = k.t and en.owner_id = k.oid and en.kind = k.kind and not exists (select 1 from flat f where f.t = en.owner_type and f.oid = en.owner_id and f.kind = en.kind and f.id = en.id)),
    (select count(*) from flat f join public.entities en on en.owner_type = f.t and en.owner_id = f.oid and en.kind = f.kind and en.id = f.id where f.t = k.t and f.oid = k.oid and f.kind = k.kind and en.data is distinct from f.e)
  from keys k left join bs on bs.t = k.t and bs.oid = k.oid and bs.kind = k.kind left join ts on ts.t = k.t and ts.oid = k.oid and ts.kind = k.kind
  order by 1,2,3
$function$;
