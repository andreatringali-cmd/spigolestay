import type { SupabaseClient } from "@supabase/supabase-js";
import type { Structure } from "@/lib/types";
import { getConciergeReply } from "@/lib/ai/guest-concierge";
import { accessCodeOf, kbLang, renderEntry, resolveEntries, toFaqItems, selectRelevant, SENSITIVE_CATEGORIES, type ConciergeEntry } from "@/lib/concierge-kb";

// Motore unico del Concierge (solo server): lo usano sia il webhook WhatsApp sia la casella "Prova" di Xenora,
// così le due strade danno la STESSA risposta. Unisce la base di conoscenza (concierge_entries: condiviso + struttura),
// compila le voci AUTO dalla prenotazione dell'ospite e chiede all'AI di rispondere solo se ha i dati.

interface StLite { id: string; name?: string; address?: string; checkInFrom?: string; checkInTo?: string; checkOutBy?: string; accessInfo?: string; services?: string[] }
interface UnitLite { id: string; accessInfo?: string }
interface RoomTypeLite { id: string; amenities?: string[] }
export interface BookingLite { id: string; structureId: string; unitId: string | null; roomTypeId: string; guestId: string; checkIn: string; checkOut: string; adults?: number; total?: number; cityTaxExempt?: boolean; parking?: boolean; status?: string; channel?: string }

const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const todayISO = () => new Date().toISOString().slice(0, 10);

// Prenotazione "in corso o futura" di un ospite (la più vicina); altrimenti nessuna.
export function activeBookingOf(bookings: BookingLite[], guestId: string): BookingLite | undefined {
  const oggi = todayISO();
  return bookings
    .filter((b) => b.guestId === guestId && b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" && (b.checkOut || "") >= oggi)
    .sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1))[0];
}

// Struttura di riferimento: prenotazione dell'ospite (in corso, altrimenti l'ultima), poi struttura unica, poi quella predefinita.
export function resolveStructureId(structures: StLite[], bookings: BookingLite[], guestId: string | undefined, defaultStructureId?: string): string {
  if (guestId) {
    const b = activeBookingOf(bookings, guestId)
      ?? bookings.filter((x) => x.guestId === guestId && x.status !== "cancelled").sort((a, c) => (a.checkIn < c.checkIn ? 1 : -1))[0];
    if (b && structures.some((s) => s.id === b.structureId)) return b.structureId;
  }
  if (structures.length === 1) return structures[0].id;
  if (defaultStructureId && structures.some((s) => s.id === defaultStructureId)) return defaultStructureId;
  return "";
}

export interface EngineInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>;
  tenantId: string;
  data: { structures?: unknown; bookings?: unknown; units?: unknown; roomTypes?: unknown };
  roomAccessRaw?: string;
  conciergeFaqRaw?: Record<string, string>; // vecchia FAQ locale (usata solo se la tabella è vuota)
  structureId: string;
  bookingId?: string;                       // prova dalla UI: prenotazione scelta a mano
  assumeVerified?: boolean;                 // prova dalla UI: tratta l'interlocutore come ospite con prenotazione in corso
  guest?: { id?: string; language?: string };
  guestName?: string;
  message: string;
  transcript?: string;
}
export interface EngineResult { answered: boolean; reply?: string; topic?: string; reason?: string; hasBooking: boolean; lang: "it" | "en" }

export async function conciergeAnswer(inp: EngineInput): Promise<EngineResult> {
  const structures = arr<StLite>(inp.data.structures);
  const bookings = arr<BookingLite>(inp.data.bookings);
  const units = arr<UnitLite>(inp.data.units);
  const roomTypes = arr<RoomTypeLite>(inp.data.roomTypes);
  const st = structures.find((s) => s.id === inp.structureId);
  const lang = kbLang(inp.guest?.language, inp.message);
  if (!st) return { answered: false, reason: "nessuna struttura di riferimento", hasBooking: false, lang };

  const oggi = todayISO();
  const bk = inp.bookingId
    ? bookings.find((b) => b.id === inp.bookingId)
    : inp.guest?.id ? activeBookingOf(bookings, inp.guest.id) : undefined;
  const hasBooking = (!!bk && bk.status !== "cancelled" && (bk.checkOut || "") >= oggi) || !!inp.assumeVerified;
  const unit = bk ? units.find((u) => u.id === bk.unitId) : undefined;
  const roomType = bk ? roomTypes.find((r) => r.id === bk.roomTypeId) : undefined;
  const accessInfo = hasBooking ? ([unit?.accessInfo, st.accessInfo].filter(Boolean).join(" · ") || undefined) : undefined;
  const hasParking = (st.services ?? []).some((s) => /parcheggi/i.test(s)) || (roomType?.amenities ?? []).some((a) => /parcheggi/i.test(a)) || undefined;

  // Base di conoscenza: tabella concierge_entries (condiviso + struttura, con override e voci AUTO dalla prenotazione).
  let faq: { topic: string; answer: string }[] = [];
  let entries: ConciergeEntry[] = [];
  try {
    const { data } = await inp.admin.from("concierge_entries").select("*").eq("tenant_id", inp.tenantId);
    entries = (data ?? []) as ConciergeEntry[];
  } catch { entries = []; }

  if (entries.length) {
    const accessCode = bk && hasBooking ? accessCodeOf(inp.roomAccessRaw, bk.unitId, !!bk.parking) : "";
    const resolved = resolveEntries(entries, inp.structureId, lang)
      // Chi non ha una prenotazione in corso non riceve mai Wi-Fi, codici o istruzioni d'accesso.
      .filter((e) => hasBooking || !(SENSITIVE_CATEGORIES.has(e.category) || e.auto_source === "access_code"));
    const rendered = resolved.map((e) => renderEntry(e, { structure: st as unknown as Structure, booking: bk && bk.status !== "cancelled" ? bk : undefined, accessCode }, lang));
    faq = toFaqItems(rendered, lang).map((f) => ({ topic: f.topic.slice(0, 80), answer: f.answer.slice(0, 1800) })).slice(0, 80);
  } else {
    // Ripiego: vecchia FAQ salvata nel browser (Messaggi → Concierge), senza i segnaposto "chiedi al gestore".
    try {
      const raw = inp.conciergeFaqRaw?.["spigolestay:concierge:" + st.id] ?? inp.conciergeFaqRaw?.["spigolestay:concierge"];
      const list = raw ? (JSON.parse(raw) as { topic?: string; answer?: string }[]) : [];
      faq = list
        .filter((f) => f?.topic && f?.answer && !/chiedi (pure )?al gestore|da concordare con il gestore|modificabile qui|giro la tua domanda/i.test(f.answer))
        .filter((f) => hasBooking || !(/wi-?fi|password|codice|accesso|chiavi|pulsantiera/i.test(f.topic ?? "") || /password/i.test(f.answer ?? "")))
        .map((f) => ({ topic: String(f.topic).slice(0, 80), answer: String(f.answer).slice(0, 1800) })).slice(0, 40);
    } catch { faq = []; }
  }

  const outcome = await getConciergeReply({
    faq: selectRelevant(faq, inp.message), hasBooking, guestName: inp.guestName, lang,
    structureName: st.name, address: st.address, checkInFrom: st.checkInFrom, checkInTo: st.checkInTo, checkOutBy: st.checkOutBy,
    accessInfo, hasParking, transcript: inp.transcript, lastGuestMessage: inp.message,
  });
  if (!outcome.ok) return { answered: false, reason: outcome.error === "ai_not_configured" ? "AI non configurata (manca ANTHROPIC_API_KEY)" : `errore AI (${outcome.error})`, hasBooking, lang };
  if (!outcome.result.canAnswer || !outcome.result.reply) return { answered: false, topic: outcome.result.topic, reason: "domanda non coperta dalle informazioni disponibili o non di routine", hasBooking, lang };
  return { answered: true, reply: outcome.result.reply, topic: outcome.result.topic, hasBooking, lang };
}
