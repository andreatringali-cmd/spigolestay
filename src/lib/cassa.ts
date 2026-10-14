// Logica CONDIVISA della Cassa (Prima Nota) — usata da /cassa e /chiusura-cassa.
// Persistenza su Supabase (non piu localStorage): cash_movements / cash_rules / cash_paid.
// Importi salvati in CENTS sul DB; qui si lavora in euro (interi, come la Cassa).
import { supabase } from "./supabase";
import { CHANNELS } from "./types";
import type { Booking, Guest, Structure } from "./types";
import { commissionOf } from "./booking";
import { roundCents, sumCents } from "./money";

export type Kind = "in" | "out";
export interface Mov { id: string; date: string; kind: Kind; cat: string; desc: string; amount: number; conto: string; structureId?: string; auto?: boolean; sched?: boolean; ref?: string }
export interface Rule { id: string; kind: Kind; cat: string; desc: string; amount: number; conto: string; structureId?: string; freq: "monthly" | "weekly" | "yearly"; day: number; start: string; end?: string; auto: boolean; note?: string }

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const daysIn = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
const e2c = (e: number) => Math.round(roundCents(e) * 100);
const c2e = (c: number) => Math.round(c) / 100;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Date di ricorrenza di una regola nell'intervallo [from, to] (ISO inclusi).
export function occurrences(r: Rule, fromISO: string, toISO: string): string[] {
  const res: string[] = [];
  const startISO = r.start;
  const end = r.end && r.end < toISO ? r.end : toISO;
  if (r.freq === "monthly") {
    const sd = new Date(startISO);
    let y = sd.getFullYear(), m = sd.getMonth();
    for (let i = 0; i < 480; i++) {
      const d = Math.min(r.day || sd.getDate(), daysIn(y, m));
      const iso = fmt(y, m, d);
      if (iso > end) break;
      if (iso >= fromISO && iso >= startISO) res.push(iso);
      m++; if (m > 11) { m = 0; y++; }
    }
  } else {
    const d = new Date(startISO);
    for (let i = 0; i < 800; i++) {
      const iso = fmt(d.getFullYear(), d.getMonth(), d.getDate());
      if (iso > end) break;
      if (iso >= fromISO && iso >= startISO) res.push(iso);
      if (r.freq === "weekly") d.setDate(d.getDate() + 7); else d.setFullYear(d.getFullYear() + 1);
    }
  }
  return res;
}

// Una regola/movimento è visibile nello scope della struttura selezionata?
// Con "Tutte" si vede tutto; con UNA struttura selezionata solo ciò che appartiene a quella
// struttura (i movimenti "comuni", senza struttura, restano visibili solo con "Tutte").
export const scopeVisible = (structureId: string | undefined | null, active: string) =>
  active === "all" || structureId === active;

// Movimenti automatici dalle prenotazioni (dirette → contanti, OTA → banca + commissione).
export function computeAuto(bookings: Booking[], guests: Guest[], getStructure: (id: string) => Structure | undefined, active: string): Mov[] {
  const out: Mov[] = [];
  for (const b of bookings) {
    if (b.status === "cancelled" || b.channel === "blocked") continue;
    if (active !== "all" && b.structureId !== active) continue;
    const g = guests.find((x) => x.id === b.guestId);
    const st = getStructure(b.structureId);
    // Incasso automatico = quanto realmente incassato sulla prenotazione (fonte di
    // verità = prenotazione), non l'intero totale: così la cassa/chiusura riflette il reale.
    const incassato = roundCents(b.paid ?? 0);
    if (incassato > 0) out.push({ id: `auto-in-${b.id}`, date: b.checkIn, kind: "in", cat: "prenotazioni", desc: `${g?.fullName ?? "Ospite"} · ${st?.name ?? ""} · ${CHANNELS[b.channel].label}`, amount: incassato, conto: b.channel === "direct" ? "contanti" : "banca", auto: true, ref: b.id });
    const comm = roundCents(commissionOf(b));
    if (comm > 0) out.push({ id: `auto-comm-${b.id}`, date: b.checkIn, kind: "out", cat: "commissioni", desc: `Commissione ${CHANNELS[b.channel].label} · ${g?.fullName ?? "Ospite"}`, amount: comm, conto: "banca", auto: true, ref: b.id });
  }
  return out;
}

// Occorrenze passate (fino a uptoISO) che contano nel saldo: regole automatiche o occorrenze già saldate.
export function computeScheduled(rules: Rule[], paid: Set<string>, active: string, uptoISO: string): Mov[] {
  const out: Mov[] = [];
  const from = fmt(new Date().getFullYear() - 2, new Date().getMonth(), 1);
  for (const r of rules) {
    if (!scopeVisible(r.structureId, active)) continue;
    for (const iso of occurrences(r, from, uptoISO)) {
      if (!r.auto && !paid.has(`${r.id}|${iso}`)) continue;
      out.push({ id: `sched-${r.id}-${iso}`, date: iso, kind: r.kind, cat: r.cat, desc: r.desc, amount: r.amount, conto: r.conto, structureId: r.structureId, sched: true, ref: r.id });
    }
  }
  return out;
}

// ---- Persistenza Supabase --------------------------------------------------
type Row = Record<string, unknown>;
export async function loadCash(): Promise<{ movements: Mov[]; rules: Rule[]; paid: string[] }> {
  if (!supabase) return { movements: [], rules: [], paid: [] };
  const [mv, rl, pd] = await Promise.all([
    supabase.from("cash_movements").select("*").order("date", { ascending: false }),
    supabase.from("cash_rules").select("*"),
    supabase.from("cash_paid").select("k"),
  ]);
  const movements = ((mv.data ?? []) as Row[]).map((r) => ({ id: String(r.id), date: String(r.date), kind: r.kind as Kind, cat: String(r.cat), desc: (r.descr as string) ?? "", amount: c2e(Number(r.amount_cents)), conto: String(r.conto), structureId: (r.structure_id as string) ?? undefined }));
  const rules = ((rl.data ?? []) as Row[]).map((r) => ({ id: String(r.id), kind: r.kind as Kind, cat: String(r.cat), desc: (r.descr as string) ?? "", amount: c2e(Number(r.amount_cents)), conto: String(r.conto), structureId: (r.structure_id as string) ?? undefined, freq: r.freq as Rule["freq"], day: Number(r.day) || 1, start: String(r.start_date), end: (r.end_date as string) ?? undefined, auto: !!r.auto, note: (r.note as string) ?? undefined }));
  const paid = ((pd.data ?? []) as Row[]).map((r) => String(r.k));
  return { movements, rules, paid };
}

// Le scritture restituiscono il messaggio d'errore (null = riuscita), così la pagina può avvisare
// l'utente e annullare la modifica fatta a video invece di lasciarla "fantasma".
export type WriteResult = string | null;
const errMsg = (e: { message?: string } | null | undefined): WriteResult => (e ? (e.message || "errore sconosciuto") : null);
const NO_CONN: WriteResult = "Non sei connesso al server: la modifica non è stata salvata.";

export async function insertMovement(tenantId: string, m: Mov): Promise<WriteResult> {
  if (!supabase) return NO_CONN;
  const { error } = await supabase.from("cash_movements").insert({ ...(isUuid(m.id) ? { id: m.id } : {}), tenant_id: tenantId, structure_id: m.structureId ?? null, date: m.date, kind: m.kind, cat: m.cat, descr: m.desc, amount_cents: e2c(m.amount), conto: m.conto });
  return errMsg(error);
}
export async function deleteMovement(id: string): Promise<WriteResult> {
  if (!supabase) return NO_CONN;
  const { error } = await supabase.from("cash_movements").delete().eq("id", id);
  return errMsg(error);
}
export async function insertRule(tenantId: string, r: Rule): Promise<WriteResult> {
  if (!supabase) return NO_CONN;
  const { error } = await supabase.from("cash_rules").insert({ ...(isUuid(r.id) ? { id: r.id } : {}), tenant_id: tenantId, structure_id: r.structureId ?? null, kind: r.kind, cat: r.cat, descr: r.desc, amount_cents: e2c(r.amount), conto: r.conto, freq: r.freq, day: r.day, start_date: r.start, end_date: r.end ?? null, auto: r.auto, note: r.note ?? null });
  return errMsg(error);
}
export async function deleteRule(id: string): Promise<WriteResult> {
  if (!supabase) return NO_CONN;
  const { error } = await supabase.from("cash_rules").delete().eq("id", id);
  return errMsg(error);
}
export async function addPaid(tenantId: string, keys: string[]): Promise<WriteResult> {
  if (!keys.length) return null;
  if (!supabase) return NO_CONN;
  const { error } = await supabase.from("cash_paid").upsert(keys.map((k) => ({ tenant_id: tenantId, k })), { onConflict: "tenant_id,k" });
  return errMsg(error);
}

// Migrazione una-tantum dei dati Cassa da localStorage → Supabase (per non perdere lo storico).
export async function migrateLocalCash(tenantId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    if (localStorage.getItem("spigolestay:cassa:migrated") === "1") return false;
    const movs: Mov[] = JSON.parse(localStorage.getItem("spigolestay:cassa:v1") || "[]");
    const rules: Rule[] = JSON.parse(localStorage.getItem("spigolestay:cassa:rules") || "[]");
    const paid: string[] = JSON.parse(localStorage.getItem("spigolestay:cassa:paid") || "[]");
    if (movs.length) await supabase.from("cash_movements").insert(movs.map((m) => ({ ...(isUuid(m.id) ? { id: m.id } : {}), tenant_id: tenantId, structure_id: m.structureId ?? null, date: m.date, kind: m.kind, cat: m.cat, descr: m.desc, amount_cents: e2c(m.amount), conto: m.conto })));
    if (rules.length) await supabase.from("cash_rules").insert(rules.map((r) => ({ ...(isUuid(r.id) ? { id: r.id } : {}), tenant_id: tenantId, structure_id: r.structureId ?? null, kind: r.kind, cat: r.cat, descr: r.desc, amount_cents: e2c(r.amount), conto: r.conto, freq: r.freq, day: r.day, start_date: r.start, end_date: r.end ?? null, auto: r.auto, note: r.note ?? null })));
    if (paid.length) await supabase.from("cash_paid").upsert(paid.map((k) => ({ tenant_id: tenantId, k })), { onConflict: "tenant_id,k" });
    localStorage.setItem("spigolestay:cassa:migrated", "1");
    return movs.length > 0 || rules.length > 0 || paid.length > 0;
  } catch { return false; }
}

// Riga dell'elenco movimenti: una voce normale, oppure UNA voce per prenotazione con lordo, commissioni e netto
// (l'incasso automatico e la commissione OTA della stessa prenotazione). I totali restano calcolati dai movimenti separati: cambia solo come si leggono.
export type CassaListRow =
  | { type: "mov"; mov: Mov }
  | { type: "booking"; id: string; income: Mov; commission?: Mov; gross: number; comm: number; net: number };

export function groupBookingRows(rows: Mov[]): CassaListRow[] {
  const commByRef = new Map<string, Mov>();
  for (const m of rows) if (m.id.startsWith("auto-comm-") && m.ref) commByRef.set(m.ref, m);
  const incomeRefs = new Set(rows.filter((m) => m.id.startsWith("auto-in-") && m.ref).map((m) => m.ref as string));
  const out: CassaListRow[] = [];
  for (const m of rows) {
    if (m.id.startsWith("auto-comm-") && m.ref && incomeRefs.has(m.ref)) continue; // già dentro la voce della prenotazione
    if (m.id.startsWith("auto-in-") && m.ref && commByRef.has(m.ref)) {
      const c = commByRef.get(m.ref)!;
      out.push({ type: "booking", id: m.ref, income: m, commission: c, gross: m.amount, comm: c.amount, net: roundCents(m.amount - c.amount) });
    } else out.push({ type: "mov", mov: m });
  }
  return out;
}

// ── Saldo di partenza ("tirare una riga") ───────────────────────────────────────────────────────────────────────────────
// Senza lo storico delle uscite passate, l'host scrive quanto ha oggi su un conto: da quella data il saldo parte da quell'importo e si aggiorna
// con le entrate e le uscite dei giorni SUCCESSIVI (fino a oggi). Il movimento di partenza è un normale movimento con categoria "apertura".
export const OPENING_CAT = "apertura";
const signed = (m: Mov) => (m.kind === "in" ? m.amount : -m.amount);
export interface Balance { saldo: number; since?: string; start?: number }

/** Saldo attuale per conto. Con un saldo di partenza: importo di partenza + movimenti dei giorni dopo la data di partenza, fino a oggi.
 *  Senza saldo di partenza resta la somma di tutti i movimenti, come prima. Il saldo di partenza più recente vince. */
export function computeBalances(movs: Mov[], today: string, conti: string[]): Record<string, Balance> {
  const out: Record<string, Balance> = {};
  for (const conto of conti) {
    const op = movs.filter((m) => m.cat === OPENING_CAT && m.conto === conto).reduce<Mov | undefined>((best, m) => (!best || m.date >= best.date ? m : best), undefined);
    if (!op) { out[conto] = { saldo: sumCents(movs.filter((m) => m.conto === conto && m.cat !== OPENING_CAT).map(signed)) }; continue; }
    const after = movs.filter((m) => m.conto === conto && m.cat !== OPENING_CAT && m.date > op.date && m.date <= today);
    out[conto] = { saldo: roundCents(signed(op) + sumCents(after.map(signed))), since: op.date, start: signed(op) };
  }
  return out;
}

// ── Asse e etichette dei grafici ────────────────────────────────────────────────────────────────────────────────────────
/** Importo in forma breve per etichette strette: 850 · 1,2k · 12k · 1,5M. */
export function compactEuro(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (a >= 10_000) return `${Math.round(n / 1000)}k`;
  if (a >= 1_000) return `${(n / 1000).toFixed(1).replace(".", ",")}k`;
  return String(Math.round(n));
}

/** Massimo "tondo" dell'asse Y e passo tra le linee (4 intervalli): 1, 1,5, 2, 2,5, 5 × potenza di 10. */
export function niceAxis(maxValue: number): { max: number; step: number } {
  if (!(maxValue > 0)) return { max: 4, step: 1 };
  const exp = Math.floor(Math.log10(maxValue / 4));
  for (const mult of [1, 1.5, 2, 2.5, 5, 10]) {
    const step = mult * 10 ** exp;
    if (step * 4 >= maxValue - 1e-9) return { max: step * 4, step };
  }
  const step = 10 ** (exp + 1);
  return { max: step * 4, step };
}
