# Fase 3, passo 3a: scrittori del server a riga singola (spenti di default)

Stato: **codice pronto, spento, nessun proprietario passato alle tabelle**. Oggi il comportamento dell'app è identico a prima: tutte le scritture vanno ancora nel blocco (`app_state` / `org_state`, chiave `spigolestay:data:v1`).

## Che cosa è pronto

Un modulo nuovo, `src/lib/server-entities-write.ts`, che sa aggiornare **una singola riga** di `public.entities` (o poche righe, come le camere di un gruppo) con controllo di concorrenza. Lo usano i punti di scrittura del server che toccano una prenotazione.

**Doppio interruttore.** L'helper scrive nelle tabelle solo se sono vere entrambe le cose:

1. la variabile d'ambiente `SERVER_WRITE_ENTITIES` vale `on` (spenta = nessuna chiamata al database, nemmeno per leggere l'autorità);
2. per quel proprietario e quel tipo di entità la tabella `public.entity_authority` (migrazione 0017, agente A) dice `authority = 'table'`.

In tutti gli altri casi (interruttore spento, tabella `entity_authority` inesistente, riga assente, valore `blob` o sconosciuto) l'helper **non scrive nulla** e risponde `{ handled: false }`: il chiamante prosegue sul blocco, esattamente come oggi. **Eccezione, fail-closed:** con l'interruttore acceso, se la lettura dell'autorità dà un errore o un'eccezione (non la tabella assente) l'helper risponde `{ handled: true, ok: false, error: "read_error" }` e il blocco NON viene scritto (aggiornato nel lavoro «store da tabelle», vedi `docs/FASE3-STORE-DA-TABELLE.md`).

**Concorrenza.** Ogni riga ha `updated_ms` (= `updatedAt` dell'entità). La scrittura è `UPDATE ... WHERE updated_ms = <valore letto>`: se nel frattempo qualcuno ha scritto, non succede nulla (conflitto) e l'helper rilegge e riapplica la modifica su dati freschi, fino a 3 tentativi. Il nuovo `updated_ms` è sempre strettamente maggiore del precedente. Con `expectUpdatedMs` il chiamante può pretendere una versione precisa (conflitto = errore chiaro, nessun nuovo tentativo). Le colonne di comodo (`structure_id`, `check_in`, `check_out`, `status`, `channel`, `synced_at`) sono ricalcolate dal dato come fa il trigger blocco → tabella; `unit_id`, `guest_id`, `group_id`, `ota_code` le ricalcola il trigger `entities_bk_cols_trg` (0015).

**Errori.** L'helper non lancia mai. Se l'autorità non si riesce a leggere (interruttore acceso) → `read_error`, senza scrivere il blocco. Se l'autorità è già confermata `table` e la scrittura fallisce → `{ handled:true, ok:false, error }` (`conflict`, `not_found`, `read_error`, `write_error`, `unsupported_shape`, `writer_not_migrated`): **non** si ricade sul blocco, perché per quel proprietario il blocco non è più la verità e si creerebbero due versioni. Il chiamante lo tratta come un normale conflitto di scrittura (i webhook di Stripe ritentano).

## Quali scrittori sono coperti

| Scrittore (inventario) | Dove | Come |
|---|---|---|
| W6 annulla / modifica prenotazione dell'ospite | `writeBookingPatch` in `src/lib/manage-booking.ts` (usata da `manage-booking/cancel` e `modify`) | `patchEntity` con `patch`, prima del percorso attuale |
| W6/W9 pagamento al check-in, pagamento in chat (anche gruppi di camere) | `mutateStore` in `manage-booking.ts`, con l'opzione `{ tables: "scope" }` passata da `checkin-pay.ts` e `chat-pay-server.ts` | `mutateBookingScope`: la funzione riceve `bookings` (la camera + le altre camere del gruppo) e `structures`, e si scrivono solo le righe cambiate |
| W8 rimborsi e dispute Stripe | `patchOnce` in `src/lib/stripe-reconcile.ts` | `mutateEntitySet` (le prenotazioni che citano il payment intent) |
| W10 «richiesta recensione inviata» | `markReviewRequested` in `src/lib/auto-trace.ts` | `patchEntity` con `mutate` (thread e registro invii restano nel blocco: sono chiavi piatte) |

**Scrittore non ancora migrato = si rifiuta, non scrive il blocco.** `mutateStore` chiamato senza opzioni (oggi: `/api/checkin`, che oltre alla prenotazione aggiorna l'anagrafica ospite e calcola le foto da cancellare guardando tutti i dati) con autorità `table` risponde `writer_not_migrated` e non tocca il blocco. Dà un 409 «conflitto di scrittura» invece di far divergere i dati in silenzio.

## Che cosa NON è coperto (da fare prima di accendere un proprietario vero)

- **W11 purge foto documento** (`src/lib/alloggiati/purge.ts`): cancella anche i file dallo Storage guardando se altre prenotazioni li usano ancora; sulle tabelle serve una ricerca per riferimento. Con autorità `table` oggi non farebbe nulla (il blocco non contiene più le prenotazioni): le foto resterebbero. Da migrare insieme al check-in.
- **W14 media-migrate**: una tantum, a mano, su tutte le righe; non è a riga singola. Non toccato.
- `/api/checkin` (vedi sopra), W1, W2, W3, W4, W5, W12, W13: passi 3b-3d.
- **Caricamento dello store.** Risolto in `docs/FASE3-STORE-DA-TABELLE.md`: `findBookingStore*` e i caricatori dei lettori ricompongono i dati dalle tabelle per i tipi con autorità `table`.
- Le scritture a più righe (camere di un gruppo) **non sono una transazione**: se una riga va in conflitto, quelle già scritte vengono rimesse com'erano (anch'esse con controllo), ma una funzione SQL atomica resta la soluzione definitiva (passo 3c).

## Come si accende per UN proprietario di prova (esempio, NON eseguito)

Prerequisiti: migrazione 0017 applicata (tabella `entity_authority`, protezioni, `entities_export_to_blob`), un backup recente, un account di prova (mai il titolare).

1. Controllare che la copia sia allineata (nessuna riga in `entities_sync_errors`, `entities_verify_run` ok).
2. Tenere a portata di mano il paracadute: `select entities_export_to_blob('<uid>', 'u');` (nome e firma esatti: vedi il piano 0017).
3. Segnare l'autorità, un solo tipo alla volta, iniziando da `bookings`:

```sql
-- ESEMPIO, da eseguire solo dopo il via libera. <uid> = utente di prova.
insert into public.entity_authority (owner_type, owner_id, kind, authority)
values ('u', '<uid>', 'bookings', 'table')
on conflict (owner_type, owner_id, kind) do update set authority = 'table';
```

4. Su Vercel impostare `SERVER_WRITE_ENTITIES=on` e rifare il deploy.
5. Provare con l'account di prova: annullare una prenotazione dalla pagina ospite, fare un pagamento di prova in modalità test di Stripe, un rimborso di prova, una richiesta di modifica.

## Come si spegne

- **Subito, per tutti:** `SERVER_WRITE_ENTITIES` tolta (o diversa da `on`) e nuovo deploy. Da quel momento nessuno scrittore guarda più le tabelle.
- **Per un proprietario:** riportare l'autorità a `blob`, dopo aver ricostruito il blocco dalle tabelle:

```sql
-- ESEMPIO, NON eseguito.
select entities_export_to_blob('<uid>', 'u');   -- ricostruisce il blocco (firma da confermare con la 0017)
update public.entity_authority set authority = 'blob'
 where owner_type = 'u' and owner_id = '<uid>' and kind = 'bookings';
```

Importante: spegnere solo l'interruttore **non** riporta indietro le scritture già fatte nelle tabelle. Le modifiche fatte mentre l'autorità era `table` stanno solo lì: prima di tornare a `blob` serve l'export verso il blocco.

## Che cosa controllare dopo l'accensione

- Nei log di Vercel: righe `[entities-write]` (compaiono solo se un ripristino di gruppo fallisce) e risposte 409 `write_conflict` sulle route di pagamento/check-in: poche e occasionali sono normali, una serie continua no.
- Sul proprietario di prova: `select id, updated_ms, data->>'paid' from entities where owner_id = '<uid>' and kind = 'bookings'` coerente con l'app; `updated_ms` sempre cresciuto dopo ogni azione.
- Il blocco di quel proprietario **non** deve più cambiare per le prenotazioni (solo chiavi piatte).
- `entities_sync_errors` e `entities_extra_errors` vuote; verifica notturna ok.
- Nessun doppio rimborso/pagamento: `paidSessions` e `stripeRefundedCents` sulla riga coerenti con la dashboard Stripe (modalità test).

## Test

`tests/server-entities-write.test.ts` (24 prove, client finto): interruttore spento senza nessuna chiamata al database; tabella `entity_authority` assente / riga assente / `blob` / errore di lettura = nessuna scrittura sulle tabelle e blocco scritto come sempre (annulla/modifica, pagamenti, riconciliazione Stripe, recensione); `table` = riga aggiornata, `updated_ms` crescente, colonne di comodo, conflitto intercettato e riapplicato, conflitto permanente = errore chiaro, gruppo di camere con ripristino, scrittore non migrato che rifiuta.
