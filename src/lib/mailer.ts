import type { Booking, Structure, Guest, RoomType, Unit } from "./types";
import { bookingCode } from "./bookingCode";
import { nights } from "./dates";
import { cityTaxOf } from "./booking";

const appUrl = () => (typeof window !== "undefined" ? window.location.origin : "https://xenora-app.vercel.app");

interface Deps {
  getStructure: (id: string) => Structure | undefined;
  getGuest: (id: string) => Guest | undefined;
  getRoomType: (id: string) => RoomType | undefined;
  getUnit: (id: string | null) => Unit | undefined;
}

const STATUS_LABEL: Record<string, string> = { confirmed: "Confermata", tentative: "In attesa di conferma", cancelled: "Annullata", no_show: "No-show" };

// Costruisce il link a Google Maps dell'indirizzo struttura (usato nel piè di pagina email, come
// fa Octorate): niente coordinate salvate, basta l'indirizzo testuale.
function mapsUrl(address?: string): string | undefined {
  if (!address || !address.trim()) return undefined;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// Testo delle condizioni di cancellazione (stessa logica di lib/rate-plans.ts cancelText, ma senza
// dipendere dal tipo RatePlan: qui basta refundable/cancelDays già presenti sulla prenotazione).
function cancelPolicyText(refundable?: boolean, cancelDays?: number): string {
  if (!refundable) return "La prenotazione non è rimborsabile.";
  if (cancelDays && cancelDays > 0) return `Cancellazione gratuita fino a ${cancelDays} giorni prima dell'arrivo. Oltre questo termine è dovuto l'intero importo della prenotazione.`;
  return "Cancellazione gratuita fino al giorno di arrivo.";
}

// Spiegazione della tassa di soggiorno applicata (percentuale/fissa, tetto, esenzione minori),
// come il riepilogo che manda Octorate — costruita dalle regole reali configurate sulla struttura.
function cityTaxRuleText(s: Structure | undefined, amount: number): string | undefined {
  if (!s?.cityTax || amount <= 0) return undefined;
  const parts: string[] = [];
  if (s.cityTaxMode === "percent") {
    parts.push(`La tassa di soggiorno è pari al ${s.cityTaxPercent ?? 0}% della prenotazione.`);
    if (s.cityTaxCap) parts.push(`Massimo ${s.cityTaxCap} EUR a persona per notte.`);
  } else {
    parts.push(`La tassa di soggiorno è di ${s.cityTaxAmount ?? 0} EUR a persona per notte.`);
  }
  if (s.cityTaxChildFreeUnder) parts.push(`Non si applica ai bambini con età inferiore a ${s.cityTaxChildFreeUnder} anni.`);
  parts.push("La tassa di soggiorno non è inclusa nel totale e sarà pagata in base alle politiche di pagamento definite dalla struttura.");
  return parts.join(" ");
}

function payload(b: Booking, d: Deps) {
  const s = d.getStructure(b.structureId);
  const g = d.getGuest(b.guestId);
  const rt = d.getRoomType(b.roomTypeId);
  const u = d.getUnit(b.unitId);
  const n = nights(b.checkIn, b.checkOut);
  const roomTotal = b.total ?? 0;
  const extras = (b.extras ?? []).map((e) => ({ name: e.name, price: e.price }));
  const extrasTotal = extras.reduce((sum, e) => sum + (e.price || 0), 0);
  const bookingTotal = roomTotal + extrasTotal;
  const cityTax = cityTaxOf(s, b.adults, n, roomTotal, b.cityTaxExempt);
  const grandTotal = bookingTotal + cityTax;
  const address = s ? [s.address, s.streetNumber, s.city].filter(Boolean).join(" ") : undefined;
  return {
    code: bookingCode(b),
    status: STATUS_LABEL[b.status] || b.status,
    structureName: s?.name,
    structureEmail: s?.email,
    guestName: g?.fullName,
    guestEmail: g?.email,
    roomType: rt?.name,
    unitName: u?.name,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: n,
    adults: b.adults,
    children: b.children,
    total: roomTotal,
    extras,
    extrasTotal,
    bookingTotal,
    cityTaxAmount: cityTax,
    cityTaxRuleText: cityTaxRuleText(s, cityTax),
    grandTotal,
    paid: b.paid ?? 0,
    due: Math.max(0, grandTotal - (b.paid ?? 0)),
    ratePlanName: b.ratePlanName,
    refundable: b.refundable,
    cancelDays: b.cancelDays,
    cancelPolicy: cancelPolicyText(b.refundable, b.cancelDays),
    guestRequests: b.guestRequests,
    currency: s?.currency || "€",
    checkInFrom: s?.checkInFrom,
    checkOutBy: s?.checkOutBy,
    address,
    mapsUrl: mapsUrl(address),
    phone: s?.phone,
    color: s?.photoColor,
    logo: s?.logo,
    website: s?.website,
    cin: s?.cin,
    vat: s?.vat,
  };
}

// Esportata perché il pannello prenotazioni la usa per costruire l'anteprima off-screen del
// voucher (VoucherDoc) da catturare in PDF — stessi identici dati inviati nell'email, niente
// calcoli duplicati.
export type VoucherPayload = ReturnType<typeof payload>;
export const voucherPayload = payload;

// Invia il voucher/conferma all'ospite. pdfBase64/pdfFilename: se il chiamante ha già catturato
// l'anteprima reale (VoucherDoc via html2canvas, vedi BookingDrawer), li allega così com'è; se
// mancano, il server ripiega sul disegno pdf-lib (fallback per invii automatici senza browser,
// es. dopo una prenotazione pubblica). Ritorna {ok, error?}.
export async function sendVoucher(b: Booking, d: Deps, pdf?: { pdfBase64?: string; pdfFilename?: string }): Promise<{ ok: boolean; error?: string }> {
  const bk = payload(b, d);
  if (!bk.guestEmail) return { ok: false, error: "L'ospite non ha un'email." };
  const checkinUrl = `${appUrl()}/checkin?b=${encodeURIComponent(b.id)}`;
  try {
    const res = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "voucher", booking: bk, checkinUrl, pdfBase64: pdf?.pdfBase64, pdfFilename: pdf?.pdfFilename }) });
    const j = await res.json().catch(() => ({}));
    return res.ok && j?.ok ? { ok: true } : { ok: false, error: j?.error || `Errore ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rete non disponibile" };
  }
}

// Notifica al gestore che un ospite ha completato il check-in online.
export async function sendCheckinNotice(
  b: Booking,
  d: Deps,
  guests: { firstName?: string; lastName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docType?: string; docNumber?: string; docPlace?: string }[],
  arrival?: string,
): Promise<{ ok: boolean; error?: string }> {
  const bk = payload(b, d);
  const operatorEmail = bk.structureEmail;
  if (!operatorEmail) return { ok: false, error: "La struttura non ha un'email dove ricevere il check-in." };
  try {
    const res = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "checkin", booking: bk, guests, arrival, operatorEmail }) });
    const j = await res.json().catch(() => ({}));
    return res.ok && j?.ok ? { ok: true } : { ok: false, error: j?.error || `Errore ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rete non disponibile" };
  }
}
