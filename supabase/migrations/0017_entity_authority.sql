-- 0017_entity_authority.sql  (Fase 3, passo 2, parte A: interruttore di autorita', export verso il blocco, guardia anti-cancellazione di massa)
--
-- NON ANCORA APPLICATA. Va applicata a mano (MCP apply_migration o editor SQL, in UNA transazione) dopo aver letto
-- supabase/db-snapshot/2026-10-22-piano-0017.md. NON usare `supabase db push` (i file *_rollback e 0017b stanno nella stessa cartella).
--
-- Questa migrazione e' SOLO ADDITIVA: crea oggetti nuovi e UN trigger nuovo sulla tabella `entities`. Non modifica nessuna funzione
-- esistente e non cambia il comportamento di nessuna scrittura attuale (il blocco resta la verita' per tutti: nessuna riga in
-- entity_authority = tutto 'blob'). Le modifiche alle funzioni esistenti (involucro di entities_sync_row, anti-svuotamento, verifica,
-- blocco delle scritture "vecchie") stanno in 0017b_authority_hooks.sql, da applicare DOPO e separatamente.
--
-- Cosa fa:
--   1. entity_authority(owner_type, owner_id, kind, authority 'blob'|'table', updated_at): per ogni (proprietario, tipo) dice chi e' la
--      verita'. Nessuna riga = 'blob'. RLS attiva e NESSUNA policy: solo service role / funzioni definer. + entity_authority_log (chi/quando cambia).
--   2. entities_export_to_blob(owner_type, owner_id): ricostruisce dalle righe di `entities` l'oggetto del blocco `spigolestay:data:v1`
--      (e' il paracadute di ogni passo successivo: dalle tabelle si torna sempre al blocco).
--      entities_export_check(owner_type, owner_id [, blocco]): confronta export e blocco reale (per id), una riga per campo.
--   3. Guardia anti-cancellazione di massa su `entities` (trigger a livello di istruzione): una DELETE che toglie piu' di N righe dello
--      stesso (proprietario, tipo) e' rifiutata, salvo flag di sessione `xenora.allow_mass_delete = 'on'` (backfill/manutenzione).
--      Anche TRUNCATE e' rifiutato senza flag. Le cancellazioni fatte dalla sincronizzazione blocco->tabella (annidate in un trigger di
--      app_state/org_state) per ora vengono solo REGISTRATE (modalita' 'log', vedi entities_guard_config), cosi' non cambia nulla per l'app.
--      Esenti: tombs, leadtombs, activities (lapidi/registro con tetti propri, si accorciano da sole).
--
-- Rollback: 0017_entity_authority_rollback.sql.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------------------------
-- 0. Controlli preliminari: se qualcosa non corrisponde la migrazione si ferma PRIMA di cambiare qualsiasi cosa
-- ---------------------------------------------------------------------------------------------------------------
do $pre$
declare v_col text;
begin
  foreach v_col in array array['owner_type','owner_id','kind','id','data','updated_ms'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entities' and column_name = v_col) then
      raise exception '0017: la tabella public.entities non ha la colonna %', v_col;
    end if;
  end loop;
  if to_regclass('public.entity_authority') is not null then
    raise exception '0017: public.entity_authority esiste gia'' (migrazione gia'' applicata?). Per ri-applicare eseguire prima il rollback.';
  end if;
  if to_regprocedure('public._entities_parse_v1(jsonb)') is null then
    raise exception '0017: manca public._entities_parse_v1 (la 0015 non e'' applicata)';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Interruttore di autorita'
--    kind = i nomi usati in `entities` (plurali): i 7 del nucleo + rates, activities, tombs, leadtombs (0015).
-- ---------------------------------------------------------------------------------------------------------------
create table public.entity_authority (
  owner_type char(1)     not null check (owner_type in ('u', 'o')),
  owner_id   uuid        not null,
  kind       text        not null check (kind in ('structures','roomTypes','units','bookings','guests','directReviews','events',
                                                  'rates','activities','tombs','leadtombs')),
  authority  text        not null default 'blob' check (authority in ('blob', 'table')),
  updated_at timestamptz not null default now(),
  primary key (owner_type, owner_id, kind)
);
comment on table public.entity_authority is
  'Fase 3: chi e'' la verita'' per (proprietario, tipo). Nessuna riga = blob (app_state/org_state). Solo service role.';

alter table public.entity_authority enable row level security;
revoke all on public.entity_authority from public, anon, authenticated;

create table public.entity_authority_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  owner_type    char(1),
  owner_id      uuid,
  kind          text,
  old_authority text,
  new_authority text,
  by_role       text default current_user
);
alter table public.entity_authority_log enable row level security;
revoke all on public.entity_authority_log from public, anon, authenticated;

create or replace function public.entity_authority_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'DELETE' then
    insert into public.entity_authority_log (owner_type, owner_id, kind, old_authority, new_authority)
    values (old.owner_type, old.owner_id, old.kind, old.authority, 'blob');
    return old;
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    insert into public.entity_authority_log (owner_type, owner_id, kind, old_authority, new_authority)
    values (new.owner_type, new.owner_id, new.kind, old.authority, new.authority);
  else
    insert into public.entity_authority_log (owner_type, owner_id, kind, old_authority, new_authority)
    values (new.owner_type, new.owner_id, new.kind, null, new.authority);
  end if;
  return new;
end
$fn$;

create trigger entity_authority_audit_trg
  before insert or update or delete on public.entity_authority
  for each row execute function public.entity_authority_audit();

-- chi e' la verita' per (proprietario, tipo): senza riga = 'blob'
create or replace function public.entity_authority_of(p_owner_type text, p_owner_id uuid, p_kind text)
returns text language sql stable security definer set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select a.authority from public.entity_authority a
      where a.owner_type = left(p_owner_type, 1) and a.owner_id = p_owner_id and a.kind = p_kind),
    'blob')
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Export: dalle righe di `entities` all'oggetto del blocco `spigolestay:data:v1`
--    Forma = quella che il codice usa (src/lib/store.tsx salvataggio, sync-core.ts):
--      structures, roomTypes, units, bookings, guests, directReviews, events : array di entita' (colonna `data` di ogni riga, identica
--        all'elemento originale: cosi' le scrive entities_sync_row_core); ordine = per id (le strutture per campo `order`).
--      rateOverrides : oggetto { "tipologia|AAAA-MM-GG": prezzo } (righe kind 'rates': id = chiave, data = valore)
--      activities    : array, piu' recenti prima (ts), massimo 500 come mergeActivities
--      _deleted      : oggetto { collezione: [id,...] } (righe kind 'tombs': data = {coll, id})
--      _deletedLeads : array di stringhe (righe kind 'leadtombs': id = la stringa)
--    Le chiavi ci sono SEMPRE (vuote se non ci sono righe). Restituisce l'OGGETTO. Per rimetterlo nel blocco (che tiene una STRINGA json):
--      jsonb_set(data, '{spigolestay:data:v1}', to_jsonb(public.entities_export_to_blob('u', '<uuid>')::text))
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public._entities_export_coll(p_ot char, p_oid uuid, p_kind text)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $fn$
  select coalesce(jsonb_agg(x.data order by x.ord nulls last, x.id), '[]'::jsonb)
    from (
      select e.id, e.data,
             case when p_kind = 'structures' and (e.data ->> 'order') ~ '^-?\d{1,9}(\.\d+)?$' then (e.data ->> 'order')::numeric end as ord
        from public.entities e
       where e.owner_type = p_ot and e.owner_id = p_oid and e.kind = p_kind
    ) x
$fn$;

create or replace function public.entities_export_to_blob(p_owner_type text, p_owner_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_ot char(1) := left(coalesce(p_owner_type, ''), 1);
  v_rates jsonb; v_act jsonb; v_tombs jsonb; v_leads jsonb;
begin
  if v_ot not in ('u', 'o') or p_owner_id is null then
    raise exception 'entities_export_to_blob: proprietario non valido (tipo %, id %)', p_owner_type, p_owner_id;
  end if;

  select coalesce(jsonb_object_agg(e.id, e.data), '{}'::jsonb) into v_rates
    from public.entities e where e.owner_type = v_ot and e.owner_id = p_owner_id and e.kind = 'rates';

  select coalesce(jsonb_agg(a.data order by a.updated_ms desc, a.id), '[]'::jsonb) into v_act
    from (select e.id, e.data, e.updated_ms from public.entities e
           where e.owner_type = v_ot and e.owner_id = p_owner_id and e.kind = 'activities'
           order by e.updated_ms desc, e.id limit 500) a;

  select coalesce(jsonb_object_agg(t.coll, t.ids), '{}'::jsonb) into v_tombs
    from (select e.data ->> 'coll' as coll, jsonb_agg(e.data ->> 'id' order by e.data ->> 'id') as ids
            from public.entities e
           where e.owner_type = v_ot and e.owner_id = p_owner_id and e.kind = 'tombs'
             and (e.data ->> 'coll') is not null and (e.data ->> 'id') is not null
           group by e.data ->> 'coll') t;

  select coalesce(jsonb_agg(e.id order by e.id), '[]'::jsonb) into v_leads
    from public.entities e where e.owner_type = v_ot and e.owner_id = p_owner_id and e.kind = 'leadtombs';

  return jsonb_build_object(
    'structures',    public._entities_export_coll(v_ot, p_owner_id, 'structures'),
    'roomTypes',     public._entities_export_coll(v_ot, p_owner_id, 'roomTypes'),
    'units',         public._entities_export_coll(v_ot, p_owner_id, 'units'),
    'bookings',      public._entities_export_coll(v_ot, p_owner_id, 'bookings'),
    'guests',        public._entities_export_coll(v_ot, p_owner_id, 'guests'),
    'directReviews', public._entities_export_coll(v_ot, p_owner_id, 'directReviews'),
    'events',        public._entities_export_coll(v_ot, p_owner_id, 'events'),
    'rateOverrides', v_rates,
    'activities',    v_act,
    '_deleted',      v_tombs,
    '_deletedLeads', v_leads
  );
end
$fn$;

-- Elementi di un campo del blocco come coppie (chiave, valore), per il confronto. Stesse chiavi usate in `entities`.
create or replace function public._entities_blob_items(v jsonb, p_field text)
returns table (k text, val jsonb)
language plpgsql immutable set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
begin
  if v is null or jsonb_typeof(v) is distinct from 'object' then return; end if;
  if p_field in ('structures','roomTypes','units','bookings','guests','directReviews','events','activities') then
    if jsonb_typeof(v -> p_field) is distinct from 'array' then return; end if;
    return query
      select distinct on (a.value ->> 'id') a.value ->> 'id', a.value
        from jsonb_array_elements(v -> p_field) a
       where jsonb_typeof(a.value) = 'object' and coalesce(a.value ->> 'id', '') <> ''
       order by a.value ->> 'id';
  elsif p_field = 'rateOverrides' then
    if jsonb_typeof(v -> p_field) is distinct from 'object' then return; end if;
    return query select e.key::text, e.value from jsonb_each(v -> p_field) e;
  elsif p_field = '_deleted' then
    if jsonb_typeof(v -> p_field) is distinct from 'object' then return; end if;
    return query
      select distinct on (c.key || ':' || t.value) c.key || ':' || t.value, 'true'::jsonb
        from jsonb_each(v -> p_field) c
        cross join lateral jsonb_array_elements_text(case when jsonb_typeof(c.value) = 'array' then c.value else '[]'::jsonb end) t
       where t.value is not null
       order by c.key || ':' || t.value;
  elsif p_field = '_deletedLeads' then
    if jsonb_typeof(v -> p_field) is distinct from 'array' then return; end if;
    return query
      select distinct on (s.value) s.value, 'true'::jsonb
        from jsonb_array_elements_text(v -> p_field) s
       where s.value is not null
       order by s.value;
  end if;
end
$fn$;

-- Confronto export <-> blocco, una riga per campo. Tutto 0 in missing/extra/different = il blocco e' ricostruibile identico dalle tabelle.
--   blob_n = elementi nel blocco, export_n = elementi nell'export, missing = nel blocco ma non nell'export,
--   extra = nell'export ma non nel blocco, different = stesso id ma contenuto diverso.
-- Se p_blob e' nullo legge il blocco vero dal database (app_state / org_state), altrimenti usa quello passato (per le prove).
create or replace function public.entities_export_check(p_owner_type text, p_owner_id uuid, p_blob jsonb default null)
returns table (field text, blob_n int, export_n int, missing int, extra int, different int)
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_ot char(1) := left(coalesce(p_owner_type, ''), 1);
  v_blob jsonb; v_exp jsonb; v_raw jsonb; v_f text;
begin
  if v_ot not in ('u', 'o') or p_owner_id is null then
    raise exception 'entities_export_check: proprietario non valido';
  end if;
  if p_blob is not null then
    v_blob := public._entities_parse_v1(p_blob);
  else
    if v_ot = 'u' then
      select a.data -> 'spigolestay:data:v1' into v_raw from public.app_state a where a.user_id = p_owner_id;
    else
      select s.data -> 'spigolestay:data:v1' into v_raw from public.org_state s where s.org_id = p_owner_id;
    end if;
    v_blob := public._entities_parse_v1(v_raw);
  end if;
  v_exp := public.entities_export_to_blob(v_ot, p_owner_id);

  foreach v_f in array array['structures','roomTypes','units','bookings','guests','directReviews','events',
                             'rateOverrides','activities','_deleted','_deletedLeads'] loop
    return query
      with b as materialized (select * from public._entities_blob_items(v_blob, v_f)),
           x as materialized (select * from public._entities_blob_items(v_exp, v_f))
      select v_f,
             (select count(*) from b)::int,
             (select count(*) from x)::int,
             (select count(*) from b where not exists (select 1 from x where x.k = b.k))::int,
             (select count(*) from x where not exists (select 1 from b where b.k = x.k))::int,
             (select count(*) from b join x on x.k = b.k where b.val is distinct from x.val)::int;
  end loop;
end
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Guardia anti-cancellazione di massa su `entities`
--    Configurazione modificabile senza rilasciare codice (tabella entities_guard_config, chiave -> valore testuale):
--      mirror_mode  'log' (default) | 'enforce'  : cosa fare con le cancellazioni fatte dalla sync blocco->tabella (annidate in un trigger)
--      limit:<kind> soglia per quel tipo ; limit:* soglia generica. Si rifiuta se le righe cancellate dallo stesso proprietario e tipo
--      in UNA istruzione sono PIU' della soglia.
--    Flag di sessione per la manutenzione (backfill, pulizie volute, rollback): `select set_config('xenora.allow_mass_delete','on',true);`
--    nella stessa transazione (is_local = true: finisce con la transazione).
--    In modalita' 'log' (sync annidata) l'evento va in entities_guard_log e in un WARNING; negli altri casi senza flag la DELETE fallisce
--    con SQLSTATE XN001 (l'intera istruzione e' annullata: nessuna riga viene tolta).
-- ---------------------------------------------------------------------------------------------------------------
create table public.entities_guard_config (
  key   text primary key,
  value text not null
);
alter table public.entities_guard_config enable row level security;
revoke all on public.entities_guard_config from public, anon, authenticated;
insert into public.entities_guard_config (key, value) values
  ('mirror_mode',      'log'),
  ('limit:*',          '25'),     -- stesse soglie di applyDelta (sync-delta.ts): 40 prenotazioni, 25 il resto
  ('limit:bookings',   '40'),
  ('limit:structures', '3'),
  ('limit:rates',      '400');    -- azzerare un mese di prezzi per piu' tipologie e' normale

create table public.entities_guard_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  owner_type char(1),
  owner_id   uuid,
  kind       text,
  deleted_n  int,
  threshold  int,
  outcome    text,        -- 'logged' (sync annidata, solo registrata) | 'allowed_flag' (consentita col flag di manutenzione)
  nested     boolean,
  app_name   text default current_setting('application_name', true)
);
alter table public.entities_guard_log enable row level security;
revoke all on public.entities_guard_log from public, anon, authenticated;

create or replace function public.entities_guard_mass_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  r record;
  v_nested boolean := pg_trigger_depth() > 1;      -- DELETE lanciata da dentro un altro trigger (es. entities_trg_app -> sync)
  v_flag   boolean := coalesce(current_setting('xenora.allow_mass_delete', true), '') = 'on';
  v_mode   text;
begin
  select c.value into v_mode from public.entities_guard_config c where c.key = 'mirror_mode';
  v_mode := coalesce(v_mode, 'log');

  for r in
    select o.owner_type, o.owner_id, o.kind, count(*)::int as n,
           coalesce(
             (select case when c.value ~ '^\d+$' then c.value::int end from public.entities_guard_config c where c.key = 'limit:' || o.kind),
             (select case when c.value ~ '^\d+$' then c.value::int end from public.entities_guard_config c where c.key = 'limit:*'),
             25) as lim
      from old_rows o
     where o.kind <> all (array['tombs', 'leadtombs', 'activities'])
     group by o.owner_type, o.owner_id, o.kind
  loop
    if r.n <= r.lim then continue; end if;

    if v_flag or (v_nested and v_mode <> 'enforce') then
      begin
        insert into public.entities_guard_log (owner_type, owner_id, kind, deleted_n, threshold, outcome, nested)
        values (r.owner_type, r.owner_id, r.kind, r.n, r.lim, case when v_flag then 'allowed_flag' else 'logged' end, v_nested);
      exception when others then null;     -- il registro non deve mai far fallire una scrittura lecita
      end;
      if not v_flag then
        raise warning 'entities_guard: cancellate % righe di % (%, %) dalla sync blocco->tabella (soglia %): solo registrato', r.n, r.kind, r.owner_type, r.owner_id, r.lim;
      end if;
    else
      raise exception 'XN-GUARD: cancellazione di massa rifiutata su entities (% righe di "%" del proprietario %/%, soglia %). Per una manutenzione voluta: select set_config(''xenora.allow_mass_delete'',''on'',true); nella stessa transazione.',
        r.n, r.kind, r.owner_type, r.owner_id, r.lim using errcode = 'XN001';
    end if;
  end loop;
  return null;
end
$fn$;

create trigger entities_guard_mass_delete_trg
  after delete on public.entities
  referencing old table as old_rows
  for each statement execute function public.entities_guard_mass_delete();

create or replace function public.entities_guard_truncate()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if coalesce(current_setting('xenora.allow_mass_delete', true), '') = 'on' then return null; end if;
  raise exception 'XN-GUARD: TRUNCATE di public.entities rifiutato. Per una manutenzione voluta: select set_config(''xenora.allow_mass_delete'',''on'',true); nella stessa transazione.'
    using errcode = 'XN001';
end
$fn$;

create trigger entities_guard_truncate_trg
  before truncate on public.entities
  for each statement execute function public.entities_guard_truncate();

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Permessi: solo proprietario e service_role (mai anon/authenticated via PostgREST)
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.entity_authority_audit()                          from public, anon, authenticated;
revoke all on function public.entity_authority_of(text, uuid, text)             from public, anon, authenticated;
revoke all on function public._entities_export_coll(char, uuid, text)           from public, anon, authenticated;
revoke all on function public.entities_export_to_blob(text, uuid)               from public, anon, authenticated;
revoke all on function public._entities_blob_items(jsonb, text)                 from public, anon, authenticated;
revoke all on function public.entities_export_check(text, uuid, jsonb)          from public, anon, authenticated;
revoke all on function public.entities_guard_mass_delete()                      from public, anon, authenticated;
revoke all on function public.entities_guard_truncate()                         from public, anon, authenticated;
