"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import type { Booking, Guest } from "@/lib/types";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { playSound } from "@/lib/sound";
import { useLang } from "@/lib/i18n";

type Lang = "it" | "en" | "fr" | "de" | "es";
type Kind = "welcome" | "checkin" | "thanks";
type Trigger = "manual" | "before_arrival" | "on_arrival" | "after_arrival" | "on_checkout" | "after_checkout";

const LANGS: [Lang, string][] = [["it", "Italiano"], ["en", "English"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]];
const KINDS: [Kind, string][] = [["welcome", "Benvenuto"], ["checkin", "Istruzioni check-in"], ["thanks", "Ringraziamento"]];
interface MsgTemplate {
  id: string;
  name: string;
  texts: Record<Lang, string>;
  trigger: Trigger;
  days: number;
  time: string;
  active: boolean;
  srcId?: string; // se creato dalle automazioni "Da fare oggi" della Dashboard
}

const TEMPLATES: Record<Lang, Record<Kind, (g: string, s: string) => string>> = {
  it: { welcome: (g, s) => `Ciao ${g}, grazie per aver prenotato ${s}! Siamo felici di ospitarti.`, checkin: (g, s) => `Ciao ${g}, ecco le istruzioni per il check-in a ${s}. Orario dalle 15:00.`, thanks: (g) => `Grazie ${g} per aver soggiornato con noi! Una recensione ci aiuterebbe molto.` },
  en: { welcome: (g, s) => `Hi ${g}, thanks for booking ${s}! We're happy to host you.`, checkin: (g, s) => `Hi ${g}, here are the check-in instructions for ${s}. Check-in from 3 PM.`, thanks: (g) => `Thank you ${g} for staying with us! A review would help us a lot.` },
  fr: { welcome: (g, s) => `Bonjour ${g}, merci d'avoir réservé ${s} !`, checkin: (g, s) => `Bonjour ${g}, voici les instructions d'arrivée pour ${s}. Arrivée à partir de 15h.`, thanks: (g) => `Merci ${g} pour votre séjour ! Un avis nous aiderait beaucoup.` },
  de: { welcome: (g, s) => `Hallo ${g}, danke für die Buchung von ${s}!`, checkin: (g, s) => `Hallo ${g}, hier die Check-in-Infos für ${s}. Check-in ab 15 Uhr.`, thanks: (g) => `Danke ${g} für Ihren Aufenthalt! Eine Bewertung würde uns sehr helfen.` },
  es: { welcome: (g, s) => `Hola ${g}, ¡gracias por reservar ${s}!`, checkin: (g, s) => `Hola ${g}, estas son las instrucciones de entrada para ${s}. Entrada desde las 15:00.`, thanks: (g) => `¡Gracias ${g} por tu estancia! Una reseña nos ayudaría mucho.` },
};

export default function MessaggiPage() {
  const { bookings, guests, getStructure, getUnit, getRoomType, activeStructureId } = useData();
  const ask = useConfirm();
  const { t } = useLang();
  const withGuest = bookings.filter((b) => activeStructureId === "all" || b.structureId === activeStructureId).map((b) => ({ b, g: guests.find((x) => x.id === b.guestId)! })).filter((x) => x.g);

  const [selId, setSelId] = useState<string>(withGuest[0]?.b.id ?? "");
  const [lang, setLang] = useState<Lang>("it");
  const [kind, setKind] = useState<Kind>("welcome");
  const sel = withGuest.find((x) => x.b.id === selId);

  // Modelli salvati (persistiti)
  const [templates, setTemplates] = useState<MsgTemplate[]>([]);
  const [ready, setReady] = useState(false);
  // Carica una sola volta e sblocca il salvataggio nello stesso passo (evita la race che azzera i dati).
  useEffect(() => { try { const raw = localStorage.getItem("spigolestay:msgtemplates"); if (raw) setTemplates(JSON.parse(raw)); } catch {} setReady(true); }, []);
  useEffect(() => { if (!ready) return; try { localStorage.setItem("spigolestay:msgtemplates", JSON.stringify(templates)); } catch {} }, [templates, ready]);

  const defaultText = useMemo(() => (sel ? TEMPLATES[lang][kind](sel.g.fullName.split(" ")[0], getStructure(sel.b.structureId)?.name ?? "") : ""), [sel, lang, kind, getStructure]);
  const [text, setText] = useState(defaultText);
  useMemo(() => setText(defaultText), [defaultText]);

  const guideBase = "https://spigole-guest-guide.vercel.app";
  const guideUrlFor = (b: Booking) => ((getStructure(b.structureId)?.name ?? "").toLowerCase().includes("central perk") ? `${guideBase}/?p=centralperk` : guideBase);
  const nightsOf = (b: Booking) => Math.max(1, Math.round((new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / 86400000));
  const fmtD = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long" });
  const fillFor = (raw: string, b: Booking, g: Guest) => {
    const st = getStructure(b.structureId);
    const unit = getUnit(b.unitId);
    const access = unit?.accessInfo || st?.accessInfo || "—";
    const balance = (b.total ?? 0) + (b.cleaningFee ?? 0) - (b.paid ?? 0);
    return raw
      .replace(/\{ospite\}/g, g.fullName.split(" ")[0])
      .replace(/\{struttura\}/g, st?.name ?? "")
      .replace(/\{camera\}/g, unit?.name ?? getRoomType(b.roomTypeId)?.name ?? "")
      .replace(/\{checkin\}/g, `${fmtD(b.checkIn)}${st?.checkInFrom ? ` dalle ${st.checkInFrom}` : ""}`)
      .replace(/\{checkout\}/g, `${fmtD(b.checkOut)}${st?.checkOutBy ? ` entro le ${st.checkOutBy}` : ""}`)
      .replace(/\{codice_accesso\}/g, access)
      .replace(/\{saldo\}/g, eur(Math.max(0, balance)))
      .replace(/\{notti\}/g, String(nightsOf(b)))
      .replace(/\{link_guida\}/g, guideUrlFor(b));
  };
  const fill = (raw: string) => (sel ? fillFor(raw, sel.b, sel.g) : raw);
  const useSaved = (id: string) => { const t = templates.find((x) => x.id === id); if (t) setText(fill(t.texts[lang] || t.texts.it || "")); };

  const guideUrl = sel ? guideUrlFor(sel.b) : guideBase;
  const GUIDE: Record<Lang, (u: string) => string> = {
    it: (u) => `Qui trovi la guida con tutte le info utili (check-in, wi-fi, dintorni): ${u}`,
    en: (u) => `Here is our guest guide with all the useful info: ${u}`,
    fr: (u) => `Voici le guide avec toutes les infos utiles : ${u}`,
    de: (u) => `Hier ist der Gäste-Guide mit allen Infos: ${u}`,
    es: (u) => `Aquí tienes la guía con toda la información útil: ${u}`,
  };
  const addGuide = () => setText((t) => `${t.trim()}\n\n${GUIDE[lang](guideUrl)}`);

  const waLink = sel?.g.phone ? `https://wa.me/${sel.g.phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}` : "#";
  const mailLink = sel?.g.email ? `mailto:${sel.g.email}?subject=${encodeURIComponent("SpigoleStay")}&body=${encodeURIComponent(text)}` : "#";

  // Coda dei prossimi invii automatici, calcolata sulle prenotazioni reali.
  const addDaysISO = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const todayISO = new Date().toISOString().slice(0, 10);
  const queue = templates.filter((t) => t.active && t.trigger !== "manual").flatMap((t) =>
    withGuest.filter((x) => x.b.status !== "cancelled").map(({ b, g }) => {
      const anchor =
        t.trigger === "before_arrival" ? addDaysISO(b.checkIn, -t.days)
        : t.trigger === "on_arrival" ? b.checkIn
        : t.trigger === "after_arrival" ? addDaysISO(b.checkIn, t.days)
        : t.trigger === "on_checkout" ? b.checkOut
        : addDaysISO(b.checkOut, t.days);
      return { key: `${t.id}-${b.id}`, date: anchor, time: t.time, tpl: t, g, b };
    })
  ).filter((x) => x.date >= todayISO).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)).slice(0, 20);

  // Link d'invio pronto (WhatsApp se c'è il numero, altrimenti Email) per una riga di coda.
  const sendLinkFor = (tpl: MsgTemplate, b: Booking, g: Guest): { href: string; kind: "wa" | "email" } | null => {
    const lg = (["it", "en", "fr", "de", "es"].includes(g.language ?? "") ? (g.language as Lang) : "it");
    const body = fillFor(tpl.texts[lg] || tpl.texts.it || "", b, g);
    const digits = (g.phone ?? "").replace(/\D/g, "");
    if (digits) return { href: `https://wa.me/${digits}?text=${encodeURIComponent(body)}`, kind: "wa" };
    if (g.email) return { href: `mailto:${g.email}?subject=${encodeURIComponent(tpl.name)}&body=${encodeURIComponent(body)}`, kind: "email" };
    return null;
  };

  // Registro degli invii effettuati (persistito, scritto sull'azione).
  const [sent, setSent] = useState<{ key: string; guest: string; tpl: string; via: string; ts: number }[]>([]);
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:msgsent"); if (r) setSent(JSON.parse(r)); } catch {} }, []);
  const saveSent = (list: typeof sent) => { setSent(list); try { localStorage.setItem("spigolestay:msgsent", JSON.stringify(list)); } catch {} };
  const sentKey = (q: { tpl: MsgTemplate; b: Booking; date: string }) => `${q.tpl.srcId || q.tpl.id}-${q.b.id}-${q.date}`;
  const isSent = (q: { tpl: MsgTemplate; b: Booking; date: string }) => sent.some((s) => s.key === sentKey(q));
  const sentAt = (q: { tpl: MsgTemplate; b: Booking; date: string }) => sent.find((s) => s.key === sentKey(q))?.ts;
  const markSent = (q: { tpl: MsgTemplate; b: Booking; g: Guest; date: string }, via: string) => { const k = sentKey(q); saveSent([{ key: k, guest: q.g.fullName, tpl: q.tpl.name, via, ts: Date.now() }, ...sent.filter((s) => s.key !== k)].slice(0, 200)); };
  const relTime = (ts: number) => { const d = Math.floor((Date.now() - ts) / 60000); if (d < 1) return t("adesso"); if (d < 60) return `${d} ${t("min fa")}`; if (d < 1440) return `${Math.floor(d / 60)} ${t("h fa")}`; return `${Math.floor(d / 1440)} ${t("g fa")}`; };

  return (
    <div>
      <PageHeader
        title={t("Centro messaggi")}
        subtitle={t("Conversazioni e invii · scrivi all'ospite o invia quelli in coda")}
        actions={<Link href="/modelli" className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">{t("Modelli & automazioni →")}</Link>}
      />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface shadow-sm">
            {withGuest.map(({ b, g }) => (
              <button key={b.id} onClick={() => setSelId(b.id)} className={`flex w-full flex-col border-b border-line px-3 py-2.5 text-left last:border-0 ${selId === b.id ? "bg-wash" : "hover:bg-wash"}`}>
                <span className="text-sm font-medium text-txt">{g.fullName}</span>
                <span className="text-xs text-dim">{getStructure(b.structureId)?.name} · {b.checkIn}</span>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            {sel ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">{LANGS.map(([l, n]) => (<option key={l} value={l}>{n}</option>))}</select>
                  <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">{KINDS.map(([k, n]) => (<option key={k} value={k}>{t(n)}</option>))}</select>
                  {templates.length > 0 && (
                    <select onChange={(e) => { if (e.target.value) useSaved(e.target.value); e.target.value = ""; }} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" defaultValue="">
                      <option value="">{t("Modello salvato…")}</option>
                      {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                  )}
                  <button onClick={addGuide} className="rounded-lg border border-line px-2.5 py-1.5 text-sm font-medium text-txt hover:bg-wash">{t("+ Guida ospiti")}</button>
                  <span className="text-xs text-faint">{t("a")} {sel.g.fullName}</span>
                </div>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} className="w-full resize-none rounded-lg border border-line bg-paper p-3 text-sm text-txt outline-none focus:border-focus" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={mailLink} onClick={() => playSound("sent")} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white">{t("Invia email")}</a>
                  <a href={waLink} onClick={() => playSound("sent")} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ backgroundColor: "#25D366" }}>WhatsApp</a>
                  <span className="self-center text-xs text-faint">{sel.g.email} · {sel.g.phone}</span>
                </div>
              </>
            ) : <div className="text-sm text-faint">{t("Nessun ospite.")}</div>}
          </div>
        </div>

      <div className="mt-5 flex flex-col gap-4">
          {/* Prossimi invii programmati */}
          <Card>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>{t("Prossimi invii programmati")}</SectionTitle>
              {(() => {
                const todaySends = queue.filter((q) => q.date === todayISO);
                return (
                  <button
                    onClick={() => { const done: typeof sent = []; todaySends.forEach((q) => { const l = sendLinkFor(q.tpl, q.b, q.g); if (l) { window.open(l.href, "_blank", "noopener"); done.push({ key: sentKey(q), guest: q.g.fullName, tpl: q.tpl.name, via: l.kind === "wa" ? "WhatsApp" : "Email", ts: Date.now() }); } }); if (done.length) saveSent([...done, ...sent.filter((s) => !done.some((d) => d.key === s.key))].slice(0, 200)); }}
                    disabled={todaySends.length === 0}
                    className="rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
                  >{t("Invia tutti quelli di oggi")}{todaySends.length ? ` (${todaySends.length})` : ""}</button>
                );
              })()}
            </div>
            {queue.length === 0 ? <p className="text-sm text-faint">{t("Nessun invio in coda. Apri un modello qui sopra e imposta l'invio automatico.")}</p> : (
              <div className="flex flex-col divide-y divide-[color:var(--line)]">
                {queue.map((q) => (
                  <div key={q.key} className="flex items-center gap-3 py-2">
                    <div className="w-16 shrink-0 text-center"><div className="font-mono text-sm font-bold text-txt">{new Date(q.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</div><div className="text-[10px] text-faint">{q.time}</div></div>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm text-txt"><b>{q.tpl.name}</b> → {q.g.fullName}</div><div className="text-[11px] text-faint">{getStructure(q.b.structureId)?.name} · {q.g.phone ? "WhatsApp" : q.g.email ? t("Email") : t("nessun contatto")}</div></div>
                    <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[10px] text-dim">{t("auto")}</span>
                    {isSent(q) ? (
                      <span className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }} title={`${t("Inviato")} ${relTime(sentAt(q)!)}`}>{t("Inviato")} ✓</span>
                    ) : (() => { const l = sendLinkFor(q.tpl, q.b, q.g); return l ? <a href={l.href} onClick={() => { markSent(q, l.kind === "wa" ? "WhatsApp" : "Email"); playSound("sent"); }} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: l.kind === "wa" ? "#25D366" : "var(--focus)" }}>{t("Invia ora")}</a> : <span className="shrink-0 text-[11px] text-faint">{t("no contatto")}</span>; })()}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Registro invii effettuati */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle>{t("Registro invii")}</SectionTitle>
              {sent.length > 0 && <button onClick={async () => { if (await ask({ title: t("Svuota registro"), message: t("Svuotare il registro degli invii?"), danger: true, confirmLabel: t("Svuota") })) saveSent([]); }} className="text-xs font-medium text-dim hover:text-txt">{t("Pulisci")}</button>}
            </div>
            {sent.length === 0 ? <p className="text-sm text-faint">{t("Nessun invio ancora effettuato. Usa «Invia ora» dalla coda qui sopra.")}</p> : (
              <div className="flex flex-col divide-y divide-[color:var(--line)]">
                {sent.slice(0, 15).map((s) => (
                  <div key={s.key} className="flex items-center gap-2.5 py-2 text-sm">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] text-white" style={{ backgroundColor: "var(--ok)" }}>✓</span>
                    <span className="flex-1 truncate text-txt"><b>{s.tpl}</b> → {s.guest}</span>
                    <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[10px] text-dim">{s.via}</span>
                    <span className="shrink-0 text-[11px] text-faint">{relTime(s.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

      </div>
    </div>
  );
}
