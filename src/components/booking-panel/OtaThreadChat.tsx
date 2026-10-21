"use client";

// Conversazione con l'ospite di una OTA (Booking.com, Airbnb, Expedia) letta e scritta direttamente su Channex.
// Usata dalla pagina "Messaggi" (a tutta pagina) e dalla scheda "Messaggi" della prenotazione (compatta).
// Contiene: bolle ospite/struttura/sistema, compositore (modelli della struttura, traduzione, suggerimento di risposta del Concierge AI, bozza conservata,
// Ctrl+Invio, contatore, riprova), allegati, "Non è richiesta una risposta", chiusura, aggiornamento ogni 60 secondi (solo a pagina visibile e con attività recente).
// Nulla parte da solo: modelli, traduzioni e suggerimenti finiscono nel campo (o in un'anteprima) e li invia sempre la persona.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ChannelLogo from "@/components/ChannelLogo";
import Popover from "@/components/Popover";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import { useData } from "@/lib/store";
import { apiPost } from "@/lib/invoicing/client";
import { friendlyError } from "@/lib/friendly-error";
import { fmtDateTime } from "@/lib/dates";
import { OTA_POLL_MS, pollVerdict, shouldRefreshOnResume } from "@/lib/poll-policy";
import { ago, noReplySupported, providerChannel, providerLabel, type OtaMsg, type OtaThread } from "@/lib/channex-threads";
import { LANG_LABEL, isGuestLang, type GuestLang } from "@/lib/concierge-i18n";
import { guestLangHint } from "@/lib/guest-lang";
import { fillTemplateForBooking, readTemplates, type StoredTemplate } from "@/lib/template-fill";
import {
  OTA_MAX_CHARS, counterState, loadDraft, needsTranslation, otaRiskList, otaRisks, replyLang, saveDraft, templateTextLang, templatesForStructure, type TplOption,
} from "@/lib/ota-composer";

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
const XL_KEY = "xn:otaxl";     // «Scrivi in italiano, invia nella lingua dell'ospite»: preferenza di questo dispositivo

const initials = (name: string) => { const w = name.trim().split(/\s+/).filter(Boolean); return (w.length ? (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]) : "?").toUpperCase(); };
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
const store = (): Storage | null => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } };

// Bozze per conversazione: oltre al browser (localStorage, vedi saveDraft) restano anche in memoria se lo storage non risponde.
const draftStore = new Map<string, string>();

// Solo in sviluppo locale (NEXT_PUBLIC_LOCAL_ONLY=1, mai impostata in produzione: il ramo sparisce dalla build): permette di provare il compositore con risposte simulate
// (window.__xnOtaApi) senza accesso. In produzione ogni chiamata passa sempre e solo da apiPost.
const post = <T,>(path: string, body: unknown): Promise<T> => {
  const hook = process.env.NEXT_PUBLIC_LOCAL_ONLY === "1" ? (window as unknown as { __xnOtaApi?: (p: string, b: unknown) => Promise<unknown> }).__xnOtaApi : undefined;
  return hook ? (hook(path, body) as Promise<T>) : apiPost<T>(path, body);
};

// Dal motivo restituito dal Concierge a una frase per l'host.
function aiReasonText(reason: string | undefined, fallback: string): string {
  const r = reason || "";
  if (/non configurata|ANTHROPIC/i.test(r)) return "L'assistente intelligente non è ancora attivo: contatta l'assistenza. Intanto puoi scrivere la risposta a mano.";
  if (/errore AI|timeout|http_|fetch/i.test(r)) return "Il servizio dei suggerimenti è occupato o non risponde: riprova tra poco. Intanto puoi scrivere la risposta a mano.";
  return r || fallback;
}

interface Tr { state: "loading" | "done" | "error"; text?: string; show?: boolean; err?: string }

export default function OtaThreadChat(props: OtaThreadChatProps) {
  return <Chat key={props.thread.id} {...props} />;
}

function Chat({ thread, title, subtitle, guestName, compact = false, onBack, actions, onChanged, onClosed }: OtaThreadChatProps) {
  const ask = useConfirm();
  const { t } = useLang();
  const { bookings, structures, getGuest, getStructure, getUnit, getRoomType } = useData();
  const uid = useId();
  const tid = thread.id;
  const name = guestName || title || thread.title || t("Ospite");
  const [msgs, setMsgs] = useState<OtaMsg[]>([]);
  const [msgErr, setMsgErr] = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [initial] = useState(() => { const d = loadDraft(store(), tid); return { text: d.text || draftStore.get(tid) || "", ai: d.ai }; });
  const [draft, setDraftState] = useState(initial.text);
  const [aiFlag, setAiFlag] = useState(initial.ai && !!initial.text);   // il testo nel campo è una bozza generata dall'AI e non ancora inviata
  const setDraft = (v: string) => { setDraftState(v); if (v) draftStore.set(tid, v); else { draftStore.delete(tid); setAiFlag(false); } };
  const [sending, setSending] = useState(false);
  const [actErr, setActErr] = useState("");
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [status, setStatus] = useState("");
  const [closedLocal, setClosedLocal] = useState(false);
  const closed = thread.closed || closedLocal;
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const tplBtnRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // ── Dati dell'app: prenotazione di Xenora (extId «channex:<id>»), ospite, struttura ──
  const booking = useMemo(() => (thread.bookingId ? bookings.find((b) => b.extId === `channex:${thread.bookingId}`) : undefined), [bookings, thread.bookingId]);
  const guest = booking ? getGuest(booking.guestId) : undefined;
  const structure = booking ? getStructure(booking.structureId) : undefined;
  const lang: GuestLang = useMemo(() => replyLang(guestLangHint(guest), msgs), [guest, msgs]);   // lingua dell'ospite: dai suoi messaggi, poi dalla scheda
  const langName = LANG_LABEL[lang].toLowerCase();
  const portal = providerLabel(thread.provider);

  // ── Messaggi (subito, poi ogni 60 secondi se la pagina è visibile e c'è stata attività negli ultimi 10 minuti) ──
  // La chiave Channex è unica per tutti i clienti (20 richieste/min condivise): niente polling a raffica, né sovrapposto, né su schede dimenticate aperte.
  const inFlight = useRef(0);
  const loadMsgs = useCallback(async (quiet = false) => {
    if (!quiet) setMsgLoading(true);
    inFlight.current++;
    try {
      const r = await post<{ ok?: boolean; messages?: OtaMsg[]; error?: string }>("channex/threads", { action: "messages", threadId: tid });
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

  // ── Bozza non inviata: conservata per conversazione su questo dispositivo e ripristinata alla riapertura ──
  const draftRef = useRef(draft); draftRef.current = draft;
  const aiRef = useRef(aiFlag); aiRef.current = aiFlag;
  useEffect(() => { const id = window.setTimeout(() => saveDraft(store(), tid, draft, aiFlag), 350); return () => window.clearTimeout(id); }, [draft, aiFlag, tid]);
  useEffect(() => () => saveDraft(store(), tid, draftRef.current, aiRef.current), [tid]);

  // ── Campo di scrittura: cresce fino a 6 righe, poi scorre ──
  const fitField = useCallback(() => {
    const el = taRef.current; if (!el) return;
    el.style.height = "auto";
    const cs = window.getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 20, pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const max = lh * 6 + pad;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max + 1 ? "auto" : "hidden";
  }, []);
  useLayoutEffect(() => { fitField(); }, [draft, closed, fitField]);
  useEffect(() => { window.addEventListener("resize", fitField); return () => window.removeEventListener("resize", fitField); }, [fitField]);
  const focusEnd = () => window.requestAnimationFrame(() => { const el = taRef.current; if (!el) return; el.focus(); el.setSelectionRange(el.value.length, el.value.length); });

  // ── Traduzione: dell'ospite (sotto ogni messaggio) e della risposta (prima dell'invio) ──
  // Preferenza del dispositivo (spunta) + eventuale forzatura per questa conversazione (modello senza la lingua dell'ospite); la bozza AI è già nella lingua dell'ospite: non si ritraduce.
  const [xlPref, setXlPref] = useState(() => { try { return store()?.getItem(XL_KEY) === "1"; } catch { return false; } });
  const [xlLocal, setXlLocal] = useState<boolean | null>(null);
  const xl = xlLocal ?? xlPref;
  const setXl = (v: boolean) => { setXlLocal(v); setXlPref(v); try { store()?.setItem(XL_KEY, v ? "1" : "0"); } catch { /* preferenza non salvata */ } };
  const translateOn = xl && lang !== "it" && !aiFlag;
  const [tr, setTr] = useState<Record<string, Tr>>({});
  const translateMsg = async (m: OtaMsg) => {
    setTr((p) => ({ ...p, [m.id]: { state: "loading" } }));
    try {
      const r = await post<{ texts?: string[] }>("concierge/translate", { action: "text", to: "it", purpose: "read", texts: [m.text] });
      const text = r.texts?.[0]?.trim();
      if (!alive.current) return;
      setTr((p) => ({ ...p, [m.id]: text ? { state: "done", text, show: true } : { state: "error", err: t("Traduzione non riuscita. Riprova tra poco.") } }));
    } catch (e) { if (alive.current) setTr((p) => ({ ...p, [m.id]: { state: "error", err: friendlyError(e, t("Traduzione non riuscita. Riprova tra poco.")) } })); }
  };
  const [preview, setPreview] = useState<{ text: string; check: boolean } | null>(null);   // risposta tradotta in attesa di conferma
  const [translating, setTranslating] = useState(false);

  // ── Azioni ──
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setActErr(""); setRetry(null);
    try {
      const r = await post<{ ok?: boolean; error?: string }>("channex/threads", { action, threadId: tid, ...extra });
      if (r.ok === false || r.error) { setActErr(friendlyError(r.error, t("Operazione non riuscita."))); return false; }
      return true;
    } catch (e) { setActErr(friendlyError(e, t("Operazione non riuscita."))); return false; }
  };
  /** Invia il testo così com'è (già confermato). Se non riesce il testo resta nel campo (o nell'anteprima) e compare «Riprova». */
  const doSend = async (text: string) => {
    if (!text || sending) return;
    setSending(true); setStatus("");
    const ok = await act("send", { text });
    if (!alive.current) return;
    setSending(false);
    if (ok) { setDraft(""); setPreview(null); setAiUndo(null); setStatus(t("Messaggio inviato.")); void loadMsgs(true); onChanged?.(); focusEnd(); }
    else setRetry(() => () => void doSend(text));
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || sending || translating || preview) return;
    if (text.length > OTA_MAX_CHARS) { setActErr(`${t("Il messaggio è troppo lungo: massimo")} ${OTA_MAX_CHARS} ${t("caratteri.")}`); return; }
    if (!translateOn) { void doSend(text); return; }
    // «Scrivi in italiano, invia in <lingua>»: prima si traduce e si mostra l'anteprima, l'invio parte solo dopo la conferma.
    setTranslating(true); setActErr(""); setRetry(null); setStatus("");
    try {
      const r = await post<{ texts?: string[]; check?: boolean[] }>("concierge/translate", { action: "text", to: lang, purpose: "send", texts: [text] });
      const out = r.texts?.[0]?.trim();
      if (!alive.current) return;
      if (!out) setActErr(t("Traduzione non riuscita. Riprova tra poco, oppure togli la spunta «Scrivi in italiano» e invia il testo così com'è."));
      else { setPreview({ text: out, check: r.check?.[0] !== false }); setStatus(`${t("Anteprima della traduzione pronta: controllala e conferma.")}`); }
    } catch (e) {
      if (alive.current) { setActErr(`${friendlyError(e, t("Traduzione non riuscita."))} ${t("Puoi riprovare, oppure togliere la spunta «Scrivi in italiano» e inviare il testo così com'è.")}`); setRetry(() => () => void send()); }
    }
    if (alive.current) setTranslating(false);
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

  // ── Modelli della struttura ──
  const [tplOpen, setTplOpen] = useState(false);
  const [tplList, setTplList] = useState<TplOption<StoredTemplate>[]>([]);
  const [tplBusy, setTplBusy] = useState("");
  const [tplNote, setTplNote] = useState("");
  const openTemplates = () => {
    if (tplOpen) { setTplOpen(false); return; }
    setTplNote("");
    setTplList(booking ? templatesForStructure(readTemplates(), booking.structureId) : []);   // letti ogni volta: i modelli si modificano in Messaggi → Modelli
    setTplOpen(true);
  };
  /** Mette nel campo il modello compilato con i dati della prenotazione, nella lingua dell'ospite. Non invia nulla. */
  const useTemplate = async (o: TplOption<StoredTemplate>) => {
    if (!booking || o.needsPaymentLink || tplBusy) return;
    setTplBusy(o.tpl.id); setTplNote("");
    try {
      const tl = templateTextLang(o.tpl, lang);
      const raw = o.tpl.texts[tl] ?? "";
      // Segnaposto compilati nella lingua scelta per questa conversazione (anche se la scheda ospite dice altro).
      const text = (await fillTemplateForBooking(raw, booking, guest ? { ...guest, language: lang } : guest, structure, { bookings, getUnit, getRoomType })).trim();
      if (!alive.current) return;
      if (!text) { setTplNote(t("Il modello è vuoto per questa prenotazione.")); return; }
      const cur = draftRef.current.replace(/\s+$/, "");
      setDraft(cur ? `${cur}\n\n${text}` : text); setAiFlag(false); setPreview(null); setAiUndo(null);
      if (tl !== lang && lang !== "it") setXlLocal(true);   // il modello non ha la versione nella lingua dell'ospite: si scrive in italiano e si traduce all'invio
      setTplOpen(false);
      setStatus(`${t("Modello inserito:")} ${o.tpl.name}. ${t("Rileggilo prima di inviare.")}`);
      focusEnd();
    } catch (e) { if (alive.current) setTplNote(friendlyError(e, t("Non riesco a compilare il modello."))); }
    finally { if (alive.current) setTplBusy(""); }
  };

  // ── Suggerimento di risposta (Concierge AI) ──
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [aiUndo, setAiUndo] = useState<string | null>(null);   // testo che c'era nel campo prima della bozza generata
  const lastGuest = [...msgs].reverse().find((m) => m.sender === "guest" && m.text.trim());
  const suggest = async () => {
    if (aiBusy) return;
    setAiNote("");
    if (!lastGuest) { setAiNote(t("Non c'è ancora un messaggio dell'ospite a cui rispondere.")); return; }
    const structureId = booking?.structureId || (structures.length === 1 ? structures[0].id : "");
    if (!structureId) { setAiNote(t("Non so a quale struttura appartiene questa conversazione: non è collegata a una prenotazione di Xenora.")); return; }
    setAiBusy(true);
    try {
      const transcript = msgs.filter((m) => m.sender !== "system" && m.text.trim()).slice(-12)
        .map((m) => `${m.sender === "guest" ? "Ospite" : "Struttura"}: ${m.text.replace(/\s+/g, " ").trim().slice(0, 600)}`).join("\n");
      const r = await post<{ answered?: boolean; reply?: string; reason?: string; disabled?: boolean }>("concierge/ask", {
        structureId, bookingId: booking?.id, message: lastGuest.text.slice(0, 1000), lang: isGuestLang(lang) ? lang : undefined, draft: true, transcript,
      });
      if (!alive.current) return;
      if (r.answered && r.reply?.trim()) {
        setAiUndo(draftRef.current.trim() ? draftRef.current : null);
        setDraftState(r.reply.trim()); draftStore.set(tid, r.reply.trim()); setAiFlag(true); setPreview(null);
        setStatus(t("Bozza generata: controllala prima di inviare."));
        focusEnd();
      } else setAiNote(aiReasonText(r.reason, t("Non sono riuscito a preparare una bozza: scrivi la risposta a mano.")));
    } catch (e) { if (alive.current) setAiNote(aiReasonText(friendlyError(e, ""), t("Non sono riuscito a preparare una bozza: scrivi la risposta a mano."))); }
    finally { if (alive.current) setAiBusy(false); }
  };

  const lastGuestIsLast = msgs.length > 0 && msgs[msgs.length - 1].sender === "guest";
  const pad = compact ? "px-3" : "px-4";
  const cState = counterState(draft.length);
  const risks = otaRisks(preview ? preview.text : draft);
  const tool = "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-dim hover:bg-wash hover:text-txt disabled:opacity-40 max-sm:min-h-10";
  const link = "inline-flex items-center rounded px-1 text-[11px] font-medium text-dim underline underline-offset-2 hover:text-txt max-sm:min-h-10";

  return (
    <div className={`flex min-w-0 flex-col ${compact ? "overflow-hidden rounded-xl border border-line bg-surface" : "min-h-0 flex-1"}`}>
      <div className={`flex flex-wrap items-start justify-between gap-2 border-b border-line ${pad} ${compact ? "py-2" : "py-3"}`}>
        <div className="flex min-w-0 items-start gap-2.5">
          {onBack && <button type="button" onClick={onBack} className="-ml-1 mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-2xl leading-none text-dim hover:bg-wash md:hidden" aria-label={t("Torna all'elenco")}>‹</button>}
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
            ? <span className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-dim">{t("Conversazione chiusa")}</span>
            : compact ? null /* nella scheda prenotazione non c'è il pulsante: si chiude da Messaggi OTA */ : <button type="button" onClick={() => void closeThread()} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{t("Chiudi conversazione")}</button>}
        </div>
      </div>

      <div ref={scrollRef} className={`overflow-y-auto bg-wash/40 py-4 ${pad} ${compact ? "h-[46dvh] max-h-[460px] min-h-[220px]" : "min-h-0 flex-1"}`}>
        {msgLoading && msgs.length === 0 && <p className="text-sm text-dim">{t("Caricamento…")}</p>}
        {msgErr && <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--err)", color: "var(--err)" }}>{msgErr}</p>}
        {!msgLoading && !msgErr && msgs.length === 0 && <p className="text-center text-sm text-dim">{t("Nessun messaggio in questa conversazione.")}</p>}
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {msgs.map((m) => {
            if (m.sender === "system") return <div key={m.id} className="mx-auto max-w-[90%] whitespace-pre-wrap rounded-xl bg-wash px-3 py-2 text-center text-xs text-dim">{m.text}</div>;
            const x = tr[m.id];
            const showTr = m.sender === "guest" && x?.state === "done" && x.show;
            const canTr = m.sender === "guest" && needsTranslation(m.text);
            return (
              <div key={m.id} className={`flex items-end gap-2 ${m.sender === "property" ? "flex-row-reverse" : ""}`}>
                {m.sender === "guest" && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: `hsl(${hue(name)} 55% 42%)` }}>{initials(name)}</span>}
                <div className={`flex max-w-[78%] flex-col ${m.sender === "property" ? "items-end" : "items-start"}`}>
                  <div className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${m.sender === "property" ? "text-on-focus" : "bg-surface text-txt"}`} style={m.sender === "property" ? { backgroundColor: "var(--focus)" } : { border: "1px solid var(--line)" }}>
                    {showTr ? x?.text : m.text}
                    {m.att.length > 0 && <div className="mt-1.5 flex flex-col gap-1">{m.att.map((a, i) => <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="underline">📎 {a.name || t("Allegato")}</a>)}</div>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
                    <span title={m.ts ? fmtDateTime(m.ts) : undefined}>{ago(m.ts)}</span>
                    {canTr && (x?.state === "loading"
                      ? <span className="text-dim" role="status">{t("Traduzione…")}</span>
                      : showTr
                        ? <><span className="text-dim">{t("Tradotto in italiano")}</span><button type="button" onClick={() => setTr((p) => ({ ...p, [m.id]: { ...x, show: false } }))} className={link}>{t("Mostra originale")}</button></>
                        : x?.state === "done"
                          ? <button type="button" onClick={() => setTr((p) => ({ ...p, [m.id]: { ...x, show: true } }))} className={link}>{t("Mostra traduzione")}</button>
                          : <button type="button" onClick={() => void translateMsg(m)} className={link}>{t("Traduci")}</button>)}
                  </div>
                  {x?.state === "error" && <p className="mt-0.5 text-[11px]" role="alert" style={{ color: "var(--err)" }}>{x.err} <button type="button" onClick={() => void translateMsg(m)} className={link}>{t("Riprova")}</button></p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-line bg-surface p-3">
        <p className="sr-only" role="status" aria-live="polite">{status}</p>
        {actErr && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-1.5 text-xs" role="alert" style={{ borderColor: "var(--err)", color: "var(--err)" }}>
            <span className="min-w-0 flex-1">{actErr}</span>
            {retry && <button type="button" onClick={() => { const f = retry; setRetry(null); f(); }} disabled={sending || translating} className="rounded-md border px-2.5 py-1 font-semibold hover:bg-wash disabled:opacity-50 max-sm:min-h-10" style={{ borderColor: "var(--err)" }}>{t("Riprova")}</button>}
          </div>
        )}
        {!closed && noReplySupported(thread.provider) && lastGuestIsLast && (
          <div className="mb-2 flex justify-center"><button type="button" onClick={() => void noReply()} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash max-sm:min-h-10">{t("Non è richiesta una risposta")}</button></div>
        )}
        {closed ? <p className="text-center text-xs text-faint">{t("La conversazione è chiusa: non si può più rispondere da qui.")}</p> : (
          <>
            {preview && (
              <section className="mb-2 rounded-xl border border-line bg-wash/50 p-2.5" aria-label={t("Anteprima della traduzione")}>
                <p className="text-xs font-semibold text-txt">{t("Anteprima in")} {langName} <span className="font-normal text-dim">· {t("non ancora inviata: controllala, puoi modificarla")}</span></p>
                <textarea value={preview.text} onChange={(e) => setPreview({ ...preview, text: e.target.value })} rows={4} aria-label={`${t("Messaggio tradotto in")} ${langName}`} className="mt-1.5 w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-base text-txt outline-none focus:border-focus sm:text-sm" />
                {!preview.check && <p className="mt-1 text-[11px]" style={{ color: "var(--warn)" }}>{t("Controlla che link, numeri, orari e codici siano uguali al testo originale.")}</p>}
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  <button type="button" onClick={() => { setPreview(null); focusEnd(); }} disabled={sending} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50 max-sm:min-h-10">{t("Torna a modificare")}</button>
                  <button type="button" onClick={() => void doSend(preview.text.trim())} disabled={sending || !preview.text.trim() || preview.text.length > OTA_MAX_CHARS} className="rounded-lg bg-focus px-3.5 py-1.5 text-sm font-semibold text-on-focus hover:opacity-90 disabled:opacity-40 max-sm:min-h-10">{sending ? t("Invio…") : t("Invia la traduzione")}</button>
                </div>
              </section>
            )}
            {!preview && <div className="rounded-xl border border-line bg-paper p-2 focus-within:border-focus">
              {aiFlag && (
                <p className="mb-1 flex flex-wrap items-center gap-x-2 px-1.5 text-[11px] font-semibold text-txt">
                  <span><span aria-hidden>✨ </span>{t("Bozza generata: controllala prima di inviare")}</span>
                  {aiUndo !== null && <button type="button" onClick={() => { setDraft(aiUndo); setAiUndo(null); setAiFlag(false); focusEnd(); }} className={link}>{t("Ripristina il testo di prima")}</button>}
                </p>
              )}
              <textarea
                ref={taRef} value={draft} rows={2}
                onChange={(e) => { setDraft(e.target.value); setPreview(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
                placeholder={t("Inserisci il messaggio")} aria-label={`${t("Messaggio per")} ${name}`} aria-describedby={`${uid}-hint`}
                className="w-full resize-none bg-transparent px-1.5 py-1 text-base text-txt disabled:opacity-60 sm:text-sm"
              />
              {lang !== "it" && (
                <label className="flex cursor-pointer items-center gap-2 px-1.5 py-1 text-xs text-txt max-sm:min-h-10">
                  <input type="checkbox" checked={xl} onChange={(e) => { setXl(e.target.checked); setPreview(null); }} className="h-4 w-4 accent-[color:var(--focus)]" />
                  <span>{t("Scrivi in italiano, invia in")} {langName}{aiFlag && xl ? <span className="text-dim"> · {t("la bozza generata è già in")} {langName}</span> : null}</span>
                </label>
              )}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <div className="flex flex-wrap items-center gap-0.5">
                  <label className={`${tool} cursor-pointer ${!thread.bookingId ? "pointer-events-none opacity-40" : ""}`}>
                    📎 {t("Allega")}
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" className="hidden" disabled={sending || !thread.bookingId} onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                  <button ref={tplBtnRef} type="button" onClick={openTemplates} aria-haspopup="dialog" aria-expanded={tplOpen} className={tool}><span aria-hidden>📝</span>{t("Modelli")}</button>
                  <button type="button" onClick={() => void suggest()} disabled={aiBusy} className={tool}><span aria-hidden>✨</span>{aiBusy ? t("Preparo la bozza…") : t("Suggerisci risposta")}</button>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {cState !== "hidden" && <span className="text-[11px]" aria-label={`${draft.length} ${t("caratteri su")} ${OTA_MAX_CHARS}`} style={{ color: cState === "over" ? "var(--err)" : cState === "warn" ? "var(--warn)" : undefined }}><span className={cState === "ok" ? "text-dim" : "font-semibold"}>{draft.length}/{OTA_MAX_CHARS}</span></span>}
                  <button type="button" onClick={() => void send()} disabled={sending || translating || !!preview || !draft.trim() || cState === "over"} className="rounded-lg bg-focus px-3.5 py-1.5 text-sm font-semibold text-on-focus hover:opacity-90 disabled:opacity-40 max-sm:min-h-10 max-sm:px-5">
                    {sending ? t("Invio…") : translating ? t("Traduco…") : translateOn ? t("Traduci e controlla") : t("Invia")}
                  </button>
                </div>
              </div>
            </div>}
            <div id={`${uid}-hint`} className="mt-1.5 flex flex-col gap-0.5 px-1 text-[11px] text-dim">
              <span>{t("Non condividere dati sensibili (carte, password).")} <span className="hidden sm:inline">{t("Ctrl+Invio per inviare.")}</span></span>
              {risks.length > 0 && <span role="status" style={{ color: "var(--warn)" }}>{t("Attenzione: nel testo ci sono")} {otaRiskList(risks)}. {portal} {t("può bloccarli od oscurarli nei messaggi.")}{risks.includes("card") ? ` ${t("Non condividere mai numeri di carta.")}` : ""}</span>}
              {cState === "over" && <span role="alert" style={{ color: "var(--err)" }}>{t("Il messaggio supera il limite: accorcialo per poterlo inviare.")}</span>}
              {aiNote && <span role="status" style={{ color: "var(--warn)" }}>{aiNote}</span>}
            </div>
            <Popover open={tplOpen} onClose={() => setTplOpen(false)} anchorRef={tplBtnRef} align="start" width={340} maxHeight={380} label={t("Modelli di messaggio")}>
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-dim">
                {booking ? `${t("Modelli di")} ${structure?.name || t("questa struttura")} · ${t("testo in")} ${langName}` : t("Per usare i modelli serve una prenotazione di Xenora collegata a questa conversazione (qui non c'è).")}
              </div>
              {booking && tplList.length === 0 && <p className="px-2.5 pb-2 text-xs text-dim">{t("Nessun modello per questa struttura. Creali in Messaggi → Modelli.")}</p>}
              {tplNote && <p className="px-2.5 pb-1 text-xs" role="alert" style={{ color: "var(--err)" }}>{tplNote}</p>}
              {tplList.map((o) => {
                const tl = templateTextLang(o.tpl, lang);
                const first = (o.tpl.texts[tl] ?? "").replace(/\s+/g, " ").trim();
                return (
                  <button key={o.tpl.id} type="button" onClick={() => void useTemplate(o)} disabled={o.needsPaymentLink || !!tplBusy} className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-wash disabled:cursor-not-allowed max-sm:min-h-11">
                    <span className={`text-sm font-semibold text-txt ${o.needsPaymentLink ? "opacity-60" : ""}`}>{o.tpl.name}{tplBusy === o.tpl.id ? " …" : ""}</span>
                    <span className={`line-clamp-2 text-xs text-dim ${o.needsPaymentLink ? "opacity-60" : ""}`}>{first.slice(0, 140)}</span>
                    {o.needsPaymentLink
                      ? <span className="text-[11px]" style={{ color: "var(--warn)" }}>{t("Contiene il link di pagamento: nelle chat dei portali non si usa. Invialo dalla scheda prenotazione.")}</span>
                      : tl !== lang && <span className="text-[11px] text-dim">{t("Esiste solo in")} {(LANG_LABEL[tl as GuestLang] ?? tl).toLowerCase()}: {t("verrà tradotto all'invio.")}</span>}
                  </button>
                );
              })}
            </Popover>
          </>
        )}
      </div>
    </div>
  );
}
