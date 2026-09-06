export interface NavItem {
  label: string;
  href: string;
  group: string;
  icon: string;
  perm?: string;   // permesso richiesto (chiave in users.ts). Assente = sempre visibile.
  module?: string; // modulo richiesto (chiave in Abbonamento). Assente o "pms" = sempre attivo.
}

export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", group: "", icon: "grid" },
  { label: "Prenotazioni", href: "/prenotazioni", group: "", icon: "clipboard", perm: "prenotazioni", module: "pms" },

  // Operatività: la gestione quotidiana della struttura (incl. i messaggi agli ospiti).
  { label: "Calendario", href: "/calendario", group: "Operatività", icon: "calendar", perm: "calendario", module: "pms" },
  { label: "Pulizie", href: "/pulizie", group: "Operatività", icon: "sparkles", perm: "pulizie", module: "housekeeping" },
  { label: "Messaggi", href: "/messaggi", group: "Operatività", icon: "chat", perm: "webconcierge", module: "messaging" },
  { label: "Importa prenotazioni", href: "/importa", group: "Operatività", icon: "fileText", perm: "impostazioni", module: "pms" },

  // Vendita: cosa vendi e come lo proponi.
  { label: "Preventivi", href: "/preventivi", group: "Vendita", icon: "fileText", perm: "webconcierge", module: "concierge" },
  { label: "Promozioni", href: "/promozioni", group: "Vendita", icon: "mail", perm: "webconcierge", module: "concierge" },
  { label: "Upselling & extra", href: "/upselling", group: "Vendita", icon: "tag", perm: "webconcierge", module: "concierge" },

  // Distribuzione: dove sei prenotabile e a quali prezzi.
  { label: "Tariffe", href: "/tariffe", group: "Distribuzione", icon: "tag", perm: "tariffe", module: "pms" },
  { label: "Canali", href: "/canali", group: "Distribuzione", icon: "share", perm: "canali", module: "cm" },
  { label: "Meta Search", href: "/metasearch", group: "Distribuzione", icon: "search", perm: "canali", module: "meta" },
  { label: "Widget sito", href: "/widget", group: "Distribuzione", icon: "eye", perm: "sito", module: "booking" },
  { label: "Sito web", href: "/sito", group: "Distribuzione", icon: "grid", perm: "sito", module: "site" },

  { label: "Assistente ricavi", href: "/assistente-ricavi", group: "Report", icon: "sparkles", perm: "webconcierge", module: "concierge" },
  { label: "Recensioni", href: "/recensioni", group: "Report", icon: "chat", perm: "webconcierge", module: "concierge" },
  { label: "Statistiche", href: "/statistiche", group: "Report", icon: "chart", perm: "statistiche", module: "pms" },
  { label: "Revenue", href: "/revenue", group: "Report", icon: "tag", perm: "revenue", module: "rms" },
  { label: "Rate checker", href: "/rate-checker", group: "Report", icon: "search", perm: "ratechecker", module: "ratecheck" },

  { label: "Cassa · Prima Nota", href: "/cassa", group: "Amministrazione", icon: "receipt", perm: "cassa", module: "cassa" },
  { label: "Incassi", href: "/pagamenti", group: "Amministrazione", icon: "card", perm: "pagamenti", module: "pms" },

  { label: "Ospiti", href: "/ospiti", group: "Anagrafiche", icon: "users", perm: "prenotazioni", module: "pms" },
  { label: "Alloggiati", href: "/alloggiati", group: "Anagrafiche", icon: "id", perm: "alloggiati", module: "pms" },
  { label: "Tassa soggiorno", href: "/tassa-soggiorno", group: "Anagrafiche", icon: "receipt", perm: "tassa", module: "pms" },

  { label: "Utenti", href: "/utenti", group: "Configurazione", icon: "users", perm: "utenti", module: "team" },
  { label: "Strutture", href: "/strutture", group: "Configurazione", icon: "building", perm: "impostazioni", module: "pms" },
  { label: "Camere", href: "/camere", group: "Configurazione", icon: "bed", perm: "camere", module: "pms" },
  { label: "Guida ospiti", href: "/guida-ospiti", group: "Configurazione", icon: "share", perm: "webconcierge", module: "concierge" },
  { label: "Impostazioni", href: "/impostazioni", group: "Configurazione", icon: "settings", perm: "impostazioni", module: "pms" },
  { label: "Registro attività", href: "/registro", group: "Configurazione", icon: "clipboard", perm: "impostazioni", module: "pms" },

  { label: "Abbonamento", href: "/abbonamento", group: "Il mio abbonamento", icon: "card", perm: "abbonamento", module: "pms" },
  { label: "Informazioni pagamento", href: "/abbonamento/pagamento", group: "Il mio abbonamento", icon: "card", perm: "abbonamento", module: "pms" },
  { label: "Fatture", href: "/abbonamento/fatture", group: "Il mio abbonamento", icon: "receipt", perm: "abbonamento", module: "pms" },
];

// Colore accento per categoria (palette terra: terracotta, oliva, ocra, tortora).
export const GROUP_COLOR: Record<string, string> = {
  "Operatività": "#BE5D38",
  "Comunicazione": "#A65A7A",
  "Vendita": "#7A8450",
  "Distribuzione": "#5E7C8B",
  "Report": "#2C8A8A",
  "Amministrazione": "#4F46E5",
  "Anagrafiche": "#C08A3A",
  "Configurazione": "#957A66",
  "Il mio abbonamento": "#4F46E5",
};
