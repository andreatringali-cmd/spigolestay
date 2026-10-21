"use client";

// Messaggi OTA: conversazioni con gli ospiti delle OTA (Booking.com, Airbnb, Expedia), sul modello della posta di Booking.com:
// elenco a sinistra, conversazione al centro, DETTAGLI della prenotazione a destra (da xl; su tablet e telefono in una scheda apribile da «Dettagli»).
// Riceve e invia SOLO messaggi OTA, direttamente su Channex (nessuna copia salvata da noi).
// Il segno «letto» e «non serve rispondere» è CONDIVISO tra i collaboratori (chiave `spigolestay:msg:state`, vedi msg-state.ts); filtro e ordine scelti restano su questo dispositivo (preferenza di vista).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChannelLogo from "@/components/ChannelLogo";
import OtaThreadChat from "@/components/booking-panel/OtaThreadChat";
import OtaThreadDetails from "@/components/messaging/OtaThreadDetails";
import { useData } from "@/lib/store";
import { useAccess } from "@/lib/access";
import { useAuth } from "@/lib/authsync";
import { apiPost } from "@/lib/invoicing/client";
import { fmtDM, fmtDate, nights as nightsBetween, toISO } from "@/lib/dates";
import { bookingCode } from "@/lib/bookingCode";
import { ago, providerChannel, providerLabel, type OtaThread } from "@/lib/channex-threads";
import { initIfEmpty, markSeen, setNoReply } from "@/lib/msg-state";
import { arrivalRank, countByFilter, matchesFilter, sortRows, threadFlags, waitLabel, type InboxFilter, type InboxSort } from "@/lib/msg-inbox";
import { useMsgState } from "@/lib/use-msg-state";

type Tab = "active" | "closed";
type ListReply = { ok?: boolean; threads?: OtaThread[]; error?: string; notInstalled?: boolean; partial?: boolean };
const VIEW_KEY = "xn:msg2:view"; // preferenza di VISTA di questo dispositivo: filtro e ordine
const FILTER_LABEL: Record<InboxFilter, string> = { waiting: "In attesa di risposta", unread: "Non letti", all: "Tutti", noreply: "Senza risposta necessaria" };
const FILTER_ORDER: InboxFilter[] = ["waiting", "unread", "all", "noreply"];
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";
const ctrl = `h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-sm text-txt placeholder:text-faint max-sm:h-11 max-sm:text-base ${focusRing}`;
const btn = `rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-semibold text-txt transition hover:bg-wash disabled:opacity-40 max-sm:min-h-11 ${focusRing}`;

const readView = (): { filter: InboxFilter; sort: InboxSort } => {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || "null") as { filter?: string; sort?: string } | null;
    return { filter: FILTER_ORDER.includes(v?.filter as InboxFilter) ? (v!.filter as InboxFilter) : "all", sort: v?.sort === "arrival" ? "arrival" : "recent" };
  } catch { return { filter: "all", sort: "recent" }; }
};

// Solo in sviluppo locale (NEXT_PUBLIC_LOCAL_ONLY=1, mai impostata in produzione: il ramo sparisce dalla build): permette di provare la schermata con risposte simulate
// (window.__xnOtaTest, oppure localStorage "xn:otatest" = elenco di conversazioni) senza accesso. In produzione l'elenco arriva sempre e solo da /api/channex/threads.
const devThreads = (): (() => Promise<ListReply>) | undefined => {
  if (process.env.NEXT_PUBLIC_LOCAL_ONLY !== "1") return undefined;
  const w = window as unknown as { __xnOtaTest?: () => Promise<ListReply> };
  if (w.__xnOtaTest) return w.__xnOtaTest;
  try {
    const raw = localStorage.getItem("xn:otatest");
    if (!raw) return undefined;
    const rows = JSON.parse(raw) as OtaThread[];
    return async () => ({ ok: true, threads: rows });
  } catch { return undefined; }
};

export default function OtaMessagesPanel() {
  const { bookings, guests, getStructure, openBooking, selectedStructureIds } = useData();
  const access = useAccess();
  const auth = useAuth();
  const who = (access.user?.firstName || (auth.user?.email ?? "").split("@")[0] || "Utente").slice(0, 30);
  const { state: ms, update: updateMs } = useMsgState(who);

  const [threads, setThreads] = useState<OtaThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [listErr, setListErr] = useState("");
  const [notInstalled, setNotInstalled] = useState(false);
  const [partial, setPartial] = useState(false);
  const [tab, setTab] = useState<Tab>("active");
  const [q, setQ] = useState("");
  const [filter, setFilterState] = useState<InboxFilter>("all");
  const [sort, setSortState] = useState<InboxSort>("recent");
  const [selId, setSelId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // La preferenza sta nel browser: si legge dopo il primo disegno (niente differenze tra server e browser).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const v = readView(); setFilterState(v.filter); setSortState(v.sort); }, []);
  const saveView = (f: InboxFilter, s: InboxSort) => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ filter: f, sort: s })); } catch { /* preferenza non salvata */ } };
  const setFilter = (f: InboxFilter) => { setFilterState(f); saveView(f, sort); };
  const setSort = (s: InboxSort) => { setSortState(s); saveView(filter, s); };

  // ── Dati dell'app per ogni conversazione: prenotazione (da extId channex:<id>), ospite, struttura ──
  const bookingOf = useCallback((t: OtaThread) => (t.bookingId ? bookings.find((b) => b.extId === `channex:${t.bookingId}`) : undefined), [bookings]);
  const guestNameOf = useCallback((t: OtaThread) => { const b = bookingOf(t); const g = b ? guests.find((x) => x.id === b.guestId) : undefined; return g?.fullName || t.title || "Ospite"; }, [bookingOf, guests]);

  // ── Elenco conversazioni (subito, poi ogni 60 secondi a pagina visibile) ──
  const loadList = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const dev = devThreads();
      const r = dev ? await dev() : await apiPost<ListReply>("channex/threads", { action: "list" });
      if (!alive.current) return;
      if (r.ok === false) { setListErr(r.error || "Non riesco a leggere le conversazioni."); setNotInstalled(!!r.notInstalled); setLoaded(true); return; }
      setListErr(""); setNotInstalled(false); setPartial(!!r.partial); setThreads(r.threads ?? []); setLoaded(true); setUpdatedAt(Date.now()); setNow(Date.now());
    } catch (e) { if (alive.current) { setListErr(e instanceof Error ? e.message : "Errore di rete."); setLoaded(true); } }
    finally { if (alive.current) setRefreshing(false); }
  }, []);
  useEffect(() => { void loadList(); const id = window.setInterval(() => { if (document.visibilityState === "visible") void loadList(); }, 60_000); return () => window.clearInterval(id); }, [loadList]);

  // Prima apertura (nessun segno condiviso): lo storico non è «da leggere»; conta solo ciò che arriva da ora.
  useEffect(() => { if (loaded && !listErr) updateMs((s) => initIfEmpty(s, who, Date.now())); }, [loaded, listErr, updateMs, who]);

  // ── Righe: ogni conversazione con i suoi segni ──
  const scopeIds = useMemo(() => new Set(selectedStructureIds), [selectedStructureIds]);
  const todayISO = toISO(new Date(now));
  const allRows = useMemo(() => threads.map((t) => {
    const b = bookingOf(t);
    return { t, b, name: guestNameOf(t), flags: threadFlags(t, ms, now, selId), rank: arrivalRank(b, todayISO) };
  }).filter((r) => !r.b || scopeIds.has(r.b.structureId)), // senza prenotazione (richiesta di informazioni) resta sempre visibile
  [threads, ms, now, selId, todayISO, scopeIds, bookingOf, guestNameOf]);
  const tabRows = useMemo(() => allRows.filter((r) => (tab === "active" ? !r.t.closed : r.t.closed)), [allRows, tab]);
  const counts = useMemo(() => countByFilter(allRows.filter((r) => !r.t.closed).map((r) => r.flags)), [allRows]);
  const closedCount = useMemo(() => allRows.filter((r) => r.t.closed).length, [allRows]);
  const activeCount = counts.all;

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = tabRows.filter((r) => {
      if (r.t.id === selId) return true; // la conversazione aperta resta in elenco anche se ora non rientra nel filtro (appena letta o risposta)
      if (tab === "active" && !matchesFilter(r.flags, filter)) return false;
      if (needle && !(r.name.toLowerCase().includes(needle) || r.t.lastMessage.toLowerCase().includes(needle) || (r.b && bookingCode(r.b).toLowerCase().includes(needle)))) return false;
      return true;
    });
    return sortRows(rows, sort);
  }, [tabRows, q, tab, filter, sort, selId]);

  const sel = threads.find((t) => t.id === selId) ?? null;
  const selRow = sel ? allRows.find((r) => r.t.id === sel.id) : undefined;
  const selBooking = sel ? bookingOf(sel) : undefined;

  // La conversazione aperta si considera letta anche se arrivano o scrivo messaggi mentre la guardo (e lo vedono anche gli altri collaboratori).
  useEffect(() => {
    if (!sel) return;
    const sid = selBooking?.structureId;
    updateMs((s) => markSeen(s, sel.id, sel.lastAt, who, Date.now(), sid));
  }, [sel?.id, sel?.lastAt, selBooking?.structureId, who, updateMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleNoReply = () => {
    if (!sel) return;
    const on = !selRow?.flags.noReply;
    updateMs((s) => setNoReply(s, sel.id, on, sel.lastAt, who, Date.now(), selBooking?.structureId));
  };

  // Titolo della scheda del browser con il numero di conversazioni da leggere.
  // Next riscrive il titolo a ogni aggiornamento dei metadati: si osserva l'elemento <title> e si rimette il numero se sparisce.
  useEffect(() => {
    const strip = (t: string) => t.replace(/^\(\d+\)\s+/, "");
    const apply = () => { const base = strip(document.title); const want = counts.unread > 0 ? `(${counts.unread}) ${base}` : base; if (document.title !== want) document.title = want; };
    apply();
    const el = document.querySelector("title");
    const mo = el ? new MutationObserver(apply) : null;
    mo?.observe(el as Node, { childList: true, characterData: true, subtree: true });
    return () => { mo?.disconnect(); document.title = strip(document.title); };
  }, [counts.unread]);

  // ── Tastiera: frecce su/giù cambiano conversazione, Esc torna all'elenco ──
  const visRef = useRef(visible), selRef = useRef(selId), detRef = useRef(detailsOpen);
  useEffect(() => { visRef.current = visible; selRef.current = selId; detRef.current = detailsOpen; }, [visible, selId, detailsOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return; // non si ruba la tastiera a chi sta scrivendo
      if (document.querySelector('[role="dialog"],[aria-modal="true"]')) return;                     // finestra aperta sopra: non è per noi
      if (e.key === "Escape") {
        if (detRef.current) { setDetailsOpen(false); e.preventDefault(); } else if (selRef.current) { setSelId(null); e.preventDefault(); }
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const list = visRef.current; if (!list.length) return;
      const i = list.findIndex((r) => r.t.id === selRef.current);
      const next = list[e.key === "ArrowDown" ? Math.min(list.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)];
      if (next && next.t.id !== selRef.current) { e.preventDefault(); setSelId(next.t.id); setDetailsOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (selId) document.getElementById(`ota-row-${selId}`)?.scrollIntoView({ block: "nearest" }); }, [selId]);

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
  const timeLabel = updatedAt ? new Date(updatedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
  const pick = (id: string) => { setSelId(id); setDetailsOpen(false); };
  const hasRows = allRows.length > 0;

  return (
    <div>
      <div className="relative grid h-[calc(100dvh-15rem)] min-h-[460px] overflow-hidden rounded-xl border border-line bg-surface shadow-sm lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[296px_minmax(0,1fr)_272px]">
        {/* ── Elenco ── */}
        <div className={`${selId ? "max-lg:hidden" : ""} flex min-h-0 flex-col border-r border-line`}>
          <div className="flex items-center gap-4 border-b border-line px-4">
            {([["active", "Attivo", activeCount], ["closed", "Chiuso", closedCount]] as [Tab, string, number][]).map(([k, lab, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-1 py-3 text-sm font-semibold transition max-sm:min-h-11 ${focusRing} ${tab === k ? "border-focus text-focus" : "border-transparent text-dim hover:text-txt"}`}>
                {lab}{loaded && <span className="ml-1.5 text-[11px] font-normal text-faint">{n}</span>}
                {k === "active" && counts.unread > 0 && <span className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle" role="img" style={{ backgroundColor: "var(--focus)" }} aria-label={`${counts.unread} da leggere`} title={`${counts.unread} da leggere`} />}
              </button>
            ))}
            <button type="button" onClick={() => void loadList(true)} disabled={refreshing} className={`ml-auto rounded-lg px-2 py-1.5 text-xs font-semibold text-dim transition hover:bg-wash hover:text-txt disabled:opacity-60 max-sm:min-h-11 ${focusRing}`} title={timeLabel ? `Ultimo aggiornamento alle ${timeLabel}` : "Aggiorna l'elenco"}>
              <span aria-hidden className={refreshing ? "inline-block animate-spin" : ""}>↻</span> {refreshing ? "Aggiorno…" : "Aggiorna"}
            </button>
          </div>
          <div className="space-y-2 border-b border-line p-2.5">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca ospite, messaggio, codice…" aria-label="Cerca per ospite, messaggio o numero di prenotazione" className={`${ctrl} w-full`} />
            <div className="flex gap-2">
              {tab === "active" && (
                <select value={filter} onChange={(e) => setFilter(e.target.value as InboxFilter)} aria-label="Mostra" className={`${ctrl} min-w-0 flex-1`}>
                  {FILTER_ORDER.map((f) => <option key={f} value={f}>{FILTER_LABEL[f]} ({counts[f]})</option>)}
                </select>
              )}
              <select value={sort} onChange={(e) => setSort(e.target.value as InboxSort)} aria-label="Ordina" className={`${ctrl} ${tab === "active" ? "w-[8.5rem] shrink-0" : "min-w-0 flex-1"}`}>
                <option value="recent">Più recenti</option>
                <option value="arrival">Arrivo più vicino</option>
              </select>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={!loaded}>
            {!loaded && (
              <div role="status" className="animate-pulse">
                <span className="sr-only">Caricamento…</span>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-start gap-3 border-b border-line px-4 py-3" aria-hidden>
                    <span className="h-8 w-8 shrink-0 rounded-full bg-wash" />
                    <span className="min-w-0 flex-1 space-y-2"><span className="block h-3 w-2/5 rounded bg-wash" /><span className="block h-3 w-4/5 rounded bg-wash" /></span>
                  </div>
                ))}
              </div>
            )}
            {loaded && listErr && (
              <div className="m-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
                {missingApp ? "L'app «Messages» non è installata su Channex per questa struttura: attivala dalla dashboard di Channex (Applications) e riprova." : listErr}
                <button type="button" onClick={() => void loadList(true)} className={`ml-2 py-2 font-semibold underline ${focusRing}`}>Riprova</button>
              </div>
            )}
            {loaded && !listErr && partial && <p className="m-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>Alcune strutture non rispondono (app «Messages» non attiva su Channex o errore temporaneo): le loro conversazioni non compaiono.</p>}
            {loaded && !listErr && visible.length === 0 && (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-semibold text-txt">
                  {q ? "Nessuna conversazione trovata" : !hasRows ? "Ancora nessun messaggio" : tab === "closed" ? "Nessuna conversazione chiusa" : filter === "waiting" ? "Nessuna conversazione in attesa di risposta" : filter === "unread" ? "Nessun messaggio da leggere" : filter === "noreply" ? "Nessuna conversazione senza risposta necessaria" : "Nessuna conversazione attiva"}
                </p>
                <p className="mx-auto mt-1 max-w-[16rem] text-xs text-dim">
                  {q ? "Prova con un altro nome, una parola del messaggio o il numero di prenotazione."
                    : !hasRows ? "Qui compaiono i messaggi degli ospiti di Booking.com, Airbnb ed Expedia, appena ne arrivano."
                    : tab === "active" && filter !== "all" ? "Bene così: non c'è nulla da fare in questo elenco." : ""}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {q && <button type="button" onClick={() => setQ("")} className={btn}>Azzera la ricerca</button>}
                  {!q && tab === "active" && filter !== "all" && hasRows && <button type="button" onClick={() => setFilter("all")} className={btn}>Mostra tutte</button>}
                  {!q && !hasRows && <button type="button" onClick={() => void loadList(true)} className={btn}>Aggiorna</button>}
                </div>
              </div>
            )}
            <ul>
              {visible.map(({ t, b, name, flags }) => (
                <li key={t.id}>
                  <button id={`ota-row-${t.id}`} type="button" onClick={() => pick(t.id)} aria-current={selId === t.id ? "true" : undefined}
                    className={`flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition hover:bg-wash max-sm:min-h-16 ${focusRing} focus-visible:-outline-offset-2 ${selId === t.id ? "bg-wash" : ""}`}>
                    <span className="mt-0.5 shrink-0"><ChannelLogo channel={providerChannel(t.provider)} size={32} title={providerLabel(t.provider)} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-sm ${flags.unread ? "font-bold text-txt" : "font-semibold text-txt"}`}>{name}</span>
                        <span className="shrink-0 text-[11px] text-faint">{ago(t.lastAt)}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={`truncate text-xs ${flags.unread ? "font-semibold text-txt" : "text-dim"}`}>{t.lastMessage || "—"}</span>
                        {flags.unread && <span className="h-2 w-2 shrink-0 rounded-full" role="img" style={{ backgroundColor: "var(--focus)" }} aria-label="Da leggere" />}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {flags.waiting && (
                          // Fondo pieno (tinta mescolata alla superficie, non trasparente): il contrasto non cambia se la riga è selezionata. Rosso solo oltre 24 ore.
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: flags.overdue ? "var(--err)" : "var(--txt)", backgroundColor: `color-mix(in srgb, ${flags.overdue ? "var(--err)" : "var(--focus)"} 12%, var(--surface))` }}>
                            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: flags.overdue ? "var(--err)" : "var(--focus)" }} />
                            Da rispondere · in attesa da {waitLabel(flags.waitMs)}
                          </span>
                        )}
                        {flags.noReply && <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-dim" title={ms[t.id]?.nrBy ? `Segnata da ${ms[t.id].nrBy}` : undefined}>Non serve rispondere</span>}
                        {b && <span className="text-[11px] text-faint">{fmtDM(b.checkIn)} – {fmtDM(b.checkOut)}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {loaded && visible.length > 1 && <p className="px-4 py-3 text-[11px] text-faint max-lg:hidden">Frecce su/giù per cambiare conversazione, Esc per tornare all&apos;elenco.</p>}
          </div>
        </div>

        {/* ── Conversazione ── */}
        <div className={`${selId ? "" : "max-lg:hidden"} flex min-h-0 min-w-0 flex-col ${sel ? "" : "xl:col-span-2"}`}>
          {!sel ? (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div>
                <p className="text-sm font-semibold text-txt">Scegli una conversazione dall&apos;elenco</p>
                {loaded && !listErr && (counts.waiting > 0 || counts.unread > 0) && (
                  <p className="mt-1 text-xs text-dim">
                    {counts.waiting > 0 && <>{counts.waiting} in attesa di risposta</>}
                    {counts.waiting > 0 && counts.unread > 0 && " · "}
                    {counts.unread > 0 && <>{counts.unread} {counts.unread === 1 ? "non letta" : "non lette"}</>}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <OtaThreadChat
              thread={sel}
              title={selRow?.name ?? "Ospite"}
              subtitle={stayInfo}
              guestName={selRow?.name ?? "Ospite"}
              onBack={() => setSelId(null)}
              actions={<>
                {/* Da 768 a 1023 px la conversazione occupa tutta la larghezza (c'è già la barra laterale): sotto i 768 il «‹» è nell'intestazione della conversazione, qui il pulsante per tornare all'elenco. */}
                <button type="button" onClick={() => setSelId(null)} className={`${btn} hidden md:max-lg:inline-flex`}>‹ Elenco</button>
                <button type="button" onClick={() => setDetailsOpen(true)} aria-expanded={detailsOpen} className={`${btn} xl:hidden`}>Dettagli</button>
                {!sel.closed && (
                  <button type="button" onClick={toggleNoReply} aria-pressed={!!selRow?.flags.noReply} title={selRow?.flags.noReply ? `Segnata da ${ms[sel.id]?.nrBy || "un collega"}: clic per annullare` : "Toglie la conversazione da «in attesa di risposta»; torna in attesa se l'ospite scrive ancora"} className={`${btn} ${selRow?.flags.noReply ? "bg-wash" : ""}`}>
                    {selRow?.flags.noReply ? "✓ Non serve rispondere" : "Non serve rispondere"}
                  </button>
                )}
                <button type="button" disabled={!selBooking} onClick={() => selBooking && openBooking(selBooking.id)} className={`${btn} xl:hidden`}>Apri prenotazione</button>
              </>}
              onChanged={() => void loadList()}
              onClosed={() => { void loadList().then(() => setSelId(null)); }}
            />
          )}
        </div>

        {/* ── Dettagli (da xl sempre a destra) ── */}
        {sel && (
          <aside aria-label="Dettagli della prenotazione" className="hidden min-h-0 overflow-y-auto border-l border-line xl:block">
            <OtaThreadDetails thread={sel} guestName={selRow?.name ?? "Ospite"} onOpenBooking={openBooking} />
          </aside>
        )}

        {/* ── Dettagli su tablet e telefono: scheda sopra la conversazione ── */}
        {sel && detailsOpen && (
          <div className="absolute inset-0 z-10 flex flex-col bg-surface xl:hidden" role="region" aria-label="Dettagli della prenotazione">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <h2 className="text-sm font-bold text-txt">Dettagli</h2>
              <button type="button" onClick={() => setDetailsOpen(false)} className={btn}>Chiudi</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto"><OtaThreadDetails thread={sel} guestName={selRow?.name ?? "Ospite"} onOpenBooking={(id) => { setDetailsOpen(false); openBooking(id); }} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
