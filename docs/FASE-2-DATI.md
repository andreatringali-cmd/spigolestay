# Architettura dati — Fase 2 dell'audit (tabelle vere, lettura a finestra)

Problema: il browser tiene una copia dell'intero archivio (~4,8 milioni di caratteri) e su alcuni dispositivi non regge.
Soluzione: prenotazioni, ospiti, camere… su tabelle vere sul server, l'app scarica solo una finestra di date.

## Fase 1 — copia ombra (FATTA il 16/10/2026)
- Tabella `public.entities` (una riga per entità: `owner_type` u/o, `owner_id`, `kind`, `id`, `data` jsonb + colonne per le finestre di date: `check_in`, `check_out`, `status`, `channel`, `structure_id`, `updated_ms`).
- Un trigger su `app_state` e `org_state` replica ogni scrittura del blob (anche quelle dei webhook server) nella tabella; salta le collezioni invariate; mai bloccante (errori in `entities_sync_errors`).
- L'app NON legge ancora dalla tabella: continua con i blob come prima.
- Controllo: `entities_verify()` / `entities_verify_run()` confrontano blob e tabella (mancanti / in più / diversi). Cron notturno `/api/cron/entities-verify` (03:15 UTC), risultati in `entities_verify_log`.
- Baseline 16/10: 16.200 entità, 0 differenze, 0 errori.
- Criterio per passare alla Fase 2: almeno 3 notti consecutive con `ok: true` e `entities_sync_errors` vuota.

## Fase 2 — lettura a finestra (da fare)
- API server che legge `entities` per finestra (prenotazioni con check_out ≥ oggi−90 giorni, o prossime), ospiti collegati, camere, strutture.
- Storico (statistiche, ricerca ospite vecchio) su richiesta.
- Scrittura: a livello di singola entità (upsert con updated_ms), niente più blob intero.

## Fase 3 — pulizia (da fare)
- Via il blocco grande da IndexedDB, merge a 3 vie e lapidi. Test da telefono e computer.
