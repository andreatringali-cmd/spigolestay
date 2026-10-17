"use client";

// Scheda «Messaggi» della prenotazione.
//  · Prenotazioni delle OTA (extId «channex:<id>»): la chat con l'ospite sul portale, letta e scritta su Channex (OtaThreadChat).
//  · Tutte le altre (dirette, manuali, Octorate): i messaggi già scambiati con l'ospite su WhatsApp/email, in sola lettura; si risponde da «Messaggi».
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import OtaThreadChat from "@/components/booking-panel/OtaThreadChat";
import { useLang } from "@/lib/i18n";
import { useData } from "@/lib/store";
import { apiPost } from "@/lib/invoicing/client";
import { friendlyError } from "@/lib/friendly-error";
import { fmtDateTime } from "@/lib/dates";
import { CHANNELS, type Booking } from "@/lib/types";
import type { OtaThread } from "@/lib/channex-threads";

const THREADS_KEY = "spigolestay:threads:v1"; // registro conversazioni per ospite (lo stesso di Messaggi → Conversazioni)
const CHANNEX_PREFIX = "channex:";
const MAX_SHOWN = 60;

interface LogMsg { id: string; dir: "out" | "in"; text: string; ts: number; via?: string; att?: { url: string; name?: string }[]; sys?: string }

/** Id prenotazione Channex dalla prenotazione di Xenora; "" se non arriva da Channex. */
export const channexBookingId = (b: Pick<Booking, "extId">): string => (b.extId?.startsWith(CHANNEX_PREFIX) ? b.extId.slice(CHANNEX_PREFIX.length).trim() : "");

const note = "rounded-lg border border-line bg-wash/50 px-3 py-2.5 text-[13px] text-dim";
const warnBox = "rounded-lg border px-3 py-2 text-xs";

export default function BookingMessagesTab({ booking }: { booking: Booking }) {
  const cid = channexBookingId(booking);
  return cid ? <OtaMessages booking={booking} channexId={cid} /> : <DirectMessages booking={booking} />;
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
function DirectMessages({ booking }: { booking: Booking }) {
  const { t } = useLang();
  const router = useRouter();
  const { guests, closeBooking } = useData();
  const guest = guests.find((g) => g.id === booking.guestId);
  const [all, setAll] = useState<Record<string, LogMsg[]> | null>(null);

  const read = useCallback(() => {
    try { const v = JSON.parse(localStorage.getItem(THREADS_KEY) || "{}"); setAll(v && typeof v === "object" ? v : {}); } catch { setAll({}); }
  }, []);
  useEffect(() => {
    read();
    // Messaggi in arrivo o inviati da Messaggi/webhook: il registro avvisa con questi eventi.
    const ev = ["spigolestay:threads", "spigolestay:datasync", "focus"];
    ev.forEach((e) => window.addEventListener(e, read));
    return () => ev.forEach((e) => window.removeEventListener(e, read));
  }, [read]);

  const msgs = useMemo(() => {
    const list = all?.[booking.guestId];
    return Array.isArray(list) ? list.filter((m) => m && typeof m.text === "string").slice(-MAX_SHOWN) : [];
  }, [all, booking.guestId]);
  const hidden = useMemo(() => { const list = all?.[booking.guestId]; return Array.isArray(list) ? Math.max(0, list.length - MAX_SHOWN) : 0; }, [all, booking.guestId]);

  const openChat = () => { closeBooking(); router.push(`/messaggi?guest=${encodeURIComponent(booking.guestId)}`); };
  const openBtn = <button type="button" onClick={openChat} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-focus hover:bg-wash">{t("Apri in Messaggi")} →</button>;

  if (all === null) return <p className="py-6 text-center text-sm text-dim">{t("Caricamento…")}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-dim">{t("Messaggi scambiati con")} {guest?.fullName || t("l'ospite")} {t("su WhatsApp ed email")}. {t("Per rispondere apri Messaggi.")}</p>
        <span className="shrink-0">{openBtn}</span>
      </div>
      {msgs.length === 0 ? (
        <p className={note}>{t("Nessun messaggio scambiato con questo ospite.")}</p>
      ) : (
        <div className="flex max-h-[46dvh] min-h-[160px] flex-col gap-2.5 overflow-y-auto rounded-xl border border-line bg-wash/40 p-3">
          {hidden > 0 && <p className="text-center text-[11px] text-faint">{hidden} {t("messaggi più vecchi non mostrati")}</p>}
          {msgs.map((m, i) => (
            <div key={m.id || i} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
              <div className={`flex max-w-[82%] flex-col ${m.dir === "out" ? "items-end" : "items-start"}`}>
                <div className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] ${m.dir === "out" ? "text-white" : "bg-surface text-txt"}`} style={m.dir === "out" ? { backgroundColor: "var(--focus)" } : { border: "1px solid var(--line)" }}>
                  {m.text}
                  {Array.isArray(m.att) && m.att.length > 0 && <div className="mt-1 flex flex-col gap-1">{m.att.map((a, j) => <a key={j} href={a.url} target="_blank" rel="noopener noreferrer" className="underline">📎 {a.name || t("Allegato")}</a>)}</div>}
                </div>
                <span className="mt-0.5 text-[10px] text-faint">{m.ts ? fmtDateTime(m.ts) : ""}{m.via ? ` · ${m.via}` : ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
