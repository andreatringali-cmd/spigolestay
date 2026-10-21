-- 0017_entity_authority_rollback.sql
--
-- NON ANCORA APPLICATA. Annulla 0017_entity_authority.sql. In una transazione (apply_migration / editor SQL).
-- NON usare `supabase db push`.
--
-- Si ferma senza toccare nulla se:
--   * 0017b e' ancora applicata (le funzioni nuove di sync/anti-svuotamento/blocco leggono entity_authority: prima 0017b_authority_hooks_rollback.sql);
--   * esiste anche una sola riga entity_authority con authority = 'table' (prima riportare quel tipo al blocco: vedi piano, sezione rollback).
-- I dati (entities, app_state, org_state) non vengono toccati. Si perdono solo i registri entity_authority_log, entities_guard_log,
-- entities_guard_config: se serve conservarli: create table _xn_f3_guard_log as select * from public.entities_guard_log;

set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $rb$
declare v_n int; v_names text;
begin
  if to_regclass('public.entity_authority') is null then
    raise exception 'rollback 0017: public.entity_authority non esiste (0017 non applicata o gia'' annullata): nessuna modifica';
  end if;

  select count(*), string_agg(p.proname, ', ') into v_n, v_names
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname not in ('entity_authority_of', 'entities_export_check', 'entities_export_to_blob', '_entities_export_coll',
                           '_entities_blob_items', 'entity_authority_audit', 'entities_guard_mass_delete', 'entities_guard_truncate')
     and p.prosrc ~ '(entity_authority|entities_guard|entity_authority_of)';
  if v_n > 0 then
    raise exception 'rollback 0017: queste funzioni usano ancora entity_authority / entities_guard (annullare prima 0017b): %', v_names;
  end if;

  if exists (select 1 from public.entity_authority where authority = 'table') then
    raise exception 'rollback 0017: ci sono tipi con authority = ''table''. Riportarli al blocco (export + authority = blob) prima di annullare.';
  end if;
end
$rb$;

drop trigger if exists entities_guard_mass_delete_trg on public.entities;
drop trigger if exists entities_guard_truncate_trg on public.entities;
drop function if exists public.entities_guard_mass_delete();
drop function if exists public.entities_guard_truncate();

drop function if exists public.entities_export_check(text, uuid, jsonb);
drop function if exists public._entities_blob_items(jsonb, text);
drop function if exists public.entities_export_to_blob(text, uuid);
drop function if exists public._entities_export_coll(char, uuid, text);
drop function if exists public.entity_authority_of(text, uuid, text);

drop table if exists public.entity_authority;          -- porta con se' il trigger entity_authority_audit_trg
drop function if exists public.entity_authority_audit();
drop table if exists public.entity_authority_log;
drop table if exists public.entities_guard_log;
drop table if exists public.entities_guard_config;
