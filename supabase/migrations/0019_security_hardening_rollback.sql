-- ROLLBACK di 0019_security_hardening.sql — riporta il database allo stato osservato il 22/10/2026 PRIMA della 0019.
-- ATTENZIONE: riaprire i blocchi 1 e 2 significa rimettere il buco di sicurezza (lettura/scrittura anonima). Usare solo se una verifica
-- mostra che qualcosa di legittimo si è rotto, e riapplicare la 0019 appena corretto. Ogni blocco è indipendente.

-- Blocco 1 — short_links (ripristina lettura anonima; get_short_link può restare, è innocua)
begin;
grant select on public.short_links to anon, authenticated;
drop policy if exists short_links_select_all on public.short_links;
create policy short_links_select_all on public.short_links for select to anon, authenticated using (true);
commit;

-- Blocco 2 — tabelle _xn_sim_clean_* (torna senza RLS e con tutti i privilegi, come prima)
begin;
alter table public._xn_sim_clean_entities_20261021  disable row level security;
alter table public._xn_sim_clean_app_state_20261021 disable row level security;
grant all on public._xn_sim_clean_entities_20261021  to anon, authenticated;
grant all on public._xn_sim_clean_app_state_20261021 to anon, authenticated;
commit;

-- Blocco 3 — privilegi sulle tabelle senza policy (ripristina il default di Supabase: GRANT ALL ad anon e authenticated)
begin;
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  loop
    execute format('grant all on %s to anon, authenticated', r.t);
  end loop;
end $$;
commit;

-- Blocco 4 — organizations: policy di aggiornamento per i membri + privilegio UPDATE
begin;
grant update on public.organizations to anon, authenticated;
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update to authenticated using (is_org_member(id)) with check (is_org_member(id));
commit;

-- Blocco 5 — funzioni: torna a EXECUTE per public/anon come prima (le funzioni trigger anche ad authenticated)
begin;
grant execute on function public.ws_get(text[])                         to public, anon, authenticated;
grant execute on function public.ws_set(text, text)                     to public, anon, authenticated;
grant execute on function public.market_pulse(text, date, date)         to public, anon, authenticated;
grant execute on function public.market_breakdown(text, date, date)     to public, anon, authenticated;
grant execute on function public.workspace_owner(uuid)                  to public, anon, authenticated;
grant execute on function public.cash_fill_org()                        to public, anon, authenticated;
grant execute on function public.entities_trg_app()                     to public, anon, authenticated;
grant execute on function public.entities_trg_org()                     to public, anon, authenticated;
-- Stato originale: ws_get/ws_set NON erano eseguibili da "public" (solo anon/authenticated); si toglie di nuovo.
revoke execute on function public.ws_get(text[]) from public;
revoke execute on function public.ws_set(text, text) from public;
alter function public.ws_deny(text) reset search_path;
commit;

-- Blocco 6 — quotes: torna alla policy senza limiti
begin;
drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert to authenticated with check (true);
commit;
