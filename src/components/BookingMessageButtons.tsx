"use client";

// Pulsanti dei messaggi nella scheda di una prenotazione: UNO per ogni modello (Messaggi → Modelli) con la spunta «Mostra nella scheda della prenotazione».
// Un clic apre WhatsApp col messaggio già pronto per l'ospite (link wa.me): lo invii tu dal telefono, niente invii automatici e niente WhatsApp Business.
// I segnaposto ({ospite}, {struttura}, {checkin}, {link_checkin}…) si riempiono con i dati di questa prenotazione, nella lingua dell'ospite.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { buildGroupGuestLink, buildGuestLink, shortenLink } from "@/lib/guestlink";
import { asLang, fillTokens, guestFallback, stayTimeText, structureFallback } from "@/lib/auto-messages-core";
import { messageBalance } from "@/lib/msg-balance";
import { REVIEW_SETTINGS_KEY, parseReviewSettings, reviewLinksFor, reviewTokens } from "@/lib/auto-review";
import { structureWhatsapp, WHATSAPP_FALLBACK } from "@/lib/auto-guide-link";
import { guestLangOf } from "@/lib/guest-lang";
import { waDigits } from "@/lib/contacts-check";
import { recordOutgoing } from "@/lib/guest-messages";
import type { Booking, Guest, Structure } from "@/lib/types";

const TPL_KEY = "spigolestay:msgtemplates";
type Tpl = { id: string; name: string; texts: Record<string, string>; showInBooking?: boolean; structureIds?: string[] };

/** Modelli con la spunta, validi per la struttura di questa prenotazione. Si rileggono quando cambia il salvataggio o si torna sulla pagina. */
function useBookingTemplates(structureId: string): Tpl[] {
  const [all, setAll] = useState<Tpl[]>([]);
  const read = useCallback(() => {
    try { const p = JSON.parse(localStorage.getItem(TPL_KEY) || "[]"); setAll(Array.isArray(p) ? (p as Tpl[]) : []); } catch { setAll([]); }
  }, []);
  useEffect(() => {
    read();
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("focus", read); };
  }, [read]);
  return useMemo(() => all.filter((t) => t.showInBooking && t.name && (!t.structureIds?.length || t.structureIds.includes(structureId))), [all, structureId]);
}

export default function BookingMessageButtons({ booking, guest: guestProp, structure: structureProp, className = "" }: { booking: Booking; guest?: Guest; structure?: Structure; className?: string }) {
  const { bookings, getUnit, getRoomType, getGuest, getStructure } = useData();
  const guest = guestProp ?? getGuest(booking.guestId);
  const structure = structureProp ?? getStructure(booking.structureId);
  const templates = useBookingTemplates(booking.structureId);
  const [note, setNote] = useState("");
  if (!templates.length) return null;

  const digits = waDigits(guest?.phone, guest?.country);
  const lang = asLang(guestLangOf(guest));

  const fill = async (raw: string): Promise<string> => {
    const unit = getUnit(booking.unitId);
    const emptyStructure = !(structure?.name ?? "").trim();
    const groupBk = booking.groupId ? bookings.filter((x) => x.groupId === booking.groupId) : [booking];
    const guideRaw = groupBk.length > 1
      ? buildGroupGuestLink({ structureId: booking.structureId, guestName: guest?.fullName || "", lang, rooms: groupBk.map((bb) => ({ unitId: bb.unitId, unitCode: getUnit(bb.unitId)?.code || getUnit(bb.unitId)?.name || "", parking: !!bb.parking })) })
      : buildGuestLink({ structureId: booking.structureId, unitId: booking.unitId, unitCode: unit?.code || unit?.name || "", guestName: guest?.fullName || "", parking: !!booking.parking, lang });
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    let reviewSettingsRaw: string | null = null; try { reviewSettingsRaw = localStorage.getItem(REVIEW_SETTINGS_KEY); } catch { /* storage non disponibile */ }
    let guideReviewUrl = ""; try { guideReviewUrl = JSON.parse(localStorage.getItem("spigolestay:guides") || "{}")?.[booking.structureId]?.reviewUrl || ""; } catch { /* nessuna guida */ }
    const nights = Math.max(1, Math.round((Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86400000));
    const ctx: Record<string, string> = {
      ospite: (guest?.firstName || guest?.fullName || "").split(" ")[0] || guestFallback(lang),
      struttura: emptyStructure ? structureFallback(lang) : (structure?.name ?? ""),
      camera: unit?.name ?? getRoomType(booking.roomTypeId)?.name ?? "",
      checkin: stayTimeText("checkin", lang, booking.checkIn, structure?.checkInFrom),
      checkout: stayTimeText("checkout", lang, booking.checkOut, structure?.checkOutBy),
      codice_accesso: unit?.accessInfo || structure?.accessInfo || "",
      saldo: eur(messageBalance(booking, structure)),
      notti: String(nights),
      link_guida: /\{link_guida\}/i.test(raw) ? await shortenLink(guideRaw) : guideRaw,
      link_checkin: /\{link_checkin\}/i.test(raw) ? await shortenLink(`${origin}/checkin?b=${encodeURIComponent(booking.id)}`) : `${origin}/checkin?b=${encodeURIComponent(booking.id)}`,
      whatsapp: structureWhatsapp(structure ?? {}) || WHATSAPP_FALLBACK[lang] || WHATSAPP_FALLBACK.it,
      ...reviewTokens(reviewLinksFor({ structureId: booking.structureId, placeId: structure?.googlePlaceId, guideReviewUrl, settings: parseReviewSettings(reviewSettingsRaw) })),
    };
    return fillTokens(raw, ctx, { lang, emptyStructure });
  };

  const send = async (tpl: Tpl) => {
    if (!digits) return;
    setNote("");
    const raw = tpl.texts[lang] || tpl.texts.it || Object.values(tpl.texts).find((x) => x?.trim()) || "";
    if (!raw.trim()) { setNote("Il modello è vuoto."); return; }
    const text = await fill(raw);
    if (guest) recordOutgoing(guest.id, text, "WhatsApp (link)", undefined, { bid: booking.id, rem: `tpl:${tpl.id}` });
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} onClick={(e) => e.stopPropagation()}>
      {templates.map((tpl) => (
        <button
          key={tpl.id} type="button" disabled={!digits} onClick={() => void send(tpl)}
          title={digits ? `Apri WhatsApp con «${tpl.name}»` : "Manca il numero di telefono dell'ospite: scrivilo nella prenotazione"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-txt transition hover:border-focus hover:text-focus disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span aria-hidden>💬</span>{tpl.name}
        </button>
      ))}
      {!digits && <span className="text-[11px] text-faint">Manca il telefono dell&apos;ospite</span>}
      {note && <span className="text-[11px] font-semibold" style={{ color: "var(--err)" }}>{note}</span>}
    </div>
  );
}
