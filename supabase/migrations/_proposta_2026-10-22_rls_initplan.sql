-- PROPOSTA (non numerata, NON applicata): protezione di riga più veloce sulle tabelle lette direttamente dal browser.
-- Misure: docs/PRESTAZIONI.md §3. Rollback in fondo a questo file. Decide il titolare.
--
-- PROBLEMA MISURATO (21/10/2026, sola lettura, in una transazione chiusa con ROLLBACK, con il ruolo `authenticated` e l'id del titolare):
--   select booking_id, stato from istat_rows;     → 196 righe, 1362 blocchi letti, 46,6 ms   (la funzione is_ws_tenant() viene chiamata UNA VOLTA PER RIGA,
--   e ogni chiamata fa un giro su access_allowlist + auth.users + profiles tramite workspace_owner()).
--   Con il confronto «valutato una volta sola» (select auth.uid()) la stessa lettura costa ~3 ms (108 blocchi): circa 15 volte meno.
--   In produzione queste tabelle vengono lette ogni pochi secondi da ogni scheda aperta (pg_stat_statements: istat_rows e alloggiati_schedine
--   sono tra le 10 query che consumano più tempo totale, con 70-90 ms di media per una tabella di 200 righe). Cresce linearmente con le righe.
--
-- EQUIVALENZA (la sicurezza non cambia): is_ws_tenant(t) = (t = auth.uid() OR t = workspace_owner(auth.uid())).
-- Qui la stessa condizione è scritta con (select ...), che il database calcola UNA volta per richiesta invece che una per riga.
-- ALTER POLICY è atomica: non c'è un istante senza protezione. Il service role (server) ignora comunque la protezione di riga.
--
-- DA FARE PRIMA DI APPLICARE: prova con l'account di prova e con un account collaboratore (workspace_owner ≠ uid), poi una lettura di istat_rows,
-- alloggiati_schedine, documents e booking_events dall'app (pagina Adempimenti, Calendario, Fatture) e conferma che i numeri coincidono.
-- Dopo: ripetere le EXPLAIN (ANALYZE, BUFFERS) e controllare che i «blocchi» siano scesi.

begin;
set local lock_timeout = '3s';

alter policy istat_rows_ws on public.istat_rows
  using      (tenant_id = (select auth.uid()) or tenant_id = (select public.workspace_owner((select auth.uid()))))
  with check (tenant_id = (select auth.uid()) or tenant_id = (select public.workspace_owner((select auth.uid()))));

alter policy alloggiati_schedine_ws on public.alloggiati_schedine
  using      (tenant_id = (select auth.uid()) or tenant_id = (select public.workspace_owner((select auth.uid()))))
  with check (tenant_id = (select auth.uid()) or tenant_id = (select public.workspace_owner((select auth.uid()))));

alter policy documents_ws on public.documents
  using      (tenant_id = (select auth.uid()) or tenant_id = (select public.workspace_owner((select auth.uid()))))
  with check (tenant_id = (select auth.uid()) or tenant_id = (select public.workspace_owner((select auth.uid()))));

alter policy booking_events_ws on public.booking_events
  using      (tenant_id = (select auth.uid()) or tenant_id = (select public.workspace_owner((select auth.uid()))))
  with check (tenant_id = (select auth.uid()) or tenant_id = (select public.workspace_owner((select auth.uid()))));

-- Verifica nello stesso blocco: le quattro policy devono contenere «auth.uid()» e NON più «is_ws_tenant».
-- (se l'esito non è quello atteso: ROLLBACK al posto di COMMIT)
select tablename, policyname, qual like '%is_ws_tenant%' as ancora_vecchia
  from pg_policies where schemaname='public' and policyname in ('istat_rows_ws','alloggiati_schedine_ws','documents_ws','booking_events_ws');

commit;

-- ─────────────────────────── ROLLBACK (riporta la forma originale) ───────────────────────────
-- begin;
-- alter policy istat_rows_ws         on public.istat_rows         using (is_ws_tenant(tenant_id)) with check (is_ws_tenant(tenant_id));
-- alter policy alloggiati_schedine_ws on public.alloggiati_schedine using (is_ws_tenant(tenant_id)) with check (is_ws_tenant(tenant_id));
-- alter policy documents_ws          on public.documents          using (is_ws_tenant(tenant_id)) with check (is_ws_tenant(tenant_id));
-- alter policy booking_events_ws     on public.booking_events     using (is_ws_tenant(tenant_id)) with check (is_ws_tenant(tenant_id));
-- commit;
--
-- NON incluse (valutare dopo): le altre ~20 policy con is_ws_tenant (cassa, fatture, forniture) hanno tabelle vuote; la policy entities_read
-- (letture client delle tabelle entities) va riscritta insieme alla Fase 3, perché mescola is_ws_tenant e is_org_member.
