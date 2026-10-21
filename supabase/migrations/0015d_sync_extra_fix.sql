-- 0015d — correzione di _entities_sync_extra (Fase 3, passo 0)
--
-- Difetto: il trigger (entities_trg_app/org) passa a entities_sync_row il BLOCCO `data:v1` già estratto (non lo stato intero),
-- e l'involucro lo gira a _entities_sync_extra. La funzione però cercava `p_blob -> 'spigolestay:data:v1'`: su un blocco già estratto
-- dà NULL sia per il nuovo sia per il vecchio, risultano «uguali» e la funzione usciva subito. Conseguenza: rates/activities/tombs/leadtombs
-- si popolavano solo col riempimento iniziale e non seguivano più le scritture (visto con entities_verify_extra: lapidi e attività mancanti).
--
-- Correzione: la funzione accetta entrambe le forme (blocco estratto, oppure stato intero con la chiave `spigolestay:data:v1`).
-- Rollback: rieseguire la definizione precedente (in 0015_entities_complete.sql). Nessun dato viene toccato da questa migrazione.

create or replace function public._entities_sync_extra(p_owner_type text, p_owner_id uuid, p_blob jsonb, p_old jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c_key constant text := 'spigolestay:data:v1';
  v_ot    char(1) := left(p_owner_type, 1);
  v_in    jsonb;   -- blocco nuovo (forma grezza: oggetto, oppure testo JSON)
  v_prev  jsonb;   -- blocco vecchio
  v_new   jsonb;
  v_old   jsonb;
  v_kind  text;
  v_field text;
  v_up    int;
  v_dl    int;
begin
  if p_blob is null or p_owner_id is null then return; end if;
  -- forma «stato intero» (con la chiave data:v1) oppure già il blocco
  v_in   := case when jsonb_typeof(p_blob) = 'object' and jsonb_exists(p_blob, c_key) then p_blob -> c_key else p_blob end;
  v_prev := case when p_old is not null and jsonb_typeof(p_old) = 'object' and jsonb_exists(p_old, c_key) then p_old -> c_key else p_old end;
  if v_in is not distinct from v_prev then return; end if;

  begin
    v_new := public._entities_parse_v1(v_in);
    v_old := public._entities_parse_v1(v_prev);
  exception when others then
    insert into public.entities_extra_errors (owner_type, owner_id, step, sqlstate, message)
    values (v_ot, p_owner_id, 'parse', sqlstate, left(sqlerrm, 500));
    return;
  end;
  if v_new is null then return; end if;

  for v_kind, v_field in
    select t.k, t.f from (values ('rates', 'rateOverrides'), ('activities', 'activities'), ('tombs', '_deleted'), ('leadtombs', '_deletedLeads')) as t (k, f)
  loop
    if not jsonb_exists(v_new, v_field) then continue; end if;
    if (v_new -> v_field) is not distinct from (v_old -> v_field) then continue; end if;

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
$$;

revoke all on function public._entities_sync_extra(text, uuid, jsonb, jsonb) from public, anon, authenticated;
