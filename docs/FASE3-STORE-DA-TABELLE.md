# Fase 3: lo «store» dei lettori e degli scrittori costruito dalle tabelle (spento di default)

Stato: **codice pronto, nessun proprietario passato alle tabelle, nessuna migrazione applicata.** Con `SERVER_WRITE_ENTITIES` spenta (o assente) il comportamento dell'app è identico a prima, senza nemmeno una chiamata in più al database.

## Il problema

Quando per un proprietario (`u` = `app_state`, `o` = `org_state`) e un tipo (`bookings`, `structures`, `guests`, ...) la tabella `public.entity_authority` dice `table`, il blocco `spigolestay:data:v1` **non contiene più** quella collezione (è `[]`). Tutto il codice server che per trovare una prenotazione o una struttura scandisce il blocco non troverebbe più nulla: guest page «non trovata», pagamenti che non partono, disponibilità calcolata su un elenco vuoto.

## Come funziona

Modulo nuovo: `src/lib/server-entities-store.ts`.

- `tableKindsOf(admin, owner, kinds)`: **una sola** richiesta a `entity_authority` (`.in("kind", ...)`) che dice quali tra i tipi richiesti sono `table` per quel proprietario.
- `readKindsFromTables` / `overlayTableKinds` / `withTableKinds`: restituiscono una **copia** dei dati del blocco in cui le collezioni `table` sono lette da `public.entities` (stesso formato di `buildBlockData`) al posto di quelle (vuote) del blocco. Le altre collezioni e le chiavi del blocco restano com'erano. Uno store **misto** è normale: per esempio `bookings` dalla tabella e `units`/`roomTypes` dal blocco.
- Senza tipi `table` restituiscono **lo stesso oggetto ricevuto**: nessuna lettura, nessuna copia.

Regola d'oro (la stessa degli scrittori): l'autorità si guarda **solo con `SERVER_WRITE_ENTITIES=on`**. Con l'interruttore spento non c'è alcuna chiamata, nemmeno a `entity_authority`. È indipendente da `SERVER_READ_ENTITIES`: se la verità è la tabella, leggere il blocco darebbe un risultato sbagliato in qualunque modalità di lettura (in `compare` il risultato «del blocco» include già i tipi `table`, quindi il confronto non segnala falsi `diff`).

### Cosa è coperto

| Punto | Come |
|---|---|
| `scan()` in `manage-booking.ts` (usata da `findBookingStore`, `findBookingStoreById`, `findBookingStoreForTenant`, anche nel ramo da tabelle di `SERVER_READ_ENTITIES=on`) | legge la riga del blocco (serve `rev` e le chiavi piatte), poi per i tipi `table` (`bookings`, `structures`, `roomTypes`, `units`, `guests`) sostituisce le collezioni con quelle delle tabelle. Se `bookings` è `table` controlla prima con UNA lettura per id che la prenotazione sia di quel proprietario (non si caricano le collezioni degli altri proprietari scorsi nel ciclo). `store.data.bookings` contiene **tutte** le prenotazioni del proprietario (gruppi, disponibilità, quote), come nel blocco di prima |
| `findBookingStoreById` in modalità blocco (`SERVER_READ_ENTITIES` spenta/compare) | dopo la scansione dei blocchi, solo se `SERVER_WRITE_ENTITIES=on`, cerca l'id in `entities` (`findBookingsById`) e rilegge il proprietario trovato con `scan`. Stesso tetto alle ricerche fallite di sempre (oltre il tetto non si fa nemmeno questa ricerca). Il risultato entra nella cache da 10 minuti |
| `loadOrgData`, `loadOrgDatas`, `loadTenantData` (`concierge-orgdata.ts`) | ramo «blocco» con i tipi `table` dalle tabelle (le cinque collezioni di `MERGE_KINDS`). Quindi anche Alloggiati/ISTAT, concierge/ask, pulizie-plan, WhatsApp e messaggi Channex per la parte org |
| `loadOwnerStructureData`, `loadOrgDataParts`, `findOwnerStructure` (`server-booking-guard.ts`) | idem (strutture, tipologie, camere, prenotazioni) |
| Scrittura sul blocco con uno store che ha tipi `table` (`mutateStore`, percorso blocco) | le collezioni lette dalle tabelle **non finiscono mai nel blocco**: si riscrive il blocco con quelle collezioni com'erano (`store.blockData`). Se la funzione di scrittura le ha modificate, la scrittura è rifiutata (`false`, log `[store-from-tables]`): per modificarle serve la via delle tabelle |
| Scrittori **non migrati** (`mutateStore` senza opzioni, oggi `/api/checkin`) | `mutateBookingScope` ora controlla l'autorità anche di `structures`, `roomTypes`, `units`, `guests`: se uno qualsiasi è `table` rifiuta (`writer_not_migrated`, `handled:true, ok:false`) invece di far lavorare la funzione su un blocco senza quei dati (importi sbagliati senza errore) |

### Comportamento in caso di errore

- **Autorità illeggibile, interruttore acceso, lettori:** come oggi, si usa il blocco (nessuna eccezione).
- **Autorità illeggibile, interruttore acceso, scrittori:** *fail-closed*. `patchEntity`, `mutateBookingScope`, `mutateEntitySet` rispondono `read_error` / `outcome:"error"` e **non scrivono né le tabelle né il blocco**. Il chiamante lo tratta come un conflitto di scrittura: i webhook di Stripe rispondono con errore e Stripe ritenta (prima, in questo caso, il rimborso sarebbe stato scritto nel blocco di un proprietario `table` o perso con 200). La tabella `entity_authority` **assente** non è un errore: vuol dire che nessuno è `table`.
- **Autorità `table` confermata ma tabelle `entities` illeggibili:** mai un ripiego sul blocco vuoto. `scan` → «non trovata» (nessuno scrittore parte); `loadOrgData` → `null` (org saltata); `loadOrgDatas` → org saltata; `loadTenantData` → il personale resta quello del blocco (log); `loadOwnerStructureData`/`findOwnerStructure` → `null`. `console.error` con prefisso `[store-from-tables]`.
- **Interruttore spento = fail-open per costruzione.** Se `SERVER_WRITE_ENTITIES` non è `on` nessuno guarda l'autorità. Quindi spegnere l'interruttore è sicuro **solo se nessun proprietario ha righe `table`** in `entity_authority`; con righe `table` e interruttore spento i lettori vedono il blocco vuoto e gli scrittori scrivono nel blocco (il trigger `XN002` della 0017b li rifiuta se la collezione non è vuota, ma il comportamento corretto è riportare prima a `blob`: vedi «Come si spegne»).

## Cosa NON è coperto (da fare prima di accendere un proprietario vero)

Letture del **blocco personale** che non passano dai loader sopra e che per un proprietario `table` non vedrebbero più i tipi migrati:

- `api/whatsapp/webhook`, `api/channex/webhook-messages` (la parte personale), `api/cron/pulizie-plan` e `api/concierge/ask` (la parte personale; l'org è coperta da `loadOrgDatas`), `api/pulizie/send-now`, `api/public-lead`, `api/public-review`, `api/stripe/book/confirm` e `api/public-booking` (leggono e **scrivono** il blocco: sono scrittori W1-W5, passi 3b-3d), `lib/quote-pay.ts` e `lib/chat-pay-server.ts` (parti personali), `lib/invoicing/service.ts`, `lib/calendar-feed.ts`/`api/calendar/feed`, `api/health`, `api/org/*`, `api/admin/account`, `api/channex/relink`/`sync`/`lib/channex-inbound.ts`, `api/cron/checkin-reminders` e `auto-messages` (spenti), `lib/stripe-guard.ts`, `lib/media-migrate*`, `api/metasearch/feed`, `api/xenorabook/*`, `api/sync/delta`.
- Il **browser** (sincronizzazione, `authsync`, `sync-delta`/`sync-window`): non toccato; un client vecchio che riscrive collezioni `table` nel blocco viene fermato dal database (`XN002`).
- Tipi diversi dai sette di `ENTITY_KINDS` e dagli extra del blocco (`rates` → `rateOverrides`, `activities`, `tombs`, `leadtombs`): `rateOverrides` e simili si leggono ancora dal blocco.
- `directReviews` e `events` con autorità `table`: `scan` e i loader non li ricompongono (non servono ai loro consumatori); `buildBlockData` sì, se richiesti.
- `/api/checkin` e `alloggiati/purge.ts` non migrati (altro lavoro): con `bookings`, `structures`, `guests`, `roomTypes` o `units` `table` il check-in dell'ospite risponde 409 «conflitto di scrittura».
- Costo: con `bookings` `table`, ogni `scan` riuscito carica **tutte** le prenotazioni del proprietario (a pagine da 1000). È l'equivalente di quello che faceva il blocco; per proprietari molto grandi conviene, in un passo successivo, passare ai soli gruppi/finestre.

## Come si accende (per UN proprietario di prova, esempio NON eseguito)

Prerequisiti: migrazioni 0017/0017b applicate, passo 3a già provato (`docs/FASE3-PASSO3A.md`), backup recente, account di prova mai il titolare, **nessun client vecchio che scrive il blocco per quell'account**.

1. `SERVER_WRITE_ENTITIES=on` su Vercel e nuovo deploy. Finché nessun proprietario ha righe `table` non cambia nulla se non UNA lettura in più di `entity_authority` per proprietario scorso (`scan`, loader): verificare nei log che non ci siano errori `[store-from-tables]`.
2. Segnare l'autorità (ricetta del piano 0017 §3: stessa transazione che svuota il blocco), un tipo alla volta, partendo da `bookings` + `structures` + `guests` dell'account di prova.
3. Provare: pagina `/gestisci` (apertura, annulla, modifica), pagamento con link in chat (anche gruppo di camere), rimborso di prova Stripe test, richiesta di recensione, link di check-in (atteso 409 finché `/api/checkin` non è migrato), Alloggiati/ISTAT in modalità di prova, risposta del concierge.
4. Controllare i log: nessun `[store-from-tables]` e nessun `read_error`/409 continuo; `entities_sync_errors` vuota; il blocco di quel proprietario non cambia per i tipi migrati.

## Come si spegne

- **Per un proprietario:** ricostruire il blocco dalle tabelle e riportare l'autorità a `blob` (ricetta A del piano 0017 §4: `entities_export_to_blob` + cancellare la riga di `entity_authority`, nella stessa transazione). Solo dopo, se serve, spegnere l'interruttore.
- **Per tutti:** togliere `SERVER_WRITE_ENTITIES` (o ≠ `on`) e rifare il deploy. **Sicuro solo se nessun proprietario ha righe `table`**: con l'interruttore spento l'autorità non viene più letta, quindi i lettori tornano al blocco (vuoto per i tipi migrati) e gli scrittori scrivono il blocco. Spegnere l'interruttore **non** riporta indietro i dati scritti nelle tabelle.

## Test

`tests/server-entities-store.test.ts` (client finto, nessun database): interruttore spento senza nemmeno una chiamata a `entity_authority`/`entities`; riga assente, `blob`, tabella assente, errore e eccezione nel leggere l'autorità; `bookings`+`structures`+`guests` `table` con blocco svuotato (personale, organizzazione, store misto); `findBookingStore`, `findBookingStoreById` (blocco, `on`, `compare` senza `diff`, cache), `findBookingStoreForTenant`; tabelle illeggibili; scrittori che scrivono le righe senza toccare il blocco; scrittore non migrato che rifiuta con qualunque tipo `table`; store misto che non rimette mai le collezioni delle tabelle nel blocco (anche dopo un conflitto di `rev`); loader `loadOrgData`/`loadOrgDatas`/`loadTenantData` e quelli di `server-booking-guard`; scrittori in fail-closed con autorità illeggibile (`patchEntity`, `mutateBookingScope`, `mutateEntitySet`, `writeBookingPatch`, `mutateStore`, `markReviewRequested`, `reconcileCharge`). In `tests/server-entities-write.test.ts` è stato aggiornato il test sull'errore di lettura dell'autorità (ora `read_error`).
