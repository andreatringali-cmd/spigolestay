-- 0017b_authority_hooks_rollback.sql
--
-- NON ANCORA APPLICATA. Annulla 0017b_authority_hooks.sql: rimette le funzioni com'erano (testo letto dal database il 21/10/2026,
-- copia in supabase/db-snapshot/2026-10-22-funzioni-attuali.sql) e toglie i trigger a_xn_authority_guard.
-- In una transazione (apply_migration / editor SQL). NON usare `supabase db push`.
--
-- Si ferma senza toccare nulla se esiste anche una sola riga entity_authority con authority = 'table': con le funzioni vecchie la
-- sincronizzazione blocco->tabella riprenderebbe a scrivere/cancellare quei tipi. Prima riportarli al blocco (vedi piano, «Rollback»).
-- Dopo questo file si puo' eseguire 0017_entity_authority_rollback.sql.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $rb$
begin
  if to_regprocedure('public.app_state_realcount_owner(text,uuid,jsonb)') is null then
    raise exception 'rollback 0017b: 0017b non applicata (o gia'' annullata): nessuna modifica';
  end if;
  if exists (select 1 from public.entity_authority where authority = 'table') then
    raise exception 'rollback 0017b: ci sono tipi con authority = ''table''. Riportarli al blocco prima di annullare.';
  end if;
end
$rb$;

-- 1. trigger di blocco delle scritture "vecchie"
drop trigger if exists a_xn_authority_guard on public.app_state;
drop trigger if exists a_xn_authority_guard on public.org_state;
drop function if exists public.xn_authority_guard_app();
drop function if exists public.xn_authority_guard_org();
drop function if exists public._xn_authority_blob_check(text, uuid, jsonb, jsonb);

-- 2. funzioni com'erano
create or replace function public.snapshot_app_state()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

create or replace function public.snapshot_org_state()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

create or replace function public.entities_sync_row(p_owner uuid, p_type character, p_blob jsonb, p_old jsonb default null::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    begin
      perform public.entities_sync_row_core(p_owner, p_type, p_blob, p_old);
      begin
        perform public._entities_sync_extra(p_type::text, p_owner::text::uuid, to_jsonb(p_blob), to_jsonb(p_old));
      exception when others then
        raise warning 'entities_sync_row: passo extra fallito (vedi entities_extra_errors)';
      end;
    end;
    $function$;

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

-- 3. funzioni di supporto nuove (dopo aver rimesso le vecchie, che non le usano piu')
drop function if exists public.app_state_realcount_owner(text, uuid, jsonb);
drop function if exists public._entities_kind_field(text);
