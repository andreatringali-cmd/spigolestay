"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { buildGuestLink, buildGroupGuestLink, shortenLink } from "@/lib/guestlink";
import { playSound } from "@/lib/sound";
import { useLang } from "@/lib/i18n";
import { CHANNELS, type Booking, type Guest } from "@/lib/types";
import ChannelLogo from "@/components/ChannelLogo";
import { eur } from "@/lib/format";
import { DEFAULT_TEMPLATES } from "@/lib/msg-templates";
import { apiPost } from "@/lib/invoicing/client";
import { supabase } from "@/lib/supabase";


interface Msg { id: string; dir: "out" | "in"; text: string; ts: number; via?: string }
type Threads = Record<string, Msg[]>;
const KEY = "spigolestay:threads:v1";
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));
const relTime = (ts: number, t: (s: string) => string) => { const d = Math.floor((Date.now() - ts) / 60000); if (d < 1) return t("adesso"); if (d < 60) return `${d} ${t("min fa")}`; if (d < 1440) return `${Math.floor(d / 60)} ${t("h fa")}`; return `${Math.floor(d / 1440)} ${t("g fa")}`; };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const fmtD = (iso: string) => (iso ? new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) : "—");
// Colore avatar deterministico dal nome (piccolo accento — palette curata, tenue/elegante).
const AVATAR_COLORS = ["#C15B57", "#C58A3B", "#3F9E82", "#3E7CB8", "#8A6EBE", "#B85C8E", "#4E9B5C", "#C77A3E", "#5A8FB0", "#9C7BAE"];
const avatarColor = (n: string) => { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; };
// Etichetta giorno per i separatori del thread: Oggi / Ieri / data lunga.
const dayLabel = (ts: number, t: (s: string) => string) => { const d = new Date(ts); const now = new Date(); const y = new Date(); y.setDate(now.getDate() - 1); if (d.toDateString() === now.toDateString()) return t("Oggi"); if (d.toDateString() === y.toDateString()) return t("Ieri"); return d.toLocaleDateString("it-IT", { day: "2-digit", month: "long" }); };
// Anteprima ultimo messaggio per la lista (prefisso "Tu:" se in uscita), su una riga.
const preview = (m: Msg | undefined, t: (s: string) => string) => (m ? `${m.dir === "out" ? `${t("Tu")}: ` : ""}${m.text.replace(/\s+/g, " ").trim()}` : "");

// ── Invii programmati (ex "Centro messaggi"), ora dentro le conversazioni ──
type Lang = "it" | "en" | "fr" | "de" | "es";
type Trigger = "manual" | "before_arrival" | "on_arrival" | "after_arrival" | "on_checkout" | "after_checkout";
interface MsgTemplate { id: string; name: string; texts: Record<Lang, string>; trigger: Trigger; days: number; time: string; active: boolean; srcId?: string }
const TPL_KEY = "spigolestay:msgtemplates";
const SENT_KEY = "spigolestay:msgsent";
const GUIDE_BASE = "https://spigole-guest-guide.vercel.app";
const GUIDE_MSG: Record<Lang, (u: string) => string> = {
  it: (u) => `Qui trovi la guida con tutte le info utili (check-in, wi-fi, dintorni): ${u}`,
  en: (u) => `Here is our guest guide with all the useful info: ${u}`,
  fr: (u) => `Voici le guide avec toutes les infos utiles : ${u}`,
  de: (u) => `Hier ist der Gäste-Guide mit allen Infos: ${u}`,
  es: (u) => `Aquí tienes la guía con toda la información útil: ${u}`,
};
const CHECKIN_MSG: Record<Lang, (u: string) => string> = {
  it: (u) => `Per velocizzare l'arrivo, compila il check-in online (dati e documento) qui: ${u}`,
  en: (u) => `To speed up your arrival, please complete the online check-in (details and ID) here: ${u}`,
  fr: (u) => `Pour accélérer votre arrivée, remplissez le check-in en ligne (données et pièce d'identité) ici : ${u}`,
  de: (u) => `Um Ihre Ankunft zu beschleunigen, füllen Sie bitte den Online-Check-in (Daten und Ausweis) hier aus: ${u}`,
  es: (u) => `Para agilizar tu llegada, completa el check-in online (datos y documento) aquí: ${u}`,
};

// Filo diretto con l'ospite + invii programmati: un unico posto per chattare (tab di /messaggi).
export default function ConversazioniPanel({ onManageTemplates }: { onManageTemplates?: () => void }) {
  const { bookings, guests, getStructure, getUnit, getRoomType, activeStructureId } = useData();
  const { t } = useLang();
  const router = useRouter();
  const [threads, setThreads] = useState<Threads>({});
  const [ready, setReady] = useState(false);
  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setThreads(JSON.parse(r)); } catch {} setReady(true); }, []);
  useEffect(() => { if (!ready) return; try { localStorage.setItem(KEY, JSON.stringify(threads)); window.dispatchEvent(new Event("spigolestay:threads")); } catch {} }, [threads, ready]);

  // Modelli salvati + registro invii (condivisi con la pagina Modelli & automazioni).
  const [templates, setTemplates] = useState<MsgTemplate[]>([]);
  const [sent, setSent] = useState<{ key: string; guest: string; tpl: string; via: string; ts: number }[]>([]);
  useEffect(() => {
    // Modelli: parto da quelli salvati e aggiungo i modelli d'esempio mancanti (per id).
    try {
      const r = localStorage.getItem(TPL_KEY); const parsed = r ? JSON.parse(r) : null;
      const base = Array.isArray(parsed) ? parsed : [];
      const haveIds = new Set(base.map((x: MsgTemplate) => x.id));
      const merged = [...base, ...DEFAULT_TEMPLATES.filter((d) => !haveIds.has(d.id))];
      setTemplates(merged);
      if (merged.length !== base.length) localStorage.setItem(TPL_KEY, JSON.stringify(merged));
    } catch {}
    try { const s = localStorage.getItem(SENT_KEY); if (s) setSent(JSON.parse(s)); } catch {}
  }, []);
  const saveSent = (list: typeof sent) => { setSent(list); try { localStorage.setItem(SENT_KEY, JSON.stringify(list)); } catch {} };

  // Archiviazione conversazioni (come WhatsApp): nasconde dalla lista principale, viste a parte.
  const [archived, setArchived] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => { try { const a = localStorage.getItem("spigolestay:archived"); if (a) setArchived(JSON.parse(a)); } catch {} }, []);
  const isArch = (id: string) => archived.includes(id);
  const toggleArch = (id: string) => setArchived((a) => { const next = a.includes(id) ? a.filter((x) => x !== id) : [...a, id]; try { localStorage.setItem("spigolestay:archived", JSON.stringify(next)); } catch {} return next; });

  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [showInvii, setShowInvii] = useState(false); // gli invii programmati si aprono su richiesta, non di default
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Bozza assistita dall'AI (Claude) ──
  // aiUnavailable = la chiave non è configurata sul server → nascondi il pulsante con nota.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);

  // Ospiti con almeno una prenotazione (nella struttura attiva), ordinati per struttura poi alfabetico.
  const people = useMemo(() => {
    const map = new Map<string, { id: string; name: string; phone?: string; email?: string; struct: string; lastCheckIn: string; b: Booking }>();
    for (const b of bookings) {
      if (b.channel === "blocked" || b.status === "cancelled") continue;
      if (activeStructureId !== "all" && b.structureId !== activeStructureId) continue;
      const g = guests.find((x) => x.id === b.guestId); if (!g) continue;
      const cur = map.get(g.id);
      if (!cur || b.checkIn > cur.lastCheckIn) map.set(g.id, { id: g.id, name: g.fullName, phone: g.phone, email: g.email, struct: getStructure(b.structureId)?.name ?? "", lastCheckIn: b.checkIn, b });
    }
    let arr = [...map.values()];
    if (q.trim()) { const s = q.toLowerCase(); arr = arr.filter((p) => p.name.toLowerCase().includes(s) || (threads[p.id] ?? []).some((m) => m.text.toLowerCase().includes(s))); }
    arr = arr.filter((p) => (showArchived ? archived.includes(p.id) : !archived.includes(p.id)));
    return arr.sort((a, b) => (a.struct || "").localeCompare(b.struct || "") || a.name.localeCompare(b.name));
  }, [bookings, guests, activeStructureId, q, getStructure, archived, showArchived, threads]);
  const archivedCount = useMemo(() => {
    const ids = new Set<string>();
    for (const b of bookings) { if (b.channel === "blocked" || b.status === "cancelled") continue; if (activeStructureId !== "all" && b.structureId !== activeStructureId) continue; if (archived.includes(b.guestId)) ids.add(b.guestId); }
    return ids.size;
  }, [bookings, activeStructureId, archived]);

  const current = useMemo(() => {
    if (!sel) return null;
    const inList = people.find((p) => p.id === sel);
    if (inList) return inList;
    const g = guests.find((x) => x.id === sel);
    return g ? { id: g.id, name: g.fullName, phone: g.phone, email: g.email, struct: "", lastCheckIn: "", b: undefined as Booking | undefined } : null;
  }, [sel, people, guests]);
  const msgs = sel ? threads[sel] ?? [] : [];
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [sel, msgs.length]);

  const addTo = (gid: string, dir: "out" | "in", text: string, via?: string) => { if (!text.trim()) return; setThreads((tt) => ({ ...tt, [gid]: [...(tt[gid] ?? []), { id: uid(), dir, text: text.trim(), ts: Date.now(), via }] })); playSound(dir === "out" ? "sent" : "received"); };
  const add = (dir: "out" | "in", text: string, via?: string) => { if (sel) addTo(sel, dir, text, via); };

  // Collegamento WhatsApp Cloud API: se attivo, invio reale dall'app.
  const [wa, setWa] = useState({ connected: false, phoneId: "" });
  const [waTok, setWaTok] = useState("");
  const [waBusy, setWaBusy] = useState("");
  const waOn = wa.connected;
  useEffect(() => { apiPost<{ connected: boolean; phoneId: string }>("whatsapp/settings", { action: "status" }).then((r) => setWa({ connected: !!r.connected, phoneId: r.phoneId || "" })).catch(() => {}); }, []);
  const waSendReal = async (to: string, text: string) => { try { const r = await apiPost<{ ok: boolean }>("whatsapp/send", { to, text }); return !!r.ok; } catch { return false; } };
  const waSave = async () => {
    setWaBusy("save");
    try { const r = await apiPost<{ ok: boolean; message?: string }>("whatsapp/settings", { action: "save", token: waTok || undefined, phoneId: wa.phoneId }); window.alert(r.message || "Salvato"); setWaTok(""); const st = await apiPost<{ connected: boolean; phoneId: string }>("whatsapp/settings", { action: "status" }); setWa({ connected: !!st.connected, phoneId: st.phoneId || "" }); }
    catch (e) { window.alert(e instanceof Error ? e.message : "Errore"); } finally { setWaBusy(""); }
  };
  const waTest = async () => {
    setWaBusy("test");
    try { const r = await apiPost<{ ok: boolean; message?: string }>("whatsapp/settings", { action: "test" }); window.alert(r.message || (r.ok ? "OK" : "Errore")); }
    catch (e) { window.alert(e instanceof Error ? e.message : "Errore"); } finally { setWaBusy(""); }
  };

  const digits = (current?.phone ?? "").replace(/\D/g, "");
  const sendWa = async () => {
    if (!draft.trim()) return;
    const text = draft; add("out", text, "WhatsApp"); setDraft("");
    if (waOn && digits && await waSendReal(digits, text)) return; // inviato via Cloud API
    if (digits) window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };
  const sendMail = async () => {
    if (!draft.trim()) return;
    if (!current?.email) { window.alert(t("L'ospite non ha un'email.")); return; }
    const text = draft; const to = current.email;
    add("out", draft, "Email"); setDraft("");
    // Invio automatico dal server (Resend); ripiego Gmail se non configurato.
    try {
      const r = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "quote", to, subject: t("Messaggio"), text }) });
      const j = await r.json().catch(() => ({}));
      if (!(r.ok && j?.ok)) window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(t("Messaggio"))}&body=${encodeURIComponent(text)}`, "_blank");
    } catch { window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(t("Messaggio"))}&body=${encodeURIComponent(text)}`, "_blank"); }
  };
  const logIn = () => { const text = draft.trim() || window.prompt(t("Testo della risposta ricevuta dall'ospite:")) || ""; if (text.trim()) { add("in", text, "manuale"); setDraft(""); } };

  // Chiede a Claude una BOZZA di risposta nella lingua dell'ospite, basata sul thread + prenotazione.
  // La bozza precompila il campo risposta: l'operatore la modifica e invia col flusso esistente.
  const draftWithAi = async () => {
    if (!current || aiBusy) return;
    setAiBusy(true); setAiErr(false);
    try {
      const g = guests.find((x) => x.id === current.id);
      const b = current.b;
      const st = b ? getStructure(b.structureId) : undefined;
      const room = b ? (getUnit(b.unitId)?.name ?? getRoomType(b.roomTypeId)?.name ?? "") : "";
      const payload = {
        messages: (threads[current.id] ?? []).map((m) => ({ dir: m.dir, text: m.text })),
        lang: langOf(g),
        guestName: current.name,
        structureName: st?.name ?? current.struct ?? "",
        room,
        checkIn: b ? fmtLong(b.checkIn) : "",
        checkOut: b ? fmtLong(b.checkOut) : "",
      };
      // Fetch diretto (non apiPost) per leggere il body anche quando ok:false, distinguendo ai_not_configured.
      const token = (await supabase?.auth.getSession())?.data.session?.access_token;
      const res = await fetch("/api/ai/guest-reply", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
      const r = await res.json().catch(() => ({})) as { ok?: boolean; draft?: string; error?: string };
      if (r.ok && r.draft) { setDraft(r.draft); }
      else if (r.error === "ai_not_configured") { setAiUnavailable(true); }
      else { setAiErr(true); }
    } catch { setAiErr(true); }
    finally { setAiBusy(false); }
  };

  // ── Segnaposto e modelli ──
  const langOf = (g?: Guest): Lang => (["it", "en", "fr", "de", "es"].includes(g?.language ?? "") ? (g!.language as Lang) : "it");
  // Link della guida NUOVA, costruito dalla prenotazione: struttura + camera + codici (per camera,
  // filtrati dal parcheggio) + nome ospite. Legge i codici impostati per quella camera.
  const guideUrlFor = (b: Booking) => {
    const gu = guests.find((x) => x.id === b.guestId);
    const groupBk = b.groupId ? bookings.filter((x) => x.groupId === b.groupId) : [b];
    if (groupBk.length > 1) {
      return buildGroupGuestLink({ structureId: b.structureId, guestName: gu?.fullName || "", rooms: groupBk.map((bb) => ({ unitId: bb.unitId, unitCode: getUnit(bb.unitId)?.code || getUnit(bb.unitId)?.name || "", parking: !!bb.parking })) });
    }
    const unit = getUnit(b.unitId);
    return buildGuestLink({ structureId: b.structureId, unitId: b.unitId, unitCode: unit?.code || unit?.name || "", guestName: gu?.fullName || "", parking: !!b.parking });
  };
  const checkinUrlFor = (b: Booking) => `${typeof window !== "undefined" ? window.location.origin : ""}/checkin?b=${encodeURIComponent(b.id)}`;
  const nightsOf = (b: Booking) => Math.max(1, Math.round((new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / 86400000));
  const fmtLong = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long" });
  const fillFor = (raw: string, b: Booking, g: Guest) => {
    const st = getStructure(b.structureId); const unit = getUnit(b.unitId);
    const access = unit?.accessInfo || st?.accessInfo || "—";
    const balance = (b.total ?? 0) + (b.cleaningFee ?? 0) - (b.paid ?? 0);
    return raw
      .replace(/\{ospite\}/g, g.fullName.split(" ")[0])
      .replace(/\{struttura\}/g, st?.name ?? "")
      .replace(/\{camera\}/g, unit?.name ?? getRoomType(b.roomTypeId)?.name ?? "")
      .replace(/\{checkin\}/g, `${fmtLong(b.checkIn)}${st?.checkInFrom ? ` dalle ${st.checkInFrom}` : ""}`)
      .replace(/\{checkout\}/g, `${fmtLong(b.checkOut)}${st?.checkOutBy ? ` entro le ${st.checkOutBy}` : ""}`)
      .replace(/\{codice_accesso\}/g, access)
      .replace(/\{saldo\}/g, eur(Math.max(0, balance)))
      .replace(/\{notti\}/g, String(nightsOf(b)))
      .replace(/\{link_guida\}/g, guideUrlFor(b))
      .replace(/\{link_checkin\}/g, checkinUrlFor(b));
  };
  const insertTemplate = (id: string) => {
    const tpl = templates.find((x) => x.id === id); if (!tpl || !current) return;
    const g = guests.find((x) => x.id === current.id); const lg = langOf(g);
    const raw = tpl.texts[lg] || tpl.texts.it || "";
    setDraft(current.b && g ? fillFor(raw, current.b, g) : raw);
  };
  const insertGuide = async () => {
    if (!current) return; const g = guests.find((x) => x.id === current.id); const lg = langOf(g);
    const url = current.b ? await shortenLink(guideUrlFor(current.b)) : GUIDE_BASE;
    setDraft((d) => `${d.trim()}${d.trim() ? "\n\n" : ""}${GUIDE_MSG[lg](url)}`);
  };
  const insertCheckin = async () => {
    if (!current || !current.b) return; const g = guests.find((x) => x.id === current.id); const lg = langOf(g);
    const url = await shortenLink(checkinUrlFor(current.b));
    setDraft((d) => `${d.trim()}${d.trim() ? "\n\n" : ""}${CHECKIN_MSG[lg](url)}`);
  };

  // ── Coda invii automatici (calcolata sulle prenotazioni reali) ──
  const bookingsWithGuest = useMemo(() => bookings
    .filter((b) => (activeStructureId === "all" || b.structureId === activeStructureId) && b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked")
    .map((b) => ({ b, g: guests.find((x) => x.id === b.guestId)! })).filter((x) => x.g), [bookings, guests, activeStructureId]);
  const addDaysISO = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const todayISO = new Date().toISOString().slice(0, 10);
  // Finestra di RECUPERO: includiamo anche gli invii "scaduti" degli ultimi giorni, così un
  // last-minute (prenotazione creata DOPO l'orario del modello, o lo stesso giorno) non viene
  // perso: compare come "In ritardo · da inviare subito" invece di sparire.
  const queue = useMemo(() => {
    const catchupFrom = addDaysISO(todayISO, -3);
    return templates.filter((tp) => tp.active && tp.trigger !== "manual").flatMap((tp) =>
      bookingsWithGuest.map(({ b, g }) => {
        const anchor = tp.trigger === "before_arrival" ? addDaysISO(b.checkIn, -tp.days)
          : tp.trigger === "on_arrival" ? b.checkIn
          : tp.trigger === "after_arrival" ? addDaysISO(b.checkIn, tp.days)
          : tp.trigger === "on_checkout" ? b.checkOut : addDaysISO(b.checkOut, tp.days);
        return { key: `${tp.id}-${b.id}`, date: anchor, time: tp.time, tpl: tp, g, b, late: anchor < todayISO };
      })
    ).filter((x) => x.date >= catchupFrom).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)).slice(0, 40);
  }, [templates, bookingsWithGuest, todayISO]);

  const sendLinkFor = (tpl: MsgTemplate, b: Booking, g: Guest): { href: string; kind: "wa" | "email" } | null => {
    const body = fillFor(tpl.texts[langOf(g)] || tpl.texts.it || "", b, g);
    const dg = (g.phone ?? "").replace(/\D/g, "");
    if (dg) return { href: `https://wa.me/${dg}?text=${encodeURIComponent(body)}`, kind: "wa" };
    if (g.email) return { href: `mailto:${g.email}?subject=${encodeURIComponent(tpl.name)}&body=${encodeURIComponent(body)}`, kind: "email" };
    return null;
  };
  const sentKey = (x: { tpl: MsgTemplate; b: Booking; date: string }) => `${x.tpl.srcId || x.tpl.id}-${x.b.id}-${x.date}`;
  const isSent = (x: { tpl: MsgTemplate; b: Booking; date: string }) => sent.some((s) => s.key === sentKey(x));
  const sendScheduled = async (x: { tpl: MsgTemplate; b: Booking; g: Guest; date: string }) => {
    const l = sendLinkFor(x.tpl, x.b, x.g); if (!l) return;
    const body = fillFor(x.tpl.texts[langOf(x.g)] || x.tpl.texts.it || "", x.b, x.g);
    const dg = (x.g.phone ?? "").replace(/\D/g, "");
    // WhatsApp collegato + numero → invio reale; email → invio reale via server (Resend), non bozza mailto.
    let sentReal = false;
    if (l.kind === "wa") {
      sentReal = !!(waOn && dg && await waSendReal(dg, body));
    } else if (l.kind === "email" && x.g.email) {
      const st = getStructure(x.b.structureId);
      try {
        const r = await apiPost<{ ok?: boolean }>("email", { kind: "guest_message", to: x.g.email, subject: x.tpl.name, text: body, booking: { structureName: st?.name, structureEmail: st?.email } });
        sentReal = r?.ok !== false;
      } catch { sentReal = false; }
    }
    if (!sentReal) window.open(l.href, "_blank", "noopener"); // fallback: apre wa.me/mailto se l'invio reale non è possibile
    addTo(x.g.id, "out", body, l.kind === "wa" ? "WhatsApp" : "Email");
    saveSent([{ key: sentKey(x), guest: x.g.fullName, tpl: x.tpl.name, via: l.kind === "wa" ? "WhatsApp" : "Email", ts: Date.now() }, ...sent.filter((s) => s.key !== sentKey(x))].slice(0, 200));
  };
  // "Invia oggi" copre oggi + gli arretrati non ancora inviati (finestra di recupero).
  const todayQueue = queue.filter((x) => x.date <= todayISO && !isSent(x));
  const guestQueue = sel ? queue.filter((x) => x.g.id === sel && !isSent(x)) : [];

  const chipBase = "inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-dim";

  return (
    <>
    <div className="grid gap-4 lg:grid-cols-3 lg:gap-3">
      {/* Elenco (su cellulare: nascosto quando una conversazione/invii è aperta).
          Larghezza = 1/3 con gap-3 → allineata alla tab "Conversazioni" sopra. */}
      <div className={`${(current || showInvii) ? "hidden lg:flex" : "flex"} h-[calc(100vh-15rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm lg:col-span-1`}>
        <div className="border-b border-line p-2.5">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-faint">🔍</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cerca ospite…")} className="w-full rounded-xl border border-line bg-paper py-2 pl-9 pr-3 text-sm text-txt outline-none transition placeholder:text-faint focus:border-focus focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--focus)_20%,transparent)]" />
          </div>
        </div>
        {(showArchived || archivedCount > 0) && (
          <button onClick={() => setShowArchived((v) => !v)} className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-xs font-semibold text-dim hover:bg-wash">
            <span>{showArchived ? "←" : "🗄"}</span>
            <span className="flex-1">{showArchived ? t("Torna alle conversazioni") : t("Archiviate")}</span>
            {!showArchived && archivedCount > 0 && <span className="rounded-full bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-faint">{archivedCount}</span>}
          </button>
        )}
        <div className="flex-1 overflow-y-auto">
          {people.map((p, i) => {
            const th = threads[p.id] ?? []; const last = th[th.length - 1];
            const needsReply = !!last && last.dir === "in";
            const showHeader = activeStructureId === "all" && (i === 0 || people[i - 1].struct !== p.struct);
            const isSelected = sel === p.id;
            const sub = last ? preview(last, t) : `${fmtD(p.b.checkIn)} → ${fmtD(p.b.checkOut)} · ${CHANNELS[p.b.channel]?.label ?? ""}`;
            return (
              <div key={p.id}>
                {showHeader && <div className="sticky top-0 z-10 border-b border-line bg-wash px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">{p.struct || "—"}</div>}
                <div className={`group relative flex w-full items-center border-b border-[color:color-mix(in_srgb,var(--line)_55%,transparent)] pr-1 transition-colors ${isSelected ? "bg-[color:color-mix(in_srgb,var(--focus)_10%,transparent)]" : "hover:bg-wash"}`}>
                  {isSelected && <span className="absolute inset-y-1 left-0 w-[3px] rounded-full" style={{ backgroundColor: "var(--focus)" }} />}
                  <button onClick={() => setSel(p.id)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 text-left">
                    <span className="relative shrink-0">
                      <span className="grid h-11 w-11 place-items-center rounded-full text-sm font-bold text-white shadow-sm ring-1 ring-black/5" style={{ backgroundColor: avatarColor(p.name) }}>{initials(p.name)}</span>
                      <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[2px] shadow-sm ring-1 ring-line"><ChannelLogo channel={p.b.channel} size={12} /></span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm text-txt ${needsReply ? "font-bold" : "font-semibold"}`}>{p.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5">{last && <span className={`text-[10px] ${needsReply ? "font-semibold text-[color:var(--ok)]" : "text-faint"}`}>{relTime(last.ts, t)}</span>}{needsReply && <span className="h-2 w-2 rounded-full ring-2 ring-[color:color-mix(in_srgb,var(--ok)_30%,transparent)]" style={{ backgroundColor: "var(--ok)" }} title={t("Da rispondere")} />}</span>
                      </span>
                      <span className={`mt-0.5 block truncate text-xs ${needsReply ? "font-medium text-txt" : "text-dim"}`}>{sub}</span>
                    </span>
                  </button>
                  <button onClick={() => toggleArch(p.id)} title={isArch(p.id) ? t("Ripristina dalla archiviazione") : t("Archivia conversazione")} className={`shrink-0 rounded-lg px-1.5 py-1.5 text-sm text-faint transition hover:bg-line hover:text-txt ${isArch(p.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>{isArch(p.id) ? "⬆" : "🗄"}</button>
                </div>
              </div>
            );
          })}
          {people.length === 0 && <div className="px-3 py-10 text-center text-sm text-faint">{t("Nessun ospite.")}</div>}
        </div>
        {/* Accesso agli invii programmati, in fondo alla colonna conversazioni */}
        <button onClick={() => { setSel(null); setShowInvii(true); }} className={`flex items-center justify-center gap-2 border-t border-line px-3 py-2.5 text-xs font-semibold transition ${!current && showInvii ? "bg-wash text-focus" : "text-focus hover:bg-wash"}`}>
          📤 {t("Invii programmati")}{queue.length ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-bold">{queue.length}</span> : null}
        </button>
      </div>

      {/* Thread + invii programmati (su cellulare: visibile solo quando selezioni una conversazione/invii) */}
      <div className={`${(current || showInvii) ? "flex" : "hidden lg:flex"} h-[calc(100vh-15rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm lg:col-span-2`}>
        {!current ? (
          !showInvii ? (
            // Nessun ospite selezionato → placeholder pulito (gli invii si aprono col pulsante).
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl text-3xl shadow-sm ring-1 ring-line" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 8%, var(--surface))" }}>💬</div>
                <p className="text-sm font-semibold text-txt">{t("Le tue conversazioni")}</p>
                <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-relaxed text-faint">{t("Scegli un ospite dall'elenco a sinistra per aprire la chat e i dettagli della prenotazione.")}</p>
              </div>
            </div>
          ) : (
          // Vista invii programmati (aperta su richiesta).
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center gap-2">
              <button onClick={() => setShowInvii(false)} className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-dim hover:bg-wash">← {t("Indietro")}</button>
              <div className="min-w-0 flex-1 text-sm font-semibold text-txt">{t("Invii programmati")}</div>
              <button onClick={() => todayQueue.forEach(sendScheduled)} disabled={todayQueue.length === 0} className="shrink-0 rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Invia oggi")}{todayQueue.length ? ` (${todayQueue.length})` : ""}</button>
            </div>
            {queue.length === 0 ? (
              <p className="text-sm text-faint">{t("Nessun invio in coda. Crea un modello automatico in «Modelli & automazioni», poi qui lo invii e lo tracci.")}</p>
            ) : (
              <div className="flex flex-col divide-y divide-[color:var(--line)]">
                {queue.map((x) => (
                  <div key={x.key} className="flex items-center gap-3 py-2">
                    <div className="w-16 shrink-0 text-center"><div className="font-mono text-sm font-bold" style={{ color: x.late && !isSent(x) ? "var(--warn)" : "var(--txt)" }}>{new Date(x.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</div><div className="text-[10px] font-semibold" style={{ color: x.late && !isSent(x) ? "var(--warn)" : "var(--faint)" }}>{x.late && !isSent(x) ? `⏱ ${t("in ritardo")}` : x.time}</div></div>
                    <button onClick={() => setSel(x.g.id)} className="min-w-0 flex-1 text-left hover:underline"><div className="truncate text-sm text-txt"><b>{x.tpl.name}</b> → {x.g.fullName}</div><div className="text-[11px] text-faint">{getStructure(x.b.structureId)?.name} · {x.g.phone ? "WhatsApp" : x.g.email ? t("Email") : t("nessun contatto")}</div></button>
                    {isSent(x) ? (
                      <span className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>{t("Inviato")} ✓</span>
                    ) : (() => { const l = sendLinkFor(x.tpl, x.b, x.g); return l ? <button onClick={() => sendScheduled(x)} className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: l.kind === "wa" ? "#25D366" : "var(--focus)" }}>{t("Invia ora")}</button> : <span className="shrink-0 text-[11px] text-faint">{t("no contatto")}</span>; })()}
                  </div>
                ))}
              </div>
            )}
            {sent.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between"><div className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Registro invii")}</div><button onClick={() => saveSent([])} className="text-[11px] font-medium text-dim hover:text-txt">{t("Pulisci")}</button></div>
                <div className="flex flex-col divide-y divide-[color:var(--line)]">
                  {sent.slice(0, 12).map((s) => (
                    <div key={s.key} className="flex items-center gap-2.5 py-1.5 text-sm">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] text-white" style={{ backgroundColor: "var(--ok)" }}>✓</span>
                      <span className="flex-1 truncate text-txt"><b>{s.tpl}</b> → {s.guest}</span>
                      <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[10px] text-dim">{s.via}</span>
                      <span className="shrink-0 text-[11px] text-faint">{relTime(s.ts, t)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )
        ) : (
          <>
            <div className="border-b border-line bg-surface px-4 py-3">
              <div className="flex items-center gap-3">
                <button onClick={() => setSel(null)} title={t("Torna alle conversazioni")} className="shrink-0 rounded-lg border border-line px-2 py-1 text-sm text-dim hover:bg-wash lg:hidden">←</button>
                <span className="relative shrink-0">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white shadow-sm ring-1 ring-black/5" style={{ backgroundColor: avatarColor(current.name) }}>{initials(current.name)}</span>
                  {current.b && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[2px] shadow-sm ring-1 ring-line"><ChannelLogo channel={current.b.channel} size={12} /></span>}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-txt">{current.name}</span>
                  <span className="truncate text-[11px] text-faint">{[current.b ? (CHANNELS[current.b.channel]?.label ?? current.b.channel) : null, current.phone, current.email].filter(Boolean).join(" · ") || t("nessun contatto")}</span>
                </div>
                <button onClick={() => toggleArch(current.id)} title={isArch(current.id) ? t("Ripristina") : t("Archivia")} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-dim transition hover:bg-wash">{isArch(current.id) ? `⬆ ${t("Ripristina")}` : `🗄 ${t("Archivia")}`}</button>
              </div>
              {current.b && (() => {
                const b = current.b;
                const st = getStructure(b.structureId);
                const rt = getRoomType(b.roomTypeId);
                const room = getUnit(b.unitId)?.name ?? rt?.name ?? "—";
                const showStruct = activeStructureId === "all";
                const hasParking = (st?.services ?? []).some((s) => /parcheggi/i.test(s)) || (rt?.amenities ?? []).some((a) => /parcheggi/i.test(a));
                const g = guests.find((x) => x.id === b.guestId);
                const primaryOk = !!(g && (g.lastName || g.fullName) && g.sex && g.birthDate && g.birthPlace && g.citizenship && g.docType && g.docNumber);
                const schedinaOk = primaryOk && (b.extraGuests ?? []).every((c) => c.lastName && c.firstName && c.sex && c.birthDate && c.birthPlace && c.citizenship);
                const guidaSent = (threads[b.guestId] ?? []).some((m) => m.dir === "out" && /guest-guide|\/guida|guida ospiti/i.test(m.text));
                const totale = (b.total ?? 0) + (b.cleaningFee ?? 0);
                const paid = b.paid ?? 0;
                const saldato = totale > 0 && paid >= totale - 0.01;
                const residuo = Math.max(0, totale - paid);
                const ok = { backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)", borderColor: "transparent" } as const;
                const warn = { backgroundColor: "color-mix(in srgb, var(--warn) 15%, transparent)", color: "var(--warn)", borderColor: "transparent" } as const;
                return (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={chipBase} title={t("Come hanno prenotato")}><ChannelLogo channel={b.channel} size={13} /> {CHANNELS[b.channel]?.label ?? b.channel}</span>
                    <span className={chipBase} title={t("Check-in → Check-out")}>📅 {fmtD(b.checkIn)} → {fmtD(b.checkOut)}</span>
                    <span className={chipBase} title={t("Camera")}>🛏 {room}{showStruct && st?.name ? ` · ${st.name}` : ""}</span>
                    <span className={chipBase} style={hasParking ? ok : undefined} title={t("Parcheggio")}>🅿 {hasParking ? t("Parcheggio") : t("No parcheggio")}</span>
                    <span className={chipBase} style={schedinaOk ? ok : warn} title={t("Schedina alloggiati (Questura)")}>📋 {schedinaOk ? t("Schedina ok") : t("Schedina da compilare")}</span>
                    <span className={chipBase} style={guidaSent ? ok : undefined} title={t("Guida ospiti inviata in chat")}>📖 {guidaSent ? t("Guida inviata") : t("Guida non inviata")}</span>
                    {totale > 0
                      ? <span className={chipBase} style={saldato ? ok : warn} title={t("Pagamento")}>💳 {saldato ? `${t("Pagato")} · ${eur(totale)}` : (paid > 0 ? `${t("Acconto")} ${eur(paid)} · ${t("resta")} ${eur(residuo)}` : `${t("Da incassare")} ${eur(totale)}`)}</span>
                      : <span className={chipBase} title={t("Pagamento")}>💳 {t("Importo n/d")}</span>}
                  </div>
                );
              })()}
            </div>

            <div ref={scrollRef} className="flex-1 space-y-0.5 overflow-y-auto px-4 py-4" style={{ background: "color-mix(in srgb, var(--focus) 4%, var(--wash))" }}>
              {msgs.length === 0 && <div className="mt-6 text-center text-xs text-faint">{t("Nessun messaggio. Scrivi qui sotto per iniziare.")}</div>}
              {msgs.map((m, i) => {
                const prev = msgs[i - 1];
                const next = msgs[i + 1];
                const showDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
                const out = m.dir === "out";
                // Ultimo di un gruppo consecutivo dello stesso mittente → mostra coda + orario.
                const groupEnd = !next || next.dir !== m.dir || new Date(next.ts).toDateString() !== new Date(m.ts).toDateString();
                const hhmm = new Date(m.ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={m.id}>
                    {showDay && <div className="my-4 flex justify-center"><span className="rounded-full border border-line bg-surface px-3 py-1 text-[10px] font-semibold capitalize text-dim shadow-sm">{dayLabel(m.ts, t)}</span></div>}
                    <div className={`flex ${groupEnd ? "mb-2.5" : "mb-0.5"} ${out ? "justify-end" : "justify-start"}`}>
                      <div className={`flex max-w-[78%] flex-col ${out ? "items-end" : "items-start"}`}>
                        <div
                          className={`relative rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${out ? `text-white ${groupEnd ? "rounded-br-sm" : ""}` : `border border-line bg-surface text-txt ${groupEnd ? "rounded-bl-sm" : ""}`}`}
                          style={out ? { backgroundColor: "var(--focus)" } : undefined}
                        >
                          {groupEnd && (
                            out
                              ? <span className="absolute -right-1 bottom-0 h-3 w-3 [clip-path:polygon(0_0,0_100%,100%_100%)]" style={{ backgroundColor: "var(--focus)" }} />
                              : <span className="absolute -left-1 bottom-0 h-3 w-3 border-b border-l border-line bg-surface [clip-path:polygon(100%_0,0_100%,100%_100%)]" />
                          )}
                          <div className="whitespace-pre-wrap break-words">{m.text}</div>
                        </div>
                        {groupEnd && <div className="mt-1 px-1 text-[10px] text-faint">{hhmm}{m.via ? ` · ${m.via}` : ""}</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Invii programmati per QUESTO ospite */}
            {guestQueue.length > 0 && (
              <div className="border-t border-line bg-paper px-3 py-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{t("Invii automatici in arrivo")}</div>
                <div className="flex flex-col gap-1.5">
                  {guestQueue.slice(0, 3).map((x) => (
                    <div key={x.key} className="flex items-center gap-2 text-xs">
                      <span className="shrink-0 rounded-full bg-wash px-1.5 py-0.5 font-mono text-[10px] text-dim">{new Date(x.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</span>
                      <span className="min-w-0 flex-1 truncate text-txt">{x.tpl.name}</span>
                      <button onClick={() => sendScheduled(x)} className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: (x.g.phone ? "#25D366" : "var(--focus)") }}>{t("Invia ora")}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-line bg-surface p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <select onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v === "__manage__") { if (onManageTemplates) onManageTemplates(); else router.push("/modelli"); } else if (v) insertTemplate(v); }} defaultValue="" className="rounded-full border border-line bg-paper px-3 py-1 text-xs text-dim outline-none transition hover:bg-wash focus:border-focus">
                  <option value="">{t("Inserisci un modello…")}</option>
                  {templates.map((tp) => (<option key={tp.id} value={tp.id}>{tp.name}</option>))}
                  {templates.length > 0 && <option disabled>──────────</option>}
                  <option value="__manage__">✎ {t("Gestisci modelli…")}</option>
                </select>
                <button onClick={insertGuide} className="rounded-full border border-line px-3 py-1 text-xs font-medium text-dim transition hover:bg-wash hover:text-txt">📖 {t("Guida ospiti")}</button>
                {current.b && <button onClick={insertCheckin} title={t("Invia il link per il check-in online (compila la schedina alloggiati)")} className="rounded-full border border-line px-3 py-1 text-xs font-medium text-dim transition hover:bg-wash hover:text-txt">📝 {t("Check-in online")}</button>}
                {aiUnavailable ? (
                  <span className="rounded-full border border-dashed border-line px-3 py-1 text-xs font-medium text-faint" title={t("La risposta assistita dall'AI sarà attivata a breve")}>✨ {t("Bozza con AI")} · {t("disponibile a breve")}</span>
                ) : (
                  <button onClick={draftWithAi} disabled={aiBusy} title={t("Proponi una bozza di risposta nella lingua dell'ospite (da rivedere prima di inviare)")} className="rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-50" style={{ borderColor: "color-mix(in srgb, var(--focus) 40%, transparent)", color: "var(--focus)", backgroundColor: "color-mix(in srgb, var(--focus) 8%, transparent)" }}>{aiBusy ? `✨ ${t("Scrivo…")}` : `✨ ${t("Bozza con AI")}`}</button>
                )}
                {aiErr && <span className="text-[11px] text-[color:var(--err)]">{t("Non sono riuscito a generare la bozza. Riprova.")}</span>}
              </div>
              <div className="rounded-2xl border border-line bg-paper p-2 transition focus-within:border-focus focus-within:ring-2 focus-within:ring-[color:color-mix(in_srgb,var(--focus)_18%,transparent)]">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={t("Scrivi un messaggio…")} className="w-full resize-none bg-transparent px-1.5 py-1 text-sm text-txt outline-none placeholder:text-faint" />
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button onClick={sendWa} disabled={!draft.trim()} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "#25D366" }}>💬 WhatsApp</button>
                  <button onClick={sendMail} disabled={!draft.trim() || !current.email} className="inline-flex items-center gap-1.5 rounded-full bg-focus px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40">✉ Email</button>
                  <button onClick={logIn} className="ml-auto rounded-full border border-line px-3 py-1.5 text-sm font-medium text-dim transition hover:bg-wash hover:text-txt" title={t("Registra una risposta arrivata dall'ospite")}>＋ {t("Risposta ricevuta")}</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>

    {/* Collega WhatsApp — sotto il box messaggi */}
    <div className="mt-4 rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-txt">📲 {t("Collega WhatsApp")}</span>
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${wa.connected ? "var(--ok)" : "var(--faint)"} 16%, transparent)`, color: wa.connected ? "var(--ok)" : "var(--dim)" }}>{wa.connected ? t("collegato") : t("non collegato")}</span>
        </div>
        <span className="text-[11px] text-faint">{t("Invio reale dall'app (Cloud API di Meta). Senza collegamento resta l'invio via wa.me.")}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input value={wa.phoneId} onChange={(e) => setWa((w) => ({ ...w, phoneId: e.target.value }))} placeholder={t("Phone Number ID")} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
        <input type="password" value={waTok} onChange={(e) => setWaTok(e.target.value)} placeholder={wa.connected ? t("Token (salvato — vuoto = non cambiare)") : t("Token Meta")} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
        <button onClick={waSave} disabled={!!waBusy} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{waBusy === "save" ? t("Salvo…") : t("Salva")}</button>
        <button onClick={waTest} disabled={!!waBusy || !wa.connected} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{waBusy === "test" ? t("Test…") : t("Test")}</button>
      </div>
    </div>
    </>
  );
}
