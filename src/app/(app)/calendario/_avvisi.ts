// Segnalazioni e etichetta di una prenotazione, uguali ovunque compaia la scheda (Calendario · Dettagliato e Prenotazioni · Dettagliata).
import type { Booking, Structure, Unit } from "@/lib/types";
import { shiftISO } from "@/lib/dates";
import { bookingPaidTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import type { Avviso, Journey } from "./_scheda";
import { turnoverLabel, type Turnover } from "./_modello";

export type Colonna = "arr" | "stay" | "dep";

/** Le cose da non perdere di vista su una prenotazione, in base alla colonna in cui sta (arrivo, in casa, partenza). */
export function avvisiOf(
  b: Booking, j: Journey, col: Colonna,
  ctx: { today: string; unit?: Unit; turn: { arr: Map<string, Turnover>; dep: Map<string, Turnover> }; getStructure: (id: string) => Structure | undefined },
): Avviso[] {
  const { today, unit, turn, getStructure } = ctx;
  const out: Avviso[] = [];
  if (!b.unitId) out.push({ key: "nounit", label: "Camera da assegnare", tone: b.checkIn <= shiftISO(today, 3) ? "err" : "warn", title: "La prenotazione non ha ancora una camera fisica" });
  else if (unit?.outOfService) out.push({ key: "oos", label: "Camera fuori servizio: serve un'altra camera", tone: "err" });
  if (col === "arr" && j.steps.find((s) => s.key === "checkin")?.state !== "done") {
    out.push({ key: "nocheckin", label: b.checkIn <= today ? "Arrivo senza check-in online" : "Check-in online non ancora fatto", tone: b.checkIn <= today ? "err" : "warn" });
  }
  const t = col === "arr" ? turn.arr.get(b.id) : col === "dep" ? turn.dep.get(b.id) : undefined;
  if (t) { const l = turnoverLabel(t, getStructure); out.push({ key: "turnover", label: l.label, tone: "warn", title: l.title }); }
  if (col === "dep") {
    const resid = Math.max(0, bookingPaidTotal(b) - (b.paid ?? 0));
    if (resid > 0.005) out.push({ key: "saldo", label: `Parte con saldo aperto: ${eur(resid)}`, tone: b.checkOut <= today ? "err" : "warn" });
  }
  return out;
}

/** In che colonna cade una prenotazione guardandola "da oggi" (per l'elenco Prenotazioni, che non ha colonne). */
export function colonnaOggi(b: Booking, today: string): Colonna {
  if (b.checkIn >= today) return "arr";
  if (b.checkOut <= today) return "dep";
  return "stay";
}

const relDay = (iso: string, today: string, short: (iso: string) => string) => {
  const diff = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
  return diff === 0 ? "oggi" : diff === 1 ? "domani" : diff === -1 ? "ieri" : short(iso);
};

/** Etichetta accanto alle date: "Arriva oggi", "Parte domani", "In casa · notte 2 di 4". Stessi testi e stessi colori in tutte le viste. */
export function etichettaOggi(b: Booking, today: string, short: (iso: string) => string): { tag: string; tone: string } {
  if (b.status === "no_show") return { tag: "No-show", tone: "var(--err)" };
  if (b.status === "cancelled") return { tag: "Cancellata", tone: "var(--err)" };
  if (b.checkOut < today) return { tag: "Partita", tone: "var(--faint)" };
  const col = colonnaOggi(b, today);
  if (col === "arr") return { tag: `Arriva ${relDay(b.checkIn, today, short)}`, tone: "var(--ok)" };
  if (col === "dep") return { tag: `Parte ${relDay(b.checkOut, today, short)}`, tone: "var(--warn)" };
  const k = Math.round((Date.parse(today) - Date.parse(b.checkIn)) / 86400000) + 1;
  const n = Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86400000);
  return { tag: `In casa · notte ${k} di ${n}`, tone: "var(--focus)" };
}
