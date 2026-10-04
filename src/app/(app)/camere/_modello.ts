// Logica pura della vista Camere · Dettagliata: stato di oggi, prossimo arrivo, occupazione, segnalazioni.
// Nessuna scrittura e nessuna dipendenza da React: parte solo da camere e prenotazioni già in scope.
import type { Booking, RoomType, Unit } from "@/lib/types";
import { shiftISO, toISO } from "@/lib/dates";
import { isBlock, nightOf, occupies } from "@/app/(app)/calendario/_modello";

export type Tone = "ok" | "focus" | "warn" | "err" | "dim";
export type StatoKind = "oos" | "blocked" | "turnover" | "arrive" | "depart" | "occupied" | "free";
export interface Stato { kind: StatoKind; label: string; detail?: string; tone: Tone }

export const TONE_VAR: Record<Tone, string> = { ok: "var(--ok)", focus: "var(--focus)", warn: "var(--warn)", err: "var(--err)", dim: "var(--dim)" };

export type GuestNameFn = (b: Booking) => string;

const fmtDay = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
export const dayLabel = fmtDay;

export interface Snapshot {
  stato: Stato;
  next?: Booking;               // prossimo arrivo (dopo oggi)
  nextGuest?: string;
  occ30: ("b" | "x" | "f")[];   // prossimi 30 giorni: b = ospite, x = blocco, f = libero
  occ30n: number;               // notti con ospite su 30
  blocked30: number;            // notti bloccate su 30
  monthPct: number;             // % notti con ospite nel mese corrente
  monthLabel: string;
  firstFree?: string;           // prima notte libera da oggi
  openBookings: Booking[];      // prenotazioni vere in corso o future (checkOut > oggi), in ordine
}

// `mine`: prenotazioni che occupano e sono assegnate a questa camera (blocchi inclusi).
export function snapshotOf(u: Unit, mine: Booking[], today: string, guestName: GuestNameFn): Snapshot {
  const live = mine.filter((b) => occupies(b) && !isBlock(b));
  const blocks = mine.filter((b) => occupies(b) && isBlock(b));
  const sorted = [...live].sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  const arr = sorted.find((b) => b.checkIn === today);
  const dep = sorted.find((b) => b.checkOut === today);
  const stay = sorted.find((b) => b.checkIn < today && today < b.checkOut);
  const blk = blocks.find((b) => nightOf(b, today));
  const next = sorted.find((b) => b.checkIn > today);
  const nextArrivalAfterToday = next;

  let stato: Stato;
  if (u.outOfService) {
    stato = { kind: "oos", label: "Fuori servizio", detail: u.oosReason?.trim() || undefined, tone: "err" };
  } else if (blk) {
    stato = { kind: "blocked", label: `Bloccata fino al ${fmtDay(blk.checkOut)}`, detail: blk.note?.trim() || undefined, tone: "err" };
  } else if (arr && dep && arr.id !== dep.id) {
    stato = { kind: "turnover", label: "Turnover", detail: `Parte ${guestName(dep)} · arriva ${guestName(arr)}`, tone: "warn" };
  } else if (arr) {
    stato = { kind: "arrive", label: "Arrivo oggi", detail: guestName(arr), tone: "focus" };
  } else if (dep) {
    stato = { kind: "depart", label: "Partenza oggi", detail: guestName(dep), tone: "dim" };
  } else if (stay) {
    stato = { kind: "occupied", label: `Occupata fino al ${fmtDay(stay.checkOut)}`, detail: guestName(stay), tone: "focus" };
  } else {
    const nf = nextArrivalAfterToday;
    stato = { kind: "free", label: "Libera", detail: nf ? `fino al ${fmtDay(nf.checkIn)}` : "nessun arrivo in programma", tone: "ok" };
  }

  // Occupazione dei prossimi 30 giorni (da oggi compreso).
  const occ30: ("b" | "x" | "f")[] = [];
  for (let i = 0; i < 30; i++) {
    const d = shiftISO(today, i);
    occ30.push(live.some((b) => nightOf(b, d)) ? "b" : blocks.some((b) => nightOf(b, d)) ? "x" : "f");
  }

  // Mese corrente (intero mese: notti con ospite / giorni del mese).
  const [y, m] = today.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate();
  let occM = 0;
  for (let day = 1; day <= dim; day++) {
    const d = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (live.some((b) => nightOf(b, d))) occM++;
  }
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString("it-IT", { month: "long" });

  // Prima notte libera da oggi (blocchi e prenotazioni contano come occupato).
  let firstFree: string | undefined;
  for (let i = 0; i < 400; i++) {
    const d = shiftISO(today, i);
    if (!mine.some((b) => occupies(b) && nightOf(b, d))) { firstFree = d; break; }
  }

  return {
    stato, next, nextGuest: next ? guestName(next) : undefined,
    occ30, occ30n: occ30.filter((x) => x === "b").length, blocked30: occ30.filter((x) => x === "x").length,
    monthPct: Math.round((occM / dim) * 100), monthLabel, firstFree,
    openBookings: sorted.filter((b) => b.checkOut > today),
  };
}

// ── Codici d'accesso per camera (localStorage "spigolestay:roomaccess", già letti dall'app lato client) ──
// Ritorna per ogni camera se ha almeno un codice con valore. Gestisce anche il vecchio formato { gate, door, door2 }.
export function readAccessMap(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  try {
    const raw = JSON.parse(localStorage.getItem("spigolestay:roomaccess") || "{}") as Record<string, unknown>;
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      if (Array.isArray(v)) out[k] = (v as { value?: string }[]).some((c) => (c?.value || "").trim() !== "");
      else if (v && typeof v === "object") { const o = v as { gate?: string; door?: string; door2?: string }; out[k] = [o.gate, o.door, o.door2].some((x) => (x || "").trim() !== ""); }
    }
  } catch { /* nessun dato leggibile */ }
  return out;
}

// Aggiunge (o aggiorna per etichetta) un codice di accesso di una camera, nello stesso formato della Guida ospiti.
export function saveAccessCode(unitId: string, label: string, value: string): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem("spigolestay:roomaccess") || "{}") as Record<string, unknown>;
    const cur = raw[unitId];
    let list: { label: string; value: string; cond?: string }[] = [];
    if (Array.isArray(cur)) list = (cur as { label: string; value: string; cond?: string }[]).map((c) => ({ ...c }));
    else if (cur && typeof cur === "object") {
      const o = cur as { gate?: string; door?: string; door2?: string };
      list = [{ label: "Cancello", value: o.gate || "" }, { label: "Portone", value: o.door || "" }];
      if (o.door2) list.push({ label: "Porta", value: o.door2 });
    }
    const i = list.findIndex((c) => (c.label || "").trim().toLowerCase() === label.trim().toLowerCase());
    if (i >= 0) list[i] = { ...list[i], value };
    else list.push({ label: label.trim(), value, cond: "always" });
    raw[unitId] = list;
    localStorage.setItem("spigolestay:roomaccess", JSON.stringify(raw));
    return true;
  } catch { return false; }
}

// ── Segnalazioni ──
export type FlagAction = "photo" | "code" | "rate" | "edit" | "back" | "calendar";
export interface Flag { key: string; label: string; title?: string; tone: "err" | "warn" | "dim"; actions: { label: string; run: FlagAction }[] }

export function flagsOf(o: { unit: Unit; rt?: RoomType; snap: Snapshot; accessOk: boolean; checkAccess: boolean }): Flag[] {
  const { unit: u, rt, snap, accessOk, checkAccess } = o;
  const out: Flag[] = [];
  if (u.outOfService && snap.openBookings.length) {
    const n = snap.openBookings.length;
    out.push({
      key: "oosbook", tone: "err",
      label: `Fuori servizio con ${n} ${n === 1 ? "prenotazione" : "prenotazioni"} da spostare`,
      title: "Le prenotazioni assegnate a questa camera restano senza una camera utilizzabile",
      actions: [{ label: "Vedi nel calendario", run: "calendar" }, { label: "Rimetti in servizio", run: "back" }],
    });
  }
  if (!rt) out.push({ key: "notype", tone: "err", label: "Camera senza tipologia", title: "Senza tipologia non ha posti letto né tariffa", actions: [{ label: "Assegna tipologia", run: "edit" }] });
  else if (!rt.deriveFrom && !(rt.basePrice > 0)) out.push({ key: "rate", tone: "err", label: `Nessuna tariffa base su «${rt.name}»`, title: "La tipologia di questa camera non ha un prezzo base", actions: [{ label: "Imposta tariffa", run: "rate" }] });
  if (!(u.photos ?? []).length) out.push({ key: "photo", tone: "warn", label: "Nessuna foto", title: "Le foto compaiono nella guida ospiti e nel booking", actions: [{ label: "Aggiungi foto", run: "photo" }] });
  if (checkAccess && !accessOk) out.push({ key: "code", tone: "warn", label: "Nessun codice d'accesso", title: "Né nei codici della Guida ospiti né nelle istruzioni di accesso della camera", actions: [{ label: "Imposta codice", run: "code" }] });
  return out;
}

export const todayISO = () => toISO(new Date());
