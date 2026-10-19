"use client";

// Pulsanti dei messaggi nella scheda di una prenotazione: UNO per ogni modello (Messaggi → Modelli) con la spunta «Mostra nella scheda della prenotazione».
// Un clic apre WhatsApp col messaggio già pronto per l'ospite (link wa.me): lo invii tu dal telefono, niente invii automatici e niente WhatsApp Business.
// I segnaposto ({ospite}, {struttura}, {checkin}, {link_checkin}…) si riempiono con i dati di questa prenotazione, nella lingua dell'ospite.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { asLang } from "@/lib/auto-messages-core";
import { fillTemplateForBooking } from "@/lib/template-fill";
import { guestLangOf } from "@/lib/guest-lang";
import { waDigits } from "@/lib/contacts-check";
import { recordOutgoing } from "@/lib/guest-messages";
import type { Booking, Guest, Structure } from "@/lib/types";

const TPL_KEY = "spigolestay:msgtemplates";
type Tpl = { id: string; name: string; texts: Record<string, string>; showInBooking?: boolean; srcId?: string; structureIds?: string[] };

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
  return useMemo(() => all.filter((t) => t.showInBooking && !t.srcId && t.name && // i modelli collegati ai passaggi obbligatori (srcId) sono già i pulsanti del percorso: qui solo quelli aggiunti dal titolare
     (!t.structureIds?.length || t.structureIds.includes(structureId))), [all, structureId]);
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

  const fill = (raw: string) => fillTemplateForBooking(raw, booking, guest, structure, { bookings, getUnit, getRoomType });

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
