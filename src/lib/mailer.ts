import type { Booking, Structure, Guest, RoomType, Unit } from "./types";
import { bookingCode } from "./bookingCode";
import { nights } from "./dates";

const appUrl = () => (typeof window !== "undefined" ? window.location.origin : "https://xenora-app.vercel.app");

interface Deps {
  getStructure: (id: string) => Structure | undefined;
  getGuest: (id: string) => Guest | undefined;
  getRoomType: (id: string) => RoomType | undefined;
  getUnit: (id: string | null) => Unit | undefined;
}

function payload(b: Booking, d: Deps) {
  const s = d.getStructure(b.structureId);
  const g = d.getGuest(b.guestId);
  const rt = d.getRoomType(b.roomTypeId);
  const u = d.getUnit(b.unitId);
  return {
    code: bookingCode(b),
    structureName: s?.name,
    structureEmail: s?.email,
    guestName: g?.fullName,
    guestEmail: g?.email,
    roomType: rt?.name,
    unitName: u?.name,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: nights(b.checkIn, b.checkOut),
    adults: b.adults,
    children: b.children,
    total: b.total,
    currency: s?.currency || "€",
    checkInFrom: s?.checkInFrom,
    checkOutBy: s?.checkOutBy,
    address: s ? [s.address, s.streetNumber, s.city].filter(Boolean).join(" ") : undefined,
    phone: s?.phone,
    color: s?.photoColor,
    logo: s?.logo,
    website: s?.website,
    cin: s?.cin,
    vat: s?.vat,
  };
}

// Invia il voucher/conferma all'ospite. Ritorna {ok, error?}.
export async function sendVoucher(b: Booking, d: Deps): Promise<{ ok: boolean; error?: string }> {
  const bk = payload(b, d);
  if (!bk.guestEmail) return { ok: false, error: "L'ospite non ha un'email." };
  const checkinUrl = `${appUrl()}/checkin?b=${encodeURIComponent(b.id)}`;
  try {
    const res = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "voucher", booking: bk, checkinUrl }) });
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
