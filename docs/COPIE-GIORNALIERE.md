# Copie giornaliere e ripristino di una chiave

> Stato: **pronto come file, NON ancora applicato al database.** Si attiva applicando `supabase/migrations/0018_daily_snapshots.sql` (annullabile con `0018_daily_snapshots_rollback.sql`).

## Perché esiste
Xenora ha già uno «storico» (le ultime 30 **versioni** di ogni account). Il problema: con tanti salvataggi in una giornata, le 30 versioni si consumano in poche ore. Il lavoro del giorno prima (per esempio una guida ospiti) può quindi non essere più recuperabile. La copia giornaliera non dipende dal numero di salvataggi: **una copia per giorno, per 30 giorni**, qualunque cosa succeda durante la giornata.

## Cosa si salva
- Ogni notte alle **03:10 ora italiana** (02:10 d'inverno) il database copia, per **ogni account** e per **ogni organizzazione** (struttura condivisa tra soci), tutto il contenuto salvato sul server: impostazioni, guide ospiti, modelli messaggi, utenti, prenotazioni e il resto.
- La copia ha il nome del **giorno appena finito**: «copia del 21/10» = com'era tutto nella notte tra il 21 e il 22, quindi con tutto il lavoro del 21.
- Se la copia viene rilanciata lo stesso giorno **non sostituisce** quella già fatta (vince la prima): un rilancio fatto dopo un guaio non può mai rovinare una copia buona.
- Le copie sono visibili solo al server. Chi usa l'app (anche se è collaboratore) non può leggerle né modificarle.

## Per quanto
- **30 giorni.** Quelle più vecchie vengono cancellate da sole ogni notte.
- **Tetto di spazio: 250 MB** in tutto. Se mai si superasse, si cancellano prima i giorni più vecchi, ma gli **ultimi 7 giorni restano sempre**.
- Stima (misurata il 21/10/2026): ogni notte circa **3,8 MB** (9 account/organizzazioni; 9 MB di testo, compressi). A 30 giorni: **circa 113 MB**. Più clienti e più prenotazioni = più spazio (i due account più grandi pesano oggi 0,6-0,9 MB compressi ciascuno). Il database oggi pesa 340 MB, quindi **controlla il piano di Supabase prima di attivare** (vedi «Rischi» nel report).
- Una riga più grande di 32 MB non verrebbe copiata (oggi la più grande è 2,5 MB).

## Dove vedere le copie
Pagina **Admin → Copie disponibili** (`/admin/copie`, solo amministratore): per ogni account i giorni disponibili, la dimensione e la versione. È solo consultazione: **non ci sono pulsanti di ripristino**. Finché la migrazione non è applicata la pagina dice «Copie giornaliere non ancora attive».

## Come si ripristina una guida persa, passo per passo
Esempio: la guida della struttura «Casa Test Ortigia» è stata svuotata oggi; ieri era piena.

La funzione `restore_flat_key_from_daily` rimette **una sola chiave** (o una sola voce dentro la chiave) da una copia. **Non tocca nient'altro** dell'account e non può cancellare nulla. Si lancia dall'**editor SQL di Supabase** (progetto `tuxxhquagtrsndtzopbo`). Con `dry_run` vero (è il valore predefinito) **non scrive niente**: dice solo cosa cambierebbe.

1. **Trova l'account e il giorno.** Apri `/admin/copie`, cerca l'email del cliente, copia l'`id` (la stringa lunga accanto) e scegli il giorno in cui la guida era ancora piena (es. `2026-10-20`).
2. **Controlla che la guida sia davvero nella copia.** Nell'editor SQL:
   ```sql
   -- le guide sono salvate nella chiave 'spigolestay:guides', una voce per struttura (l'id della struttura)
   select k as id_struttura, length((data->>'spigolestay:guides')::jsonb ->> k) as caratteri_nella_copia
   from public.app_state_daily, jsonb_object_keys((data->>'spigolestay:guides')::jsonb) k
   where user_id = 'ID-DELL-ACCOUNT' and day = '2026-10-20';
   ```
   Il numero grande indica la guida piena. Annota l'`id_struttura` giusto.
3. **Prova a secco (non scrive niente):**
   ```sql
   select public.restore_flat_key_from_daily(
     'ID-DELL-ACCOUNT', '2026-10-20', 'spigolestay:guides', true, 'ID-STRUTTURA');
   ```
   Leggi la risposta: `would_change: true` = cambierebbe qualcosa; `current_bytes` e `restored_bytes` = dimensione attuale e dimensione che tornerebbe (la seconda deve essere più grande se la guida era stata svuotata); `entries_that_would_be_lost` deve essere **vuoto** quando indichi una sola struttura. Se vedi `reason`, c'è un motivo per cui non procede (copia non trovata, chiave assente, ecc.).
4. **Metti in sicurezza i dispositivi.** Chiedi al cliente (o a chi ha l'app aperta) di **chiudere l'app su telefoni e altre schede** per qualche minuto: un dispositivo aperto con la guida vuota potrebbe, in teoria, riscriverla dopo il ripristino.
5. **Ripristina davvero** (stessa chiamata con `false`):
   ```sql
   select public.restore_flat_key_from_daily(
     'ID-DELL-ACCOUNT', '2026-10-20', 'spigolestay:guides', false, 'ID-STRUTTURA');
   ```
   Risposta attesa: `applied: true`.
6. **Verifica.** Riapri l'app con l'account del cliente (o chiedi di ricaricare la pagina): la guida deve essere tornata. Le guide delle altre strutture e tutto il resto sono rimasti come erano.
7. **Se qualcosa non va, si torna indietro.** Il ripristino passa dai normali controlli del database: la versione di *prima* del ripristino finisce nello storico delle ultime 30 versioni (`app_state_history`), quindi è recuperabile subito.

### Se non c'è una voce per struttura
Per ripristinare **l'intera chiave** (per esempio `spigolestay:msgtemplates`, i modelli dei messaggi) ometti l'ultimo parametro:
```sql
select public.restore_flat_key_from_daily('ID-DELL-ACCOUNT', '2026-10-20', 'spigolestay:msgtemplates', true);
```
Attenzione: così **l'intera chiave** torna com'era quel giorno, e le modifiche fatte dopo vanno perse. Nella prova a secco, `entries_that_would_be_lost` elenca le voci che sparirebbero.

## Cosa NON fa
- Non ripristina il blocco principale (`spigolestay:data:v1`: prenotazioni, ospiti, strutture): ha regole e tabelle sue (`entities`). La funzione lo rifiuta di proposito. Per quello esistono la copia notturna completa (le righe ci sono, si possono leggere e confrontare) e l'esportazione dalle tabelle.
- Non ripristina dati di **organizzazione** (`org_state_daily`): le copie ci sono e si leggono, ma il ripristino di una chiave dell'organizzazione va fatto a mano (si chiede e si prepara caso per caso). Le guide ospiti del titolare stanno nell'account personale, quindi sono coperte.
- Non cancella mai nulla, non crea account, non può essere lanciata da un utente dell'app (solo dal service role o dall'editor SQL).
- Non sostituisce il backup completo su Drive: sono due protezioni diverse.

## Per chi gestisce il database
- Applicare: eseguire `0018_daily_snapshots.sql` in una transazione. Crea due tabelle (`app_state_daily`, `org_state_daily`), due funzioni e il job `daily-snapshots` (pg_cron, `10 1 * * *` UTC).
- Prima copia subito (facoltativo): `select public.take_daily_snapshots();` — il giorno di riferimento è calcolato da solo.
- Controllo: `select * from cron.job where jobname = 'daily-snapshots';` e `select day, count(*) from public.app_state_daily group by 1 order by 1 desc;`.
- Annullare: `0018_daily_snapshots_rollback.sql` (toglie anche le copie già fatte; per fermare solo la pianificazione basta il primo blocco).
