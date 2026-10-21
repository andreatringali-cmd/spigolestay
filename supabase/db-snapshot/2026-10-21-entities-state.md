# Stato del database prima della Fase 3 (letto dal database di produzione il 21/10/2026, sola lettura)

Serve a tracciare nel progetto ciò che finora viveva solo nel database. Le definizioni complete delle funzioni sono state lette con `pg_get_functiondef`.

## Tabella `public.entities` (copia per riga di strutture, tipologie, camere, prenotazioni, ospiti, recensioni dirette, eventi)
Colonne: owner_type char(1) not null ('u' = utente, 'o' = organizzazione), owner_id uuid not null, kind text not null, id text not null, structure_id text, data jsonb not null,
updated_ms bigint not null, check_in date, check_out date, status text, channel text, synced_at timestamptz not null.
Chiave primaria: (owner_type, owner_id, kind, id).
Indici: entities_bk_window_idx (owner_type, owner_id, check_out) where kind='bookings'; entities_bk_struct_idx (owner_type, owner_id, structure_id, check_in) where kind='bookings'; entities_kind_idx (owner_type, owner_id, kind).
RLS attiva. Policy `entities_read` (SELECT): (owner_type='u' and is_ws_tenant(owner_id)) or (owner_type='o' and is_org_member(owner_id)). Nessuna policy di scrittura: scrivono solo le funzioni SECURITY DEFINER.

## Trigger
- app_state: trg_snapshot_app_state → snapshot_app_state; entities_sync_app → entities_trg_app
- org_state: trg_snapshot_org_state → snapshot_org_state; entities_sync_org → entities_trg_org

## Funzioni
- entities_sync_row(p_owner, p_type, p_blob, p_old): per ogni collezione tra structures, roomTypes, units, bookings, guests, directReviews, events riscrive le righe (upsert con confronto del contenuto) e cancella quelle non più presenti; errori in entities_sync_errors, mai bloccante.
- entities_verify() / entities_verify_run(): confronto blob/tabella per proprietario e tipo; il log va in entities_verify_log (cron notturno 03:15 UTC).
- snapshot_app_state() / snapshot_org_state(): copiano la riga vecchia nello storico (ultime 30 versioni) e scartano un aggiornamento che svuota dati reali (app_state_realcount = strutture + prenotazioni + ospiti di data:v1); incrementano rev.

## Non ancora nelle tabelle
rateOverrides, activities, _deleted (lapidi), _deletedLeads. Nessuna colonna per unit_id, ota_code, guest_id, group_id.

## Copie di sicurezza create il 21/10/2026
_xn_f3_app_state_20261021, _xn_f3_org_state_20261021, _xn_f3_entities_20261021 (RLS attiva, confrontate con l'impronta md5).
