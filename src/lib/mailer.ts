import type { Booking, Structure, Guest, RoomType, Unit } from "./types";
import { bookingCode } from "./bookingCode";
import { nights } from "./dates";
import { cityTaxOfBooking, cityTaxOfGroup, groupRowBalances, bookingExtrasTotal } from "./booking";
import { balanceDue } from "./incassi";
import { plural } from "./plural";

// Origine dell'app: nel browser quella corrente; altrimenti il dominio ufficiale (xenora.it, non il vecchio *.vercel.app).
const appUrl = () => (typeof window !== "undefined" ? window.location.origin : "https://xenora.it");

interface Deps {
  getStructure: (id: string) => Structure | undefined;
  getGuest: (id: string) => Guest | undefined;
  getRoomType: (id: string) => RoomType | undefined;
  getUnit: (id: string | null) => Unit | undefined;
}

const STATUS_LABEL: Record<string, string> = { confirmed: "Confermata", tentative: "In attesa di conferma", cancelled: "Annullata", no_show: "No-show" };
const round2 = (n: number) => Math.round(n * 100) / 100;

// Costruisce il link a Google Maps dell'indirizzo struttura (usato nel piè di pagina email, come
// fa Octorate): niente coordinate salvate, basta l'indirizzo testuale.
function mapsUrl(address?: string): string | undefined {
  if (!address || !address.trim()) return undefined;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address).replace(/'/g, "%27")}`; // encodeURIComponent lascia l'apostrofo ("Via dell'Arsenale"): safeHttpUrl lo scarterebbe e il link sparirebbe
}

// Testo delle condizioni di cancellazione (stessa logica di lib/rate-plans.ts cancelText, ma senza
// dipendere dal tipo RatePlan: qui basta refundable/cancelDays già presenti sulla prenotazione).
// Se la condizione NON è nota (refundable non definito: es. prenotazioni manuali/OTA) non si scrive nulla — mai "non rimborsabile" a caso.
export function cancelPolicyText(refundable?: boolean, cancelDays?: number): string | undefined {
  if (refundable === undefined) return undefined;
  if (!refundable) return "La prenotazione non è rimborsabile.";
  if (cancelDays && cancelDays > 0) return `Cancellazione gratuita fino a ${plural(cancelDays, "giorno", "giorni")} prima dell'arrivo. Oltre questo termine è dovuto l'intero importo della prenotazione.`;
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
  parts.push("La tassa di soggiorno non è inclusa nel totale della prenotazione e sarà pagata in base alle politiche di pagamento definite dalla struttura.");
  return parts.join(" ");
}

/**
 * Dati del voucher. `group` = tutte le camere della stessa prenotazione di gruppo (stessa struttura): un solo voucher che le elenca, con
 * totale e saldo dell'insieme. I totali usano gli stessi calcoli dell'elenco Prenotazioni: camere + extra + PULIZIA (bookingTotal), tassa di
 * soggiorno separata (cityTaxOfBooking / cityTaxOfGroup), residuo = balanceDue (tiene conto della tassa già incassata a parte).
 */
function payload(b: Booking, d: Deps, group?: Booking[]) {
  const rows = group && group.length > 1 ? group : [b];
  const isGroup = rows.length > 1;
  const s = d.getStructure(b.structureId);
  const g = d.getGuest(b.guestId);
  const rt = d.getRoomType(b.roomTypeId);
  const u = d.getUnit(b.unitId);
  const n = nights(b.checkIn, b.checkOut);
  const roomTotal = round2(rows.reduce((a, r) => a + (r.total ?? 0), 0));
  const extras = rows.flatMap((r) => (r.extras ?? []).map((e) => ({ name: e.name, price: e.price })));
  const extrasTotal = round2(rows.reduce((a, r) => a + bookingExtrasTotal(r), 0));
  const cleaningFee = round2(rows.reduce((a, r) => a + (r.cleaningFee ?? 0), 0));
  const bookingTotal = round2(roomTotal + extrasTotal + cleaningFee);
  const cityTax = round2(isGroup ? cityTaxOfGroup(s, rows) : cityTaxOfBooking(s, b));
  const grandTotal = round2(bookingTotal + cityTax);
  const paid = round2(rows.reduce((a, r) => a + (r.paid ?? 0), 0));
  const due = isGroup
    ? round2(groupRowBalances(s, rows).reduce((a, r) => a + r.balance, 0))
    : round2(balanceDue(b, s));
  const address = s ? [s.address, s.streetNumber, s.city].filter(Boolean).join(" ") : undefined;
  return {
    bookingId: b.id,
    code: bookingCode(b),
    status: STATUS_LABEL[b.status] || b.status,
    statusKey: b.status,
    structureName: s?.name,
    structureEmail: s?.email,
    guestName: g?.fullName,
    guestFirstName: g?.firstName,
    guestEmail: g?.email,
    // Per scegliere la lingua dell'email (scheda ospite → Paese → prefisso del telefono), vedi lib/email-i18n.ts
    guestPhone: g?.phone,
    guestCountry: g?.country,
    guestLanguage: g?.language,
    roomType: rt?.name,
    unitName: u?.name,
    // Gruppo: una riga per camera (la mail e il PDF le elencano); camera singola: nessun elenco.
    rooms: isGroup ? rows.map((r) => ({ roomType: d.getRoomType(r.roomTypeId)?.name, unitName: d.getUnit(r.unitId)?.name, adults: r.adults, children: r.children, total: r.total ?? 0 })) : undefined,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: n,
    adults: isGroup ? rows.reduce((a, r) => a + (r.adults ?? 0), 0) : b.adults,
    children: isGroup ? rows.reduce((a, r) => a + (r.children ?? 0), 0) : b.children,
    total: roomTotal,
    extras,
    extrasTotal,
    cleaningFee,
    bookingTotal,
    cityTaxAmount: cityTax,
    cityTaxRuleText: cityTaxRuleText(s, cityTax),
    cityTaxRule: s?.cityTax && cityTax > 0 ? { mode: s.cityTaxMode, percent: s.cityTaxPercent, cap: s.cityTaxCap, amount: s.cityTaxAmount, childFreeUnder: s.cityTaxChildFreeUnder } : undefined, // stessi dati del testo, per ricomporlo nella lingua dell'ospite
    grandTotal,
    paid,
    due,
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

async function postVoucher(primary: Booking, bk: VoucherPayload, pdf?: { pdfBase64?: string; pdfFilename?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!bk.guestEmail) return { ok: false, error: "L'ospite non ha un'email." };
  const checkinUrl = `${appUrl()}/checkin?b=${encodeURIComponent(primary.id)}`;
  try {
    const res = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "voucher", booking: bk, checkinUrl, pdfBase64: pdf?.pdfBase64, pdfFilename: pdf?.pdfFilename }) });
    const j = await res.json().catch(() => ({}));
    return res.ok && j?.ok ? { ok: true } : { ok: false, error: j?.error || `Errore ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rete non disponibile" };
  }
}

// Invia il voucher/conferma all'ospite. pdfBase64/pdfFilename: se il chiamante ha già catturato
// l'anteprima reale (VoucherDoc via html2canvas, vedi BookingDrawer), li allega così com'è; se
// mancano, il server ripiega sul disegno pdf-lib (fallback per invii automatici senza browser,
// es. dopo una prenotazione pubblica). Ritorna {ok, error?}.
export async function sendVoucher(b: Booking, d: Deps, pdf?: { pdfBase64?: string; pdfFilename?: string }): Promise<{ ok: boolean; error?: string }> {
  return postVoucher(b, payload(b, d), pdf);
}

/**
 * Voucher per una prenotazione di GRUPPO (più camere prenotate insieme): UNA email per struttura, con tutte le camere di quella struttura,
 * il totale e il saldo dell'insieme. Se le camere stanno in strutture diverse le email sono separate, ognuna con i dati (logo, nome, contatti,
 * regole di cancellazione e tassa) della propria struttura. Il PDF allegato è sempre quello del server (elenca tutte le camere): l'anteprima
 * catturata dal browser mostra una sola camera.
 */
export async function sendVoucherGroup(bookings: Booking[], d: Deps): Promise<{ ok: boolean; error?: string }> {
  const live = bookings.filter((x) => x.status !== "cancelled");
  if (!live.length) return { ok: false, error: "Nessuna prenotazione da inviare." };
  const byStructure = new Map<string, Booking[]>();
  for (const x of live) byStructure.set(x.structureId, [...(byStructure.get(x.structureId) ?? []), x]);
  const errors: string[] = [];
  for (const part of byStructure.values()) {
    const r = await postVoucher(part[0], payload(part[0], d, part));
    if (!r.ok && r.error) errors.push(r.error);
  }
  return errors.length ? { ok: false, error: errors[0] } : { ok: true };
}

// Notifica al gestore che un ospite ha completato il check-in online.
// L'email riporta solo nomi, numero di ospiti e link alla scheda: i documenti restano nella scheda (vedi checkinOwnerEmailHtml).
export async function sendCheckinNotice(
  b: Booking,
  d: Deps,
  guests: { firstName?: string; lastName?: string; sex?: string; birthDate?: string; birthPlace?: string; citizenship?: string; docType?: string; docNumber?: string; docPlace?: string }[],
  arrival?: string,
): Promise<{ ok: boolean; error?: string }> {
  const bk = payload(b, d);
  const operatorEmail = bk.structureEmail;
  if (!operatorEmail) return { ok: false, error: "La struttura non ha un'email dove ricevere il check-in." };
  // Si inviano al server solo i nomi: niente numeri di documento né date/luoghi di nascita nella richiesta.
  const names = guests.map((g) => ({ firstName: g.firstName, lastName: g.lastName }));
  try {
    const res = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "checkin", booking: bk, guests: names, arrival, operatorEmail, ctaUrl: `${appUrl()}/prenotazioni?b=${encodeURIComponent(b.id)}` }) });
    const j = await res.json().catch(() => ({}));
    return res.ok && j?.ok ? { ok: true } : { ok: false, error: j?.error || `Errore ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rete non disponibile" };
  }
}
