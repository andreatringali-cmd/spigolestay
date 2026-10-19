// Riempie un modello di messaggio (Messaggi → Modelli) con i dati di UNA prenotazione: stessi segnaposto del resto dell'app ({ospite}, {struttura},
// {checkin}, {link_checkin}, {link_guida}, {saldo}, {link_recensioni}…), nella lingua dell'ospite. Solo browser (legge i link e le impostazioni dal localStorage).
import { eur } from "./format";
import { buildGroupGuestLink, buildGuestLink, shortenLink } from "./guestlink";
import { asLang, fillTokens, guestFallback, stayTimeText, structureFallback } from "./auto-messages-core";
import { messageBalance } from "./msg-balance";
import { REVIEW_SETTINGS_KEY, parseReviewSettings, reviewLinksFor, reviewTokens } from "./auto-review";
import { structureWhatsapp, WHATSAPP_FALLBACK } from "./auto-guide-link";
import { guestLangOf } from "./guest-lang";
import type { Booking, Guest, RoomType, Structure, Unit } from "./types";

export const TEMPLATES_KEY = "spigolestay:msgtemplates";
export type StoredTemplate = { id: string; name: string; texts: Record<string, string>; showInBooking?: boolean; srcId?: string; structureIds?: string[] };

export function readTemplates(): StoredTemplate[] {
  try { const p = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]"); return Array.isArray(p) ? (p as StoredTemplate[]) : []; } catch { return []; }
}

/** Modello collegato a un passaggio obbligatorio della prenotazione (selfcheckin, guida, checkout, recensione), valido per la struttura; null se non c'è o è vuoto. */
export function linkedTemplate(srcId: string, structureId: string): StoredTemplate | null {
  const t = readTemplates().find((x) => x.srcId === srcId && (!x.structureIds?.length || x.structureIds.includes(structureId)) && Object.values(x.texts ?? {}).some((v) => v?.trim()));
  return t ?? null;
}

/** Testo del modello nella lingua dell'ospite (ripiego: italiano, poi la prima lingua scritta). */
export function templateRawFor(tpl: StoredTemplate, guest?: Guest): string {
  const lang = asLang(guestLangOf(guest));
  return tpl.texts[lang]?.trim() ? tpl.texts[lang] : tpl.texts.it?.trim() ? tpl.texts.it : Object.values(tpl.texts).find((x) => x?.trim()) ?? "";
}

export interface FillDeps {
  bookings: Booking[];
  getUnit: (id: string | null) => Unit | undefined;
  getRoomType: (id: string) => RoomType | undefined;
}

const origin = () => (typeof window !== "undefined" ? window.location.origin : "");
const checkinUrl = (b: Booking) => `${origin()}/checkin?b=${encodeURIComponent(b.id)}`;

function guideUrl(booking: Booking, guest: Guest | undefined, deps: FillDeps, lang: ReturnType<typeof asLang>): string {
  const unit = deps.getUnit(booking.unitId);
  const groupBk = booking.groupId ? deps.bookings.filter((x) => x.groupId === booking.groupId) : [booking];
  return groupBk.length > 1
    ? buildGroupGuestLink({ structureId: booking.structureId, guestName: guest?.fullName || "", lang, rooms: groupBk.map((bb) => ({ unitId: bb.unitId, unitCode: deps.getUnit(bb.unitId)?.code || deps.getUnit(bb.unitId)?.name || "", parking: !!bb.parking })) })
    : buildGuestLink({ structureId: booking.structureId, unitId: booking.unitId, unitCode: unit?.code || unit?.name || "", guestName: guest?.fullName || "", parking: !!booking.parking, lang });
}

/** Come fillTemplateForBooking ma SENZA rete: i link restano lunghi, salvo quelli già accorciati passati in `short`. Per i punti dove serve subito il testo. */
export function fillTemplateNow(raw: string, booking: Booking, guest: Guest | undefined, structure: Structure | undefined, deps: FillDeps, short?: { guida?: string; checkin?: string }, extra?: Record<string, string>): string {
  const lang = asLang(guestLangOf(guest));
  const unit = deps.getUnit(booking.unitId);
  const emptyStructure = !(structure?.name ?? "").trim();
  let reviewSettingsRaw: string | null = null; try { reviewSettingsRaw = localStorage.getItem(REVIEW_SETTINGS_KEY); } catch { /* storage non disponibile */ }
  let guideReviewUrl = ""; try { guideReviewUrl = JSON.parse(localStorage.getItem("spigolestay:guides") || "{}")?.[booking.structureId]?.reviewUrl || ""; } catch { /* nessuna guida */ }
  const nights = Math.max(1, Math.round((Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86400000));
  const ctx: Record<string, string> = {
    ospite: (guest?.firstName || guest?.fullName || "").split(" ")[0] || guestFallback(lang),
    struttura: emptyStructure ? structureFallback(lang) : (structure?.name ?? ""),
    camera: unit?.name ?? deps.getRoomType(booking.roomTypeId)?.name ?? "",
    checkin: stayTimeText("checkin", lang, booking.checkIn, structure?.checkInFrom),
    checkout: stayTimeText("checkout", lang, booking.checkOut, structure?.checkOutBy),
    codice_accesso: unit?.accessInfo || structure?.accessInfo || "",
    saldo: eur(messageBalance(booking, structure)),
    notti: String(nights),
    link_guida: short?.guida ?? guideUrl(booking, guest, deps, lang),
    link_checkin: short?.checkin ?? checkinUrl(booking),
    whatsapp: structureWhatsapp(structure ?? {}) || WHATSAPP_FALLBACK[lang] || WHATSAPP_FALLBACK.it,
    ...reviewTokens(reviewLinksFor({ structureId: booking.structureId, placeId: structure?.googlePlaceId, guideReviewUrl, settings: parseReviewSettings(reviewSettingsRaw) })),
    ...(extra ?? {}), // es. {importo} e {link_pagamento} dei messaggi di pagamento
  };
  return fillTokens(raw, ctx, { lang, emptyStructure });
}

/** Versione completa: i link lunghi (guida con codici, check-in) vengono accorciati solo se il testo li usa. */
export async function fillTemplateForBooking(raw: string, booking: Booking, guest: Guest | undefined, structure: Structure | undefined, deps: FillDeps, extra?: Record<string, string>): Promise<string> {
  const lang = asLang(guestLangOf(guest));
  const short: { guida?: string; checkin?: string } = {};
  if (/\{link_checkin\}/i.test(raw)) short.checkin = await shortenLink(checkinUrl(booking));
  if (/\{link_guida\}/i.test(raw)) short.guida = await shortenLink(guideUrl(booking, guest, deps, lang));
  return fillTemplateNow(raw, booking, guest, structure, deps, short, extra);
}
