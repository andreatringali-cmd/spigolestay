"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";

// Forma dati "guida" = window.PROPERTY del motore (public/guida). Multi-tenant: una per struttura.
interface Guide {
  id: string; guideName: string; guideLogo: string; name: string; city: string; address: string;
  phone: string; phoneGreta: string; whatsapp: string; email: string; mapsUrl: string;
  wifiNetwork: string; wifiPassword: string; checkinTime: string; checkoutTime: string;
  reviewUrl: string; bookingUrl: string; taxiPhone: string;
  social: { instagram: string; facebook: string; website: string };
  roomTypes: Record<string, string>;
  tv?: { enabled: boolean; bg: string; welcome: string; sections: string[]; showGuest: boolean };
  content?: GContent;
  i18n?: Partial<Record<string, GContent>>; // traduzioni automatiche per lingua (en/fr/de/es); base = italiano
}
const TV_SECTIONS: [string, string][] = [["checkin", "Arrivo / Check-in"], ["wifi", "WiFi"], ["breakfast", "Colazione"], ["attractions", "Esplorare"], ["restaurants", "Dove mangiare"], ["excursions", "Mare / Escursioni"], ["taxi", "Taxi / Trasporti"], ["info", "Info utili"], ["faq", "FAQ"], ["extras", "Servizi extra"], ["contacts", "Contatti"], ["review", "Recensioni"]];

interface GAction { label: string; href: string; type?: string; icon?: string }
interface GListRow { n: string; sub: string; tel?: string }
interface GItem { h: string; p: string; actions?: GAction[]; list?: GListRow[] }
// Passaggio numerato (check-in, colazione). `code` = quale codice del link ospite mostrare sotto.
interface GStep { h: string; p: string; code?: "" | "gate" | "door" | "door2"; codeNote?: string; actions?: GAction[] }
interface GAmenity { icon: string; label: string }
interface GSection {
  id: string; icon: string; title: string; sub: string; intro: string; photos: string[]; items: GItem[];
  steps?: GStep[]; amenities?: GAmenity[]; amenitiesTitle?: string; amenitiesIntro?: string;
  hidden?: boolean; // nascosta manualmente dall'host (non appare nella guida ospiti)
}
// Ordine fisso delle sezioni nell'editor: identico a come la guida ospiti le mostra
// (vedi public/guida/js/content.js). Le sezioni non in elenco (personalizzate) vanno in fondo.
const SECTION_ORDER = ["checkin", "breakfast", "wifi", "attractions", "restaurants", "excursions", "taxi", "info", "faq", "extras", "contacts", "review"];
// Operative "pure": i contenuti arrivano dai dati struttura, quindi non contano come "vuote".
const FUNC_IDS = new Set(["wifi", "contacts", "review"]);
// Una sezione è "compilata" se ha almeno un contenuto reale (altrimenti la guida la nasconde da sola).
function sectionFilled(s: GSection): boolean {
  if (s.intro && s.intro.trim()) return true;
  if (s.photos && s.photos.length) return true;
  if (s.amenities && s.amenities.length) return true;
  if (s.steps && s.steps.some((st) => (st.h && st.h.trim()) || (st.p && st.p.trim()))) return true;
  if (s.items && s.items.some((it) => (it.h && it.h.trim()) || (it.p && it.p.trim()) || (it.list && it.list.length))) return true;
  return false;
}
const ACT_KINDS: { k: string; label: string; type: string; icon: string }[] = [
  { k: "link", label: "Link", type: "", icon: "info" },
  { k: "wa", label: "WhatsApp", type: "wa", icon: "chat" },
  { k: "tel", label: "Telefono", type: "tel", icon: "phone" },
  { k: "mail", label: "Email", type: "mail", icon: "info" },
  { k: "map", label: "Mappa", type: "", icon: "pin" },
];
const kindOf = (a: GAction) => (a.type === "wa" ? "wa" : a.type === "tel" ? "tel" : a.type === "mail" ? "mail" : a.icon === "pin" ? "map" : "link");
// Limiti caratteri calibrati sull'esempio Spigolehouse: mantengono la grafica impeccabile.
const LIM = { guideName: 40, name: 60, wtitle: 30, wsub: 70, welcome: 420, title: 45, sub: 70, intro: 260, h: 55, p: 950, alabel: 34, ln: 44, lsub: 56, ltel: 22 };
interface GContent { home: { welcomeTitle: string; welcomeSub?: string; welcome: string[] }; sections: GSection[] }
const ICON_OPTS = ["key", "wifi", "coffee", "temple", "pizza", "beach", "taxi", "info", "sparkle", "star", "phone", "bed", "pin", "calendar"];
// wifi/contacts/review restano operative "pure" (credenziali e contatti automatici dai dati struttura).
const FUNC_SECTIONS = ["wifi", "contacts", "review"];
// Sezioni a PASSAGGI numerati compilabili dall'host (check-in, colazione).
const STEP_SECTIONS = new Set(["checkin", "breakfast"]);
// Il check-in ha anche la griglia dei servizi camera.
const AMENITY_SECTIONS = new Set(["checkin"]);
// Codice del link ospite da mostrare sotto un passaggio (non è mai nel DB pubblico).
const CODE_OPTS: { v: "" | "gate" | "door" | "door2"; label: string }[] = [
  { v: "", label: "Nessun codice" },
  { v: "gate", label: "Codice cancello/portone" },
  { v: "door", label: "Codice porta/cassetta" },
  { v: "door2", label: "Codice 2ª porta/cassetta" },
];
// Icone disponibili per i servizi camera (sottoinsieme del set del motore).
const AMENITY_ICONS = ["snow", "tv", "wind", "towel", "sparkle", "coffee", "fridge", "drop", "iron", "balcony", "bed", "laundry", "wifi"];
// Sezioni con GALLERIA foto in ALTO (come nell'originale: le foto vanno solo dove servono).
// Il check-in NON è qui: le sue foto della camera vanno DOPO i passaggi (vedi editor).
const GALLERY_SECTIONS = new Set(["attractions", "excursions"]);
// Sezioni a ELENCO (voci nome · indirizzo · tel, come i ristoranti dell'originale).
const LIST_SECTIONS = new Set(["restaurants", "excursions", "taxi", "info"]);
// Forma per-sezione: etichette e aiuti così l'editor rispecchia l'originale (foto dove vanno le foto,
// più descrizioni dove servono, elenchi dove vanno gli elenchi).
const SEC_BLOCKS: Record<string, { label: string; add: string; hint?: string; hPh?: string }> = {
  checkin: { label: "Altre informazioni", add: "+ Blocco", hint: "Blocchi finali dopo i passaggi (documenti, check-out e tassa, regole della casa).", hPh: "Titolo blocco" },
  breakfast: { label: "Note aggiuntive", add: "+ Blocco", hPh: "Titolo blocco" },
  attractions: { label: "Luoghi da vedere", add: "+ Luogo", hint: "Foto in galleria sopra; qui una descrizione per luogo con il pulsante mappa.", hPh: "Nome del luogo" },
  restaurants: { label: "Categorie di locali", add: "+ Categoria", hint: "Una categoria per blocco (es. 🍕 Pizzerie), poi l'elenco dei locali con indirizzo e telefono.", hPh: "Categoria (es. 🍕 Pizzerie)" },
  excursions: { label: "Mare ed escursioni", add: "+ Voce", hint: "Descrizione + elenco di spiagge/gite; aggiungi il pulsante mappa dove serve.", hPh: "Titolo (es. Spiagge)" },
  taxi: { label: "Trasporti", add: "+ Voce", hint: "Una voce per mezzo, con il pulsante per chiamare o le info.", hPh: "Titolo (es. Servizio taxi)" },
  info: { label: "Informazioni", add: "+ Voce", hint: "Servizi, emergenze e note pratiche.", hPh: "Titolo (es. Farmacia)" },
  faq: { label: "Domande e risposte", add: "+ Domanda", hint: "Una domanda per blocco con la risposta.", hPh: "Domanda" },
  extras: { label: "Servizi extra", add: "+ Servizio", hint: "Servizi aggiuntivi con eventuale pulsante di richiesta.", hPh: "Nome del servizio" },
};
// Template fedele alla struttura dell'originale: ogni sezione ha la SUA forma.
const DEFAULT_CONTENT: GContent = {
  home: { welcomeTitle: "Benvenuti,", welcomeSub: "siamo felici di ospitarvi", welcome: ["siamo davvero felici di accogliervi!", "Questa guida vi aiuterà a scoprire la città e a vivere al meglio il vostro soggiorno.", "Buona permanenza!"] },
  sections: [
    { id: "checkin", icon: "key", title: "Arrivo e Self Check-in", sub: "Come raggiungerci ed entrare in camera", intro: "Potete arrivare in piena libertà. Ecco come entrare.", photos: [],
      steps: [
        { h: "Dove siamo", p: "Indirizzo e come raggiungerci (riferimenti utili all'arrivo).", code: "", actions: [{ label: "Apri la mappa", href: "{mapsUrl}", icon: "pin" }] },
        { h: "Aprite il portone", p: "Come aprire il portone/cancello. Il codice arriva col link personale prima dell'arrivo.", code: "gate" },
        { h: "Le vostre chiavi", p: "Dove trovare le chiavi o la cassetta di sicurezza al vostro piano.", code: "door" },
        { h: "Fatemi sapere", p: "Scriveteci quando siete arrivati: per qualsiasi cosa siamo qui.", code: "", actions: [{ label: "Scrivici su WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
      ],
      amenitiesTitle: "I servizi della vostra camera", amenitiesIntro: "Abbiamo curato ogni dettaglio per il vostro riposo.",
      amenities: [
        { icon: "snow", label: "Aria condizionata" }, { icon: "tv", label: "Smart TV" }, { icon: "wind", label: "Asciugacapelli" },
        { icon: "towel", label: "Biancheria fresca" }, { icon: "sparkle", label: "Set di cortesia" }, { icon: "coffee", label: "Macchina del caffè" },
      ],
      items: [
        { h: "Documenti", p: "Per la registrazione servono i documenti di tutti gli ospiti: una foto fronte/retro su WhatsApp, anche prima dell'arrivo.", actions: [{ label: "Invia i documenti", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Check-out e tassa di soggiorno", p: "Check-out {checkoutTime}. Indicate qui come lasciare le chiavi e l'importo della tassa di soggiorno." },
        { h: "Non si fuma 🚭", p: "È vietato fumare all'interno. Grazie per la collaborazione!" },
      ] },
    { id: "wifi", icon: "wifi", title: "WiFi gratuito", sub: "Rete e password", intro: "", photos: [], items: [] },
    { id: "breakfast", icon: "coffee", title: "La colazione", sub: "Come e dove", intro: "Ecco dove e quando fare colazione.", photos: [],
      steps: [
        { h: "Dove", p: "Locale/indirizzo e orari della colazione.", code: "", actions: [{ label: "Apri la mappa", href: "", icon: "pin" }] },
      ],
      items: [] },
    // Attrazioni: galleria foto in alto + più descrizioni ricche con pulsanti mappa.
    { id: "attractions", icon: "temple", title: "Cosa vedere", sub: "La città a portata di mano", intro: "Dalla struttura ecco cosa non perdere.", photos: [],
      items: [
        { h: "Il centro storico", p: "Descrivi il cuore della città: piazze, monumenti, punti panoramici. Usa una riga per punto.", actions: [{ label: "Apri la mappa", href: "", icon: "pin" }] },
        { h: "Musei e cultura", p: "Musei, chiese, luoghi d'arte da visitare.", actions: [{ label: "Apri la mappa", href: "", icon: "pin" }] },
      ] },
    // Ristoranti: nessuna foto, categorie con ELENCO di locali (nome · indirizzo · tel).
    { id: "restaurants", icon: "pizza", title: "Dove mangiare e bere", sub: "I nostri consigli, tutti vicini", intro: "I migliori locali qui vicino. Nel weekend conviene prenotare!", photos: [],
      items: [
        { h: "🍕 Pizzerie", p: "", list: [{ n: "Nome locale", sub: "Indirizzo", tel: "+39 …" }] },
        { h: "🍽️ Ristoranti", p: "", list: [{ n: "Nome locale", sub: "Indirizzo", tel: "+39 …" }] },
        { h: "🥂 Aperitivi", p: "", list: [{ n: "Nome locale", sub: "Indirizzo", tel: "+39 …" }] },
      ] },
    // Mare/escursioni: galleria + descrizioni con elenchi di spiagge/gite.
    { id: "excursions", icon: "beach", title: "Mare ed escursioni", sub: "Spiagge, natura e dintorni", intro: "Come godersi il mare e i dintorni.", photos: [],
      items: [
        { h: "Spiagge e calette", p: "Descrivi le spiagge migliori.", list: [{ n: "Nome spiaggia", sub: "zona · distanza", tel: "" }] },
        { h: "Dintorni consigliati", p: "Gite di mezza giornata nei dintorni.", actions: [{ label: "Apri la mappa", href: "", icon: "pin" }] },
      ] },
    // Trasporti: descrizioni + contatti taxi.
    { id: "taxi", icon: "taxi", title: "Taxi e trasporti", sub: "Spostarsi senza auto", intro: "", photos: [],
      items: [
        { h: "Servizio taxi", p: "Come chiamare un taxi in città.", actions: [{ label: "Chiama taxi", href: "", type: "tel", icon: "phone" }] },
        { h: "Dall'aeroporto", p: "Come arrivare dall'aeroporto (bus, transfer).", actions: [{ label: "Info", href: "", icon: "info" }] },
      ] },
    // Info utili: servizi ed emergenze.
    { id: "info", icon: "info", title: "Informazioni utili", sub: "Servizi ed emergenze", intro: "", photos: [],
      items: [
        { h: "Spesa e farmacia", p: "Supermercato, farmacia e bancomat più vicini.", actions: [{ label: "Supermercato", href: "", icon: "pin" }] },
        { h: "Numeri di emergenza", p: "[[112]] — Emergenza unica europea\n[[118]] — Emergenza sanitaria", actions: [{ label: "112", href: "112", type: "tel", icon: "phone" }] },
      ] },
    { id: "faq", icon: "info", title: "Domande frequenti", sub: "Le risposte pratiche", intro: "", photos: [],
      items: [
        { h: "Aria condizionata", p: "Come funziona e le buone pratiche." },
        { h: "Orari di quiete", p: "Rispetto degli altri ospiti dopo una certa ora." },
      ] },
    { id: "extras", icon: "sparkle", title: "Servizi ed extra", sub: "Comodità in più su richiesta", intro: "", photos: [],
      items: [
        { h: "Culla / lettino", p: "Su richiesta, in base alla disponibilità." },
        { h: "Check-in anticipato / late check-out", p: "Scriveteci: cercheremo di venirvi incontro.", actions: [{ label: "Richiedi", href: "{whatsapp}", type: "wa", icon: "chat" }] },
      ] },
    { id: "contacts", icon: "phone", title: "Contatti", sub: "Siamo a disposizione", intro: "", photos: [], items: [] },
    { id: "review", icon: "star", title: "Lasciate una recensione", sub: "Il vostro supporto è prezioso", intro: "", photos: [], items: [] },
  ],
};

// Esempio già compilato (Siracusa, stile Spigolehouse): pronto da mostrare in demo.
// Usa le immagini d'esempio già presenti in public/guida/assets.
// Dati che appartengono alla STRUTTURA (vanno nelle Impostazioni struttura).
const DEMO_STRUCT = {
  address: "Corso Gelone 93", postalCode: "96100", province: "SR", city: "Siracusa",
  phone: "+39 331 000 0000", email: "info@spigolehouse.it",
  checkInFrom: "15:00", checkInTo: "00:00", checkOutBy: "10:30",
  instagram: "https://instagram.com/spigolehouse", website: "https://spigolehouse.it",
};
// Dati specifici della GUIDA (non della struttura).
const DEMO_GUIDE = {
  guideName: "Spigolehouse", phoneGreta: "+39 331 000 0001", whatsapp: "+39 331 000 0000", taxiPhone: "+39 0931 66666",
  wifiNetwork: "Spigolehouse WiFi", wifiPassword: "benvenuti2026",
  checkinTime: "15:00 – 00:00", checkoutTime: "entro le 10:30",
  reviewUrl: "https://www.google.com/maps/search/?api=1&query=Spigolehouse+Siracusa",
};
const DEMO_CONTENT: GContent = {
  home: { welcomeTitle: "Benvenuti a Siracusa,", welcomeSub: "siamo felici di ospitarvi", welcome: ["siamo davvero felici di accogliervi!", "Questa guida vi aiuterà a scoprire la città e a vivere al meglio il soggiorno.", "Buona permanenza!"] },
  sections: [
    { id: "checkin", icon: "key", title: "Arrivo e Self Check-in", sub: "Come raggiungerci ed entrare in camera", intro: "Potete arrivare in piena libertà. Ecco come entrare.",
      photos: ["assets/rooms/room-6.jpg", "assets/rooms/room-3.jpg", "assets/rooms/room-2.jpg"],
      steps: [
        { h: "Dove siamo", p: "Corso Gelone 93, subito dopo la chiesa di Santa Rita, sulla destra (cancello grigio).", code: "", actions: [{ label: "Apri la mappa", href: "{mapsUrl}", icon: "pin" }] },
        { h: "Aprite il cancello", p: "Digitate il codice sul tastierino sotto il citofono e premete il tasto centrale.", code: "gate" },
        { h: "Le vostre chiavi", p: "Per il portone interno e il key box al vostro piano, digitate il codice seguito dai due tasti laterali.", code: "door" },
        { h: "Benvenuti in camera!", p: "Troverete le chiavi appese direttamente alla porta della vostra camera. Sistematevi e rilassatevi!", code: "" },
        { h: "Fatemi sapere", p: "Scriveteci quando arrivate: per qualsiasi cosa siamo qui, a qualsiasi ora.", code: "", actions: [{ label: "Scrivici su WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
      ],
      amenitiesTitle: "I servizi della vostra camera", amenitiesIntro: "Abbiamo curato ogni dettaglio per il vostro riposo.",
      amenities: [
        { icon: "snow", label: "Aria condizionata" }, { icon: "tv", label: "Smart TV" }, { icon: "sparkle", label: "Set di cortesia" },
        { icon: "wind", label: "Asciugacapelli" }, { icon: "towel", label: "Biancheria fresca" }, { icon: "coffee", label: "Macchina del caffè" },
      ],
      items: [
        { h: "Documenti", p: "Per la registrazione servono i documenti di tutti gli ospiti: una foto fronte/retro su WhatsApp, anche prima dell'arrivo.", actions: [{ label: "Invia i documenti", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Check-out e tassa di soggiorno", p: "Check-out {checkoutTime}. La tassa di soggiorno è il 4% del costo, max 5 € a persona per notte per le prime 7 notti; gli under 14 non pagano. Potete lasciarla in camera. Grazie!" },
        { h: "Non si fuma 🚭", p: "È vietato fumare all'interno del B&B e delle camere. Grazie per la collaborazione!" },
      ] },
    { id: "wifi", icon: "wifi", title: "WiFi gratuito", sub: "Rete e password", intro: "", photos: [], items: [] },
    { id: "breakfast", icon: "coffee", title: "La colazione", sub: "Nei bar convenzionati qui vicino", intro: "La colazione è servita nei bar convenzionati qui vicino, con i voucher che trovate in camera.",
      photos: [],
      steps: [
        { h: "Milk and Coffee", p: "Corso Gelone 22, sotto la struttura. Tutti i giorni tranne il sabato.", code: "", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=Milk+and+Coffee+Corso+Gelone+Siracusa", icon: "pin" }] },
        { h: "Bar Euripide", p: "Piazza Euripide 25, a tre minuti a piedi. Il sabato.", code: "", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=Bar+Euripide+Siracusa", icon: "pin" }] },
      ],
      items: [] },
    { id: "attractions", icon: "temple", title: "Cosa vedere", sub: "La città a portata di mano", intro: "La storia è a portata di mano: ecco cosa non perdere.",
      photos: ["assets/city/hero-ortigia.jpg"],
      items: [
        { h: "Ortigia, il cuore storico", p: "Piazza Duomo, Fonte Aretusa, Tempio di Apollo e Castello Maniace. Al mattino il mercato.", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=Ortigia+Siracusa", icon: "pin" }] },
        { h: "Neapolis e Teatro Greco", p: "A 5 minuti a piedi: Teatro Greco, Orecchio di Dionisio e le Latomie. In estate andateci presto.", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=Parco+Neapolis+Siracusa", icon: "pin" }] },
      ] },
    { id: "restaurants", icon: "pizza", title: "Dove mangiare e bere", sub: "I nostri consigli, tutti vicini", intro: "I migliori locali qui vicino. Nel weekend meglio prenotare!", photos: [],
      items: [
        { h: "🍕 Pizzerie", p: "", list: [{ n: "Piano B", sub: "Ortigia" }, { n: "Era Ora", sub: "Ortigia" }, { n: "1221", sub: "centro" }] },
        { h: "🍽️ Ristoranti", p: "", list: [{ n: "Agape", sub: "Ortigia" }, { n: "aLevante", sub: "Ortigia" }, { n: "Locanda Maniace", sub: "Ortigia" }] },
        { h: "🥂 Aperitivi e dolci", p: "", list: [{ n: "Barcollo", sub: "Ortigia" }, { n: "Caffè Apollo", sub: "Ortigia" }, { n: "Fratelli Burgio", sub: "mercato" }] },
      ] },
    { id: "excursions", icon: "beach", title: "Mare ed escursioni", sub: "Spiagge, natura e dintorni", intro: "Dalle calette cittadine alle riserve naturali.",
      photos: ["assets/city/hero-spiagge.jpg"],
      items: [
        { h: "Spiagge", p: "Arenella e Fontane Bianche; Vendicari se avete auto e tempo.", list: [{ n: "Fontane Bianche", sub: "~15 min in auto" }, { n: "Riserva di Vendicari", sub: "~40 min" }] },
        { h: "Snorkeling al Plemmirio", p: "Riserva marina protetta, mare pulito e grotte.", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=Plemmirio+Siracusa", icon: "pin" }] },
      ] },
    { id: "taxi", icon: "taxi", title: "Taxi e trasporti", sub: "Spostarsi senza auto", intro: "", photos: [],
      items: [
        { h: "Taxi", p: "Radio Taxi Siracusa, attivo 24 ore su 24.", actions: [{ label: "Chiama taxi", href: "{taxiPhone}", type: "tel", icon: "phone" }] },
        { h: "Dall'aeroporto di Catania", p: "Bus diretto per Siracusa: 55–70 minuti, 4–8 €.", actions: [{ label: "Info bus", href: "https://www.google.com/maps/search/?api=1&query=Bus+Aeroporto+Catania+Siracusa", icon: "info" }] },
      ] },
    { id: "info", icon: "info", title: "Informazioni utili", sub: "Servizi ed emergenze", intro: "", photos: [],
      items: [
        { h: "Spesa e farmacia", p: "Supermercati e farmacie lungo Corso Gelone; il turno notturno è esposto in vetrina.", actions: [{ label: "Supermercato", href: "https://www.google.com/maps/search/?api=1&query=supermercato+Corso+Gelone+Siracusa", icon: "pin" }] },
        { h: "Numeri di emergenza", p: "[[112]] — Emergenza unica europea\n[[118]] — Emergenza sanitaria\n[[1530]] — Emergenza in mare", actions: [{ label: "112", href: "112", type: "tel", icon: "phone" }] },
      ] },
    { id: "faq", icon: "info", title: "Domande frequenti", sub: "Le risposte pratiche", intro: "", photos: [],
      items: [
        { h: "Aria condizionata", p: "Accendetela col telecomando; tenete porte e finestre chiuse mentre è in funzione." },
        { h: "Orari di quiete", p: "Dopo le 22:00 abbassate i toni: ci sono altri ospiti e i vicini. Grazie!" },
      ] },
    { id: "extras", icon: "sparkle", title: "Servizi ed extra", sub: "Comodità in più su richiesta", intro: "", photos: [],
      items: [
        { h: "Culla / lettino", p: "Su richiesta, in base alla disponibilità." },
        { h: "Check-in anticipato / late check-out", p: "Scriveteci: cercheremo di venirvi incontro.", actions: [{ label: "Richiedi", href: "{whatsapp}", type: "wa", icon: "chat" }] },
      ] },
    { id: "contacts", icon: "phone", title: "Contatti", sub: "Siamo a disposizione", intro: "", photos: [], items: [] },
    { id: "review", icon: "star", title: "Lasciate una recensione", sub: "Il vostro supporto è prezioso", intro: "", photos: [], items: [] },
  ],
};

// Scaffold VUOTO per una guida nuova: le sezioni ci sono (id, icona, titolo) ma senza contenuti,
// così la guida ospiti parte vuota e si popola man mano che l'host compila. I testi pronti restano
// nell'esempio (telefono "Esempio" e tasto "Carica esempio").
// Titoli e sottotitoli presi dall'esempio (public/guida/js/content/it.js): così una guida nuova
// parte con le intestazioni giuste già pronte; l'host compila solo i contenuti interni.
const EXAMPLE_META: Record<string, { title: string; sub: string }> = {
  checkin: { title: "Arrivo e Self Check-in", sub: "Come raggiungerci ed entrare nella vostra camera" },
  breakfast: { title: "La vostra colazione", sub: "Nei migliori bar qui vicino, con i voucher" },
  wifi: { title: "WiFi gratuito", sub: "Rete e password" },
  attractions: { title: "Esplorare la città", sub: "La storia a portata di mano" },
  restaurants: { title: "Dove mangiare e bere", sub: "I migliori locali, tutti a piedi da qui" },
  excursions: { title: "Mare ed escursioni", sub: "Dalle calette cittadine alle riserve naturali" },
  taxi: { title: "Taxi e trasporti", sub: "Spostarsi senza auto" },
  info: { title: "Informazioni utili", sub: "Servizi ed emergenze" },
  faq: { title: "Domande frequenti", sub: "Le risposte pratiche, a portata di mano" },
  extras: { title: "Servizi ed extra", sub: "Chiedeteci pure, pensiamo a tutto noi" },
  contacts: { title: "Contatti", sub: "Siamo sempre a disposizione" },
  review: { title: "Lasciate una recensione", sub: "Il vostro supporto per noi è prezioso" },
};
const EMPTY_CONTENT: GContent = {
  // Nuova guida = tutto da compilare: nessun testo di benvenuto precaricato.
  home: { welcomeTitle: "", welcomeSub: "", welcome: [] },
  sections: DEFAULT_CONTENT.sections.map((s) => {
    const meta = EXAMPLE_META[s.id];
    const base = { id: s.id, icon: s.icon, title: meta?.title ?? s.title, sub: meta?.sub ?? s.sub, intro: "", photos: [] as string[] };
    // Operative (wifi/contatti/recensione): niente blocchi, i dati arrivano dalla struttura.
    if (FUNC_IDS.has(s.id)) return { ...base, items: [] as GItem[] };
    // Sezioni a passaggi (arrivo/colazione): una riga passaggio già pronta + eventuali servizi camera.
    if (s.steps) return {
      ...base, items: [] as GItem[], steps: [{ h: "", p: "" }] as GStep[],
      ...(s.amenities ? { amenities: [] as GAmenity[], amenitiesTitle: s.amenitiesTitle, amenitiesIntro: s.amenitiesIntro } : {}),
    };
    // Sezioni a contenuti (città, ristoranti, faq…): un blocco già pronto da compilare.
    return { ...base, items: [{ h: "", p: "" }] as GItem[] };
  }),
};
// Ridimensiona e comprime l'immagine prima di salvarla: le foto a piena risoluzione come base64
// saturerebbero il localStorage (~5MB) e farebbero fallire TUTTI i salvataggi successivi.
const compressImage = (file: File, maxDim: number, quality: number, fmt: string = "image/jpeg"): Promise<string> => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => {
    const src = r.result as string;
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) { const s = maxDim / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(src); return; }
      ctx.drawImage(img, 0, 0, width, height);
      try { resolve(canvas.toDataURL(fmt, quality)); } catch { resolve(src); }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  };
  r.onerror = () => resolve("");
  r.readAsDataURL(file);
});
// Definiti a livello di modulo: se stessero dentro il componente verrebbero ricreati a ogni
// render e React rimonterebbe gli input (focus perso → si scrive un carattere alla volta).
const fld = "w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-[15px] text-txt outline-none focus:border-focus";
// Campo in sola lettura: il dato arriva dalle Impostazioni struttura, qui non si modifica.
const fldRO = "w-full rounded-lg border border-line bg-wash px-3.5 py-2.5 text-[15px] text-dim outline-none cursor-not-allowed";
const F = ({ label, children }: { label: string; children: React.ReactNode }) => (<label className="block text-xs font-medium text-dim">{label}<div className="mt-1">{children}</div></label>);
const emptyGuide = (id: string, name: string, city: string): Guide => ({
  id, guideName: name, guideLogo: "assets/logo-trasparente.png", name, city, address: "",
  phone: "", phoneGreta: "", whatsapp: "", email: "", mapsUrl: "",
  wifiNetwork: "", wifiPassword: "", checkinTime: "", checkoutTime: "",
  reviewUrl: "", bookingUrl: "", taxiPhone: "",
  social: { instagram: "", facebook: "", website: "" }, roomTypes: {},
  tv: { enabled: false, bg: "", welcome: "", sections: [], showGuest: true },
});

// ---- Traduzione automatica (frontend-only, via MyMemory: gratuita e CORS-enabled) ----
// Base = italiano. Segnaposto {…} e markup [[ ]]/[i]/[u] vengono "protetti" con token
// che il traduttore non tocca, e poi ripristinati. I nomi propri/indirizzi/telefoni
// (elenchi, href) NON vengono tradotti.
const TR_LANGS = ["en", "fr", "de", "es"];
const PH_RE = /\{[^}]+\}|\[\[|\]\]|\[i\]|\[\/i\]|\[u\]|\[\/u\]/g;
async function trOne(text: string, to: string): Promise<string> {
  const store: string[] = [];
  const prot = text.replace(PH_RE, (m) => { store.push(m); return `❨${store.length - 1}❩`; });
  if (!prot.replace(/❨\d+❩/g, "").trim()) return text; // solo segnaposto/spazi → niente da tradurre
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(prot)}&langpair=it|${to}`;
  const r = await fetch(url);
  const j = await r.json();
  const out: string = j?.responseData?.translatedText || "";
  if (!out || j.responseStatus !== 200 || /MYMEMORY WARNING|QUOTA/i.test(out)) throw new Error("mt");
  return out.replace(/❨\s*(\d+)\s*❩/g, (_m, i) => store[+i] ?? "");
}
async function translateContent(content: GContent, to: string): Promise<GContent> {
  const cache = new Map<string, string>();
  const T = async (s?: string): Promise<string> => {
    if (!s || !s.trim()) return s ?? "";
    if (cache.has(s)) return cache.get(s)!;
    let out: string;
    if (s.includes("\n")) { const lines: string[] = []; for (const ln of s.split("\n")) lines.push(ln.trim() ? await trOne(ln, to) : ln); out = lines.join("\n"); }
    else out = await trOne(s, to);
    cache.set(s, out); return out;
  };
  const trActions = async (as?: GAction[]) => as ? await Promise.all(as.map(async (a) => ({ ...a, label: await T(a.label) }))) : as;
  const home = { welcomeTitle: await T(content.home.welcomeTitle), welcomeSub: await T(content.home.welcomeSub), welcome: [] as string[] };
  for (const w of content.home.welcome) home.welcome.push(await T(w));
  const sections: GSection[] = [];
  for (const s of content.sections) {
    const ns: GSection = { ...s, title: await T(s.title), sub: await T(s.sub), intro: await T(s.intro) };
    if (s.amenitiesTitle != null) ns.amenitiesTitle = await T(s.amenitiesTitle);
    if (s.amenitiesIntro != null) ns.amenitiesIntro = await T(s.amenitiesIntro);
    if (s.steps) { const st: GStep[] = []; for (const k of s.steps) st.push({ ...k, h: await T(k.h), p: await T(k.p), codeNote: k.codeNote ? await T(k.codeNote) : k.codeNote, actions: await trActions(k.actions) }); ns.steps = st; }
    if (s.amenities) ns.amenities = await Promise.all(s.amenities.map(async (a) => ({ ...a, label: await T(a.label) })));
    const items: GItem[] = [];
    for (const it of s.items) items.push({ ...it, h: await T(it.h), p: await T(it.p), actions: await trActions(it.actions) }); // liste (nomi/indirizzi) non tradotte
    ns.items = items;
    sections.push(ns);
  }
  return { home, sections };
}

export default function GuidaOspitiPage() {
  const { structures, units, roomTypes, activeStructureId, updateStructure, bookings, getUnit, getGuest, addActivity } = useData();
  // Registra nel "Registro attività" una voce per sessione di modifica della guida (non a ogni tasto).
  const loggedGuideSids = useRef<Set<string>>(new Set());
  const [sid, setSid] = useState(activeStructureId !== "all" ? activeStructureId : (structures[0]?.id ?? ""));
  // La struttura si sceglie dal selettore globale in alto (StructureSwitcher): qui la seguiamo.
  useEffect(() => { if (activeStructureId !== "all") setSid(activeStructureId); }, [activeStructureId]);
  const [all, setAll] = useState<Record<string, Guide>>({});
  const [previewKey, setPreviewKey] = useState(0);
  const [savedTick, setSavedTick] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false); // true quando i dati salvati sono stati caricati

  const [storageFull, setStorageFull] = useState(false);

  useEffect(() => { try { setAll(JSON.parse(localStorage.getItem("spigolestay:guides") || "{}")); } catch {} finally { setLoaded(true); } }, []);
  const persist = (next: Record<string, Guide>) => {
    setAll(next);
    try { localStorage.setItem("spigolestay:guides", JSON.stringify(next)); setStorageFull(false); }
    catch { setStorageFull(true); } // quota superata (di solito foto troppo pesanti): il salvataggio non è andato
  };

  const struct = structures.find((s) => s.id === sid);
  const guide = all[sid] ?? emptyGuide(sid, struct?.name ?? "", struct?.city ?? "Siracusa");
  const set = (patch: Partial<Guide>) => {
    // Prima modifica manuale di questa guida nella sessione → una voce nel registro attività.
    if (loaded && !loggedGuideSids.current.has(sid)) { loggedGuideSids.current.add(sid); addActivity("config", `Guida ospiti aggiornata${struct?.name ? " — " + struct.name : ""}`); }
    persist({ ...all, [sid]: { ...guide, ...patch, id: sid } });
  };
  const setSocial = (patch: Partial<Guide["social"]>) => set({ social: { ...guide.social, ...patch } });
  const tv = guide.tv ?? { enabled: false, bg: "", welcome: "", sections: [], showGuest: true };
  const setTv = (patch: Partial<NonNullable<Guide["tv"]>>) => set({ tv: { ...tv, ...patch } });
  const toggleTvSection = (id: string) => { const s = new Set(tv.sections); if (s.has(id)) s.delete(id); else s.add(id); setTv({ sections: [...s] }); };

  // Dati che appartengono alla STRUTTURA (non alla guida): arrivano dalle Impostazioni struttura,
  // qui si mostrano in sola lettura. Vengono anche scritti nel record guida così anteprima e link li usano.
  const structFields = useMemo<Partial<Guide>>(() => {
    const s = struct;
    const addr = [s?.address, s?.streetNumber].filter(Boolean).join(" ");
    const addrFull = [addr, [s?.postalCode, s?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const maps = (s?.lat && s?.lng) ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`
      : (addrFull ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrFull)}` : "");
    const out: Partial<Guide> = {
      name: s?.name ?? "", city: s?.city ?? "", guideLogo: s?.logo ?? "", address: addrFull, mapsUrl: maps,
      phone: s?.phone ?? "", email: s?.email ?? "", whatsapp: s?.whatsapp ?? "", phoneGreta: s?.phone2 ?? "",
      social: { instagram: s?.instagram ?? "", facebook: s?.facebook ?? "", website: s?.website ?? "" },
    };
    return out;
  }, [struct]);
  // Orari check-in/out: si SELEZIONANO con l'orologio (niente digitazione → niente errori).
  const tmatch = (str?: string) => (str || "").match(/\d{1,2}:\d{2}/g) || [];
  const ciFrom = tmatch(guide.checkinTime)[0] ?? "";
  const ciTo = tmatch(guide.checkinTime)[1] ?? "";
  const coBy = tmatch(guide.checkoutTime)[0] ?? "";
  const setCheckin = (from: string, to: string) => set({ checkinTime: from ? (to ? `${from} – ${to}` : from) : "" });
  const setCheckout = (by: string) => set({ checkoutTime: by ? `entro le ${by}` : "" });
  // Tiene il record guida allineato ai dati struttura (fonte di verità = Impostazioni struttura).
  // IMPORTANTE: non tocca nulla finché i dati salvati non sono stati caricati, altrimenti
  // al primo render (all ancora vuoto) sovrascriverebbe la guida salvata azzerando i contenuti.
  useEffect(() => {
    if (!loaded) return;
    const cur = all[sid];
    const base = cur ?? emptyGuide(sid, struct?.name ?? "", struct?.city ?? "Siracusa");
    // Lo scaffold delle sezioni è sempre presente: così le operative (contatti, WiFi, recensioni)
    // compaiono da sole appena la struttura ha i dati, senza che l'host scriva nulla.
    const merged = { ...base, ...structFields, content: base.content ?? EMPTY_CONTENT, id: sid, social: { ...base.social, ...(structFields.social ?? {}) } };
    if (JSON.stringify(cur ?? null) !== JSON.stringify(merged)) persist({ ...all, [sid]: merged });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, structFields, loaded]);

  const [tab, setTab] = useState<"setup" | "content">("setup");
  const [openSec, setOpenSec] = useState<string | null>(null);
  const content: GContent = guide.content ?? EMPTY_CONTENT;
  const setContent = (c: GContent) => set({ content: c });
  // "Contenuti pronti" = l'host ha scritto davvero qualcosa (non basta lo scaffold vuoto).
  const hasRealContent = !!(
    content.home.welcomeTitle?.trim() || content.home.welcomeSub?.trim() || content.home.welcome.join("").trim() ||
    content.sections.some((s) => (s.intro?.trim()) || (s.photos?.length) ||
      (s.items?.some((it) => it.h?.trim() || it.p?.trim() || (it.list?.length ?? 0))) ||
      (s.steps?.some((st) => st.h?.trim() || st.p?.trim())) || (s.amenities?.length))
  );
  const loadDemo = () => { if (guide.content && !confirm("Sostituire i contenuti attuali con l'esempio di Siracusa?")) return; updateStructure(sid, DEMO_STRUCT); set({ ...DEMO_GUIDE, content: DEMO_CONTENT, i18n: {} }); refresh(); };

  // Traduzione automatica multilingua (base italiano → EN/FR/DE/ES)
  const [tr, setTr] = useState<{ running: boolean; lang: string; done: number; total: number; ok?: boolean; err?: string }>({ running: false, lang: "", done: 0, total: 0 });
  const runTranslate = async () => {
    setTr({ running: true, lang: TR_LANGS[0], done: 0, total: TR_LANGS.length });
    const i18n: Partial<Record<string, GContent>> = { ...(guide.i18n || {}) };
    try {
      for (let i = 0; i < TR_LANGS.length; i++) {
        setTr({ running: true, lang: TR_LANGS[i], done: i, total: TR_LANGS.length });
        i18n[TR_LANGS[i]] = await translateContent(content, TR_LANGS[i]);
      }
      set({ content, i18n }); // salvo anche il contenuto base: senza, la guida resterebbe sul demo
      setTr({ running: false, lang: "", done: TR_LANGS.length, total: TR_LANGS.length, ok: true });
      refresh();
    } catch {
      setTr({ running: false, lang: "", done: 0, total: TR_LANGS.length, err: "Traduzione non riuscita (servizio occupato). Riprova tra qualche minuto." });
    }
  };
  const hasTranslations = !!guide.i18n && TR_LANGS.some((l) => guide.i18n![l]);
  const setHome = (patch: Partial<GContent["home"]>) => setContent({ ...content, home: { ...content.home, ...patch } });
  const updSection = (i: number, patch: Partial<GSection>) => setContent({ ...content, sections: content.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const removeSection = (i: number) => setContent({ ...content, sections: content.sections.filter((_, j) => j !== i) });
  const moveSection = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= content.sections.length) return; const arr = [...content.sections]; [arr[i], arr[j]] = [arr[j], arr[i]]; setContent({ ...content, sections: arr }); };
  const addSection = () => { const id = "extra" + Date.now().toString().slice(-4); setContent({ ...content, sections: [...content.sections, { id, icon: "sparkle", title: "Nuova sezione", sub: "", intro: "", photos: [], items: [{ h: "", p: "" }] }] }); setOpenSec(id); };
  const toggleHidden = (i: number) => updSection(i, { hidden: !content.sections[i].hidden });
  // Sezioni in ordine FISSO (come le mostra la guida), con l'indice reale per le modifiche.
  // Le personalizzate (id non standard) restano in fondo.
  const orderedSections = useMemo(() => {
    const idx = (id: string) => { const p = SECTION_ORDER.indexOf(id); return p === -1 ? 999 : p; };
    return content.sections.map((s, si) => ({ s, si })).sort((a, b) => idx(a.s.id) - idx(b.s.id));
  }, [content.sections]);
  // Guide già salvate prima dell'aggiunta di "extras": la aggiungo una volta (solo append, nessun riordino distruttivo).
  useEffect(() => {
    if (!guide.content) return; // le guide nuove partono già dai default completi
    const have = new Set(content.sections.map((s) => s.id));
    const missing = EMPTY_CONTENT.sections.filter((s) => !have.has(s.id));
    if (missing.length) setContent({ ...content, sections: [...content.sections, ...missing] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);
  const updItem = (si: number, ii: number, patch: Partial<GItem>) => updSection(si, { items: content.sections[si].items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });
  const addItem = (si: number) => updSection(si, { items: [...content.sections[si].items, { h: "", p: "" }] });
  const removeItem = (si: number, ii: number) => updSection(si, { items: content.sections[si].items.filter((_, j) => j !== ii) });
  const addPhoto = (si: number, url: string) => { if (url) updSection(si, { photos: [...content.sections[si].photos, url] }); };
  const removePhoto = (si: number, pi: number) => updSection(si, { photos: content.sections[si].photos.filter((_, j) => j !== pi) });
  const onLogo = async (f?: File) => { if (f) set({ guideLogo: await compressImage(f, 512, 0.9, "image/png") }); };
  const onSecPhoto = async (si: number, f?: File) => { if (f) { const d = await compressImage(f, 1400, 0.72); if (d) addPhoto(si, d); } };
  const acts = (si: number, ii: number) => content.sections[si].items[ii].actions ?? [];
  const addAction = (si: number, ii: number) => updItem(si, ii, { actions: [...acts(si, ii), { label: "", href: "", type: "", icon: "info" }] });
  const updAction = (si: number, ii: number, ai: number, patch: Partial<GAction>) => updItem(si, ii, { actions: acts(si, ii).map((a, j) => (j === ai ? { ...a, ...patch } : a)) });
  const setActionKind = (si: number, ii: number, ai: number, k: string) => { const kk = ACT_KINDS.find((x) => x.k === k)!; updAction(si, ii, ai, { type: kk.type, icon: kk.icon }); };
  const removeAction = (si: number, ii: number, ai: number) => updItem(si, ii, { actions: acts(si, ii).filter((_, j) => j !== ai) });
  const rows = (si: number, ii: number) => content.sections[si].items[ii].list ?? [];
  const addRow = (si: number, ii: number) => updItem(si, ii, { list: [...rows(si, ii), { n: "", sub: "", tel: "" }] });
  const updRow = (si: number, ii: number, ri: number, patch: Partial<GListRow>) => updItem(si, ii, { list: rows(si, ii).map((r, j) => (j === ri ? { ...r, ...patch } : r)) });
  const removeRow = (si: number, ii: number, ri: number) => updItem(si, ii, { list: rows(si, ii).filter((_, j) => j !== ri) });

  // Passaggi numerati (check-in / colazione)
  const steps = (si: number) => content.sections[si].steps ?? [];
  const addStep = (si: number) => updSection(si, { steps: [...steps(si), { h: "", p: "", code: "" }] });
  const updStep = (si: number, ki: number, patch: Partial<GStep>) => updSection(si, { steps: steps(si).map((s, j) => (j === ki ? { ...s, ...patch } : s)) });
  const removeStep = (si: number, ki: number) => updSection(si, { steps: steps(si).filter((_, j) => j !== ki) });
  const moveStep = (si: number, ki: number, dir: -1 | 1) => { const j = ki + dir; const arr = [...steps(si)]; if (j < 0 || j >= arr.length) return; [arr[ki], arr[j]] = [arr[j], arr[ki]]; updSection(si, { steps: arr }); };
  const stepActs = (si: number, ki: number) => steps(si)[ki].actions ?? [];
  const addStepAction = (si: number, ki: number) => updStep(si, ki, { actions: [...stepActs(si, ki), { label: "", href: "", type: "", icon: "info" }] });
  const updStepAction = (si: number, ki: number, ai: number, patch: Partial<GAction>) => updStep(si, ki, { actions: stepActs(si, ki).map((a, j) => (j === ai ? { ...a, ...patch } : a)) });
  const setStepActionKind = (si: number, ki: number, ai: number, k: string) => { const kk = ACT_KINDS.find((x) => x.k === k)!; updStepAction(si, ki, ai, { type: kk.type, icon: kk.icon }); };
  const removeStepAction = (si: number, ki: number, ai: number) => updStep(si, ki, { actions: stepActs(si, ki).filter((_, j) => j !== ai) });

  // Servizi camera (griglia iconcine, solo check-in)
  const amen = (si: number) => content.sections[si].amenities ?? [];
  const addAmen = (si: number) => updSection(si, { amenities: [...amen(si), { icon: "sparkle", label: "" }] });
  const updAmen = (si: number, ai: number, patch: Partial<GAmenity>) => updSection(si, { amenities: amen(si).map((a, j) => (j === ai ? { ...a, ...patch } : a)) });
  const removeAmen = (si: number, ai: number) => updSection(si, { amenities: amen(si).filter((_, j) => j !== ai) });

  // Link ospite
  const structUnits = units.filter((u) => u.roomTypeId && roomTypes.some((rt) => rt.id === u.roomTypeId && rt.structureId === sid));
  const [rooms, setRooms] = useState("");
  const [gate, setGate] = useState("");
  const [door, setDoor] = useState("");
  const [door2, setDoor2] = useState("");
  const [parking, setParking] = useState(true);
  const [docs, setDocs] = useState("");
  const [taxFixed, setTaxFixed] = useState(false);
  const [guestName, setGuestName] = useState("");

  // Collegamento con le prenotazioni: le prossime/attuali di questa struttura.
  const todayISO = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(() =>
    bookings.filter((b) => b.structureId === sid && b.checkOut >= todayISO && b.status !== "cancelled")
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn)),
    [bookings, sid, todayISO]);
  const [bkId, setBkId] = useState("");
  const pickBooking = (id: string) => {
    setBkId(id);
    const b = upcoming.find((x) => x.id === id);
    if (!b) { setGuestName(""); return; }
    const u = getUnit(b.unitId); const rt = roomTypes.find((r) => r.id === b.roomTypeId);
    setRooms(u?.code || u?.name || rt?.name || "");
    const g = getGuest(b.guestId);
    setGuestName(g ? `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim() : "");
  };
  const bkLabel = (b: typeof upcoming[number]) => {
    const g = getGuest(b.guestId); const u = getUnit(b.unitId); const rt = roomTypes.find((r) => r.id === b.roomTypeId);
    const nm = g ? `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim() : "Ospite";
    const d = (s: string) => s.slice(8, 10) + "/" + s.slice(5, 7);
    return `${nm} · ${u?.code || u?.name || rt?.name || "—"} · ${d(b.checkIn)}–${d(b.checkOut)}`;
  };

  const guestLink = useMemo(() => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const p = new URLSearchParams();
    p.set("p", sid);
    if (rooms.trim()) p.set("c", rooms.trim());
    const k = [gate.trim(), door.trim(), door2.trim()].join("-").replace(/-+$/g, "");
    if (k.replace(/-/g, "")) p.set("k", k);
    p.set("pk", parking ? "1" : "0");
    if (docs.trim()) p.set("d", docs.trim());
    if (taxFixed) p.set("tax", "fixed");
    if (guestName.trim()) p.set("g", guestName.trim());
    return `${base}/guida/index.html?${p.toString()}`;
  }, [sid, rooms, gate, door, door2, parking, docs, taxFixed, guestName]);

  // Messaggio WhatsApp precompilato per l'ospite.
  const waMsg = useMemo(() => {
    const first = guestName.trim().split(/\s+/)[0];
    return `Ciao${first ? " " + first : ""}! 👋\nEcco la vostra guida di ${guide.name || "benvenuto"}: al suo interno trovate check-in, WiFi, consigli sulla città e i nostri contatti.\n\n${guestLink}\n\nA presto!`;
  }, [guestName, guide.name, guestLink]);
  // Cartolina QR da stampare per la camera.
  const printCard = () => {
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&data=${encodeURIComponent(guestLink)}`;
    const w = window.open("", "_blank", "width=520,height=720");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Guida ospiti · QR</title>
      <style>*{margin:0;box-sizing:border-box;font-family:system-ui,Segoe UI,Arial}
      body{padding:40px;text-align:center;color:#14424F}
      .card{border:1px solid #e5e0d8;border-radius:24px;padding:36px 28px;max-width:400px;margin:0 auto}
      img.logo{height:52px;margin-bottom:14px}h1{font-size:22px;margin-bottom:4px}
      p.city{color:#8a8f98;margin-bottom:22px}img.qr{width:260px;height:260px}
      h2{font-size:18px;margin-top:20px}p.sub{color:#6b7280;font-size:14px;margin-top:6px}
      @media print{body{padding:0}.card{border:none}}</style></head>
      <body><div class="card">
      ${guide.guideLogo ? `<img class="logo" src="${guide.guideLogo}" onerror="this.style.display='none'">` : ""}
      <h1>${`Guida - ${guide.name || ""}`.replace(/</g, "")}</h1>
      <p class="city">${(guide.city || "").replace(/</g, "")}${rooms ? " · Camera " + rooms.replace(/</g, "") : ""}</p>
      <img class="qr" src="${qr}">
      <h2>Inquadra per la guida</h2>
      <p class="sub">Check-in, WiFi, consigli e contatti · IT · EN · FR · DE · ES</p>
      </div><script>onload=function(){setTimeout(function(){print()},400)}<\/script></body></html>`);
    w.document.close();
  };

  const tvUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/guida/tv.html?p=${encodeURIComponent(sid)}`;
  // Anteprima: telefono (guida mobile) o TV, in una delle 5 lingue.
  const [pvMode] = useState<"phone" | "tv">("phone");
  const [mainTab, setMainTab] = useState<"app" | "tv">("app"); // 📱 App cellulare · 📺 TV
  const [pvLang, setPvLang] = useState("it");
  useEffect(() => { try { localStorage.setItem("spigole_lang", pvLang); } catch {} }, [pvLang]);
  // I codici (cancello/porta) che scrivi vengono mostrati anche nell'anteprima di destra,
  // così vedi subito come appariranno sotto i passaggi di check-in.
  const codeK = [gate.trim(), door.trim(), door2.trim()].join("-").replace(/-+$/g, "");
  useEffect(() => { setPreviewKey((k) => k + 1); }, [pvMode, pvLang, gate, door, door2]);
  const previewUrl = pvMode === "tv"
    ? `/guida/tv.html?p=${encodeURIComponent(sid)}&lang=${pvLang}&_=${previewKey}`
    : `/guida/index.html?p=${encodeURIComponent(sid)}${codeK.replace(/-/g, "") ? `&k=${encodeURIComponent(codeK)}` : ""}&_=${previewKey}`;
  // Anteprima di ESEMPIO (Siracusa pronta): un id struttura inesistente fa cadere il motore
  // sull'esempio incluso nel pacchetto, senza toccare i dati reali dell'host.
  const exampleUrl = `/guida/index.html?p=__esempio__&_=${previewKey}`;
  const previewRef = useRef<HTMLIFrameElement>(null);
  // Ricarica l'anteprima conservando lingua (spigole_lang) e sezione corrente (hash), così vedi
  // la modifica sul punto in cui stai lavorando senza tornare alla welcome.
  const reloadPreview = () => { const w = previewRef.current?.contentWindow; if (w) { try { w.location.reload(); return; } catch { /* fallback */ } } setPreviewKey((k) => k + 1); };
  const refresh = () => reloadPreview();
  const savedThis = !!all[sid];

  // Anteprima in tempo reale: ogni modifica è già scritta in localStorage da set(); qui,
  // con un piccolo debounce, ricarichiamo l'iframe per rispecchiare subito ciò che compili.
  const guideSig = JSON.stringify(all[sid] ?? null);
  useEffect(() => {
    const t = setTimeout(() => reloadPreview(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideSig]);

  // Salvataggio automatico ogni 10 secondi: i dati sono già scritti in localStorage a ogni
  // modifica; qui, se qualcosa è cambiato dall'ultimo salvataggio, aggiorniamo l'anteprima e
  // mostriamo il segnale "Salvato" con l'orario, così non serve premere nulla.
  const sigRef = useRef(guideSig);
  useEffect(() => { sigRef.current = guideSig; }, [guideSig]);
  const savedSigRef = useRef(guideSig);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (sigRef.current === savedSigRef.current) return; // niente di nuovo da salvare
      savedSigRef.current = sigRef.current;
      setLastSaved(Date.now());
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 1500);
      reloadPreview();
    }, 10000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader
        title="Guida ospiti"
        subtitle="Una guida multilingua per struttura · personalizza e genera il link da inviare"
      />

      {/* App / TV: due card in alto */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:max-w-lg">
        {([["app", "📱", "App · cellulare", "La guida che l'ospite apre sul telefono"], ["tv", "📺", "TV in camera", "La schermata di benvenuto sulla Smart TV"]] as const).map(([key, icon, title, desc]) => (
          <button key={key} onClick={() => setMainTab(key)} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${mainTab === key ? "shadow-sm" : "border-line bg-surface hover:bg-wash"}`} style={mainTab === key ? { borderColor: "var(--focus)", backgroundColor: "color-mix(in srgb, var(--focus) 8%, transparent)" } : undefined}>
            <span className="text-2xl leading-none">{icon}</span>
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${mainTab === key ? "text-focus" : "text-txt"}`}>{title}</span>
              <span className="block text-[11px] leading-tight text-faint">{desc}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Riga filtri: a sinistra lo stato "Pronta", a destra i controlli dell'anteprima */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-faint">Pronta:</span>
          {([["Struttura", !!(guide.name && guide.address)], ["Contatti", !!(guide.whatsapp || guide.phone)], ["WiFi", !!(guide.wifiNetwork && guide.wifiPassword)], ["Contenuti", hasRealContent], ["Traduzioni", hasTranslations]] as [string, boolean][]).map(([lbl, ok]) => (
            <span key={lbl} className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${ok ? "text-white" : "bg-wash text-faint"}`} style={ok ? { backgroundColor: "var(--ok)" } : undefined}>{ok ? "✓" : "○"} {lbl}</span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-txt">Anteprima live</span>
          <span className="flex items-center gap-1 rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-faint"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: savedThis ? "var(--ok)" : "var(--faint)" }} />{savedThis ? "live" : "compila per vedere"}</span>
          <button onClick={refresh} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-dim hover:bg-wash">↻ Aggiorna</button>
          <select value={pvLang} onChange={(e) => setPvLang(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-dim outline-none focus:border-focus">
            <option value="it">🇮🇹 Italiano</option>
            <option value="en">🇬🇧 English</option>
            <option value="fr">🇫🇷 Français</option>
            <option value="de">🇩🇪 Deutsch</option>
            <option value="es">🇪🇸 Español</option>
          </select>
          <a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-dim hover:bg-wash">Schermo intero ↗</a>
          <button onClick={() => { savedSigRef.current = sigRef.current; setLastSaved(Date.now()); refresh(); setSavedTick(true); window.setTimeout(() => setSavedTick(false), 1500); }} title="Salvataggio automatico attivo · clicca per salvare subito" className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1 text-xs font-semibold text-dim hover:bg-wash">
            {savedTick
              ? <span className="flex items-center gap-1" style={{ color: "var(--ok)" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> Salvato</span>
              : <>💾 Salvataggio automatico{lastSaved ? ` · ${new Date(lastSaved).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}</>}
          </button>
        </div>
      </div>

      {storageFull && (
        <div className="mb-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--err)", backgroundColor: "color-mix(in srgb, var(--err) 8%, transparent)", color: "var(--err)" }}>
          ⚠️ Memoria piena: le ultime modifiche non sono state salvate. Di solito succede con foto troppo pesanti. Rimuovi qualche foto e riprova (le foto nuove ora vengono compresse in automatico; quelle caricate prima potrebbero occupare troppo spazio).
        </div>
      )}
      {mainTab === "app" && (<>
      <div className="grid gap-5 lg:grid-cols-[1.05fr_minmax(340px,0.92fr)]">
        {/* Pannello personalizzazione */}
        <div className="space-y-4">
        {(<>
          <div className="grid gap-4">
          <Card>
            <div className="flex items-center justify-between">
              <SectionTitle>Struttura e contatti</SectionTitle>
              <span className="flex items-center gap-1 rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-faint">🔒 dalle Impostazioni struttura</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Nome guida"><input value={`Guida - ${guide.name}`} disabled readOnly className={fldRO} /></F>
              <F label="Nome struttura"><input value={guide.name} disabled readOnly className={fldRO} /></F>
              <F label="Città"><input value={guide.city} disabled readOnly className={fldRO} /></F>
              <F label="Logo struttura"><input value={guide.guideLogo || "— nessun logo nelle impostazioni —"} disabled readOnly className={fldRO} /></F>
              <F label="Indirizzo"><input value={guide.address} disabled readOnly className={fldRO} /></F>
              <F label="Link Google Maps"><input value={guide.mapsUrl} disabled readOnly className={fldRO} /></F>
              <F label="Telefono"><input value={guide.phone} disabled readOnly className={fldRO} /></F>
              <F label="Email"><input value={guide.email} disabled readOnly className={fldRO} /></F>
              <F label="WhatsApp"><input value={guide.whatsapp} disabled readOnly className={fldRO} /></F>
              <F label="Telefono 2 (secondo contatto)"><input value={guide.phoneGreta} disabled readOnly className={fldRO} /></F>
              <F label="Instagram"><input value={guide.social.instagram} disabled readOnly className={fldRO} /></F>
              <F label="Facebook"><input value={guide.social.facebook} disabled readOnly className={fldRO} /></F>
              <F label="Sito web"><input value={guide.social.website} disabled readOnly className={fldRO} /></F>
            </div>
          </Card>


          </div>

        </>)}

        {(<>
          <Card>
            <SectionTitle>Home · benvenuto</SectionTitle>
            <F label="Titolo di benvenuto"><input value={content.home.welcomeTitle} maxLength={LIM.wtitle} onChange={(e) => setHome({ welcomeTitle: e.target.value })} className={fld} /></F>
            <div className="mt-3"><F label="Sottotitolo"><input value={content.home.welcomeSub ?? ""} maxLength={LIM.wsub} onChange={(e) => setHome({ welcomeSub: e.target.value })} className={fld} /></F></div>
            <div className="mt-3"><F label="Messaggio (una riga per paragrafo)"><textarea value={content.home.welcome.join("\n")} maxLength={LIM.welcome} onChange={(e) => setHome({ welcome: e.target.value.split("\n") })} rows={3} className={`${fld} resize-y`} /></F></div>
          </Card>


          <div className="flex items-center justify-between">
            <SectionTitle>Sezioni della guida ({content.sections.length})</SectionTitle>
            <button onClick={addSection} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash">+ Sezione</button>
          </div>
          {orderedSections.map(({ s, si }) => { const open = openSec === s.id; const func = FUNC_SECTIONS.includes(s.id); const custom = !SECTION_ORDER.includes(s.id); const opFilled = (s.id === "wifi" && !!(guide.wifiNetwork || guide.wifiPassword)) || (s.id === "contacts" && !!(guide.phone || guide.whatsapp || guide.phoneGreta)) || (s.id === "review" && !!guide.reviewUrl); const autoHidden = !s.hidden && !sectionFilled(s) && !opFilled; return (
            <Card key={s.id}>
              <div className="flex items-center gap-2">
                <button onClick={() => setOpenSec(open ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="text-faint">{open ? "▾" : "▸"}</span>
                  <span className={`truncate font-semibold ${s.hidden ? "text-faint line-through" : "text-txt"}`}>{s.title || s.id}</span>
                  {func && !autoHidden && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 18%, transparent)", color: "var(--ok)" }}>operativa</span>}
                  {s.hidden && <span className="shrink-0 rounded-full bg-wash px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">nascosta</span>}
                  {autoHidden && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>vuota · nascosta</span>}
                </button>
                <button onClick={() => toggleHidden(si)} title={s.hidden ? "Mostra nella guida ospiti" : "Nascondi dalla guida ospiti"} className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:bg-wash">{s.hidden ? "Mostra" : "Nascondi"}</button>
                {custom && <button onClick={() => removeSection(si)} title="Elimina sezione personalizzata" className="shrink-0 px-1 text-faint hover:text-[color:var(--err)]">✕</button>}
              </div>
              {open && (() => {
                // L'ordine dei campi rispecchia l'ordine con cui la guida mostra la sezione.
                const isCheckin = s.id === "checkin";
                const showGallery = GALLERY_SECTIONS.has(s.id) || isCheckin || s.photos.length > 0;
                const galleryUI = showGallery ? (
                  <div>
                    <div className="mb-1 text-xs font-medium text-dim">{isCheckin ? "Foto della camera" : "Galleria foto"} <span className="font-normal text-faint">{isCheckin ? "· mostrate dopo i passaggi" : "· scorrono in alto nella sezione"}</span></div>
                    <div className="flex flex-wrap gap-2">
                      {s.photos.map((ph, pi) => (<div key={pi} className="relative"><img src={ph} alt="" className="h-16 w-24 rounded border border-line object-cover" /><button onClick={() => removePhoto(si, pi)} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full text-[10px] text-white" style={{ backgroundColor: "var(--err)" }}>✕</button></div>))}
                      <label className="grid h-16 w-24 cursor-pointer place-items-center rounded border border-dashed border-line text-xs text-dim hover:bg-wash">+ Foto<input type="file" accept="image/*" className="hidden" onChange={(e) => onSecPhoto(si, e.target.files?.[0])} /></label>
                    </div>
                    <input placeholder="…o incolla un URL foto e premi Invio" onKeyDown={(e) => { if (e.key === "Enter") { addPhoto(si, (e.target as HTMLInputElement).value.trim()); (e.target as HTMLInputElement).value = ""; } }} className={`${fld} mt-2`} />
                  </div>
                ) : null;
                return (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  {autoHidden && <p className="rounded-lg bg-wash px-2.5 py-1.5 text-[11px] text-dim">✍️ Compila i campi qui sotto (passaggi, blocchi, foto, pulsanti…): la sezione comparirà nella guida ospiti solo quando ha un contenuto.</p>}
                  <div className="grid grid-cols-2 gap-3">
                    <F label="Titolo"><input value={s.title} maxLength={LIM.title} onChange={(e) => updSection(si, { title: e.target.value })} className={fld} /></F>
                    <F label="Sottotitolo"><input value={s.sub} maxLength={LIM.sub} onChange={(e) => updSection(si, { sub: e.target.value })} className={fld} /></F>
                  </div>
                  {/* Credenziali WiFi: qui, così stanno con la loro sezione (niente doppioni). */}
                  {s.id === "wifi" && (
                    <div className="grid grid-cols-2 gap-3">
                      <F label="Rete WiFi"><input value={guide.wifiNetwork} onChange={(e) => set({ wifiNetwork: e.target.value })} placeholder="Nome rete" className={fld} /></F>
                      <F label="Password WiFi"><input value={guide.wifiPassword} onChange={(e) => set({ wifiPassword: e.target.value })} placeholder="Password" className={fld} /></F>
                    </div>
                  )}
                  {/* Orari check-in / check-out: qui, nella sezione Arrivo (si scelgono con l'orologio). */}
                  {s.id === "checkin" && (
                    <div className="grid grid-cols-2 gap-3">
                      <F label="Check-in — dalle / alle">
                        <div className="flex items-center gap-2">
                          <input type="time" value={ciFrom} onChange={(e) => setCheckin(e.target.value, ciTo)} className={fld} />
                          <span className="text-dim">–</span>
                          <input type="time" value={ciTo} onChange={(e) => setCheckin(ciFrom, e.target.value)} className={fld} />
                        </div>
                      </F>
                      <F label="Check-out — entro le"><input type="time" value={coBy} onChange={(e) => setCheckout(e.target.value)} className={fld} /></F>
                    </div>
                  )}
                  {/* Link recensione: qui, nella sezione Recensioni. */}
                  {s.id === "review" && (
                    <F label="Link recensioni (Google)"><input value={guide.reviewUrl} onChange={(e) => set({ reviewUrl: e.target.value })} placeholder="https://…" className={fld} /></F>
                  )}
                  {/* Link prenotazione diretta: qui, nella sezione Contatti. */}
                  {s.id === "contacts" && (
                    <F label="Link prenotazione diretta"><input value={guide.bookingUrl} onChange={(e) => set({ bookingUrl: e.target.value })} placeholder="https://…" className={fld} /></F>
                  )}
                  {/* Galleria in alto: sezioni città (nell'app le foto stanno sopra l'introduzione) */}
                  {!isCheckin && !STEP_SECTIONS.has(s.id) && galleryUI}
                  <F label={`Introduzione (${s.intro.length}/${LIM.intro})`}><textarea value={s.intro} maxLength={LIM.intro} onChange={(e) => updSection(si, { intro: e.target.value })} rows={2} className={`${fld} resize-y`} /></F>
                  {/* PASSAGGI numerati (check-in / colazione): compilabili dall'host, codici dal link ospite */}
                  {STEP_SECTIONS.has(s.id) && (
                    <div>
                      <div className="mb-0.5 flex items-center justify-between"><span className="text-xs font-medium text-dim">Passaggi</span><button onClick={() => addStep(si)} className="text-xs font-semibold text-focus hover:underline">+ Passaggio</button></div>
                      <p className="mb-1.5 text-[11px] text-faint">Numerati automaticamente (1, 2, 3…). Il codice scelto compare sotto il passaggio e arriva dal link ospite: non è mai salvato nel database pubblico.</p>
                      <div className="space-y-2">
                        {steps(si).map((st, ki) => (
                          <div key={ki} className="rounded-lg border border-line bg-paper p-2">
                            <div className="flex items-center gap-2">
                              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-wash text-[10px] font-bold text-dim">{ki + 1}</span>
                              <input value={st.h} maxLength={LIM.h} onChange={(e) => updStep(si, ki, { h: e.target.value })} placeholder="Titolo del passaggio" className="flex-1 rounded border border-line bg-surface px-2 py-1 text-sm font-semibold text-txt outline-none focus:border-focus" />
                              <button onClick={() => moveStep(si, ki, -1)} title="Su" className="px-1 text-faint hover:text-txt">↑</button>
                              <button onClick={() => moveStep(si, ki, 1)} title="Giù" className="px-1 text-faint hover:text-txt">↓</button>
                              <button onClick={() => removeStep(si, ki)} className="text-faint hover:text-[color:var(--err)]">✕</button>
                            </div>
                            <textarea value={st.p} maxLength={LIM.p} onChange={(e) => updStep(si, ki, { p: e.target.value })} rows={2} placeholder="Descrizione…  ([[evidenziato]] · [i]corsivo[/i])" className="mt-1 w-full resize-y rounded border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <span className="text-[11px] text-faint">Codice sotto il passaggio:</span>
                              <select value={st.code || ""} onChange={(e) => updStep(si, ki, { code: e.target.value as GStep["code"] })} className="rounded border border-line bg-surface px-1.5 py-1 text-xs text-txt outline-none focus:border-focus">{CODE_OPTS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select>
                              {st.code && (
                                <input
                                  value={st.code === "gate" ? gate : st.code === "door" ? door : door2}
                                  onChange={(e) => { const v = e.target.value; if (st.code === "gate") setGate(v); else if (st.code === "door") setDoor(v); else setDoor2(v); }}
                                  placeholder="Scrivi il codice"
                                  className="w-32 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus"
                                />
                              )}
                              {st.code && (
                                <input
                                  value={st.codeNote ?? ""}
                                  onChange={(e) => updStep(si, ki, { codeNote: e.target.value })}
                                  placeholder="Nota dopo il codice (es. + tasto centrale)"
                                  className="min-w-[10rem] flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus"
                                />
                              )}
                            </div>
                            {st.code && <p className="mt-1 text-[11px] text-faint">Il codice appare sotto questo passaggio. Per sicurezza non viene salvato nella guida: puoi scriverlo qui (vale anche per il link ospite) oppure lasciarlo all&apos;ospite tramite il suo link personale. La &ldquo;nota dopo il codice&rdquo; sostituisce il &ldquo;#&rdquo; e appare accanto al codice.</p>}
                            <div className="mt-1.5">
                              {stepActs(si, ki).map((a, ai) => (
                                <div key={ai} className="mb-1 flex flex-wrap items-center gap-1.5">
                                  <input value={a.label} maxLength={LIM.alabel} onChange={(e) => updStepAction(si, ki, ai, { label: e.target.value })} placeholder="Etichetta pulsante" className="w-32 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus" />
                                  <input value={a.href} onChange={(e) => updStepAction(si, ki, ai, { href: e.target.value })} placeholder="link · numero · URL mappa" className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus" />
                                  <select value={kindOf(a)} onChange={(e) => setStepActionKind(si, ki, ai, e.target.value)} className="rounded border border-line bg-surface px-1.5 py-1 text-xs text-txt outline-none focus:border-focus">{ACT_KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}</select>
                                  <button onClick={() => removeStepAction(si, ki, ai)} className="text-faint hover:text-[color:var(--err)]">✕</button>
                                </div>
                              ))}
                              <button onClick={() => addStepAction(si, ki)} className="text-[11px] font-semibold text-focus hover:underline">+ Pulsante</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Foto della camera: nel check-in vanno DOPO i passaggi (come nell'app) */}
                  {isCheckin && galleryUI}
                  {/* SERVIZI CAMERA (griglia iconcine): solo check-in */}
                  {AMENITY_SECTIONS.has(s.id) && (
                    <div>
                      <div className="mb-0.5 flex items-center justify-between"><span className="text-xs font-medium text-dim">Servizi della camera</span><button onClick={() => addAmen(si)} className="text-xs font-semibold text-focus hover:underline">+ Servizio</button></div>
                      <div className="grid grid-cols-2 gap-3">
                        <F label="Titolo servizi"><input value={s.amenitiesTitle || ""} maxLength={LIM.title} onChange={(e) => updSection(si, { amenitiesTitle: e.target.value })} className={fld} /></F>
                        <F label="Intro servizi"><input value={s.amenitiesIntro || ""} maxLength={LIM.sub} onChange={(e) => updSection(si, { amenitiesIntro: e.target.value })} className={fld} /></F>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {amen(si).map((a, ai) => (
                          <div key={ai} className="flex items-center gap-1 rounded-lg border border-line bg-paper py-1 pl-1 pr-1.5">
                            <select value={a.icon} onChange={(e) => updAmen(si, ai, { icon: e.target.value })} className="rounded border border-line bg-surface px-1 py-1 text-xs text-txt outline-none focus:border-focus">{AMENITY_ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}</select>
                            <input value={a.label} maxLength={30} onChange={(e) => updAmen(si, ai, { label: e.target.value })} placeholder="Servizio" className="w-28 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus" />
                            <button onClick={() => removeAmen(si, ai)} className="text-faint hover:text-[color:var(--err)]">✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {func && <p className="text-[11px] text-faint">{s.id === "wifi" ? "Rete e password qui sopra: appaiono in automatico nella guida." : s.id === "contacts" ? "Telefono e WhatsApp arrivano in automatico dai dati struttura." : "Il link recensione qui sopra apre da solo la pagina Google."} Puoi comunque aggiungere blocchi di contenuto personalizzati qui sotto.</p>}
                  {(() => { const isList = LIST_SECTIONS.has(s.id); return (
                    <div>
                      <div className="mb-0.5 flex items-center justify-between"><span className="text-xs font-medium text-dim">{SEC_BLOCKS[s.id]?.label || "Contenuti"}</span><button onClick={() => addItem(si)} className="text-xs font-semibold text-focus hover:underline">{SEC_BLOCKS[s.id]?.add || "+ Blocco"}</button></div>
                      {SEC_BLOCKS[s.id]?.hint && <p className="mb-1.5 text-[11px] text-faint">{SEC_BLOCKS[s.id]?.hint}</p>}
                      <div className="space-y-2">
                        {s.items.map((it, ii) => { const hasList = isList || (it.list?.length ?? 0) > 0; return (
                          <div key={ii} className="rounded-lg border border-line bg-paper p-2">
                            <div className="flex items-center gap-2"><input value={it.h} maxLength={LIM.h} onChange={(e) => updItem(si, ii, { h: e.target.value })} placeholder={SEC_BLOCKS[s.id]?.hPh || "Titolo blocco"} className="flex-1 rounded border border-line bg-surface px-2 py-1 text-sm font-semibold text-txt outline-none focus:border-focus" />{!hasList && <span className="text-[10px] text-faint">{it.p.length}/{LIM.p}</span>}<button onClick={() => removeItem(si, ii)} className="text-faint hover:text-[color:var(--err)]">✕</button></div>
                            {/* Descrizione: nascosta nelle sezioni a elenco puro salvo testo già presente */}
                            {(!hasList || it.p) && <textarea value={it.p} maxLength={LIM.p} onChange={(e) => updItem(si, ii, { p: e.target.value })} rows={hasList ? 1 : 2} placeholder={hasList ? "Nota breve (facoltativa)…" : "Descrizione…  ([[evidenziato]] · [i]corsivo[/i] · [u]sottolineato[/u])"} className="mt-1 w-full resize-y rounded border border-line bg-surface px-2 py-1 text-sm text-txt outline-none focus:border-focus" />}
                            {/* Elenco voci (nome · indirizzo · tel): solo sezioni directory o item con elenco */}
                            {hasList && (
                              <div className="mt-1.5">
                                {(it.list ?? []).map((r, ri) => (
                                  <div key={ri} className="mb-1 flex flex-wrap items-center gap-1.5">
                                    <input value={r.n} maxLength={LIM.ln} onChange={(e) => updRow(si, ii, ri, { n: e.target.value })} placeholder="Nome" className="w-32 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus" />
                                    <input value={r.sub} maxLength={LIM.lsub} onChange={(e) => updRow(si, ii, ri, { sub: e.target.value })} placeholder="Indirizzo / note" className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus" />
                                    <input value={r.tel ?? ""} maxLength={LIM.ltel} onChange={(e) => updRow(si, ii, ri, { tel: e.target.value })} placeholder="Tel" className="w-24 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus" />
                                    <button onClick={() => removeRow(si, ii, ri)} className="text-faint hover:text-[color:var(--err)]">✕</button>
                                  </div>
                                ))}
                                <button onClick={() => addRow(si, ii)} className="text-[11px] font-semibold text-focus hover:underline">+ Voce</button>
                              </div>
                            )}
                            {/* Pulsanti (mappa, telefono, link…) */}
                            <div className="mt-1.5">
                              {(it.actions ?? []).map((a, ai) => (
                                <div key={ai} className="mb-1 flex flex-wrap items-center gap-1.5">
                                  <input value={a.label} maxLength={LIM.alabel} onChange={(e) => updAction(si, ii, ai, { label: e.target.value })} placeholder="Etichetta pulsante" className="w-32 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus" />
                                  <input value={a.href} onChange={(e) => updAction(si, ii, ai, { href: e.target.value })} placeholder="link · numero · URL mappa" className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-txt outline-none focus:border-focus" />
                                  <select value={kindOf(a)} onChange={(e) => setActionKind(si, ii, ai, e.target.value)} className="rounded border border-line bg-surface px-1.5 py-1 text-xs text-txt outline-none focus:border-focus">{ACT_KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}</select>
                                  <button onClick={() => removeAction(si, ii, ai)} className="text-faint hover:text-[color:var(--err)]">✕</button>
                                </div>
                              ))}
                              <div className="flex gap-3">
                                <button onClick={() => addAction(si, ii)} className="text-[11px] font-semibold text-focus hover:underline">+ Pulsante</button>
                                {!hasList && <button onClick={() => addRow(si, ii)} className="text-[11px] font-semibold text-focus hover:underline">+ Elenco</button>}
                              </div>
                            </div>
                          </div>
                        ); })}
                      </div>
                    </div>
                  ); })()}
                </div>
                ); })()}
            </Card>
          ); })}
          <p className="text-[11px] text-faint">I testi valgono per tutte le lingue (nella lingua in cui scrivi); la traduzione automatica multilingua è la fase successiva. Le stringhe dell&apos;interfaccia (Indietro, WiFi…) sono già tradotte IT/EN/FR/DE/ES.</p>
        </>)}
        </div>

        {/* Anteprima live */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          {pvMode === "phone" ? (
            // Mockup telefono: la guida è resa alla larghezza REALE di un telefono (390px) e poi
            // scalata, così tasti e proporzioni sono identici a uno smartphone vero (non "stirati").
            // Due telefoni affiancati: a sinistra l'esempio pronto (riferimento), a destra la TUA guida in tempo reale.
            <div className="flex items-start justify-center gap-3">
              {[
                { url: exampleUrl, lab: "Esempio", live: false },
                { url: previewUrl, lab: "Le tue modifiche", live: true },
              ].map((ph) => (
                <div key={ph.lab} className="min-w-0 flex-1">
                  <div className="relative mx-auto rounded-[2rem] border border-line bg-[#111318] px-1.5 pb-1.5 pt-4 shadow-xl">
                    <div className="absolute left-1/2 top-1.5 z-10 h-1 w-10 -translate-x-1/2 rounded-full bg-white/25" />
                    <div className="overflow-hidden rounded-[1.6rem] bg-black" style={{ aspectRatio: "390 / 844", maxHeight: "80vh" }}>
                      <iframe ref={ph.live ? previewRef : undefined} key={ph.lab + previewKey} src={ph.url} title={"Anteprima · " + ph.lab} style={{ border: 0 }} className="h-full w-full" />
                    </div>
                  </div>
                  <p className="mt-1.5 text-center text-[11px] font-semibold text-faint">{ph.lab}{ph.live && savedThis ? " · live" : ""}</p>
                </div>
              ))}
            </div>
          ) : (
            // Mockup TV: schermo 16:9 con cornice e piedini.
            <div className="mx-auto w-full">
              <div className="overflow-hidden rounded-xl border-[7px] border-[#111318] bg-black shadow-xl" style={{ aspectRatio: "16 / 9" }}>
                <iframe ref={previewRef} key={previewKey} src={previewUrl} className="h-full w-full" title="Anteprima TV" />
              </div>
              <div className="mx-auto mt-1 h-3 w-10 bg-[#111318]" style={{ clipPath: "polygon(30% 0,70% 0,100% 100%,0 100%)" }} />
              <div className="mx-auto h-1 w-28 rounded-full bg-[#111318]" />
              <p className="mt-2 text-center text-[11px] font-medium text-faint">Smart TV in camera · usa “Schermo intero” per la demo</p>
            </div>
          )}
          <p className="mt-2 text-[11px] text-faint">{pvMode === "tv" ? "Anteprima della vista TV (Smart TV in camera): si naviga col telecomando. " : "Anteprima della guida sul telefono dell'ospite. "}Si aggiorna in tempo reale mentre compili. Cambia lingua qui sopra per vedere le traduzioni; “Schermo intero” apre la vista completa per la demo.</p>
        </div>
      </div>
        {/* In fondo alla pagina: generatore link e vista TV */}
          {/* Generatore link ospite */}
          <Card>
            <SectionTitle>Genera e invia il link ospite</SectionTitle>
            {/* Collega alla prenotazione: camera, nome e date già pronti */}
            <div className="mb-3 rounded-lg border border-line bg-paper p-2.5">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Da una prenotazione</div>
              {upcoming.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select value={bkId} onChange={(e) => pickBooking(e.target.value)} className={`${fld} flex-1`}>
                    <option value="">— scegli l&apos;ospite in arrivo —</option>
                    {upcoming.map((b) => <option key={b.id} value={b.id}>{bkLabel(b)}</option>)}
                  </select>
                  {bkId && <button onClick={() => { setBkId(""); setGuestName(""); setRooms(""); }} className="rounded-lg border border-line px-2.5 py-2 text-xs font-medium text-dim hover:bg-wash">Azzera</button>}
                </div>
              ) : <p className="text-xs text-faint">Nessuna prenotazione in arrivo per questa struttura: compila i campi manualmente qui sotto.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Nome ospite (saluto in guida)"><input value={guestName} onChange={(e) => setGuestName(e.target.value)} className={fld} placeholder="es. Mario Rossi" /></F>
              <F label="Camera/e (es. 4 o 2,3)"><input value={rooms} onChange={(e) => setRooms(e.target.value)} className={fld} placeholder="numero camera" /></F>
              <F label="Codice cancello"><input value={gate} onChange={(e) => setGate(e.target.value)} className={fld} /></F>
              <F label="Codice porta/cassetta"><input value={door} onChange={(e) => setDoor(e.target.value)} className={fld} /></F>
              <F label="Codice 2 (facolt.)"><input value={door2} onChange={(e) => setDoor2(e.target.value)} className={fld} /></F>
              <F label="Portale documenti (URL)"><input value={docs} onChange={(e) => setDocs(e.target.value)} className={fld} placeholder="https://…" /></F>
            </div>
            <div className="mt-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-dim"><input type="checkbox" checked={parking} onChange={(e) => setParking(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> Parcheggio</label>
              <label className="flex items-center gap-2 text-sm text-dim"><input type="checkbox" checked={taxFixed} onChange={(e) => setTaxFixed(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> Tassa fissa</label>
            </div>
            {structUnits.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {structUnits.map((u) => (<button key={u.id} onClick={() => setRooms((r) => { const set2 = new Set(r.split(",").map((x) => x.trim()).filter(Boolean)); const n = (u.code || u.name); set2.has(n) ? set2.delete(n) : set2.add(n); return [...set2].join(","); })} className="rounded-full border border-line px-2.5 py-1 text-xs text-dim hover:bg-wash">{u.name}</button>))}
              </div>
            )}
            <div className="mt-3 flex gap-3">
              <div className="min-w-0 flex-1 rounded-lg border border-line bg-paper p-2.5">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Link (i codici viaggiano nel link, non nel DB pubblico)</div>
                <div className="break-all font-mono text-xs text-txt">{guestLink}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => navigator.clipboard?.writeText(guestLink)} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash"><Icon name="copy" size={14} /> Copia link</button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(waMsg)}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: "#25D366" }}><Icon name="chat" size={14} /> Invia su WhatsApp</a>
                  <a href={guestLink} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">Apri ↗</a>
                </div>
              </div>
              <div className="flex w-28 shrink-0 flex-col items-center gap-1.5">
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(guestLink)}`} alt="QR link ospite" className="h-24 w-24 rounded-lg border border-line bg-white p-1" />
                <button onClick={printCard} className="w-full rounded-lg border border-line px-2 py-1.5 text-xs font-semibold text-dim hover:bg-wash">🖨️ Stampa QR</button>
              </div>
            </div>
          </Card>

          {/* Traduzione automatica multilingua */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <SectionTitle>Traduzione automatica</SectionTitle>
                <p className="mt-0.5 text-[11px] text-faint">Scrivi in italiano: genero EN · FR · DE · ES per gli ospiti. Segnaposto, codici e link restano intatti; nomi e indirizzi degli elenchi non vengono tradotti.</p>
              </div>
              <div className="flex items-center gap-2">
                {tr.running && <span className="text-xs font-medium text-dim">Traduco {tr.lang.toUpperCase()}… ({tr.done}/{tr.total})</span>}
                {!tr.running && tr.ok && <span className="flex items-center gap-1 text-xs font-semibold text-[color:var(--ok)]">✓ Tradotto</span>}
                {!tr.running && hasTranslations && !tr.ok && <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-faint">traduzioni presenti</span>}
                <button onClick={runTranslate} disabled={tr.running} className="rounded-lg px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-60" style={{ backgroundColor: "var(--focus)" }}>{tr.running ? "Traduzione…" : hasTranslations ? "Ritraduci tutto" : "Traduci in 4 lingue"}</button>
              </div>
            </div>
            {tr.err && <p className="mt-2 text-xs font-medium text-[color:var(--err)]">{tr.err}</p>}
            {hasTranslations && !tr.running && <p className="mt-2 text-[11px] text-faint">Hai modificato dei testi dopo l&apos;ultima traduzione? Premi <b className="text-dim">Ritraduci tutto</b> per aggiornare le lingue. Le traduzioni automatiche sono un buon punto di partenza: rivedile per i dettagli.</p>}
          </Card>
      </>)}

      {mainTab === "tv" && (<>
          {/* Vista TV */}
          <Card>
            <div className="flex items-center justify-between">
              <SectionTitle>Vista TV · Smart TV in camera</SectionTitle>
              <button onClick={() => setTv({ enabled: !tv.enabled })} title={tv.enabled ? "Disattiva" : "Attiva"} className={`relative h-6 w-11 shrink-0 rounded-full transition ${tv.enabled ? "bg-focus" : "bg-line"}`}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: tv.enabled ? "22px" : "2px" }} /></button>
            </div>
            {tv.enabled ? (
              <>
                <div className="grid grid-cols-1 gap-3">
                  <F label="Immagine di sfondo della welcome (URL)"><input value={tv.bg} onChange={(e) => setTv({ bg: e.target.value })} className={fld} placeholder="https://…/hero.jpg (vuoto = usa una foto della guida)" /></F>
                  <F label="Messaggio di benvenuto in TV"><input value={tv.welcome} onChange={(e) => setTv({ welcome: e.target.value })} className={fld} placeholder="Benvenuti! Vi auguriamo un ottimo soggiorno." /></F>
                </div>
                <div className="mt-3">
                  <div className="mb-1 text-xs font-medium text-dim">Sezioni da mostrare in TV <span className="text-faint">(vuoto = tutte)</span></div>
                  <div className="flex flex-wrap gap-1.5">
                    {TV_SECTIONS.map(([id, label]) => { const on = tv.sections.includes(id); return (<button key={id} onClick={() => toggleTvSection(id)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{label}</button>); })}
                  </div>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-dim"><input type="checkbox" checked={tv.showGuest} onChange={(e) => setTv({ showGuest: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /> Mostra il numero camera dell&apos;ospite sulla welcome (dal link)</label>
                <div className="mt-3 rounded-lg border border-line bg-paper p-2.5">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">URL da impostare sulla TV</div>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="break-all font-mono text-xs text-txt">{tvUrl}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button onClick={() => navigator.clipboard?.writeText(tvUrl)} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash"><Icon name="copy" size={14} /> Copia URL TV</button>
                        <a href={tvUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">Apri anteprima TV ↗</a>
                      </div>
                      <p className="mt-2 text-[11px] text-faint">Su <b className="text-dim">Chromecast/Fire TV</b>: apri il browser della TV e vai a questo indirizzo (o inquadra il QR). Si naviga col telecomando (frecce + OK). L&apos;ospite può continuare sul telefono col QR mostrato in TV.</p>
                    </div>
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(tvUrl)}`} alt="QR TV" className="h-24 w-24 shrink-0 rounded bg-white p-1" />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-faint">Attiva la vista TV per usare la stessa guida su una Smart TV in camera (10-foot UI, telecomando, QR per il telefono).</p>
            )}
          </Card>

          <div className="mt-4">
            <SectionTitle>Anteprima TV</SectionTitle>
            <div className="mt-2 overflow-hidden rounded-xl border-[7px] border-[#111318] bg-black shadow-xl" style={{ aspectRatio: "16 / 9", maxWidth: 760 }}>
              <iframe key={"tvtab" + previewKey} src={`/guida/tv.html?p=${encodeURIComponent(sid)}&_=${previewKey}`} className="h-full w-full" title="Anteprima TV" />
            </div>
          </div>
      </>)}
    </div>
  );
}
