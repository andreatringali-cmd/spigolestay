"use client";

// Messaggi 2: conversazioni con gli ospiti delle OTA (Booking.com, Airbnb, Expedia), semplici e pulite come nell'app Messaggi di Channex.
// Riceve e invia SOLO messaggi OTA, direttamente su Channex (nessuna copia salvata da noi). Il segno "letto" resta su questo dispositivo (preferenza di vista).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui";
import ChannelLogo from "@/components/ChannelLogo";
import { useConfirm } from "@/components/ConfirmProvider";
import { useData } from "@/lib/store";
import { apiPost } from "@/lib/invoicing/client";
import { fmtDate, fmtDateTime, nights as nightsBetween, toISO } from "@/lib/dates";
import { ago, noReplySupported, providerChannel, providerLabel, type OtaMsg, type OtaThread } from "@/lib/channex-threads";

type Tab = "active" | "closed";
const SEEN_KEY = "xn:msg2:seen";
const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

const initials = (name: string) => { const w = name.trim().split(/\s+/).filter(Boolean); return (w.length ? (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]) : "?").toUpperCase(); };
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
const readSeen = (): Record<string, number> | null => { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); return v && typeof v === "object" ? v : null; } catch { return null; } };
const writeSeen = (m: Record<string, number>) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch { /* storage non disponibile */ } };

export default function Messaggi2Page() {
  const ask = useConfirm();
  const { bookings, guests, getStructure, openBooking, selectedStructureIds } = useData();
  const [threads, setThreads] = useState<OtaThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listErr, setListErr] = useState("");
  const [notInstalled, setNotInstalled] = useState(false);
  const [partial, setPartial] = useState(false);
  const [tab, setTab] = useState<Tab>("active");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<OtaMsg[]>([]);
  const [msgErr, setMsgErr] = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = selId ? drafts[selId] ?? "" : "";
  const setDraft = (v: string) => { if (selId) setDrafts((d) => ({ ...d, [selId]: v })); };
  const [sending, setSending] = useState(false);
  const [actErr, setActErr] = useState("");
  const [seen, setSeen] = useState<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // ── Messaggi della conversazione aperta ──
  const loadMsgs = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setMsgLoading(true);
    try {
      const r = await apiPost<{ ok?: boolean; messages?: OtaMsg[]; error?: string }>("channex/threads", { action: "messages", threadId: id });
      if (selRef.current !== id) return;
      if (r.ok === false) { if (!quiet) setMsgErr(r.error || "Non riesco a leggere i messaggi."); } else { setMsgErr(""); setMsgs(r.messages ?? []); }
    } catch (e) { if (!quiet && selRef.current === id) setMsgErr(e instanceof Error ? e.message : "Errore di rete."); }
    finally { if (!quiet && selRef.current === id) setMsgLoading(false); }
  }, []);
  useEffect(() => {
    if (!selId) return;
    void loadMsgs(selId);
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void loadMsgs(selId, true); }, 20_000);
    return () => window.clearInterval(id);
  }, [selId, loadMsgs]);
  // Scorre in fondo solo quando cambia conversazione o arriva un messaggio nuovo E si era già in fondo: il polling non deve far saltare chi rilegge un messaggio vecchio.
  const scrollKey = useRef("");
  const lastMsgId = msgs.length ? msgs[msgs.length - 1].id : "";
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const key = `${selId}|${lastMsgId}`;
    const sameThread = scrollKey.current.split("|")[0] === String(selId);
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (!sameThread || nearBottom) el.scrollTop = el.scrollHeight;
    scrollKey.current = key;
  }, [selId, lastMsgId]);

  const select = (t: OtaThread) => {
    setSelId(t.id); setMsgs([]); setMsgErr(""); setActErr("");
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

  // ── Azioni ──
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!sel) return false;
    setActErr("");
    try {
      const r = await apiPost<{ ok?: boolean; error?: string }>("channex/threads", { action, threadId: sel.id, ...extra });
      if (r.ok === false || (r as { error?: string }).error) { setActErr(r.error || "Operazione non riuscita."); return false; }
      return true;
    } catch (e) { setActErr(e instanceof Error ? e.message : "Errore di rete."); return false; }
  };
  const send = async () => {
    const text = draft.trim();
    if (!sel || !text || sending) return;
    setSending(true);
    const tid = sel.id;
    const ok = await act("send", { text });
    setSending(false);
    if (ok) { setDrafts((d) => ({ ...d, [tid]: "" })); void loadMsgs(tid, true); void loadList(); }
  };
  const attach = async (file: File | undefined) => {
    if (!sel || !file) return;
    if (file.size > 3 * 1024 * 1024) { setActErr("File troppo grande (massimo 3 MB)."); return; }
    setSending(true);
    try {
      const base64 = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || "")); fr.onerror = () => rej(new Error("Lettura del file non riuscita.")); fr.readAsDataURL(file); });
      const ok = await act("send_attachment", { base64, name: file.name, type: file.type });
      if (ok) { void loadMsgs(sel.id, true); void loadList(); }
    } catch (e) { setActErr(e instanceof Error ? e.message : "Errore."); }
    setSending(false);
  };
  const closeThread = async () => {
    if (!sel) return;
    if (!(await ask({ title: "Chiudere la conversazione?", message: `Chiudi la conversazione con ${guestNameOf(sel)} su ${providerLabel(sel.provider)}. Non si può riaprire da qui.`, confirmLabel: "Chiudi" }))) return;
    if (await act("close")) { await loadList(); setSelId(null); }
  };
  const noReply = async () => { if (await act("no_reply")) { await loadList(); setSelId(null); } };

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
  const lastGuest = msgs.length > 0 && msgs[msgs.length - 1].sender === "guest";
  const missingApp = notInstalled || /messages application|not have installed|not installed|forbidden/i.test(listErr);

  return (
    <div>
      <PageHeader title="Messaggi 2" subtitle="Le conversazioni con gli ospiti di Booking.com, Airbnb ed Expedia: ricevi e rispondi direttamente sui portali" />
      <div className="grid h-[calc(100dvh-10.5rem)] min-h-[460px] overflow-hidden rounded-xl border border-line bg-surface shadow-sm md:grid-cols-[340px_minmax(0,1fr)]">
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
                <button type="button" onClick={() => void loadList()} className="ml-2 font-semibold underline">Riprova</button>
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
            <>
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <button type="button" onClick={() => setSelId(null)} className="mt-0.5 rounded-lg px-1.5 py-0.5 text-lg leading-none text-dim hover:bg-wash md:hidden" aria-label="Torna all'elenco">‹</button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-display text-base font-bold text-txt">{guestNameOf(sel)}</h2>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-dim"><ChannelLogo channel={providerChannel(sel.provider)} size={18} title={providerLabel(sel.provider)} />{providerLabel(sel.provider)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-dim">{stayInfo}</div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <button type="button" disabled={!selBooking} onClick={() => selBooking && openBooking(selBooking.id)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-40">Apri prenotazione</button>
                  {sel.closed
                    ? <span className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-faint">Conversazione chiusa</span>
                    : <button type="button" onClick={() => void closeThread()} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Chiudi conversazione</button>}
                </div>
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-wash/40 px-4 py-4">
                {msgLoading && msgs.length === 0 && <p className="text-sm text-dim">Caricamento…</p>}
                {msgErr && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--err)", color: "var(--err)" }}>{msgErr}</p>}
                <div className="mx-auto flex max-w-3xl flex-col gap-3">
                  {msgs.map((m) => m.sender === "system" ? (
                    <div key={m.id} className="mx-auto max-w-[90%] whitespace-pre-wrap rounded-xl bg-wash px-3 py-2 text-center text-xs text-dim">{m.text}</div>
                  ) : (
                    <div key={m.id} className={`flex items-end gap-2 ${m.sender === "property" ? "flex-row-reverse" : ""}`}>
                      {m.sender === "guest" && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: `hsl(${hue(guestNameOf(sel))} 55% 42%)` }}>{initials(guestNameOf(sel))}</span>}
                      <div className={`flex max-w-[78%] flex-col ${m.sender === "property" ? "items-end" : "items-start"}`}>
                        <div className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${m.sender === "property" ? "text-white" : "bg-surface text-txt"}`} style={m.sender === "property" ? { backgroundColor: "var(--focus)" } : { border: "1px solid var(--line)" }}>
                          {m.text}
                          {m.att.length > 0 && <div className="mt-1.5 flex flex-col gap-1">{m.att.map((a, i) => <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="underline">📎 {a.name || "Allegato"}</a>)}</div>}
                        </div>
                        <span className="mt-0.5 text-[10px] text-faint" title={m.ts ? fmtDateTime(m.ts) : undefined}>{ago(m.ts)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-line bg-surface p-3">
                {actErr && <p className="mb-2 rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--err)", color: "var(--err)" }}>{actErr}</p>}
                {!sel.closed && noReplySupported(sel.provider) && lastGuest && (
                  <div className="mb-2 flex justify-center"><button type="button" onClick={() => void noReply()} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">Non è richiesta una risposta</button></div>
                )}
                {sel.closed ? <p className="text-center text-xs text-faint">La conversazione è chiusa: non si può più rispondere da qui.</p> : (
                  <div className="rounded-xl border border-line bg-paper p-2 focus-within:border-focus">
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} rows={2} placeholder="Inserisci il messaggio" className="w-full resize-none bg-transparent px-1.5 py-1 text-base text-txt outline-none sm:text-sm" />
                    <div className="flex items-center justify-between gap-2">
                      <label className={`inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-dim hover:bg-wash ${!selBooking && !sel.bookingId ? "pointer-events-none opacity-40" : ""}`}>
                        📎 Allega
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" className="hidden" disabled={sending || !sel.bookingId} onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                      <span className="hidden text-[11px] text-faint sm:inline">Premi Ctrl+Invio per inviare il messaggio</span>
                      <button type="button" onClick={() => void send()} disabled={sending || !draft.trim()} className="rounded-lg bg-focus px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{sending ? "Invio…" : "Invia"}</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
