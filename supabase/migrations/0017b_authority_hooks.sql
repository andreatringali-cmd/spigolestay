-- 0017b_authority_hooks.sql  (Fase 3, passo 2, parte B: l'interruttore di autorita' entra nelle funzioni che esistono gia')
--
-- NON ANCORA APPLICATA. Da applicare SOLO DOPO 0017_entity_authority.sql e dopo aver letto
-- supabase/db-snapshot/2026-10-22-piano-0017.md. NON usare `supabase db push`.
--
-- ATTENZIONE: questa migrazione MODIFICA funzioni e trigger che oggi governano ogni scrittura del blocco. Finche' entity_authority e'
-- vuota (nessun proprietario con authority = 'table') il comportamento resta IDENTICO a oggi (provato con confronto riga per riga, vedi
-- il piano). Il testo precedente di ogni funzione e' in supabase/db-snapshot/2026-10-22-funzioni-attuali.sql (usato dal rollback).
--
-- Cosa cambia (tutto "a costo zero" per i proprietari senza righe 'table': una ricerca per chiave primaria su una tabella vuota):
--   1. app_state_realcount_owner(): come app_state_realcount ma, per i tipi passati a 'table', conta anche le righe di `entities`.
--      snapshot_app_state / snapshot_org_state la usano: l'anti-svuotamento e lo storico continuano a funzionare quando strutture,
--      prenotazioni e ospiti non stanno piu' nel blocco (altrimenti: o ogni scrittura verrebbe scartata, o lo storico si fermerebbe).
--   2. entities_sync_row (l'involucro della 0015): per i tipi 'table' toglie quei campi dal blocco (nuovo e vecchio) PRIMA di passarlo
--      a entities_sync_row_core e _entities_sync_extra, che quindi non li toccano piu' (ne' scrivono, ne' cancellano). entities_sync_row_core
--      e _entities_sync_extra NON sono modificate.
--   3. entities_verify / entities_verify_extra: saltano i tipi 'table' (nel blocco non ci sono piu': sarebbero "in piu").
--   4. Trigger BEFORE UPDATE su app_state e org_state (nome «a_xn_authority_guard», scatta PRIMA di trg_snapshot_*): se una scrittura
--      (es. un vecchio client con la PWA non aggiornata) rimette nel blocco una collezione di un tipo 'table' NON VUOTA, la scrittura
--      e' RIFIUTATA (SQLSTATE XN002) invece di far tornare due verita'. Aggira: flag `xenora.authority_maintenance = 'on'` (transazione).
--
-- Rollback: 0017b_authority_hooks_rollback.sql.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------------------------
-- 0. Controlli preliminari
-- ---------------------------------------------------------------------------------------------------------------
do $pre$
declare v_src text;
begin
  if to_regclass('public.entity_authority') is null or to_regprocedure('public.entity_authority_of(text,uuid,text)') is null then
    raise exception '0017b: applicare prima 0017_entity_authority.sql';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'app_state_realcount_owner') then
    raise exception '0017b: gia'' applicata (app_state_realcount_owner esiste). Per ri-applicare eseguire prima il rollback.';
  end if;

  select p.prosrc into v_src from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'entities_sync_row';
  if v_src is null or position('entities_sync_row_core' in v_src) = 0 or position('_entities_sync_extra' in v_src) = 0 or position('entity_authority' in v_src) > 0 then
    raise exception '0017b: entities_sync_row non e'' l''involucro della 0015 (o e'' gia'' modificata)';
  end if;
  select p.prosrc into v_src from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'snapshot_app_state';
  if v_src is null or position('app_state_realcount(OLD.data)' in v_src) = 0 then
    raise exception '0017b: snapshot_app_state non ha il testo atteso (vedi db-snapshot/2026-10-22-funzioni-attuali.sql)';
  end if;
  select p.prosrc into v_src from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'snapshot_org_state';
  if v_src is null or position('app_state_realcount(OLD.data)' in v_src) = 0 then
    raise exception '0017b: snapshot_org_state non ha il testo atteso (vedi db-snapshot/2026-10-22-funzioni-attuali.sql)';
  end if;
  if exists (select 1 from public.entity_authority where authority = 'table') then
    raise exception '0017b: esistono gia'' tipi con authority = ''table'': non e'' il momento di cambiare le funzioni';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Funzioni di supporto
-- ---------------------------------------------------------------------------------------------------------------
-- nome del campo nel blocco `spigolestay:data:v1` per un kind di `entities`
create or replace function public._entities_kind_field(p_kind text)
returns text language sql immutable set search_path = public, pg_temp
as $fn$
  select case p_kind when 'rates' then 'rateOverrides' when 'tombs' then '_deleted' when 'leadtombs' then '_deletedLeads' else p_kind end
$fn$;

-- conteggio "dati reali" di un proprietario: quello del blocco + le righe di entities dei tipi strutture/prenotazioni/ospiti passati a 'table'.
-- Senza righe 'table' = app_state_realcount(d) (stesso identico valore di oggi).
create or replace function public.app_state_realcount_owner(p_owner_type text, p_owner_id uuid, d jsonb)
returns integer language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare c int; extra int := 0;
begin
  c := public.app_state_realcount(d);
  select coalesce(sum((select count(*) from public.entities e
                        where e.owner_type = a.owner_type and e.owner_id = a.owner_id and e.kind = a.kind)), 0)::int
    into extra
    from public.entity_authority a
   where a.owner_type = left(p_owner_type, 1) and a.owner_id = p_owner_id
     and a.authority = 'table' and a.kind in ('structures', 'bookings', 'guests');
  return c + extra;
end
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Anti-svuotamento + storico: stesso testo di oggi, con il conteggio che tiene conto dell'autorita'
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.snapshot_app_state()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  old_c int := public.app_state_realcount_owner('u', OLD.user_id, OLD.data);
  new_c int := public.app_state_realcount_owner('u', OLD.user_id, NEW.data);
begin
  if old_c > 0 then
    insert into public.app_state_history(user_id, data, saved_at) values (OLD.user_id, OLD.data, now());
    delete from public.app_state_history h
     where h.user_id = OLD.user_id
       and h.id not in (
         select id from public.app_state_history
          where user_id = OLD.user_id order by saved_at desc limit 30
       );
  end if;

  if old_c > 0 and new_c = 0 then
    return null;
  end if;

  NEW.rev := OLD.rev + 1;
  return NEW;
end;
$function$;

create or replace function public.snapshot_org_state()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  old_c int := public.app_state_realcount_owner('o', OLD.org_id, OLD.data);
  new_c int := public.app_state_realcount_owner('o', OLD.org_id, NEW.data);
begin
  if old_c > 0 then
    insert into public.org_state_history(org_id, data, saved_at) values (OLD.org_id, OLD.data, now());
    delete from public.org_state_history h
     where h.org_id = OLD.org_id
       and h.id not in (select id from public.org_state_history where org_id = OLD.org_id order by saved_at desc limit 30);
  end if;
  if old_c > 0 and new_c = 0 then
    return null; -- mai svuotare dati reali condivisi
  end if;
  NEW.rev := OLD.rev + 1;
  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. entities_sync_row: l'involucro della 0015 non passa al core/extra i campi dei tipi 'table'
--    (stessa firma, stesso language/security/search_path, quindi i permessi restano quelli di oggi)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.entities_sync_row(p_owner uuid, p_type character, p_blob jsonb, p_old jsonb default null::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    declare
      v_tab    text[];
      v_fields text[];
      v_blob   jsonb := p_blob;
      v_old    jsonb := p_old;
    begin
      -- tipi la cui verita' e' la tabella: il blocco non deve piu' toccarli (ne' scrivere, ne' cancellare)
      select array_agg(a.kind) into v_tab
        from public.entity_authority a
       where a.owner_type = p_type and a.owner_id = p_owner and a.authority = 'table';
      if v_tab is not null then
        v_fields := array(select public._entities_kind_field(k) from unnest(v_tab) k);
        if p_blob is not null and jsonb_typeof(p_blob) = 'object' then v_blob := p_blob - v_fields; end if;
        if p_old  is not null and jsonb_typeof(p_old)  = 'object' then v_old  := p_old  - v_fields; end if;
      end if;

      perform public.entities_sync_row_core(p_owner, p_type, v_blob, v_old);
      begin
        perform public._entities_sync_extra(p_type::text, p_owner::text::uuid, to_jsonb(v_blob), to_jsonb(v_old));
      exception when others then
        raise warning 'entities_sync_row: passo extra fallito (vedi entities_extra_errors)';
      end;
    end;
    $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. entities_verify / entities_verify_extra: saltano i tipi 'table'
--    Testo originale (letto il 21/10/2026, dopo la 0015) con DUE sole aggiunte: la clausola `not exists (... entity_authority ...)`
--    nei CTE `flat` e `ts`.
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
      and not exists (select 1 from public.entity_authority ea where ea.owner_type = t and ea.owner_id = oid and ea.kind = c.coll and ea.authority = 'table')
  ), bs as (
    select t, oid, kind, count(*) n from flat group by 1,2,3
  ), ts as (
    select owner_type t, owner_id oid, kind, count(*) n from public.entities
    where kind = any(array['structures','roomTypes','units','bookings','guests','directReviews','events'])
      and not exists (select 1 from public.entity_authority ea where ea.owner_type = entities.owner_type and ea.owner_id = entities.owner_id and ea.kind = entities.kind and ea.authority = 'table')
    group by 1,2,3
  ), keys as (select t, oid, kind from bs union select t, oid, kind from ts)
  select k.t, k.oid, k.kind, coalesce(bs.n,0), coalesce(ts.n,0),
    (select count(*) from flat f where f.t = k.t and f.oid = k.oid and f.kind = k.kind and not exists (select 1 from public.entities en where en.owner_type = f.t and en.owner_id = f.oid and en.kind = f.kind and en.id = f.id)),
    (select count(*) from public.entities en where en.owner_type = k.t and en.owner_id = k.oid and en.kind = k.kind and not exists (select 1 from flat f where f.t = en.owner_type and f.oid = en.owner_id and f.kind = en.kind and f.id = en.id)),
    (select count(*) from flat f join public.entities en on en.owner_type = f.t and en.owner_id = f.oid and en.kind = f.kind and en.id = f.id where f.t = k.t and f.oid = k.oid and f.kind = k.kind and en.data is distinct from f.e)
  from keys k left join bs on bs.t = k.t and bs.oid = k.oid and bs.kind = k.kind left join ts on ts.t = k.t and ts.oid = k.oid and ts.kind = k.kind
  order by 1,2,3
$function$;

create or replace function public.entities_verify_extra()
 returns table(owner_type character, owner_id uuid, kind text, blob_n integer, table_n integer, missing integer, extra integer, different integer)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
      if public.entity_authority_of(r.ot, r.oid, v_kind) = 'table' then continue; end if;     -- verita' = tabella: niente da confrontare col blocco
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
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Blocco delle scritture "vecchie": un tipo 'table' non puo' tornare (non vuoto) dentro app_state / org_state
--    Flag di manutenzione per chi deve davvero riscrivere il blocco (es. ripristino dall'export): `xenora.authority_maintenance = 'on'`.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public._xn_authority_blob_check(p_owner_type text, p_owner_id uuid, p_old jsonb, p_new jsonb)
returns void language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  c_key constant text := 'spigolestay:data:v1';
  v_tab text[]; v jsonb; k text; val jsonb;
begin
  if coalesce(current_setting('xenora.authority_maintenance', true), '') = 'on' then return; end if;
  select array_agg(a.kind) into v_tab
    from public.entity_authority a
   where a.owner_type = left(p_owner_type, 1) and a.owner_id = p_owner_id and a.authority = 'table';
  if v_tab is null then return; end if;                                         -- il caso normale: nessuna riga, costo = una ricerca per chiave
  if (p_new -> c_key) is not distinct from (p_old -> c_key) then return; end if;  -- il blocco dati non e' cambiato (thread, impostazioni...)
  begin
    v := public._entities_parse_v1(p_new -> c_key);
  exception when others then
    return;
  end;
  if v is null then return; end if;
  foreach k in array v_tab loop
    val := v -> public._entities_kind_field(k);
    if val is not null and ((jsonb_typeof(val) = 'array' and jsonb_array_length(val) > 0)
                         or (jsonb_typeof(val) = 'object' and val <> '{}'::jsonb)) then
      raise exception 'XN-AUTH: scrittura rifiutata: "%" non e'' piu'' nel blocco (verita'' = tabella) per il proprietario %/%. Aggiornare l''app (versione piu'' recente) e riprovare.',
        k, left(p_owner_type, 1), p_owner_id using errcode = 'XN002';
    end if;
  end loop;
end
$fn$;

create or replace function public.xn_authority_guard_app()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  perform public._xn_authority_blob_check('u', new.user_id, old.data, new.data);
  return new;
end
$fn$;

create or replace function public.xn_authority_guard_org()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  perform public._xn_authority_blob_check('o', new.org_id, old.data, new.data);
  return new;
end
$fn$;

drop trigger if exists a_xn_authority_guard on public.app_state;
create trigger a_xn_authority_guard before update on public.app_state
  for each row execute function public.xn_authority_guard_app();

drop trigger if exists a_xn_authority_guard on public.org_state;
create trigger a_xn_authority_guard before update on public.org_state
  for each row execute function public.xn_authority_guard_org();

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Permessi delle funzioni nuove
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public._entities_kind_field(text)                         from public, anon, authenticated;
revoke all on function public.app_state_realcount_owner(text, uuid, jsonb)       from public, anon, authenticated;
revoke all on function public._xn_authority_blob_check(text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.xn_authority_guard_app()                           from public, anon, authenticated;
revoke all on function public.xn_authority_guard_org()                           from public, anon, authenticated;
