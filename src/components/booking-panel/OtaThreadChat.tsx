"use client";

// Conversazione con l'ospite di una OTA (Booking.com, Airbnb, Expedia) letta e scritta direttamente su Channex.
// Usata dalla pagina "Messaggi" (a tutta pagina) e dalla scheda "Messaggi" della prenotazione (compatta).
// Contiene: bolle ospite/struttura/sistema, scrittura con Ctrl+Invio, allegati, "Non è richiesta una risposta", chiusura, aggiornamento ogni 60 secondi (solo a pagina visibile e con attività recente).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import ChannelLogo from "@/components/ChannelLogo";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import { apiPost } from "@/lib/invoicing/client";
import { friendlyError } from "@/lib/friendly-error";
import { fmtDateTime } from "@/lib/dates";
import { OTA_POLL_MS, pollVerdict, shouldRefreshOnResume } from "@/lib/poll-policy";
import { ago, noReplySupported, providerChannel, providerLabel, type OtaMsg, type OtaThread } from "@/lib/channex-threads";

export interface OtaThreadChatProps {
  /** Conversazione (da `list` o `for_booking` di /api/channex/threads). Cambiando conversazione il componente riparte da zero. */
  thread: OtaThread;
  /** Titolo dell'intestazione (di solito il nome dell'ospite). Senza titolo l'intestazione mostra solo il portale. */
  title?: string;
  /** Riga sotto il titolo (stato del soggiorno). */
  subtitle?: string;
  /** Nome per l'avatar dell'ospite nelle bolle; di base il titolo o quello della conversazione. */
  guestName?: string;
  /** true = versione per la scheda prenotazione: area messaggi ad altezza fissa, intestazione sottile. */
  compact?: boolean;
  /** Pulsante «‹» per tornare all'elenco (solo telefono, nella pagina Messaggi). */
  onBack?: () => void;
  /** Pulsanti in più nell'intestazione (es. «Apri prenotazione»). */
  actions?: ReactNode;
  /** Dopo un invio (messaggio o allegato): la pagina può ricaricare l'elenco. */
  onChanged?: () => void;
  /** Dopo la chiusura o «Non è richiesta una risposta». */
  onClosed?: () => void;
}

const POLL_MS = OTA_POLL_MS;   // aggiornamento dei messaggi (dopo 10 minuti senza interazione si ferma: vedi poll-policy)

const initials = (name: string) => { const w = name.trim().split(/\s+/).filter(Boolean); return (w.length ? (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]) : "?").toUpperCase(); };
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };

// Bozze per conversazione: restano anche se si passa ad un'altra conversazione e si torna indietro (solo in memoria, nessun dato sul browser).
const draftStore = new Map<string, string>();

export default function OtaThreadChat(props: OtaThreadChatProps) {
  return <Chat key={props.thread.id} {...props} />;
}

function Chat({ thread, title, subtitle, guestName, compact = false, onBack, actions, onChanged, onClosed }: OtaThreadChatProps) {
  const ask = useConfirm();
  const { t } = useLang();
  const tid = thread.id;
  const name = guestName || title || thread.title || t("Ospite");
  const [msgs, setMsgs] = useState<OtaMsg[]>([]);
  const [msgErr, setMsgErr] = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [draft, setDraftState] = useState(() => draftStore.get(tid) ?? "");
  const setDraft = (v: string) => { setDraftState(v); if (v) draftStore.set(tid, v); else draftStore.delete(tid); };
  const [sending, setSending] = useState(false);
  const [actErr, setActErr] = useState("");
  const [closedLocal, setClosedLocal] = useState(false);
  const closed = thread.closed || closedLocal;
  const scrollRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // ── Messaggi (subito, poi ogni 60 secondi se la pagina è visibile e c'è stata attività negli ultimi 10 minuti) ──
  // La chiave Channex è unica per tutti i clienti (20 richieste/min condivise): niente polling a raffica, né sovrapposto, né su schede dimenticate aperte.
  const inFlight = useRef(0);
  const loadMsgs = useCallback(async (quiet = false) => {
    if (!quiet) setMsgLoading(true);
    inFlight.current++;
    try {
      const r = await apiPost<{ ok?: boolean; messages?: OtaMsg[]; error?: string }>("channex/threads", { action: "messages", threadId: tid });
      if (!alive.current) return;
      if (r.ok === false) { if (!quiet) setMsgErr(friendlyError(r.error, t("Non riesco a leggere i messaggi."))); } else { setMsgErr(""); setMsgs(r.messages ?? []); }
    } catch (e) { if (!quiet && alive.current) setMsgErr(friendlyError(e, t("Non riesco a leggere i messaggi."))); }
    finally { inFlight.current = Math.max(0, inFlight.current - 1); if (!quiet && alive.current) setMsgLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid]);
  useEffect(() => {
    void loadMsgs();
    let last = Date.now();   // ultima interazione dell'utente
    let id: number | null = null;
    const stop = () => { if (id !== null) { window.clearInterval(id); id = null; } };
    const tick = () => {
      const v = pollVerdict({ now: Date.now(), lastInteraction: last, visible: document.visibilityState === "visible", inFlight: inFlight.current });
      if (v === "stop") stop(); // 10 minuti senza interazione: si ferma finché l'utente non torna
      else if (v === "poll") void loadMsgs(true);
    };
    const start = () => { if (id === null) id = window.setInterval(tick, POLL_MS); };
    const touch = () => {
      const wasIdle = id === null;
      last = Date.now();
      if (wasIdle) { start(); if (shouldRefreshOnResume({ wasIdle, visible: document.visibilityState === "visible", inFlight: inFlight.current })) void loadMsgs(true); }
    };
    start();
    const evs = ["pointerdown", "keydown", "wheel", "touchstart", "focusin"] as const;
    for (const e of evs) window.addEventListener(e, touch, { passive: true, capture: true });
    return () => { stop(); for (const e of evs) window.removeEventListener(e, touch, { capture: true }); };
  }, [loadMsgs]);

  // Scorre in fondo solo alla prima apertura o quando arriva un messaggio nuovo E si era già in fondo: il polling non deve far saltare chi rilegge un messaggio vecchio.
  const lastMsgId = msgs.length ? msgs[msgs.length - 1].id : "";
  const firstScroll = useRef(true);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (firstScroll.current || nearBottom) el.scrollTop = el.scrollHeight;
    if (msgs.length) firstScroll.current = false;
  }, [lastMsgId, msgs.length]);

  // ── Azioni ──
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setActErr("");
    try {
      const r = await apiPost<{ ok?: boolean; error?: string }>("channex/threads", { action, threadId: tid, ...extra });
      if (r.ok === false || r.error) { setActErr(friendlyError(r.error, t("Operazione non riuscita."))); return false; }
      return true;
    } catch (e) { setActErr(friendlyError(e, t("Operazione non riuscita."))); return false; }
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await act("send", { text });
    if (!alive.current) return;
    setSending(false);
    if (ok) { setDraft(""); void loadMsgs(true); onChanged?.(); }
  };
  const attach = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setActErr(t("File troppo grande (massimo 3 MB).")); return; }
    setSending(true);
    try {
      const base64 = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || "")); fr.onerror = () => rej(new Error(t("Lettura del file non riuscita."))); fr.readAsDataURL(file); });
      const ok = await act("send_attachment", { base64, name: file.name, type: file.type });
      if (ok && alive.current) { void loadMsgs(true); onChanged?.(); }
    } catch (e) { setActErr(friendlyError(e, t("Invio del file non riuscito."))); }
    if (alive.current) setSending(false);
  };
  const closeThread = async () => {
    if (!(await ask({ title: t("Chiudere la conversazione?"), message: `${t("Chiudi la conversazione con")} ${name} ${t("su")} ${providerLabel(thread.provider)}. ${t("Non si può riaprire da qui.")}`, confirmLabel: t("Chiudi") }))) return;
    if (await act("close")) { if (alive.current) setClosedLocal(true); onClosed?.(); }
  };
  const noReply = async () => { if (await act("no_reply")) { if (alive.current) setClosedLocal(true); onClosed?.(); } };

  const lastGuest = msgs.length > 0 && msgs[msgs.length - 1].sender === "guest";
  const pad = compact ? "px-3" : "px-4";

  return (
    <div className={`flex min-w-0 flex-col ${compact ? "overflow-hidden rounded-xl border border-line bg-surface" : "min-h-0 flex-1"}`}>
      <div className={`flex flex-wrap items-start justify-between gap-2 border-b border-line ${pad} ${compact ? "py-2" : "py-3"}`}>
        <div className="flex min-w-0 items-start gap-2.5">
          {onBack && <button type="button" onClick={onBack} className="mt-0.5 rounded-lg px-1.5 py-0.5 text-lg leading-none text-dim hover:bg-wash md:hidden" aria-label={t("Torna all'elenco")}>‹</button>}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {title && <h2 className="truncate font-display text-base font-bold text-txt">{title}</h2>}
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-dim"><ChannelLogo channel={providerChannel(thread.provider)} size={18} title={providerLabel(thread.provider)} />{providerLabel(thread.provider)}</span>
            </div>
            {subtitle && <div className="mt-0.5 text-xs text-dim">{subtitle}</div>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {actions}
          {closed
            ? <span className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-faint">{t("Conversazione chiusa")}</span>
            : compact ? null /* nella scheda prenotazione non c'è il pulsante: si chiude da Messaggi OTA */ : <button type="button" onClick={() => void closeThread()} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{t("Chiudi conversazione")}</button>}
        </div>
      </div>

      <div ref={scrollRef} className={`overflow-y-auto bg-wash/40 py-4 ${pad} ${compact ? "h-[46dvh] max-h-[460px] min-h-[220px]" : "min-h-0 flex-1"}`}>
        {msgLoading && msgs.length === 0 && <p className="text-sm text-dim">{t("Caricamento…")}</p>}
        {msgErr && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--err)", color: "var(--err)" }}>{msgErr}</p>}
        {!msgLoading && !msgErr && msgs.length === 0 && <p className="text-center text-sm text-dim">{t("Nessun messaggio in questa conversazione.")}</p>}
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {msgs.map((m) => m.sender === "system" ? (
            <div key={m.id} className="mx-auto max-w-[90%] whitespace-pre-wrap rounded-xl bg-wash px-3 py-2 text-center text-xs text-dim">{m.text}</div>
          ) : (
            <div key={m.id} className={`flex items-end gap-2 ${m.sender === "property" ? "flex-row-reverse" : ""}`}>
              {m.sender === "guest" && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: `hsl(${hue(name)} 55% 42%)` }}>{initials(name)}</span>}
              <div className={`flex max-w-[78%] flex-col ${m.sender === "property" ? "items-end" : "items-start"}`}>
                <div className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${m.sender === "property" ? "text-white" : "bg-surface text-txt"}`} style={m.sender === "property" ? { backgroundColor: "var(--focus)" } : { border: "1px solid var(--line)" }}>
                  {m.text}
                  {m.att.length > 0 && <div className="mt-1.5 flex flex-col gap-1">{m.att.map((a, i) => <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="underline">📎 {a.name || t("Allegato")}</a>)}</div>}
                </div>
                <span className="mt-0.5 text-[10px] text-faint" title={m.ts ? fmtDateTime(m.ts) : undefined}>{ago(m.ts)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-line bg-surface p-3">
        {actErr && <p className="mb-2 rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--err)", color: "var(--err)" }}>{actErr}</p>}
        {!closed && noReplySupported(thread.provider) && lastGuest && (
          <div className="mb-2 flex justify-center"><button type="button" onClick={() => void noReply()} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{t("Non è richiesta una risposta")}</button></div>
        )}
        {closed ? <p className="text-center text-xs text-faint">{t("La conversazione è chiusa: non si può più rispondere da qui.")}</p> : (
          <div className="rounded-xl border border-line bg-paper p-2 focus-within:border-focus">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} rows={2} placeholder={t("Inserisci il messaggio")} className="w-full resize-none bg-transparent px-1.5 py-1 text-base text-txt outline-none sm:text-sm" />
            <div className="flex items-center justify-between gap-2">
              <label className={`inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-dim hover:bg-wash ${!thread.bookingId ? "pointer-events-none opacity-40" : ""}`}>
                📎 {t("Allega")}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" className="hidden" disabled={sending || !thread.bookingId} onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <span className="hidden text-[11px] text-faint sm:inline">{t("Premi Ctrl+Invio per inviare il messaggio")}</span>
              <button type="button" onClick={() => void send()} disabled={sending || !draft.trim()} className="rounded-lg bg-focus px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{sending ? t("Invio…") : t("Invia")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
