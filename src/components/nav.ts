export interface NavItem {
  label: string;
  href: string;
  group: string;
  icon: string;
  perm?: string;   // permesso richiesto (chiave in users.ts). Assente = sempre visibile.
  module?: string; // modulo richiesto (chiave in Abbonamento). Assente o "pms" = sempre attivo.
}

export const NAV: NavItem[] = [
  // In cima, senza categoria: le cose che apri ogni giorno.
  { label: "Dashboard", href: "/", group: "", icon: "grid" },
  { label: "Assistente", href: "/assistente", group: "", icon: "sparkles", perm: "prenotazioni", module: "pms" },

  // PMS: la gestione quotidiana della struttura (il cuore del gestionale).
  { label: "Prenotazioni", href: "/prenotazioni", group: "PMS", icon: "clipboard", perm: "prenotazioni", module: "pms" },
  { label: "Calendario", href: "/calendario", group: "PMS", icon: "calendar", perm: "calendario", module: "pms" },
  { label: "Camere", href: "/camere", group: "PMS", icon: "bed", perm: "camere", module: "pms" },
  { label: "Pulizie", href: "/pulizie", group: "PMS", icon: "sparkles", perm: "pulizie", module: "housekeeping" },
  { label: "Ospiti", href: "/ospiti", group: "PMS", icon: "users", perm: "prenotazioni", module: "pms" },
  { label: "Messaggi", href: "/messaggi", group: "PMS", icon: "chat", perm: "webconcierge", module: "messaging" },

  // Channel Manager: distribuzione sui portali + catena del prezzo (tariffe).
  { label: "Channel Manager", href: "/canali", group: "Channel Manager", icon: "share", perm: "canali", module: "cm" },
  { label: "Meta Search", href: "/metasearch", group: "Channel Manager", icon: "search", perm: "canali", module: "meta" },
  { label: "Tariffe", href: "/tariffe", group: "Channel Manager", icon: "tag", perm: "tariffe", module: "pms" },
  { label: "Piani tariffari", href: "/piani-tariffari", group: "Channel Manager", icon: "receipt", perm: "tariffe", module: "pms" },
  { label: "Tariffe derivate", href: "/tariffe-derivate", group: "Channel Manager", icon: "copy", perm: "tariffe", module: "pms" },

  // Booking Engine: vendita diretta (motore, sito, offerte, extra).
  { label: "Booking Engine", href: "/booking-engine", group: "Booking Engine", icon: "eye", perm: "sito", module: "booking" },
  { label: "Widget sito", href: "/widget", group: "Booking Engine", icon: "eye", perm: "sito", module: "booking" },
  { label: "Xenosite", href: "/sito", group: "Booking Engine", icon: "grid", perm: "sito", module: "site" },
  { label: "Preventivi", href: "/preventivi", group: "Booking Engine", icon: "fileText", perm: "webconcierge", module: "concierge" },
  { label: "Promozioni", href: "/promozioni", group: "Booking Engine", icon: "mail", perm: "webconcierge", module: "concierge" },
  { label: "Upselling & extra", href: "/upselling", group: "Booking Engine", icon: "tag", perm: "webconcierge", module: "concierge" },

  // Revenue: prezzi dinamici e confronto col mercato.
  { label: "Nèttare · prezzi dinamici", href: "/nettare", group: "Revenue", icon: "sparkles", perm: "revenue", module: "rms" },
  { label: "Revenue", href: "/revenue", group: "Revenue", icon: "tag", perm: "revenue", module: "rms" },
  { label: "Rate checker", href: "/rate-checker", group: "Revenue", icon: "search", perm: "ratechecker", module: "ratecheck" },
  { label: "Rete città", href: "/mercato", group: "Revenue", icon: "share", perm: "statistiche", module: "market" },

  // Report: analisi dei dati.
  { label: "Statistiche", href: "/statistiche", group: "Report", icon: "chart", perm: "statistiche", module: "pms" },
  { label: "Provenienza viaggiatori", href: "/provenienza", group: "Report", icon: "chart", perm: "statistiche", module: "pms" },
  { label: "Recensioni", href: "/recensioni", group: "Report", icon: "chat", perm: "webconcierge", module: "concierge" },
  { label: "Assistente ricavi", href: "/assistente-ricavi", group: "Report", icon: "sparkles", perm: "webconcierge", module: "concierge" },

  // Amministrazione: fisco e cassa.
  { label: "Documenti fiscali", href: "/documenti", group: "Amministrazione", icon: "receipt", perm: "webconcierge", module: "concierge" },
  { label: "Fatture passive", href: "/fatture-passive", group: "Amministrazione", icon: "receipt", perm: "cassa", module: "pms" },
  { label: "Registro bollo", href: "/registro-bollo", group: "Amministrazione", icon: "receipt", perm: "cassa", module: "pms" },
  { label: "Incassi", href: "/pagamenti", group: "Amministrazione", icon: "card", perm: "pagamenti", module: "pms" },
  { label: "Scadenzario incassi", href: "/scadenzario-incassi", group: "Amministrazione", icon: "card", perm: "pagamenti", module: "pms" },
  { label: "Cassa · Prima Nota", href: "/cassa", group: "Amministrazione", icon: "receipt", perm: "cassa", module: "cassa" },
  { label: "Chiusura cassa", href: "/chiusura-cassa", group: "Amministrazione", icon: "receipt", perm: "cassa", module: "cassa" },
  { label: "Clienti / Agenzie", href: "/anagrafica-clienti", group: "Amministrazione", icon: "users", perm: "prenotazioni", module: "pms" },

  // Adempimenti PA: cosa mandi agli enti (Questura, ISTAT, Comune).
  { label: "Alloggiati", href: "/alloggiati", group: "Adempimenti PA", icon: "id", perm: "alloggiati", module: "pms" },
  { label: "Alloggiati Web", href: "/alloggiati-web", group: "Adempimenti PA", icon: "id", perm: "alloggiati", module: "pms" },
  { label: "ISTAT · Turist@t", href: "/istat", group: "Adempimenti PA", icon: "chart", perm: "alloggiati", module: "pms" },
  { label: "Tassa soggiorno", href: "/tassa-soggiorno", group: "Adempimenti PA", icon: "receipt", perm: "tassa", module: "pms" },

  // Configurazione: impostazioni della struttura e dell'account.
  { label: "Strutture", href: "/strutture", group: "Configurazione", icon: "building", perm: "impostazioni", module: "pms" },
  { label: "Utenti", href: "/utenti", group: "Configurazione", icon: "users", perm: "utenti", module: "pms" },
  { label: "Guida ospiti", href: "/guida-ospiti", group: "Configurazione", icon: "share", perm: "webconcierge", module: "guide" },
  { label: "Impostazioni fattura", href: "/impostazioni-fattura", group: "Configurazione", icon: "receipt", perm: "webconcierge", module: "concierge" },
  { label: "Registro attività", href: "/registro", group: "Configurazione", icon: "clipboard", perm: "impostazioni", module: "pms" },
  { label: "Impostazioni", href: "/impostazioni", group: "Configurazione", icon: "settings", perm: "impostazioni", module: "pms" },

  { label: "Abbonamento", href: "/abbonamento", group: "Il mio abbonamento", icon: "card", perm: "abbonamento", module: "pms" },
  { label: "Informazioni pagamento", href: "/abbonamento/pagamento", group: "Il mio abbonamento", icon: "card", perm: "abbonamento", module: "pms" },
  { label: "Fatture", href: "/abbonamento/fatture", group: "Il mio abbonamento", icon: "receipt", perm: "abbonamento", module: "pms" },
];

// Colore accento per categoria (palette terra: terracotta, oliva, ocra, tortora + accenti).
export const GROUP_COLOR: Record<string, string> = {
  "PMS": "#BE5D38",
  "Channel Manager": "#5E7C8B",
  "Booking Engine": "#7A8450",
  "Revenue": "#A65A7A",
  "Report": "#2C8A8A",
  "Amministrazione": "#4F46E5",
  "Adempimenti PA": "#C08A3A",
  "Configurazione": "#957A66",
  "Il mio abbonamento": "#4F46E5",
};
