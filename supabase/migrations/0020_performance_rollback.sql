-- Rollback di 0020_performance.sql. Sicuro: toglie solo ciò che 0020 ha aggiunto (nessun dato dell'app).
-- La parte B (indici) va tolta con istruzioni singole, fuori da transazioni:
drop index concurrently if exists public.documents_counterpart_idx;
drop index concurrently if exists public.documents_related_idx;
drop index concurrently if exists public.invoiced_folio_document_idx;
drop index concurrently if exists public.alloggiati_schedine_submission_idx;
drop index concurrently if exists public.organizations_owner_idx;
drop index concurrently if exists public.public_guides_owner_idx;
-- B7 (indice doppio tolto): per rimetterlo:
--   create index concurrently if not exists channex_map_tenant_idx on public.channex_map (tenant_id);

-- Parte A (da eseguire in transazione, dopo aver spento WATCHDOG_ENABLED):
-- begin;
-- drop table if exists public.watchdog_state;
-- commit;
