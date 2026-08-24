// Modello dati del prototipo SpigoleStay (front-end, dati finti).
// Rispecchia lo schema DB reale: strutture → tipologie → unità; prenotazioni; folio.

export type Channel = "booking" | "airbnb" | "expedia" | "direct" | "blocked";

export interface ChannelMeta {
  label: string;
  cssVar: string; // variabile CSS del colore (tema-reattivo)
  text: string; // colore testo sopra la barra
  commission: number; // commissione OTA (frazione, es. 0.15 = 15%)
}

export const CHANNELS: Record<Channel, ChannelMeta> = {
  booking: { label: "Booking.com", cssVar: "--ch-booking", text: "#ffffff", commission: 0.15 },
  airbnb: { label: "Airbnb", cssVar: "--ch-airbnb", text: "#ffffff", commission: 0.15 },
  expedia: { label: "Expedia / Vrbo", cssVar: "--ch-expedia", text: "#241a05", commission: 0.18 },
  direct: { label: "Diretta", cssVar: "--ch-direct", text: "#ffffff", commission: 0 },
  blocked: { label: "Bloccato", cssVar: "--ch-blocked", text: "#ffffff", commission: 0 },
};

export type BookingStatus = "confirmed" | "tentative" | "cancelled" | "no_show";

export interface Structure {
  id: string;
  name: string;
  groupName: string; // "Spigole Rooms" | "Central Perk"
  city?: string;
  address?: string;
  phone?: string;
  cin?: string; // Codice Identificativo Nazionale (autorizzazione turistica)
  services?: string[]; // wi-fi, parcheggio, aria condizionata…

  // Stato & anagrafica
  active?: boolean;
  type?: string;           // tipo struttura (B&B, Casa vacanze…)
  description?: string;    // descrizione per sito/booking engine
  photoColor?: string;     // colore identità (in mancanza di foto)
  logo?: string;           // logo della struttura (dataURL) — usato su preventivi/PDF
  // Contatti
  email?: string;
  website?: string;
  contactName?: string;    // referente
  facebook?: string;       // URL profilo Facebook
  instagram?: string;      // URL profilo Instagram
  linkedin?: string;       // URL profilo LinkedIn
  // Indirizzo / ubicazione
  streetNumber?: string;
  postalCode?: string;     // CAP
  province?: string;
  region?: string;
  country?: string;
  zone?: string;           // es. Ortigia
  lat?: number;
  lng?: number;
  // Fisco & autorizzazioni (Italia)
  cir?: string;            // Codice Identificativo Regionale
  istat?: string;          // codice struttura ISTAT
  alloggiatiUser?: string; // utente Portale Alloggiati (Questura)
  businessName?: string;   // ragione sociale
  vat?: string;            // Partita IVA
  taxCode?: string;        // codice fiscale
  sdi?: string;            // codice destinatario fatt. elettronica
  pec?: string;
  // Check-in / check-out
  checkInFrom?: string;    // "15:00"
  checkInTo?: string;      // "20:00"
  checkOutBy?: string;     // "10:30"
  selfCheckin?: boolean;
  accessInfo?: string;     // istruzioni/codici accesso (sensibile)
  // Tassa di soggiorno
  cityTax?: boolean;
  cityTaxAmount?: number;  // € per persona a notte
  cityTaxMaxNights?: number;
  cityTaxComune?: string;
  // Policy
  cancelPolicy?: "flessibile" | "moderata" | "rigida";
  smoking?: boolean;
  pets?: boolean;
  minAge?: number;         // età minima check-in
  deposit?: number;        // cauzione €
  quietFrom?: string;      // orario silenzio dalle
  quietTo?: string;
  // Pagamenti
  iban?: string;
  ibanHolder?: string;
  payMethods?: string[];   // contanti, carta, bonifico, PayPal
  currency?: string;
  language?: string;
  // Booking engine
  extras?: ExtraService[]; // servizi extra / upsell
  depositPct?: number;     // % acconto richiesto alla prenotazione diretta
}

export interface ExtraService {
  id: string;
  name: string;
  desc?: string;
  price: number;
  per: "stay" | "night" | "person"; // a soggiorno / a notte / a persona
}

export const DEFAULT_EXTRAS: ExtraService[] = [
  { id: "bici", name: "Noleggio bici a pedalata assistita", desc: "Esplora Ortigia e la costa in bici, 10 € al giorno.", price: 10, per: "night" },
  { id: "transfer", name: "Transfer aeroporto", desc: "Servizio taxi da/per l'aeroporto di Catania.", price: 30, per: "stay" },
  { id: "gommone", name: "Noleggio gommone - giornata intera", desc: "Una giornata in mare alla scoperta delle grotte.", price: 120, per: "stay" },
  { id: "latecheckout", name: "Late check-out (ore 14)", desc: "Prolunga il soggiorno fino alle 14:00.", price: 20, per: "stay" },
];

export const STRUCTURE_TYPES = ["B&B", "Affittacamere", "Casa vacanze", "Appartamento", "Guest house", "Hotel", "Residence", "Agriturismo", "Ostello"];
export const AMENITIES = ["Wi-Fi", "Aria condizionata", "Riscaldamento", "Parcheggio", "Colazione", "Cucina", "Lavatrice", "Lavastoviglie", "TV", "Balcone", "Terrazza", "Vista mare", "Ascensore", "Animali ammessi", "Culla", "Asciugacapelli", "Cassaforte", "Set cortesia", "Deposito bagagli", "Reception 24h"];
export const PAY_METHODS = ["Contanti", "Carta / POS", "Bonifico", "PayPal", "Satispay"];
export const CANCEL_POLICIES: { key: "flessibile" | "moderata" | "rigida"; label: string; desc: string }[] = [
  { key: "flessibile", label: "Flessibile", desc: "Cancellazione gratuita fino a 24h prima." },
  { key: "moderata", label: "Moderata", desc: "Gratuita fino a 5 giorni prima, poi 1 notte." },
  { key: "rigida", label: "Rigida", desc: "Nessun rimborso dopo la prenotazione." },
];

// Tipologie di camera comuni (suggerimenti; si può comunque scrivere una custom).
export const ROOM_TYPE_OPTIONS = [
  "Standard", "Premium", "Deluxe", "Superior", "Economy",
  "Singola", "Matrimoniale", "Doppia", "DUS (Doppia uso singola)", "Tripla", "Quadrupla", "Familiare",
  "Suite", "Junior Suite", "Mini appartamento", "Monolocale", "Bilocale", "Trilocale", "Appartamento",
  "Dormitorio", "Camera vista mare",
];

export interface RoomType {
  id: string;
  structureId: string;
  name: string; // "Camera matrimoniale", "Appartamento"
  beds: number; // posti letto
  basePrice: number; // tariffa base feriale (€)
  // Tariffa derivata: se impostata, il prezzo si calcola da un'altra tipologia.
  deriveFrom?: string; // id tipologia sorgente ("" o assente = tariffa indipendente)
  deriveMode?: "amount" | "percent"; // ±€ oppure ±%
  deriveValue?: number; // valore con segno (es. -10 = −10€ / −10%)
  // Dettaglio tipologia
  color?: string;
  maxOccupancy?: number;   // ospiti massimi
  maxAdults?: number;
  maxChildren?: number;
  infants?: number;        // neonati (fuori conteggio)
  dormMode?: boolean;      // modalità dormitorio (vendita a posto letto)
  extraBeds?: number;      // letti aggiunti disponibili
  extraBedPrice?: number;  // € per letto aggiunto
  size?: number;           // mq
  bedConfig?: string;      // "1 matrimoniale", "2 singoli"…
  minStay?: number;        // notti minime
  minPrice?: number;       // prezzo minimo vendibile
  autoPrice?: boolean;     // aumento automatico di prezzo (revenue)
  childrenAllowed?: boolean;
  description?: string;
  amenities?: string[];    // dotazioni di tipologia
  composition?: { name: string; shared?: boolean }[]; // ambienti (camera, bagno…)
  i18n?: Record<string, { name?: string; desc?: string }>; // descrizioni multilingua
  // Visibilità sui canali
  showBooking?: boolean;
  showSite?: boolean;
  showCalendar?: boolean;
  countStats?: boolean;
}

export const ROOM_SPACES = ["Camera da letto", "Bagno", "Cucina", "Angolo cottura", "Soggiorno", "Sala da pranzo", "Balcone", "Terrazza", "Ingresso", "Ripostiglio"];

export const BED_CONFIGS = ["1 matrimoniale", "1 king size", "2 letti singoli", "1 matrimoniale + 1 singolo", "2 matrimoniali", "1 singolo", "Letto a castello", "1 matrimoniale + divano letto"];
export const ROOM_AMENITIES = ["Bagno privato", "Aria condizionata", "Riscaldamento", "TV", "Wi-Fi", "Frigobar", "Bollitore", "Cassaforte", "Asciugacapelli", "Set cortesia", "Scrivania", "Balcone", "Terrazza", "Vista mare", "Angolo cottura", "Doccia", "Vasca"];
export const VIEW_OPTIONS = ["Interna", "Vista strada", "Vista cortile", "Vista giardino", "Vista mare", "Panoramica"];

export interface Unit {
  id: string;
  structureId: string;
  roomTypeId: string;
  name: string; // "Allegra", "Ortigia"
  outOfService?: boolean;
  // Dettaglio camera fisica
  code?: string;       // numero/codice interno
  floor?: string;      // piano
  view?: string;       // vista
  accessInfo?: string; // codice serratura/keybox specifico
  notes?: string;
  oosReason?: string;  // motivo fuori servizio
}

export interface Guest {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  country?: string;
  language?: string;
  // Dati per Alloggiati Web (Questura) / schedina
  firstName?: string;   // nome
  lastName?: string;    // cognome
  sex?: "M" | "F";
  birthDate?: string;   // ISO
  birthPlace?: string;  // comune o stato estero di nascita
  citizenship?: string; // cittadinanza
  docType?: string;     // tipo documento
  docNumber?: string;   // numero documento
  docPlace?: string;    // luogo di rilascio
  docExpiry?: string;   // scadenza documento (ISO)
  address?: string;     // residenza
  // CRM
  vip?: boolean;
  marketingConsent?: boolean;
  tags?: string[];
  preferences?: string; // richieste ricorrenti, allergie…
  notes?: string;       // note interne
}

export const GUEST_TAGS = ["Cliente abituale", "Business", "Famiglia", "Coppia", "Luna di miele", "Animali", "Lungo soggiorno", "Recensore", "Da recuperare"];

// Tipi documento accettati dal Portale Alloggiati.
export const DOC_TYPES = ["Carta d'identità", "Passaporto", "Patente di guida"];

// Tipologia alloggiato (codici ufficiali Alloggiati Web).
export const ALLOGGIATI_ROLES = [
  { code: "16", label: "Ospite singolo" },
  { code: "17", label: "Capofamiglia" },
  { code: "18", label: "Capogruppo" },
  { code: "19", label: "Familiare" },
  { code: "20", label: "Membro gruppo" },
] as const;

// Evento/periodo segnalato sul calendario (sagra, ponte, alta richiesta…).
// Non blocca camere: serve a ricordare di ritoccare le tariffe.
export interface CalEvent {
  id: string;
  name: string;
  from: string; // ISO incluso
  to: string;   // ISO escluso (giorno dopo l'ultimo)
  color: string; // colore esadecimale
}

export const EVENT_COLORS = ["#E0552B", "#E0A21C", "#7C3AED", "#0E9F6E", "#2563EB", "#DB2777", "#0891B2", "#6B7280"];

export interface Booking {
  id: string;
  groupId?: string; // se presente, la prenotazione fa parte di un gruppo (prenotazione multipla/di gruppo)
  structureId: string;
  roomTypeId: string;
  unitId: string | null; // assegnata fino al check-in
  guestId: string;
  channel: Channel;
  status: BookingStatus;
  checkIn: string; // ISO "YYYY-MM-DD"
  checkOut: string; // ISO (giorno di partenza, non pernottato)
  bookedOn?: string; // ISO — data in cui è stata fatta la prenotazione
  adults: number;
  children: number;
  childAges?: number[]; // età dei bambini (per esenzioni tassa di soggiorno: es. under 14 esenti)
  total?: number; // € (soggiorno, per il prototipo)
  note?: string;
  cleaningFee?: number; // € pulizia finale
  cityTaxExempt?: boolean; // esente tassa di soggiorno
  cityTaxPaid?: boolean; // tassa di soggiorno incassata
  depositPaid?: boolean; // caparra ricevuta
  paid?: number; // € già incassati (acconto/saldo)
  commissionPct?: number; // % di commissione OTA specifica di questa prenotazione
  webCheckin?: boolean; // l'ospite ha completato il check-in online
  arrivalTime?: string; // orario di arrivo comunicato
  docPhotoFront?: string; // foto documento fronte (dataURL, dal check-in online)
  docPhotoBack?: string;  // foto documento retro (dataURL)
  signature?: string;     // firma dell'ospite (dataURL, dal check-in online)
  invoiceNo?: string;   // numero fattura emessa
  extraGuests?: { firstName: string; lastName: string; sex?: "M" | "F"; birthDate?: string; birthPlace?: string; citizenship?: string; docType?: string; docNumber?: string }[]; // co-ospiti (dal web check-in o aggiunti a mano)
}
