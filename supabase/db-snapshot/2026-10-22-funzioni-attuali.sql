-- Testo ATTUALE delle funzioni del database di produzione (progetto tuxxhquagtrsndtzopbo = xenora-prod).
-- Letto il 21/10/2026 sera (notte 21->22) con pg_get_functiondef, in SOLA LETTURA. Nulla e' stato modificato.
--
-- A cosa serve: e' il paracadute di rollback per la migrazione 0017b (che riscrive alcune di queste funzioni).
-- Per tornare indietro basta eseguire questo file (sono tutte CREATE OR REPLACE con la stessa firma: i permessi non cambiano).
-- Stato del database al momento della lettura: la 0015 (+0015b, +0015d) e' GIA' applicata (esistono entities_sync_row_core,
-- _entities_sync_extra, entities_verify_extra, entities_backfill_extra). La 0016 non c'entra con queste funzioni.
--
-- Funzioni contenute: app_state_realcount, snapshot_app_state, snapshot_org_state, entities_sync_row_core (NON toccata da 0017/0017b,
-- inclusa per completezza), entities_sync_row (involucro di 0015), entities_trg_app, entities_trg_org (non toccate),
-- entities_verify, entities_verify_extra, entities_verify_run (non toccata).

-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_state_realcount(d jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare dv jsonb; c int := 0;
begin
  begin
    dv := (d->>'spigolestay:data:v1')::jsonb;
    c := coalesce(jsonb_array_length(coalesce(dv->'structures','[]'::jsonb)),0)
       + coalesce(jsonb_array_length(coalesce(dv->'bookings','[]'::jsonb)),0)
       + coalesce(jsonb_array_length(coalesce(dv->'guests','[]'::jsonb)),0);
  exception when others then c := 0; end;
  return c;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_app_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  old_c int := public.app_state_realcount(OLD.data);
  new_c int := public.app_state_realcount(NEW.data);
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

-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_org_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  old_c int := public.app_state_realcount(OLD.data);
  new_c int := public.app_state_realcount(NEW.data);
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
CREATE OR REPLACE FUNCTION public.entities_sync_row_core(p_owner uuid, p_type character, p_blob jsonb, p_old jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare coll text;
begin
  if p_blob is null or jsonb_typeof(p_blob) <> 'object' then return; end if;
  foreach coll in array array['structures','roomTypes','units','bookings','guests','directReviews','events'] loop
    if jsonb_typeof(p_blob->coll) is distinct from 'array' then continue; end if;
    if p_old is not null and jsonb_typeof(p_old) = 'object' and (p_old->coll) is not distinct from (p_blob->coll) then continue; end if;
    with incoming as (
      select e->>'id' as id, e from jsonb_array_elements(p_blob->coll) e
      where jsonb_typeof(e) = 'object' and coalesce(e->>'id','') <> ''
    ), up as (
      insert into public.entities (owner_type, owner_id, kind, id, structure_id, data, updated_ms, check_in, check_out, status, channel, synced_at)
      select p_type, p_owner, coll, i.id, i.e->>'structureId', i.e,
             case when (i.e->>'updatedAt') ~ '^\d{1,15}(\.\d+)?$' then floor((i.e->>'updatedAt')::numeric)::bigint else 0 end,
             public.entities_safe_date(i.e->>'checkIn'), public.entities_safe_date(i.e->>'checkOut'), i.e->>'status', i.e->>'channel', now()
      from incoming i
      on conflict (owner_type, owner_id, kind, id) do update
        set structure_id = excluded.structure_id, data = excluded.data, updated_ms = excluded.updated_ms,
            check_in = excluded.check_in, check_out = excluded.check_out, status = excluded.status, channel = excluded.channel, synced_at = now()
        where public.entities.data is distinct from excluded.data
      returning 1
    )
    delete from public.entities en
     where en.owner_type = p_type and en.owner_id = p_owner and en.kind = coll
       and not exists (select 1 from incoming i where i.id = en.id);
  end loop;
exception when others then
  begin insert into public.entities_sync_errors (owner_type, owner_id, detail) values (p_type, p_owner, left(sqlerrm, 500)); exception when others then null; end;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- Involucro creato dalla 0015 (chiama il core e poi _entities_sync_extra)
CREATE OR REPLACE FUNCTION public.entities_sync_row(p_owner uuid, p_type character, p_blob jsonb, p_old jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    begin
      perform public.entities_sync_row_core(p_owner, p_type, p_blob, p_old);
      begin
        perform public._entities_sync_extra(p_type::text, p_owner::text::uuid, to_jsonb(p_blob), to_jsonb(p_old));
      exception when others then
        raise warning 'entities_sync_row: passo extra fallito (vedi entities_extra_errors)';
      end;
    end;
    $function$;

-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entities_trg_app()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.entities_sync_row(new.user_id, 'u', (new.data->>'spigolestay:data:v1')::jsonb,
    case when tg_op = 'UPDATE' then (old.data->>'spigolestay:data:v1')::jsonb else null end);
  return new;
exception when others then
  begin insert into public.entities_sync_errors (owner_type, owner_id, detail) values ('u', new.user_id, 'trigger: ' || left(sqlerrm, 450)); exception when others then null; end;
  return new;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entities_trg_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.entities_sync_row(new.org_id, 'o', (new.data->>'spigolestay:data:v1')::jsonb,
    case when tg_op = 'UPDATE' then (old.data->>'spigolestay:data:v1')::jsonb else null end);
  return new;
exception when others then
  begin insert into public.entities_sync_errors (owner_type, owner_id, detail) values ('o', new.org_id, 'trigger: ' || left(sqlerrm, 450)); exception when others then null; end;
  return new;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entities_verify()
 RETURNS TABLE(owner_type character, owner_id uuid, kind text, blob_n bigint, table_n bigint, missing bigint, extra bigint, different bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entities_verify_extra()
 RETURNS TABLE(owner_type character, owner_id uuid, kind text, blob_n integer, table_n integer, missing integer, extra integer, different integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entities_verify_run()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb; bad int;
begin
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb), count(*) filter (where v.missing > 0 or v.extra > 0 or v.different > 0) into r, bad from public.entities_verify() v;
  insert into public.entities_verify_log (ok, summary) values (bad = 0, jsonb_build_object('rows', r, 'bad', bad, 'errors', (select count(*) from public.entities_sync_errors where at > now() - interval '2 days')));
  return jsonb_build_object('ok', bad = 0, 'bad', bad, 'rows', r);
end $function$;
