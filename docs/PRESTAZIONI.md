# Prestazioni di Xenora: numeri, colli di bottiglia, allarme

Misure del 21 ottobre 2026 (ore 12:52 – 22:00 UTC per il database, ultime 24 ore per le richieste), **in sola lettura**: nessun dato è stato scritto o modificato.
Database: Supabase `tuxxhquagtrsndtzopbo`, istanza Small da 2 GB, PostgreSQL 17.6. Le statistiche interne del database sono ripartite alle 12:52 UTC di oggi (riavvio), quindi coprono circa 9 ore.

## 1. In breve

- Il database oggi **non è in difficoltà**: 25 connessioni su 90, 99,4% delle letture servite dalla memoria, nessun blocco reciproco (deadlock), pulizia automatica regolare, i lavori pianificati durano pochi millisecondi.
- Il lavoro vero è tutto in **una cosa sola**: ogni volta che si salva qualcosa, l'app riscrive **l'intero blocco dati dell'account** (da 0,3 a 2,4 MB). Il titolare ha un blocco da 2,4 MB. Finché i clienti sono pochi e con blocchi piccoli va bene; con molti clienti contemporaneamente è il punto che cede per primo.
- Il secondo costo è il **controllo continuo ogni 4 secondi di ogni scheda aperta**: da solo è il 63% di tutte le richieste.
- I 297 errori 522/521 di oggi (tra le 12:42 e le 12:50 UTC) **coincidono con un riavvio del database** ("terminating connection due to administrator command", il database riparte alle 12:52). Non c'è traccia di memoria esaurita nelle ultime 24 ore; i registri più vecchi non sono più consultabili.
- Ho preparato (senza applicare nulla): la migrazione `0020_performance.sql` (tabellina dell'allarme + indici da creare uno per volta), una proposta di protezione di riga 15 volte più veloce, e l'allarme `/api/cron/watchdog`.

## 2. I numeri

### Dimensioni

| Cosa | Dimensione | Note |
|---|---|---|
| Database intero | 340 MB | |
| Storico dei salvataggi (`app_state_history` + `org_state_history`) | **227 MB (67%)** | 378 righe; massimo 30 copie per account, quindi non cresce da solo, ma cresce con il numero dei clienti |
| `entities` (prenotazioni, ospiti, camere…) | 35 MB (21 dati + 13 indici) | 50.213 righe vive, 6.984 "morte" (14%, normale) |
| Blocchi vivi `org_state` / `app_state` | 7,0 MB / 4,1 MB | 3 organizzazioni, 6 account |
| Tabelle di backup temporanee (`_xn_*`, `app_state_backup_*`) | ~ 40 MB | 15 MB `_xn_backup_20261007`, 12 MB `_xn_f3_*`, 10 MB `app_state_backup_2026*`… non servono al funzionamento |
| `alloggiati_codes`, `market_daily` | 3,6 MB, 1,4 MB | tabelle di consultazione |

**Blocchi per account (testo / compresso nel database):** 2,43 MB / 0,86 MB (organizzazione del titolare, 5.215 riscritture finora); 2,42 MB / 0,76 MB; 1,68 MB / 0,62 MB (11.732 riscritture); 1,13 MB / 0,60 MB; i più piccoli sotto 0,5 MB.

### Quante volte al giorno si riscrive un blocco (ultime 24 ore, registro delle richieste)

| Operazione | Richieste/giorno | Tempo medio | 95° percentile | Massimo |
|---|---|---|---|---|
| Salvataggio blocco organizzazione (`PATCH org_state`) | 785 | 797 ms | 1,7 s | 4,1 s |
| Salvataggio blocco account (`PATCH app_state`) | 266 | 719 ms | 1,2 s | 2,2 s |
| Lettura completa del blocco (`select data,rev`) | ~ 4.240 org + ~ 2.200 account | ~ 350 ms | | 8,2 s |
| Controllo "è cambiato qualcosa?" (`select rev`) | ~ 18.300 org + ~ 6.400 account | ~ 24 ms | | |
| Elenco strutture condivise (`memberships`) | 11.100 | 40-300 ms | | |
| Verifica identità (`auth/v1/user`) | 6.900 | 205 ms | | 5,8 s |

In totale ~ 67.400 richieste al database in 24 ore; i quattro controlli continui (rev + memberships + auth) sono ~ 42.700, cioè **il 63%**.
Ogni salvataggio fa tre scritture pesanti: il blocco nuovo, una **copia nello storico** (30 per account) e la **ricopia nelle tabelle `entities`** (trigger). Nelle ultime 9 ore il database ha scritto 729 MB di registro di transazione (in parte lavoro straordinario di oggi: copie di sicurezza e riempimento delle nuove tabelle).
Stima grezza di quanto JSON viaggia: ~ 7 GB/giorno letti dal database (lettura completa 6.400 volte × blocchi da 0,3-2,4 MB, prima della compressione di rete) e ~ 1,5 GB/giorno inviati per i salvataggi.

### Query più costose (statistiche interne, 9 ore)

| Query | Chiamate | Media | Massimo | Tempo totale |
|---|---|---|---|---|
| Scrittura `org_state` (con storico e ricopia in `entities`) | 198 | 284 ms | 1,4 s | 56 s |
| Lettura `org_state` (blocco + rev) | 1.376 | 31 ms | 154 ms | 43 s |
| `istat_rows` (pagina Adempimenti, dal browser) | 231 | **92 ms** | 655 ms | 21 s |
| Scrittura `app_state` | 90 | 201 ms | 1,1 s | 18 s |
| `alloggiati_schedine` (dal browser) | 231 | **73 ms** | 566 ms | 17 s |
| Lettura `app_state` | 657 | 21 ms | 94 ms | 14 s |
| Controllo `rev` organizzazione | 6.697 | 0,5 ms | 5 ms | 3,6 s |

Le righe in grassetto sono anomale: tabelle di ~200 righe che impiegano 70-90 ms. Vedi §3, punto 4.

### Salute generale

- Connessioni: 25 aperte su 90 (14 dell'interfaccia dati, 2 autenticazione, 2 tempo reale, 1 pianificatore, 1 monitoraggio, 1 pgbouncer). Tutte inattive tranne le interne.
- Memoria: 99,39% delle letture dalla cache (6,6 milioni contro 40.000 da disco). `shared_buffers` 512 MB, `work_mem` 5 MB; 13 file temporanei in 9 ore (22 MB in tutto, tutti dalla verifica notturna `entities_verify`, che usa 1,7 s).
- Pulizia (autovacuum) regolare: `entities` ripulita alle 16:47, `org_state` alle 16:22, `app_state` alle 19:30. Righe morte: `org_state` 42 su 3 vive (normale per tabelle riscritte di continuo), `entities` 14%.
- Blocchi/deadlock: 0. Errori nel registro del database: solo i 29 "non accetta connessioni" del riavvio (12:42-12:50), 18 errori di colonna inesistente (query a mano di oggi), 11 conflitti di `buckets_pkey` del servizio archivio (innocui).
- Lavori pianificati nel database (pg_cron): **uno solo**, `pulizie-plan-10min` (ogni 10 minuti dalle 4 alle 20 UTC). Gli ultimi 12 giri: tutti riusciti, **4-19 ms** ciascuno (si limita a chiamare l'indirizzo del sito). Le copie giornaliere (`daily-snapshots`) non ci sono ancora: le tabelle `app_state_daily`/`org_state_daily` non esistono.
- Cron Vercel (`vercel.json`): `entities-verify` ha un registro di 6 righe, tutte ok, l'ultima del 21/10 alle 03:49 UTC (programmata 03:15: il piano Hobby ha precisione oraria). `entities_sync_errors` e `entities_extra_errors`: **0 righe**.
- Registri Vercel (`vercel logs`): il piano conserva circa un'ora (894 richieste, 20:57-21:56 UTC). **Nessun errore 5xx.** Un'unica anomalia: 152 risposte 401 su `/api/sync/window` concentrate tra le 21:00 e le 21:10 (poi solo 200): una sessione scaduta o una prova, da tenere d'occhio.
- Indici: le uniche richieste lente su tabelle piccole **non** mancano di indice (le tabelle hanno ~200 righe): il problema è altrove (§3.4). Gli avvisi di Supabase: 17 chiavi esterne senza indice (tabelle vuote), 43 indici "mai usati" (quasi tutti di moduli non ancora in uso o pronti per la Fase 3), 1 indice doppio (`channex_map`), 20 protezioni di riga ricalcolate per riga.

## 3. Colli di bottiglia, dal più importante

**1. Il salvataggio riscrive tutto il blocco (impatto alto, crescerà con i clienti).**
Un'unica modifica a una prenotazione fa viaggiare e riscrivere 0,3-2,4 MB, ne tiene una copia nello storico e la risincronizza in `entities`. Costo reale: ~ 800 ms in media, fino a 4 s. Più clienti = più riscritture contemporanee di megabyte, e ogni scrittura mantiene occupata una connessione e memoria per tutta la durata. Rimedio previsto dal piano: la **Fase 2 "scrittura a delta"** (`/api/sync/delta`, già presente e spenta di default) e poi la **Fase 3** (scrivere sulla riga della prenotazione invece che sul blocco). È il guadagno più grande disponibile e non si risolve con un indice.

**2. Controllo ogni 4 secondi per ogni scheda aperta (impatto alto sul numero di richieste, basso sul database).**
Ogni scheda fa, ogni 4 secondi: elenco delle strutture condivise (`memberships`) + controllo `rev` dell'account + un controllo `rev` per organizzazione. Una scheda aperta tutto il giorno produce ~ 20.000 richieste. Il database regge (0,5 ms l'una), ma oggi costano 24-40 ms ciascuna sul percorso rete, e con 100 clienti × 2 schede × 8 ore sarebbero **più di 5 milioni di richieste al giorno** (~ 60 al secondo di continuo). Interventi semplici e sicuri, **che richiedono modifiche in `src/lib/authsync.tsx` (area di un altro agente: NON toccata)**:
 - ricordare l'elenco delle strutture condivise per 60 secondi invece di rileggerlo a ogni giro (toglie da solo 11.100 richieste/giorno, il 16%);
 - rallentare il controllo (es. 15-30 s) quando la scheda è in secondo piano o l'utente non tocca nulla; il salvataggio rapido (300 ms) e il "cambio scheda" restano immediati.

**3. Letture complete del blocco (impatto medio).**
~ 6.400 al giorno, 350 ms in media, fino a 8 s: ogni volta che un'altra scheda ha salvato, tutte le altre rileggono l'intero blocco. La **Fase 2 "finestra di lettura"** (`/api/sync/window`, per ora solo titolare e per dispositivo) riduce proprio questo.

**4. Protezione di riga che chiama una funzione per ogni riga (impatto medio, correzione piccola e pronta).**
Le tabelle lette direttamente dal browser (`istat_rows`, `alloggiati_schedine`, `documents`, `booking_events`…) hanno la regola `is_ws_tenant(tenant_id)`, che per **ogni riga** apre `access_allowlist`, `auth.users` e `profiles`. Misura (transazione chiusa con ROLLBACK, ruolo `authenticated`, 196 righe): **1.362 blocchi e 46,6 ms** contro **108 blocchi e 3,0 ms** scrivendo la stessa regola con `(select auth.uid())`, cioè calcolata una volta sola. Stesso risultato per la sicurezza, ~ 15 volte più veloce, e il costo oggi cresce con le righe. È in `supabase/migrations/_proposta_2026-10-22_rls_initplan.sql` (quattro tabelle, con rollback), da provare con un account collaboratore prima di applicarla.

**5. Lo storico dei salvataggi pesa i due terzi del database e dura poche ore (impatto sul disco e sulla sicurezza).**
227 MB su 340. Per l'account più attivo le 30 copie coprono **solo 4 ore e mezza** (dalle 16:14 alle 20:47 di oggi); per un'altra organizzazione 30 copie in 40 minuti. Quindi lo storico **non è un backup**: protegge dall'errore di un minuto fa, non da quello di ieri. A questo servono le copie giornaliere (migrazione 0018 dell'agente C, 30 giorni). Lo spazio è comunque limitato a 30 copie per account: cresce solo con i clienti (un cliente con blocco da 300 KB ≈ 9 MB di storico).

**6. Rifiuti da togliere (impatto basso, ma gratis).**
~ 40 MB di tabelle di copia temporanee (`_xn_*`, `app_state_backup_*`, `_xn_sim_clean_*`). Prima esportarle fuori dal database (o confermare che le copie su Drive bastano), poi eliminarle. Non l'ho fatto: sono copie di sicurezza.

**Non sono colli di bottiglia oggi:** numero di connessioni, memoria cache, indici delle tabelle principali (`entities` usa la chiave principale 230.000 volte), cron del database, 5xx di Vercel.

## 4. Cosa cambierebbe aprendo ai clienti

Scenario di ordine di grandezza (stime, non misure): 100 clienti, ognuno con blocco medio da 300 KB e 2 schede aperte per 8 ore.

- **Richieste di controllo**: ~ 5 milioni al giorno (60 al secondo nelle ore di lavoro) se non si rallenta il controllo a 4 secondi (§3.2). Con il controllo a 20 secondi e l'elenco strutture in memoria: ~ 0,9 milioni.
- **Salvataggi**: ~ 20.000 al giorno, ciascuno da 0,3 MB + storico + ricopia: ~ 6 GB al giorno di dati riscritti. Con la Fase 3 (scrittura per riga) scenderebbe a pochi KB per salvataggio.
- **Storico**: 100 × 30 × 0,1 MB compressi ≈ 300-900 MB (più copie giornaliere: altri 30 × 100 × 0,1 MB). Su un disco da 8 GB ci sta, ma va tenuto d'occhio.
- **Memoria (il rischio vero sulla Small da 2 GB)**: ogni lettura o scrittura completa decomprime e costruisce in memoria 1-2 MB per richiesta; le ore di punta con decine di salvataggi e letture completi contemporanei sono ciò che in passato ha portato agli errori 522. Prima di aprire in grande: Fase 2 attiva per tutti, controllo rallentato, e **valutare il passaggio all'istanza Medium (4 GB)** come rete di sicurezza, che è una decisione di spesa tua.
- **Clienti con blocco grande** (come il titolare: 2,4 MB): sono già oggi i più lenti (salvataggi fino a 4 s). Conviene trattarli per primi con la Fase 3.
- **Altro da ricontrollare all'apertura**: le tabelle lette dal browser (`istat_rows` ecc.) con la protezione di riga (§3.4), le 17 chiavi esterne senza indice (migrazione 0020 parte B) e l'allarme (§5).

## 5. L'allarme: `/api/cron/watchdog`

**Cosa controlla** (tutto in sola lettura):
1. il database risponde e quanto in fretta (lettura minima; giallo oltre 2 s, rosso se non risponde entro 8 s o dà errore);
2. l'ultimo controllo notturno `entities-verify`: esiste, è ok, ha meno di 30 ore (rosso se ha trovato differenze);
3. le copie giornaliere (`app_state_daily` / `org_state_daily`): ultima copia non più vecchia di 2 giorni. **Se le tabelle non esistono ancora, il controllo si salta senza errore**;
4. gli errori delle ultime 24 ore in `entities_sync_errors` e `entities_extra_errors` (giallo se ce n'è qualcuno, rosso da 20 in su; tabelle assenti = ok);
5. il ritardo dei cron: oggi misurabile solo per `entities-verify` (punto 2) e per le copie giornaliere (punto 3). Gli altri cron Vercel non lasciano tracce nel database; per vederli resta il pannello Vercel. (Possibile miglioramento futuro: far scrivere a ogni cron una riga "sono vivo".)

**Cosa fa**: se tutto è a posto, risponde `{"ok": true, ...}` e non manda nulla. Se c'è un problema e `WATCHDOG_ENABLED` vale `1`, manda **una sola email** al titolare (variabile `WATCHDOG_TO`, altrimenti il primo indirizzo di `ADMIN_EMAILS`) con l'elenco dei problemi nuovi, usando Resend come le altre email dell'app. **Al massimo una email ogni 6 ore per tipo di problema** (lo ricorda nella tabella `watchdog_state` della migrazione 0020; se il database è giù ricorda in memoria, quindi all'istante in cui servirebbe di più l'avviso parte comunque). Se la tabella non c'è ancora, **non invia nulla** e lo scrive nel report (meglio nessun avviso che uno ripetuto). Senza `WATCHDOG_ENABLED=1` restituisce solo il report. Nessuna azione automatica sui dati.

**Come si chiama**: `GET /api/cron/watchdog` con l'intestazione `Authorization: Bearer <CRON_SECRET>` (per prova a mano anche `?secret=...`). Con `?strict=1` risponde 503 quando c'è un problema rosso (utile ai servizi esterni che avvisano sugli errori HTTP).

**NON è in `vercel.json`** (il piano Hobby non permette cron frequenti). Due modi per farlo girare ogni 10-15 minuti; **la scelta è tua**:

- **A. Servizio gratuito esterno** (consigliato, perché funziona anche quando il database o il sito sono giù): per esempio cron-job.org (gratuito, permette intestazioni personalizzate) o UptimeRobot. Indirizzo `https://xenora.it/api/cron/watchdog?strict=1`, intestazione `Authorization: Bearer <CRON_SECRET>`, ogni 15 minuti, avviso del servizio se la risposta non è 200 o va in timeout (così sei avvisato anche se tutta l'app è giù, caso in cui la route non può partire). Se il servizio non permette intestazioni, usare `?secret=` sapendo che il segreto resta nei registri del servizio.
- **B. Dentro il database (pg_cron)**, come `pulizie-plan-10min`. Funziona, ma se il database è giù non parte. Esempio (da eseguire una volta; il segreto va prima messo nel Vault di Supabase con `select vault.create_secret('<CRON_SECRET>', 'cron_secret');`):
  ```sql
  select cron.schedule('watchdog-15min', '*/15 * * * *', $$
    select net.http_get(
      url := 'https://xenora.it/api/cron/watchdog',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      timeout_milliseconds := 25000
    )
  $$);
  ```
  (togliere con `select cron.unschedule('watchdog-15min');`)

**Per attivarlo, in ordine**: 1) applicare la parte A di `0020_performance.sql`; 2) pubblicare il codice; 3) provarlo a mano senza interruttore (`curl -H "Authorization: Bearer ..." https://xenora.it/api/cron/watchdog`: deve rispondere `ok: true` e `copie: nd` finché le copie giornaliere non esistono); 4) impostare in Vercel `WATCHDOG_ENABLED=1` (e, se vuoi un indirizzo diverso, `WATCHDOG_TO`); 5) collegare il servizio scelto.

## 6. Cosa ho fatto e cosa no

Fatto: misure in sola lettura; `supabase/migrations/0020_performance.sql` + `0020_performance_rollback.sql` (tabellina dell'allarme + 7 indici/pulizie documentati, **non applicati**); `supabase/migrations/_proposta_2026-10-22_rls_initplan.sql` (non applicata); `src/lib/watchdog.ts`, `src/app/api/cron/watchdog/route.ts`, `tests/watchdog.test.ts` (17 prove con database ed email finti, nessun invio reale).

Non fatto di proposito:
- nessuna scrittura sul database, nessuna migrazione applicata, nessun cron o variabile in Vercel;
- nessuna modifica a `authsync`/`sync-core` (cache dell'elenco strutture e rallentamento del controllo vanno fatti lì, da chi ha quell'area);
- non ho toccato storico, triggers `snapshot_*` e tabelle di backup (area dell'agente A/C, e sono copie di sicurezza);
- non ho tolto gli indici "mai usati" di `entities`: servono alla Fase 3.
