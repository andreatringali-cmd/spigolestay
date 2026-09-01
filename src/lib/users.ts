// Modello Utenti + permessi granulari per Xenora (prototipo, persistito in localStorage).
// Ispirato alla scheda utente di Octorate ma mappato sulle sezioni reali del nostro gestionale.

export type PermLevel = "none" | "view" | "edit";

export interface Permission {
  key: string;
  label: string;
  group: string;
  levels: PermLevel[]; // livelli consentiti per questo permesso
  help?: string;
}

// Elenco completo dei permessi, raggruppati come nella sidebar.
export const PERMISSIONS: Permission[] = [
  // Operatività
  { key: "prenotazioni", label: "Prenotazioni", group: "Operatività", levels: ["none", "view", "edit"] },
  { key: "calendario", label: "Calendario · Disponibilità", group: "Operatività", levels: ["none", "view", "edit"] },
  { key: "pulizie", label: "Housekeeping · Pulizie", group: "Operatività", levels: ["none", "view", "edit"] },
  { key: "webconcierge", label: "Web Concierge · Comunicazione ospiti", group: "Operatività", levels: ["none", "view", "edit"] },
  { key: "alloggiati", label: "Alloggiati Web (Questura)", group: "Operatività", levels: ["none", "view", "edit"] },
  // Vendita
  { key: "tariffe", label: "Tariffe · Prezzo", group: "Vendita", levels: ["none", "view", "edit"] },
  { key: "revenue", label: "Revenue · prezzi dinamici", group: "Vendita", levels: ["none", "view", "edit"] },
  { key: "ratechecker", label: "Rate checker", group: "Vendita", levels: ["none", "view", "edit"] },
  { key: "canali", label: "Channel Manager", group: "Vendita", levels: ["none", "edit"], help: "Il Channel Manager si gestisce o non si vede: non ha un livello di sola lettura." },
  { key: "sito", label: "Sito web · Meta Search", group: "Vendita", levels: ["none", "view", "edit"] },
  { key: "statistiche", label: "Statistiche", group: "Vendita", levels: ["none", "view", "edit"] },
  // Amministrazione
  { key: "cassa", label: "Cassa · Prima Nota", group: "Amministrazione", levels: ["none", "view", "edit"] },
  { key: "pagamenti", label: "Pagamenti", group: "Amministrazione", levels: ["none", "view", "edit"] },
  { key: "chiusura_cassa", label: "Chiusura cassa", group: "Amministrazione", levels: ["none", "view", "edit"], help: "Consente di chiudere la cassa a fine giornata e generare il report di quadratura." },
  { key: "annulla_chiusura", label: "Annulla chiusura cassa", group: "Amministrazione", levels: ["none", "edit"], help: "Permesso sensibile: riapre una cassa già chiusa. Assegnalo solo a chi ha responsabilità amministrativa." },
  { key: "tassa", label: "Tassa di soggiorno", group: "Amministrazione", levels: ["none", "view", "edit"] },
  { key: "abbonamento", label: "Abbonamento · Licenza", group: "Amministrazione", levels: ["none", "view", "edit"] },
  // Configurazione
  { key: "camere", label: "Camere", group: "Configurazione", levels: ["none", "view", "edit"] },
  { key: "impostazioni", label: "Impostazioni", group: "Configurazione", levels: ["none", "view", "edit"] },
  { key: "utenti", label: "Utenti", group: "Configurazione", levels: ["none", "view", "edit"] },
  // Privacy
  { key: "dati_personali", label: "Accesso ai dati personali ospiti", group: "Privacy", levels: ["none", "view"], help: "Dati sensibili (documenti, date di nascita). Concedi solo a chi ne ha reale necessità." },
  { key: "contatti_ospite", label: "Telefono ed email ospite", group: "Privacy", levels: ["none", "edit"], help: "Visibilità dei contatti diretti dell'ospite." },
];

export const PERM_GROUPS = ["Operatività", "Vendita", "Amministrazione", "Configurazione", "Privacy"];

// Permessi vuoti (tutto "none").
export const emptyPerms = (): Record<string, PermLevel> => Object.fromEntries(PERMISSIONS.map((p) => [p.key, "none"]));
// Livello massimo consentito per un permesso.
const top = (p: Permission): PermLevel => p.levels[p.levels.length - 1];
// Tutti al massimo.
export const fullPerms = (): Record<string, PermLevel> => Object.fromEntries(PERMISSIONS.map((p) => [p.key, top(p)]));

// Costruisce una mappa permessi partendo da "none" e alzando alcune chiavi.
function build(map: Record<string, PermLevel>): Record<string, PermLevel> {
  const base = emptyPerms();
  for (const [k, v] of Object.entries(map)) {
    const perm = PERMISSIONS.find((p) => p.key === k);
    base[k] = perm && perm.levels.includes(v) ? v : perm ? top(perm) : "none";
  }
  return base;
}

// Modelli di permessi predefiniti ("Usa modello di permessi").
export interface PermTemplate { key: string; label: string; desc: string; perms: () => Record<string, PermLevel> }
export const PERM_TEMPLATES: PermTemplate[] = [
  { key: "none", label: "Nessuno", desc: "Nessun accesso: parti da zero.", perms: emptyPerms },
  { key: "owner", label: "Titolare", desc: "Accesso completo a tutto il gestionale.", perms: fullPerms },
  {
    key: "manager", label: "Direttore", desc: "Gestione operativa e commerciale, esclusi utenti e licenza.",
    perms: () => build({ prenotazioni: "edit", calendario: "edit", pulizie: "edit", webconcierge: "edit", alloggiati: "edit", tariffe: "edit", revenue: "edit", ratechecker: "edit", canali: "edit", sito: "edit", statistiche: "edit", cassa: "edit", pagamenti: "edit", chiusura_cassa: "edit", tassa: "edit", camere: "edit", impostazioni: "view", utenti: "view", abbonamento: "view", dati_personali: "view", contatti_ospite: "edit" }),
  },
  {
    key: "reception", label: "Receptionist", desc: "Front-office: prenotazioni, ospiti e incassi giornalieri.",
    perms: () => build({ prenotazioni: "edit", calendario: "edit", webconcierge: "edit", alloggiati: "edit", pulizie: "view", tariffe: "view", statistiche: "view", cassa: "view", pagamenti: "view", chiusura_cassa: "edit", tassa: "view", dati_personali: "view", contatti_ospite: "edit" }),
  },
  {
    key: "housekeeping", label: "Housekeeping", desc: "Solo il planning pulizie e la vista del calendario.",
    perms: () => build({ pulizie: "edit", calendario: "view" }),
  },
  {
    key: "revenue", label: "Revenue manager", desc: "Tariffe, prezzi dinamici e analisi.",
    perms: () => build({ calendario: "view", tariffe: "edit", revenue: "edit", ratechecker: "edit", canali: "edit", sito: "edit", statistiche: "edit" }),
  },
  {
    key: "accountant", label: "Amministrazione", desc: "Cassa, pagamenti, tasse e report.",
    perms: () => build({ cassa: "edit", pagamenti: "edit", chiusura_cassa: "edit", annulla_chiusura: "edit", tassa: "edit", statistiche: "view", abbonamento: "view", prenotazioni: "view" }),
  },
];

// Lingue interfaccia.
export const USER_LANGS = [
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "es", label: "Español", flag: "🇪🇸" },
];

// --- Sezioni "oltre Octorate" -------------------------------------------------
export const NOTIFY_EVENTS = [
  { key: "booking", label: "Nuove prenotazioni" },
  { key: "cancel", label: "Cancellazioni" },
  { key: "checkin", label: "Check-in di oggi" },
  { key: "checkout", label: "Check-out di oggi" },
  { key: "message", label: "Messaggi degli ospiti" },
  { key: "quote", label: "Nuovi preventivi" },
  { key: "cash", label: "Scadenze cassa" },
  { key: "report", label: "Report giornaliero" },
];
export const NOTIFY_CHANNELS = [
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "push", label: "Push (app)" },
];
export const WORK_DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
export const PAY_TYPES = [
  { key: "none", label: "Nessuno" },
  { key: "monthly", label: "Fisso mensile" },
  { key: "hourly", label: "Compenso orario" },
  { key: "perTask", label: "A intervento" },
];
export const TWO_FA_METHODS = [
  { key: "email", label: "Codice via email" },
  { key: "sms", label: "Codice via SMS" },
  { key: "app", label: "App autenticazione" },
];

export interface Session { id: string; device: string; ip: string; lastActive: string; current?: boolean }

// Notifiche di default: eventi operativi via push, cancellazioni anche email.
export function defaultNotify(): Record<string, boolean> {
  const n: Record<string, boolean> = {};
  for (const e of NOTIFY_EVENTS) for (const c of NOTIFY_CHANNELS) n[`${e.key}.${c.key}`] = false;
  n["booking.push"] = true; n["booking.email"] = true;
  n["cancel.push"] = true; n["cancel.email"] = true;
  n["message.push"] = true; n["checkin.push"] = true;
  return n;
}

export const AV_COLORS = ["#BE5D38", "#7A8450", "#C08A3A", "#957A66", "#4F8A5B", "#5B74E6", "#0891B2", "#DB2777", "#EAB308"];
export const initials = (first?: string, last?: string, fallback = "?") => {
  const a = (first ?? "").trim(), b = (last ?? "").trim();
  const s = `${a[0] ?? ""}${b[0] ?? ""}`.toUpperCase();
  return s || (a[0] ?? fallback).toUpperCase();
};

export interface User {
  id: string;
  active: boolean;
  username: string;
  twoFactor: boolean;       // sempre true (obbligatoria)
  firstName: string;
  lastName: string;
  email: string;
  phone: string;            // obbligatorio
  language: string;
  avatarColor?: string;
  // Network / strutture
  managerCheckin: boolean;
  managerCheckout: boolean;
  managerHousekeeping: boolean;
  allStructures: boolean;
  structureIds: string[];
  // Permessi
  templateKey: string;      // modello applicato (o "custom")
  perms: Record<string, PermLevel>;
  // Sicurezza avanzata
  twoFactorMethod?: "email" | "sms" | "app";
  sessions?: Session[];
  // Notifiche (chiave `${event}.${channel}` → on/off)
  notify?: Record<string, boolean>;
  // Turni & disponibilità
  workDays?: string[];
  workFrom?: string;
  workTo?: string;
  // Compenso (collegato alla Cassa · voce Personale)
  payType?: "none" | "monthly" | "hourly" | "perTask";
  payAmount?: number;
  payToCassa?: boolean;
  // Limiti operativi
  maxDiscount?: number;     // % massima di sconto applicabile
  maxRefund?: number;       // € massimo rimborsabile
  maxCashOut?: number;      // € massimo per singola uscita di cassa
  // Comunicazioni
  signature?: string;       // firma su messaggi/preventivi
  guestLangs?: string[];    // lingue con cui può assistere gli ospiti
  internalNote?: string;
  // Stato
  status: "Attivo" | "Invitato";
  lastLogin?: { at: string; ip: string };
  createdAt: string;
}

const USERS_KEY = "spigolestay:users";

export const DEFAULT_USERS: User[] = [
  { id: "u-owner", active: true, username: "andrea", twoFactor: true, twoFactorMethod: "app", firstName: "Andrea", lastName: "Tringali", email: "spigolehouse@gmail.com", phone: "+39 329 307 1740", language: "it", avatarColor: "#BE5D38", managerCheckin: true, managerCheckout: true, managerHousekeeping: true, allStructures: true, structureIds: [], templateKey: "owner", perms: fullPerms(), notify: defaultNotify(), sessions: [{ id: "s1", device: "iPhone 15 · Safari", ip: "79.11.92.186", lastActive: "2026-08-14T10:54:00", current: true }, { id: "s2", device: "MacBook · Chrome", ip: "79.11.92.186", lastActive: "2026-08-13T22:10:00" }], workDays: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"], payType: "none", guestLangs: ["it", "en"], status: "Attivo", lastLogin: { at: "2026-08-14T10:54:00", ip: "79.11.92.186" }, createdAt: "2025-01-10" },
  { id: "u-greta", active: true, username: "greta", twoFactor: true, twoFactorMethod: "email", firstName: "Greta", lastName: "Bianchi", email: "greta@example.com", phone: "+39 331 552 0198", language: "it", avatarColor: "#7A8450", managerCheckin: true, managerCheckout: true, managerHousekeeping: false, allStructures: false, structureIds: ["st_house", "st_rooms"], templateKey: "reception", perms: PERM_TEMPLATES.find((t) => t.key === "reception")!.perms(), notify: defaultNotify(), sessions: [{ id: "s1", device: "Android · Chrome", ip: "151.44.10.2", lastActive: "2026-08-13T18:20:00", current: true }], workDays: ["Lun", "Mar", "Mer", "Gio", "Ven"], workFrom: "08:00", workTo: "16:00", payType: "monthly", payAmount: 1400, payToCassa: true, maxDiscount: 10, maxRefund: 150, maxCashOut: 200, guestLangs: ["it", "en", "fr"], status: "Attivo", lastLogin: { at: "2026-08-13T18:20:00", ip: "151.44.10.2" }, createdAt: "2025-06-02" },
  { id: "u-maria", active: true, username: "maria", twoFactor: true, twoFactorMethod: "sms", firstName: "Maria", lastName: "Russo", email: "maria.pulizie@example.com", phone: "+39 340 118 7742", language: "it", avatarColor: "#C08A3A", managerCheckin: false, managerCheckout: false, managerHousekeeping: true, allStructures: false, structureIds: ["st_cpa", "st_cpd"], templateKey: "housekeeping", perms: PERM_TEMPLATES.find((t) => t.key === "housekeeping")!.perms(), notify: defaultNotify(), workDays: ["Lun", "Mer", "Ven", "Sab", "Dom"], workFrom: "09:00", workTo: "13:00", payType: "hourly", payAmount: 12, payToCassa: false, guestLangs: ["it"], status: "Attivo", createdAt: "2025-09-15" },
];

export function loadUsers(): User[] {
  try { const r = localStorage.getItem(USERS_KEY); if (r) { const list = JSON.parse(r); if (Array.isArray(list) && list.length) return list; } } catch {}
  return DEFAULT_USERS;
}
export function saveUsers(list: User[]) { try { localStorage.setItem(USERS_KEY, JSON.stringify(list)); } catch {} }
export function newUserId() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? `u-${crypto.randomUUID().slice(0, 8)}` : `u-${Math.floor(performance.now() * 1000)}`; }

export function blankUser(): User {
  return { id: newUserId(), active: true, username: "", twoFactor: true, twoFactorMethod: "email", firstName: "", lastName: "", email: "", phone: "", language: "it", avatarColor: AV_COLORS[0], managerCheckin: false, managerCheckout: false, managerHousekeeping: false, allStructures: false, structureIds: [], templateKey: "none", perms: emptyPerms(), sessions: [], notify: defaultNotify(), workDays: [], payType: "none", guestLangs: ["it"], maxDiscount: 0, status: "Invitato", createdAt: new Date().toISOString().slice(0, 10) };
}
