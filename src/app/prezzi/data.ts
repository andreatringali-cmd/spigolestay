// Contenuti della pagina pubblica «Prezzi e iscrizione».
// Piani, prezzi, moduli e limiti NON sono scritti qui: arrivano da src/lib/plans.ts e src/lib/stripe-plans.ts
// (le stesse fonti della pagina Abbonamento nell'app), così le due pagine non possono divergere.
// Qui ci sono solo i testi descrittivi, ciascuno verificato sul codice esistente (vedi il commento accanto).

export const CONTACT_EMAIL = "info@xenora.it"; // stesso indirizzo di Privacy, Termini e Cookie
export const IVA_RATE = 22; // aliquota usata dalla pagina Abbonamento per lo scorporo (prezzi mostrati IVA inclusa)

// Descrizione breve per modulo (chiave = MODULES[].key di plans.ts). Dove il modulo è ancora parzialmente dimostrativo
// (Meta Search, Rate checker, Revenue, Rete città) non si aggiunge nessuna descrizione: si cita solo il nome del piano.
export const MODULE_BLURB: Record<string, string> = {
  pms: "Prenotazioni, calendario, tariffe, camere, ospiti e incassi",
  cm: "Prezzi e disponibilità sui canali, tramite Channex",
  booking: "Motore di prenotazione per il tuo sito, senza commissioni",
  cassa: "Entrate, uscite e saldo per conto",
  guide: "Guida multilingua con QR WiFi e codici d'ingresso",
  checkin: "Documenti e firma online prima dell'arrivo",
  concierge: "Preventivi con pagamento online, extra e promozioni",
  housekeeping: "Planning pulizie giornaliero per camera",
  messaging: "Modelli di messaggio per WhatsApp ed email",
  bi: "Report e statistiche, con esportazione Excel",
  site: "Mini-sito integrato con il motore di prenotazione",
  team: "Più utenti con permessi e ruoli",
  sharing: "Gestione condivisa di una struttura con un socio",
};

export interface Feature { title: string; text: string; status?: string }
// Ogni voce corrisponde a funzioni presenti nel codice. «status» compare solo dove l'invio/collegamento finale
// non è ancora attivo per tutti (interruttori lato server: ALLOGGIATI_LIVE, ISTAT_LIVE, modalità prova di Fatture in Cloud, AUTO_MESSAGES_LIVE).
export const FEATURES: Feature[] = [
  { title: "Channel manager", text: "Prezzi e disponibilità sincronizzati con Booking.com, Airbnb ed Expedia tramite Channex; le prenotazioni dei canali arrivano nello stesso calendario." },
  { title: "Booking engine e Xenosite", text: "Motore di prenotazione da inserire nel tuo sito e mini-sito Xenosite collegato, per ricevere prenotazioni dirette senza commissioni." },
  { title: "Alloggiati Web e ISTAT", text: "Schedine per la Questura e movimento giornaliero ISTAT preparati a partire dai dati delle prenotazioni.", status: "Invio diretto in attivazione" },
  { title: "Tassa di soggiorno", text: "Calcolo secondo le regole del tuo Comune (aliquota, massimale per notte, numero massimo di notti, esenzione dei minori) e riepilogo per periodo." },
  { title: "Fatturazione elettronica", text: "Fatture e ricevute emesse dalla prenotazione, con numerazione per struttura e collegamento a Fatture in Cloud.", status: "Invio allo SdI in attivazione" },
  { title: "WhatsApp ed email", text: "Modelli di messaggio per benvenuto, check-in e recensione, da inviare agli ospiti via WhatsApp o email dalla scheda della prenotazione.", status: "Invio automatico in attivazione" },
  { title: "Guida ospiti e check-in online", text: "Guida multilingua con QR WiFi e codici d'ingresso per camera; check-in online con documenti e firma prima dell'arrivo." },
  { title: "Cassa e incassi", text: "Prima nota, saldo per conto, commissione OTA di ogni prenotazione e pagamenti online con Stripe." },
];

export const STEPS: { title: string; text: string }[] = [
  { title: "Richiedi l'accesso", text: "Compila il modulo qui sotto con i tuoi riferimenti: Xenora è ad accesso su invito." },
  { title: "Ti abilitiamo", text: "Abilitiamo il tuo indirizzo email e puoi accedere con email e password o con Google." },
  { title: "Configuri e scegli il piano", text: "Una procedura guidata ti accompagna nella configurazione. La prova gratuita parte quando attivi l'abbonamento." },
];

export interface Faq { q: string; a: string }
export const FAQ: Faq[] = [
  { q: "Come si accede a Xenora?", a: "L'accesso è su invito. Richiedilo con il modulo di questa pagina: dopo l'abilitazione del tuo indirizzo email accedi con email e password oppure con Google." },
  { q: "C'è una prova gratuita?", a: "Sì: 5 giorni dall'attivazione dell'abbonamento, senza costi di attivazione. Il primo addebito avviene alla fine della prova." },
  { q: "Posso disdire quando voglio?", a: "Sì, puoi cessare l'utilizzo in qualsiasi momento, come indicato nei Termini di servizio. L'abbonamento si gestisce dalla sezione Abbonamento dell'app." },
  { q: "Come si paga e l'IVA è inclusa?", a: "Il pagamento è online, tramite Stripe, con fatturazione mensile oppure annuale con sconto del 20%. I prezzi indicati in questa pagina sono IVA inclusa." },
  { q: "Quante camere sono incluse e posso aggiungere moduli?", a: "Ogni piano include 6 camere per struttura; ogni camera in più costa 6 € al mese. I moduli non compresi nel tuo piano si possono attivare singolarmente: i prezzi sono nella tabella di confronto." },
  { q: "Dove sono i miei dati e sono al sicuro?", a: "I dati restano sul tuo account, isolati da quelli degli altri clienti, con controlli di accesso. Il database è ospitato nell'Unione Europea (Francoforte) con backup giornalieri e le credenziali dei portali istituzionali sono salvate cifrate. Per i dati degli ospiti tu sei titolare del trattamento e Xenora il responsabile: i dettagli sono nell'Informativa sulla privacy." },
  { q: "Posso esportare i miei dati?", a: "Sì. Da Impostazioni puoi scaricare un backup completo in un file .json e, con il modulo Statistiche, esportare i report in Excel. I Termini prevedono l'esportazione dei dati prima della chiusura dell'account." },
  { q: "Come funziona l'assistenza?", a: `Scrivici a ${CONTACT_EMAIL}: rispondiamo via email nei giorni feriali, dalle 9 alle 18, il prima possibile. Per domande sui piani puoi usare anche il modulo di questa pagina.` },
];
