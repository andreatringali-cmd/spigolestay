"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

interface Guide {
  title: string;
  intro?: string;
  sections: { h: string; items: string[] }[];
}

// Guida per pagina: "cosa puoi fare e come".
const HELP: Record<string, Guide> = {
  "/": {
    title: "Dashboard",
    intro: "Il colpo d'occhio sulla giornata scelta. Cambia la data per vedere qualsiasi giorno.",
    sections: [
      { h: "Cosa vedi", items: ["Le card in alto (Prenotazioni attive, In struttura, Arrivi, Partenze) e i dati del giorno (camere occupate, ADR, RevPAR, incassi).", "I grafici del giorno: canali, ricavi, occupazione per struttura, andamento 30 giorni."] },
      { h: "Cosa puoi fare", items: ["Clicca una card in alto per filtrare i movimenti sotto (es. solo gli arrivi).", "Usa il selettore struttura in alto a destra per restringere a una sola struttura.", "In fondo, la checklist \"Da fare oggi\": spunta i messaggi di check-in/out, la tassa, la recensione e l'invio del planning pulizie."] },
    ],
  },
  "/prenotazioni": {
    title: "Prenotazioni",
    intro: "L'elenco di tutte le prenotazioni in corso e future.",
    sections: [
      { h: "Filtra e ordina", items: ["Cerca per nome o codice; filtra per struttura/camera, canale e data (arrivo o data prenotazione).", "Clicca l'intestazione di una colonna (con la freccia) per ordinare; ri-clicca per invertire."] },
      { h: "Azioni", items: ["Clicca una riga per aprire la scheda della prenotazione (e da lì Modifica).", "\"+ Nuova\" crea una prenotazione diretta; \"Esporta\" salva in Excel o PDF.", "Le colonne Commissioni e Netto mostrano la quota OTA (modificabile per singola prenotazione nella scheda)."] },
    ],
  },
  "/calendario": {
    title: "Calendario",
    intro: "Il planning visivo per camera. Scegli \"Oggi\" (30 giorni) o \"Mese\" con le frecce.",
    sections: [
      { h: "Inserire", items: ["1 click su una cella per iniziare, poi 1 click sul giorno finale: scegli Preventivo, Prenotazione o Fuori servizio.", "Stesso giorno due volte = un solo giorno.", "Doppio-click su un giorno (intestazione) per creare un evento (sagra, ponte…) e ricordarti di alzare i prezzi."] },
      { h: "Tariffe e disponibilità", items: ["Ogni tipologia ha la sua riga Tariffa e Disponibilità.", "Click sul giorno iniziale della Tariffa → click sul finale → imposti importo fisso o ±% per quella tipologia.", "Trascina una prenotazione in verticale per spostarla di camera (le date non cambiano)."] },
    ],
  },
  "/pulizie": {
    title: "Planning pulizie",
    intro: "Cosa fare in ogni camera oggi, pronto da inviare a chi pulisce.",
    sections: [
      { h: "Leggere", items: ["Le card in alto (Da fare, Riassetti, Partenze, Arrivi) filtrano il planning al clic.", "Ogni camera mostra l'azione: partenza, arrivo, riassetto o \"partenza + arrivo\" (turnover, con chi parte e chi arriva)."] },
      { h: "Condividere", items: ["Aggiungi note per camera e spunta \"Segna fatta\".", "\"Condividi\" apre WhatsApp col programma già scritto; \"Copia\" lo mette negli appunti."] },
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
    intro: "Crea un preventivo e invialo; se confermato, trasformalo in prenotazione.",
    sections: [
      { h: "Creare", items: ["Scegli struttura, date e ospiti: il prezzo si compila dalle tariffe del calendario (poi modificabile).", "Tassa di soggiorno, colazione e parcheggio entrano nel totale; scegli l'acconto (0/50/100%).", "L'anteprima è modificabile a mano; invia su WhatsApp/Email o genera il PDF su carta intestata."] },
      { h: "Archivio", items: ["Ogni preventivo è numerato e datato.", "\"Modifica\" lo ricarica nel form; \"Conferma\" crea la prenotazione e prepara la conferma con i dati di pagamento."] },
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
};

export default function PageHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const guide = HELP[pathname];
  if (!guide) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} title="Guida della pagina" aria-label="Guida della pagina" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-focus bg-[color:color-mix(in_srgb,var(--focus)_10%,transparent)] text-sm font-bold text-focus transition hover:bg-[color:color-mix(in_srgb,var(--focus)_18%,transparent)]">?</button>
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
                  <div className="mb-1.5 text-sm font-semibold text-txt">{sec.h}</div>
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
