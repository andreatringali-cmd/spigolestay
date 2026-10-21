-- 0015_entities_complete_rollback.sql
--
-- NON ANCORA APPLICATA. Annulla 0015 + 0015b. Da eseguire in una transazione (apply_migration / editor SQL).
-- NON usare `supabase db push` (questo file ha lo stesso prefisso 0015 della migrazione).
--
-- Come ripristina entities_sync_row: la migrazione NON riscrive il testo della funzione originale, la RINOMINA in
-- entities_sync_row_core. Il rollback elimina l'involucro e ridà il nome originale al _core: l'oggetto che torna e'
-- quello di prima, byte per byte, con gli stessi permessi (nessun testo da ricopiare, nessun rischio di trascrizione).
-- Se il _core non esiste (0015 non applicata) il rollback si ferma senza toccare nulla.

set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- 1. funzione di sync: via l'involucro, torna l'originale
do $rb$
declare
  v_oid oid; v_ident text; v_src text; v_c int;
begin
  select count(*) into v_c from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'entities_sync_row_core';
  if v_c <> 1 then
    raise exception 'rollback 0015: entities_sync_row_core non trovata (0015 non applicata o gia'' annullata): nessuna modifica';
  end if;

  select p.oid, p.prosrc into v_oid, v_src from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'entities_sync_row';
  if v_oid is not null then
    if position('_entities_sync_extra' in v_src) = 0 then
      raise exception 'rollback 0015: entities_sync_row non e'' l''involucro creato da 0015: nessuna modifica';
    end if;
    execute format('drop function public.entities_sync_row(%s)', pg_get_function_identity_arguments(v_oid));
  end if;

  select p.oid into v_oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'entities_sync_row_core';
  execute format('alter function public.entities_sync_row_core(%s) rename to entities_sync_row', pg_get_function_identity_arguments(v_oid));
end
$rb$;

-- 2. trigger e funzioni nuove
drop trigger if exists entities_bk_cols_trg on public.entities;
drop function if exists public.entities_bk_cols();
drop function if exists public._entities_sync_extra(text, uuid, jsonb, jsonb);
drop function if exists public.entities_backfill_extra(int);
drop function if exists public.entities_verify_extra();
drop function if exists public.entities_extra_rows(jsonb, text);
drop function if exists public._entities_parse_v1(jsonb);
drop function if exists public.entities_safe_date(text);

-- 3. indici (si andrebbero comunque con le colonne; esplicito per chiarezza). Tabella piccola: pochi ms.
drop index if exists public.entities_bk_ota_idx;
drop index if exists public.entities_bk_unit_idx;
drop index if exists public.entities_bk_guest_idx;
drop index if exists public.entities_bk_group_idx;
drop index if exists public.entities_bk_ext_idx;

-- 4. righe dei nuovi kind (solo quelle create da 0015: i kind esistenti non si toccano)
--    ~ qualche decina di migliaia di righe al massimo: un solo DELETE di qualche secondo; i blocchi di app_state/org_state non sono coinvolti.
delete from public.entities where kind in ('rates', 'activities', 'tombs', 'leadtombs');

-- 5. colonne nuove
alter table public.entities
  drop column if exists unit_id,
  drop column if exists guest_id,
  drop column if exists group_id,
  drop column if exists ota_code,
  drop column if exists ext_id;

-- 6. registro errori delle funzioni nuove (contiene solo errori delle funzioni nuove; esportarlo prima se serve)
drop table if exists public.entities_extra_errors;

-- Dopo il rollback (fuori transazione): vacuum (analyze) public.entities;   -- recupera lo spazio delle righe cancellate

-- 7. entities_verify(): torna al testo di prima della 0015 (senza il filtro sui 7 kind)
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
    select owner_type t, owner_id oid, kind, count(*) n from public.entities group by 1,2,3
  ), keys as (select t, oid, kind from bs union select t, oid, kind from ts)
  select k.t, k.oid, k.kind, coalesce(bs.n,0), coalesce(ts.n,0),
    (select count(*) from flat f where f.t = k.t and f.oid = k.oid and f.kind = k.kind and not exists (select 1 from public.entities en where en.owner_type = f.t and en.owner_id = f.oid and en.kind = f.kind and en.id = f.id)),
    (select count(*) from public.entities en where en.owner_type = k.t and en.owner_id = k.oid and en.kind = k.kind and not exists (select 1 from flat f where f.t = en.owner_type and f.oid = en.owner_id and f.kind = en.kind and f.id = en.id)),
    (select count(*) from flat f join public.entities en on en.owner_type = f.t and en.owner_id = f.oid and en.kind = f.kind and en.id = f.id where f.t = k.t and f.oid = k.oid and f.kind = k.kind and en.data is distinct from f.e)
  from keys k left join bs on bs.t = k.t and bs.oid = k.oid and bs.kind = k.kind left join ts on ts.t = k.t and ts.oid = k.oid and ts.kind = k.kind
  order by 1,2,3
$function$;
