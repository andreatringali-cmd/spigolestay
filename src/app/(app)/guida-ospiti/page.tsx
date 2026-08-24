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
interface GStep { h: string; p: string; code?: "" | "gate" | "door" | "door2"; actions?: GAction[] }
interface GAmenity { icon: string; label: string }
interface GSection {
  id: string; icon: string; title: string; sub: string; intro: string; photos: string[]; items: GItem[];
  steps?: GStep[]; amenities?: GAmenity[]; amenitiesTitle?: string; amenitiesIntro?: string;
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
const LIM = { guideName: 40, name: 60, wtitle: 30, welcome: 420, title: 45, sub: 70, intro: 260, h: 55, p: 950, alabel: 34, ln: 44, lsub: 56, ltel: 22 };
interface GContent { home: { welcomeTitle: string; welcome: string[] }; sections: GSection[] }
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
  home: { welcomeTitle: "Benvenuti,", welcome: ["siamo davvero felici di accogliervi!", "Questa guida vi aiuterà a scoprire la città e a vivere al meglio il vostro soggiorno.", "Buona permanenza!"] },
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
  home: { welcomeTitle: "Benvenuti a Siracusa,", welcome: ["siamo davvero felici di accogliervi!", "Questa guida vi aiuterà a scoprire la città e a vivere al meglio il soggiorno.", "Buona permanenza!"] },
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
    { id: "contacts", icon: "phone", title: "Contatti", sub: "Siamo a disposizione", intro: "", photos: [], items: [] },
    { id: "review", icon: "star", title: "Lasciate una recensione", sub: "Il vostro supporto è prezioso", intro: "", photos: [], items: [] },
  ],
};
const fileToDataUrl = (file: File): Promise<string> => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
// Definiti a livello di modulo: se stessero dentro il componente verrebbero ricreati a ogni
// render e React rimonterebbe gli input (focus perso → si scrive un carattere alla volta).
const fld = "w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-[15px] text-txt outline-none focus:border-focus";
// Campo in sola lettura: il dato arriva dalle Impostazioni struttura, qui non si modifica.
const fldRO = "w-full rounded-lg border border-line bg-wash px-3.5 py-2.5 text-[15px] text-dim outline-none cursor-not-allowed";
const F = ({ label, children }: { label: string; children: React.ReactNode }) => (<label className="block text-xs font-medium text-dim">{label}<div className="mt-1">{children}</div></label>);
const emptyGuide = (id: string, name: string, city: string): Guide => ({
  id, guideName: name, guideLogo: "assets/logo-trasparente.png", name, city, address: "",
  phone: "", phoneGreta: "", whatsapp: "", email: "", mapsUrl: "",
  wifiNetwork: "", wifiPassword: "", checkinTime: "15:00 – 00:00", checkoutTime: "entro le 10:30",
  reviewUrl: "", bookingUrl: "", taxiPhone: "+39 0931 17977",
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
  const home = { welcomeTitle: await T(content.home.welcomeTitle), welcome: [] as string[] };
  for (const w of content.home.welcome) home.welcome.push(await T(w));
  const sections: GSection[] = [];
  for (const s of content.sections) {
    const ns: GSection = { ...s, title: await T(s.title), sub: await T(s.sub), intro: await T(s.intro) };
    if (s.amenitiesTitle != null) ns.amenitiesTitle = await T(s.amenitiesTitle);
    if (s.amenitiesIntro != null) ns.amenitiesIntro = await T(s.amenitiesIntro);
    if (s.steps) { const st: GStep[] = []; for (const k of s.steps) st.push({ ...k, h: await T(k.h), p: await T(k.p), actions: await trActions(k.actions) }); ns.steps = st; }
    if (s.amenities) ns.amenities = await Promise.all(s.amenities.map(async (a) => ({ ...a, label: await T(a.label) })));
    const items: GItem[] = [];
    for (const it of s.items) items.push({ ...it, h: await T(it.h), p: await T(it.p), actions: await trActions(it.actions) }); // liste (nomi/indirizzi) non tradotte
    ns.items = items;
    sections.push(ns);
  }
  return { home, sections };
}

export default function GuidaOspitiPage() {
  const { structures, units, roomTypes, activeStructureId, updateStructure, bookings, getUnit, getGuest } = useData();
  const [sid, setSid] = useState(activeStructureId !== "all" ? activeStructureId : (structures[0]?.id ?? ""));
  const [all, setAll] = useState<Record<string, Guide>>({});
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => { try { setAll(JSON.parse(localStorage.getItem("spigolestay:guides") || "{}")); } catch {} }, []);
  const persist = (next: Record<string, Guide>) => { setAll(next); try { localStorage.setItem("spigolestay:guides", JSON.stringify(next)); } catch {} };

  const struct = structures.find((s) => s.id === sid);
  const guide = all[sid] ?? emptyGuide(sid, struct?.name ?? "", struct?.city ?? "Siracusa");
  const set = (patch: Partial<Guide>) => persist({ ...all, [sid]: { ...guide, ...patch, id: sid } });
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
      phone: s?.phone ?? "", email: s?.email ?? "",
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
  useEffect(() => {
    const cur = all[sid];
    const base = cur ?? emptyGuide(sid, struct?.name ?? "", struct?.city ?? "Siracusa");
    const merged = { ...base, ...structFields, id: sid, social: { ...base.social, ...(structFields.social ?? {}) } };
    if (JSON.stringify(cur ?? null) !== JSON.stringify(merged)) persist({ ...all, [sid]: merged });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, structFields]);

  const [tab, setTab] = useState<"setup" | "content">("setup");
  const [openSec, setOpenSec] = useState<string | null>(null);
  const content: GContent = guide.content ?? DEFAULT_CONTENT;
  const setContent = (c: GContent) => set({ content: c });
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
  const updItem = (si: number, ii: number, patch: Partial<GItem>) => updSection(si, { items: content.sections[si].items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });
  const addItem = (si: number) => updSection(si, { items: [...content.sections[si].items, { h: "", p: "" }] });
  const removeItem = (si: number, ii: number) => updSection(si, { items: content.sections[si].items.filter((_, j) => j !== ii) });
  const addPhoto = (si: number, url: string) => { if (url) updSection(si, { photos: [...content.sections[si].photos, url] }); };
  const removePhoto = (si: number, pi: number) => updSection(si, { photos: content.sections[si].photos.filter((_, j) => j !== pi) });
  const onLogo = async (f?: File) => { if (f) set({ guideLogo: await fileToDataUrl(f) }); };
  const onSecPhoto = async (si: number, f?: File) => { if (f) addPhoto(si, await fileToDataUrl(f)); };
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
      <h1>${(guide.guideName || guide.name || "").replace(/</g, "")}</h1>
      <p class="city">${(guide.city || "").replace(/</g, "")}${rooms ? " · Camera " + rooms.replace(/</g, "") : ""}</p>
      <img class="qr" src="${qr}">
      <h2>Inquadra per la guida</h2>
      <p class="sub">Check-in, WiFi, consigli e contatti · IT · EN · FR · DE · ES</p>
      </div><script>onload=function(){setTimeout(function(){print()},400)}<\/script></body></html>`);
    w.document.close();
  };

  const tvUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/guida/tv.html?p=${encodeURIComponent(sid)}`;
  // Anteprima: telefono (guida mobile) o TV, in una delle 5 lingue.
  const [pvMode, setPvMode] = useState<"phone" | "tv">("phone");
  const [pvLang, setPvLang] = useState("it");
  useEffect(() => { try { localStorage.setItem("spigole_lang", pvLang); } catch {} }, [pvLang]);
  useEffect(() => { setPreviewKey((k) => k + 1); }, [pvMode, pvLang]);
  const previewUrl = pvMode === "tv"
    ? `/guida/tv.html?p=${encodeURIComponent(sid)}&lang=${pvLang}&_=${previewKey}`
    : `/guida/index.html?p=${encodeURIComponent(sid)}&_=${previewKey}`;
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

  return (
    <div>
      <PageHeader
        title="Guida ospiti"
        subtitle="Una guida multilingua per struttura · personalizza e genera il link da inviare"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadDemo} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-focus hover:bg-wash" title="Riempi con un esempio pronto (Siracusa)">✨ Carica esempio</button>
            <select value={sid} onChange={(e) => setSid(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-txt outline-none focus:border-focus">
              {structures.map((s) => (<option key={s.id} value={s.id}>{s.name}{all[s.id] ? " ✓" : ""}</option>))}
            </select>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-line bg-surface p-0.5 shadow-sm">
          <button onClick={() => setTab("setup")} className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === "setup" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>Impostazioni & link</button>
          <button onClick={() => setTab("content")} className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === "content" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>Contenuti · città, testi, foto</button>
        </div>
        {/* Completezza della guida: colpo d'occhio su cosa manca prima di inviarla */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-faint">Pronta:</span>
          {([["Struttura", !!(guide.name && guide.address)], ["Contatti", !!(guide.whatsapp || guide.phone)], ["WiFi", !!(guide.wifiNetwork && guide.wifiPassword)], ["Contenuti", !!guide.content], ["Traduzioni", hasTranslations]] as [string, boolean][]).map(([lbl, ok]) => (
            <span key={lbl} className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${ok ? "text-white" : "bg-wash text-faint"}`} style={ok ? { backgroundColor: "var(--ok)" } : undefined}>{ok ? "✓" : "○"} {lbl}</span>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_minmax(340px,0.92fr)]">
        {/* Pannello personalizzazione */}
        <div className="space-y-4">
        {tab === "setup" && (<>
          <div className="grid gap-4">
          <Card>
            <div className="flex items-center justify-between">
              <SectionTitle>Struttura</SectionTitle>
              <span className="flex items-center gap-1 rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-faint">🔒 dalle Impostazioni struttura</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <F label="Nome guida"><input value={guide.guideName} maxLength={LIM.guideName} onChange={(e) => set({ guideName: e.target.value })} className={fld} placeholder="es. Guida di Spigole House" /></F>
              <F label="Nome struttura"><input value={guide.name} disabled readOnly className={fldRO} /></F>
              <F label="Città"><input value={guide.city} disabled readOnly className={fldRO} /></F>
              <F label="Logo struttura"><div className="flex items-center gap-2">
                {guide.guideLogo && <img src={guide.guideLogo} alt="" className="h-10 w-10 shrink-0 rounded border border-line bg-white object-contain" />}
                <input value={guide.guideLogo || "— nessun logo nelle impostazioni —"} disabled readOnly className={fldRO} />
              </div></F>
              <F label="Indirizzo"><input value={guide.address} disabled readOnly className={fldRO} /></F>
              <F label="Link Google Maps"><input value={guide.mapsUrl} disabled readOnly className={fldRO} /></F>
            </div>
          </Card>

          <Card>
            <SectionTitle>Contatti</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <F label="Telefono 🔒"><input value={guide.phone} disabled readOnly className={fldRO} /></F>
              <F label="Email 🔒"><input value={guide.email} disabled readOnly className={fldRO} /></F>
              <F label="WhatsApp"><input value={guide.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} className={fld} placeholder="+39…" /></F>
              <F label="Telefono 2 (Greta)"><input value={guide.phoneGreta} onChange={(e) => set({ phoneGreta: e.target.value })} className={fld} placeholder="+39…" /></F>
              <F label="Taxi"><input value={guide.taxiPhone} onChange={(e) => set({ taxiPhone: e.target.value })} className={fld} /></F>
            </div>
            <p className="mt-2 text-[11px] text-faint">🔒 Telefono ed email arrivano dalle Impostazioni struttura. WhatsApp, secondo numero e taxi sono specifici della guida.</p>
          </Card>

          <Card>
            <SectionTitle>WiFi · Check-in · Recensioni</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <F label="Rete WiFi"><input value={guide.wifiNetwork} onChange={(e) => set({ wifiNetwork: e.target.value })} className={fld} /></F>
              <F label="Password WiFi"><input value={guide.wifiPassword} onChange={(e) => set({ wifiPassword: e.target.value })} className={fld} /></F>
              <F label="Check-in — dalle / alle">
                <div className="flex items-center gap-2">
                  <input type="time" value={ciFrom} onChange={(e) => setCheckin(e.target.value, ciTo)} className={fld} />
                  <span className="text-dim">–</span>
                  <input type="time" value={ciTo} onChange={(e) => setCheckin(ciFrom, e.target.value)} className={fld} />
                </div>
              </F>
              <F label="Check-out — entro le"><input type="time" value={coBy} onChange={(e) => setCheckout(e.target.value)} className={fld} /></F>
              <F label="Link recensioni (Google)"><input value={guide.reviewUrl} onChange={(e) => set({ reviewUrl: e.target.value })} className={fld} /></F>
              <F label="Link prenotazione diretta"><input value={guide.bookingUrl} onChange={(e) => set({ bookingUrl: e.target.value })} className={fld} /></F>
            </div>
            <p className="mt-2 text-[11px] text-faint">Gli orari si scelgono con l&apos;orologio: nessun errore di digitazione.</p>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <SectionTitle>Social</SectionTitle>
              <span className="flex items-center gap-1 rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-faint">🔒 dalle Impostazioni struttura</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <F label="Instagram"><input value={guide.social.instagram} disabled readOnly className={fldRO} /></F>
              <F label="Facebook"><input value={guide.social.facebook} disabled readOnly className={fldRO} /></F>
              <F label="Sito web"><input value={guide.social.website} disabled readOnly className={fldRO} /></F>
            </div>
            <p className="mt-2 text-[11px] text-faint">I contenuti città (ristoranti, attrazioni, trasporti) e le traduzioni sono inclusi come esempio Siracusa.</p>
          </Card>
          </div>

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
        </>)}

        {tab === "content" && (<>
          <Card>
            <SectionTitle>Home · benvenuto</SectionTitle>
            <F label="Titolo di benvenuto"><input value={content.home.welcomeTitle} maxLength={LIM.wtitle} onChange={(e) => setHome({ welcomeTitle: e.target.value })} className={fld} /></F>
            <div className="mt-3"><F label="Messaggio (una riga per paragrafo)"><textarea value={content.home.welcome.join("\n")} maxLength={LIM.welcome} onChange={(e) => setHome({ welcome: e.target.value.split("\n") })} rows={3} className={`${fld} resize-y`} /></F></div>
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

          <div className="flex items-center justify-between">
            <SectionTitle>Sezioni della guida ({content.sections.length})</SectionTitle>
            <button onClick={addSection} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash">+ Sezione</button>
          </div>
          {content.sections.map((s, si) => { const open = openSec === s.id; const func = FUNC_SECTIONS.includes(s.id); return (
            <Card key={s.id}>
              <div className="flex items-center gap-2">
                <button onClick={() => setOpenSec(open ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="text-faint">{open ? "▾" : "▸"}</span>
                  <span className="truncate font-semibold text-txt">{s.title || s.id}</span>
                  {func && <span className="shrink-0 rounded-full bg-wash px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">operativa</span>}
                </button>
                <button onClick={() => moveSection(si, -1)} title="Su" className="px-1 text-faint hover:text-txt">↑</button>
                <button onClick={() => moveSection(si, 1)} title="Giù" className="px-1 text-faint hover:text-txt">↓</button>
                {!func && <button onClick={() => removeSection(si)} title="Elimina" className="px-1 text-faint hover:text-[color:var(--err)]">✕</button>}
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
                  <div className="grid grid-cols-2 gap-3">
                    <F label="Titolo"><input value={s.title} maxLength={LIM.title} onChange={(e) => updSection(si, { title: e.target.value })} className={fld} /></F>
                    <F label="Sottotitolo"><input value={s.sub} maxLength={LIM.sub} onChange={(e) => updSection(si, { sub: e.target.value })} className={fld} /></F>
                  </div>
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
                            </div>
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
                  {!func ? (() => { const isList = LIST_SECTIONS.has(s.id); return (
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
                  ); })() : (
                    <p className="text-[11px] text-faint">Sezione operativa: qui modifichi titolo, sottotitolo, intro e foto. Codici, credenziali WiFi e pulsanti (WhatsApp, prenota, tassa) restano automatici dai dati struttura e dal link ospite.</p>
                  )}
                </div>
                ); })()}
            </Card>
          ); })}
          <p className="text-[11px] text-faint">I testi valgono per tutte le lingue (nella lingua in cui scrivi); la traduzione automatica multilingua è la fase successiva. Le stringhe dell&apos;interfaccia (Indietro, WiFi…) sono già tradotte IT/EN/FR/DE/ES.</p>
        </>)}
        </div>

        {/* Anteprima live */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SectionTitle>Anteprima live</SectionTitle>
              <span className="flex items-center gap-1 rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-faint"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: savedThis ? "var(--ok)" : "var(--faint)" }} />{savedThis ? "live" : "compila per vedere"}</span>
            </div>
            {/* Telefono / TV */}
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              <button onClick={() => setPvMode("phone")} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${pvMode === "phone" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>📱 Telefono</button>
              <button onClick={() => setPvMode("tv")} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${pvMode === "tv" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>📺 TV</button>
            </div>
          </div>
          {/* Lingue + apri a schermo intero */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-line">
              {["it", "en", "fr", "de", "es"].map((l) => (
                <button key={l} onClick={() => setPvLang(l)} className={`px-2 py-1 text-xs font-semibold transition ${pvLang === l ? "bg-focus text-white" : "bg-surface text-dim hover:text-txt"}`}>{l.toUpperCase()}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={refresh} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-dim hover:bg-wash">↻</button>
              <a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-dim hover:bg-wash">Schermo intero ↗</a>
            </div>
          </div>
          {pvMode === "phone" ? (
            // Mockup telefono: la guida è resa alla larghezza REALE di un telefono (390px) e poi
            // scalata, così tasti e proporzioni sono identici a uno smartphone vero (non "stirati").
            <div className="mx-auto w-full" style={{ maxWidth: 384 }}>
              <div className="relative mx-auto rounded-[2.6rem] border border-line bg-[#111318] px-2.5 pb-2.5 pt-6 shadow-xl">
                <div className="absolute left-1/2 top-2.5 z-10 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/25" />
                <div className="overflow-hidden rounded-[2rem] bg-black" style={{ aspectRatio: "390 / 844", maxHeight: "84vh" }}>
                  <iframe ref={previewRef} key={previewKey} src={previewUrl} title="Anteprima guida" style={{ border: 0 }} className="h-full w-full" />
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] font-medium text-faint">Guida sul telefono dell&apos;ospite · dimensioni reali</p>
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
    </div>
  );
}
