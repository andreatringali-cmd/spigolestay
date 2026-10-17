// Dalla sessione Stripe Checkout di una prenotazione dal sito (kind "book") al corpo della richiesta per /api/public-booking.
// Condiviso da /api/stripe/book/confirm (ritorno pagina) e dal webhook Stripe: i due devono registrare la STESSA prenotazione.
// I metadata li ha scritti /api/stripe/book (politica e importo calcolati sul server). L'importo versato e' quello che Stripe ha incassato.

import { bookingGrandTotal, cityTaxOfBookingRaw, type BookingLike } from "./booking";
import { decodeOrderExtras, priceBookExtras, extrasTotalOf } from "./book-order";
import type { Structure } from "./types";

type SessionLike ={ id: string; amount_total?: number | null; metadata?: Record<string, string> | null };

export const parseChildAges = (raw: string | undefined): number[] =>
  String(raw || "").split(",").map((x) => x.trim()).filter((x) => x !== "").map(Number).filter((x) => Number.isFinite(x) && x >= 0 && x < 120).slice(0, 12);

export function publicBookingBodyFromSession(session: SessionLike, o: { slug: string; paymentIntent: string; accountId: string }): Record<string, unknown> {
  const m = (session.metadata ?? {}) as Record<string, string>;
  const name = (m.gn || "").trim();
  const ages = parseChildAges(m.ca);
  // Nome e cognome: campi separati (gf/gl) se presenti; le sessioni vecchie hanno solo "gn" e si divide al primo spazio (come prima).
  const first = (m.gf ?? "").trim() || (m.gl === undefined ? name.split(" ")[0] || "" : "");
  const last = (m.gl ?? "").trim() || (m.gf === undefined ? name.split(" ").slice(1).join(" ") : "");
  const orderExtras = decodeOrderExtras(m.ex);
  return {
    slug: o.slug, rt: m.rt, ci: m.ci, co: m.co,
    adults: Number(m.ad) || 1, children: Number(m.ch) || 0,
    ...(ages.length ? { childAges: ages } : {}),
    total: Number(m.tot) || 0,
    // Versato = quanto Stripe ha davvero incassato (centesimi / 100), non il valore dichiarato nei metadata.
    deposit: Math.round(session.amount_total ?? 0) / 100,
    note: m.note || "", code: m.code || "", token: m.token || session.id,
    planName: m.rpn || "", refundable: m.ref === "1", cancelDays: Number(m.cd) || 0,
    // Extra e codice promo scelti dall'ospite: public-booking li rivalida sul catalogo/promo del proprietario (id e quantita', mai prezzi).
    ...(orderExtras.length ? { extras: orderExtras.map((e) => ({ extraId: e.id, qty: e.qty })) } : {}), ...(m.pc ? { promoCode: m.pc } : {}),
    lang: m.lg || undefined,
    stripePaymentIntent: o.paymentIntent, stripeSessionId: session.id, stripeAccountId: o.accountId,
    guest: { firstName: first, lastName: last, email: m.ge || "", phone: m.gp || "", country: m.gc || "", language: m.lg || "" },
  };
}

/**
 * Esito negativo di /api/public-booking DOPO che il pagamento e' gia' stato incassato (conferma pagina e webhook).
 *  - transitorio (rete, 5xx, 409 write_conflict, 429): si ritenta. Conferma pagina: status 409/502 con `error`, cosi' il client riprova; webhook: 500 e Stripe riprova.
 *  - permanente (4xx: site_not_found, bad_request, room_type_not_found…): riprovare non serve e il webhook non deve rispondere 500 per giorni.
 *    Conferma pagina: 422 con `error`; webhook: risponde 200 e AVVISA titolare e amministratori (il rimborso e' una decisione umana: i dati possono essere sistemati a mano).
 */
export function bookingWriteFailure(status: number, pj: { error?: unknown } | null | undefined): { permanent: boolean; httpStatus: number; error: string } {
  const error = typeof pj?.error === "string" && pj.error ? pj.error : status >= 500 || !status ? "booking_write_failed" : `http_${status}`;
  const transient = !status || status >= 500 || status === 409 || status === 408 || status === 429;
  if (transient) return { permanent: false, httpStatus: status === 409 ? 409 : 502, error };
  return { permanent: true, httpStatus: 422, error };
}

type Json = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** Riepilogo della prenotazione per la pagina /prenota (conferma dopo il pagamento): contratto letto da confirmReturn in src/app/prenota/page.tsx. */
export type BookingSummary = {
  code: string; structureName?: string; roomName?: string; ci: string; co: string;
  grandTotal: number; paid: number; cityTax: number;
  guestFirst: string; guestLast: string; adults: number; children: number; email: string;
};

/**
 * Costruisce il riepilogo dalla prenotazione REALE salvata (se trovata: vale anche per `already:true`) oppure, se non e' ancora rileggibile,
 * dai metadata della sessione Stripe (gli stessi da cui public-booking l'ha creata). Importi: stessa formula del gestionale (lib/booking.ts).
 */
export function bookingSummaryFrom(o: { session: SessionLike; booking?: Json | null; structure?: Json | null; roomType?: Json | null; guest?: Json | null }): BookingSummary {
  const m = (o.session.metadata ?? {}) as Record<string, string>;
  const bk = o.booking ?? null;
  const st = (o.structure ?? undefined) as unknown as Structure | undefined;
  const name = (m.gn || "").trim();
  const ci = str(bk?.checkIn) ?? m.ci ?? "";
  const co = str(bk?.checkOut) ?? m.co ?? "";
  const adults = num(bk?.adults) ?? (Number(m.ad) || 1);
  const children = num(bk?.children) ?? (Number(m.ch) || 0);
  const childAges = Array.isArray(bk?.childAges) ? (bk!.childAges as unknown[]).map(Number).filter((x) => Number.isFinite(x)) : parseChildAges(m.ca);
  const total = num(bk?.total) ?? (Number(m.tot) || 0);
  const cityTax = cityTaxOfBookingRaw(st, { adults, children, childAges, checkIn: ci, checkOut: co, total });
  // Prenotazione non ancora rileggibile: gli extra scelti (metadata) si ripesano sul catalogo della struttura, come fara' public-booking.
  const metaExtras = bk ? [] : priceBookExtras(decodeOrderExtras(m.ex).map((e) => ({ extraId: e.id, qty: e.qty })), (o.structure ?? null) as Json | null, { checkIn: ci, checkOut: co, adults });
  const grandTotal = bk
    ? Math.round(bookingGrandTotal({ ...(bk as object), total, checkIn: ci, checkOut: co, adults, children, childAges } as BookingLike, st) * 100) / 100
    : Math.round((total + extrasTotalOf(metaExtras) + cityTax) * 100) / 100;
  const paid = num(bk?.paid) ?? Math.round(o.session.amount_total ?? 0) / 100;
  const g = o.guest ?? null;
  return {
    code: str(bk?.code) ?? str(m.code) ?? (str(bk?.id) ? String(bk!.id).slice(0, 8).toUpperCase() : ""),
    structureName: str(st?.name), roomName: str(o.roomType?.name) ? `${str(o.roomType?.name)}${m.rpn ? " · " + m.rpn : ""}` : undefined,
    ci, co, grandTotal, paid, cityTax,
    guestFirst: str(g?.firstName) ?? ((m.gf ?? "").trim() || (name.split(" ")[0] || "")), guestLast: str(g?.lastName) ?? ((m.gl ?? "").trim() || (m.gf === undefined ? name.split(" ").slice(1).join(" ") : "")),
    adults, children, email: str(g?.email) ?? (m.ge || ""),
  };
}
