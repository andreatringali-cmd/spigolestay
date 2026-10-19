// Vista "Addetta" delle Pulizie — logica pura (nessun I/O, testabile): agenda arrivi/partenze/fermi, checklist con frequenza
// settimanale, segnalazioni, ore lavorate e acquisti. Tutto vive in liste piatte "spigolestay:pulizie:*" con id + updatedAt,
// sincronizzate sul server come scorte e segnalazioni esistenti (fusione per id, cancellazioni = soft-delete `_deleted`).
import { computePuliziePlan, type PlanRoom } from "./puliziePlan";
import { addDays, parseISO, toISO } from "./dates";
import type { Booking, RoomType, Structure, Unit } from "./types";

// ---- chiavi di archivio -----------------------------------------------------------------------------------------------
export const KEY_TASKS = "spigolestay:pulizie:tasks";   // voci della checklist (le scrive il titolare)
export const KEY_CHECKS = "spigolestay:pulizie:checks"; // spunte (le scrive l'addetta)
export const KEY_HOURS = "spigolestay:pulizie:hours";   // ore lavorate
export const KEY_ISSUES = "spigolestay:pulizie:issues"; // segnalazioni (già esistente: la stessa lista della pagina Pulizie)
export const KEY_ORDERS = "spigolestay:pulizie:orders"; // acquisti (già esistente: gli ordini di "Scorte & spesa")
export const KEY_STOCK = "spigolestay:pulizie:stock";   // scorte (già esistente)
export const KEY_DONE = "spigolestay:pulizie:done";     // camere pulite `${unitId}:${data}` → ISO (già esistente)

export interface Entity { id: string; updatedAt?: number; _deleted?: boolean }

// ---- date -------------------------------------------------------------------------------------------------------------
/** Giorno della settimana ISO: 1 = lunedì … 7 = domenica. */
export const isoWeekday = (iso: string): number => ((parseISO(iso).getDay() + 6) % 7) + 1;
/** Lunedì della settimana che contiene `iso`. */
export const weekStart = (iso: string): string => toISO(addDays(parseISO(iso), -(isoWeekday(iso) - 1)));
export const weekDates = (iso: string): string[] => { const s = parseISO(weekStart(iso)); return Array.from({ length: 7 }, (_, i) => toISO(addDays(s, i))); };
export const WEEKDAY_SHORT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]; // indice = giorno ISO − 1
export const WEEKDAY_LONG = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
/** "2026-10" del mese di una data. */
export const monthOf = (iso: string): string => iso.slice(0, 7);
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const MONTH_NAMES = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const monthName = (ym: string): string => { const [y, m] = ym.split("-").map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; };

// ---- checklist: voci e frequenza ---------------------------------------------------------------------------------------
export type Freq = { kind: "weekly"; times: number } | { kind: "days"; days: number[] }; // days: 1 = lun … 7 = dom
export type TaskScope = "room" | "common";

export interface CleanTask extends Entity {
  name: string;
  scope: TaskScope;        // room = da fare in ogni camera; common = zona comune della struttura (scale, cucina, pianerottolo…)
  structureId?: string;    // assente = tutte le strutture
  unitIds?: string[];      // solo per scope "room": vuoto/assente = tutte le camere della struttura
  freq: Freq;
  order?: number;
}

export interface CleanTarget { id: string; label: string; structureId: string }
export interface CleanCheck extends Entity { taskId: string; targetId: string; date: string; at: string; structureId?: string }

export const ZONE_PREFIX = "zona:";
export const zoneId = (structureId: string) => `${ZONE_PREFIX}${structureId}`;
export const isZoneId = (id: string | undefined) => !!id && id.startsWith(ZONE_PREFIX);

/** Frequenza sempre valida: N volte (1-7, intero) oppure almeno un giorno fisso (1-7, senza doppioni, in ordine). */
export function normalizeFreq(f: Freq | undefined): Freq {
  if (f && f.kind === "days") {
    const days = [...new Set((f.days ?? []).map(Math.round).filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b);
    return days.length ? { kind: "days", days } : { kind: "weekly", times: 1 };
  }
  const n = Math.round(Number((f as { times?: number } | undefined)?.times ?? 1));
  return { kind: "weekly", times: Math.min(7, Math.max(1, Number.isFinite(n) ? n : 1)) };
}
export function freqLabel(f: Freq): string {
  const n = normalizeFreq(f);
  if (n.kind === "weekly") return n.times === 1 ? "1 volta a settimana" : `${n.times} volte a settimana`;
  return n.days.map((d) => WEEKDAY_SHORT[d - 1]).join(" · ");
}
export const requiredPerWeek = (f: Freq): number => { const n = normalizeFreq(f); return n.kind === "weekly" ? n.times : n.days.length; };

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "it", { numeric: true, sensitivity: "base" });

/** Dove si esegue la voce: una zona per struttura (voce comune) oppure una riga per camera (voce di camera). */
export function targetsFor(task: CleanTask, structures: Structure[], units: Unit[]): CleanTarget[] {
  const sts = structures.filter((s) => !task.structureId || s.id === task.structureId);
  if (task.scope === "common") return sts.map((s) => ({ id: zoneId(s.id), label: s.name, structureId: s.id }));
  const only = task.unitIds && task.unitIds.length ? new Set(task.unitIds) : null;
  return sts.flatMap((s) => units.filter((u) => u.structureId === s.id && (!only || only.has(u.id))).sort(byName).map((u) => ({ id: u.id, label: u.name, structureId: s.id })));
}

export const liveTasks = (tasks: CleanTask[]): CleanTask[] => tasks.filter((t) => !t._deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byName(a, b));
export const liveChecks = (checks: CleanCheck[]): CleanCheck[] => checks.filter((c) => !c._deleted);

export type TaskStateKind = "done" | "urgent" | "todo" | "later";
export interface TaskState {
  required: number;
  done: number;              // spunte in questa settimana
  state: TaskStateKind;      // done = fatto il necessario · urgent = da fare oggi (o in ritardo) · todo = da fare entro la settimana · later = non ancora dovuto (giorni fissi)
  overdue: boolean;          // giorno fisso già passato senza spunta
  today?: CleanCheck;        // spunta di oggi, se c'è
  last?: CleanCheck;         // ultima spunta della settimana
  nextDay?: number;          // prossimo giorno fisso (1-7), se state = later
}

/** Stato di una voce su un luogo nella settimana di `todayISO`. */
export function taskState(task: Pick<CleanTask, "id" | "freq">, targetId: string, checks: CleanCheck[], todayISO: string): TaskState {
  const freq = normalizeFreq(task.freq);
  const ws = weekStart(todayISO);
  const we = toISO(addDays(parseISO(ws), 6));
  const mine = liveChecks(checks).filter((c) => c.taskId === task.id && c.targetId === targetId && c.date >= ws && c.date <= we).sort((a, b) => a.at.localeCompare(b.at));
  const done = mine.length;
  const today = [...mine].reverse().find((c) => c.date === todayISO);
  const last = mine[mine.length - 1];
  const wd = isoWeekday(todayISO);
  if (freq.kind === "weekly") {
    const remaining = freq.times - done;
    const daysLeft = 8 - wd; // oggi compreso
    const state: TaskStateKind = remaining <= 0 ? "done" : remaining >= daysLeft ? "urgent" : "todo";
    return { required: freq.times, done, state, overdue: false, today, last };
  }
  const required = freq.days.length;
  const expected = freq.days.filter((d) => d <= wd).length;     // giorni fissi fino a oggi (compreso)
  const strictlyPast = freq.days.filter((d) => d < wd).length;   // giorni fissi già passati
  const state: TaskStateKind = done >= required ? "done" : done < expected ? "urgent" : "later";
  return { required, done, state, overdue: done < strictlyPast, today, last, nextDay: state === "later" ? freq.days.find((d) => d > wd) : undefined };
}

/** Spunta (o toglie la spunta di oggi): se esiste già una spunta attiva per voce+luogo+data la cancella (soft-delete), altrimenti ne aggiunge una. */
export function toggleCheck(checks: CleanCheck[], p: { taskId: string; targetId: string; structureId?: string; todayISO: string; nowISO: string; nowMs: number; newId: string }): CleanCheck[] {
  const existing = checks.filter((c) => !c._deleted && c.taskId === p.taskId && c.targetId === p.targetId && c.date === p.todayISO);
  if (existing.length) {
    const ids = new Set(existing.map((c) => c.id));
    return checks.map((c) => (ids.has(c.id) ? { ...c, _deleted: true, updatedAt: p.nowMs } : c));
  }
  return [...checks, { id: p.newId, taskId: p.taskId, targetId: p.targetId, structureId: p.structureId, date: p.todayISO, at: p.nowISO, updatedAt: p.nowMs }];
}

export interface WeekSummary { required: number; done: number; targets: number; completed: number }
/** Avanzamento complessivo della settimana: ogni voce×luogo conta al massimo il richiesto. */
export function weekSummary(tasks: CleanTask[], structures: Structure[], units: Unit[], checks: CleanCheck[], todayISO: string): WeekSummary {
  let required = 0, done = 0, targets = 0, completed = 0;
  for (const t of liveTasks(tasks)) for (const tg of targetsFor(t, structures, units)) {
    const s = taskState(t, tg.id, checks, todayISO);
    targets++; required += s.required; done += Math.min(s.done, s.required);
    if (s.state === "done") completed++;
  }
  return { required, done, targets, completed };
}

/**
 * Le tre voci d'esempio indicate dal titolare, scritte nel codice: ogni struttura senza voci parte con queste (zone comuni, solo per quella struttura).
 * Gli id sono FISSI per struttura (`ex:<struttura>:<n>`): lo stesso esempio non si crea due volte (nemmeno da due dispositivi) e, se lo elimini, non ricompare.
 * updatedAt = 1: qualunque modifica o eliminazione vera, anche arrivata da un altro dispositivo, prevale sull'esempio.
 */
export const EXAMPLE_TASK_PREFIX = "ex:";
export function exampleTasksFor(structureId: string): CleanTask[] {
  const mk = (n: number, name: string, freq: Freq): CleanTask => ({ id: `${EXAMPLE_TASK_PREFIX}${structureId}:${n}`, name, scope: "common", structureId, freq, order: n, updatedAt: 1 });
  return [
    mk(1, "Pulizia sopra i pensili della cucina", { kind: "weekly", times: 1 }),
    mk(2, "Pulizia pianerottolo e scale fino al piano terra", { kind: "weekly", times: 2 }),
    mk(3, "Pulizia persiane e vetri delle finestre", { kind: "weekly", times: 2 }),
  ];
}

// ---- agenda: arrivi, partenze e fermi per i giorni a venire ---------------------------------------------------------------
export interface AgendaDay { date: string; rooms: PlanRoom[]; arrivi: number; partenze: number; fermi: number }

export function buildAgenda(o: { from: string; days: number; structures: Structure[]; units: Unit[]; roomTypes: RoomType[]; bookings: Booking[] }): AgendaDay[] {
  const out: AgendaDay[] = [];
  for (let i = 0; i < o.days; i++) {
    const date = toISO(addDays(parseISO(o.from), i));
    const { rooms } = computePuliziePlan({ date, structures: o.structures, units: o.units, roomTypes: o.roomTypes, bookings: o.bookings });
    const busy = rooms.filter((r) => r.action !== "niente");
    out.push({
      date,
      rooms: busy,
      arrivi: busy.filter((r) => !!r.arr).length,
      partenze: busy.filter((r) => !!r.dep).length,
      fermi: busy.filter((r) => r.action === "riassetto").length,
    });
  }
  return out;
}

// ---- segnalazioni (stessa forma della lista della pagina Pulizie) ----------------------------------------------------------
export interface PulizieIssue extends Entity {
  unitId: string; unitName: string; structureName: string; structureId?: string;
  date: string; type: string; note: string; photo?: string; createdAt: string;
  resolved?: boolean; resolvedAt?: string;
}
export interface IssueTarget { unitId: string; unitName: string; structureId: string; structureName: string }

/** Luoghi segnalabili: ogni camera e la zona comune di ogni struttura. */
export function issueTargets(structures: Structure[], units: Unit[]): IssueTarget[] {
  return structures.flatMap((s) => [
    { unitId: zoneId(s.id), unitName: "Zone comuni", structureId: s.id, structureName: s.name },
    ...units.filter((u) => u.structureId === s.id).sort(byName).map((u) => ({ unitId: u.id, unitName: u.name, structureId: s.id, structureName: s.name })),
  ]);
}
export function createIssue(list: PulizieIssue[], p: { id: string; target: IssueTarget; type: string; note: string; dateISO: string; nowISO: string; nowMs: number }): PulizieIssue[] {
  const note = p.note.trim();
  if (!note) return list;
  return [{ id: p.id, unitId: p.target.unitId, unitName: p.target.unitName, structureName: p.target.structureName, structureId: p.target.structureId, date: p.dateISO, type: p.type, note, createdAt: p.nowISO, resolved: false, updatedAt: p.nowMs }, ...list];
}
export const setIssueResolved = (list: PulizieIssue[], id: string, resolved: boolean, nowISO: string, nowMs: number): PulizieIssue[] =>
  list.map((i) => (i.id === id ? { ...i, resolved, resolvedAt: resolved ? nowISO : undefined, updatedAt: nowMs } : i));
export const removeEntity = <T extends Entity>(list: T[], id: string, nowMs: number): T[] => list.map((i) => (i.id === id ? { ...i, _deleted: true, updatedAt: nowMs } : i));

// ---- ore lavorate ------------------------------------------------------------------------------------------------------------
export interface CleanHours extends Entity { date: string; hours: number; structureId?: string; note?: string }

/** Ore digitate come "4,5" o "4.5" → numero (0,25 … 24); non valido = null. */
export function parseHours(raw: string | number): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return Math.round(n * 100) / 100;
}
export const fmtHours = (h: number): string => `${(Math.round(h * 100) / 100).toString().replace(".", ",")} h`;

export interface DayRow { date: string; hours: number; rooms: number; checks: number }
export interface TaskHoursRow { id: string; name: string; checks: number; estHours: number }
export interface MonthSummary {
  totalHours: number; daysWorked: number; roomsCleaned: number; taskChecks: number;
  days: DayRow[];
  perTask: TaskHoursRow[];       // include la riga "Pulizia camere" (id "__camere__")
  unallocatedHours: number;      // ore di giorni senza nessuna attività spuntata
}
export const ROOMS_ROW_ID = "__camere__";

/**
 * Riepilogo del mese `ym` (es. "2026-10"). `roomDates` = una data per ogni camera segnata come pulita.
 * Le ore di ogni giorno sono ripartite in parti uguali tra le attività spuntate quel giorno (camere e voci della checklist):
 * è una STIMA, non un cronometro; i giorni con ore ma senza attività finiscono in `unallocatedHours`.
 */
export function monthSummary(o: { ym: string; hours: CleanHours[]; checks: CleanCheck[]; roomDates: string[]; tasks: CleanTask[] }): MonthSummary {
  const inM = (d: string) => d.slice(0, 7) === o.ym;
  const hrs = o.hours.filter((h) => !h._deleted && inM(h.date));
  const chk = liveChecks(o.checks).filter((c) => inM(c.date));
  const rooms = o.roomDates.filter(inM);
  const dates = [...new Set([...hrs.map((h) => h.date), ...chk.map((c) => c.date), ...rooms])].sort();
  const names = new Map(o.tasks.map((t) => [t.id, t.name]));
  const per = new Map<string, TaskHoursRow>();
  const bump = (id: string, name: string, checks: number, est: number) => { const r = per.get(id) ?? { id, name, checks: 0, estHours: 0 }; r.checks += checks; r.estHours += est; per.set(id, r); };
  let unallocated = 0;
  const days: DayRow[] = dates.map((date) => {
    const h = hrs.filter((x) => x.date === date).reduce((s, x) => s + x.hours, 0);
    const dc = chk.filter((c) => c.date === date);
    const dr = rooms.filter((d) => d === date).length;
    const acts = dc.length + dr;
    const share = acts > 0 ? h / acts : 0;
    if (h > 0 && acts === 0) unallocated += h;
    if (dr) bump(ROOMS_ROW_ID, "Pulizia camere", dr, share * dr);
    for (const c of dc) bump(c.taskId, names.get(c.taskId) ?? "Voce eliminata", 1, share);
    return { date, hours: round2(h), rooms: dr, checks: dc.length };
  });
  const perTask = [...per.values()].map((r) => ({ ...r, estHours: round2(r.estHours) })).sort((a, b) => b.estHours - a.estHours || b.checks - a.checks);
  return {
    totalHours: round2(hrs.reduce((s, h) => s + h.hours, 0)),
    daysWorked: new Set(hrs.map((h) => h.date)).size,
    roomsCleaned: rooms.length,
    taskChecks: chk.length,
    days, perTask, unallocatedHours: round2(unallocated),
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- acquisti (riuso degli "ordini" di Scorte & spesa) ------------------------------------------------------------------------
export interface PulizieOrder extends Entity {
  productId: string;        // "" se la voce non è un prodotto in scorta
  productName: string;
  structureId: string;
  date: string;             // ISO locale (data + ora)
  qty: number;
  cost?: number;            // importo TOTALE della voce, in euro
  note?: string;
  source?: "addetta";
  payConto?: string;        // conto della Cassa da cui è stato pagato (contanti / carta / banca)
  receipt?: ReceiptRef;     // scontrino allegato (file su Storage privato: qui solo il riferimento, mai il contenuto)
  cash?: CashLink;          // collegamento alla Prima nota: pending = movimento da creare · done = creato · failed = rifiutato dal server · removed = tolto perché l'acquisto è stato eliminato
}
/** Riferimento a un file su Supabase Storage (bucket privato "receipts"): path = <tenantId>/<uuid>.<ext>. */
export interface ReceiptRef { path: string; name: string; type: string }
export type CashLink = "pending" | "done" | "failed" | "removed";
export interface StockLite extends Entity { name: string; structureId: string; qty: number }

/** Prodotto in scorta con lo stesso nome (senza maiuscole/spazi doppi) nella struttura: serve ad aggiornare la giacenza all'acquisto. */
export function matchStock(stock: StockLite[], name: string, structureId: string): StockLite | undefined {
  const n = name.trim().replace(/\s+/g, " ").toLowerCase();
  if (!n) return undefined;
  return stock.find((p) => !p._deleted && p.structureId === structureId && p.name.trim().replace(/\s+/g, " ").toLowerCase() === n);
}
/** Importo "12,50" / "12.5" → numero ≥ 0; vuoto o non valido = undefined. */
export function parseMoney(raw: string): number | undefined {
  const s = raw.trim().replace(",", ".");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

export interface PurchaseRow { name: string; qty: number; cost: number; count: number }
export interface PurchaseSummary { total: number; count: number; withoutCost: number; rows: PurchaseRow[] }
/** Riepilogo acquisti tra due date ISO (estremi inclusi), raggruppati per voce. */
export function summarizePurchases(orders: PulizieOrder[], from: string, to: string): PurchaseSummary {
  const list = orders.filter((o) => !o._deleted && o.date.slice(0, 10) >= from && o.date.slice(0, 10) <= to);
  const m = new Map<string, PurchaseRow>();
  for (const o of list) {
    const key = o.productName.trim().replace(/\s+/g, " ").toLowerCase();
    const r = m.get(key) ?? { name: o.productName.trim(), qty: 0, cost: 0, count: 0 };
    r.qty += o.qty || 0; r.cost += o.cost ?? 0; r.count++;
    m.set(key, r);
  }
  const rows = [...m.values()].map((r) => ({ ...r, cost: round2(r.cost) })).sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, "it"));
  return { total: round2(list.reduce((s, o) => s + (o.cost ?? 0), 0)), count: list.length, withoutCost: list.filter((o) => o.cost == null).length, rows };
}
export const monthBounds = (ym: string): { from: string; to: string } => ({ from: `${ym}-01`, to: `${ym}-31` });

// ---- accesso: profilo "solo Pulizie" -------------------------------------------------------------------------------------------
/** Vero se l'utente ha accesso a Pulizie e a NESSUN'altra sezione: va portato dritto sulla pagina Pulizie. */
export function isPulizieOnly(perms: Record<string, string> | undefined): boolean {
  if (!perms) return false;
  const lvl = (k: string) => perms[k] ?? "none";
  if (lvl("pulizie") === "none") return false;
  return Object.entries(perms).every(([k, v]) => k === "pulizie" || v === "none");
}
