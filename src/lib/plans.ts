// Configurazione piani/abbonamento — fonte unica condivisa tra la pagina Abbonamento e le Fatture.

export const ROOMS_PER_STRUCT = 6;
export const ROOM_OVERAGE = 4; // €/camera/mese oltre le incluse
export const ANNUAL_OFF = 0.2; // −20% con fatturazione annuale
export const ALL = ["pms", "cm", "booking", "cassa", "guide", "concierge", "housekeeping", "messaging", "meta", "bi", "site", "rms", "ratecheck", "team"];

export interface Tier { key: string; name: string; price: number; structures: number; includes: string[]; tagline: string }
export const TIERS: Tier[] = [
  { key: "basic", name: "Basic", price: 29, structures: 1, includes: ["pms", "cm", "booking", "cassa", "guide"], tagline: "Per iniziare" },
  { key: "pro", name: "Pro", price: 49, structures: 3, includes: ["pms", "cm", "booking", "cassa", "guide", "messaging", "housekeeping", "concierge", "bi", "meta", "team"], tagline: "In crescita" },
  { key: "ultimate", name: "Ultimate", price: 89, structures: 8, includes: ALL, tagline: "Tutto incluso" },
];

export interface Module { key: string; name: string; desc: string; href: string; core?: boolean }
export const MODULES: Module[] = [
  { key: "pms", name: "PMS", desc: "Prenotazioni, calendario, tariffe, camere e strutture, ospiti, incassi, Alloggiati Web + ISTAT e tassa di soggiorno, utenti e registro attività.", href: "/prenotazioni", core: true },
  { key: "cm", name: "Channel Manager", desc: "Connessione OTA (Booking, Airbnb, Expedia…) con sincronizzazione prezzi e disponibilità e mappatura camere.", href: "/canali" },
  { key: "booking", name: "Booking Engine", desc: "Motore prenotazioni (widget) sul tuo sito, senza commissioni.", href: "/widget" },
  { key: "cassa", name: "Cassa · Prima Nota", desc: "Entrate/uscite, pagamenti ricorrenti, saldo per conto e analisi.", href: "/cassa" },
  { key: "guide", name: "Guida & Check-in", desc: "Guida ospiti multilingua (QR WiFi e codici per camera) e self check-in online con raccolta documenti.", href: "/guida-ospiti" },
  { key: "concierge", name: "Vendite & Concierge", desc: "Preventivi e offerte, upselling & extra, promozioni, recensioni e assistente ricavi.", href: "/preventivi" },
  { key: "housekeeping", name: "Housekeeping", desc: "Planning pulizie giornaliero per camera, note dell'ospite e invio su WhatsApp.", href: "/pulizie" },
  { key: "messaging", name: "Messaggi & automazioni", desc: "Messaggi automatici agli ospiti (WhatsApp/email) con modelli e trigger: benvenuto e guida, check-in, recensione.", href: "/messaggi" },
  { key: "meta", name: "Meta Search", desc: "Connessione ai principali metasearch (Google, Trivago…).", href: "/metasearch" },
  { key: "bi", name: "Statistiche & BI", desc: "Report avanzati e statistiche sui tuoi dati.", href: "/statistiche" },
  { key: "site", name: "Sito web", desc: "Mini-sito integrato con il motore prenotazioni.", href: "/sito" },
  { key: "rms", name: "Revenue · prezzi dinamici", desc: "Suggerimenti di prezzo in base a occupazione ed eventi.", href: "/revenue" },
  { key: "ratecheck", name: "Rate checker", desc: "Confronto tariffe con i competitor.", href: "/rate-checker" },
  { key: "team", name: "Utenti & permessi", desc: "Multi-utente con permessi granulari, ruoli, turni e limiti operativi.", href: "/utenti" },
];

// Prezzo add-on (€/mese) per attivare un singolo modulo NON incluso nel piano.
export const ADDON_PRICE: Record<string, number> = { cm: 0, booking: 0, cassa: 0, guide: 6, concierge: 9, housekeeping: 6, messaging: 7, meta: 6, bi: 8, site: 7, rms: 10, ratecheck: 9, team: 6 };

export interface SubSummary {
  tier: Tier;
  addedModules: { key: string; name: string; price: number }[]; // moduli extra non inclusi nel piano
  isCustom: boolean;
  addonsTotal: number; // € add-on/mese
  monthlyTotal: number; // € piano + add-on (esclude camere extra)
  label: string; // "Basic" oppure "Basic personalizzato"
}

// Legge il piano e i moduli attivi dal browser e ricava il riepilogo dell'abbonamento.
export function readSubscription(): SubSummary {
  let tierKey = "basic";
  let active: Record<string, boolean> = {};
  try {
    tierKey = localStorage.getItem("spigolestay:plan") || localStorage.getItem("spigolestay:tier") || "basic";
    const m = localStorage.getItem("spigolestay:modules");
    if (m) active = JSON.parse(m);
  } catch {}
  const tier = TIERS.find((x) => x.key === tierKey) ?? TIERS[0];
  const addedModules = MODULES
    .filter((m) => !m.core && !tier.includes.includes(m.key) && active[m.key])
    .map((m) => ({ key: m.key, name: m.name, price: ADDON_PRICE[m.key] || 0 }));
  const addonsTotal = addedModules.reduce((a, m) => a + m.price, 0);
  const isCustom = addedModules.length > 0;
  return { tier, addedModules, isCustom, addonsTotal, monthlyTotal: tier.price + addonsTotal, label: `${tier.name}${isCustom ? " personalizzato" : ""}` };
}
