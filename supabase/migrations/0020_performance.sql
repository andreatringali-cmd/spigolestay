-- 0020_performance.sql — azioni SICURE per prestazioni e allarmi (NON APPLICATA: aspetta l'ok del titolare).
-- Misure e motivazioni: docs/PRESTAZIONI.md. Rollback: 0020_performance_rollback.sql.
--
-- Come si usa (in ordine):
--   PARTE A  (qui sotto, NON commentata): si può applicare per intero con apply_migration / editor SQL. È una tabellina nuova e vuota,
--            non tocca nessun dato esistente. Serve all'allarme (/api/cron/watchdog) per ricordare l'ultima email inviata.
--   PARTE B  (commentata): indici da creare con CREATE INDEX CONCURRENTLY. CONCURRENTLY NON funziona dentro una transazione e quindi NON con
--            apply_migration: ogni istruzione va incollata e lanciata DA SOLA nell'editor SQL di Supabase (una per volta), poi si controlla che l'indice
--            risulti valido (query di controllo in fondo). Sono tutte tabelle piccole: ogni creazione dura meno di un secondo.
--   Il file _proposta_2026-10-22_rls_initplan.sql (a parte) riguarda la lettura diretta dal browser: va deciso a parte.

-- ═════════════════════════ PARTE A — tabella di servizio dell'allarme (transazionale, sicura) ═════════════════════════
begin;
set local lock_timeout = '3s';

create table if not exists public.watchdog_state (
  key          text        primary key,          -- tipo di problema (es. verify_late, db_down, sync_errors)
  last_sent_at timestamptz,                      -- ultima email inviata per quel tipo di problema
  updated_at   timestamptz not null default now()
);
alter table public.watchdog_state enable row level security;   -- nessuna policy: nessun accesso da anon/authenticated
revoke all on public.watchdog_state from public, anon, authenticated;
grant select, insert, update on public.watchdog_state to service_role;
comment on table public.watchdog_state is 'Stato dell''allarme /api/cron/watchdog: una email ogni 6 ore per tipo di problema. Migrazione 0020. Solo service role.';

commit;

-- ═════════════════════════ PARTE B — indici (DA ESEGUIRE UNO PER VOLTA, fuori da transazioni) ═════════════════════════
-- Perché: 17 chiavi esterne senza indice (avviso «unindexed_foreign_keys» di Supabase). Oggi le tabelle sono vuote o minuscole e non c'è alcun effetto
-- visibile; diventano utili quando le righe crescono (cancellare/aggiornare una riga «padre» costringe il database a scorrere tutta la tabella «figlia»).
-- Nessuna di queste tabelle è sul percorso delle richieste frequenti: priorità BASSA, da fare con calma e prima dell'apertura ai clienti.
-- Ognuna è IF NOT EXISTS: rilanciarla non fa danni.
--
-- B1. documents.counterpart_id (fatture → controparte)
--   create index concurrently if not exists documents_counterpart_idx on public.documents (counterpart_id);
-- B2. documents.related_document_id (note di credito → fattura originale)
--   create index concurrently if not exists documents_related_idx on public.documents (related_document_id) where related_document_id is not null;
-- B3. invoiced_folio.document_id
--   create index concurrently if not exists invoiced_folio_document_idx on public.invoiced_folio (document_id);
-- B4. alloggiati_schedine.submission_id (schedina → invio)
--   create index concurrently if not exists alloggiati_schedine_submission_idx on public.alloggiati_schedine (submission_id) where submission_id is not null;
-- B5. organizations.owner_id (strutture condivise per proprietario)
--   create index concurrently if not exists organizations_owner_idx on public.organizations (owner_id);
-- B6. public_guides.owner_id
--   create index concurrently if not exists public_guides_owner_idx on public.public_guides (owner_id);
--
-- B7. (facoltativa, pulizia) indice DOPPIO su channex_map: channex_map_tenant_idx e channex_map_tenant_id_idx sono identici; se ne tiene uno solo.
--   drop index concurrently if exists public.channex_map_tenant_idx;
--
-- NON inclusi di proposito:
--  - gli indici parziali su entities (entities_bk_struct_idx, _unit_, _ext_, _group_, ...) risultano «mai usati» perché le LETTURE dalle tabelle entities
--    non sono ancora attive (Fase 3): serviranno. Toglierli ora per poi doverli ricreare su 50.000 righe sarebbe un errore. Da rivalutare dopo 30 giorni di Fase 3 attiva.
--  - gli indici delle tabelle fatture/forniture «mai usati»: le tabelle sono ancora vuote; sono la dotazione normale di un modulo non ancora in uso.
--  - gli indici su istat_rows/alloggiati_schedine: le tabelle hanno ~200 righe e l'indice (tenant_id, arrival) esiste già; il collo di bottiglia lì NON è l'indice
--    ma la funzione di protezione di riga (vedi _proposta_2026-10-22_rls_initplan.sql).
--
-- Controllo dopo ogni indice (deve restituire indisvalid = true):
--   select c.relname, i.indisvalid, i.indisready from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname like 'documents\_%idx' escape '\' or c.relname in ('invoiced_folio_document_idx','alloggiati_schedine_submission_idx','organizations_owner_idx','public_guides_owner_idx');
-- Se un indice risulta invalido (interruzione a metà): drop index concurrently <nome>; e rilanciare la creazione.
