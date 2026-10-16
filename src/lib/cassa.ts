// Logica CONDIVISA della Cassa (Prima Nota) — usata da /cassa e /chiusura-cassa.
// Persistenza su Supabase (non piu localStorage): cash_movements / cash_rules / cash_paid.
// Importi salvati in CENTS sul DB; qui si lavora in euro (interi, come la Cassa).
import { supabase } from "./supabase";
import { CHANNELS } from "./types";
import type { Booking, Guest, Structure } from "./types";
import { commissionOf, commissionShareOf, bookingExtrasTotal, lordoOf } from "./booking";
import { cassaContoFor } from "./pay-method";
import { shiftISO } from "./dates";
import { payoutDate, loadPayoutSettings, commissionRuleFor, commissionMonthOf, commissionDateFor, type PayoutSettingsMap } from "./payouts";
import { roundCents, sumCents } from "./money";
import { onlineIncasso, directDepositIncasso } from "./online-pay";

export type Kind = "in" | "out";
export interface Mov { id: string; date: string; kind: Kind; cat: string; desc: string; amount: number; conto: string; structureId?: string; auto?: boolean; sched?: boolean; ref?: string; forecast?: boolean; channel?: string /* canale della prenotazione da cui nasce */; bookingStructureId?: string /* struttura della prenotazione da cui nasce (movimenti automatici): serve a non mescolare strutture nei bonifici unici */; edited?: boolean /* riga di una scadenza modificata a mano */; occKey?: string /* chiave originale della scadenza (regola|data) */; variable?: boolean /* scadenza a importo variabile: l'importo è una stima */; commRefs?: string[] /* commissioni mensili tutte insieme: id delle prenotazioni incluse */ }
export interface Rule { id: string; kind: Kind; cat: string; desc: string; amount: number; conto: string; structureId?: string; freq: "monthly" | "weekly" | "yearly"; day: number; start: string; end?: string; auto: boolean; note?: string; variable?: boolean /* importo variabile: l'importo è una stima, alla scadenza si registra quello reale */ }

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
/**
 * A quale struttura appartengono gli INCASSI di una prenotazione: a quella che l'ha RICEVUTA dall'OTA (e con le sue regole di incasso e commissioni).
 * Spostarla di camera in un'altra struttura cambia solo la disponibilità nel calendario: `movedFrom` ricorda la struttura di origine.
 */
export const cashStructureOf = (b: { structureId: string; movedFrom?: { structureId?: string } | null }): string => b.movedFrom?.structureId || b.structureId;
/** La prenotazione vista dalla Cassa: stessa prenotazione, ma con la struttura che incassa (vedi cashStructureOf). */
export function cashView<T extends { structureId: string; movedFrom?: { structureId?: string } | null }>(b: T): T {
  const sid = cashStructureOf(b);
  return sid === b.structureId ? b : { ...b, structureId: sid };
}
/**
 * AMBITO della Cassa (quali strutture si stanno guardando): "all" = tutte le strutture dell'account (somma di tutto, comprese le voci "comuni" senza struttura);
 * una stringa = UNA struttura; un array = un SOTTOINSIEME di strutture (le voci senza struttura non si vedono). Una selezione che copre tutte le strutture vale "all" (vedi cashScopeOf).
 */
export type CashScope = "all" | string | readonly string[];
/** Struttura di una voce: le voci "comuni" (nessuna struttura, oppure il vecchio valore "all") danno "". */
export const normSid = (s: string | undefined | null): string => (s && s !== "all" ? s : "");
export function scopeVisible(structureId: string | undefined | null, scope: CashScope): boolean {
  if (typeof scope === "string") return scope === "all" || structureId === scope;
  const sid = normSid(structureId);
  return sid !== "" && scope.includes(sid);
}
/** Ambito dalla selezione delle strutture in alto a destra: tutte (o nessuna) → "all"; una sola → il suo id; più d'una → l'elenco. */
export function cashScopeOf(selectedIds: readonly string[], allIds: readonly string[]): CashScope {
  const sel = selectedIds.filter((id) => allIds.includes(id));
  if (sel.length === 0 || allIds.every((id) => sel.includes(id))) return "all";
  return sel.length === 1 ? sel[0] : sel;
}
/** Le strutture dell'ambito (per "all": tutte quelle dell'account). */
export const scopeIds = (scope: CashScope, allIds: readonly string[]): string[] => (typeof scope === "string" ? (scope === "all" ? [...allIds] : [scope]) : allIds.filter((id) => scope.includes(id)));
/** Struttura a cui appartiene un movimento (quella della prenotazione per i movimenti automatici; "" = comune). */
export const movSid = (m: { structureId?: string; bookingStructureId?: string }): string => normSid(m.bookingStructureId || m.structureId);

/** Id del secondo movimento di incasso di una prenotazione diretta pagata online: la parte NON pagata online (es. saldo in contanti all'arrivo). Comincia per `auto-in-`, così i filtri e i raggruppamenti per prenotazione lo riconoscono. */
export const REST_IN_PREFIX = "auto-in-resto-";
/** Conto della parte NON pagata online: segue la scelta del gestore; senza scelta è quello storico (diretta → contanti), non la carta dedotta dal pagamento online. */
const restContoFor = (b: Booking, r: ContiRoute) => cassaContoFor({ ...b, stripePaymentIntent: undefined }, r.principal, r.validConti, r.accounts);
/** Instradamento dei conti PER STRUTTURA: `principal` stringa = vecchio comportamento (stessi conti per tutte le strutture); funzione = conti propri di ogni struttura (vedi routeFor). */
function routeResolver(principal: string | ContiRouter, validConti: string[] | undefined): ContiRouter {
  if (typeof principal === "function") {
    const cache = new Map<string, ContiRoute>();
    return (sid) => { let r = cache.get(sid); if (!r) { r = principal(sid); cache.set(sid, r); } return r; };
  }
  const r: ContiRoute = { principal, validConti: validConti ?? loadConti().map((c) => c.key) };
  return () => r;
}

/** Id dei movimenti "commissioni mensili tutte insieme": auto-commm-<struttura>-<canale>-<aaaa-mm>. NB: diverso da `auto-comm-` (commissione della singola prenotazione), che non deve combaciare. */
export const COMM_MONTH_PREFIX = "auto-commm-";
const MONTHS_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const monthNameIT = (ym: string) => `${MONTHS_IT[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;

/**
 * Commissione di una prenotazione che il portale trattiene "tutte insieme" (modalità mensile): importo, % reale e data della trattenuta.
 * Serve al registro per mostrarla in forma INFORMATIVA accanto all'incasso; undefined se la struttura/portale non usa la modalità mensile o non c'è commissione.
 */
export function monthlyCommissionInfo(bk: Booking, payouts: PayoutSettingsMap): { amount: number; pct: number; date: string } | undefined {
  const b = cashView(bk);
  if (b.status === "cancelled" || b.channel === "blocked") return undefined;
  const rule = commissionRuleFor(payouts, b.channel, b.structureId);
  if (!rule) return undefined;
  const amount = roundCents(commissionOf(b));
  if (amount <= 0) return undefined;
  return { amount, pct: commissionShareOf(b), date: commissionDateFor(commissionMonthOf(b), rule.day) };
}

/**
 * Prenotazione OTA prolungata a mano nel gestionale (es. 3 notti in più pagate all'ospite in contanti): l'OTA conosce solo le notti di nightlyRates, quindi il suo bonifico
 * copre solo quelle; il di più (totale − notti dell'OTA) l'ospite lo paga direttamente, dal giorno in cui finisce la prenotazione originale. null se non c'è nulla da separare.
 */
export function otaExtensionOf(b: Booking): { ota: number; extra: number; from: string } | null {
  if (b.channel === "direct" || b.channel === "blocked" || !b.nightlyRates) return null;
  const keys = Object.keys(b.nightlyRates).sort();
  if (!keys.length) return null;
  const ota = roundCents(keys.reduce((a, k) => a + (Number(b.nightlyRates![k]) || 0), 0));
  const extra = roundCents(lordoOf(b) - ota);
  if (!(ota > 0) || extra < 0.5 || extra >= lordoOf(b)) return null;
  return { ota, extra, from: shiftISO(keys[keys.length - 1], 1) };
}

// Movimenti automatici dalle prenotazioni (dirette → contanti, OTA → banca + commissione).
// Commissioni: di norma un movimento per prenotazione, alla data dell'incasso. Se la struttura ha impostato per quel portale "commissioni tutte insieme il giorno N
// del mese dopo" (PayoutRule.commission), NON c'è più il movimento per prenotazione: c'è UN movimento per (struttura, canale, mese del CHECK-OUT) datato il giorno N
// del mese successivo, con la somma delle commissioni (ai centesimi) delle prenotazioni non annullate di quel mese. L'incasso resta lordo e invariato.
// Diretta pagata online (Stripe): la parte pagata online è datata al giorno del pagamento (booking.paidAt), non all'arrivo.
export function computeAuto(bookings: Booking[], guests: Guest[], getStructure: (id: string) => Structure | undefined, active: CashScope, principal: string | ContiRouter = defaultContiRouter(), payouts: PayoutSettingsMap = loadPayoutSettings(), validConti?: string[]): Mov[] {
  const out: Mov[] = [];
  const routeOf = routeResolver(principal, validConti); // conti della struttura che incassa (principale, contanti, carta)
  const batches = new Map<string, { structureId: string; channel: Booking["channel"]; ym: string; day: number; principal: string; items: { id: string; checkOut: string; comm: number }[] }>();
  const structIds = new Set<string>(); // strutture delle prenotazioni visibili: se più di una, il nome struttura entra nella descrizione delle commissioni mensili
  for (const b of bookings.map(cashView)) {
    if (b.status === "cancelled" || b.channel === "blocked") continue;
    if (!scopeVisible(b.structureId, active)) continue;
    structIds.add(b.structureId);
    const route = routeOf(b.structureId);
    const principal = route.principal; // conto principale DELLA STRUTTURA che incassa
    const when = payoutDate(b, payouts); // data in cui i soldi arrivano davvero (impostazioni del canale, della struttura della prenotazione)
    const g = guests.find((x) => x.id === b.guestId);
    const st = getStructure(b.structureId);
    // Incasso automatico = quanto realmente incassato sulla prenotazione (fonte di
    // verità = prenotazione), non l'intero totale: così la cassa/chiusura riflette il reale.
    const incassato = roundCents(b.paid ?? 0);
    // Diretta pagata online (Stripe): la parte online è incassata il giorno del pagamento, non all'arrivo; il resto (es. saldo in contanti all'arrivo) alla data del canale.
    // Diretta senza pagamento online: l'acconto (50% o la % della struttura) si versa alla data della prenotazione, il resto all'arrivo.
    const ext = otaExtensionOf(b);
    const online = onlineIncasso(b) ?? directDepositIncasso(b, lordoOf(b), st?.depositPct);
    if (online) {
      const label = `${g?.fullName ?? "Ospite"} · ${st?.name ?? ""} · ${CHANNELS[b.channel].label}`;
      if (online.amount > 0) out.push({ id: `auto-in-${b.id}`, date: online.date, channel: b.channel, bookingStructureId: b.structureId, kind: "in", cat: "prenotazioni", desc: label, amount: online.amount, conto: cassaContoFor(b, principal, route.validConti, route.accounts), auto: true, ref: b.id });
      if (online.rest > 0) out.push({ id: `${REST_IN_PREFIX}${b.id}`, date: when, channel: b.channel, bookingStructureId: b.structureId, kind: "in", cat: "prenotazioni", desc: label, amount: online.rest, conto: restContoFor(b, route), auto: true, ref: b.id });
    } else if (incassato > 0 && ext && incassato > ext.ota + 0.005) {
      // OTA prolungata: il bonifico del portale copre le notti dell'OTA, le notti in più sono incassate dall'ospite alla fine della prenotazione originale
      const label = `${g?.fullName ?? "Ospite"} · ${st?.name ?? ""} · ${CHANNELS[b.channel].label}`;
      out.push({ id: `auto-in-${b.id}`, date: when, channel: b.channel, bookingStructureId: b.structureId, kind: "in", cat: "prenotazioni", desc: label, amount: ext.ota, conto: cassaContoFor(b, principal, route.validConti, route.accounts), auto: true, ref: b.id });
      out.push({ id: `${REST_IN_PREFIX}${b.id}`, date: ext.from, channel: b.channel, bookingStructureId: b.structureId, kind: "in", cat: "prenotazioni", desc: `${label} · prolungamento`, amount: roundCents(incassato - ext.ota), conto: cassaContoFor({ channel: "direct", paymentMethod: "contanti" }, principal, route.validConti, route.accounts), auto: true, ref: b.id });
    } else if (incassato > 0) out.push({ id: `auto-in-${b.id}`, date: when, channel: b.channel, bookingStructureId: b.structureId, kind: "in", cat: "prenotazioni", desc: `${g?.fullName ?? "Ospite"} · ${st?.name ?? ""} · ${CHANNELS[b.channel].label}`, amount: incassato, conto: cassaContoFor(b, principal, route.validConti, route.accounts), auto: true, ref: b.id });
    const comm = roundCents(commissionOf(b));
    const mrule = commissionRuleFor(payouts, b.channel, b.structureId);
    if (mrule) {
      // commissioni tutte insieme: si accumulano nel movimento del mese di check-out
      if (comm > 0) {
        const ym = commissionMonthOf(b);
        const key = `${b.structureId}|${b.channel}|${ym}`;
        let bt = batches.get(key);
        if (!bt) { bt = { structureId: b.structureId, channel: b.channel, ym, day: mrule.day, principal, items: [] }; batches.set(key, bt); }
        bt.items.push({ id: b.id, checkOut: b.checkOut || b.checkIn, comm });
      }
    } else if (comm > 0) out.push({ id: `auto-comm-${b.id}`, date: when, channel: b.channel, bookingStructureId: b.structureId, kind: "out", cat: "commissioni", desc: `Commissione ${CHANNELS[b.channel].label} · ${g?.fullName ?? "Ospite"}`, amount: comm, conto: principal, auto: true, ref: b.id });
  }
  for (const bt of batches.values()) {
    const amount = sumCents(bt.items.map((i) => i.comm));
    if (amount <= 0) continue;
    const items = bt.items.slice().sort((a, b) => (a.checkOut < b.checkOut ? -1 : a.checkOut > b.checkOut ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const stName = structIds.size > 1 ? getStructure(bt.structureId)?.name : undefined;
    const n = items.length;
    out.push({ id: `${COMM_MONTH_PREFIX}${bt.structureId}-${bt.channel}-${bt.ym}`, date: commissionDateFor(bt.ym, bt.day), channel: bt.channel, bookingStructureId: bt.structureId, kind: "out", cat: "commissioni", desc: `Commissioni ${CHANNELS[bt.channel].label}${stName ? ` · ${stName}` : ""} · ${monthNameIT(bt.ym)} · ${n} ${n === 1 ? "prenotazione" : "prenotazioni"}`, amount, conto: bt.principal, auto: true, commRefs: items.map((i) => i.id) });
  }
  return out;
}

// Occorrenze passate (fino a uptoISO) che contano nel saldo: regole automatiche o occorrenze già saldate.
export function computeScheduled(rules: Rule[], paid: Set<string>, active: CashScope, uptoISO: string): Mov[] {
  const out: Mov[] = [];
  const from = fmt(new Date().getFullYear() - 2, new Date().getMonth(), 1);
  for (const r of rules) {
    if (!scopeVisible(r.structureId, active)) continue;
    if (r.variable) continue; // importo variabile: alla scadenza si registra un movimento con l'importo reale
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
  const rules = ((rl.data ?? []) as Row[]).map((r) => ({ id: String(r.id), kind: r.kind as Kind, cat: String(r.cat), desc: (r.descr as string) ?? "", amount: c2e(Number(r.amount_cents)), conto: String(r.conto), structureId: (r.structure_id as string) ?? undefined, freq: r.freq as Rule["freq"], day: Number(r.day) || 1, start: String(r.start_date), end: (r.end_date as string) ?? undefined, auto: !!r.auto, note: (r.note as string) ?? undefined, variable: !!r.variable }));
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
export async function updateMovement(id: string, m: Mov): Promise<WriteResult> {
  if (!supabase) return NO_CONN;
  const { error } = await supabase.from("cash_movements").update({ structure_id: m.structureId ?? null, date: m.date, kind: m.kind, cat: m.cat, descr: m.desc, amount_cents: e2c(m.amount), conto: m.conto }).eq("id", id);
  return errMsg(error);
}
export async function deleteMovement(id: string): Promise<WriteResult> {
  if (!supabase) return NO_CONN;
  const { error } = await supabase.from("cash_movements").delete().eq("id", id);
  return errMsg(error);
}
export async function insertRule(tenantId: string, r: Rule): Promise<WriteResult> {
  if (!supabase) return NO_CONN;
  const { error } = await supabase.from("cash_rules").insert({ ...(isUuid(r.id) ? { id: r.id } : {}), tenant_id: tenantId, structure_id: r.structureId ?? null, kind: r.kind, cat: r.cat, descr: r.desc, amount_cents: e2c(r.amount), conto: r.conto, freq: r.freq, day: r.day, start_date: r.start, end_date: r.end ?? null, auto: r.auto, note: r.note ?? null, variable: !!r.variable });
  return errMsg(error);
}
export async function updateRule(id: string, r: Rule): Promise<WriteResult> {
  if (!supabase) return NO_CONN;
  const { error } = await supabase.from("cash_rules").update({ structure_id: r.structureId ?? null, kind: r.kind, cat: r.cat, descr: r.desc, amount_cents: e2c(r.amount), conto: r.conto, freq: r.freq, day: r.day, start_date: r.start, end_date: r.end ?? null, auto: r.auto, note: r.note ?? null, variable: !!r.variable }).eq("id", id);
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
    if (rules.length) await supabase.from("cash_rules").insert(rules.map((r) => ({ ...(isUuid(r.id) ? { id: r.id } : {}), tenant_id: tenantId, structure_id: r.structureId ?? null, kind: r.kind, cat: r.cat, descr: r.desc, amount_cents: e2c(r.amount), conto: r.conto, freq: r.freq, day: r.day, start_date: r.start, end_date: r.end ?? null, auto: r.auto, note: r.note ?? null, variable: !!r.variable })));
    if (paid.length) await supabase.from("cash_paid").upsert(paid.map((k) => ({ tenant_id: tenantId, k })), { onConflict: "tenant_id,k" });
    localStorage.setItem("spigolestay:cassa:migrated", "1");
    return movs.length > 0 || rules.length > 0 || paid.length > 0;
  } catch { return false; }
}

// Riga dell'elenco movimenti: una voce normale, oppure UNA voce per prenotazione con lordo, commissioni e netto
// (l'incasso automatico e la commissione OTA della stessa prenotazione). I totali restano calcolati dai movimenti separati: cambia solo come si leggono.
export type CassaListRow =
  | { type: "mov"; mov: Mov }
  | { type: "booking"; id: string; income: Mov; commission?: Mov; gross: number; comm: number; net: number }
  // un bonifico/pagamento dell'OTA che riunisce più prenotazioni (stessa struttura, stesso canale, stessa data di incasso)
  | { type: "payout"; id: string; channel: string; structureId?: string; date: string; items: CassaListRow[]; gross: number; comm: number; net: number; count: number; movIds: string[]; forecast: boolean }
  // i saldi di partenza dei conti di una struttura, nella stessa data: una riga chiusa che si apre sul dettaglio dei conti
  | { type: "opening"; id: string; date: string; structureId?: string; items: Mov[]; total: number; movIds: string[] };

const BOOKING_MOV = /^(auto-in|auto-comm|fc-in)-/;
/** `groupPayout(canale, strutturaId)`: il canale di quella struttura è pagato con un bonifico unico (settimanale/mensile)? Senza, nessun raggruppamento. */
export function groupBookingRows(rows: Mov[], groupPayout?: (channel: string, structureId: string | undefined) => boolean): CassaListRow[] {
  const commByRef = new Map<string, Mov>();
  for (const m of rows) if (m.id.startsWith("auto-comm-") && m.ref) commByRef.set(m.ref, m);
  // L'incasso della voce unica è quello già incassato (auto-in); se non c'è ancora nulla incassato, è il "da incassare" previsto (fc-in).
  const autoRefs = new Set(rows.filter((m) => m.id.startsWith("auto-in-") && m.ref).map((m) => m.ref as string));
  const isIncome = (m: Mov) => !!m.ref && !m.id.startsWith(REST_IN_PREFIX) && (m.id.startsWith("auto-in-") || (m.id.startsWith("fc-in-") && !autoRefs.has(m.ref)));
  const incomeRefs = new Set(rows.filter(isIncome).map((m) => m.ref as string));
  const out: CassaListRow[] = [];
  for (const m of rows) {
    if (m.id.startsWith("auto-comm-") && m.ref && incomeRefs.has(m.ref)) continue; // già dentro la voce della prenotazione
    if (isIncome(m) && commByRef.has(m.ref as string)) {
      const c = commByRef.get(m.ref as string)!;
      out.push({ type: "booking", id: m.ref as string, income: m, commission: c, gross: m.amount, comm: c.amount, net: roundCents(m.amount - c.amount) });
    } else out.push({ type: "mov", mov: m });
  }
  if (!groupPayout) return out;
  // Canali con bonifico settimanale/mensile: le prenotazioni della STESSA struttura incassate nella stessa data si riuniscono in una voce.
  const res: CassaListRow[] = [];
  const groups = new Map<string, Extract<CassaListRow, { type: "payout" }>>();
  const refs = new Map<string, Set<string>>();
  for (const r of out) {
    if (r.type === "payout" || r.type === "opening") { res.push(r); continue; }
    const m = r.type === "booking" ? r.income : r.mov;
    if (!(m.channel && BOOKING_MOV.test(m.id) && groupPayout(m.channel, m.bookingStructureId))) { res.push(r); continue; }
    const key = `${m.bookingStructureId ?? ""}|${m.channel}|${m.date}`;
    let g = groups.get(key);
    if (!g) { g = { type: "payout", id: `po-${key}`, channel: m.channel, structureId: m.bookingStructureId, date: m.date, items: [], gross: 0, comm: 0, net: 0, count: 0, movIds: [], forecast: true }; groups.set(key, g); refs.set(key, new Set()); res.push(g); }
    const gross = r.type === "booking" ? r.gross : m.kind === "in" ? m.amount : 0;
    const comm = r.type === "booking" ? r.comm : m.kind === "out" ? m.amount : 0;
    g.items.push(r);
    g.gross = roundCents(g.gross + gross); g.comm = roundCents(g.comm + comm); g.net = roundCents(g.gross - g.comm);
    g.movIds.push(...(r.type === "booking" ? [r.income.id, ...(r.commission ? [r.commission.id] : [])] : [m.id]));
    if (!m.forecast) g.forecast = false;
    refs.get(key)!.add(m.ref ?? m.id); g.count = refs.get(key)!.size;
  }
  return res;
}

// ── Saldo di partenza ("tirare una riga") ───────────────────────────────────────────────────────────────────────────────
// Senza lo storico delle uscite passate, l'host scrive quanto ha oggi su un conto: da quella data il saldo parte da quell'importo e si aggiorna
// con le entrate e le uscite dei giorni SUCCESSIVI (fino a oggi). Il movimento di partenza è un normale movimento con categoria "apertura".
export const OPENING_CAT = "apertura";
/** Riunisce in UNA riga i saldi di partenza (uno per conto) della stessa struttura e della stessa data: nel registro è una riga chiusa con il totale, e si apre sul dettaglio dei conti. */
export function groupOpeningRows(rows: CassaListRow[]): CassaListRow[] {
  const out: CassaListRow[] = [];
  const idx = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== "mov" || r.mov.cat !== OPENING_CAT) { out.push(r); continue; }
    const m = r.mov;
    const key = `${m.structureId ?? ""}|${m.date}`;
    const at = idx.get(key);
    const amt = m.kind === "in" ? m.amount : -m.amount;
    if (at === undefined) { idx.set(key, out.length); out.push({ type: "opening", id: `op-${key}`, date: m.date, structureId: m.structureId, items: [m], total: roundCents(amt), movIds: [m.id] }); continue; }
    const g = out[at] as Extract<CassaListRow, { type: "opening" }>;
    g.items.push(m); g.movIds.push(m.id); g.total = roundCents(g.total + amt);
  }
  // un solo saldo di partenza (un solo conto) resta una riga normale
  return out.map((r) => (r.type === "opening" && r.items.length === 1 ? { type: "mov" as const, mov: r.items[0] } : r));
}
const signed = (m: Mov) => (m.kind === "in" ? m.amount : -m.amount);
export interface Balance { saldo: number; since?: string; start?: number }

/** Un pezzo del saldo: una STRUTTURA (sid; "" = comune) su un conto.
 *  own = ha il PROPRIO saldo di partenza; senza, può essere "coperto" dal vecchio saldo comune (since valorizzato, solo con l'ambito "all"). */
export interface BalancePart { sid: string; conto: string; saldo: number; since?: string; start?: number; own: boolean }

const latestOf = (list: Mov[]): Mov | undefined => list.reduce<Mov | undefined>((best, m) => (!best || m.date >= best.date ? m : best), undefined);

/**
 * Saldi PER STRUTTURA e per conto nell'ambito dato. Per ogni coppia (struttura, conto) c'è il suo saldo di partenza (il più recente) e contano SOLO i movimenti di quella
 * struttura dei giorni dopo la data di partenza, fino a oggi. Il totale è la somma dei pezzi.
 * Compatibilità: un vecchio saldo di partenza SENZA struttura (comune) vale solo con l'ambito "all": copre i movimenti di tutte le strutture che su quel conto non hanno
 * ancora il proprio saldo (come prima che i saldi fossero per struttura); appena una struttura scrive il proprio, i suoi movimenti passano a quello.
 * Un conto senza alcun saldo di partenza resta la somma di tutti i movimenti, senza "since".
 */
export function balanceParts(movs: Mov[], today: string, conti: string[], scope: CashScope = "all"): BalancePart[] {
  const inScope = movs.filter((m) => scopeVisible(movSid(m) || undefined, scope));
  const sids = [...new Set(inScope.map(movSid))];
  const parts: BalancePart[] = [];
  for (const conto of conti) {
    const cm = inScope.filter((m) => m.conto === conto);
    const opens = cm.filter((m) => m.cat === OPENING_CAT);
    const real = cm.filter((m) => m.cat !== OPENING_CAT);
    const own = new Map<string, Mov>();
    for (const sid of sids) { const op = latestOf(opens.filter((m) => movSid(m) === sid)); if (op) own.set(sid, op); }
    if (own.size === 0) {
      for (const sid of sids) { const r = real.filter((m) => movSid(m) === sid); if (r.length) parts.push({ sid, conto, saldo: sumCents(r.map(signed)), own: false }); }
      continue;
    }
    const common = scope === "all" ? own.get("") : undefined;
    for (const sid of sids) {
      const gm = real.filter((m) => movSid(m) === sid);
      const op = own.get(sid);
      if (op) parts.push({ sid, conto, saldo: roundCents(signed(op) + sumCents(gm.filter((m) => m.date > op.date && m.date <= today).map(signed))), since: op.date, start: signed(op), own: true });
      else if (common) parts.push({ sid, conto, saldo: sumCents(gm.filter((m) => m.date > common.date && m.date <= today).map(signed)), since: common.date, own: false });
    }
  }
  return parts;
}

/**
 * Saldi di partenza che un nuovo salvataggio SOSTITUISCE: quelli della stessa struttura sullo stesso conto e, per i conti che si stanno salvando, i vecchi saldi COMUNI
 * (senza struttura, vecchio sistema): così non si contano due volte. Gli altri conti e le altre strutture non si toccano.
 */
export function openingsReplacedBy(movs: Mov[], saved: { sid: string; conto: string }[]): Mov[] {
  const contos = new Set(saved.map((s) => s.conto));
  return movs.filter((m) => m.cat === OPENING_CAT && (saved.some((s) => s.conto === m.conto && movSid(m) === s.sid) || (contos.has(m.conto) && movSid(m) === "")));
}
/** Il saldo di partenza in vigore (il più recente) di una struttura su un conto; sid "" = comune (vecchio sistema, senza struttura). */
export const openingOf = (movs: Mov[], sid: string, conto: string): Mov | undefined => latestOf(movs.filter((m) => m.cat === OPENING_CAT && m.conto === conto && movSid(m) === sid));
/** Importo con segno di un movimento (entrata +, uscita −). */
export const signedAmount = (m: { kind: Kind; amount: number }): number => (m.kind === "in" ? m.amount : -m.amount);

/** Totale per struttura dei conti con saldo di partenza (stessa regola del saldo attuale: i conti senza saldo di partenza non hanno uno storico completo e non contano). */
export function balanceTotalsBySid(parts: BalancePart[]): { sid: string; saldo: number }[] {
  const map = new Map<string, number>();
  for (const p of parts) if (p.since) map.set(p.sid, sumCents([map.get(p.sid) ?? 0, p.saldo]));
  return [...map.entries()].map(([sid, saldo]) => ({ sid, saldo }));
}

/** Saldo attuale per conto nell'ambito dato: somma dei saldi delle strutture (vedi balanceParts). Con un saldo di partenza: importo + movimenti dei giorni dopo la data,
 *  fino a oggi. Senza saldo di partenza resta la somma di tutti i movimenti, come prima. Per ogni struttura il saldo di partenza più recente vince. */
export function computeBalances(movs: Mov[], today: string, conti: string[], scope: CashScope = "all"): Record<string, Balance> {
  const parts = balanceParts(movs, today, conti, scope);
  const out: Record<string, Balance> = {};
  for (const conto of conti) {
    const ps = parts.filter((p) => p.conto === conto);
    const o: Balance = { saldo: sumCents(ps.map((p) => p.saldo)) };
    const dated = ps.filter((p) => p.since);
    if (dated.length) { o.since = dated.reduce((best, p) => (p.since! > best ? p.since! : best), ""); o.start = sumCents(dated.filter((p) => p.own).map((p) => p.start ?? 0)); }
    out[conto] = o;
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

// ── Conti ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// I conti di base (contanti, banca, PayPal, carta) si possono rinominare; PayPal e carta anche eliminare. Si possono aggiungere altri conti (più banche: Revolut, Intesa…).
// I movimenti salvano la chiave del conto (testo libero nel database); l'elenco dei conti aggiunti vive nel browser e si sincronizza con l'account
// (come tutte le chiavi "spigolestay:").
export interface ContoDef { key: string; label: string; structureIds?: string[] /* strutture a cui appartiene il conto; assente/vuoto = vecchio conto NON assegnato: compare in ogni ambito finché non lo si assegna */ }
export const DEFAULT_CONTI: ContoDef[] = [
  { key: "contanti", label: "Contanti" },
  { key: "banca", label: "Banca" },
  { key: "paypal", label: "PayPal" },
  { key: "carta", label: "Carta / POS" },
];
const CONTI_KEY = "spigolestay:cassa:conti";
const isDefault = (k: string) => DEFAULT_CONTI.some((d) => d.key === k);

// Preferenze dei conti: ORDINE di visualizzazione e CONTO PRINCIPALE (dove arrivano i soldi delle prenotazioni OTA). Chiave sincronizzata con l'account.
const CONTI_PREFS_KEY = "spigolestay:cassa:conti-prefs";
/** `principal` = conto principale di ripiego (vecchia preferenza globale); `principalBy` = conto principale PER STRUTTURA ({ idStruttura: chiaveConto }). */
export interface ContiPrefs { order: string[]; principal: string; principalBy?: Record<string, string> }
export function loadContiPrefs(): ContiPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(CONTI_PREFS_KEY) || "{}") as Partial<ContiPrefs>;
    const by: Record<string, string> = {};
    if (p.principalBy && typeof p.principalBy === "object") for (const [sid, k] of Object.entries(p.principalBy)) if (sid && typeof k === "string" && k) by[sid] = k;
    return { order: Array.isArray(p.order) ? p.order.filter((k) => typeof k === "string") : [], principal: typeof p.principal === "string" && p.principal ? p.principal : "banca", ...(Object.keys(by).length ? { principalBy: by } : {}) };
  } catch { return { order: [], principal: "banca" }; }
}
export function saveContiPrefs(p: ContiPrefs) { try { localStorage.setItem(CONTI_PREFS_KEY, JSON.stringify(p)); } catch { /* storage non disponibile */ } }
/** Sposta un elemento di una posizione (−1 = su, +1 = giù). Fuori dai limiti non cambia nulla. */
export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return list;
  const next = list.slice(); [next[index], next[j]] = [next[j], next[index]];
  return next;
}
/** Mette in ordine i conti secondo l'ordine salvato; quelli non elencati restano in coda nell'ordine originale. */
export function sortConti(list: ContoDef[], order: string[]): ContoDef[] {
  const idx = (k: string) => { const i = order.indexOf(k); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return list.map((c, i) => ({ c, i })).sort((a, b) => idx(a.c.key) - idx(b.c.key) || a.i - b.i).map((x) => x.c);
}

// Salvataggio: per i conti di base solo ciò che cambia (nome nuovo, strutture assegnate o conto eliminato), per quelli aggiunti nome, chiave e strutture.
// I vecchi dati (senza `structureIds`) restano validi: quel conto è "non assegnato" e compare in ogni ambito finché non lo si assegna.
type SavedConto = { key: string; label: string; removed?: boolean; structureIds?: string[] };
const cleanSids = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const ids = [...new Set(v.filter((x): x is string => typeof x === "string" && x !== "" && x !== "all"))];
  return ids.length ? ids : undefined;
};
const withSids = (c: { structureIds?: string[] }): { structureIds?: string[] } => { const s = cleanSids(c.structureIds); return s ? { structureIds: s } : {}; };
export function loadConti(): ContoDef[] {
  try {
    const saved = (JSON.parse(localStorage.getItem(CONTI_KEY) || "[]") as SavedConto[]).filter((c) => c && typeof c.key === "string" && typeof c.label === "string" && c.key && c.label);
    const out: ContoDef[] = [];
    for (const d of DEFAULT_CONTI) {
      const o = saved.find((c) => c.key === d.key);
      if (o?.removed) continue;
      out.push({ key: d.key, label: o ? o.label : d.label, ...(o ? withSids(o) : {}) });
    }
    for (const c of saved) if (!isDefault(c.key) && !c.removed) out.push({ key: c.key, label: c.label, ...withSids(c) });
    return sortConti(out, loadContiPrefs().order);
  } catch { return [...DEFAULT_CONTI]; }
}
export function saveConti(list: ContoDef[]) {
  try {
    const entries: SavedConto[] = [];
    for (const d of DEFAULT_CONTI) {
      const cur = list.find((c) => c.key === d.key);
      if (!cur) entries.push({ key: d.key, label: d.label, removed: true });
      else if (cur.label !== d.label || cleanSids(cur.structureIds)) entries.push({ key: d.key, label: cur.label, ...withSids(cur) });
    }
    for (const c of list) if (!isDefault(c.key)) entries.push({ key: c.key, label: c.label, ...withSids(c) });
    localStorage.setItem(CONTI_KEY, JSON.stringify(entries));
    saveContiPrefs({ ...loadContiPrefs(), order: list.map((c) => c.key) }); // anche l'ordine
  } catch { /* storage non disponibile */ }
}
/** Conti che non si possono eliminare: i movimenti automatici delle prenotazioni vanno su "contanti" (dirette) e sul conto principale (OTA). */
export const CONTI_FISSI = ["contanti", "banca"];
/** Un conto si può eliminare solo se non è fisso e non ha movimenti né pagamenti programmati (il saldo di partenza non conta: si toglie con il conto). */
export function canDeleteConto(key: string, movs: Mov[], rules: { conto: string }[], fixed: string[] = CONTI_FISSI): { ok: boolean; reason?: string } {
  if (fixed.includes(key)) return { ok: false, reason: "Su questo conto arrivano le prenotazioni in automatico: puoi rinominarlo ma non eliminarlo." };
  const n = movs.filter((m) => m.conto === key && m.cat !== OPENING_CAT).length + rules.filter((r) => r.conto === key).length;
  if (n > 0) return { ok: false, reason: `Ha ${n} movimenti o pagamenti programmati: rinominalo, oppure elimina prima quei movimenti.` };
  return { ok: true };
}
/** Chiave stabile per un nuovo conto a partire dal nome ("Revolut" → "conto-revolut"); se esiste già si aggiunge un numero. */
export function contoKeyFromLabel(label: string, existing: ContoDef[], structureId?: string): string {
  const slug = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "conto";
  let base = `conto-${slug}`;
  // Il nome uguale NON significa conto condiviso: se la chiave esiste già (conto di un'altra struttura) e si conosce la struttura del nuovo conto, la chiave prende il suo suffisso.
  if (structureId && existing.some((c) => c.key === base)) base = `${base}@${structureId}`;
  let key = base; let n = 2;
  while (existing.some((c) => c.key === key)) key = `${base}-${n++}`;
  return key;
}

// ── Conti PER STRUTTURA ─────────────────────────────────────────────────────────────────────────────────────────────────
// Ogni conto può appartenere a una o più strutture (`structureIds`). Un conto è disponibile in un ambito se contiene almeno una struttura dell'ambito; con l'ambito
// "tutte" si vedono tutti i conti. I vecchi conti senza `structureIds` (non assegnati) restano visibili ovunque finché non vengono assegnati.
export const isContoAssigned = (c: { structureIds?: string[] }): boolean => !!c.structureIds && c.structureIds.length > 0;
export function contoVisible(c: { structureIds?: string[] }, scope: CashScope): boolean {
  const ids = c.structureIds;
  if (!ids || ids.length === 0) return true;
  if (typeof scope === "string") return scope === "all" || ids.includes(scope);
  return scope.some((s) => ids.includes(s));
}
export const contiForScope = <T extends { structureIds?: string[] }>(conti: T[], scope: CashScope): T[] => conti.filter((c) => contoVisible(c, scope));
/** I conti di UNA struttura ("" o "all" = nessuna restrizione: tutti). */
export const contiOfStructure = <T extends { structureIds?: string[] }>(conti: T[], sid: string): T[] => (sid && sid !== "all" ? contiForScope(conti, sid) : [...conti]);
/** Il movimento punta a un conto che esiste ma NON è assegnato alla sua struttura? (le voci comuni, senza struttura, non hanno mai l'avviso) */
export function contoUnassigned(m: { conto: string; structureId?: string; bookingStructureId?: string }, conti: ContoDef[]): boolean {
  const sid = movSid(m);
  if (!sid) return false;
  const c = conti.find((x) => x.key === m.conto);
  return !!c && !contoVisible(c, sid);
}
/** Chiavi dei conti da mostrare/sommare in un ambito: quelli disponibili + quelli NON assegnati su cui però ci sono movimenti dell'ambito (non spariscono né si perdono dal saldo). */
export function contiKeysInScope(conti: ContoDef[], movs: Mov[], scope: CashScope): string[] {
  const vis = contiForScope(conti, scope).map((c) => c.key);
  const extra = conti.filter((c) => !vis.includes(c.key) && movs.some((m) => m.conto === c.key && scopeVisible(movSid(m) || undefined, scope))).map((c) => c.key);
  return [...vis, ...extra];
}
/** Nome del conto per i menu: se un altro conto ha lo stesso nome (conti diversi di strutture diverse) si aggiungono le strutture per distinguerli. */
export function contoDisplayLabel(c: ContoDef, all: ContoDef[], nameOf: (sid: string) => string): string {
  const norm = (s: string) => s.trim().toLowerCase();
  if (!all.some((x) => x.key !== c.key && norm(x.label) === norm(c.label))) return c.label;
  return isContoAssigned(c) ? `${c.label} (${(c.structureIds ?? []).map(nameOf).join(", ")})` : c.label;
}
/** Sposta in su/giù un conto tra quelli mostrati (`shown`), scambiandolo con il vicino VISIBILE e non con uno nascosto. */
export function moveWithin<T extends { key: string }>(list: T[], key: string, dir: -1 | 1, shown: string[]): T[] {
  const i = shown.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= shown.length) return list;
  const a = list.findIndex((c) => c.key === key), b = list.findIndex((c) => c.key === shown[j]);
  if (a < 0 || b < 0) return list;
  const next = list.slice(); [next[a], next[b]] = [next[b], next[a]];
  return next;
}

// Instradamento dei movimenti automatici: i conti di una struttura. Principale = preferenza della struttura → vecchia preferenza globale → "banca" (se è un suo conto),
// altrimenti il primo conto che non sia contanti/carta. Contanti e carta: i conti di quel tipo DELLA STRUTTURA; se non ne ha, l'incasso va sul suo principale.
export interface ContiRoute { principal: string; validConti: string[]; accounts?: { cash?: string; card?: string } }
export type ContiRouter = (structureId: string) => ContiRoute;
const labelKey = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, " ").trim();
/** Conto "contanti": la chiave storica, quelle per struttura, oppure (solo se assegnato a delle strutture) un conto che si chiama Contanti/Cassa. */
export const isCashConto = (c: ContoDef): boolean => c.key === "contanti" || c.key.startsWith("contanti@") || (isContoAssigned(c) && /^(contanti|cassa)( |$)/.test(labelKey(c.label)));
export const isCardConto = (c: ContoDef): boolean => c.key === "carta" || c.key.startsWith("carta@") || (isContoAssigned(c) && /^(carta|pos)( |$)/.test(labelKey(c.label)));
export function routeFor(conti: ContoDef[], prefs: ContiPrefs, sid: string): ContiRoute {
  const mine = contiOfStructure(conti, sid);
  const pool = mine.length ? mine : conti; // una struttura senza alcun conto non perde i movimenti: ripiego sull'elenco completo
  const keys = pool.map((c) => c.key);
  // una preferenza vale se il conto è della struttura, o se non è un conto conosciuto (dati vecchi: nessun cambio di significato); NON se è conto di altre strutture
  const usable = (k: string | undefined): k is string => !!k && (keys.includes(k) || !conti.some((c) => c.key === k));
  const principal = [prefs.principalBy?.[sid], prefs.principal].find(usable)
    ?? (keys.includes("banca") ? "banca" : undefined)
    ?? (pool.find((c) => !isCashConto(c) && !isCardConto(c)) ?? pool[0])?.key ?? prefs.principal;
  const cash = (pool.find((c) => c.key === "contanti") ?? pool.find(isCashConto))?.key;
  const card = (pool.find((c) => c.key === "carta") ?? pool.find(isCardConto))?.key;
  return { principal, validConti: keys, accounts: { cash, card } };
}
/** Instradamento di default: legge conti e preferenze salvati (usato quando il chiamante non ne passa uno). */
export function defaultContiRouter(): ContiRouter {
  const conti = loadConti(), prefs = loadContiPrefs();
  return (sid) => routeFor(conti, prefs, sid);
}
/** Conto principale in vigore per una struttura (per mostrare la ★). */
export const principalOf = (conti: ContoDef[], prefs: ContiPrefs, sid: string): string => routeFor(conti, prefs, sid).principal;

// Spostamento in blocco: i movimenti (e i pagamenti programmati) di UNA struttura su un conto passano a un altro conto. Non tocca nient'altro.
export function moveContoOfStructure<T extends { id: string; conto: string; structureId?: string }>(list: T[], sid: string, from: string, to: string): { list: T[]; ids: string[] } {
  if (!sid || sid === "all" || !from || !to || from === to) return { list, ids: [] };
  const ids: string[] = [];
  const next = list.map((x) => { if (x.conto === from && normSid(x.structureId) === sid) { ids.push(x.id); return { ...x, conto: to }; } return x; });
  return { list: ids.length ? next : list, ids };
}
export const countOnConto = (list: { conto: string; structureId?: string }[], sid: string, conto: string): number => (sid ? list.filter((x) => x.conto === conto && normSid(x.structureId) === sid).length : 0);

// Scrittura server dello spostamento (a blocchi, per non superare la lunghezza dell'URL).
const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
export async function updateContoOfMovements(ids: string[], conto: string): Promise<WriteResult> {
  if (!ids.length) return null;
  if (!supabase) return NO_CONN;
  for (const part of chunk(ids, 100)) { const { error } = await supabase.from("cash_movements").update({ conto }).in("id", part); if (error) return errMsg(error); }
  return null;
}
export async function updateContoOfRules(ids: string[], conto: string): Promise<WriteResult> {
  if (!ids.length) return null;
  if (!supabase) return NO_CONN;
  for (const part of chunk(ids, 100)) { const { error } = await supabase.from("cash_rules").update({ conto }).in("id", part); if (error) return errMsg(error); }
  return null;
}

// ── Flusso di cassa: oggi e futuro ──────────────────────────────────────────────────────────────────────────────────────
// Movimenti PREVISTI da oggi in poi: il saldo ancora da incassare delle prenotazioni in arrivo (alla data di arrivo) e le occorrenze future dei pagamenti
// programmati. Le commissioni OTA delle prenotazioni future e gli acconti già incassati sono già nei movimenti automatici (computeAuto).
export function computeForecast(bookings: Booking[], guests: Guest[], getStructure: (id: string) => Structure | undefined, rules: Rule[], active: CashScope, today: string, horizon: string, principal: string | ContiRouter = defaultContiRouter(), payouts: PayoutSettingsMap = loadPayoutSettings(), validConti?: string[]): Mov[] {
  const out: Mov[] = [];
  const routeOf = routeResolver(principal, validConti);
  for (const b of bookings.map(cashView)) {
    if (b.status === "cancelled" || b.channel === "blocked") continue;
    if (!scopeVisible(b.structureId, active)) continue;
    const when = payoutDate(b, payouts); // impostazioni della struttura della prenotazione
    if (when < today || when > horizon) continue;
    const remaining = roundCents(Math.max(0, (b.total ?? 0) + (b.cleaningFee ?? 0) + bookingExtrasTotal(b) - (b.paid ?? 0)));
    if (remaining <= 0) continue;
    const g = guests.find((x) => x.id === b.guestId);
    const st = getStructure(b.structureId);
    out.push({ id: `fc-in-${b.id}`, date: when, channel: b.channel, bookingStructureId: b.structureId, kind: "in", cat: "prenotazioni", desc: `${g?.fullName ?? "Ospite"} · ${st?.name ?? ""} · ${CHANNELS[b.channel].label} · da incassare`, amount: remaining, conto: restContoFor(b, routeOf(b.structureId)), auto: true, forecast: true, ref: b.id });
  }
  const from = shiftISO(today, 1);
  if (from <= horizon) {
    for (const r of rules) {
      if (!scopeVisible(r.structureId, active)) continue;
      for (const iso of occurrences(r, from, horizon)) out.push({ id: `fc-r-${r.id}-${iso}`, date: iso, kind: r.kind, cat: r.cat, desc: r.desc, amount: r.amount, conto: r.conto, structureId: r.structureId, sched: true, forecast: true, ref: r.id, ...(r.variable ? { variable: true } : {}) });
    }
  }
  return out;
}

/** Saldo previsto a una data: il saldo attuale dei conti con saldo di partenza + i movimenti dei giorni dopo oggi, fino a quella data.
 *  Segue lo stesso principio dei saldi: contano solo i movimenti delle strutture che su quel conto hanno il loro saldo di partenza (o il vecchio comune che le copre, con "all"). */
export function projectBalance(movs: Mov[], balances: Record<string, Balance>, today: string, until: string, scope: CashScope = "all"): number {
  const withOpening = new Set(Object.keys(balances).filter((k) => balances[k].since));
  const base = sumCents([...withOpening].map((k) => balances[k].saldo));
  const counted = new Set(balanceParts(movs, today, [...withOpening], scope).filter((p) => p.since).map((p) => `${p.sid}|${p.conto}`));
  const hasOpeningMov = (conto: string) => movs.some((m) => m.cat === OPENING_CAT && m.conto === conto);
  const future = movs.filter((m) => withOpening.has(m.conto) && m.cat !== OPENING_CAT && m.date > today && m.date <= until && scopeVisible(movSid(m) || undefined, scope) && (!hasOpeningMov(m.conto) || counted.has(`${movSid(m)}|${m.conto}`)));
  return roundCents(base + sumCents(future.map(signed)));
}

// ── Filtro periodo e ricerca (stessi del filtro delle Prenotazioni) ─────────────────────────────────────────────────────
export type Preset = "future" | "all" | "month" | "prevMonth" | "year" | "prevYear" | "custom";
const p2 = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
/** Date "dal" e "al" di un periodo predefinito ("" = nessun limite). */
export function presetRange(p: Preset, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)) - 1;
  if (p === "future") return { from: today, to: "" };
  if (p === "month") return { from: `${y}-${p2(m0 + 1)}-01`, to: `${y}-${p2(m0 + 1)}-${p2(lastDay(y, m0))}` };
  if (p === "prevMonth") { const d = new Date(y, m0 - 1, 1); const yy = d.getFullYear(), mm = d.getMonth(); return { from: `${yy}-${p2(mm + 1)}-01`, to: `${yy}-${p2(mm + 1)}-${p2(lastDay(yy, mm))}` }; }
  if (p === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (p === "prevYear") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  return { from: "", to: "" };
}

/** Il movimento corrisponde alla ricerca? Cerca nella descrizione, nella categoria, nel conto e nell'importo (anche "854,37"). */
export function matchesQuery(m: Mov, q: string, labels: { cat?: string; conto?: string }): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [m.desc, labels.cat, labels.conto, m.amount.toFixed(2), m.amount.toFixed(2).replace(".", ",")].filter(Boolean).join(" ").toLowerCase();
  return needle.split(/\s+/).every((w) => hay.includes(w));
}

// ── Estratto conto: saldo in quella data ────────────────────────────────────────────────────────────────────────────────
// Per ogni movimento il saldo totale dei conti con un saldo di partenza, DOPO quel movimento. Ogni coppia (struttura, conto) parte dal suo saldo di partenza
// e si muove solo con i movimenti di quella struttura dei giorni successivi (stessa regola del saldo attuale); il saldo mostrato è la somma. Il vecchio saldo
// comune (senza struttura) vale solo con l'ambito "all" e copre le strutture senza saldo proprio su quel conto. Prima del primo saldo di partenza non c'è saldo (null).
export interface Ledger { order: Map<string, number>; balanceAfter: Map<string, number | null>; included: Set<string> /* movimenti del giorno del saldo di partenza: già compresi nell'importo scritto */ }
export function computeLedger(movs: Mov[], scope: CashScope = "all"): Ledger {
  const list = movs.filter((m) => scopeVisible(movSid(m) || undefined, scope));
  const seq = list.map((m, i) => ({ m, i })).sort((a, b) => {
    if (a.m.date !== b.m.date) return a.m.date < b.m.date ? -1 : 1;
    const oa = a.m.cat === OPENING_CAT ? 0 : 1, ob = b.m.cat === OPENING_CAT ? 0 : 1; // nello stesso giorno prima i saldi di partenza
    return oa - ob || a.i - b.i;
  });
  // saldo di partenza in vigore per (struttura, conto): il più recente
  const effective = new Map<string, Mov>();
  for (const { m } of seq) if (m.cat === OPENING_CAT) effective.set(`${movSid(m)}|${m.conto}`, m);
  const keyOf = (m: Mov): string | null => {
    const own = `${movSid(m)}|${m.conto}`;
    if (effective.has(own)) return own;
    const common = `|${m.conto}`;
    return scope === "all" && effective.has(common) ? common : null; // il vecchio saldo comune copre le strutture senza saldo proprio
  };
  const bal = new Map<string, number>();
  const order = new Map<string, number>();
  const balanceAfter = new Map<string, number | null>();
  const included = new Set<string>();
  let started = false;
  seq.forEach(({ m }, idx) => {
    order.set(m.id, idx);
    const k = keyOf(m);
    if (m.cat === OPENING_CAT) { if (k && effective.get(k)?.id === m.id) { bal.set(k, signed(m)); started = true; } }
    else if (k) {
      const op = effective.get(k)!;
      if (m.date > op.date && bal.has(k)) bal.set(k, roundCents((bal.get(k) ?? 0) + signed(m)));
      else if (m.date === op.date) included.add(m.id);
    }
    balanceAfter.set(m.id, started ? sumCents([...bal.values()]) : null);
  });
  return { order, balanceAfter, included };
}

// ── Riga modificata per una singola scadenza ────────────────────────────────────────────────────────────────────────────
// Un pagamento programmato ripetuto può avere dati diversi in un mese (importo, data, descrizione, icona, conto): la modifica vale solo per
// quella scadenza e lascia intatta la regola. Chiave sincronizzata con l'account: { "<regola>|<data originale>": riga modificata }.
const OVERRIDES_KEY = "spigolestay:cassa:overrides";
export interface OccOverride { amount: number; date: string; desc: string; cat: string; conto: string }
export type OccOverrides = Record<string, OccOverride>;
export const occurrenceKey = (m: { ref?: string; date: string; occKey?: string }) => m.occKey ?? `${m.ref ?? ""}|${m.date}`;
export function loadOverrides(): OccOverrides {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}") as Record<string, Partial<OccOverride>>;
    const out: OccOverrides = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v.amount === "number" && v.amount > 0 && typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date) && typeof v.desc === "string" && typeof v.cat === "string" && typeof v.conto === "string") out[k] = { amount: roundCents(v.amount), date: v.date, desc: v.desc, cat: v.cat, conto: v.conto };
    }
    return out;
  } catch { return {}; }
}
export function saveOverrides(o: OccOverrides) { try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(o)); } catch { /* storage non disponibile */ } }
/** Sostituisce i dati delle scadenze programmate modificate a mano. */
export function applyOverrides(list: Mov[], o: OccOverrides): Mov[] {
  if (Object.keys(o).length === 0) return list;
  return list.map((m) => { const k = m.sched && m.ref ? occurrenceKey(m) : ""; const ov = k ? o[k] : undefined; return ov ? { ...m, ...ov, edited: true, occKey: k } : m; });
}
