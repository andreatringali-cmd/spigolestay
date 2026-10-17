"use client";

// Scheda "Timeline" del pannello prenotazione: cronologia di tutto ciò che è successo a QUESTA prenotazione
// (arrivo, pagamenti, check-in, messaggi ed email inviati all'ospite, adempimenti, documenti), dalla più vecchia alla più recente.
// I dati arrivano da due parti: le tabelle del server (route /api/booking-timeline) e ciò che vive nel browser sincronizzato
// (registro attività, chat, registro invii). L'unione e le regole sono in lib/booking-timeline.ts.

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { apiPost } from "@/lib/invoicing/client";
import { buildTimeline, fmtEventAt, isDateOnly, type ServerEvent, type TimelineClient, type TimelineEvent, type TimelineTone } from "@/lib/booking-timeline";
import type { Booking } from "@/lib/types";

const THREADS_KEY = "spigolestay:threads:v1";
const SENT_KEY = "spigolestay:msgsent";
const TPL_KEY = "spigolestay:msgtemplates";
const EMPTY_SERVER: ServerEvent[] = [];
const ORDER_KEY = "spigolestay:timeline:newest-first";

const TONE: Record<TimelineTone, string> = { ok: "var(--ok)", info: "var(--focus)", warn: "var(--warn)", err: "var(--err)", muted: "var(--faint)" };

const readJson = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
};

/** Dati del browser che servono alla cronologia: chat, registro invii e nomi dei modelli. Si rileggono quando il sync li aggiorna. */
function useBrowserSources() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const ev = ["spigolestay:datasync", "spigolestay:threads", "focus"];
    ev.forEach((e) => window.addEventListener(e, bump));
    return () => ev.forEach((e) => window.removeEventListener(e, bump));
  }, []);
  return useMemo(() => {
    const threads = readJson<Record<string, unknown[]>>(THREADS_KEY, {});
    const msgsent = readJson<unknown[]>(SENT_KEY, []);
    const tpls = readJson<{ id?: string; srcId?: string; name?: string }[]>(TPL_KEY, []);
    const templateNames: Record<string, string> = {};
    if (Array.isArray(tpls)) for (const t of tpls) if (t?.name) { if (t.id) templateNames[t.id] = t.name; if (t.srcId) templateNames[t.srcId] = t.name; }
    return { threads: threads as TimelineClient["threads"], msgsent: (Array.isArray(msgsent) ? msgsent : []) as TimelineClient["msgsent"], templateNames };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
}

export default function BookingTimelineTab({ booking }: { booking: Booking }) {
  const { activities, bookings, getGuest, getStructure } = useData();
  const { t } = useLang();
  const browser = useBrowserSources();

  // Risposta del server per una prenotazione: finché `forId` non è l'id corrente (o dopo "Aggiorna") si sta caricando.
  const [res, setRes] = useState<{ forId: string; server: ServerEvent[]; partial: string[]; error: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [newestFirst, setNewestFirst] = useState<boolean>(() => { try { return localStorage.getItem(ORDER_KEY) === "1"; } catch { return false; } });
  const toggleOrder = () => setNewestFirst((v) => { const n = !v; try { localStorage.setItem(ORDER_KEY, n ? "1" : "0"); } catch { /* preferenza non salvata */ } return n; });

  useEffect(() => {
    let alive = true;
    apiPost<{ ok?: boolean; events?: ServerEvent[]; partial?: string[] }>("booking-timeline", { bookingId: booking.id })
      .then((r) => { if (alive) setRes({ forId: booking.id, server: Array.isArray(r.events) ? r.events : [], partial: Array.isArray(r.partial) ? r.partial : [], error: "" }); })
      .catch((e) => { if (alive) setRes({ forId: booking.id, server: [], partial: [], error: e instanceof Error && e.message ? e.message : "Non riesco a leggere la cronologia." }); });
    return () => { alive = false; };
  }, [booking.id, reload]);
  const loading = !res || res.forId !== booking.id;
  const server = res && res.forId === booking.id ? res.server : EMPTY_SERVER;
  const partial = res && res.forId === booking.id ? res.partial : [];
  const error = res && res.forId === booking.id ? res.error : "";
  const refresh = () => { setRes(null); setReload((n) => n + 1); };

  const guest = getGuest(booking.guestId);
  const structure = getStructure(booking.structureId);

  const events = useMemo(() => {
    // Camere dello stesso gruppo: i messaggi si mandano una volta per il gruppo, con l'id della camera rappresentante.
    const groupIds = booking.groupId ? bookings.filter((b) => b.groupId === booking.groupId).map((b) => b.id) : [booking.id];
    const guestHasOtherBookings = bookings.some((b) => b.id !== booking.id && b.guestId === booking.guestId && b.channel !== "blocked" && b.status !== "cancelled" && !(booking.groupId && b.groupId === booking.groupId));
    const client: TimelineClient = { activities, threads: browser.threads, msgsent: browser.msgsent, templateNames: browser.templateNames, guestHasOtherBookings, bookingIds: groupIds };
    const list = buildTimeline({ booking, guest, structure, server, client });
    return newestFirst ? [...list].reverse() : list;
  }, [booking, bookings, activities, browser, guest, structure, server, newestFirst]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-faint">
          {t("Cronologia")}{events.length > 0 && <span className="ml-1.5 font-normal normal-case tracking-normal">· {events.length}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={toggleOrder} className="h-7 rounded-lg border border-line px-2 text-[11px] font-semibold text-dim hover:bg-wash hover:text-txt">
            {newestFirst ? t("Dalla più recente") : t("Dalla più vecchia")}
          </button>
          <button type="button" onClick={refresh} disabled={loading} className="h-7 rounded-lg border border-line px-2 text-[11px] font-semibold text-dim hover:bg-wash hover:text-txt disabled:opacity-50">
            {loading ? t("Carico…") : t("Aggiorna")}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: "color-mix(in srgb, var(--warn) 40%, var(--line))", backgroundColor: "color-mix(in srgb, var(--warn) 8%, transparent)", color: "var(--txt)" }}>
          {t("Alcune informazioni non sono disponibili")}: {error}
        </div>
      )}
      {!error && partial.length > 0 && (
        <div className="text-[11px] text-faint">{t("Alcune fonti non si sono lette e potrebbero mancare eventi.")}</div>
      )}

      {loading && events.length === 0 ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label={t("Caricamento della cronologia")}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="h-8 w-[74px] shrink-0 animate-pulse rounded bg-wash" />
              <div className="h-8 flex-1 animate-pulse rounded bg-wash" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">{t("Nessun evento registrato")}</div>
      ) : (
        <ol className="relative m-0 list-none p-0">
          {events.map((e, i) => <Row key={`${i}-${String(e.at)}-${e.kind}`} e={e} last={i === events.length - 1} t={t} />)}
        </ol>
      )}
    </div>
  );
}

function Row({ e, last, t }: { e: TimelineEvent; last: boolean; t: (s: string) => string }) {
  const full = fmtEventAt(e.at);
  const [date, time] = isDateOnly(e.at) ? [full, ""] : [full.slice(0, 10), full.slice(11)];
  const color = TONE[e.tone];
  return (
    <li className="flex gap-2.5">
      <div className="w-[68px] shrink-0 pt-0.5 text-right leading-tight">
        <div className="text-[11px] font-medium text-dim">{date}</div>
        {time && <div className="text-[11px] text-faint">{time}</div>}
      </div>
      <div className="relative flex w-3 shrink-0 justify-center" aria-hidden>
        <span className="mt-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--paper)]" style={{ backgroundColor: color }} />
        {!last && <span className="absolute bottom-[-6px] top-4 w-px bg-[var(--line)]" />}
      </div>
      <div className="min-w-0 flex-1 pb-3.5">
        <div className="break-words text-[13px] font-medium leading-snug text-txt">{t(e.title)}</div>
        {e.detail && <div className="mt-0.5 break-words text-[12px] leading-snug text-dim">{e.detail}</div>}
        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-faint">{t(e.source)}</div>
      </div>
    </li>
  );
}
