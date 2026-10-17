// Ripulitura dei dati che l'ospite (anonimo) manda a POST /api/checkin: finiscono nel blob del gestore,
// quindi ogni campo ha un tetto di lunghezza e una chiave nota. Funzioni pure (testabili senza rete).
import { todayRome } from "./dates-rome";

export interface DocClean { firstName: string; lastName: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docType?: string; docNumber: string; docPlace?: string }

const cut = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Sesso: solo "M" o "F" (si accetta anche la parola intera: "Female" → F). Qualsiasi altro valore → undefined. */
export function cleanSex(v: unknown): "M" | "F" | undefined {
  const c = typeof v === "string" ? v.trim().charAt(0).toUpperCase() : "";
  return c === "M" || c === "F" ? c : undefined;
}

/** true se `s` è una data ISO (aaaa-mm-gg) di calendario reale, dal 1900 in poi. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Data di nascita: ISO valida e non futura (fuso Roma), altrimenti undefined. */
export function cleanBirthDate(v: unknown, today: string = todayRome()): string | undefined {
  const s = typeof v === "string" ? v.trim().slice(0, 10) : "";
  return isIsoDate(s) && s <= today ? s : undefined;
}

/** true se l'ospite ha scritto una data di nascita ma non è valida (formato sbagliato, inesistente o nel futuro). */
export const birthDateInvalid = (v: unknown, today: string = todayRome()): boolean => typeof v === "string" && v.trim() !== "" && cleanBirthDate(v, today) === undefined;

/** Anagrafica dell'ospite principale con tetti di lunghezza (come per gli ospiti aggiuntivi). */
export function sanitizeDoc(raw: unknown): DocClean {
  const d = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    firstName: (cut(d.firstName, 80) ?? "").trim(), lastName: (cut(d.lastName, 80) ?? "").trim(),
    sex: cleanSex(d.sex), birthDate: cleanBirthDate(d.birthDate), birthPlace: cut(d.birthPlace, 120),
    citizenship: cut(d.citizenship, 80), docType: cut(d.docType, 60), docNumber: (cut(d.docNumber, 60) ?? "").trim(), docPlace: cut(d.docPlace, 120),
  };
}

export interface ExtraClean { firstName: string; lastName: string; sex: string; birthDate: string; birthPlace: string; citizenship: string; docType: string; docNumber: string; docPlace: string; docPhotoFront?: string; docPhotoBack?: string }

/** Ospite aggiuntivo: stessi tetti e stesse regole dell'ospite principale (sesso M/F, data ISO valida e non futura). Le foto restano da risolvere (riferimenti o data URI). */
export function sanitizeExtra(raw: unknown): ExtraClean {
  const g = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const pf = typeof g.docPhotoFront === "string" ? g.docPhotoFront : (typeof g.photoFront === "string" ? g.photoFront : "");
  const pb = typeof g.docPhotoBack === "string" ? g.docPhotoBack : (typeof g.photoBack === "string" ? g.photoBack : "");
  return {
    firstName: str(g.firstName).slice(0, 80).trim(), lastName: str(g.lastName).slice(0, 80).trim(), sex: cleanSex(g.sex) ?? "",
    birthDate: cleanBirthDate(g.birthDate) ?? "", birthPlace: str(g.birthPlace).slice(0, 120),
    citizenship: str(g.citizenship).slice(0, 80), docType: str(g.docType).slice(0, 60), docNumber: str(g.docNumber).slice(0, 60), docPlace: str(g.docPlace).slice(0, 120),
    docPhotoFront: pf || undefined, docPhotoBack: pb || undefined,
  };
}

const KINDS = ["privato", "societa", "estero"];
const INVOICE_TEXT: [string, number][] = [["name", 120], ["vat", 30], ["taxCode", 30], ["address", 160], ["city", 80], ["cap", 20], ["province", 20], ["country", 3], ["sdiCode", 20], ["pec", 120]];

/** Richiesta di fattura: solo le chiavi note (InvoiceRequest), testi tagliati; qualsiasi altra chiave è scartata. */
export function sanitizeInvoiceRequest(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { wants: r.wants === true };
  if (typeof r.kind === "string" && KINDS.includes(r.kind)) out.kind = r.kind;
  for (const [k, max] of INVOICE_TEXT) { const v = cut(r[k], max); if (v) out[k] = v; }
  return out;
}

// ── Riapertura / reinvio: i dati già salvati non si cancellano con valori vuoti o di default ─────────────────────

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Orario di arrivo: "Non lo so" (default del modulo) o vuoto NON sovrascrivono un orario già indicato. */
export function mergeArrivalTime(prev: unknown, next: unknown): string | undefined {
  const n = typeof next === "string" ? next.trim() : "";
  const isDefault = n === "" || n.toLowerCase() === "non lo so";
  const p = typeof prev === "string" && prev.trim() ? prev : undefined;
  if (isDefault) return p ?? (n || undefined);
  return n;
}

/** Note/richieste: se il nuovo testo è vuoto resta quello già salvato. */
export function mergeText(prev: unknown, next: unknown): string | undefined {
  if (!blank(next)) return String(next);
  return blank(prev) ? undefined : String(prev);
}

/**
 * Richiesta di fattura: se la nuova ha `wants: true` sostituisce (conservando i campi non reinviati); se è `{wants:false}` o assente e c'era già una richiesta,
 * la richiesta salvata resta (il modulo anonimo parte sempre da vuoto, un default non deve azzerare i dati fattura).
 */
export function mergeInvoiceRequest(prev: unknown, next: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const p = prev && typeof prev === "object" && !Array.isArray(prev) ? (prev as Record<string, unknown>) : undefined;
  if (next && next.wants === true) return p && p.wants === true ? { ...p, ...next } : next;
  if (p && (p.wants === true || Object.keys(p).some((k) => k !== "wants" && !blank(p[k])))) return p;
  return next ?? p;
}

type GuestLike = { firstName?: string; lastName?: string };
const plain = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const closeEnough = (a: string, b: string) => a === b || lev(a, b) <= (Math.max(a.length, b.length) >= 5 ? 2 : 1);
/** Stessa persona con un refuso nel nome? (nome e cognome vicini, anche scambiati) */
export function samePerson(p: GuestLike, q: GuestLike): boolean {
  const pf = plain(p.firstName), pl = plain(p.lastName), qf = plain(q.firstName), ql = plain(q.lastName);
  return (closeEnough(pf, qf) && closeEnough(pl, ql)) || (closeEnough(pf, ql) && closeEnough(pl, qf));
}
const GUEST_KEYS = ["sex", "birthDate", "birthPlace", "citizenship", "docType", "docNumber", "docPlace", "docPhotoFront", "docPhotoBack"] as const;

/**
 * Co-ospiti: ogni persona del nuovo elenco si abbina a quella già salvata che è la STESSA persona (samePerson, tollera i refusi) cercandola prima nella stessa
 * posizione e poi in tutto l'elenco precedente (cambiano l'ordine o ne manca uno: Anna+Bruno → solo Bruno non deve far diventare Anna un Bruno doppio).
 * Il nuovo vince campo per campo, ma un campo vuoto non cancella quello già salvato. Una persona nuova prende il posto di quella che occupava la sua posizione
 * SOLO se questa non è stata abbinata a nessuno; altrimenti si aggiunge in coda. Chi non compare nel nuovo elenco resta (non si perde un ospite, né le sue foto
 * documento: le foto non più usate le toglie il chiamante con orphanedRefs, solo quelle realmente sostituite).
 */
export function mergeExtraGuests<T extends GuestLike>(prev: T[], next: T[]): T[] {
  const at = (o: T, k: string) => (o as unknown as Record<string, unknown>)[k];
  const matchOfNext: number[] = next.map(() => -1); // indice del precedente abbinato a ciascun nuovo
  const taken = new Set<number>();
  next.forEach((q, i) => { if (i < prev.length && samePerson(prev[i], q)) { matchOfNext[i] = i; taken.add(i); } }); // 1) stessa posizione
  next.forEach((q, i) => {
    if (matchOfNext[i] >= 0) return;
    const j = prev.findIndex((p, k) => !taken.has(k) && samePerson(p, q)); // 2) altrove nell'elenco precedente
    if (j >= 0) { matchOfNext[i] = j; taken.add(j); }
  });
  const out: T[] = prev.slice();
  const appended: T[] = [];
  next.forEach((q, i) => {
    const j = matchOfNext[i];
    if (j >= 0) {
      const p = prev[j];
      const merged = { ...p, ...q } as Record<string, unknown>;
      for (const k of ["firstName", "lastName", ...GUEST_KEYS]) if (blank(at(q, k)) && !blank(at(p, k))) merged[k] = at(p, k);
      out[j] = merged as unknown as T;
    } else if (i < prev.length && !taken.has(i)) out[i] = q; // un'altra persona al posto di quella (non riabbinata): sostituzione esplicita
    else appended.push(q);
  });
  return [...out, ...appended];
}

/**
 * Anagrafica principale della prenotazione: i campi vuoti del nuovo invio non cancellano quelli già salvati, ma SOLO se è la stessa persona
 * (se un'altra persona rifà il check-in come principale non eredita documento, nascita, foto… del precedente).
 */
export function mergePrimaryGuest<T extends Record<string, unknown>>(prev: Record<string, unknown> | undefined, next: T): T {
  if (!prev) return next;
  if (!samePerson(prev as GuestLike, next as GuestLike)) return next;
  const out: Record<string, unknown> = { ...prev, ...next };
  for (const k of Object.keys(next)) if (blank(next[k]) && !blank(prev[k])) out[k] = prev[k];
  return out as T;
}

// ── Età per l'esenzione dalla tassa di soggiorno ───────────────────────────────────────────────────────────────

/** Età compiuta alla data `onDate` (ISO); undefined se le date non sono valide. */
export function ageOn(birthDate: string | undefined, onDate: string): number | undefined {
  if (!isIsoDate(birthDate) || !isIsoDate(onDate)) return undefined;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = onDate.split("-").map(Number);
  let a = y - by;
  if (m < bm || (m === bm && d < bd)) a--;
  return a >= 0 && a < 130 ? a : undefined;
}

/**
 * Età dei MINORI (sotto i 18 anni all'arrivo) ricavate dalle date di nascita raccolte al check-in, da usare come `childAges` della prenotazione.
 * Si aggiornano solo quando le date coprono esattamente i bambini dichiarati (`children`): con dati parziali meglio non toccare quelli esistenti.
 */
export function childAgesFromBirthDates(birthDates: (string | undefined)[], checkIn: string, children: number): number[] | undefined {
  if (!(children > 0)) return undefined;
  const ages = birthDates.map((b) => ageOn(b, checkIn)).filter((a): a is number => a !== undefined && a < 18).sort((a, b) => a - b);
  return ages.length === children ? ages : undefined;
}

// ── Stato della prenotazione rispetto al check-in ───────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v : "");
/** Prenotazione non più attiva per il check-in: annullata / no-show, oppure soggiorno già concluso (checkOut prima di oggi, fuso Roma). */
export function checkinInactiveReason(b: { status?: unknown; checkOut?: unknown }, today: string = todayRome()): "cancelled" | "concluded" | null {
  const st = str(b.status);
  if (st === "cancelled" || st === "no_show") return "cancelled";
  const co = str(b.checkOut);
  if (co && co < today) return "concluded";
  return null;
}
/**
 * Eliminando una prenotazione NON si cancellano dallo Storage i documenti e la firma di un check-in già fatto (webCheckin) su una prenotazione non annullata:
 * l'eliminazione locale non è annullabile e può "risorgere" con la sincronizzazione/fusione (la prenotazione tornerebbe senza documenti né firma).
 * I file di check-in restano finché la schedina è inviata (purga automatica) o la prenotazione è annullata.
 */
export function keepsCheckinFiles(b: { webCheckin?: unknown; status?: unknown }): boolean {
  return b.webCheckin === true && b.status !== "cancelled";
}

/** Le istruzioni di accesso (codici, indirizzo esatto) si danno solo per una prenotazione confermata e non ancora conclusa. */
export function accessInfoVisible(b: { status?: unknown; checkOut?: unknown }, today: string = todayRome()): boolean {
  return str(b.status) === "confirmed" && !!str(b.checkOut) && str(b.checkOut) >= today;
}
