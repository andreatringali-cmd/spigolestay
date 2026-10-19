// Messaggi all'ospite condivisi tra la chat e la vista prenotazioni: testi nelle 5 lingue,
// invio WhatsApp/email e registrazione nella conversazione. Solo lato browser.

import { useCallback, useEffect, useState } from "react";
import { windowOpenFrom } from "./wa-window";
import type { Guest } from "./types";
import { apiPost } from "./invoicing/client";
import { waDigits } from "./contacts-check";
import { guestLangOf } from "./guest-lang";
import { renderSystemMessage } from "./msg-overrides";

export type Lang = "it" | "en" | "fr" | "de" | "es";

// I testi di questi messaggi sono MODIFICABILI (Messaggi → Modelli): quelli predefiniti e i segnaposto stanno in msg-overrides.ts.
const L = ["it", "en", "fr", "de", "es"] as const;
const perLang = <A extends unknown[]>(make: (lang: Lang, ...a: A) => string): Record<Lang, (...a: A) => string> => Object.fromEntries(L.map((l) => [l, (...a: A) => make(l, ...a)])) as Record<Lang, (...a: A) => string>;

export const GUIDE_MSG: Record<Lang, (u: string) => string> = perLang((lang, u: string) => renderSystemMessage("guide", lang, { link: u }));
export const CHECKIN_MSG: Record<Lang, (u: string) => string> = perLang((lang, u: string) => renderSystemMessage("checkin", lang, { link: u }));

const GUEST_FALLBACK: Record<Lang, string> = { it: "ospite", en: "guest", fr: "cher client", de: "lieber Gast", es: "huésped" };
const HOST_FALLBACK: Record<Lang, string> = { it: "la struttura", en: "your host", fr: "votre hôte", de: "Ihre Unterkunft", es: "el alojamiento" };
// Richiesta di check-in dalla riga "arrivi senza check-in" (Adempimenti): firmata dalla struttura, con il link già accorciato.
export function checkinRequestMsg(lang: Lang, o: { name?: string; structure?: string; link: string }): string {
  const n = (o.name ?? "").trim(), s = (o.structure ?? "").trim();
  return renderSystemMessage("checkinRequest", lang, { nome: n || GUEST_FALLBACK[lang], struttura: s || HOST_FALLBACK[lang], firma: s, link: o.link });
}

// Check-in incompleto: manca qualche ospite (n = quanti).
const OTHERS: Record<Lang, [string, string]> = { it: ["altro ospite", "altri ospiti"], en: ["guest", "guests"], fr: ["autre personne", "autres personnes"], de: ["Person", "Personen"], es: ["huésped más", "huéspedes más"] };
export const CHECKIN_MORE_MSG: Record<Lang, (n: number, u: string) => string> = perLang((lang, n: number, u: string) => renderSystemMessage("checkinMore", lang, { n, altri: OTHERS[lang][n === 1 ? 0 : 1], link: u }));
// Apertura dei solleciti: si antepone al messaggio normale.
export const reminderIntro = (lang: Lang): string => renderSystemMessage("reminderIntro", lang, {});

// Promemoria di partenza: data e orario del check-out, come contattare la struttura, ringraziamento.
const AT_TIME: Record<Lang, (t: string) => string> = { it: (t) => ` entro le ${t}`, en: (t) => ` by ${t}`, fr: (t) => ` avant ${t}`, de: (t) => ` bis ${t} Uhr`, es: (t) => ` antes de las ${t}` };
const US_FALLBACK: Record<Lang, string> = { it: "la nostra struttura", en: "us", fr: "notre établissement", de: "uns", es: "nuestro alojamiento" };
export function checkoutMessage(lang: Lang, o: { date: string; time?: string; structure?: string }): string {
  const t = (o.time ?? "").trim(), s = (o.structure ?? "").trim();
  return renderSystemMessage("checkout", lang, { data: o.date, orario: t ? AT_TIME[lang](t) : "", struttura: s || US_FALLBACK[lang] });
}

export const langOf = (g?: Guest): Lang => guestLangOf(g); // lingua della scheda, altrimenti dal Paese o dal prefisso del telefono (gli ospiti OTA non hanno la lingua)
export const greeting = (lang: Lang, g?: Guest): string => {
  const first = (g?.firstName || g?.fullName || "").split(" ")[0];
  const hi: Record<Lang, string> = { it: "Gentile", en: "Dear", fr: "Cher/Chère", de: "Liebe/r", es: "Estimado/a" };
  return first ? `${hi[lang]} ${first}, ` : "";
};

const THREADS_KEY = "spigolestay:threads:v1";
/** Aggiunge un messaggio inviato alla conversazione dell'ospite (così Messaggi lo mostra). */
export interface SendMeta { bid: string; rem: string } // a quale prenotazione e a quale promemoria appartiene il messaggio
export function recordOutgoing(guestId: string, text: string, via: string, wid?: string, meta?: SendMeta) {
  try {
    const all = JSON.parse(localStorage.getItem(THREADS_KEY) || "{}") as Record<string, unknown[]>;
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    all[guestId] = [...(all[guestId] ?? []), { id, dir: "out", text, ts: Date.now(), via, ...(meta ? { bid: meta.bid, rem: meta.rem } : {}), ...(wid ? { wid, st: "sent" } : {}) }];
    localStorage.setItem(THREADS_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event("spigolestay:threads"));
  } catch {}
}

// Registro "ultimo sollecito" per prenotazione e tipo: mostra "Sollecitato il 3/10" e distingue "non inviato" da "inviato, in attesa".
const REM_KEY = "spigolestay:pren:reminders";
type RemMap = Record<string, Record<string, number>>;
export function readReminders(): RemMap { try { return JSON.parse(localStorage.getItem(REM_KEY) || "{}") as RemMap; } catch { return {}; } }
export function markReminder(bookingId: string, kind: string) {
  try { const m = readReminders(); m[bookingId] = { ...(m[bookingId] ?? {}), [kind]: Date.now() }; localStorage.setItem(REM_KEY, JSON.stringify(m)); window.dispatchEvent(new Event("spigolestay:reminders")); } catch {}
}

let waStatus: boolean | null = null;
async function whatsappConnected(): Promise<boolean> {
  if (waStatus !== null) return waStatus;
  try { waStatus = !!(await apiPost<{ connected: boolean }>("whatsapp/settings", { action: "status" })).connected; } catch { waStatus = false; }
  return waStatus;
}

export type SendResult = { ok: boolean; how: "api" | "link" | "none"; message: string };

/** Finestra WhatsApp aperta per questo ospite? Si legge l'ultimo messaggio ricevuto dalla chat; se la chat non si legge si considera aperta (nessun blocco inutile). */
export function whatsappWindowOpen(guestId: string, now = Date.now()): boolean {
  try { return windowOpenFrom(JSON.parse(localStorage.getItem("spigolestay:threads:v1") || "{}"), guestId, now); } catch { return true; }
}

/** WhatsApp: se la Cloud API è collegata invia davvero (e registra in chat); altrimenti apre wa.me col testo pronto. */
/** WhatsApp Business API messa da parte (ottobre 2026): ogni invio apre WhatsApp col testo pronto (wa.me) e lo manda il titolare dal proprio telefono. */
export const WHATSAPP_API_ENABLED = false;

export async function sendWhatsAppToGuest(g: Guest | undefined, text: string, meta?: SendMeta): Promise<SendResult> {
  const digits = waDigits(g?.phone, g?.country); // con il prefisso del Paese anche se il numero è stato scritto senza
  if (!g || !digits) return { ok: false, how: "none", message: "L'ospite non ha un numero di telefono." };
  const wa = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  if (WHATSAPP_API_ENABLED && (await whatsappConnected())) {
    // Finestra chiusa: la Cloud API non consegnerebbe il testo libero. Meglio dirlo subito e aprire WhatsApp col testo pronto (da lì parte dal tuo telefono e arriva).
    if (!whatsappWindowOpen(g.id)) {
      window.open(wa, "_blank", "noopener");
      recordOutgoing(g.id, text, "WhatsApp (link)", undefined, meta);
      return { ok: true, how: "link", message: "L'ospite non ti scrive da più di 24 ore: WhatsApp non consegna i messaggi liberi inviati da Xenora. Ho aperto WhatsApp col testo pronto: premi invio lì per mandarlo (oppure usa l'email)." };
    }
    try {
      const r = await apiPost<{ ok?: boolean; id?: string; message?: string }>("whatsapp/send", { to: digits, text });
      if (r?.ok !== false) { recordOutgoing(g.id, text, "WhatsApp", r?.id, meta); return { ok: true, how: "api", message: "Inviato su WhatsApp ✓" }; }
      window.open(wa, "_blank", "noopener");
      return { ok: true, how: "link", message: `${r?.message || "WhatsApp non ha accettato il messaggio (fuori dalle 24 ore?)"} Ho aperto WhatsApp col testo pronto: invialo da lì.` };
    } catch (e) {
      window.open(wa, "_blank", "noopener");
      return { ok: true, how: "link", message: `${e instanceof Error ? e.message : "Invio non riuscito"}. Ho aperto WhatsApp col testo pronto: invialo da lì.` };
    }
  }
  window.open(wa, "_blank", "noopener");
  recordOutgoing(g.id, text, "WhatsApp (link)", undefined, meta);
  return { ok: true, how: "link", message: "Ho aperto WhatsApp col testo pronto: premi invio lì per mandarlo." };
}

/** Dati della struttura che servono alla carta intestata dell'email (nome, logo, colore, indirizzo, contatti). */
export interface EmailStructure { name?: string; email?: string; photoColor?: string; logo?: string; website?: string; address?: string; streetNumber?: string; city?: string; phone?: string; cin?: string; vat?: string }
/** Parte `booking` + `replyTo` del corpo di /api/email per un messaggio all'ospite: stessa carta intestata del cron (le risposte dell'ospite tornano alla struttura). */
export function emailBrandPayload(structure?: EmailStructure): { accent?: string; booking: Record<string, string | undefined>; replyTo?: string } {
  const st = structure ?? {};
  return {
    accent: st.photoColor,
    booking: {
      structureName: st.name, structureEmail: st.email, color: st.photoColor, logo: st.logo, website: st.website,
      address: [st.address, st.streetNumber, st.city].filter(Boolean).join(" ") || undefined, phone: st.phone, cin: st.cin, vat: st.vat,
    },
    replyTo: st.email || undefined,
  };
}

export async function sendEmailToGuest(g: Guest | undefined, subject: string, text: string, structure?: EmailStructure, meta?: SendMeta): Promise<SendResult> {
  if (!g?.email) return { ok: false, how: "none", message: "L'ospite non ha un indirizzo email." };
  try {
    const r = await fetch("/api/email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "guest_message", lang: guestLangOf(g), to: g.email, subject, text, ...emailBrandPayload(structure) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.ok) { recordOutgoing(g.id, text, "Email", undefined, meta); return { ok: true, how: "api", message: "Email inviata ✓" }; }
    return { ok: false, how: "none", message: j?.error || "Email non inviata, riprova." };
  } catch { return { ok: false, how: "none", message: "Email non inviata: connessione assente." }; }
}

// ── Cronologia dei solleciti ──
// Ogni messaggio inviato da qui porta con sé la prenotazione (bid) e il tipo di promemoria (rem) dentro la conversazione:
// la cronologia si ricava dalla chat, quindi è la stessa su ogni dispositivo e non si perde. Si contano anche i link di pagamento
// e i check-in mandati direttamente dalla chat (riconosciuti dal testo).
export interface ReminderEntry { ts: number; via: string }
export type ReminderLog = Record<string, Record<string, ReminderEntry[]>>; // prenotazione → tipo → invii (dal più vecchio)
type ThreadMsgLite = { dir?: string; text?: string; ts?: number; via?: string; bid?: string; rem?: string; rems?: string[] };

export function readReminderLog(bookings: { id: string; guestId: string }[]): ReminderLog {
  const out: ReminderLog = {};
  let threads: Record<string, ThreadMsgLite[]> = {};
  try { threads = JSON.parse(localStorage.getItem(THREADS_KEY) || "{}"); } catch {}
  const legacy = readReminders();
  const add = (bid: string, kind: string, ts: number, via: string) => { ((out[bid] ??= {})[kind] ??= []).push({ ts, via }); };
  for (const b of bookings) {
    for (const m of threads[b.guestId] ?? []) {
      if (m.dir !== "out" || typeof m.ts !== "number") continue;
      const via = m.via || "Messaggio";
      // rems: un solo messaggio (es. automatico con link check-in + guida) copre più passaggi
      if (m.rem && m.bid === b.id) { for (const k of new Set([m.rem, ...(Array.isArray(m.rems) ? m.rems : [])])) add(b.id, k, m.ts, via); continue; }
      if (m.rem) continue; // appartiene a un'altra prenotazione dello stesso ospite
      const t = m.text || "";
      if (t.includes("chat-pay/go")) add(b.id, /tass|tax|taxe|steuer|tasa/i.test(t) ? "pay-tassa" : "pay-saldo", m.ts, via);
    }
    // registro vecchio (solo ultimo invio): vale solo dove la chat non ha nulla per quel tipo
    for (const [kind, ts] of Object.entries(legacy[b.id] ?? {})) if (!(out[b.id]?.[kind]?.length)) add(b.id, kind, ts, "Messaggio");
    for (const k of Object.keys(out[b.id] ?? {})) out[b.id][k].sort((a, c) => a.ts - c.ts);
  }
  return out;
}

/** Hook: cronologia dei solleciti sempre aggiornata (si ricarica a ogni invio, sync e ritorno sulla scheda). */
export function useReminderLog(bookings: { id: string; guestId: string }[]): ReminderLog {
  const [log, setLog] = useState<ReminderLog>({});
  const key = bookings.map((b) => b.id + b.guestId).join("|");
  const load = useCallback(() => { setLog(readReminderLog(bookings)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    const ev = ["focus", "spigolestay:datasync", "spigolestay:reminders", "spigolestay:threads"];
    ev.forEach((e) => window.addEventListener(e, load));
    return () => ev.forEach((e) => window.removeEventListener(e, load));
  }, [load]);
  return log;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** "oggi 10:12" · "ieri 18:40" · "03.10 09:05" */
export function whenLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts), n = new Date(now);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (day === today) return `oggi ${hm}`;
  if (day === today - 86400000) return `ieri ${hm}`;
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${hm}`;
}
/** "5 minuti fa" · "2 ore fa" · "3 giorni fa" */
export function agoLabel(ts: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return "adesso";
  if (m < 60) return `${m} minut${m === 1 ? "o" : "i"} fa`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} or${h === 1 ? "a" : "e"} fa`;
  const g = Math.round(h / 24);
  return `${g} giorn${g === 1 ? "o" : "i"} fa`;
}
/** Riga breve per le schede: "sollecitato 2 volte · ultimo oggi 10:12" (vuota se mai inviato) */
export function reminderSummary(list: ReminderEntry[] | undefined, now = Date.now()): string {
  if (!list?.length) return "";
  const last = list[list.length - 1];
  return `inviato ${list.length} ${list.length === 1 ? "volta" : "volte"} · ultimo ${whenLabel(last.ts, now)}`;
}
/** Soglia sotto la quale un nuovo invio viene frenato con una conferma (evita messaggi ripetuti). */
export const REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

/** Note brevi per le schede (una per passaggio) ricavate dalla cronologia di una prenotazione. */
export function reminderNotes(log: Record<string, ReminderEntry[]> | undefined): Partial<Record<"checkin" | "pay" | "tax" | "guide" | "review" | "checkout", string>> {
  if (!log) return {};
  return { checkin: reminderSummary(log.checkin), pay: reminderSummary(log["pay-saldo"]), tax: reminderSummary(log["pay-tassa"]), guide: reminderSummary(log.guide), review: reminderSummary(log.review), checkout: reminderSummary(log.checkout) };
}

/** La guida ospiti è già stata inviata PER QUESTA prenotazione? Contano solo i messaggi partiti dopo la creazione della prenotazione
 *  (la chat è per ospite: i messaggi di soggiorni precedenti o di prova non devono far risultare "inviata" una prenotazione nuova). */
export function isGuideSent(b: { bookedOn?: string; checkIn: string }, msgs: { dir?: string; text?: string; ts?: number }[] | undefined, log?: Record<string, ReminderEntry[]>): boolean {
  if (log?.guide?.length) return true;
  const from = b.bookedOn ? Date.parse(b.bookedOn) : Date.parse(b.checkIn) - 60 * 86400000;
  return (msgs ?? []).some((m) => m.dir === "out" && typeof m.ts === "number" && m.ts >= from && /guest-guide|\/guida|guida ospiti|atsv\.vercel\.app|spigole-guest-guide/i.test(m.text || ""));
}
