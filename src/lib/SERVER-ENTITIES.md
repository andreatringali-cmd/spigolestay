# Lettura dalle tabelle (public.entities) lato server

Fase 3, passo 1. Il server può leggere strutture, tipologie, camere, prenotazioni, ospiti, recensioni dirette ed eventi dalla tabella `public.entities`
invece di scaricare i blocchi interi (`app_state` / `org_state`, chiave `spigolestay:data:v1`). **Solo letture**: le scritture restano al blocco
(il trigger blocco -> tabella tiene `entities` allineata). Il browser non cambia.

## Interruttore

Variabile d'ambiente `SERVER_READ_ENTITIES` (letta a ogni chiamata; su Vercel basta cambiarla e rifare il deploy, nessuna modifica al codice):

| Valore | Cosa succede |
|---|---|
| `off` (o assente, o qualunque altro valore) | Come prima: si legge solo il blocco. Nessuna chiamata a `entities`. |
| `compare` | Si legge il blocco come prima **e** le tabelle, si confrontano. Il risultato restituito è **sempre quello del blocco**: nessun effetto visibile. Le differenze vanno in console. |
| `on` | Il risultato è quello delle tabelle. Se la lettura delle tabelle dà errore si ripiega sul blocco (e lo si registra). |

## Come attivare

1. Vercel -> Settings -> Environment Variables -> `SERVER_READ_ENTITIES=compare` -> nuovo deploy.
2. Lasciare girare qualche giorno di traffico vero (webhook Stripe/Channex, cron pulizie ogni 10 minuti, Alloggiati 21:00 UTC, check-in degli ospiti).
3. Guardare i log (sotto). Quando per ogni punto non compaiono più `diff`/`error`, passare a `on`.

## Cosa guardare nei log

Ogni riga è `[entities-compare] {json}` con `label` (il punto: `loadOrgDatas`, `loadOrgData`, `loadTenantData`, `findBookingStoreById`,
`loadOwnerStructureData`, `loadOrgDataParts`, `findOwnerStructure`, `stripe-reconcile.lastResort`, `public-lead.guestLookup` e i punti «solo confronto» elencati più sotto) e `result`:

- `ok` (livello info): tutto uguale. Al massimo una riga ogni 10 minuti per punto.
- `diff` (warn): differenza. `colls.<collezione>` dà `block` / `tables` (conteggi), `onlyBlock` / `onlyTables` / `changed` (primi 10 id) e `fields`
  (campi diversi sulle prime tre modificate). Per i prezzi forzati `rates`. Per i valori semplici `block` / `tables` (JSON troncato).
- `error` (warn): la lettura delle tabelle è fallita in `compare`; il risultato del blocco è arrivato comunque.
- `fallback_to_block` (warn): in `on` la lettura delle tabelle è fallita e si è usato il blocco.

Ricerca nei log di Vercel: `[entities-compare]`; per i soli problemi `"result":"diff"`, `"result":"error"`, `"result":"fallback_to_block"`.
Una piccola differenza transitoria è normale se una scrittura arriva tra le due letture; una differenza che si ripete sullo stesso id no.

## Tornare indietro

Mettere `SERVER_READ_ENTITIES=off` (o toglierla) e rifare il deploy. Il codice torna a leggere solo il blocco, senza nessuna chiamata a `entities`.
Nulla è stato scritto nelle tabelle da questo passo, quindi non c'è niente da ripristinare.

## Cosa è migrato (solo letture)

- `concierge-orgdata.ts`: `loadOrgDatas`, `loadOrgData`, nuova `loadTenantData` (usata da Alloggiati Web e ISTAT); `mergeOrgData` invariata. Di conseguenza anche concierge/ask,
  cron pulizie-plan, whatsapp webhook e channex webhook-messages leggono le organizzazioni dalle tabelle con `on` (la parte personale la prendono ancora dal blocco, che leggono comunque per le chiavi piatte).
- `manage-booking.ts`: `findBookingStoreById` (niente più scansione di tutti i tenant: una ricerca per id + la sola riga del blocco, che serve alle scritture).
- `stripe-reconcile.ts`: l'«ultima risorsa» senza metadata cerca il payment intent in `entities`.
- `server-booking-guard.ts`: `loadOwnerStructureData`, `loadOrgDataParts`, `findOwnerStructure`.
- `api/public-lead`: solo confronto (`compare`) della ricerca ospite; la lettura è legata alla scrittura sul blocco, quindi `on` non la cambia.

## Lettori in SOLO CONFRONTO (seconda tornata, `src/lib/entities-shadow.ts`)

Questi punti leggono il blocco **sempre**, come prima, e il loro risultato non cambia mai. Solo con `SERVER_READ_ENTITIES=compare` leggono anche le tabelle,
confrontano e scrivono `[entities-compare]`. Con `off` **e con `on`** non fanno nulla (nessuna chiamata a `entities`): non sono ancora promossi, quindi passare a `on`
non li cambia. Per promuoverne uno basta sostituire la chiamata `shadow…` con `entitiesSwitch` (come in `concierge-orgdata.ts`) dopo aver visto `ok` per qualche giorno.
Ogni errore (tabelle, confronto, rete, dato malformato) viene catturato dentro la funzione e non arriva alla richiesta.

| `label` | Dove | Cosa si confronta | Limite di frequenza |
|---|---|---|---|
| `health.structureNames` | `api/health` | nomi (id -> nome) delle strutture personali | 1 al minuto per account |
| `calendar/feed.bookings`, `calendar/feed.pulizie` | `api/calendar/feed` (`shadowCalendarFeed` in `calendar-feed.ts`) | gli EVENTI iCal ricalcolati dalle tabelle (finestra: check-out dal giorno -60), per `uid` | 1 ogni 5 minuti per account e tipo |
| `admin/account.structures` | `api/admin/account` | strutture, tipologie, camere del personale e delle org possedute | nessuno (solo admin) |
| `org/access.firstStructure` | `api/org/access` | id, nome e numero della prima struttura dell'org (il blocco usa l'ordine dell'array, le tabelle il campo `order`: se l'org ha piu' strutture compare come `diff`) | nessuno |
| `org/members.resolveOwnerOrg`, `org/leave.orgOfStructure` | `api/org/members`, `api/org/leave` | in quale org (tra le membership, nello stesso ordine) sta la struttura | nessuno |
| `stripe-guard.userOwnsStripeAccount` | `lib/stripe-guard.ts` | `true/false`: il conto `acct_` e' in una struttura personale (se non esclusa dal `metadata.uid`) o di una sua org | nessuno |
| `concierge/ask.personal` | `api/concierge/ask` | le 5 collezioni del blocco personale (la parte org e' gia' coperta da `loadOrgDatas`) | 1 ogni 10 minuti per account |
| `pulizie-plan.personal` | `api/cron/pulizie-plan` | idem, per chi ha un invio in scadenza | 1 ogni 10 minuti per account |
| `pulizie/send-now.structure` | `api/pulizie/send-now` | solo la struttura richiesta: sue tipologie, camere, prenotazioni e gli ospiti di quelle prenotazioni | nessuno (pulsante) |

Gia' coperti dalla prima tornata (nessuna modifica): Alloggiati Web e ISTAT (`loadTenantData`), `server-booking-guard` (`loadOwnerStructureData`, `loadOrgDataParts`, `findOwnerStructure`),
concierge/ask, pulizie-plan, WhatsApp e messaggi Channex per la parte org (`loadOrgDatas`).

**Non applicabili** (leggono solo chiavi piatte, che restano nel blocco per scelta): `book-order.ts` (`loadOwnerPromos` = `spigolestay:promos`) e `loadOwnerRatePlans` in `server-booking-guard.ts` (`spigolestay:rateplans`).
**Non ancora fatti**: invoicing/service, booking-timeline, channex/relink e channex/sync, la parte personale di WhatsApp e messaggi Channex, i cron checkin-reminders / auto-messages (spenti), `calendar/feed` per le org (il feed legge solo lo stato personale, come prima).

Nota sul feed del calendario e sul confronto per `uid`: l'ordine degli eventi dalle tabelle puo' essere diverso da quello del blocco (il confronto lo ignora); se un domani il feed passasse a `on` bisognera' ordinarli.

## Modulo `server-entities.ts`

Lettori per kind e finestra (`readStructures`, `readRoomTypes`, `readUnits`, `readBookings({from,to,structureId,statuses,unitId,guestId,groupId})`, `readGuests`,
`readGuestsByIds`, `readDirectReviews`, `readEvents`), ricerche (`findBookingsById / ByOtaCode / ByXenoraCode / ByExtId / ByPaymentIntent`, `findGuestsByContact`),
`buildBlockData(admin, owner, {kinds, rateOverrides, extras})` che ricostruisce l'oggetto «data» del blocco, e gli strumenti di confronto.
La finestra delle prenotazioni è una sovrapposizione inclusiva (`check_out >= from` e `check_in <= to`). La lettura è a pagine da 1000 righe.

## Prima e dopo la migrazione 0015

Le colonne `ota_code`, `unit_id`, `guest_id`, `group_id` vengono cercate una sola volta per processo. Se mancano si ripiega su `data->>'code' | 'unitId' | 'guestId' | 'groupId'`
sempre con il filtro sul kind; se esistono si usano le colonne. I kind `rates`, `activities`, `tombs`, `leadtombs` servono solo a `buildBlockData({extras:true})`
e ai prezzi forzati: finché la 0015 non c'è, o non ci sono righe `rates` per il proprietario, i prezzi forzati si leggono dal blocco (resta corretto).
Ipotesi sulla forma delle righe, da riallineare alla 0015 se diversa (una sola funzione ciascuna in `server-entities.ts`): `rates` id = `"tipologia|AAAA-MM-GG"`, data = numero
o `{price}`; `tombs` id = `"collezione|idEntità"` (o data `{coll,id}`); `leadtombs` id = chiave del contatto; `activities` data = l'attività, ordinata per `ts`.
In `compare` un'ipotesi sbagliata si vede subito come `diff` su `rates` o `_deleted`.

## Limiti noti

- Le strutture sono ordinate per il campo `order`; il blocco le tiene nell'ordine dell'array: se qualche punto dipendesse da quell'ordine, comparirebbe solo in `compare` come ordine diverso (il confronto lo ignora).
- Una ricerca per solo id (`findBookingStoreById`) non ha un indice dedicato su `(kind, id)`: la chiave primaria parte da `owner_type, owner_id`. Il tetto alle ricerche fallite resta; conviene aggiungere l'indice con la 0015.
- Se il trigger blocco -> tabella fallisce (errori in `entities_sync_errors`, non bloccanti) con `on` una prenotazione appena scritta potrebbe non risultare: `compare` lo mostra prima.
