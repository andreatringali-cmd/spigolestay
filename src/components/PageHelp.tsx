"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

interface Guide {
  title: string;
  intro?: string;
  sections: { h: string; items: string[]; icon?: string }[];
}

// Guida per pagina: "cosa puoi fare e come".
const HELP: Record<string, Guide> = {
  "/": {
    title: "Dashboard",
    intro: "Il colpo d'occhio sulla giornata scelta: prenotazioni, occupazione, incassi e cose da fare. Cambia la data in alto per vedere qualsiasi giorno (di default è oggi). Tutto segue anche la struttura selezionata in alto a destra.",
    sections: [
      { h: "Card di stato (in alto)", icon: "📌", items: [
        "Quattro card cliccabili: Prenotazioni attive, In struttura, Arrivi e Partenze del giorno.",
        "Clicca una card per filtrare l'elenco dei movimenti qui sotto (es. mostra solo gli arrivi). Ri-clicca la stessa card per togliere il filtro.",
        "Il numero cambia con la data e con la struttura scelta.",
      ] },
      { h: "I numeri del giorno", icon: "🔢", items: [
        "Camere occupate (occupate su totali), ADR = prezzo medio a notte, RevPAR = ricavo per camera disponibile, Incassi del giorno.",
        "Sono la fotografia economica della giornata: utili per capire a colpo d'occhio se stai riempiendo e a che prezzo.",
      ] },
      { h: "Tachimetro occupazione", icon: "🎯", items: [
        "Il gauge \"Occupazione del giorno\" mostra la percentuale di camere occupate con lancetta e arco colorato.",
        "Cambia giorno per vedere la lancetta muoversi.",
      ] },
      { h: "I grafici", icon: "📈", items: [
        "Disponibili: Camere occupate vs libere, Prenotazioni e ricavi per canale (una barra per canale con numero prenotazioni e ricavi), Provenienza ospiti, Occupazione attesa 7 giorni, Incassi attesi 7 giorni, Prezzo a notte per canale (curve di densità).",
        "L'icona grafici (in alto a destra della barra filtri) mostra o nasconde tutti i grafici con un solo click.",
        "Scorri i grafici con la rotella del mouse oppure trascinandoli (manina).",
        "Doppio clic su un grafico per attivarlo e spostarlo con le frecce: così riordini la fila come preferisci (l'ordine resta salvato).",
      ] },
      { h: "Cambiare giorno", icon: "📅", items: [
        "Frecce ‹ › per andare avanti o indietro di un giorno.",
        "Oppure scegli una data qualsiasi dal calendario; usa \"Oggi\"/Rimuovi filtri per tornare al presente.",
      ] },
      { h: "Cercare e filtrare", icon: "🔎", items: [
        "Il campo \"Cerca ospite\" filtra i movimenti del giorno per nome.",
        "Il selettore struttura (in alto a destra) restringe KPI, grafici e movimenti a una sola struttura.",
        "\"Rimuovi filtri\" azzera ricerca, data e filtro delle card.",
      ] },
      { h: "Da fare oggi (checklist)", icon: "✅", items: [
        "In fondo alla pagina c'è la checklist della giornata: messaggi di check-in e check-out, incasso della tassa di soggiorno, richiesta recensione, invio del planning pulizie.",
        "Spunta le voci man mano che le completi: le spunte restano salvate.",
      ] },
      { h: "Aiuto e assistente", icon: "💬", items: [
        "Questo pulsante \"?\" apre la guida della pagina in cui ti trovi (contenuti diversi per ogni sezione).",
        "La linguetta colorata sul bordo destro apre l'assistente per domande rapide.",
      ] },
    ],
  },
  "/prenotazioni": {
    title: "Prenotazioni",
    intro: "L'elenco di tutte le prenotazioni: di default vedi quelle in corso e future; attiva un filtro data per vedere anche lo storico. Card, grafici e registro seguono sempre i filtri attivi e la struttura selezionata in alto a destra.",
    sections: [
      { h: "I numeri in alto", icon: "🔢", items: [
        "Quattro riepiloghi sui risultati filtrati: Prenotazioni (quante), Notti totali, ADR (prezzo medio a notte) e Ricavi.",
        "Cambiano insieme ai filtri: così vedi subito il peso di un canale, di un periodo o di una struttura.",
      ] },
      { h: "I grafici", icon: "📈", items: [
        "Grafici combinati Prenotazioni + ricavi per canale, per struttura e per tipologia (una barra con numero prenotazioni e ricavi).",
        "Poi: Durata del soggiorno, Prenotazioni per mese, Ricavi per mese e Provenienza per paese.",
        "L'icona grafici mostra o nasconde tutti i grafici; scorri con la rotella o trascinando; doppio clic su un grafico per riordinarlo.",
      ] },
      { h: "Filtrare", icon: "🔎", items: [
        "Cerca per nome ospite o codice prenotazione.",
        "Filtra per struttura/camera, per canale e per intervallo di date — scegliendo se la data si riferisce all'arrivo (check-in) o alla data di prenotazione.",
        "\"Rimuovi filtri\" azzera tutto e torna a in corso e futuri.",
      ] },
      { h: "Ordinare il registro", icon: "↕️", items: [
        "Clicca l'intestazione di una colonna (quelle con la freccia) per ordinare; ri-clicca per invertire l'ordine.",
        "Le intestazioni restano fisse in alto mentre scorri l'elenco.",
      ] },
      { h: "Leggere le colonne", icon: "📄", items: [
        "Codice, prenotata il, struttura, camera (tipologia · numero), canale, ospite, n. ospiti, check-in, check-out, notti, totale, commissioni, netto e stato.",
        "Lo Stato mostra a colpo d'occhio schedina alloggiati e pagamento (pagato / acconto / da pagare).",
      ] },
      { h: "Azioni", icon: "✏️", items: [
        "Clicca una riga per aprire la scheda della prenotazione (e da lì Modifica).",
        "\"+ Nuova\" crea una prenotazione diretta; \"Esporta\" salva l'elenco in Excel o PDF.",
      ] },
      { h: "Commissioni e netto", icon: "💶", items: [
        "Le colonne Commissioni e Netto calcolano la quota OTA sul totale.",
        "La percentuale è quella del canale, ma è modificabile per la singola prenotazione dalla sua scheda.",
      ] },
      { h: "Aiuto e assistente", icon: "💬", items: [
        "Il pulsante \"?\" apre questa guida (contenuti diversi per ogni pagina).",
        "La linguetta colorata sul bordo destro apre l'assistente per domande rapide.",
      ] },
    ],
  },
  "/calendario": {
    title: "Calendario",
    intro: "Il planning visivo camera per camera: prenotazioni, tariffe, disponibilità ed eventi in un colpo d'occhio.",
    sections: [
      { h: "Viste e navigazione", icon: "📅", items: [
        "Il menu \"Visualizza\" (primo pulsante) sceglie la vista — Oggi (30 giorni) o Mese — e cosa mostrare (tariffe, disponibilità, occupazione, densità).",
        "Frecce ‹ › per andare avanti/indietro di un giorno; il campo data (si apre cliccandolo, sempre verso il basso) per saltare a una data.",
      ] },
      { h: "Inserire una prenotazione", icon: "➕", items: [
        "1 click sulla cella del giorno d'inizio, poi 1 click sul giorno finale: scegli Preventivo, Prenotazione o Fuori servizio.",
        "Stesso giorno cliccato due volte = una sola notte.",
        "\"+ Nuova\" apre invece il form completo di una prenotazione diretta.",
      ] },
      { h: "Tariffe e disponibilità", icon: "💶", items: [
        "Ogni tipologia ha la sua riga Tariffa e Disponibilità.",
        "Click sul giorno iniziale della Tariffa → click sul finale → imposti un importo fisso o una variazione ±% per quella tipologia in quel periodo.",
      ] },
      { h: "Spostare ed eventi", icon: "🔀", items: [
        "Trascina una prenotazione in verticale per spostarla di camera (le date non cambiano).",
        "Doppio clic sull'intestazione di un giorno per creare un evento (sagra, ponte…) e ricordarti di alzare i prezzi.",
      ] },
      { h: "Card insights e canali OTA", icon: "📊", items: [
        "L'icona a grafico mostra o nasconde tutte le card insights (Copilota revenue, Ritmo prenotazioni, Buchi da riempire…).",
        "Il Copilota suggerisce di alzare i prezzi nei giorni ad alta occupazione (ma non se sono già pieni) e di abbassarli per riempire buchi e giorni scarichi.",
        "In alto la legenda dei canali OTA con lo stato di collegamento e il pulsante \"Sincronizza ora\".",
      ] },
      { h: "Aiuto e assistente", icon: "💬", items: [
        "Il pulsante \"?\" apre questa guida.",
        "La linguetta colorata sul bordo destro apre l'assistente per domande rapide.",
      ] },
    ],
  },
  "/pulizie": {
    title: "Planning pulizie",
    intro: "Cosa fare in ogni camera nel giorno scelto, pronto da inviare a chi pulisce. In alto puoi passare tra Pulizie e Scorte & spesa.",
    sections: [
      { h: "Cosa vedi", icon: "📋", items: [
        "Le card in alto (Da fare, Riassetti, Partenze, Arrivi) filtrano il planning al clic.",
        "Ogni camera mostra l'azione: partenza, arrivo, riassetto o \"partenza + arrivo\" (turnover, con chi parte e chi arriva).",
      ] },
      { h: "Carico biancheria", icon: "🛏️", items: [
        "La riga in alto riassume i cambi completi e il dettaglio (matrimoniali, singole, federe, asciugamani, tappetini) da preparare per il giorno.",
        "A destra trovi la data e il contatore \"da fare · rimaste\".",
      ] },
      { h: "Giorno e viste", icon: "📅", items: [
        "Cambia giorno con le frecce ‹ › (±1 giorno) o dal calendario (si apre cliccandolo, sempre verso il basso); \"Oggi\" torna a oggi.",
        "Scegli la vista a Card o a Lista.",
      ] },
      { h: "Segnare e segnalare", icon: "✅", items: [
        "Spunta \"fatta\" man mano che completi le camere.",
        "Aggiungi note per camera e apri segnalazioni (anche con foto) per la proprietà.",
      ] },
      { h: "Condividere", icon: "📤", items: [
        "\"Copia\" mette il programma negli appunti.",
        "\"Condividi\" apre WhatsApp col programma già scritto, pronto da inviare.",
      ] },
      { h: "Scorte & spesa", icon: "📦", items: [
        "Dalla tab \"Scorte & spesa\" gestisci i prodotti (biancheria, detersivi…) e la lista della spesa.",
      ] },
      { h: "Aiuto e assistente", icon: "💬", items: [
        "Il pulsante \"?\" apre questa guida; la linguetta laterale a destra apre l'assistente.",
      ] },
    ],
  },
  "/messaggi": {
    title: "Centro messaggi",
    intro: "Crea, salva e automatizza i messaggi per gli ospiti nelle varie lingue.",
    sections: [
      { h: "Cosa puoi fare", items: ["Scrivi messaggi liberi o usa i modelli preimpostati (benvenuto, check-in, check-out…).", "Imposta l'invio automatico a un orario o a X giorni dall'arrivo/partenza.", "Integra il link della guida ospiti da inviare su WhatsApp o email."] },
    ],
  },
  "/preventivi": {
    title: "Preventivi",
    intro: "Crea un preventivo professionale su carta intestata, invialo all'ospite e trasformalo in prenotazione con un clic. In alto due schede: «Nuovo preventivo» e «Archivio».",
    sections: [
      { h: "Creare un preventivo", icon: "📝", items: [
        "Scegli struttura, date, adulti e bambini: il prezzo si compila da solo dalle tariffe del calendario (sempre modificabile per riga).",
        "Puoi mettere più tipologie di camera nello stesso preventivo, ciascuna con quantità e prezzo.",
        "Con bambini compare la chip «Culla» accanto alle età: spuntala e indica il prezzo a notte (0 = inclusa).",
      ] },
      { h: "Cosa entra nel totale", icon: "🧮", items: [
        "Soggiorno, tassa di soggiorno (Siracusa: 4%, max 5 €/persona a notte, max 7 notti, under 15 esenti), colazione, parcheggio ed eventuale culla.",
        "Acconto per confermare: le 3 card sono «Nessuno» · «la % impostata nella scheda struttura» · «100%». La percentuale centrale si aggiorna da sola da «Struttura → Acconto richiesto».",
      ] },
      { h: "PDF su carta intestata", icon: "📄", items: [
        "L'anteprima è un foglio A4 reale (le due pagine hanno le stesse dimensioni); «Scarica / stampa PDF» genera il documento con logo, intestazione e piè di pagina della struttura.",
        "Seconda pagina «Servizi & esperienze» (opzionale): se la struttura ha extra attivi in Upselling, viene aggiunta con una presentazione e il listino, stessa intestazione e footer della prima pagina.",
        "5 lingue: cambia la bandierina sopra l'anteprima per tradurre etichette e testi (i contenuti che scrivi tu restano come inseriti).",
      ] },
      { h: "Inviare", icon: "📤", items: [
        "Invia su WhatsApp o via email, oppure copia il testo. All'invio (o allo scarico del PDF) il preventivo si salva in automatico nella scheda «Archivio».",
        "Il testo/anteprima è modificabile a mano prima dell'invio.",
      ] },
      { h: "Archivio", icon: "🗂️", items: [
        "La scheda «Archivio» raccoglie tutti i preventivi, numerati per anno e datati, con stato Inviato/Confermato.",
        "«Modifica» ricarica il preventivo nell'editor; «Conferma» crea la prenotazione e prepara il messaggio di conferma con i dati di pagamento.",
      ] },
    ],
  },
  "/widget": {
    title: "Widget sito",
    intro: "Crea il motore prenotazioni da mettere sul tuo sito ufficiale.",
    sections: [
      { h: "Come funziona", items: ["Scegli struttura, lingua e colore; vedi l'anteprima live del widget.", "Copia il codice (iframe semplice o script dinamico) e incollalo nel tuo sito.", "Le prenotazioni dal widget sono dirette (zero commissioni) ed entrano automaticamente nel calendario e nel registro attività."] },
    ],
  },
  "/pagamenti": {
    title: "Pagamenti",
    intro: "Incassi, acconti e saldi in sospeso.",
    sections: [
      { h: "Cosa puoi fare", items: ["Vedi Totale atteso, Incassato e In sospeso.", "Aggiorna l'importo incassato o clicca \"Salda\" per segnare il pagamento completo.", "Filtra per mostrare solo le prenotazioni con saldo aperto."] },
    ],
  },
  "/abbonamento/pagamento": {
    title: "Informazioni pagamento",
    intro: "Qui gestisci come paghi l'abbonamento Xenora e i dati per le fatture. Non riguarda i pagamenti dei tuoi ospiti.",
    sections: [
      { h: "Metodo di pagamento", items: ["Aggiungi o cambi la carta (o l'addebito SEPA); il pagamento è gestito da Stripe in modo sicuro: i dati della carta non passano né vengono salvati dall'app.", "Apple Pay e Google Pay compaiono in automatico con la carta."] },
      { h: "Dati di fatturazione", items: ["Ragione sociale/nome, P.IVA o codice fiscale, indirizzo completo (città, provincia, via, civico), Codice SDI e PEC per la fattura elettronica, ed email a cui ricevere le fatture.", "Premi «Salva» per memorizzarli: verranno usati per intestare le fatture (le trovi in «Fatture»)."] },
      { h: "Rinnovo e pagamenti", items: ["Il canone si rinnova in automatico alla scadenza.", "Se un pagamento non va a buon fine ricevi un avviso e puoi regolarizzare dal portale Stripe."] },
    ],
  },
  "/tariffe": {
    title: "Tariffe",
    intro: "Piani tariffari, tariffe derivate e prezzi giorno per giorno.",
    sections: [
      { h: "Piani tariffari", items: ["Crea piani (Colazione inclusa, Non rimborsabile, Flessibile…) con scarto % dal prezzo base, notti minime, trattamento e politica di rimborso.", "Nella striscia scegli il piano per vedere i prezzi risultanti."] },
      { h: "Prezzi", items: ["Le tariffe derivate si calcolano da un'altra tipologia con ±€ o ±% e si aggiornano da sole.", "Imposta la maggiorazione weekend; le tariffe forzate dal Calendario hanno priorità e sono evidenziate."] },
    ],
  },
  "/canali": {
    title: "Channel Manager",
    intro: "Connessioni ai portali, mappatura camere e sincronizzazione.",
    sections: [
      { h: "Connessioni", items: ["Collega o scollega ogni portale (Booking, Airbnb, Expedia, Vrbo, Agoda, Google) e attiva l'auto-sync.", "Vedi stato, commissione e ultima sincronizzazione di ognuno.", "«Sincronizza ora» invia tariffe e disponibilità a tutti i canali connessi."] },
      { h: "Mappatura", items: ["Per ogni tipologia imposta l'ID annuncio, attiva i portali e correggi il prezzo (in € o %).", "Il prezzo del portale si calcola in automatico dal prezzo base.", "In fondo il registro delle sincronizzazioni."] },
    ],
  },
  "/statistiche": {
    title: "Statistiche",
    intro: "Grafici e indicatori sull'andamento.",
    sections: [{ h: "Cosa vedi", items: ["Prenotazioni e ricavi per canale e struttura, durata soggiorni, andamento nel tempo.", "Usa le frecce per scorrere tra i grafici."] }],
  },
  "/ospiti": {
    title: "Ospiti",
    intro: "L'anagrafica di tutti gli ospiti.",
    sections: [{ h: "Cosa puoi fare", items: ["Consulta i dati di contatto e lo storico soggiorni.", "I dati documento servono per Alloggiati Web."] }],
  },
  "/alloggiati": {
    title: "Alloggiati Web",
    intro: "Comunicazione degli arrivi alla Questura (entro 24h dal check-in).",
    sections: [
      { h: "Come funziona", items: ["Scegli il periodo (di default oggi): vedi gli arrivi da comunicare.", "Compila per ogni ospite i dati documento (le camere con dati completi sono verdi).", "\"Genera tracciato\" scarica il file da caricare sul Portale Alloggiati."] },
    ],
  },
  "/tassa-soggiorno": {
    title: "Tassa di soggiorno",
    intro: "Calcolo dell'imposta e movimento ISTAT per periodo.",
    sections: [
      { h: "Cosa puoi fare", items: ["Scegli mese o trimestre: vedi l'imposta da versare e il dettaglio.", "Il riepilogo ISTAT mostra arrivi e presenze per provenienza.", "\"Stampa dichiarazione\" genera il documento per il Comune."] },
    ],
  },
  "/strutture": {
    title: "Strutture",
    intro: "L'anagrafica completa di ogni struttura.",
    sections: [{ h: "Cosa puoi fare", items: ["Clicca una struttura per aprirne la scheda completa.", "\"+ Nuova struttura\" per crearne una da zero.", "La scheda copre dati generali, contatti, indirizzo/GPS, fisco e autorizzazioni (CIN/CIR/ISTAT/P.IVA), check-in, tassa di soggiorno, servizi, policy e pagamenti."] }],
  },
  "/utenti/[id]": {
    title: "Scheda utente",
    intro: "Account, sicurezza, strutture e permessi granulari di un utente.",
    sections: [
      { h: "Account & dati", items: ["Attiva/disattiva l'utente, imposta username e password (con reset via link).", "L'autenticazione a 2 fattori è obbligatoria; il cellulare serve per il secondo fattore.", "Scegli lingua, colore/foto profilo."] },
      { h: "Strutture & permessi", items: ["Assegna l'accesso a tutte le strutture o solo ad alcune (lista a doppia colonna).", "Applica un modello di permessi (Titolare, Direttore, Receptionist…) e poi affina ogni sezione su Nessuno / Visualizza / Modifica."] },
    ],
  },
  "/strutture/[id]": {
    title: "Scheda struttura",
    intro: "Tutti i dati di una struttura in un unico posto.",
    sections: [
      { h: "Sezioni", items: ["Dati generali, contatti, indirizzo con coordinate e link a Maps.", "Autorizzazioni e fisco: CIN, CIR, ISTAT, Alloggiati Web, P.IVA, SDI, PEC.", "Check-in/out e self check-in, tassa di soggiorno, servizi, policy di cancellazione, pagamenti e IBAN."] },
    ],
  },
  "/camere": {
    title: "Camere",
    intro: "Tipologie e singole camere di ogni struttura.",
    sections: [
      { h: "Cosa puoi fare", items: ["Aggiungi/modifica le tipologie (nome, posti letto, prezzo base).", "Aggiungi le camere e assegnale a una tipologia; mettile fuori servizio o eliminale."] },
    ],
  },
  "/utenti": {
    title: "Utenti",
    intro: "Chi accede al gestionale e con quali permessi.",
    sections: [{ h: "Cosa puoi fare", items: ["\"+ Nuovo utente\" per invitare qualcuno (anagrafica, ruolo, permessi) via link.", "Apri i Dettagli per modificare un utente."] }],
  },
  "/impostazioni": {
    title: "Impostazioni",
    intro: "Le preferenze generali del gestionale.",
    sections: [{ h: "Cosa puoi fare", items: ["Configura le opzioni della tua attività e le impostazioni predefinite."] }],
  },
  "/abbonamento": {
    title: "Abbonamento",
    intro: "Scegli la Versione e attiva i moduli che ti servono.",
    sections: [
      { h: "Versione e moduli", items: ["Clicca una card (Basic/Pro/Enterprise/Premium): i moduli sotto si attivano di conseguenza.", "Aggiungi o togli singoli moduli: se differiscono dal piano, diventa una «Versione personalizzata» (es. Piano Base + Web Concierge).", "Ogni modulo attivo ha il link «Apri la sezione» per andare alla funzione corrispondente."] },
    ],
  },
  "/cassa": {
    title: "Cassa · Prima Nota",
    intro: "Entrate e uscite in un unico posto, come un libro di prima nota.",
    sections: [
      { h: "Come funziona", items: ["Le entrate da prenotazione e le commissioni OTA sono generate in automatico (badge «auto»).", "Registra a mano le altre uscite (utenze, pulizie, forniture…) e le entrate extra.", "Scegli il conto (contanti, banca, PayPal, POS) per ogni movimento."] },
      { h: "Analisi", items: ["Filtra per mese o vedi tutto lo storico; il saldo si aggiorna.", "Uscite per categoria e andamento entrate/uscite degli ultimi 6 mesi.", "In fondo, il saldo diviso per conto."] },
    ],
  },
  "/revenue": {
    title: "Revenue · prezzi dinamici",
    intro: "Suggerimenti di prezzo per riempire meglio e guadagnare di più.",
    sections: [{ h: "Come leggerlo", items: ["Per ogni giorno vedi occupazione, prezzo attuale e il suggerimento (alza/mantieni/abbassa).", "Alta occupazione o eventi in città → alza; bassa occupazione → abbassa.", "Applica poi le tariffe consigliate dal Calendario."] }],
  },
  "/rate-checker": {
    title: "Rate checker",
    intro: "Confronta le tue tariffe con i competitor della zona.",
    sections: [{ h: "Cosa vedi", items: ["La tua tariffa vs la fascia e la media di mercato, giorno per giorno.", "L'etichetta indica se sei sotto, in linea o sopra mercato.", "Usalo per non lasciare soldi sul tavolo nei giorni di alta richiesta."] }],
  },
  "/sito": {
    title: "Sito web",
    intro: "Il tuo mini-sito ufficiale con prenotazione integrata.",
    sections: [{ h: "Cosa puoi fare", items: ["Imposta nome, dominio, colore e sezioni da mostrare.", "Scegli le lingue del sito.", "Il motore di prenotazione è lo stesso del Widget: prenotazioni dirette senza commissioni."] }],
  },
  "/metasearch": {
    title: "Meta Search",
    intro: "Porta il prezzo diretto sui comparatori (Google, Trivago…).",
    sections: [{ h: "Cosa puoi fare", items: ["Collega o scollega ogni comparatore.", "Le tariffe arrivano dal tuo Booking Engine diretto.", "L'ospite vede il tuo prezzo accanto alle OTA e prenota da te."] }],
  },
  "/registro": {
    title: "Registro attività",
    intro: "Lo storico automatico di tutto ciò che succede nel gestionale: chi ha fatto cosa e quando. Serve per controllo, sicurezza e per ricostruire cosa è cambiato — utile soprattutto quando lavorate in più persone.",
    sections: [
      { h: "Cosa registra", icon: "🗂️", items: ["Nuove prenotazioni, cancellazioni, spostamenti di camera, fuori servizio.", "Cambi tariffa, preventivi, pagamenti, messaggi inviati.", "Modifiche a strutture, tipologie, camere e alla guida ospiti.", "Accessi al gestionale.", "Vengono conservati gli ultimi 500 eventi."] },
      { h: "Filtri", icon: "🔎", items: ["Cerca per testo nella descrizione o nell'utente.", "Filtra per tipo di evento (prenotazioni, tariffe, configurazione…)."] },
      { h: "A cosa serve", icon: "✅", items: ["Capire chi ha modificato qualcosa quando ci sono più utenti o staff.", "Ricostruire la cronologia in caso di errori o contestazioni."] },
    ],
  },
};

export default function PageHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const guide = HELP[pathname];
  if (!guide) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} title="Guida della pagina" aria-label="Guida della pagina" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-sm font-bold text-dim transition hover:bg-wash hover:text-txt">?</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
          <button aria-label="Chiudi" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-focus text-sm font-bold text-white">?</span>
                <h2 className="font-display text-lg font-bold text-txt">Guida · {guide.title}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
            </div>
            {guide.intro && <p className="mb-4 text-sm text-dim">{guide.intro}</p>}
            <div className="flex flex-col gap-4">
              {guide.sections.map((sec, i) => (
                <div key={i}>
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-txt">{sec.icon && <span className="text-base leading-none">{sec.icon}</span>}{sec.h}</div>
                  <ul className="flex flex-col gap-1.5">
                    {sec.items.map((it, j) => (
                      <li key={j} className="flex gap-2 text-sm text-dim"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-focus" />{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
