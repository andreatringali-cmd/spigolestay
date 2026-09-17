// Logica CONDIVISA della Cassa (Prima Nota) — usata da /cassa e /chiusura-cassa.
// Persistenza su Supabase (non piu localStorage): cash_movements / cash_rules / cash_paid.
// Importi salvati in CENTS sul DB; qui si lavora in euro (interi, come la Cassa).
import { supabase } from "./supabase";
import { CHANNELS } from "./types";
import type { Booking, Guest, Structure } from "./types";

export type Kind = "in" | "out";
export interface Mov { id: string; date: string; kind: Kind; cat: string; desc: string; amount: number; conto: string; structureId?: string; auto?: boolean; sched?: boolean; ref?: string }
export interface Rule { id: string; kind: Kind; cat: string; desc: string; amount: number; conto: string; structureId?: string; freq: "monthly" | "weekly" | "yearly"; day: number; start: string; end?: string; auto: boolean; note?: string }

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const daysIn = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
const e2c = (e: number) => Math.round(e * 100);
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
export const scopeVisible = (structureId: string | undefined, active: string) =>
  active === "all" || !structureId || structureId === "all" || structureId === active;

// Movimenti automatici dalle prenotazioni (dirette → contanti, OTA → banca + commissione).
export function computeAuto(bookings: Booking[], guests: Guest[], getStructure: (id: string) => Structure | undefined, active: string): Mov[] {
  const out: Mov[] = [];
  for (const b of bookings) {
    if (b.status === "cancelled" || b.channel === "blocked") continue;
    if (active !== "all" && b.structureId !== active) continue;
    const g = guests.find((x) => x.id === b.guestId);
    const st = getStructure(b.structureId);
    const total = b.total ?? 0;
    if (total > 0) out.push({ id: `auto-in-${b.id}`, date: b.checkIn, kind: "in", cat: "prenotazioni", desc: `${g?.fullName ?? "Ospite"} · ${st?.name ?? ""} · ${CHANNELS[b.channel].label}`, amount: total, conto: b.channel === "direct" ? "contanti" : "banca", auto: true, ref: b.id });
    const pct = b.commissionPct ?? CHANNELS[b.channel].commission;
    const comm = Math.round(total * pct);
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

export async function insertMovement(tenantId: string, m: Mov) {
  if (!supabase) return;
  await supabase.from("cash_movements").insert({ ...(isUuid(m.id) ? { id: m.id } : {}), tenant_id: tenantId, structure_id: m.structureId ?? null, date: m.date, kind: m.kind, cat: m.cat, descr: m.desc, amount_cents: e2c(m.amount), conto: m.conto });
}
export async function deleteMovement(id: string) { if (supabase) await supabase.from("cash_movements").delete().eq("id", id); }
export async function insertRule(tenantId: string, r: Rule) {
  if (!supabase) return;
  await supabase.from("cash_rules").insert({ ...(isUuid(r.id) ? { id: r.id } : {}), tenant_id: tenantId, structure_id: r.structureId ?? null, kind: r.kind, cat: r.cat, descr: r.desc, amount_cents: e2c(r.amount), conto: r.conto, freq: r.freq, day: r.day, start_date: r.start, end_date: r.end ?? null, auto: r.auto, note: r.note ?? null });
}
export async function deleteRule(id: string) { if (supabase) await supabase.from("cash_rules").delete().eq("id", id); }
export async function addPaid(tenantId: string, keys: string[]) { if (supabase && keys.length) await supabase.from("cash_paid").upsert(keys.map((k) => ({ tenant_id: tenantId, k })), { onConflict: "tenant_id,k" }); }

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
