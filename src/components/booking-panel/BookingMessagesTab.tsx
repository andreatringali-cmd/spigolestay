"use client";

// Scheda «Messaggi» della prenotazione.
//  · Prenotazioni delle OTA (extId «channex:<id>»): la chat con l'ospite sul portale, letta e scritta su Channex (OtaThreadChat).
//  · Tutte le altre (dirette, manuali, Octorate): nessuna chat qui, solo il rimando alla pagina «Messaggi» (WhatsApp ed email).
import { useEffect, useState } from "react";
import OtaThreadChat from "@/components/booking-panel/OtaThreadChat";
import { useLang } from "@/lib/i18n";
import { useData } from "@/lib/store";
import { apiPost } from "@/lib/invoicing/client";
import { friendlyError } from "@/lib/friendly-error";
import { CHANNELS, type Booking } from "@/lib/types";
import type { OtaThread } from "@/lib/channex-threads";

const CHANNEX_PREFIX = "channex:";


/** Id prenotazione Channex dalla prenotazione di Xenora; "" se non arriva da Channex. */
export const channexBookingId = (b: Pick<Booking, "extId">): string => (b.extId?.startsWith(CHANNEX_PREFIX) ? b.extId.slice(CHANNEX_PREFIX.length).trim() : "");

const note = "rounded-lg border border-line bg-wash/50 px-3 py-2.5 text-[13px] text-dim";
const warnBox = "rounded-lg border px-3 py-2 text-xs";

export default function BookingMessagesTab({ booking }: { booking: Booking }) {
  const cid = channexBookingId(booking);
  return cid ? <OtaMessages booking={booking} channexId={cid} /> : <NotOta booking={booking} />;
}

// ───────────────────────── Prenotazioni OTA ─────────────────────────
function OtaMessages({ booking, channexId }: { booking: Booking; channexId: string }) {
  const { t } = useLang();
  const { guests } = useData();
  const [thread, setThread] = useState<OtaThread | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error" | "notInstalled">("loading");
  const [err, setErr] = useState("");
  const [tries, setTries] = useState(0);
  const guest = guests.find((g) => g.id === booking.guestId);
  const portal = CHANNELS[booking.channel]?.label || t("il portale");

  useEffect(() => {
    let alive = true;
    setState("loading"); setThread(null); setErr("");
    apiPost<{ ok?: boolean; thread?: OtaThread | null; error?: string; notInstalled?: boolean }>("channex/threads", { action: "for_booking", bookingId: channexId })
      .then((r) => {
        if (!alive) return;
        if (r.ok === false) {
          // 403/404 di Channex = app «Messages» non attiva su quella struttura.
          if (r.notInstalled || /messages application|not have installed|not installed|forbidden/i.test(r.error || "")) { setState("notInstalled"); return; }
          setErr(friendlyError(r.error, t("Non riesco a leggere la conversazione."))); setState("error"); return;
        }
        setThread(r.thread ?? null); setState("ok");
      })
      .catch((e) => { if (alive) { setErr(friendlyError(e, t("Non riesco a leggere la conversazione."))); setState("error"); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channexId, tries]);

  if (state === "loading") return <p className="py-6 text-center text-sm text-dim">{t("Caricamento…")}</p>;
  if (state === "notInstalled") return <p className={warnBox} style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>{t("L'app «Messages» non è installata su Channex per questa struttura: attivala dalla dashboard di Channex (Applications) e riprova.")}</p>;
  if (state === "error") return (
    <div className={warnBox} style={{ borderColor: "var(--err)", color: "var(--err)" }}>
      {err}
      <button type="button" onClick={() => setTries((n) => n + 1)} className="ml-2 font-semibold underline">{t("Riprova")}</button>
    </div>
  );
  if (!thread) return <p className={note}>{t("Nessuna conversazione con l'ospite su")} {portal}. {t("Appena l'ospite o la struttura scrivono, i messaggi compaiono qui.")}</p>;
  return <OtaThreadChat thread={thread} guestName={guest?.fullName || thread.title || undefined} compact />;
}

// ───────────────────────── Prenotazioni dirette / manuali / Octorate ─────────────────────────
// La scheda è dedicata alla chat dei portali: per le altre prenotazioni i messaggi si mandano fuori da Xenora (WhatsApp, email) o con i pulsanti dei modelli.
function NotOta({ booking }: { booking: Booking }) {
  const { t } = useLang();
  const fromPortal = booking.channel !== "direct" && booking.channel !== "blocked";
  const portalName = (booking.otaName ?? "").trim() || CHANNELS[booking.channel]?.label || "";
  return (
    <div className="flex flex-col items-start gap-3 px-5 py-5">
      <p className="text-sm text-dim">
        {fromPortal
          ? `${t("Questa scheda mostra la chat con l'ospite di Booking.com, Airbnb ed Expedia.")} ${t("Per questa prenotazione")}${portalName ? ` (${portalName})` : ""} ${t("la chat del portale non è disponibile in Xenora: rispondi dall'extranet del portale. Per gli altri messaggi usa WhatsApp o email, fuori da Xenora, oppure i pulsanti dei modelli nella scheda.")}`
          : t("Questa scheda mostra la chat con l'ospite sui portali (Booking.com, Airbnb, Expedia). Questa prenotazione non arriva da un portale: i messaggi si mandano da WhatsApp o email, fuori da Xenora, oppure con i pulsanti dei modelli nella scheda.")}
      </p>
    </div>
  );
}
