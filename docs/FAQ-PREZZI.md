# Domande frequenti per la pagina Prezzi

Bozza di testi, coerente con `src/app/prezzi/data.ts`, `src/lib/plans.ts` e `src/lib/stripe-plans.ts` (22 ottobre 2026). Le risposte che dipendono da una scelta del titolare sono marcate `[DA DECIDERE]`. I dati dell'azienda non esistono ancora e sono marcati `[DA COMPLETARE: …]`. Dove un fatto non si può verificare dal codice, c'è `[DA VERIFICARE]`.

Come usarla: ogni voce ha una **risposta proposta** (pronta da incollare in `FAQ` di `data.ts`) e, sotto, una **nota interna** che non va pubblicata.

Numeri di riferimento, presi dal codice:

| | Basic | Pro | Ultimate |
|---|---|---|---|
| Prezzo al mese | 29 € | 59 € | 99 € |
| Prezzo all'anno (-20%) | 278 € | 566 € | 950 € |
| Strutture | 1 | fino a 3 | fino a 8 |
| Camere incluse | 6 | 18 | 48 |

Ogni camera oltre le 6 incluse per struttura: 4 € al mese. Prova gratuita: 5 giorni.

---

## Accesso e inizio

### Come si accede a Xenora?
L'accesso è su invito. Compila il modulo «Richiedi l'accesso» in questa pagina: dopo l'abilitazione del tuo indirizzo email entri dalla pagina di accesso con email e password oppure con Google.

*Nota interna.* Già coerente con la FAQ attuale e con i Termini («accesso su invito/autorizzazione»). `[DA DECIDERE: tempi di risposta alla richiesta, ad esempio «entro un giorno lavorativo»; oggi non c'è un impegno scritto]`. La vetrina invece dice «Prova gratis» come se fosse libera: vedi `ALLINEAMENTO-VETRINA.md`.

### Quanto ci vuole per iniziare?
La configurazione guidata ha 7 passaggi e richiede un paio di minuti: profilo, accesso, struttura, camere, piano, riepilogo. Poi puoi importare le prenotazioni che hai già (file CSV, Excel o calendario iCal) e collegare i canali.

*Nota interna.* Verificato nel codice (`OnboardingWizard`). Non promettere «operativo in 30 minuti» come garanzia: il collegamento dei canali dipende dai portali.

---

## Piani e prezzi

### Cosa include ogni piano?
- **Basic (29 € al mese)**: 1 struttura. PMS (prenotazioni, calendario, tariffe, camere, ospiti e incassi, adempimenti Alloggiati Web / ISTAT e tassa di soggiorno), Channel Manager, Booking Engine, Cassa · Prima nota, Guida ospiti.
- **Pro (59 € al mese)**: fino a 3 strutture. Tutto Basic più Messaggi e modelli, Pulizie, Preventivi e vendite, Report e statistiche con esportazione Excel, Meta Search (beta), Utenti e permessi, Gestione condivisa con un socio, Rete città.
- **Ultimate (99 € al mese)**: fino a 8 strutture. Tutto Pro più Self check-in online, Xenosite (mini-sito), Revenue e prezzi dinamici, Rate checker.

Ogni piano comprende 6 camere per struttura.

*Nota interna.* L'elenco viene da `TIERS` in `plans.ts`: il **self check-in è solo in Ultimate** (o come modulo extra a 12 €). La vetrina lo mette in Pro: errore da correggere dalla vetrina, non qui. «Meta Search» è «beta» nel menu e «Rete città» può includere strutture dimostrative: valutare se citarli come inclusi. `[DA DECIDERE: tenerli nell'elenco pubblico o toglierli finché sono beta]`.

### I prezzi sono IVA inclusa?
Sì, i prezzi indicati sono IVA inclusa. La fattura riporta imponibile e IVA.

*Nota interna.* `[DA DECIDERE: IVA inclusa o esclusa]`. Oggi la pagina Prezzi dice «IVA inclusa» (e l'app scorpora il 22%: la fattura mostra imponibile + IVA 22%), ma la **vetrina dice «Prezzi IVA esclusa»**. Le due cose non possono essere vere insieme. Per i clienti con P.IVA di solito si indica «+ IVA»: scegliere una versione e usarla ovunque. Se si passa a «IVA esclusa» cambiano anche gli importi addebitati a Stripe.

### Come si paga? Posso pagare ogni anno?
Il pagamento è online, tramite Stripe, con fatturazione mensile oppure annuale. Con l'annuale c'è lo sconto del 20%: ad esempio Basic costa 278 € all'anno invece di 348 €. L'importo annuale viene addebitato in un'unica soluzione.

*Nota interna.* Importi calcolati da `annualAmount`: Basic 278, Pro 566, Ultimate 950.

### Quante camere sono incluse? E se ne ho di più?
Ogni piano comprende 6 camere per struttura. Ogni camera in più costa 4 € al mese.

### Posso aggiungere solo un modulo che non è nel mio piano?
Sì. I moduli non compresi si attivano singolarmente, in euro al mese: Guida ospiti 6, Self check-in 12, Vendite e Concierge 9, Pulizie 6, Messaggi 7, Meta Search 6, Report 8, Xenosite 7, Revenue 10, Rate checker 9, Utenti e permessi 6, Gestione condivisa 6, Rete città 9. Gli importi aggiornati sono sempre nella tabella di confronto di questa pagina.

*Nota interna.* Da `ADDON_PRICE`. In fase di pubblicazione conviene linkare la tabella invece di riportare i numeri a mano, per non farli divergere.

### Cos'è il piano «Su misura»?
È per catene e gruppi con più di 8 strutture. Strutture, camere e condizioni si definiscono insieme a noi: scrivici dal modulo e ti rispondiamo.

*Nota interna.* `[DA DECIDERE: voce «Su misura»]`. Oggi non c'è nessun prezzo, soglia o impegno scritto. Decidere se: tenerla così, indicare un «a partire da», oppure toglierla finché non c'è un cliente reale. Il modulo e la pagina Abbonamento inviano la richiesta a `info@xenora.it`.

---

## Prova gratuita, disdetta, assistenza

### C'è una prova gratuita?
Sì: 5 giorni dall'attivazione dell'abbonamento, senza costi di attivazione. Il primo addebito avviene alla fine della prova.

*Nota interna.* Il codice usa 5 giorni sia in pagina sia in Stripe (`trial_period_days`). Due avvertenze: (1) l'attivazione passa dal pagamento Stripe, quindi **la carta viene chiesta all'inizio della prova**: scriverlo chiaramente se è così `[DA VERIFICARE: se Stripe chiede la carta all'avvio]`; (2) il conto alla rovescia mostrato dentro l'app parte dalla data di registrazione salvata nel browser, non dall'attivazione: può dare una data diversa da quella di Stripe. `[DA DECIDERE: la prova parte alla registrazione o all'attivazione?]`.

### Posso disdire quando voglio?
Sì, puoi smettere di usare Xenora in qualsiasi momento, come indicato nei Termini di servizio. L'abbonamento si gestisce dalla sezione Abbonamento dell'app. Prima di chiudere l'account puoi esportare i tuoi dati.

*Nota interna.* Nei Termini c'è solo «L'utente può cessare l'utilizzo in qualsiasi momento». `[DA DECIDERE: cosa succede al periodo già pagato (rimborso, nessun rimborso, fino a fine periodo); preavviso; per quanto tempo restano i dati dopo la chiusura]`. Nell'app, per chi ha già un abbonamento attivo, il cambio di piano non è automatico e rimanda a un indirizzo diverso (`sales@xenora.app`): da uniformare.

### Come funziona l'assistenza?
Scrivici a `[DA COMPLETARE: indirizzo email assistenza]`: rispondiamo per email nei giorni feriali, `[DA DECIDERE: orari, oggi la pagina dice 9-18]`. Dentro l'app trovi in ogni pagina il pulsante «?» con la guida e la linguetta «Assistenza» per scriverci.

*Nota interna.* La FAQ attuale promette «giorni feriali dalle 9 alle 18»: è un impegno da confermare. `[DA DECIDERE: telefono o WhatsApp per l'assistenza; tempi di risposta massimi; assistenza prioritaria per Ultimate, che la vetrina promette ma l'app non descrive; affiancamento all'attivazione, citato nella descrizione del modulo Self check-in]`. L'indirizzo oggi compare in quattro forme diverse: vedi `ALLINEAMENTO-VETRINA.md`.

---

## Canali e funzioni

### Quali canali posso collegare?
Prezzi e disponibilità si sincronizzano con Booking.com, Airbnb ed Expedia tramite Channex, e le prenotazioni dei canali arrivano nello stesso calendario. Il collegamento si fa dentro Xenora, dalla pagina Channel Manager.

*Nota interna.* Questi tre sono quelli già scritti nella pagina Prezzi. Nell'app compaiono tra i collegabili anche Agoda, Vrbo e Google: `[DA DECIDERE: quali altri canali si dichiarano]`. La vetrina elenca Vrbo e Google Hotel Ads come canali: se non sono verificati, non vanno promessi. Non si usa iCal per la sincronizzazione dei canali (la vetrina scrive «via iCal e OTA»). HotelBeds richiede un contratto diretto del cliente.

### Ci sono costi extra per collegare i canali?
Il Channel Manager è incluso in tutti i piani. Le commissioni che Booking.com, Airbnb ed Expedia trattengono sulle loro prenotazioni restano quelle dei portali: Xenora non le cambia, ma le mostra per ogni prenotazione.

*Nota interna.* `[DA DECIDERE: Channex fattura a Xenora un costo per struttura/unità (listino pubblico: circa 130 $ al mese più 0,50 $ per unità); confermare che non viene addebitato al cliente nei piani]`.

### Le prenotazioni dirette hanno commissioni?
Xenora non applica commissioni sulle prenotazioni dirette, né dal Booking Engine né dal tuo sito: paghi solo il canone del piano. Se incassi con carta tramite Stripe, Stripe può applicare le sue commissioni di pagamento.

*Nota interna.* `[DA DECIDERE: chi sostiene la commissione di Stripe e se Xenora trattiene una commissione applicativa in futuro]`. Oggi la commissione Stripe è assorbita dalla piattaforma Xenora, e questo andrà rivisto prima di venderlo a molti clienti. I Termini dicono «Salvo diversa indicazione, non sono previste commissioni sulle prenotazioni dirette»: la formula è già prudente.

### Alloggiati Web, ISTAT e tassa di soggiorno sono inclusi?
Sì, fanno parte del PMS in ogni piano. Xenora prepara le schedine per la Questura e il movimento ISTAT dai dati delle prenotazioni e calcola la tassa di soggiorno secondo le regole del tuo Comune. **L'invio diretto ai portali è in attivazione**: nel frattempo puoi scaricare il file di riserva per Alloggiati Web e il CSV per ISTAT.

*Nota interna.* Coerente con l'etichetta «Invio diretto in attivazione» già nella pagina. Non scrivere «invio automatico» finché gli interruttori `ALLOGGIATI_LIVE` e `ISTAT_LIVE` sono spenti. ISTAT/Turist@t: oggi l'app parla di Osservatorio regionale (Sicilia): `[DA DECIDERE: quali regioni si dichiarano]`.

### Posso fare fatture elettroniche?
Puoi creare fatture e ricevute dalla prenotazione, con numerazione per struttura, e collegarle a Fatture in Cloud. L'invio allo SdI è in attivazione.

*Nota interna.* Il collegamento a Fatture in Cloud oggi è un'app privata con un elenco limitato di indirizzi: per aprirlo ad altri clienti serve la richiesta di pubblicazione a Fatture in Cloud. `[DA DECIDERE: se promettere la fatturazione elettronica ai nuovi clienti]`. Nel piano la voce «Documenti fiscali» richiede Pro.

### I messaggi agli ospiti partono da soli?
No. Xenora ti dà modelli di messaggio (benvenuto, check-in, recensione, in cinque lingue) che con un clic si aprono su WhatsApp o email già pronti nella scheda della prenotazione; li invii tu. L'invio automatico agli ospiti non è attivo.

*Nota interna.* **Attenzione**: oggi la pagina Prezzi dice «Invio automatico in attivazione» sulla scheda «WhatsApp ed email», mentre la scelta del titolare di ottobre 2026 è di tenerlo spento. `[DA DECIDERE: tenere la dicitura «in attivazione» (promessa) o toglierla]`. La vetrina dice «inviati da soli»: non vero oggi.

### Il check-in online è incluso?
Il self check-in online (dati, documenti e firma prima dell'arrivo) è incluso nel piano Ultimate; negli altri piani si aggiunge come modulo a 12 € al mese. La Guida ospiti multilingua con QR del Wi-Fi è in tutti i piani.

### Posso importare le prenotazioni che ho già?
Sì, da Importa dati: file CSV o Excel (c'è un modello) oppure calendario iCal. Prima di sostituzioni massicce l'app chiede una conferma.

---

## Dati e sicurezza

### Dove sono i miei dati e sono al sicuro?
I dati restano sul tuo account, isolati da quelli degli altri clienti e protetti da controlli di accesso. Le credenziali dei portali istituzionali sono salvate cifrate. I dati delle carte non passano da Xenora: li gestisce Stripe. Per i dati dei tuoi ospiti tu sei titolare del trattamento e Xenora è responsabile del trattamento: i dettagli sono nell'Informativa sulla privacy.

*Nota interna.* Rimosse due frasi della FAQ attuale perché **non verificabili dal codice**: «ospitato nell'Unione Europea (Francoforte)» e «backup giornalieri». `[DA VERIFICARE: regione del database (Supabase) e del servizio di hosting; piano Supabase e se esistono davvero backup giornalieri]`. Nella pagina c'è anche la striscia «Hosting nell'Unione Europea (Francoforte) · Backup giornalieri»: va verificata con la stessa regola. La copia giornaliera per account è in preparazione, non attiva. L'Informativa cita un accordo sul trattamento dei dati (DPA) «dedicato»: `[DA COMPLETARE: il documento DPA, se esiste, e dove si scarica]`.

### Posso esportare i miei dati?
Sì. Da Impostazioni puoi scaricare un backup completo in un file `.json`; con i Report puoi esportare in Excel. I Termini prevedono l'esportazione dei dati prima della chiusura dell'account.

### Quanto tempo conservate i dati dei miei ospiti?
I dati si conservano per il tempo necessario alle finalità e agli obblighi di legge. Le immagini dei documenti d'identità vengono rimosse dopo l'invio della schedina alla Questura.

*Nota interna.* Frase dall'Informativa. Rimane `[DA DECIDERE: tempi di conservazione precisi, e cosa succede ai dati dopo la disdetta]`.

---

## Chi siamo

### Chi c'è dietro Xenora?
Xenora è un prodotto di Xenora Digital Solutions, `[DA COMPLETARE: denominazione/ragione sociale]`, P.IVA `[DA COMPLETARE: P.IVA]`, sede `[DA COMPLETARE: indirizzo sede]`, PEC `[DA COMPLETARE: PEC]`.

*Nota interna.* I campi aziendali sono vuoti anche in Privacy (`[ragione sociale]`, `[indirizzo sede]`, `P.IVA [__]`) e nel piè di pagina della vetrina (`P.IVA __`). Servono prima di accettare pagamenti da clienti.
