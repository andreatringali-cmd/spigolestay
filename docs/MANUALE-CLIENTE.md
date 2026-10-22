# Xenora: i primi 30 minuti

Manuale breve per chi inizia. Spiega cosa fa l'app **oggi**, non cosa farà. Dove una funzione è parziale, in prova o in arrivo, c'è scritto.

Come leggere le etichette:

- **Pronto**: funziona e puoi usarlo.
- **Parziale**: funziona in parte, il limite è scritto accanto.
- **In prova**: c'è, ma l'invio finale o il collegamento non è ancora acceso per tutti.
- **Nel tuo piano?**: alcune funzioni dipendono dal piano (Basic, Pro, Ultimate). Se non è nel tuo, l'app lo dice con un lucchetto e puoi aggiungerlo da Abbonamento.

> Nota per chi mantiene il documento: ogni affermazione qui sotto è stata controllata sul codice e sui testi di aiuto dell'app il 22 ottobre 2026. Le parti marcate `[DA COMPLETARE: …]` aspettano dati o decisioni del titolare.

---

## Prima di cominciare: cosa tenere a portata di mano

- Nome, indirizzo e numero di camere della struttura.
- Le tipologie di camera e un prezzo base per ciascuna.
- Se hai già prenotazioni (da Booking, Airbnb o un file Excel), tienile pronte: puoi importarle dopo.
- Per Alloggiati Web: nome utente, password e **Webservice Code** del portale della Polizia (lo genera il portale, ha una scadenza).
- Per incassare online dagli ospiti: i dati per aprire un conto Stripe (si fa una volta sola, dentro Stripe).

---

## 1. Registrazione e primo accesso (5 minuti)

**Stato: Pronto.** Xenora è **ad accesso su invito**: non ci si registra da soli.

1. Vai alla pagina **Prezzi e iscrizione** e compila il modulo «Richiedi l'accesso» (oppure scrivi a `[DA COMPLETARE: indirizzo email ufficiale per le richieste]`).
2. Dopo l'abilitazione del tuo indirizzo email, vai su **Accedi**. Puoi entrare con email e password oppure con Google. Se ti arriva un link di invito lo apri e crei l'account (nome utente e password); se richiesto, confermi l'email dal messaggio che ricevi.
3. Se vedi «Il tuo account non è ancora abilitato», significa che l'indirizzo non è ancora stato abilitato: scrivici.
4. Alla prima apertura parte la **configurazione guidata** (7 passaggi, circa due minuti): benvenuto, profilo, accesso, struttura, camere, piano, riepilogo. Se hai già tutto configurato puoi premere «Salta la configurazione».
5. Se dimentichi la password: «Password dimenticata?» nella pagina di accesso (ti arriva un'email).

Nella configurazione guidata scegli anche il piano. **Non paghi nulla in quel momento**: il piano si attiva dall'area Abbonamento (vedi punto 11).

---

## 2. Creare la struttura (3 minuti)

**Stato: Pronto.** La configurazione guidata crea la prima struttura con: nome, tipologia, città, e (facoltativi) indirizzo, civico, CAP, provincia, CIN.

Dopo, apri **Strutture** e clicca la struttura per completare la scheda. Conviene riempire subito:

- **Indirizzo e provincia**: servono a ISTAT e alla tassa di soggiorno.
- **CIN / codici di autorizzazione** e dati fiscali (P.IVA, codice SDI, PEC): servono alle fatture e ai portali.
- **Orari di check-in e check-out** e le regole di cancellazione.
- **Tassa di soggiorno**: aliquota, massimale per notte, numero massimo di notti, esenzione dei minori. Il programma propone valori già pronti per Siracusa (4%, massimo 5 € a persona per notte, massimo 7 notti, minori di 15 anni esenti): **controllali e cambiali con le regole del tuo Comune**.
- **Acconto richiesto** e **IBAN**: li usa il preventivo.

Altre strutture: «+ Nuova struttura». Quante ne puoi avere dipende dal piano (Basic 1, Pro fino a 3, Ultimate fino a 8).

---

## 3. Camere e tipologie (3 minuti)

**Stato: Pronto.**

- Una **tipologia** è un tipo di camera (es. «Doppia», «Tripla»): ha nome, posti letto e prezzo base.
- Una **camera** è la singola camera fisica, assegnata a una tipologia.
- La configurazione guidata crea già le camere con una numerazione automatica: le rinomini da **Camere**.
- In **Camere** puoi aggiungere o modificare tipologie, aggiungere camere, metterle **fuori servizio** o eliminarle.

Ogni piano comprende **6 camere per struttura**. Ogni camera in più costa 4 € al mese.

**Strutture con camere in comune** (per esempio nello stesso edificio): la pagina **Gruppo** le tiene sincronizzate così non vendi due volte la stessa camera. Stato: Pronto. Sui portali Booking ed Expedia il numero di camere di quella tipologia deve essere almeno pari a quelle che vuoi offrire.

---

## 4. Impostare i prezzi (5 minuti)

**Stato: Pronto** per i prezzi; **Parziale** per i suggerimenti automatici.

1. **Prezzo base**: lo scegli per ogni tipologia in **Camere**.
2. **Prezzi per periodo**: nel **Calendario**, ogni tipologia ha una riga Tariffa. Clicca il giorno iniziale, poi quello finale: imposti un importo fisso oppure una variazione in più o in meno in percentuale. Le tariffe impostate a mano dal Calendario hanno la precedenza.
3. **Weekend**: puoi impostare una maggiorazione per il fine settimana (pagina **Tariffe**).
4. **Piani tariffari** (es. «Colazione inclusa», «Non rimborsabile»): scarto in percentuale dal prezzo base, notti minime, trattamento, politica di rimborso. **Tariffe derivate**: un prezzo calcolato da un altro con ± euro o ± %, che si aggiorna da solo.
5. **Eventi** (sagra, ponte): doppio clic sull'intestazione del giorno nel Calendario per segnarlo e ricordarti di alzare i prezzi.

Suggerimenti sui prezzi (Calendario, **Revenue**, **Nèttare**): sono **consigli**, non cambiano i prezzi da soli. Il confronto con la «media di zona» della Rete città compare solo quando ci sono abbastanza strutture della tua città nella rete; finché non è disponibile l'app lo scrive. Le medie possono includere strutture dimostrative: è indicato sulla pagina. Revenue, Rate checker e Rete città sono nel piano Ultimate (Revenue e Rate checker) e Pro (Rete città).

---

## 5. Collegare i canali (5 minuti)

**Stato: Parziale.** Il Channel Manager è incluso in tutti i piani. Lavora tramite un servizio specializzato (Channex) e **non usa il calendario iCal**.

1. Apri **Channel Manager** (menu «Canali»).
2. Premi **Gestisci canali**: si apre un pannello dentro Xenora dove scegli il portale (Booking.com, Airbnb, Expedia, e gli altri disponibili) e fai il collegamento con il tuo account sul portale.
3. Se la struttura non è ancora pubblicata sui canali, l'app ti propone di attivare la distribuzione: le tue camere e tariffe vengono create dall'altra parte.
4. Per ogni tipologia imposti l'ID dell'annuncio sul portale e, se vuoi, una **correzione del prezzo per canale** (in euro o in %), per compensare le promozioni che il portale applica.
5. Da quel momento **prezzi, disponibilità e fuori servizio** partono da soli a ogni modifica, e le prenotazioni dei portali arrivano nel calendario. «Sincronizza ora» forza un nuovo invio completo.

Cosa è sicuro e cosa no:

- **Booking.com, Airbnb, Expedia**: sono i canali indicati nella pagina Prezzi.
- Nella lista dei canali compaiono anche Agoda, Vrbo e Google: sono collegabili dal pannello, ma **non li considero garantiti** finché non sono verificati caso per caso con te. `[DA DECIDERE: quali canali si promettono ai nuovi clienti]`
- HotelBeds richiede in più un contratto diretto tuo con HotelBeds.
- La commissione di ogni prenotazione dipende dal portale e non è uguale per tutti: l'app la mostra dove il portale la comunica; dove manca usa una stima.
- Le risposte ai messaggi degli ospiti dentro Xenora (vedi punto 9) sono **sperimentali**.

**Hai già prenotazioni?** Vai su **Importa dati**: puoi caricare un file CSV o Excel (c'è un modello da scaricare) oppure un calendario iCal. Prima di una sostituzione massiccia l'app chiede una conferma esplicita.

---

## 6. La prima prenotazione (3 minuti)

**Stato: Pronto.**

Due modi:

- **Dal Calendario**: clicca la cella del giorno di arrivo, poi quella del giorno di partenza (lo stesso giorno due volte = una notte). Scegli **Prenotazione**, **Preventivo** o **Fuori servizio**.
- **Con «+ Nuova»**: apre il modulo completo di una prenotazione diretta (ospite, date, camera, prezzo, extra, tassa di soggiorno).

Poi:

- Il prezzo si compila dalle tariffe del calendario ed è sempre modificabile.
- Puoi spostare una prenotazione in un'altra camera **trascinandola** (le date non cambiano).
- Dalla scheda della prenotazione mandi la conferma all'ospite (voucher con il logo della struttura) per email o WhatsApp.
- **Prenotazioni** raccoglie l'elenco; ogni riga mostra pagamento (pagato / acconto / da pagare) e stato della schedina.
- Per una proposta prima della conferma usa **Preventivi**: carta intestata in PDF, 5 lingue, invio per WhatsApp o email, e con un clic diventa prenotazione. Preventivi è nel piano Pro.

**Prenotazioni dirette dal tuo sito**: il **Widget** (codice da incollare) e **Xenosite** (mini-sito) ricevono prenotazioni dirette senza commissioni di Xenora. Il Widget è in tutti i piani, Xenosite è nel piano Ultimate.

---

## 7. Check-in online dell'ospite e guida (5 minuti)

**Nel tuo piano?** Il self check-in online è del piano **Ultimate** (oppure modulo extra). Nei piani più bassi la scheda della prenotazione mostra un lucchetto. La **Guida ospiti** è in tutti i piani.

**Come funziona (Pronto)**

1. Nella scheda della prenotazione trovi il link e il QR del check-in. Lo mandi tu all'ospite: con il pulsante **WhatsApp** si apre WhatsApp con il messaggio già scritto (lo invii tu dal telefono), oppure per **email**, oppure copi il link.
2. L'ospite apre il link dal telefono, nella sua lingua (italiano, inglese, francese, tedesco, spagnolo), e compila: **dati degli ospiti**, **documenti** (foto) e **firma con consenso**. Se c'è un saldo da pagare, può pagare online come ultimo passo, ma non è obbligatorio.
3. Tu vedi in **Adempimenti oggi** quali ospiti non hanno ancora finito. Puoi sollecitarli per WhatsApp o email, oppure «Compila tu» al posto loro.
4. «Compila dal documento» (dalla foto al campo) **non è sempre attivo**: dipende dall'attivazione del servizio. Se non è acceso, il pulsante lo dice.

**Guida ospiti (Pronto)**: una guida per struttura in 5 lingue, con QR del Wi-Fi e codici d'ingresso per camera, che mandi per WhatsApp o email. Il pulsante **«Parti dall'esempio»** copia testi già pronti (arrivo, Wi-Fi, colazione, dintorni, domande frequenti): **usalo solo se la guida è vuota**, e rivedi tutto prima di condividerla. Le informazioni dell'esempio sono quelle di una struttura di Siracusa e vanno cambiate con le tue.

**Dopo il check-in: gli adempimenti**

- **Alloggiati Web (Questura)**: le schedine si preparano dai dati del check-in, con stato Da completare / Da correggere / Pronta / Inviata. **Stato: In prova**. La preparazione e il controllo funzionano; l'**invio diretto** al portale è in attivazione. Intanto puoi generare il file `.txt` di riserva e caricarlo a mano sul portale. Ricordati che l'invio va fatto entro 24 ore dall'arrivo.
- **ISTAT / Turist@t**: il movimento giornaliero si calcola dalle prenotazioni. **Stato: In prova**: l'invio automatico non è attivo, e per attivarlo serve un account «USER PMS» del portale regionale (da chiedere una volta all'Osservatorio). Oggi puoi scaricare il **CSV** e inserirlo a mano.
- **Tassa di soggiorno**: calcolo per mese o trimestre e «Stampa dichiarazione» per il Comune. **Stato: Pronto**.

---

## 8. Pulizie (3 minuti)

**Nel tuo piano?** Pro e Ultimate.

**Stato: Pronto.**

- **Pulizie** mostra, giorno per giorno, cosa fare in ogni camera: partenza, arrivo, riassetto, oppure «partenza + arrivo» quando una camera si libera e si occupa lo stesso giorno. Tutto si ricava dalle prenotazioni.
- In alto c'è il **carico di biancheria** del giorno (matrimoniali, singole, federe, asciugamani, tappetini).
- Chi pulisce spunta «fatta», aggiunge note per camera e apre **segnalazioni** (anche con foto).
- **Copia** mette il programma negli appunti. **Condividi** apre WhatsApp con il programma già scritto, che invii tu.
- **Invio automatico giornaliero**: puoi far partire il planning da solo, a un orario che scegli, a chi pulisce (email e/o WhatsApp). **Parziale**: l'email funziona; l'invio WhatsApp automatico richiede che il WhatsApp Business della struttura sia collegato a Xenora.
- Nella scheda **Scorte & spesa** gestisci prodotti e lista della spesa.

---

## 9. Messaggi agli ospiti (3 minuti)

**Nel tuo piano?** Pro e Ultimate.

**Stato: Parziale. Importante: i messaggi automatici agli ospiti sono spenti.** Per una scelta di prodotto presa a ottobre 2026, Xenora **non invia da solo** benvenuto, check-in o recensione. I messaggi li invii tu, a mano, quando vuoi.

Come si usa (Pronto):

1. In **Messaggi → Modelli** scrivi i tuoi messaggi (benvenuto, check-in, check-out, recensione…) nelle lingue che servono.
2. Per ogni modello metti la spunta **«Mostra nella scheda della prenotazione»**.
3. Nella scheda di ogni prenotazione compare un pulsante per ogni modello. Un clic apre **WhatsApp** con il messaggio già pronto (nome, date, link al check-in, link alla guida riempiti da soli, nella lingua dell'ospite). Lo invii tu dal telefono.

Altro:

- **Messaggi OTA** (Booking.com, Airbnb, Expedia): leggi le conversazioni e puoi rispondere da Xenora. **Sperimentale**: non tutte le OTA accettano ogni tipo di messaggio o allegato, e il primo invio va verificato.
- **Preventivi**, conferme e voucher partono invece via email dall'app quando premi invia.

---

## 10. Incassi e conti (5 minuti)

**Stato: Pronto**, salvo dove indicato.

- **Incassi**: totale atteso, incassato e in sospeso. Aggiorni l'importo incassato oppure premi **Salda** per segnare il pagamento completo.
- **Scadenzario incassi**: chi deve ancora pagare, per scadenza.
- **Cassa · Prima nota** (in tutti i piani): entrate e uscite in un posto solo. Le entrate delle prenotazioni e le **commissioni dei portali** si generano da sole (etichetta «auto»); le altre uscite (utenze, pulizie, forniture) le registri tu. Scegli il conto per ogni movimento (contanti, banca, PayPal, POS).
- **Pagamenti online dell'ospite con carta (Stripe)**: **Parziale**. Funziona, ma prima devi **collegare il tuo conto Stripe** dalla scheda della struttura («Collega Stripe»): i dati bancari li inserisci solo nell'onboarding di Stripe, non in Xenora. Poi l'ospite può pagare dal check-in, dal preventivo o dal motore di prenotazione. `[DA DECIDERE: a chi spetta la commissione di Stripe, da indicare ai clienti]`
- **Fatture e ricevute** (piano Pro): **In prova**. Si emettono dalla prenotazione, con numerazione per struttura, e si collegano a Fatture in Cloud. Il collegamento parte in **modalità prova** (la fattura viene creata su Fatture in Cloud ma non va allo SdI): si disattiva solo dopo una verifica. Le fatture scartate dallo SdI compaiono in Adempimenti oggi.
- **Fatture fornitori** (acquisti), **Registro bollo**, **Fascicolo fiscale** per il commercialista: presenti. Sono strumenti di supporto, non sostituiscono il tuo commercialista.

---

## 11. Abbonamento e prova gratuita

- **Piani** (prezzi mensili, IVA inclusa secondo la pagina Prezzi `[DA DECIDERE: confermare IVA inclusa o esclusa]`): **Basic 39 €**, **Pro 69 €**, **Ultimate 119 €**. Con la fatturazione annuale lo sconto è del 20%.
- **Prova gratuita**: 5 giorni, senza costi di attivazione, dal momento in cui attivi l'abbonamento. Il primo addebito è alla fine della prova.
- Si attiva e si cambia da **Abbonamento**. Il pagamento è gestito da Stripe: i dati della carta non passano dall'app. Se hai già un abbonamento attivo, il cambio di piano non è automatico (l'addebito si modifica solo su Stripe): scrivi all'assistenza.
- Le fatture dell'abbonamento sono in **Fatture** (dentro «Il mio abbonamento»); la prima arriva alla fine della prova.
- Per disdire: puoi smettere in qualsiasi momento, come scritto nei Termini. Prima di chiudere l'account puoi esportare i tuoi dati da **Impostazioni → Backup & dati**.

---

## 12. Dove chiedere aiuto

- **Il pulsante «?»** in alto in ogni pagina apre la guida di quella pagina.
- **La linguetta «Assistenza»** sul bordo destro apre una finestra in cui scrivi la richiesta: premendo Invia si apre il tuo programma di posta con il messaggio già scritto, indirizzato all'assistenza. Non è una chat in tempo reale e non risponde in automatico.
- **Email**: `[DA COMPLETARE: indirizzo assistenza ufficiale]`, orari `[DA DECIDERE: orari di risposta]`.

---

## Percorso consigliato: i primi 30 minuti

| Minuti | Cosa fai | Dove |
|---|---|---|
| 0-5 | Accedi e passi la configurazione guidata | Accedi → procedura |
| 5-10 | Completi la scheda struttura (indirizzo, check-in, tassa) | Strutture |
| 10-15 | Controlli camere e prezzo base di ogni tipologia | Camere |
| 15-20 | Imposti i prezzi per i prossimi mesi | Calendario / Tariffe |
| 20-25 | Colleghi un canale e/o importi le prenotazioni che hai | Channel Manager / Importa dati |
| 25-28 | Inserisci una prenotazione di prova e apri la sua scheda | Calendario |
| 28-30 | Provi il pulsante messaggio e guardi Pulizie | Prenotazioni / Pulizie |

Poi, nei giorni successivi: guida ospiti, check-in online, credenziali Alloggiati Web, Stripe, utenti.

---

## Funzioni che nel manuale ho escluso perché non pronte

Non le ho descritte come disponibili. Se un cliente le chiede, la risposta onesta è quella a destra.

| Funzione | Perché esclusa | Cosa dire |
|---|---|---|
| Messaggi automatici agli ospiti (benvenuto, check-in, recensione) | Spenti per scelta del titolare (ottobre 2026): il programma non invia nulla da solo | «I messaggi li invii tu con un clic dalla scheda della prenotazione» |
| Invio diretto delle schedine ad Alloggiati Web | Dipende da un interruttore lato server e dal Webservice Code: in attivazione | «Prepara e controlla le schedine; l'invio diretto è in attivazione, nel frattempo file .txt» |
| Invio ISTAT / Turist@t automatico | Resta in prova finché non arriva l'accesso all'Osservatorio regionale | «Movimento calcolato; invio con CSV a mano» |
| Fatture elettroniche verso SdI | Collegamento a Fatture in Cloud in modalità prova | «Fatture create e verificate; l'invio allo SdI si attiva dopo il controllo» |
| Compilazione automatica dei dati dalla foto del documento | Richiede un servizio esterno che può non essere attivo | «Se non è acceso il pulsante lo dice» |
| Vrbo, Google Hotel, HotelBeds | Compaiono tra i canali collegabili ma non sono verificati con clienti reali; HotelBeds richiede contratto proprio | Non prometterli senza una verifica |
| Invio WhatsApp automatico dei messaggi agli ospiti | Non c'è: si usa il link WhatsApp aperto a mano | «Si apre WhatsApp col messaggio pronto» |
| Media di zona (Rete città) e prezzi dinamici in base al mercato | Medie disponibili solo con abbastanza strutture; i dati possono includere strutture dimostrative | «Suggerimenti, non prezzi automatici» |
| Recensioni (beta), Meta Search (beta), XenoraBook (beta), Assistente (beta) | Sono etichettate «beta» nel menu | Presentarle come anteprima |
| Import automatico delle recensioni Google | «Non ancora attivo» sul server; le altre fonti si inseriscono a mano | Non promettere |
| Invio del planning pulizie via WhatsApp in automatico | Richiede il collegamento del WhatsApp Business della struttura | L'email funziona; WhatsApp solo se collegato |
| Autenticazione a due fattori e ruoli/permessi dettagliati | Il testo di aiuto la dà come obbligatoria, ma non ho verificato come viene applicata ai nuovi clienti | Verificare prima di citarla |
| Ripristino da copie giornaliere per account | In preparazione; oggi c'è il backup `.json` manuale | «Esporta un backup da Impostazioni» |
| Assistenza prioritaria, affiancamento all'attivazione, supporto telefonico | Citati in vetrina o in descrizioni di moduli ma non definiti | `[DA DECIDERE]` |
