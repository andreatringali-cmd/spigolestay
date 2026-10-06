// Segnalazioni e etichetta di una prenotazione, uguali ovunque compaia la scheda (Calendario · Dettagliato e Prenotazioni · Dettagliata).
import type { Booking, Unit } from "@/lib/types";
import { shiftISO } from "@/lib/dates";
import { bookingPaidTotal } from "@/lib/booking";
import { eur } from "@/lib/format";
import type { Avviso, Journey } from "./_scheda";
import { contactReportCached, daysUntil } from "@/lib/contacts-check";
import { URGENT_DAYS } from "@/lib/contacts-upcoming";

export type Colonna = "arr" | "stay" | "dep";

/** Le cose da non perdere di vista su una prenotazione, in base alla colonna in cui sta (arrivo, in casa, partenza). Solo cose della prenotazione: il turnover e la pulizia sono informazioni della camera e stanno in Pulizie. */
export function avvisiOf(
  b: Booking, j: Journey, col: Colonna,
  ctx: { today: string; unit?: Unit; guest?: { id: string; phone?: string; email?: string; country?: string } },
): Avviso[] {
  const { today, unit, guest } = ctx;
  const out: Avviso[] = [];
  if (!b.unitId) out.push({ key: "nounit", label: "Camera da assegnare", tone: b.checkIn <= shiftISO(today, 3) ? "err" : "warn", title: "La prenotazione non ha ancora una camera fisica" });
  else if (unit?.outOfService) out.push({ key: "oos", label: "Camera fuori servizio: serve un'altra camera", tone: "err" });
  if (col === "arr" && j.steps.find((s) => s.key === "checkin")?.state !== "done") {
    out.push({ key: "nocheckin", label: b.checkIn <= today ? "Arrivo senza check-in online" : "Check-in online non ancora fatto", tone: b.checkIn <= today ? "err" : "warn" });
  }
  // Contatti dell'ospite che non permettono ai messaggi automatici di partire: si avvisa con anticipo, quando si può ancora rimediare.
  if (col === "arr" && guest && b.channel !== "blocked") {
    const days = daysUntil(b.checkIn, today);
    if (days >= 0 && days <= 60) {
      const iss = contactReportCached(guest).issues.sort((x, y) => (x.level === y.level ? 0 : x.level === "err" ? -1 : 1))[0];
      if (iss) out.push({ key: "contact", label: iss.label, tone: iss.level === "err" || days <= 3 ? (days <= URGENT_DAYS ? "err" : "warn") : "warn", title: [iss.detail, iss.fix ? `Proposta: ${iss.fix.value}` : "", "Apri la scheda ospite per correggere"].filter(Boolean).join(" · "), href: `/ospiti/${guest.id}` });
    }
  }
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
