# Database SpigoleStay

Schema **non ancora applicato** su Supabase (il progetto Supabase verrà creato quando decidi tu — costo 10 $/mese).
Questi file sono pronti da eseguire in ordine.

## Ordine di applicazione (migration)

1. `migrations/0001_init.sql` — estensioni, enum, tenancy, helper RLS
2. `migrations/0002_inventory.sql` — gruppi, strutture, tipologie, unità
3. `migrations/0003_guests_bookings.sql` — ospiti, prenotazioni, vincolo anti-sovrapposizione
4. `migrations/0004_folio.sql` — registro contabile + regole tassa soggiorno
5. `migrations/0005_rates.sql` — tariffe e restrizioni
6. `migrations/0006_channels.sql` — connettività Channex
7. `migrations/0007_housekeeping.sql` — pulizie
8. `migrations/0008_views.sql` — viste metriche (netto, ADR)

Poi il seed di sviluppo: `seed.sql`.

## Come si applica (quando il progetto Supabase esiste)

- Via connettore MCP Supabase: ogni file come `apply_migration`, il seed come `execute_sql`.
- Oppure con la CLI: `supabase db push` + `supabase db seed`.

## Note

- **Multi-tenant**: ogni tabella ha `tenant_id` + RLS attiva. In Fase 1 la tabella `tenants` ha una sola riga.
- **RLS**: `current_tenant_id()` legge il claim JWT `app_metadata.tenant_id` (veloce) con fallback su `profiles`. Per usare il claim JWT va configurato un *Custom Access Token Hook* su Supabase; senza, funziona comunque via `profiles`.
- **Owner vs cleaner**: l'addetta pulizie vede solo `units` (lettura) e `housekeeping_tasks`; niente folio, prezzi, ospiti.
- **Seed**: le strutture sono **placeholder da confermare**. Il profilo owner si collega dopo la registrazione reale (vedi commento in `seed.sql`).
