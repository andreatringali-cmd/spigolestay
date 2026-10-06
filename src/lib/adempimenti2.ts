// Adempimenti 2: la logica PURA della pagina (nessuna rete, nessun React, nessun import a runtime).
// Prende i dati già caricati (prenotazioni, schedine Questura, movimenti ISTAT, documenti, fatture fornitori) e li trasforma in
// "cose da fare" (Task) raggruppate per ente e per urgenza, più i riepiloghi (anello di avanzamento, calendario, cronologia).
// Le regole sono le STESSE della pagina "Adempimenti oggi" (check-in per persona, schedina pronta solo se il check-in è completo,
// scadenza Questura = arrivo + 24 ore, ecc.): qui sono solo ripulite e collaudabili (tests/adempimenti2.test.ts).

// ───────────────────────── Date e testi ─────────────────────────
const DAY = 86400000;
export const dayNum = (iso: string): number => { const [y, m, d] = iso.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
export const isoOfDayNum = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);
export const addDaysISO = (iso: string, n: number): string => isoOfDayNum(dayNum(iso) + n);
/** Giorni da `b` ad `a` (positivo se `a` è dopo `b`). */
export const diffDays = (a: string, b: string): number => dayNum(a) - dayNum(b);
const pad2 = (n: number) => String(n).padStart(2, "0");
const localISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
export const nWord = (n: number, one: string, many: string): string => `${n} ${plural(n, one, many)}`;
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
export const shortDate = (iso: string): string => `${Number(iso.slice(8, 10))} ${MESI[Number(iso.slice(5, 7)) - 1]}`;
export const dowShort = (iso: string): string => GIORNI[new Date(dayNum(iso) * DAY).getUTCDay()];

/** "oggi" · "domani" · "ieri" · "tra 3 giorni" · "3 giorni fa". */
export function relDay(iso: string, today: string): string {
  const n = diffDays(iso, today);
  if (n === 0) return "oggi";
  if (n === 1) return "domani";
  if (n === -1) return "ieri";
  return n > 0 ? `tra ${n} giorni` : `${-n} giorni fa`;
}

/** Durata leggibile: "12 minuti", "5 ore", "1 giorno e 3 ore", "3 giorni". */
export function spanLabel(ms: number): string {
  const a = Math.abs(ms);
  const d = Math.floor(a / DAY), h = Math.floor((a % DAY) / 3600000), m = Math.floor((a % 3600000) / 60000);
  if (d >= 2) return nWord(d, "giorno", "giorni");
  if (d === 1) return h >= 1 ? `1 giorno e ${nWord(h, "ora", "ore")}` : "1 giorno";
  if (h >= 1) return nWord(h, "ora", "ore");
  return nWord(Math.max(1, m), "minuto", "minuti");
}

/**
 * Scadenza della schedina Questura: entro 24 ore dall'arrivo. Come nella pagina Alloggiati si assume l'arrivo alle 14:00
 * (non conosciamo l'orario vero), quindi la scadenza è il giorno dopo alle 14:00 (ora locale).
 */
export function questuraDeadline(arrivalISO: string, nowMs: number): { over: boolean; ms: number; deadlineISO: string; label: string } {
  const dl = new Date(`${arrivalISO}T14:00:00`);
  dl.setDate(dl.getDate() + 1);
  const ms = dl.getTime() - nowMs;
  return { over: ms < 0, ms, deadlineISO: localISO(dl), label: ms < 0 ? `In ritardo di ${spanLabel(ms)}` : `Scade tra ${spanLabel(ms)}` };
}

// ───────────────────────── Tipi ─────────────────────────
export type Ente = "questura" | "istat" | "tassa" | "checkin" | "pagamenti" | "fatture";
/** Ordine di lettura: prima gli enti con una scadenza di legge. */
export const ENTI: readonly Ente[] = ["questura", "istat", "tassa", "checkin", "pagamenti", "fatture"];
export const ENTE_META: Record<Ente, { label: string; short: string; sub: string; icon: string; allDone: string }> = {
  questura: { label: "Questura · Alloggiati Web", short: "Questura", sub: "Schedine entro 24 ore dall'arrivo", icon: "shield", allDone: "Tutte le schedine sono state inviate" },
  istat: { label: "ISTAT · Turist@t", short: "ISTAT", sub: "Movimenti turistici dagli arrivi", icon: "chart", allDone: "Nessun movimento da comunicare" },
  tassa: { label: "Tassa di soggiorno", short: "Tassa", sub: "Da incassare dopo la partenza", icon: "coins", allDone: "Nessuna tassa da incassare" },
  checkin: { label: "Check-in online e documenti", short: "Check-in", sub: "Dati e documenti di tutti gli ospiti", icon: "id", allDone: "Check-in completi" },
  pagamenti: { label: "Pagamenti e saldi", short: "Pagamenti", sub: "Saldi dei soggiorni e fatture da incassare", icon: "card", allDone: "Nessun saldo da incassare" },
  fatture: { label: "Fatture", short: "Fatture", sub: "Scarti SdI e fornitori in scadenza", icon: "invoice", allDone: "Nessuna fattura da gestire" },
};
const ENTE_RANK: Record<Ente, number> = { questura: 0, checkin: 1, tassa: 2, pagamenti: 3, istat: 4, fatture: 5 }; // priorità a parità di urgenza

export type Urgency = "late" | "today" | "soon";
export const URGENCY_LABEL: Record<Urgency, string> = { late: "In ritardo", today: "Da fare oggi", soon: "Nei prossimi giorni" };
const URG_RANK: Record<Urgency, number> = { late: 0, today: 1, soon: 2 };
export type StepKey = "checkin" | "alloggiati" | "istat" | "tax" | "pay";
export type TaskKind = "checkin" | "checkin_fix" | "questura_send" | "questura_fix" | "questura_prepare" | "istat_send" | "tax" | "pay" | "doc_unpaid" | "doc_rejected" | "supplier";

export interface TaskAction {
  /** resolve = finestra "Risolvi" della prenotazione · fix = apre la prenotazione per correggere · compila = link di check-in · link = altra pagina · sync = prepara i dati (non invia nulla) */
  kind: "resolve" | "fix" | "compila" | "link" | "sync";
  label: string;
  step?: StepKey;
  href?: string;
  sync?: "alloggiati" | "istat";
}
export interface Task {
  id: string;
  ente: Ente;
  kind: TaskKind;
  urgency: Urgency;
  title: string;
  meta: string[];
  status: string;
  /** Scadenza a parole: "Scade tra 5 ore", "In ritardo di 2 giorni", "Arrivo domani". */
  dueLabel: string;
  /** Giorno (ISO) a cui appartiene la scadenza: serve al calendario. Null se non ha una data propria. */
  dueISO: string | null;
  bookingIds: string[];
  repId?: string;
  structureId?: string | null;
  amount?: number;
  count?: number;
  action: TaskAction;
  secondary?: TaskAction;
}

export interface PGuest { firstName?: string; lastName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; country?: string; docType?: string; docNumber?: string }
export interface ABooking {
  id: string; structureId: string; code?: string; groupId?: string; guestId: string;
  checkIn: string; checkOut: string; status: string; channel: string; adults: number; children: number;
  webCheckin?: boolean; primaryGuest?: PGuest; extraGuests?: PGuest[]; cityTaxPaid?: boolean;
}
export interface SchedRow { id: string; arrival: string; stato: string; booking_id: string | null; structure_id: string | null }
export interface DocRow { id: string; structure_id: string | null; number_label: string | null; stato: string; doc_kind: string; name: string; due_date: string | null; residuo_cents: number }
export interface PassiveRow { id: string; structure_id: string | null; supplier_name: string | null; due_date: string | null; total_cents: number; paid: boolean }

// ───────────────────────── Check-in per persona (stessa regola di Adempimenti oggi) ─────────────────────────
export const isLive = (b: { status: string; channel: string }): boolean => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked";
export const expectedPax = (b: ABooking): number => Math.max(1, (b.adults ?? 1) + (b.children ?? 0));
const primaryDone = (b: ABooking): boolean => b.webCheckin === true || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber);
/** Ospiti con dati veri: un segnaposto vuoto non conta. */
export const declaredPax = (b: ABooking): number => (primaryDone(b) ? 1 : 0) + (b.extraGuests?.filter((e) => !!(e.lastName || e.firstName)).length ?? 0);
export const isComplete = (b: ABooking): boolean => declaredPax(b) > 0 && declaredPax(b) >= expectedPax(b);

const guestFieldsOk = (g?: PGuest): boolean => !!(g?.lastName && g?.firstName && g?.sex && g?.birthDate && g?.birthPlace && (g?.citizenship || g?.country));
/** Dati validi per la schedina, calcolati sui dati VERI della prenotazione (non sulla copia nella schedina). */
export function bookingDataValid(b: ABooking, primary?: PGuest): boolean {
  const p = primary ?? b.primaryGuest;
  if (!guestFieldsOk(p) || !(p?.docType && p?.docNumber)) return false;
  for (const e of b.extraGuests ?? []) if (!guestFieldsOk(e)) return false;
  return true;
}

const bkNo = (b: ABooking): string => b.code || b.id.slice(0, 6).toUpperCase();
export interface ArrivalGroup<B extends ABooking> { key: string; rep: B; members: B[]; rooms: number; expected: number; declared: number; cat: "todo" | "fix" | "done" }
/** Prenotazioni con lo stesso groupId = UNA voce (un solo link completa tutte le camere). Lo stato è aggregato su tutto il gruppo. */
export function buildArrivalGroups<B extends ABooking>(list: B[], primaryOf: (b: B) => PGuest | undefined): ArrivalGroup<B>[] {
  const solo: B[] = [];
  const byGroup = new Map<string, B[]>();
  for (const b of list) {
    if (b.groupId) { const arr = byGroup.get(b.groupId) ?? []; arr.push(b); byGroup.set(b.groupId, arr); } else solo.push(b);
  }
  const mk = (members: B[], key: string): ArrivalGroup<B> => {
    const rep = [...members].sort((a, c) => { const ka = bkNo(a), kc = bkNo(c); if (ka !== kc) return ka < kc ? -1 : 1; return (a.checkIn || "") < (c.checkIn || "") ? -1 : 1; })[0];
    const valid = (m: B) => bookingDataValid(m, primaryOf(m));
    const allDone = members.every((m) => isComplete(m) && valid(m));
    const someFix = members.some((m) => isComplete(m) && !valid(m));
    return { key, rep, members, rooms: members.length, expected: members.reduce((s, m) => s + expectedPax(m), 0), declared: members.reduce((s, m) => s + declaredPax(m), 0), cat: allDone ? "done" : someFix ? "fix" : "todo" };
  };
  const out: ArrivalGroup<B>[] = [];
  for (const b of solo) out.push(mk([b], b.id));
  for (const [gid, members] of byGroup) out.push(mk(members, gid));
  return out.sort((a, b) => (a.rep.checkIn || "").localeCompare(b.rep.checkIn || "") || bkNo(a.rep).localeCompare(bkNo(b.rep)));
}

// ───────────────────────── Costruzione delle cose da fare ─────────────────────────
export interface TasksInput<B extends ABooking> {
  today: string;                         // "YYYY-MM-DD" LOCALE
  nowMs: number;
  bookings: B[];                         // prenotazioni dello scope (la funzione scarta da sola annullate, no-show e blocchi)
  primaryOf: (b: B) => PGuest | undefined; // ospite principale (anagrafica, altrimenti i dati salvati sulla prenotazione)
  nameOf: (b: B) => string;
  sched: SchedRow[];
  istat: SchedRow[];
  taxOf: (b: B) => number;               // tassa di soggiorno dovuta (0 se non applicabile o esente)
  balanceOf: (b: B) => number;           // saldo del soggiorno ancora da incassare
  totalOf: (b: B) => number;             // importo del soggiorno (0 = nessun importo noto)
  docs: DocRow[];
  passive: PassiveRow[];
  checkinHorizon?: number;               // quanti giorni prima dell'arrivo il check-in entra tra le cose da fare
  upcomingDays?: number;                 // finestra "nei prossimi giorni" per scadenze di fatture
}
export interface TasksOut { tasks: Task[]; done: Record<Ente, number> }

const CHECKIN_HORIZON = 3;
const BACK_DAYS = 14;        // tassa e saldi: partenze degli ultimi 14 giorni (oltre, resta lo scadenzario)
const PREPARE_BACK_DAYS = 7; // schedine da preparare: arrivi dell'ultima settimana (come Adempimenti oggi)

export function compareTasks(a: Task, b: Task): number {
  return URG_RANK[a.urgency] - URG_RANK[b.urgency] || ENTE_RANK[a.ente] - ENTE_RANK[b.ente] || (a.dueISO ?? "9999").localeCompare(b.dueISO ?? "9999") || a.title.localeCompare(b.title, "it");
}

const urgencyByDate = (iso: string, today: string, soonUntil: string | null = null): Urgency | null => (iso < today ? "late" : iso === today ? "today" : soonUntil && iso <= soonUntil ? "soon" : null);

export function buildTasks<B extends ABooking>(inp: TasksInput<B>): TasksOut {
  const { today, nowMs } = inp;
  const horizon = inp.checkinHorizon ?? CHECKIN_HORIZON;
  const upDays = inp.upcomingDays ?? 7;
  const yesterday = addDaysISO(today, -1);
  const inRecent = (iso: string) => iso >= yesterday && iso <= today; // per i "fatti": solo ciò che riguarda ieri e oggi
  const tasks: Task[] = [];
  const done: Record<Ente, number> = { questura: 0, istat: 0, tassa: 0, checkin: 0, pagamenti: 0, fatture: 0 };

  const live = inp.bookings.filter(isLive);
  const byId = new Map(live.map((b) => [b.id, b]));
  const isActiveId = (id: string | null) => !id || byId.has(id);
  const valid = (b: B) => bookingDataValid(b, inp.primaryOf(b));
  const completeIds = new Set(live.filter(isComplete).map((b) => b.id));
  const paxLabel = (n: number) => nWord(n, "ospite", "ospiti");
  const stay = (b: ABooking) => `${shortDate(b.checkIn)} → ${shortDate(b.checkOut)}`;

  // ── Check-in online ──
  const win = live.filter((b) => b.checkOut >= today && b.checkIn <= addDaysISO(today, horizon));
  const groups = buildArrivalGroups(win, inp.primaryOf);
  const fixBookingIds = new Set<string>();
  for (const gr of groups) {
    const ci = gr.rep.checkIn;
    if (gr.cat === "done") { if (inRecent(ci)) done.checkin++; continue; }
    for (const m of gr.members) if (isComplete(m) && !valid(m)) fixBookingIds.add(m.id);
    const urgency: Urgency = ci < today ? "late" : ci === today ? "today" : "soon";
    const late = diffDays(today, ci);
    const dueLabel = urgency === "late" ? `In ritardo di ${nWord(late, "giorno", "giorni")}` : urgency === "today" ? "Arriva oggi" : `Arrivo ${relDay(ci, today)}`;
    const partial = gr.declared > 0 && gr.declared < gr.expected;
    const meta = [bkNo(gr.rep), ...(gr.rooms > 1 ? [`Gruppo · ${gr.rooms} camere`] : []), paxLabel(gr.expected), stay(gr.rep)];
    const base = { ente: "checkin" as const, urgency, title: inp.nameOf(gr.rep), meta, dueLabel, dueISO: ci, bookingIds: gr.members.map((m) => m.id), repId: gr.rep.id, structureId: gr.rep.structureId };
    if (gr.cat === "fix") {
      tasks.push({ ...base, id: `checkin_fix:${gr.key}`, kind: "checkin_fix", status: "Dati da correggere", action: { kind: "fix", label: "Correggi" }, secondary: { kind: "compila", label: "Apri il check-in" } });
    } else {
      tasks.push({ ...base, id: `checkin:${gr.key}`, kind: "checkin", status: partial ? `Incompleto ${gr.declared}/${gr.expected}` : "Da compilare", action: { kind: "resolve", step: "checkin", label: "Sollecita" }, secondary: { kind: "compila", label: "Compila tu" } });
    }
  }

  // ── Questura (Alloggiati Web) ──
  const invalidBookings = new Set(inp.sched.filter((s) => s.stato === "da_validare" && s.booking_id).map((s) => s.booking_id as string));
  type SG = { key: string; bookingId: string; arrival: string; structureId: string | null; count: number };
  const groupSched = (rows: SchedRow[]): SG[] => {
    const m = new Map<string, SG>();
    for (const s of rows) {
      const key = s.booking_id as string;
      const cur = m.get(key) ?? { key, bookingId: key, arrival: s.arrival, structureId: s.structure_id, count: 0 };
      cur.count++;
      if (s.arrival && (!cur.arrival || s.arrival < cur.arrival)) cur.arrival = s.arrival;
      m.set(key, cur);
    }
    return [...m.values()];
  };
  const schedLabel = (n: number) => nWord(n, "schedina", "schedine");
  const dlTask = (arrival: string) => { const d = questuraDeadline(arrival, nowMs); return { urgency: (d.over ? "late" : "today") as Urgency, dueLabel: d.label, dueISO: d.deadlineISO }; };
  // Pronta da inviare solo se: schedina pronta + prenotazione viva e COMPLETA + nessuna schedina della stessa prenotazione ancora da validare + arrivo già avvenuto.
  const toSend = groupSched(inp.sched.filter((s) => s.stato === "pronta" && !!s.booking_id && byId.has(s.booking_id) && completeIds.has(s.booking_id) && !invalidBookings.has(s.booking_id) && (s.arrival || "") <= today));
  for (const g of toSend) {
    const b = byId.get(g.bookingId) as B;
    tasks.push({
      id: `questura_send:${g.key}`, ente: "questura", kind: "questura_send", title: inp.nameOf(b), meta: [bkNo(b), schedLabel(g.count), `Arrivo ${shortDate(g.arrival)}`],
      status: "Pronta da inviare", ...dlTask(g.arrival), bookingIds: [b.id], repId: b.id, structureId: g.structureId ?? b.structureId, count: g.count,
      action: { kind: "resolve", step: "alloggiati", label: "Invia" }, secondary: { kind: "link", label: "Apri Alloggiati", href: "/alloggiati-web" },
    });
  }
  // Schedine rifiutate dai controlli (dati non accettati): le prenotazioni già segnalate nel check-in come "da correggere" non si contano due volte.
  const toFix = groupSched(inp.sched.filter((s) => s.stato === "da_validare" && !!s.booking_id && byId.has(s.booking_id) && !fixBookingIds.has(s.booking_id) && (s.arrival || "") <= today));
  for (const g of toFix) {
    const b = byId.get(g.bookingId) as B;
    tasks.push({
      id: `questura_fix:${g.key}`, ente: "questura", kind: "questura_fix", title: inp.nameOf(b), meta: [bkNo(b), schedLabel(g.count), `Arrivo ${shortDate(g.arrival)}`],
      status: "Dati non accettati", ...dlTask(g.arrival), bookingIds: [b.id], repId: b.id, structureId: g.structureId ?? b.structureId, count: g.count,
      action: { kind: "fix", label: "Correggi" }, secondary: { kind: "link", label: "Apri Alloggiati", href: "/alloggiati-web" },
    });
  }
  // Check-in completo e dati validi ma schedina non ancora generata (arrivi dell'ultima settimana, già avvenuti).
  const hasSched = new Set(inp.sched.map((s) => s.booking_id).filter(Boolean) as string[]);
  const weekAgo = addDaysISO(today, -PREPARE_BACK_DAYS);
  const toPrepare = live.filter((b) => isComplete(b) && valid(b) && b.checkIn >= weekAgo && b.checkIn <= today && !hasSched.has(b.id));
  if (toPrepare.length) {
    const oldest = toPrepare.reduce((m, b) => (b.checkIn < m ? b.checkIn : m), today);
    tasks.push({
      id: "questura_prepare", ente: "questura", kind: "questura_prepare", title: nWord(toPrepare.length, "prenotazione senza schedina", "prenotazioni senza schedina"),
      meta: ["Check-in completo", `Arrivi dal ${shortDate(oldest)}`], status: "Da preparare", ...dlTask(oldest),
      bookingIds: toPrepare.map((b) => b.id), count: toPrepare.length,
      action: { kind: "sync", sync: "alloggiati", label: "Prepara le schedine" }, secondary: { kind: "link", label: "Apri Alloggiati", href: "/alloggiati-web" },
    });
  }
  done.questura = groupSched(inp.sched.filter((s) => s.stato === "inviata" && !!s.booking_id && inRecent(s.arrival || ""))).length;

  // ── ISTAT ──
  const istatPend = inp.istat.filter((s) => s.stato === "pending" && isActiveId(s.booking_id) && (s.arrival || "") <= today);
  const istatBy = new Map<string, { structureId: string | null; bookings: Set<string>; oldest: string }>();
  for (const s of istatPend) {
    const key = s.structure_id ?? "-";
    const cur = istatBy.get(key) ?? { structureId: s.structure_id, bookings: new Set<string>(), oldest: s.arrival };
    cur.bookings.add(s.booking_id ?? s.id);
    if (s.arrival && s.arrival < cur.oldest) cur.oldest = s.arrival;
    istatBy.set(key, cur);
  }
  for (const [key, g] of istatBy) {
    const n = g.bookings.size;
    tasks.push({
      id: `istat_send:${key}`, ente: "istat", kind: "istat_send", urgency: "today", title: nWord(n, "movimento da comunicare", "movimenti da comunicare"),
      meta: [g.oldest === today ? `Arrivi di oggi` : `Arrivi dal ${shortDate(g.oldest)}`], status: "Da inviare", dueLabel: "Con la chiusura giornaliera", dueISO: null,
      bookingIds: [...g.bookings], structureId: g.structureId, count: n,
      action: { kind: "link", label: "Apri ISTAT", href: "/istat" }, secondary: { kind: "sync", sync: "istat", label: "Genera da arrivi" },
    });
  }
  { const seen = new Set<string>(); for (const s of inp.istat) if (s.stato === "sent" && inRecent(s.arrival || "") && isActiveId(s.booking_id)) { const k = s.booking_id ?? s.id; if (!seen.has(k)) { seen.add(k); done.istat++; } } }

  // ── Tassa di soggiorno e saldi: partenza oggi o già avvenuta (ultimi 14 giorni); saldo anche per chi parte domani ──
  const backStart = addDaysISO(today, -BACK_DAYS);
  const tomorrow = addDaysISO(today, 1);
  for (const b of live) {
    if (b.checkOut < backStart || b.checkIn > today) continue; // già arrivato
    const dep = diffDays(today, b.checkOut); // giorni dalla partenza (>0 = già partito)
    const depLabel = (u: Urgency) => (u === "late" ? `In ritardo di ${nWord(dep, "giorno", "giorni")}` : u === "today" ? "Parte oggi" : "Parte domani");
    const tax = inp.taxOf(b);
    if (b.checkOut <= today && tax > 0) {
      if (b.cityTaxPaid) { if (inRecent(b.checkOut)) done.tassa++; }
      else {
        const u = urgencyByDate(b.checkOut, today) as Urgency;
        tasks.push({
          id: `tax:${b.id}`, ente: "tassa", kind: "tax", urgency: u, title: inp.nameOf(b), meta: [bkNo(b), stay(b)], status: "Da incassare", dueLabel: depLabel(u), dueISO: b.checkOut,
          bookingIds: [b.id], repId: b.id, structureId: b.structureId, amount: tax,
          action: { kind: "resolve", step: "tax", label: "Sollecita" }, secondary: { kind: "fix", label: "Apri" },
        });
      }
    }
    if (b.checkOut <= tomorrow && b.checkOut >= backStart) {
      const bal = inp.balanceOf(b);
      if (bal > 0.005) {
        const u = urgencyByDate(b.checkOut, today, tomorrow) as Urgency;
        tasks.push({
          id: `pay:${b.id}`, ente: "pagamenti", kind: "pay", urgency: u, title: inp.nameOf(b), meta: [bkNo(b), stay(b)], status: "Saldo da incassare", dueLabel: depLabel(u), dueISO: b.checkOut,
          bookingIds: [b.id], repId: b.id, structureId: b.structureId, amount: bal,
          action: { kind: "resolve", step: "pay", label: "Sollecita" }, secondary: { kind: "fix", label: "Apri" },
        });
      } else if (inp.totalOf(b) > 0 && b.checkOut <= today && inRecent(b.checkOut)) done.pagamenti++;
    }
  }

  // ── Fatture da incassare (pagamenti) e fatture (SdI, fornitori) ──
  const soonUntil = addDaysISO(today, upDays);
  const dueWord = (iso: string, u: Urgency, lateWord: string) => (u === "late" ? `${lateWord} da ${nWord(diffDays(today, iso), "giorno", "giorni")}` : u === "today" ? "Scade oggi" : `Scade ${relDay(iso, today)}`);
  for (const d of inp.docs) {
    if (d.stato === "scartata") {
      tasks.push({
        id: `doc_rejected:${d.id}`, ente: "fatture", kind: "doc_rejected", urgency: "today", title: d.name || "Documento", meta: [d.number_label ?? "Senza numero"], status: "Scartata dal SdI",
        dueLabel: "Da correggere e reinviare", dueISO: null, bookingIds: [], structureId: d.structure_id,
        action: { kind: "link", label: "Correggi", href: `/documenti/${d.id}` }, secondary: { kind: "link", label: "Tutti i documenti", href: "/documenti" },
      });
      continue;
    }
    if (d.doc_kind === "nota_di_credito" || d.residuo_cents <= 0 || !d.due_date) continue; // senza scadenza non è una scadenza: resta nello scadenzario
    const u = urgencyByDate(d.due_date, today, soonUntil);
    if (!u) continue;
    tasks.push({
      id: `doc_unpaid:${d.id}`, ente: "pagamenti", kind: "doc_unpaid", urgency: u, title: d.name || "Cliente", meta: [d.number_label ?? "Senza numero", `Scadenza ${shortDate(d.due_date)}`], status: "Fattura da incassare",
      dueLabel: dueWord(d.due_date, u, "Scaduta"),
      dueISO: d.due_date, bookingIds: [], structureId: d.structure_id, amount: d.residuo_cents / 100,
      action: { kind: "link", label: "Incassa", href: "/scadenzario-incassi" },
    });
  }
  for (const p of inp.passive) {
    if (p.paid || !p.due_date) continue;
    const u = urgencyByDate(p.due_date, today, soonUntil);
    if (!u) continue;
    tasks.push({
      id: `supplier:${p.id}`, ente: "fatture", kind: "supplier", urgency: u, title: p.supplier_name || "Fornitore", meta: ["Fattura fornitore", `Scadenza ${shortDate(p.due_date)}`], status: u === "late" ? "Scaduta" : "In scadenza",
      dueLabel: dueWord(p.due_date, u, "Scaduta"),
      dueISO: p.due_date, bookingIds: [], structureId: p.structure_id, amount: p.total_cents / 100,
      action: { kind: "link", label: "Paga", href: "/fatture-passive" },
    });
  }

  return { tasks: tasks.sort(compareTasks), done };
}

// ───────────────────────── Riepiloghi ─────────────────────────
export interface EnteSummary { ente: Ente; total: number; late: number; today: number; soon: number; urgent: number; done: number; tone: "ok" | "warn" | "err" }
export interface Summary {
  todo: number; late: number; today: number; soon: number; done: number;
  /** Avanzamento della giornata: fatti / (fatti + da fare adesso). 100 se non c'è nulla di dovuto. */
  pct: number; tone: "ok" | "warn" | "err"; byEnte: EnteSummary[];
}
export function summarize(tasks: Task[], done: Record<Ente, number>): Summary {
  const byEnte: EnteSummary[] = ENTI.map((ente) => {
    const mine = tasks.filter((t) => t.ente === ente);
    const late = mine.filter((t) => t.urgency === "late").length, today = mine.filter((t) => t.urgency === "today").length, soon = mine.filter((t) => t.urgency === "soon").length;
    const urgent = late + today;
    return { ente, total: mine.length, late, today, soon, urgent, done: done[ente] ?? 0, tone: late > 0 ? "err" : urgent > 0 ? "warn" : "ok" };
  });
  const late = byEnte.reduce((a, e) => a + e.late, 0), today = byEnte.reduce((a, e) => a + e.today, 0), soon = byEnte.reduce((a, e) => a + e.soon, 0);
  const doneN = byEnte.reduce((a, e) => a + e.done, 0);
  const todo = late + today;
  return { todo, late, today, soon, done: doneN, pct: todo + doneN === 0 ? 100 : Math.round((doneN / (doneN + todo)) * 100), tone: late > 0 ? "err" : todo > 0 ? "warn" : "ok", byEnte };
}

/** La cosa più urgente da fare adesso (in ritardo o di oggi); null se non c'è nulla. */
export function nextTask(tasks: Task[]): Task | null {
  const t = [...tasks].sort(compareTasks)[0];
  return t && t.urgency !== "soon" ? t : null;
}

// ───────────────────────── Calendario delle scadenze ─────────────────────────
export interface CalDay { iso: string; dow: string; label: string; isToday: boolean; due: number; late: number; byEnte: Partial<Record<Ente, number>>; arrivals: number; arrivalsMissing: number }
/**
 * Prossimi giorni: per ognuno quante scadenze cadono lì e quanti arrivi (con quanti check-in ancora da fare).
 * Oggi raccoglie anche ciò che è in ritardo o senza data. Le voci oltre la finestra non compaiono.
 */
export function buildCalendar<B extends ABooking>(tasks: Task[], bookings: B[], primaryOf: (b: B) => PGuest | undefined, today: string, days = 7): CalDay[] {
  const out: CalDay[] = [];
  for (let i = 0; i < days; i++) { const iso = addDaysISO(today, i); out.push({ iso, dow: dowShort(iso), label: i === 0 ? "Oggi" : i === 1 ? "Domani" : shortDate(iso), isToday: i === 0, due: 0, late: 0, byEnte: {}, arrivals: 0, arrivalsMissing: 0 }); }
  for (const t of tasks) {
    const day = t.dueISO && t.dueISO > today ? t.dueISO : today;
    const cell = out[diffDays(day, today)];
    if (!cell) continue;
    cell.due++; if (t.urgency === "late") cell.late++;
    cell.byEnte[t.ente] = (cell.byEnte[t.ente] ?? 0) + 1;
  }
  const horizonEnd = addDaysISO(today, days - 1);
  const arr = buildArrivalGroups(bookings.filter((b) => isLive(b) && b.checkIn >= today && b.checkIn <= horizonEnd), primaryOf);
  for (const g of arr) { const cell = out[diffDays(g.rep.checkIn, today)]; if (!cell) continue; cell.arrivals++; if (g.cat !== "done") cell.arrivalsMissing++; }
  return out;
}

// ───────────────────────── Cronologia degli invii ─────────────────────────
export interface SubmissionRow { id: string; created_at: string; count: number | null; stato: string; structure_id: string | null }
export interface ReminderItem { ts: number; kind: string; via: string; bookingId: string }
export interface TimelineEntry { id: string; ts: number; kind: "questura" | "sollecito"; title: string; detail: string; ok: boolean | null; structureId?: string | null; bookingId?: string }
const REMINDER_LABEL: Record<string, string> = { checkin: "Sollecito check-in", "pay-saldo": "Link di pagamento del saldo", "pay-tassa": "Link per la tassa di soggiorno", guide: "Guida ospiti", review: "Richiesta di recensione" };
export const reminderLabel = (kind: string): string => REMINDER_LABEL[kind] ?? "Messaggio all'ospite";

export function buildTimeline(subs: SubmissionRow[], reminders: ReminderItem[], max = 8): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const s of subs) {
    const ts = Date.parse(s.created_at);
    if (!isFinite(ts)) continue;
    const n = s.count ?? 0;
    if (s.stato === "sent") out.push({ id: `sub:${s.id}`, ts, kind: "questura", title: n > 0 ? `${schedineWord(n)} alla Questura` : "Invio alla Questura", detail: "Inviate e acquisite dal portale", ok: true, structureId: s.structure_id });
    else if (s.stato === "error") out.push({ id: `sub:${s.id}`, ts, kind: "questura", title: "Invio alla Questura non riuscito", detail: n > 0 ? `${schedineWord(n)} da reinviare` : "Da controllare in Alloggiati Web", ok: false, structureId: s.structure_id });
    else out.push({ id: `sub:${s.id}`, ts, kind: "questura", title: "Invio alla Questura in corso", detail: "In attesa dell'esito del portale", ok: null, structureId: s.structure_id });
  }
  for (const r of reminders) out.push({ id: `rem:${r.bookingId}:${r.kind}:${r.ts}`, ts: r.ts, kind: "sollecito", title: reminderLabel(r.kind), detail: `Inviato via ${r.via}`, ok: true, bookingId: r.bookingId });
  return out.sort((a, b) => b.ts - a.ts).slice(0, max);
}
const schedineWord = (n: number) => `${n} ${plural(n, "schedina inviata", "schedine inviate")}`;
