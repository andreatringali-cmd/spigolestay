// Corpo della richiesta POST /api/email (kind "notify") per le notifiche al titolare su una prenotazione.
// Puro, usato dal gestionale (store.tsx, azioni manuali) e dal server (channex-inbound.ts, prenotazioni delle OTA):
// così l'email ha gli stessi dati ricchi (logo e nome struttura, canale, importi, contatti, link alla scheda) ovunque nasca.
import { nights } from "../dates";
import { notifyBookingLines, type NotifyEvent } from "../booking-notify";
import { notifySubject, type NotifyBookingData } from "./notify-email";
import { bookingCode } from "../bookingCode";
import { commissionOf, commissionIsEstimate, nettoOf, bookingExtrasTotal, cityTaxOfBooking } from "../booking";
import { balanceDue, amountPaid } from "../incassi";
import type { Booking, Structure } from "../types";

type StructureLike = Partial<Structure> & { id?: string };
type GuestLike = { fullName?: string; phone?: string; email?: string; country?: string };

export interface NotifyPayloadInput {
  ev: NotifyEvent;
  booking: Booking | (Record<string, unknown> & { checkIn: string; checkOut: string; channel?: string });
  guest?: GuestLike;
  structure?: StructureLike;
  roomLabel?: string;
  channelLabel?: string;
  /** Origine dell'app (https://xenora.it): serve per il link alla scheda. */
  origin?: string;
  /** Importo appena incassato (evento "payment"). */
  paymentAmount?: number;
  /** La prenotazione è stata ELIMINATA (non esiste più nella scheda): il link porta solo all'elenco. */
  deleted?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const addr = (s?: StructureLike) => [s?.address, s?.streetNumber, s?.city].filter(Boolean).join(" ").trim() || undefined;

/** Corpo (senza `to`) da inviare a /api/email. */
export function buildNotifyPayload(i: NotifyPayloadInput): Record<string, unknown> {
  const b = i.booking as unknown as Booking;
  const st = i.structure as Structure | undefined;
  const g = i.guest ?? {};
  const n = b.checkIn && b.checkOut ? nights(b.checkIn, b.checkOut) : 0;
  const stay = round2(b.total ?? 0);
  const extras = round2(bookingExtrasTotal(b));
  const cleaning = round2(b.cleaningFee ?? 0);
  const tax = st ? round2(cityTaxOfBooking(st, b)) : 0;
  const total = round2(stay + extras + cleaning);
  const isOta = b.channel !== "direct" && b.channel !== "blocked";
  const comm = isOta && total > 0 ? commissionOf(b) : 0;
  const hasTotals = stay > 0;
  const nb: NotifyBookingData = {
    bookingId: b.id, code: bookingCode(b), status: b.status,
    guestName: g.fullName, guestPhone: g.phone, guestEmail: g.email, guestCountry: g.country,
    roomLabel: i.roomLabel, checkIn: b.checkIn, checkOut: b.checkOut, arrivalTime: b.arrivalTime as string | undefined,
    nights: n, adults: b.adults, children: b.children, cribs: b.cribs, parking: b.parking,
    bookedOn: b.bookedOn, currency: st?.currency || "€",
    ...(hasTotals ? {
      stay, extras, cleaning, cityTax: tax, total,
      paid: round2(amountPaid(b)), due: round2(st ? balanceDue(b, st) : Math.max(0, total - amountPaid(b))),
      ...(comm > 0 ? { commission: round2(comm), commissionEstimate: commissionIsEstimate(b), net: nettoOf(b) } : {}),
    } : {}),
    ...(i.ev === "payment" && i.paymentAmount ? { payment: round2(i.paymentAmount) } : {}),
    guestRequests: typeof b.guestRequests === "string" ? b.guestRequests : undefined,
    note: typeof b.note === "string" ? b.note : undefined,
  };
  const origin = (i.origin || "").replace(/\/+$/, "");
  const cta = origin
    ? (i.deleted || !b.id ? { ctaUrl: `${origin}/prenotazioni`, ctaLabel: "Apri le prenotazioni →" } : { ctaUrl: `${origin}/prenotazioni?b=${encodeURIComponent(b.id)}`, ctaLabel: "Apri la prenotazione →" })
    : {};
  const structureName = st?.name;
  const lines = notifyBookingLines({
    ev: i.ev, booking: { code: nb.code, checkIn: b.checkIn, checkOut: b.checkOut, adults: b.adults, children: b.children, cribs: b.cribs, total: b.total, paid: b.paid, cleaningFee: b.cleaningFee, arrivalTime: b.arrivalTime as string | undefined, guestRequests: nb.guestRequests, note: nb.note, parking: b.parking },
    guest: g, structureName, roomLabel: i.roomLabel, channelLabel: i.channelLabel, paymentAmount: i.paymentAmount,
  });
  return {
    kind: "notify",
    event: i.ev,
    subject: notifySubject(i.ev, { guestName: g.fullName || "Ospite", channelLabel: i.channelLabel, checkIn: b.checkIn, structureName, amount: i.paymentAmount, currency: st?.currency || "€" }),
    text: lines.join("\n"), // ripiego (e anteprima) se il layout ricco non fosse disponibile
    accent: st?.photoColor,
    brand: { name: structureName, logoUrl: st?.logo, color: st?.photoColor, address: addr(st) },
    channelLabel: i.channelLabel,
    structureName,
    booking: nb,
    ...cta,
  };
}

/**
 * L'eliminazione di una prenotazione merita l'email "Cancellata" al titolare solo se era ancora "viva": non già annullata
 * e non conclusa (check-out ieri o prima). Pulire l'archivio non deve mandare avvisi. `todayYmd` = oggi (fuso Roma) in AAAA-MM-GG.
 */
export function deleteMeritsCancelEmail(b: { status?: string; checkOut?: string }, todayYmd: string): boolean {
  if (b.status === "cancelled") return false;
  const out = String(b.checkOut ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(out) && out < todayYmd) return false;
  return true;
}
