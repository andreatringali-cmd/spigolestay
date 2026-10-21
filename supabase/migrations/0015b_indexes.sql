-- 0015b_indexes.sql  (Fase 3, passo 0: indici sulle colonne nuove di public.entities)
--
-- NON ANCORA APPLICATA. Da eseguire DOPO 0015_entities_complete.sql e DOPO il popolamento
-- (select public.entities_backfill_extra(2000) finche' "done": true): costruire gli indici a tabella gia' popolata
-- e' un solo passaggio e gli UPDATE del popolamento restano HOT (nessuna colonna indicizzata cambia).
--
-- ATTENZIONE: CREATE INDEX CONCURRENTLY NON puo' stare in una transazione.
--   - NON passare questo file a apply_migration (la avvolge in una transazione) e NON usare `supabase db push`.
--   - Eseguire UNA istruzione per volta (una chiamata di execute_sql / un "Run" dell'editor SQL per ogni CREATE).
--   - Se un'esecuzione viene interrotta lascia un indice INVALIDO: `if not exists` lo salterebbe. Controllare con la
--     query in fondo e, se serve, `drop index concurrently <nome>;` e rieseguire quel CREATE.
-- Su ~17-70 mila righe ogni indice impiega meno di qualche secondo; le scritture non vengono bloccate.

-- (1) ricerca per codice OTA / codice prenotazione dentro un proprietario
create index concurrently if not exists entities_bk_ota_idx
  on public.entities (owner_type, owner_id, ota_code)
  where kind = 'bookings';

-- (2) disponibilita' / sovrapposizioni per unita' e date
create index concurrently if not exists entities_bk_unit_idx
  on public.entities (owner_type, owner_id, unit_id, check_in, check_out)
  where kind = 'bookings';

-- (3) prenotazioni di un ospite
create index concurrently if not exists entities_bk_guest_idx
  on public.entities (owner_type, owner_id, guest_id)
  where kind = 'bookings';

-- (4) camere di un gruppo
create index concurrently if not exists entities_bk_group_idx
  on public.entities (owner_type, owner_id, group_id)
  where kind = 'bookings' and group_id is not null;

-- (5) AGGIUNTA rispetto alla richiesta: idempotenza degli import (extId "channex:..." / UID iCal)
create index concurrently if not exists entities_bk_ext_idx
  on public.entities (owner_type, owner_id, ext_id)
  where kind = 'bookings' and ext_id is not null;

-- Controllo: deve restituire 5 righe, tutte con valido = true
-- select c.relname as indice, i.indisvalid as valido, i.indisready as pronto, pg_size_pretty(pg_relation_size(c.oid)) as dimensione
--   from pg_index i join pg_class c on c.oid = i.indexrelid
--  where i.indrelid = 'public.entities'::regclass and c.relname like 'entities_bk_%_idx' order by 1;
