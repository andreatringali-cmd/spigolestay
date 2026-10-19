"use client";

// Messaggi OTA: conversazioni con gli ospiti delle OTA (Booking.com, Airbnb, Expedia), semplici e pulite come nell'app Messaggi di Channex.
// Riceve e invia SOLO messaggi OTA, direttamente su Channex (nessuna copia salvata da noi). Il segno "letto" resta su questo dispositivo (preferenza di vista).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChannelLogo from "@/components/ChannelLogo";
import OtaThreadChat from "@/components/booking-panel/OtaThreadChat";
import { useData } from "@/lib/store";
import { apiPost } from "@/lib/invoicing/client";
import { fmtDate, nights as nightsBetween, toISO } from "@/lib/dates";
import { ago, providerChannel, providerLabel, type OtaThread } from "@/lib/channex-threads";

type Tab = "active" | "closed";
const SEEN_KEY = "xn:msg2:seen";
const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

const readSeen = (): Record<string, number> | null => { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); return v && typeof v === "object" ? v : null; } catch { return null; } };
const writeSeen = (m: Record<string, number>) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch { /* storage non disponibile */ } };

export default function OtaMessagesPanel() {
  const { bookings, guests, getStructure, openBooking, selectedStructureIds } = useData();
  const [threads, setThreads] = useState<OtaThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listErr, setListErr] = useState("");
  const [notInstalled, setNotInstalled] = useState(false);
  const [partial, setPartial] = useState(false);
  const [tab, setTab] = useState<Tab>("active");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const selRef = useRef<string | null>(null);
  useEffect(() => { selRef.current = selId; }, [selId]);

  // ── Dati dell'app per ogni conversazione: prenotazione (da extId channex:<id>), ospite, struttura ──
  const bookingOf = useCallback((t: OtaThread) => (t.bookingId ? bookings.find((b) => b.extId === `channex:${t.bookingId}`) : undefined), [bookings]);
  const guestNameOf = useCallback((t: OtaThread) => { const b = bookingOf(t); const g = b ? guests.find((x) => x.id === b.guestId) : undefined; return g?.fullName || t.title || "Ospite"; }, [bookingOf, guests]);

  // ── Elenco conversazioni ──
  const loadList = useCallback(async () => {
    try {
      const r = await apiPost<{ ok?: boolean; threads?: OtaThread[]; error?: string; notInstalled?: boolean; partial?: boolean }>("channex/threads", { action: "list" });
      if (r.ok === false) { setListErr(r.error || "Non riesco a leggere le conversazioni."); setNotInstalled(!!r.notInstalled); setLoaded(true); return; }
      const list = r.threads ?? [];
      setListErr(""); setNotInstalled(false); setPartial(!!r.partial); setThreads(list); setLoaded(true);
      // Prima apertura su questo dispositivo: lo storico non è "da leggere" (altrimenti sarebbero tutte in grassetto); conta solo ciò che arriva da ora.
      const cur = readSeen();
      if (!cur) { const init: Record<string, number> = {}; for (const t of list) init[t.id] = t.lastAt; writeSeen(init); setSeen(init); }
      else {
        // La conversazione aperta si considera letta anche se arrivano o scrivo messaggi mentre la guardo.
        const open = selRef.current ? list.find((t) => t.id === selRef.current) : undefined;
        if (open && (cur[open.id] ?? 0) < open.lastAt) { cur[open.id] = open.lastAt; writeSeen(cur); }
        setSeen({ ...cur });
      }
    } catch (e) { setListErr(e instanceof Error ? e.message : "Errore di rete."); setLoaded(true); }
  }, []);
  useEffect(() => { void loadList(); const id = window.setInterval(() => { if (document.visibilityState === "visible") void loadList(); }, 60_000); return () => window.clearInterval(id); }, [loadList]);

  const select = (t: OtaThread) => {
    setSelId(t.id);
    const next = { ...seen, [t.id]: Math.max(seen[t.id] ?? 0, t.lastAt) };
    setSeen(next); writeSeen(next);
  };

  // ── Filtri ──
  const scopeIds = useMemo(() => new Set(selectedStructureIds), [selectedStructureIds]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return threads.filter((t) => {
      if (tab === "active" ? t.closed : !t.closed) return false;
      { const b = bookingOf(t); if (b && !scopeIds.has(b.structureId)) return false; } // senza prenotazione (richiesta di informazioni) resta sempre visibile
      if (needle && !(guestNameOf(t).toLowerCase().includes(needle) || t.lastMessage.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [threads, tab, q, scopeIds, bookingOf, guestNameOf]);
  const counts = useMemo(() => ({ active: threads.filter((t) => !t.closed).length, closed: threads.filter((t) => t.closed).length }), [threads]);
  // Da leggere = l'ultimo messaggio NON è mio, è più recente dell'ultima volta che l'ho aperta, e non è la conversazione che ho aperta ora.
  const isUnread = (t: OtaThread) => t.id !== selId && t.lastSender !== "property" && t.lastAt > (seen[t.id] ?? 0);
  const unreadActive = threads.filter((t) => !t.closed && isUnread(t)).length;
  const sel = threads.find((t) => t.id === selId) ?? null;
  const selBooking = sel ? bookingOf(sel) : undefined;

  // ── Intestazione: stato del soggiorno ──
  const stayInfo = (() => {
    if (!sel) return "";
    const b = selBooking;
    if (!b) return sel.bookingId ? "Prenotazione non trovata in Xenora" : "Richiesta di informazioni (nessuna prenotazione)";
    const group = b.groupId ? bookings.filter((x) => x.groupId === b.groupId && x.status !== "cancelled" && x.channel !== "blocked") : [b];
    const rooms = Math.max(1, group.length);
    const n = Math.max(1, nightsBetween(b.checkIn, b.checkOut));
    const today = toISO(new Date());
    const when = b.status === "cancelled" ? `Annullata · arrivo ${fmtDate(b.checkIn)}` : b.checkIn > today ? `In arrivo: ${fmtDate(b.checkIn)}` : b.checkOut > today ? `In corso: ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}` : `Partito il ${fmtDate(b.checkOut)}`;
    return `${when}, ${rooms} ${rooms === 1 ? "camera" : "camere"}, ${n} ${n === 1 ? "notte" : "notti"} (${getStructure(b.structureId)?.name ?? "—"})`;
  })();
  const missingApp = notInstalled || /messages application|not have installed|not installed|forbidden/i.test(listErr);

  return (
    <div>
      <div className="grid h-[calc(100dvh-15rem)] min-h-[460px] overflow-hidden rounded-xl border border-line bg-surface shadow-sm md:grid-cols-[340px_minmax(0,1fr)]">
        {/* ── Elenco ── */}
        <div className={`${selId ? "max-md:hidden" : ""} flex min-h-0 flex-col border-r border-line`}>
          <div className="flex items-center gap-4 border-b border-line px-4">
            {([["active", "Attivo", counts.active], ["closed", "Chiuso", counts.closed]] as [Tab, string, number][]).map(([k, lab, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-1 py-3 text-sm font-semibold transition ${tab === k ? "border-focus text-focus" : "border-transparent text-dim hover:text-txt"}`}>
                {lab}{loaded && <span className="ml-1.5 text-[11px] font-normal text-faint">{n}</span>}
                {k === "active" && unreadActive > 0 && <span className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: "var(--focus)" }} title={`${unreadActive} da leggere`} />}
              </button>
            ))}
          </div>
          <div className="border-b border-line p-2.5"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca ospite o messaggio…" className={field} /></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loaded && <p className="p-4 text-sm text-dim">Caricamento…</p>}
            {loaded && listErr && (
              <div className="m-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
                {missingApp ? "L'app «Messages» non è installata su Channex per questa struttura: attivala dalla dashboard di Channex (Applications) e riprova." : listErr}
                <button type="button" onClick={() => void loadList()} className="ml-2 py-2 font-semibold underline">Riprova</button>
              </div>
            )}
            {loaded && !listErr && partial && <p className="m-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>Alcune strutture non rispondono (app «Messages» non attiva su Channex o errore temporaneo): le loro conversazioni non compaiono.</p>}
            {loaded && !listErr && visible.length === 0 && <p className="p-4 text-sm text-dim">{q ? "Nessuna conversazione trovata." : tab === "active" ? "Nessuna conversazione attiva." : "Nessuna conversazione chiusa."}</p>}
            {visible.map((t) => {
              const unread = isUnread(t);
              return (
                <button key={t.id} type="button" onClick={() => select(t)} className={`flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition hover:bg-wash ${selId === t.id ? "bg-wash" : ""}`}>
                  <span className="mt-0.5 shrink-0"><ChannelLogo channel={providerChannel(t.provider)} size={32} title={providerLabel(t.provider)} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${unread ? "font-bold text-txt" : "font-semibold text-txt"}`}>{guestNameOf(t)}</span>
                      <span className="shrink-0 text-[11px] text-faint">{ago(t.lastAt)}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className={`truncate text-xs ${unread ? "font-semibold text-txt" : "text-dim"}`}>{t.lastMessage || "—"}</span>
                      {unread && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--focus)" }} aria-label="Da leggere" />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Conversazione ── */}
        <div className={`${selId ? "" : "max-md:hidden"} flex min-h-0 min-w-0 flex-col`}>
          {!sel ? (
            <div className="grid flex-1 place-items-center p-6 text-center text-sm text-dim">Scegli una conversazione dall&apos;elenco.</div>
          ) : (
            <OtaThreadChat
              thread={sel}
              title={guestNameOf(sel)}
              subtitle={stayInfo}
              guestName={guestNameOf(sel)}
              onBack={() => setSelId(null)}
              actions={<button type="button" disabled={!selBooking} onClick={() => selBooking && openBooking(selBooking.id)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40 max-sm:min-h-10">Apri prenotazione</button>}
              onChanged={() => void loadList()}
              onClosed={() => { void loadList().then(() => setSelId(null)); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
