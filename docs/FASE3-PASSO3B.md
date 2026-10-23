# Fase 3, passo 3b: check-in online e purge delle foto documento compatibili con l'autorità `table` (spenti di default)

Stato: **codice pronto, dietro lo stesso doppio interruttore del passo 3a, nessun proprietario passato alle tabelle**. Con l'interruttore spento o con autorità `blob` il comportamento dell'app è identico a prima: check-in e purge scrivono ancora il blocco (`app_state` / `org_state`, chiave `spigolestay:data:v1`).

Prima di leggere questo documento: `docs/FASE3-PASSO3A.md` (doppio interruttore, concorrenza, errori, accensione/spegnimento).

## Il problema che risolve

Il passo 3a lasciava due scrittori «non migrati» (sezione «Che cosa NON è coperto»):

- **`/api/checkin`** (POST): oltre alla prenotazione aggiorna l'anagrafica ospite e calcola le foto documento da cancellare guardando tutti i dati. Con autorità `table`, `mutateStore` senza opzioni rispondeva `writer_not_migrated` e il check-in dava 409.
- **Purge delle foto documento** (`src/lib/alloggiati/purge.ts`, chiamata dopo l'invio della schedina alla Questura): cercava i riferimenti nel blocco. Con autorità `table` il blocco non contiene più le prenotazioni e le foto sarebbero rimaste per sempre.

## Doppio interruttore, invariato

Le tabelle si usano solo se:

1. `SERVER_WRITE_ENTITIES=on` (spento = nessuna chiamata al database nemmeno per leggere l'autorità);
2. per quel proprietario l'autorità in `public.entity_authority` è `table` **sia per `bookings` sia per `guests`**.

In ogni altro caso (interruttore spento, tabella `entity_authority` assente, riga assente, `blob`, errore nel leggerla) i due scrittori fanno esattamente quello che facevano prima. I test lo verificano: con interruttore spento nessuna richiesta a `entity_authority` e nessuna scrittura su `public.entities`.

**Regola nuova: i due kind devono avere la stessa autorità.** Entrambi `blob` = blocco; entrambi `table` = tabelle; uno `table` e uno `blob` = **rifiuto** (`authority_mixed`): il check-in risponde 409 e la purge non fa nulla, senza scrivere da nessuna parte (altrimenti prenotazione e anagrafica finirebbero in due posti diversi). Per questo l'autorità va accesa su `bookings` e `guests` **insieme** (vedi sotto).

## Regole di sicurezza (fail-closed) dei percorsi nuovi

- **Autorità di tutti i kind toccati.** Il check-in tocca `bookings` e `guests`: si leggono tutte e due. Coerenti (`blob`/`blob` o `table`/`table`) = si procede nel posto giusto; miste = `authority_mixed`, 409, nessuna scrittura da nessuna parte. Lo stesso vale per la purge.
- **Autorità illeggibile = si ferma.** `readEntityAuthority` è fail-open (errore di lettura = `blob`), ed è giusto per il 3a. Sui percorsi nuovi (check-in con `guest: true`, `mutateEntitySet` a più kind = purge), con interruttore acceso e lettura dell'autorità in errore, **non** si ricade sul blocco: `read_error`, il check-in risponde 409 con `reason: "read_error"`, la purge non fa nulla. Con interruttore spento non si legge nulla e si prosegue sul blocco. Tabella `entity_authority` inesistente o riga assente restano «blocco» (nessun proprietario può essere `table` senza quella tabella).
- **Ripristino fallito = errore distinto, non ritentabile.** Se in un'operazione a più righe una scrittura va in conflitto e anche il ripristino delle righe già scritte fallisce (qualcuno le ha toccate nel frattempo), `writeRows` risponde `partial_group_write` (nei `SetResult` come `outcome: "error"` con messaggio `partial_group_write: …`), **non** `conflict`: lo stato è metà nuovo e metà vecchio e i chiamanti non ritentano alla cieca (patchEntity, scope e set restituiscono subito l'errore, senza secondo tentativo). Vale per gruppi di camere, prenotazione + ospite e purge. `checkin-pay.ts`/`chat-pay-server.ts` (3a) ricevono `false` da `mutateStore` come per ogni errore: il loro ramo «già ripartita» (`paidSessions` già presente su una camera) va rivisto da chi corregge quel ramo, per riconciliare invece di rispondere «già ripartita». L'API è pronta per la funzione SQL atomica del passo 3c, che sostituirà `writeRows`.
- **Purge fail-closed.** Con autorità `table`, se le righe `entities` non si leggono (o non si riesce a verificare chi cita ancora un file) non si cancella nessun file dallo Storage: le foto restano (meglio un file in più di una foto in uso persa). Anche nel check-in per le foto sostituite.

## Che cosa è coperto

| Scrittore | Dove | Come |
|---|---|---|
| Check-in online, salvataggio (POST) | `src/app/api/checkin/route.ts` | `mutateBookingScope` con `guest: true, group: false, structure: false`: la funzione di modifica (la stessa di sempre, ora `applyCheckin`) riceve `bookings` (la sola prenotazione) e `guests` (la sola anagrafica collegata, `booking.guestId`). Si riscrivono **solo le righe cambiate**, prima la prenotazione poi l'anagrafica; se l'anagrafica va in conflitto la prenotazione già scritta viene rimessa com'era. Un nuovo tentativo su dati freschi, poi errore chiaro. |
| Foto sostituite dal check-in | stessa route | La funzione vede solo prenotazione e ospite, quindi gli «orfani» che calcola sono solo **candidati**. Dopo la scrittura `unreferencedRefs` li confronta con **tutte** le righe `bookings` e `guests` del proprietario: un file ancora citato da un'altra prenotazione/ospite non si cancella dallo Storage. |
| Purge foto documento (dopo l'invio Alloggiati) | `src/lib/alloggiati/purge.ts` | `purgeInTables`: legge le righe delle prenotazioni inviate e delle loro anagrafiche, applica la stessa logica pura di prima (`purgeDataPhotos`), riscrive solo le righe cambiate (`mutateEntitySet` con `kind: ["bookings","guests"]`, ripristino in caso di conflitto), poi cancella dallo Storage solo i file che `unreferencedRefs` non trova più in nessuna riga. |

Novità in `src/lib/server-entities-write.ts` (le funzioni del 3a si comportano come prima quando non si usano le opzioni nuove):

- `mutateBookingScope`: opzioni `guest`, `group`, `structure`; nuovo errore `authority_mixed`.
- `mutateEntitySet`: `kind` può essere un elenco; il risultato `ok` porta `wrote` (true se almeno una riga è stata riscritta).
- `readRowsByIds` (righe per id, a gruppi di 100) e `unreferencedRefs` (quali file non sono più citati da nessuna riga, a pagine di 500; a qualunque errore risponde «nessuno», quindi non si cancella nulla).

`src/lib/manage-booking.ts` **non è stato toccato**: la route chiama `mutateBookingScope` da sé e, se non è gestita, `mutateStore(..., { tables: "skip" })`, che è il vecchio percorso sul blocco (la lettura dell'autorità è già stata fatta, quindi non si ripete).

## Che cosa NON è coperto (da sapere prima di accendere un proprietario vero)

- **Caricamento dello store.** Il check-in, come gli altri scrittori, trova la prenotazione con `findBookingStore` / `findBookingStoreById` e legge da `store` prenotazione, ospite e struttura. Quando il blocco di un proprietario `table` sarà ripulito servirà che queste funzioni costruiscano lo store dalle tabelle (lavoro separato, non in questo passo). Finché il blocco ha ancora la vecchia copia, funziona; dopo no. **Non ripulire il blocco prima.**
- **Letture a valle del check-in.** Subito dopo il salvataggio, `syncSchedine` e `syncIstat` (Alloggiati/ISTAT) rileggono i dati del tenant con `loadTenantData`: leggono dalle tabelle solo con `SERVER_READ_ENTITIES=on`. Per un proprietario `table` quell'interruttore va acceso **prima**, altrimenti le schedine si generano sulla vecchia copia nel blocco.
- **`/api/checkin` GET, `/api/checkin/upload`, `/api/checkin/pay-confirm`**: non scrivono prenotazioni (upload carica solo il file nello Storage; pay-confirm usa `recordCheckinPayment`, già coperto dal 3a). Dipendono solo dal caricamento dello store (punto sopra).
- **Cancellazione delle foto dal browser** (`src/lib/store.tsx`, `orphanedRefs` lato client) e **media-migrate** (W14, una tantum): non toccati. Con autorità `table` il blocco nel browser non è la verità: le due operazioni vanno riviste nei passi successivi.
- **Non è una transazione.** Prenotazione + anagrafica sono due righe: c'è il controllo di concorrenza su ciascuna e il ripristino della prima se la seconda fallisce, ma se anche il ripristino fallisse (riga toccata nel frattempo da un altro) resterebbe la prenotazione aggiornata e l'anagrafica vecchia, e nei log compare `[entities-write] ripristino non riuscito`. Il danno è lieve (il prossimo salvataggio riallinea) ma esiste; la soluzione definitiva è una funzione SQL atomica (passo 3c).
- **Dove si cercano i riferimenti ai file.** `unreferencedRefs` guarda le righe `bookings` e `guests` (in qualunque campo, anche gli ospiti aggiuntivi). I file privati dei documenti vivono solo lì (il check-in li scrive lì e la migrazione dei media li mette lì). Non guarda `directReviews`, `events`, `structures`: nel blocco l'orfano si cercava in tutto il contenuto, ma lì i riferimenti privati non ci sono.
- **Costo della verifica.** Se la modifica toglie qualche file, `unreferencedRefs` scorre le righe `bookings` e `guests` del proprietario a pagine; si ferma appena li ha trovati tutti. Succede solo se c'è almeno un candidato (primo check-in senza foto precedenti: nessuna scansione).
- Tutti gli altri scrittori elencati come non coperti nel 3a (W1-W5, W12, W13): passi 3c-3d.

## Come si accende per UN proprietario di prova (esempio, NON eseguito)

Prerequisiti: quelli del 3a (migrazione 0017, backup recente, account di prova, mai il titolare) **più** il caricamento dello store dalle tabelle e `SERVER_READ_ENTITIES=on` (vedi sopra).

1. Controllare che la copia sia allineata (`entities_sync_errors` vuota, `entities_verify_run` ok), con particolare attenzione a `guests` e a `docPhotoFront` / `docPhotoBack` / `signature`.
2. Tenere a portata di mano il paracadute: `select entities_export_to_blob('<uid>', 'u');` (firma da confermare con la 0017).
3. Segnare l'autorità di **tutte e due** i kind, nella stessa istruzione (mai uno solo: con uno solo il check-in risponde 409):

```sql
-- ESEMPIO, da eseguire solo dopo il via libera. <uid> = utente di prova.
insert into public.entity_authority (owner_type, owner_id, kind, authority)
values ('u', '<uid>', 'bookings', 'table'), ('u', '<uid>', 'guests', 'table')
on conflict (owner_type, owner_id, kind) do update set authority = 'table';
```

4. Su Vercel `SERVER_WRITE_ENTITIES=on` (e `SERVER_READ_ENTITIES=on`) e nuovo deploy.
5. Provare con l'account di prova, a mano:
   - un check-in online completo (ospite anonimo dal link) con foto documento e firma;
   - un secondo check-in sulla stessa prenotazione con **foto diverse**: la vecchia foto deve sparire dallo Storage solo se nessun'altra prenotazione/ospite la usa;
   - un check-in di un gruppo di camere (non deve toccare l'anagrafica del prenotante);
   - un check-in come operatore (con login);
   - l'invio di una schedina di prova e la conseguente purge delle foto (solo in ambiente di prova: la purge cancella foto vere).

## Come si spegne

- **Subito, per tutti:** togliere `SERVER_WRITE_ENTITIES` (o cambiarla da `on`) e rifare il deploy. Da quel momento check-in e purge tornano sul blocco.
- **Per un proprietario:** riportare l'autorità di **entrambi** i kind a `blob`, dopo aver ricostruito il blocco dalle tabelle (come nel 3a: `entities_export_to_blob`, poi `update public.entity_authority set authority = 'blob' where owner_type = 'u' and owner_id = '<uid>' and kind in ('bookings','guests')`).

Importante: spegnere solo l'interruttore **non** riporta indietro le scritture già fatte nelle tabelle. I check-in fatti mentre l'autorità era `table` (e le foto purgate) stanno solo lì: prima di tornare a `blob` serve l'export verso il blocco. Se si lascia `table` su un solo kind il check-in dà 409 `authority_mixed`.

## Che cosa controllare dopo l'accensione

- Log di Vercel: righe `[checkin] scrittura sulle tabelle non riuscita` (con proprietario e motivo: `conflict`, `not_found`, `authority_mixed`, `write_error`, ...) e `[purge-foto] tabelle: non riuscita`; il 409 del check-in porta nel JSON anche `reason`. Poche e occasionali (`conflict`) sono normali; `authority_mixed` o `not_found` significano un errore di configurazione o di copia.
- Mai `[entities-write] ripristino non riuscito`: se compare, controllare a mano la prenotazione e l'anagrafica di quel check-in.
- Dopo un check-in di prova: `select id, updated_ms, data->>'webCheckin', data->>'docPhotoFront' from entities where owner_id = '<uid>' and kind = 'bookings' and id = '<id>'` e la riga `guests` collegata coerenti con la pagina; `updated_ms` cresciuto. Il blocco di quel proprietario **non** deve cambiare.
- Dopo la sostituzione di una foto: il vecchio file in Storage (bucket privato, cartella `u/<uid>/`) è sparito solo se nessuna riga lo cita ancora (ricerca per testo sulle righe `bookings` e `guests`).
- Dopo l'invio di una schedina di prova: le righe `bookings` inviate e i loro `guests` senza `docPhotoFront` / `docPhotoBack`; firma e numero documento al loro posto; le foto di altre prenotazioni dello stesso ospite intatte.
- `entities_sync_errors` e `entities_extra_errors` vuote; verifica notturna ok.

## Test

`tests/checkin-tables.test.ts` (26 prove, client finto, nessun file vero): interruttore spento (nessuna richiesta sull'autorità, `public.entities` intatta, blocco scritto); autorità `blob` (idem); `table` = scritte solo le righe cambiate (prenotazione + anagrafica; se l'anagrafica non cambia, una sola riga), blocco e altre righe invariati; conflitto sull'anagrafica = 409 `write_conflict` con `reason`, prenotazione rimessa com'era, nessun file cancellato; conflitto passeggero risolto al secondo tentativo senza perdere la modifica altrui; autorità mista = 409 `authority_mixed` senza scrivere; riga mancante = `not_found`; `mutateEntitySet` a più kind; `unreferencedRefs` (campi qualunque, ospiti aggiuntivi, più pagine, errore = nessuna cancellazione); purge sul blocco invariata, purge su `table` che **non cancella** un file ancora usato da un'altra prenotazione, da un'altra anagrafica o da un ospite aggiuntivo, e cancella quello non più usato; purge con conflitto o autorità mista = niente tolto e niente cancellato; ripristino fallito = `partial_group_write` senza secondo tentativo; autorità illeggibile = nessun ripiego sul blocco; lettura delle righe o dei riferimenti fallita = nessun file cancellato. Restano valide `tests/server-entities-write.test.ts`, `tests/purge-photos.test.ts` e `tests/checkin-route.test.ts` (percorso del blocco).
