# Allineamento: sito vetrina, pagina Prezzi e app

Confronto del 22 ottobre 2026 tra tre fonti:

- **Vetrina**: `C:\Users\pcimp\Desktop\xenora-vetrina\index.html` (xenoradigitalsolutions.com).
- **Pagina Prezzi**: `src/app/prezzi/page.tsx` e `data.ts`, che legge i piani da `src/lib/plans.ts` e `src/lib/stripe-plans.ts`.
- **App**: `plans.ts`, pagina Abbonamento, configurazione guidata, testi di aiuto (`PageHelp.tsx`), menu.

Non è stato modificato nulla: né la vetrina né il codice. Questo documento dice solo **cosa non torna e cosa conviene correggere**.

**Regola proposta.** La fonte di verità è `src/lib/plans.ts` (piani, prezzi, moduli, limiti) e, per le funzioni, ciò che l'app fa davvero oggi. La vetrina e le descrizioni devono seguire quella, non il contrario.

Gravità: **Alta** = promessa falsa o importo sbagliato; **Media** = incoerenza visibile al cliente; **Bassa** = rifinitura.

---

## 1. Nomi dei piani e prezzi

| Voce | Vetrina | Pagina Prezzi | App | Gravità | Cosa correggere |
|---|---|---|---|---|---|
| Nomi dei piani | Basic, Pro, Ultimate | Basic, Pro, Ultimate | Basic, Pro, Ultimate (ma il testo di aiuto di Abbonamento dice «Basic/Pro/Enterprise/Premium» e «Piano Base») | Media | Correggere il testo di aiuto dell'app. |
| Basic | 29 € al mese | 39 € | 39 € | Alta | Vetrina da 29 a 39. |
| **Pro** | **49 €** | **69 €** | **69 €** | **Alta** | Vetrina da 49 a 69. |
| **Ultimate** | **89 €** | **119 €** | **119 €** | **Alta** | Vetrina da 89 a 119. |
| **IVA** | **«Prezzi IVA esclusa»** | **«IVA inclusa»** | Scorporo del 22% sulle fatture (importo mostrato = lordo) | **Alta** | Scegliere una sola formula `[DA DECIDERE]` e riportarla ovunque. |
| Sconto annuale | Non citato | -20% (278 / 566 / 950 € all'anno) | -20% | Bassa | Citarlo in vetrina, è un argomento di vendita. |
| Camere incluse | 6 per struttura, 4 € per camera in più | 6 per struttura, 4 € | 6 per struttura, 4 € | - | Uguale. |
| Strutture | Basic 1, Pro fino a 3, Ultimate «multi-struttura» | 1, 3, 8 | 1, 3, 8 | Bassa | In vetrina scrivere «fino a 8». |
| Piano «Su misura» | Assente | Presente («oltre 8 strutture», senza prezzo) | Presente in Abbonamento (invia email a info@xenora.it) | Bassa | `[DA DECIDERE: voce «Su misura»]`. |
| Prova gratuita | «Prova gratuita», «Prova gratis» (senza durata) | 5 giorni dall'attivazione | 5 giorni (Stripe); il contatore interno parte dalla registrazione salvata nel browser | Media | Indicare «5 giorni» in vetrina; allineare il contatore interno alla data di attivazione `[DA DECIDERE]`. |

---

## 2. Funzioni promesse per piano

La vetrina elenca funzioni per piano che non coincidono con `TIERS` di `plans.ts`.

| Funzione | Vetrina | Pagina Prezzi / app | Gravità | Cosa correggere |
|---|---|---|---|---|
| **Check-in online** | In **Pro** | Solo **Ultimate** (o extra a 12 €). L'app mostra «disponibile nel piano Ultimate» | **Alta** | Spostare in Ultimate in vetrina (oppure cambiare piano nell'app: decisione del titolare). |
| **Adempimenti PA** (Alloggiati, ISTAT) | In **Pro** | Nel **PMS, quindi da Basic** | Media | Spostare in Basic in vetrina: così Basic sembra più competitivo. |
| **Utenti, permessi, strutture condivise** | In **Ultimate** | In **Pro** (moduli Utenti e Gestione condivisa) | **Alta** | Spostare in Pro in vetrina. |
| Pulizie / Housekeeping | Nominato solo nella scheda «B&B e hotel piccoli», non nei piani | Pro | Media | Aggiungerlo a Pro in vetrina. |
| Messaggi automatici | Pro: «Messaggi automatici (email/WhatsApp)» | Pro: Messaggi e modelli; invio automatico agli ospiti **spento** | **Alta** | Vedi sezione 3. |
| Revenue & statistiche | Pro: «Revenue & statistiche» | Pro: Report e statistiche. Revenue e prezzi dinamici sono in Ultimate | Media | Scrivere «Report e statistiche» in Pro. |
| Prezzi dinamici e rate checker | Ultimate | Ultimate | - | Uguale. |
| Sito web integrato (Xenosite) | Ultimate | Ultimate | - | Uguale (in vetrina non compare il nome «Xenosite»). |
| Incassi con carta (Stripe) | Basic | Pagamento online: nel check-in (Ultimate), preventivi (Pro), booking engine (Basic) | Media | Specificare dove in Basic. |
| Priorità sull'assistenza | Ultimate | Non descritta né nell'app né in Prezzi | Media | Definirla `[DA DECIDERE]` o toglierla. |
| Moduli non citati dalla vetrina | - | Cassa · Prima nota, Preventivi, Promozioni, Upselling, Meta Search, Rete città, Fatturazione, Documenti fiscali | Bassa | Valutare se citarli. |

---

## 3. Cose promesse che oggi non sono vere

Sono le voci più delicate: in vetrina sono scritte al presente.

| Frase della vetrina | Realtà | Gravità | Proposta |
|---|---|---|---|
| «Benvenuto, istruzioni di check-in e richiesta recensione **inviati da soli** via email e WhatsApp» | I messaggi automatici agli ospiti sono **spenti** per scelta del titolare (ottobre 2026). Si inviano a mano con un clic dalla scheda | **Alta** | «Modelli di messaggio pronti, in più lingue, inviabili con un clic». Se si vuole riaccendere l'invio automatico, è una decisione di prodotto. |
| «Alloggiati Web e ISTAT/Turist@t **direttamente dal gestionale**» | Schedine e movimento si preparano; l'invio diretto è **in attivazione** (la pagina Prezzi lo dice, la vetrina no) | **Alta** | Aggiungere «invio diretto in attivazione» come in Prezzi. |
| «Sincronizza Booking e Airbnb **via iCal** e OTA» | La sincronizzazione dei canali usa un servizio specializzato (Channex), non iCal. L'iCal serve solo per importare | Media | «Sincronizzazione con Booking.com, Airbnb ed Expedia». |
| Logo «**Vrbo**» e «**Google Hotel Ads**» tra i canali | Compaiono tra i collegabili ma non sono verificati con clienti. Nella pagina Prezzi non sono citati | Media | Togliere i due loghi o verificarli prima. |
| «**Prova gratis**» / «Prova Xenora» (pulsanti che portano a xenora.it) | L'accesso è **su invito**. La pagina di accesso risponde «account non abilitato» e rimanda a una richiesta demo | **Alta** | I pulsanti devono dire «Richiedi l'accesso» e portare al modulo di Prezzi o al modulo demo. Oggi il cliente fa un giro a vuoto: vetrina, accesso, di nuovo richiesta. |
| «Incassi con carta: il denaro va **direttamente** alla struttura, senza passaggi intermedi» | Il pagamento passa dalla piattaforma Xenora e viene trasferito all'account Stripe della struttura (modello tecnico di Stripe Connect). Stripe applica le sue commissioni | Media | Riformulare: «L'incasso arriva sul tuo conto Stripe». Aggiungere le commissioni Stripe. |
| «**Zero commissioni** sulle prenotazioni dirette» | Vero per Xenora. Restano le commissioni di Stripe sui pagamenti con carta | Bassa | «Nessuna commissione Xenora». |
| «Assistenza in italiano... persone vere» / «affianchiamo dall'attivazione all'uso quotidiano» | L'assistenza è per email, giorni feriali 9-18 (come scritto in Prezzi); non c'è un servizio di affiancamento definito | Media | Allineare al testo di Prezzi. |
| Dashboard di esempio con «128 prenotazioni, € 9.4k, 4.9★, +12%» | Dati inventati a scopo illustrativo | Bassa | Indicare «esempio» sotto l'immagine. |
| Tabella confronto con «Octorate o Smartness» («complicata», «variabile», «a parte») | Confronto con concorrenti nominati e giudizi non documentati | Media | Valutare un parere legale sulla pubblicità comparativa; in alternativa non nominarli e togliere i giudizi. |

---

## 4. Canali

| | Vetrina | Prezzi | App |
|---|---|---|---|
| Canali citati | Booking.com, Airbnb, Expedia, Vrbo, Google Hotel Ads, sito diretto | Booking.com, Airbnb, Expedia (tramite Channex) | Booking, Airbnb, Expedia / Vrbo, Agoda, Google Hotel, HotelBeds, altro; il pannello propone anche altri portali |
| Come | «via iCal e OTA» | Tramite Channex | Channex; iCal solo in importazione |

Gravità **Media**. Proposta: una sola lista pubblica, quella di Prezzi, e aggiungere gli altri solo dopo averli verificati con un cliente reale `[DA DECIDERE: Agoda?]`. Nota di prudenza: Channex nel codice punta per impostazione predefinita all'ambiente di prova; per i clienti reali deve essere impostato quello di produzione `[DA VERIFICARE: variabile CHANNEX_API_URL su Vercel]` (la verifica non è stata fatta: non si toccano le variabili).

---

## 5. Contatti e dati aziendali

Sono cinque indirizzi diversi e due domini per lo stesso scopo.

| Dove | Indirizzo / dominio |
|---|---|
| Pagina Prezzi, Privacy, Termini, Cookie, vetrina (modulo e footer del modulo) | `info@xenora.it` |
| Vetrina, link «Scrivici» nel piè di pagina | `info@xenoradigitalsolutions.com` |
| App, pulsante «Assistenza» (apre la posta) | `amministrazione@xenoradigitalsolutions.com` |
| App, Abbonamento (cambio piano con abbonamento attivo) | `sales@xenora.app` |
| Email di risposta del server alle richieste (mittente) | `prenotazioni@xenora.it` (le richieste arrivano a `info@xenora.it`) |
| Pagina di accesso | link a `xenoradigitalsolutions.it` (la vetrina usa `.com`) |

| Dato aziendale | Dove manca |
|---|---|
| Ragione sociale, sede, P.IVA | Privacy (`[ragione sociale]`, `[indirizzo sede]`, `P.IVA [__]`), footer vetrina (`P.IVA __`) |
| PEC | Ovunque `[DA COMPLETARE: PEC]` |

Gravità **Alta** per i dati aziendali (obbligatori per vendere), **Media** per gli indirizzi. Proposta:

1. Scegliere **un indirizzo pubblico** per richieste e assistenza `[DA COMPLETARE: indirizzo ufficiale]` e usarlo in vetrina, Prezzi, app, Privacy, Termini e Cookie.
2. Usare un solo dominio della vetrina; fare in modo che l'altro reindirizzi. Nella pagina di accesso il link è a `.it`, nella vetrina il dominio è `.com`.
3. La vetrina ha tre collegamenti rotti nel piè di pagina: **Privacy, Cookie, Termini puntano ad ancore (#privacy, #cookie, #termini) che non esistono nella pagina**. Devono puntare alle pagine `/privacy`, `/cookie`, `/termini` dell'app. Gravità **Alta** (obbligo di informativa).
4. Orari di assistenza: Prezzi promette «giorni feriali, 9-18». La vetrina non lo dice ma promette «supporto reale». `[DA DECIDERE: orari]`.

---

## 6. Tono e stile

| Aspetto | Vetrina | Prezzi e app | Gravità |
|---|---|---|---|
| Persona | «tu» | «tu» | - |
| Registro | Slogan, esclamazioni, emoji (😩 ✨ 🔄 💶), frasi come «La stessa potenza. Molto più facile.» | Sobrio, informativo, nessuna emoji nei testi pubblici | Media |
| Concorrenza | Nomina Octorate e Smartness | Non nomina nessuno | Media (vedi sezione 3) |
| Promesse | Assolute («niente overbooking», «tutto si aggiorna da solo») | Misurate, con etichette «in attivazione» | Media |
| Etichette di stato | Nessuna | «Invio diretto in attivazione», ecc. | Media |
| Nome prodotto | «Xenora», «Booking Engine», «Sito web integrato» | «Xenora», «Booking engine e Xenosite» | Bassa |

Proposta: portare la vetrina verso il tono di Prezzi: frasi brevi, un fatto per frase, le stesse etichette di stato («in attivazione», «beta»). Togliere «niente overbooking» come promessa assoluta (dipende dai portali) e «tutto si aggiorna da solo».

---

## 7. Ordine consigliato delle correzioni

**Subito (prima di mostrare il sito a un cliente)**

1. Prezzi Pro e Ultimate in vetrina (49 e 89 → 59 e 99) e formula IVA unica.
2. Pulsanti «Prova gratis» → «Richiedi l'accesso» (accesso su invito).
3. Collegamenti Privacy / Cookie / Termini della vetrina.
4. Frase sui messaggi «inviati da soli» e sull'invio diretto ad Alloggiati / ISTAT.
5. Funzioni per piano: check-in online in Ultimate, utenti e condivisione in Pro, adempimenti in Basic.
6. Dati aziendali (ragione sociale, P.IVA, sede, PEC) e un solo indirizzo pubblico.

**A seguire**

7. Canali: una lista sola, senza Vrbo e Google finché non verificati; togliere «via iCal».
8. Allineare il tono e il confronto con i concorrenti.
9. Decidere: «Su misura», assistenza prioritaria, orari, durata e partenza della prova.

---

## Appendice: testi di aiuto dell'app da correggere

Controllo dei testi di aiuto (`PageHelp.tsx`) e delle descrizioni dei moduli (`plans.ts`) rispetto al comportamento reale. Sono incoerenze dentro l'app, utili per il punto «aiuto dentro l'app».

| Dove | Cosa dice | Problema | Gravità |
|---|---|---|---|
| Aiuto **Abbonamento** | «Basic/Pro/Enterprise/Premium», «Piano Base + Web Concierge» | Nomi vecchi: oggi Basic/Pro/Ultimate, modulo «Vendite & Concierge» | Media |
| Aiuto **Messaggi** | «Imposta l'invio automatico a un orario o a X giorni» e «WhatsApp ed email li segui fuori da Xenora» | Messaggi automatici spenti; la pagina ha le schede «Messaggi OTA» e «Modelli» | **Alta** |
| `plans.ts` modulo **Messaggi & automazioni** (compare in Abbonamento e nella tabella Prezzi) | «Messaggi automatici agli ospiti (WhatsApp/email) con modelli e trigger» | Automatici spenti | **Alta** |
| `plans.ts` modulo **Vendite & Concierge** | «recensione Google automatica al check-out» | Dipende dall'invio automatico: da verificare | Media |
| Aiuto **Dashboard** e **Calendario** | «La linguetta colorata sul bordo destro apre l'assistente per domande rapide» | È il modulo «Assistenza» che apre il programma di posta, non un assistente che risponde | Media |
| Aiuto **Impostazioni** | «Configura le opzioni della tua attività e le impostazioni predefinite» | Troppo generico: la pagina ha Tema, Stile, Lingua, Notifiche, Concierge AI, Google Calendar, Backup e dati | Media |
| Aiuto **Alloggiati Web** | «le invia al portale al posto tuo», invio automatico alle 23:00 | Vero solo con l'interruttore acceso: la pagina Prezzi dice «in attivazione» | Media |
| Aiuto **ISTAT** | «Chiudi giornata trasmette il movimento» | Invio reale non attivo; il testo lo ammette solo nell'ultimo paragrafo | Media |
| Aiuto **Preventivi** | Esempio con regole di Siracusa (4%, 5 €, 7 notti) | Esempio presentato come regola generale | Bassa |
| Aiuto **Utenti (scheda)** | «L'autenticazione a 2 fattori è obbligatoria» | Non verificato come viene imposta | Media `[DA VERIFICARE]` |
| Abbonamento, cambio piano con abbonamento attivo | «sales@xenora.app» | Indirizzo diverso da tutti gli altri | Media |
| `abbonamento/pagamento/page.tsx` | Commento: «Informazioni di pagamento (dimostrativo)» | Solo un commento nel codice, ma da controllare che in produzione non mostri nulla di finto | Bassa |
| Pagine **senza** guida «?» | - | Mancano: Guida ospiti, Importa dati, Documenti fiscali, Impostazioni fattura, Booking Engine, Upselling, Promozioni, Adempimenti 2, Nèttare, Rete città, Recensioni, Scadenzario incassi, Piani tariffari, Tariffe derivate, Chiusura cassa, Fatture passive | Media |
| Aiuto **Canali** | Elenca «Booking, Airbnb, Expedia, Vrbo, Agoda, Google» come collegabili | Vero come elenco tecnico; non tutti verificati (vedi sezione 4) | Bassa |

*Nessuno di questi testi è stato modificato.*
