# Se si perde un dato: cosa fare

Pagina pensata per il titolare. Scritta il 21/10/2026 dopo una prova di ripristino su tabelle temporanee (nessun dato vero toccato). Progetto database: `tuxxhquagtrsndtzopbo` (xenora-prod).

## Regole d'oro (leggere prima di tutto)

1. **Prima si cerca, poi si ripristina.** Le query di ricerca sono di sola lettura e si possono lanciare quando si vuole.
2. **Il ripristino si fa solo con l'ok del titolare**, dentro un blocco `begin; ... commit;` e dopo aver guardato il risultato. Se qualcosa non torna: `rollback;`.
3. **Si ripristina una sola cosa** (una chiave, una prenotazione), non l'intero account. Ripristinare tutto riporta indietro anche il lavoro buono fatto dopo.
4. **Chiedere al cliente di chiudere l'app su tutti i dispositivi** (telefono, computer, tablet) prima di ripristinare, e riaprirla dopo. Un dispositivo rimasto aperto con i dati vecchi potrebbe rimandare indietro il dato perso.
5. **Tempo conta:** lo storico tiene solo le ultime 30 versioni per account. Su un account molto usato sono poche ore (vedi «Limiti»). Se un dato si perde, si cerca **subito**.
6. Ogni ripristino genera a sua volta una nuova versione di storico (e si perde la più vecchia). Quindi un ripristino sbagliato si può annullare, ma subito.

## Come sono fatti i dati (in due righe)

- Lo stato di ogni account sta in `app_state` (una riga per account, colonna `data`). Dentro ci sono tante «chiavi» tipo `spigolestay:guides` (guida ospiti), `spigolestay:msgtemplates` (messaggi), `spigolestay:data:v1` (blocco principale: **prenotazioni**, ospiti, camere, strutture, attività...).
- Ogni valore è un testo JSON. Il blocco principale `spigolestay:data:v1` contiene a sua volta l'elenco `bookings`.
- Le strutture condivise con un socio stanno in `org_state` (colonna `org_id`).
- Ogni volta che si salva, il database copia la versione **precedente** in `app_state_history` (o `org_state_history`). Si tengono le ultime 30 copie per account. Una copia non viene fatta se lo stato era vuoto.
- Le tabelle `entities` sono una copia ordinata dello stesso contenuto (si riallineano da sole quando lo stato cambia).

## Elenco ordinato: cosa è successo → dove cercare → come recuperare → quanto ci vuole

| # | Cosa è successo | Dove cercare | Come recuperare | Quanto ci vuole |
|---|---|---|---|---|
| 1 | Una **chiave** sparita o svuotata (guida ospiti, modelli messaggi, prezzi...) | `app_state_history` (query 1 e 2) | Ripristino di una sola chiave (query R1) | Prova: circa 0,2 secondi di database. Per l'uomo: 10-15 minuti con i controlli |
| 2 | Una **prenotazione** sparita dal calendario | `app_state_history`, dentro `spigolestay:data:v1` → `bookings` (query 3) | Ripristino della sola prenotazione (query R2) | Prova: circa 0,6 secondi. Per l'uomo: 10-15 minuti |
| 3 | La stessa cosa, ma in una **struttura condivisa** (socio) | `org_state_history` (stesse query con `org_id`) | Come sopra su `org_state` (query R3) | Come sopra |
| 4 | **Tutto l'account** è tornato indietro o è vuoto | `app_state_history`, ultima versione prima del guaio | Ripristino dell'intera riga (query R4) solo come ultima scelta | Pochi secondi di database, ma si perde il lavoro dopo quella versione |
| 5 | Storico non basta più (le 30 versioni sono state consumate o il guaio è vecchio) | Tabelle di copia `app_state_backup_*`, `_xn_*` (query 4); poi i backup di Supabase | Copia della chiave da quelle tabelle (come R1, cambiando la tabella) | 15-30 minuti |
| 6 | Dato perso e non presente da nessuna parte | Backup giornaliero di Supabase (Dashboard → Database → Backups) | Ripristino del **progetto intero** o copia in un nuovo progetto e poi recupero della sola chiave | Da decine di minuti a ore, con l'app ferma per tutti. Ultima spiaggia |

## Query di ricerca (solo lettura, si possono incollare quando si vuole)

Sostituire `<UID>` con l'id dell'account (es. l'account di prova: `51669792-2ae6-4df6-bb69-9abee384593e`). Per trovare l'id: `select id, email from auth.users where email ilike '%parte-della-email%';`

**Query 1 - Quante versioni ci sono e quante ore coprono**

```sql
select count(*) versioni,
       min(saved_at) dalla_data, max(saved_at) alla_data,
       round(extract(epoch from (max(saved_at)-min(saved_at)))/3600,1) ore_coperte
from app_state_history where user_id = '<UID>';
```

**Query 2 - In quale versione c'era ancora la chiave (es. la guida)**

```sql
select id, saved_at,
       length(data->>'spigolestay:guides') lunghezza_guida,
       md5(data->>'spigolestay:guides')    impronta_guida
from app_state_history
where user_id = '<UID>'
order by saved_at desc;
```

Si cerca l'ultima versione (la più recente) dove la lunghezza è «buona». Se due versioni hanno la stessa impronta, il contenuto è identico.
Confronto con lo stato attuale:

```sql
select length(data->>'spigolestay:guides') lunghezza_attuale,
       md5(data->>'spigolestay:guides')    impronta_attuale
from app_state where user_id = '<UID>';
```

**Query 3 - In quale versione c'era ancora una prenotazione**

Per l'elenco delle prenotazioni di ogni versione:

```sql
select id, saved_at,
       jsonb_array_length((data->>'spigolestay:data:v1')::jsonb->'bookings') prenotazioni
from app_state_history
where user_id = '<UID>'
order by saved_at desc;
```

Per trovare una prenotazione precisa (sostituire `<ID_PRENOTAZIONE>`):

```sql
select h.id version_id, h.saved_at, b
from app_state_history h,
     jsonb_array_elements((h.data->>'spigolestay:data:v1')::jsonb->'bookings') b
where h.user_id = '<UID>' and b->>'id' = '<ID_PRENOTAZIONE>'
order by h.saved_at desc;
```

Se l'id non si conosce, si può cercare per nome ospite (`b::text ilike '%Rossi%'`), ma attenzione: il nome sta spesso nella tabella ospiti (`guests`), non nella prenotazione.

**Query 4 - Altre copie disponibili (fuori dallo storico)**

```sql
-- Copie intere dello stato fatte a mano prima di grosse modifiche
select 'app_state_backup_20261005' t, user_id, updated_at from app_state_backup_20261005
union all select 'app_state_backup_20261010',  user_id, updated_at from app_state_backup_20261010
union all select 'app_state_backup_20261010b', user_id, updated_at from app_state_backup_20261010b
union all select '_xn_f3_app_state_20261021',  user_id, updated_at from _xn_f3_app_state_20261021
order by 1, 3 desc;
```

Altre tabelle di copia (`_xn_backup_20260922`, `_xn_backup_20261007`: colonne `kind`, `key`, `data`) contengono stati di singoli account e dati di accesso, copiati prima di vecchie operazioni. Sono istantanee uniche, non una copia che si rinnova.

## Query di ripristino (SOLO TESTO: si eseguono solo con l'ok del titolare)

Per tutte: aprire con `begin;`, guardare il risultato della riga «controllo», poi `commit;` oppure `rollback;`.

**R1 - Ripristinare una sola chiave piatta (es. la guida) da una versione di storico**

```sql
begin;
update app_state
   set data = jsonb_set(data, '{spigolestay:guides}',
         (select data->'spigolestay:guides' from app_state_history where id = <VERSION_ID> and user_id = '<UID>'))
 where user_id = '<UID>'
   -- sicurezza: parte solo se la versione scelta ha davvero la chiave
   and exists (select 1 from app_state_history
                where id = <VERSION_ID> and user_id = '<UID>' and data ? 'spigolestay:guides');
-- controllo: lunghezza e impronta devono essere quelle attese (query 2)
select length(data->>'spigolestay:guides') lunghezza, md5(data->>'spigolestay:guides') impronta
  from app_state where user_id = '<UID>';
-- se corretto:  commit;     altrimenti:  rollback;
```

Per un'altra chiave basta cambiare il nome (due punti inclusi) in entrambi i posti. Se la chiave non esiste nella versione scelta, la query non cambia nulla (UPDATE 0). Controllare comunque PRIMA con la query 2 che la versione scelta abbia la chiave.

**R2 - Ripristinare una sola prenotazione dal blocco principale**

```sql
begin;
update app_state a
   set data = jsonb_set(a.data, '{spigolestay:data:v1}',
     to_jsonb(
       jsonb_set((a.data->>'spigolestay:data:v1')::jsonb, '{bookings}',
         ((a.data->>'spigolestay:data:v1')::jsonb->'bookings') ||
         (select b
            from app_state_history h,
                 jsonb_array_elements((h.data->>'spigolestay:data:v1')::jsonb->'bookings') b
           where h.id = <VERSION_ID> and h.user_id = '<UID>'
             and b->>'id' = '<ID_PRENOTAZIONE>')
       )::text))
 where a.user_id = '<UID>'
   -- sicurezza: parte solo se la prenotazione esiste nella versione scelta...
   and exists (select 1 from app_state_history h2,
                      jsonb_array_elements((h2.data->>'spigolestay:data:v1')::jsonb->'bookings') b2
                where h2.id = <VERSION_ID> and h2.user_id = '<UID>' and b2->>'id' = '<ID_PRENOTAZIONE>')
   -- ...e non la aggiunge due volte
   and not exists (select 1 from jsonb_array_elements((a.data->>'spigolestay:data:v1')::jsonb->'bookings') x
                    where x->>'id' = '<ID_PRENOTAZIONE>');
-- controllo: il numero deve essere salito di 1 (e l'update deve dire UPDATE 1)
select jsonb_array_length((data->>'spigolestay:data:v1')::jsonb->'bookings') prenotazioni
  from app_state where user_id = '<UID>';
-- se corretto:  commit;     altrimenti:  rollback;
```

Nota: la prenotazione torna in fondo all'elenco (l'ordine non conta per il calendario). Se la prenotazione aveva un ospite che è sparito anche lui, va riportato allo stesso modo da `guests`. Vedere anche «Cosa non copre» sotto.

**R3 - Struttura condivisa (socio)**: stesse query R1/R2 sostituendo `app_state` con `org_state`, `app_state_history` con `org_state_history`, `user_id` con `org_id`.

**R4 - Ripristino dell'intera riga (ultima scelta)**

```sql
begin;
update app_state
   set data = (select data from app_state_history where id = <VERSION_ID> and user_id = '<UID>')
 where user_id = '<UID>';
-- controllo: confrontare conteggi con la query 3
-- se corretto:  commit;     altrimenti:  rollback;
```

Attenzione: porta indietro TUTTO a quel momento (modifiche, prenotazioni nuove, messaggi). Usare solo se il resto è comunque perso.

Le query R1 e R2 nella forma scritta qui sono state provate su copie temporanee dell'account di prova (stesso testo, solo i nomi delle tabelle cambiati): con la versione giusta ripristinano e il risultato è identico all'originale; con una versione inesistente non cambiano nulla (UPDATE 0); R2 non crea doppioni.

## Cosa NON copre il ripristino da storico

- La **versione più recente** nello storico è lo stato *prima* dell'ultimo salvataggio, non quello attuale. Nella prova, ripristinare l'intera chiave dalla versione più recente non dava un risultato identico all'attuale (differenza di un salvataggio). Per questo si ripristina **solo la parte persa**, non tutta la chiave.
- Pagamenti, email e messaggi già inviati non tornano indietro: il ripristino cambia solo i dati nel database.
- I dati di Stripe, Channex, Booking ecc. stanno nei loro sistemi: se una prenotazione è stata cancellata qui, la prossima sincronizzazione dal canale può farla ricomparire da sola.
- File caricati (foto, loghi) non sono nel database: se la guida ha immagini incorporate nel testo tornano con la guida; se sono collegamenti a file esterni dipende da dove stanno.

## Limiti attuali (stato del 21/10/2026)

- **Lo storico tiene 30 versioni per account, non 30 giorni.** Una versione viene creata a ogni salvataggio dell'app. Sull'account di prova le 30 versioni coprono 47 ore; sugli account più usati solo 5-14 ore (misurato oggi). Un dato perso ieri sera su un account molto attivo potrebbe non essere più nello storico stamattina.
- **La copia giornaliera per account (migrazione 0018) non è ancora attiva.** Finché non lo è, non esiste una copia «di ieri» per singolo account da cui ripescare una chiave.
- Le tabelle `app_state_backup_*` e `_xn_*` sono copie una tantum (5 e 10 ottobre, 7 ottobre, 22 settembre, 21 ottobre): contengono solo alcuni account e nessuna copre l'account di prova per le date di ottobre, tranne `_xn_f3_app_state_20261021` (stato delle 16:10 del 21/10).
- **Nessuna funzione di ripristino pronta** nel database: oggi il ripristino è fatto con le query in questa pagina. Non esiste ancora `entities_export_to_blob` (ricostruire il blocco dalle tabelle `entities`): è prevista dalla migrazione 0017.
- **Backup di Supabase:** il progetto è sul piano Pro, che prevede backup giornalieri conservati 7 giorni (Dashboard → Database → Backups). Riporta indietro il **progetto intero** (tutti i clienti) e lo rende irraggiungibile durante il ripristino: è l'ultima scelta. Non è verificabile da qui se sia attivo anche il **Point-in-Time Recovery** (aggiunta a pagamento, circa 100 dollari al mese per 7 giorni, richiede almeno il calcolo «Small»; se attivo sostituisce i backup giornalieri e permette di tornare indietro a pochi minuti prima). Da controllare nella Dashboard: Database → Backups → Point in time.
- Un ripristino da backup giornaliero perde fino a 24 ore di lavoro di **tutti** i clienti: per un singolo dato è sempre meglio la copia in un nuovo progetto (Dashboard → clona/ripristina in nuovo progetto) e il recupero della sola chiave da lì.

## Esempio svolto: la guida ospiti di una struttura è tornata vuota

Situazione: il cliente dice «la mia guida ospiti è sparita». È l'account di prova `51669792-2ae6-4df6-bb69-9abee384593e`; la chiave è `spigolestay:guides`.

1. **Subito, senza toccare nulla**: chiedere al cliente di NON rifare la guida e di chiudere l'app sugli altri dispositivi. (Ogni nuovo salvataggio consuma una delle 30 versioni.)
2. **Quanta storia c'è?** Query 1. Esempio dalla prova: 30 versioni, dal 19/10 alle 21:21 al 21/10 alle 20:46, cioè 47 ore. Quindi c'è margine.
3. **Dov'è l'ultima versione buona?** Query 2. Nella prova tutte le 30 versioni avevano la guida lunga 80.875 caratteri con la stessa impronta `cd1568a9e737f8489d6254652cc9a317`. Se il guaio fosse accaduto, le versioni dopo il guaio mostrerebbero una lunghezza molto più piccola (o niente); scegliere l'ultima versione con la lunghezza «buona». Nella prova: versione `8832`, salvata il 21/10 alle 20:46.
4. **Chiedere l'ok al titolare** e mostrargli: account, chiave, versione scelta, cosa si perde (nulla: si ripristina solo la guida; le altre chiavi non si toccano).
5. **Ripristinare**: query R1 con `<VERSION_ID>` = 8832. Controllare nel risultato lunghezza 80.875 e impronta `cd1568a9...`. Poi `commit;`.
6. **Dire al cliente di riaprire l'app** (ricaricare la pagina). Controllare che la guida ospiti si veda e che il link pubblico della guida funzioni.
7. **Registrare** cosa è successo e perché (così si può rimuovere la causa).

Esito della prova a secco (stesso identico procedimento, su copia temporanea, annullato con `rollback`): chiave tolta, versione cercata, chiave rimessa, stato dell'account **identico all'originale** (confronto completo e impronta uguale). Tempo di database: circa 0,2 secondi in totale su 330 KB di stato e 30 versioni di storico.

## Esito delle prove di ripristino (tempi misurati)

Account di prova, stato di 330 KB, 30 versioni di storico, tutto su tabelle temporanee e `rollback`.

| Prova | Esito | Tempo di database |
|---|---|---|
| Copia stato e storico in tabelle temporanee | ok | 56 ms |
| A: perdita di `spigolestay:guides` e ripristino da storico | **identico all'originale** (confronto jsonb completo e impronta md5) | 18 ms perdita, 58 ms ricerca versione, 70 ms ripristino: circa 0,15 s |
| B: perdita di 1 prenotazione su 4 e ripristino da storico | identico dopo la lettura del JSON; il testo grezzo cambia solo nell'ordine/spaziatura (il database lo riscrive), per l'app non cambia nulla | 48 ms perdita, 150 ms ricerca, 157 ms ripristino: circa 0,35 s |
| C1: ripristino dell'intera chiave dalla versione più recente | **non identico** (la versione più recente è lo stato prima dell'ultimo salvataggio) | 30 ms |
| C2: ripristino da versione di circa 1 ora prima | recupera 3 prenotazioni invece di 4: si perde il lavoro fatto dopo | 36 ms |

I tempi per l'uomo sono dominati dai controlli (10-15 minuti). Sugli account più grandi (storico fino a 25 MB) i tempi di database restano nell'ordine del secondo, ma la ricerca nello storico va fatta con le query precise di sopra.
