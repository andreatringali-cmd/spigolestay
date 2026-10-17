// Testo dell'email che Xenora manda al titolare quando arriva, cambia o si cancella una prenotazione, o si registra un pagamento:
// tutte le informazioni utili in un colpo solo (ospite e contatti, struttura e camera, date, persone, canale, codice, importi, richieste).
// Puro e senza dipendenze dal browser, così lo usano sia il gestionale (prenotazioni inserite a mano) sia il server (prenotazioni dalle OTA).
import { fmtDMY, nights } from "./dates";
import { eur } from "./format";
import { plural } from "./plural";

export type NotifyEvent = "newBooking" | "modified" | "cancel" | "payment";

export interface NotifyInput {
  ev: NotifyEvent;
  booking: {
    code?: string; checkIn: string; checkOut: string; adults?: number; children?: number; cribs?: number;
    total?: number; paid?: number; cleaningFee?: number; arrivalTime?: string; guestRequests?: string; note?: string; parking?: boolean;
  };
  guest?: { fullName?: string; phone?: string; email?: string; country?: string };
  structureName?: string;
  roomLabel?: string;
  channelLabel?: string;
  paymentAmount?: number;
}

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

export function notifyBookingLines(i: NotifyInput): string[] {
  const b = i.booking, g = i.guest ?? {};
  const out: string[] = [];
  const add = (label: string, value: unknown) => { const v = clean(value); if (v) out.push(`${label}: ${v}`); };

  out.push(clean(g.fullName) || "Ospite (nome non indicato)");
  add("Telefono", g.phone);
  add("Email", g.email);
  add("Paese", g.country);
  out.push("");

  add("Struttura", i.structureName);
  add("Camera", i.roomLabel);
  out.push(`Arrivo: ${fmtDMY(b.checkIn)}${clean(b.arrivalTime) ? ` · previsto alle ${clean(b.arrivalTime)}` : ""}`);
  out.push(`Partenza: ${fmtDMY(b.checkOut)}`);
  const n = b.checkIn && b.checkOut ? nights(b.checkIn, b.checkOut) : 0;
  const adults = b.adults ?? 0, kids = b.children ?? 0;
  const people = [adults ? plural(adults, "adulto", "adulti") : "", kids ? plural(kids, "bambino", "bambini") : ""].filter(Boolean).join(", ");
  out.push(`Soggiorno: ${plural(n, "notte", "notti")}${people ? ` · ${people}` : ""}`);
  add("Canale", i.channelLabel);
  add("Codice prenotazione", b.code);

  if (typeof b.total === "number") {
    out.push("");
    // Il totale comprende la pulizia (come "Da incassare"): con la pulizia si mostrano le due righe e la somma.
    const cleaning = b.cleaningFee && b.cleaningFee > 0 ? b.cleaningFee : 0;
    if (cleaning > 0) {
      out.push(`Alloggio: ${eur(b.total)}`);
      out.push(`Pulizia: ${eur(cleaning)}`);
    }
    out.push(`Totale: ${eur(b.total + cleaning)}`);
    const paid = b.paid ?? 0;
    if (paid > 0) out.push(`Già incassato: ${eur(paid)}`);
    const due = Math.max(0, b.total + cleaning - paid);
    if (i.ev !== "cancel") out.push(`Da incassare: ${eur(due)}`); // su una cancellazione non c'è più nulla da incassare
  }
  if (i.ev === "payment" && i.paymentAmount) out.push(`Incasso registrato: ${eur(i.paymentAmount)}`);

  const extras: string[] = [];
  if (b.parking) extras.push("Parcheggio richiesto");
  if (b.cribs) extras.push(`Culle/lettini: ${b.cribs}`);
  if (extras.length) { out.push(""); out.push(...extras); }
  if (clean(b.guestRequests)) { out.push(""); out.push(`Richieste dell'ospite: ${clean(b.guestRequests)}`); }
  if (clean(b.note)) { if (!clean(b.guestRequests)) out.push(""); out.push(`Note: ${clean(b.note)}`); }

  // niente righe vuote doppie o in coda
  return out.filter((l, idx, a) => !(l === "" && (a[idx - 1] === "" || idx === a.length - 1)));
}
