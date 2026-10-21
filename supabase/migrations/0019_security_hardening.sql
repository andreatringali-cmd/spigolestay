-- 0019 — Rafforzamento sicurezza del database (PROPOSTA, NON APPLICATA)
-- Notte 21→22 ottobre 2026, agente G. Scritta dopo una lettura in SOLA LETTURA del progetto tuxxhquagtrsndtzopbo
-- (get_advisors security+performance e interrogazioni su pg_catalog). Nessuna scrittura è stata fatta sul database.
--
-- Rollback: 0019_security_hardening_rollback.sql (stessa cartella).
--
-- ORDINE CONSIGLIATO: applicare i blocchi UNO ALLA VOLTA (ognuno ha il suo begin/commit) e provare dopo ciascuno (vedi "VERIFICA").
-- Il blocco 1 è il più urgente (CRITICO): chiude la lettura anonima di short_links.
--
-- Cosa NON fa (volutamente, richiede modifiche al client o una decisione):
--   * public_sites: nascondere user_id/structure_id ad anon → resta nella proposta _proposta_2026-10-17_short_links_public_sites.sql, blocco 2
--     (prima va cambiato il client, poi si applica).
--   * org_state / entities: permessi per ruolo lato server (Fase 3) → docs/fase3-rls-org-state.sql.
--   * schemi gestiti da Supabase (cron, net, vault): lasciati come sono.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- BLOCCO 1 — CRITICO — short_links leggibile da chiunque
-- Prova: policy "short_links_select_all" (roles {anon,authenticated}, qual = true) + GRANT SELECT ad anon. Oggi (22/10/2026) chiunque conosca la
-- chiave anon (pubblica, sta nella guida ospite) può leggere tutte le 919 righe: `target` contiene id prenotazione (/checkin?b=…, usato anche da
-- /gestisci e dall'annullamento con rimborso), nome ospite, codici d'ingresso (k=…) e token di pagamento in chat. L'unico lettore legittimo
-- è la route server /g/[code], che usa già la chiave di servizio (e, in mancanza, get_short_link): nessuna modifica al codice necessaria.
-- Le INSERT dal browser dei gestori (shortenLink) restano com'erano e non richiedono SELECT (return=minimal).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists short_links_select_all on public.short_links;
revoke select on public.short_links from anon, authenticated;

-- Risolve UN codice alla volta (nessuna enumerazione della tabella).
create or replace function public.get_short_link(p_code text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select target from public.short_links where code = p_code and length(p_code) between 4 and 16 limit 1;
$$;
revoke all on function public.get_short_link(text) from public;
grant execute on function public.get_short_link(text) to anon, authenticated, service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- BLOCCO 2 — ALTO — tabelle di prova/copia senza protezione di riga (rls_disabled_in_public)
-- Prova: public._xn_sim_clean_entities_20261021 (508 righe) e public._xn_sim_clean_app_state_20261021 (1 riga) hanno RLS spenta e GRANT
-- ALL ad anon/authenticated → lette E scritte da chiunque con la chiave anon. Contengono SOLO dati dell'account di prova (verificato: tutte le
-- righe appartengono a un utente "+test"), quindi nessuna perdita di dati veri, ma sono un buco aperto e l'avviso Supabase è di livello ERROR.
-- Alternativa preferibile se non servono più: DROP TABLE (vedi in fondo, commentato).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
begin;

alter table public._xn_sim_clean_entities_20261021  enable row level security;
alter table public._xn_sim_clean_app_state_20261021 enable row level security;
revoke all on public._xn_sim_clean_entities_20261021  from anon, authenticated;
revoke all on public._xn_sim_clean_app_state_20261021 from anon, authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- BLOCCO 3 — MEDIO — privilegi inutili sulle tabelle "solo server"
-- Prova: 23 tabelle hanno RLS attiva ma NESSUNA policy (rls_enabled_no_policy): per i client sono già "nega tutto", ma anon/authenticated
-- hanno ancora GRANT ALL (default di Supabase). Se un giorno qualcuno spegnesse la RLS per sbaglio (come successo con le tabelle _xn_sim_clean_*),
-- diventerebbero subito pubbliche, incluse cron_tokens (token del cron), stripe_events, access_allowlist, backup completi di app_state.
-- Tolgo i privilegi: nessun effetto sul funzionamento (service_role e i trigger/funzioni security definer non ne sono toccati).
-- Si applica a TUTTE le tabelle di public con RLS attiva e zero policy (calcolato al momento, quindi vale anche per backup futuri).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
    execute format('revoke all on %s from anon, authenticated', r.t);
  end loop;
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- BLOCCO 4 — ALTO — un co-gestore può riscrivere l'organizzazione dal browser
-- Prova: policy "org_update" su public.organizations = USING/WITH CHECK is_org_member(id) per ruolo authenticated, e GRANT UPDATE senza limiti
-- di colonna. Qualunque membro (anche un co-gestore con permessi ridotti) può quindi, con il proprio token e senza passare dalle route
-- /api/org/* (che controllano che sia il titolare), cambiare owner_id, plan, name, cash_shared, cash_structure_ids. Il codice dell'app NON
-- aggiorna mai organizations dal browser (solo select in lib/cassa.ts; scritture/cancellazioni passano da route server con service role),
-- quindi si può togliere la possibilità del tutto.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists org_update on public.organizations;
revoke update on public.organizations from anon, authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- BLOCCO 5 — MEDIO — funzioni SECURITY DEFINER richiamabili da anon senza motivo
-- Prova (get_advisors anon_security_definer_function_executable + has_function_privilege):
--   ws_get, ws_set (già bloccano auth.uid() nullo), market_pulse, market_breakdown (usano auth.uid(): per anon restituiscono solo conteggi),
--   workspace_owner(uuid) (anon può chiedere "di chi è collaboratore questo utente?" conoscendone l'id), e le funzioni
--   trigger cash_fill_org / entities_trg_app / entities_trg_org (non invocabili via RPC, ma segnalate).
-- Restano a anon: get_public_guide(text) e get_quote(text) (pagine pubbliche guida e preventivo, usate dal browser dell'ospite).
-- Restano a authenticated: is_ws_tenant, is_org_member, is_cash_org_member, workspace_owner, ws_get, ws_set, market_* (usate da policy e app).
-- NON tocco is_ws_tenant e is_cash_org_member per anon: compaiono direttamente nelle policy di molte tabelle (valutate coi privilegi di chi interroga)
-- e per anon restituiscono comunque false/zero righe; revocarle trasformerebbe un risultato vuoto in un errore "permission denied" in caso di
-- richiesta fatta prima che la sessione sia ripristinata. Restano segnalate come avviso a basso rischio.
-- NOTA: le policy delle tabelle valutano le funzioni coi privilegi di chi interroga; is_org_member è GIÀ vietata ad anon, quindi una
-- select anonima su tabelle con quelle policy dà già "permission denied" invece di zero righe. Nessuna pagina pubblica le usa.
-- Le funzioni trigger non richiedono EXECUTE al momento dello scatto del trigger (il privilegio si controlla solo alla creazione).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
begin;

revoke execute on function public.ws_get(text[])                         from public, anon;
revoke execute on function public.ws_set(text, text)                     from public, anon;
revoke execute on function public.market_pulse(text, date, date)         from public, anon;
revoke execute on function public.market_breakdown(text, date, date)     from public, anon;
revoke execute on function public.workspace_owner(uuid)                  from public, anon;
revoke execute on function public.cash_fill_org()                        from public, anon, authenticated;
revoke execute on function public.entities_trg_app()                     from public, anon, authenticated;
revoke execute on function public.entities_trg_org()                     from public, anon, authenticated;
-- Le revoche "from public" tolgono il privilegio di default; riconcedo esplicitamente a chi deve poterle usare.
grant execute on function public.ws_get(text[])                          to authenticated, service_role;
grant execute on function public.ws_set(text, text)                      to authenticated, service_role;
grant execute on function public.market_pulse(text, date, date)          to authenticated, service_role;
grant execute on function public.market_breakdown(text, date, date)     to authenticated, service_role;
grant execute on function public.workspace_owner(uuid)                   to authenticated, service_role;

-- search_path fisso anche per ws_deny (avviso function_search_path_mutable). Usa solo operatori built-in: '' è sicuro.
alter function public.ws_deny(text) set search_path = '';

commit;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- BLOCCO 6 — BASSO — preventivi: tetto alla dimensione e al formato del codice
-- Prova: policy "quotes_insert" WITH CHECK (true) per authenticated: un utente registrato può inserire righe di qualunque dimensione
-- e con qualunque codice. Oggi: 9 preventivi, codici di 7 caratteri, dato massimo ~13 KB.
-- Il tetto (200 KB, codice 4–40 caratteri) lascia ampio margine ai preventivi reali.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert to authenticated
  with check (length(code) between 4 and 40 and pg_column_size(data) < 200000);

commit;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- VERIFICA (da eseguire dopo ogni blocco; tutte sola lettura)
--   -- 1) con la chiave anon dal browser/curl:  GET /rest/v1/short_links?select=code&limit=1   → deve dare 401/403 "permission denied"
--   --    e un link vero  https://xenora.it/g/<codice>  deve ancora aprirsi; uno inesistente deve dare la pagina "Link non valido".
--   --    creare un link corto nuovo dal gestionale (pulsante di invio guida/check-in) deve funzionare.
--   -- 2) select has_table_privilege('anon','public._xn_sim_clean_entities_20261021','select');            → false
--   -- 3) select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   --      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;                           → nessuna riga
--   -- 4) select polname from pg_policy where polrelid='public.organizations'::regclass;                   → solo org_insert, org_select
--   -- 5) select has_function_privilege('anon','public.ws_get(text[])','execute');                         → false
--   --    get_advisors(security): scompaiono rls_disabled_in_public e gli avvisi anon_security_definer per le funzioni sopra.
--   -- 6) Con un account di prova: login, apertura calendario, salvataggio di una prenotazione, invio di un link guida → tutto invariato.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- OPZIONALI (NON attivi: richiedono una tua decisione)
--   a) Se le copie di prova non servono più, eliminarle invece di proteggerle:
--        drop table public._xn_sim_clean_entities_20261021, public._xn_sim_clean_app_state_20261021;
--      Le copie di backup (_xn_backup_*, _xn_f3_*, app_state_backup_*) contengono dati VERI di tutti gli account: tenerle solo finché servono
--      al paracadute della Fase 3, poi esportarle fuori dal database e cancellarle.
--   b) Indice duplicato su channex_map (avviso duplicate_index), prestazioni: drop index public.channex_map_tenant_idx;
--   c) Bucket pubblico email-assets senza limite di dimensione né di tipo:
--        update storage.buckets set file_size_limit = 2097152, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'] where id = 'email-assets';
-- ════════════════════════════════════════════════════════════════════════════════════════════════
