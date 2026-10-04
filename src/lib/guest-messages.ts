// Messaggi all'ospite condivisi tra la chat e la vista prenotazioni: testi nelle 5 lingue,
// invio WhatsApp/email e registrazione nella conversazione. Solo lato browser.

import { useCallback, useEffect, useState } from "react";
import type { Guest } from "./types";
import { apiPost } from "./invoicing/client";

export type Lang = "it" | "en" | "fr" | "de" | "es";

export const GUIDE_MSG: Record<Lang, (u: string) => string> = {
  it: (u) => `Qui trovi la guida con tutte le info utili (check-in, wi-fi, dintorni): ${u}`,
  en: (u) => `Here is our guest guide with all the useful info: ${u}`,
  fr: (u) => `Voici le guide avec toutes les infos utiles : ${u}`,
  de: (u) => `Hier ist der Gäste-Guide mit allen Infos: ${u}`,
  es: (u) => `Aquí tienes la guía con toda la información útil: ${u}`,
};
export const CHECKIN_MSG: Record<Lang, (u: string) => string> = {
  it: (u) => `Per velocizzare l'arrivo, compila il check-in online (dati e documento) qui: ${u}`,
  en: (u) => `To speed up your arrival, please complete the online check-in (details and ID) here: ${u}`,
  fr: (u) => `Pour accélérer votre arrivée, remplissez le check-in en ligne (données et pièce d'identité) ici : ${u}`,
  de: (u) => `Um Ihre Ankunft zu beschleunigen, füllen Sie bitte den Online-Check-in (Daten und Ausweis) hier aus: ${u}`,
  es: (u) => `Para agilizar tu llegada, completa el check-in online (datos y documento) aquí: ${u}`,
};
// Check-in incompleto: manca qualche ospite (n = quanti).
export const CHECKIN_MORE_MSG: Record<Lang, (n: number, u: string) => string> = {
  it: (n, u) => `Il check-in è quasi completo: ci mancano i dati di ${n} ${n === 1 ? "altro ospite" : "altri ospiti"}. Apri il link e compila di nuovo il modulo con i dati di tutti gli ospiti: ${u}`,
  en: (n, u) => `Your check-in is almost done: we still need the details of ${n} more ${n === 1 ? "guest" : "guests"}. Open the link and fill in the form again with the details of all guests: ${u}`,
  fr: (n, u) => `Votre check-in est presque terminé : il nous manque les données de ${n} ${n === 1 ? "autre personne" : "autres personnes"}. Ouvrez le lien et remplissez de nouveau le formulaire avec les données de tous les voyageurs : ${u}`,
  de: (n, u) => `Ihr Check-in ist fast fertig: Es fehlen noch die Daten von ${n} weiteren ${n === 1 ? "Person" : "Personen"}. Öffnen Sie den Link und füllen Sie das Formular erneut mit den Daten aller Gäste aus: ${u}`,
  es: (n, u) => `Su check-in está casi completo: faltan los datos de ${n} ${n === 1 ? "huésped más" : "huéspedes más"}. Abra el enlace y rellene de nuevo el formulario con los datos de todos los huéspedes: ${u}`,
};
// Apertura dei solleciti: si antepone al messaggio normale.
export const REMINDER_INTRO: Record<Lang, string> = {
  it: "Un promemoria dalla struttura. ",
  en: "A quick reminder from us. ",
  fr: "Un petit rappel de notre part. ",
  de: "Eine kurze Erinnerung von uns. ",
  es: "Un breve recordatorio de nuestra parte. ",
};

export const langOf = (g?: Guest): Lang => (["it", "en", "fr", "de", "es"].includes(g?.language ?? "") ? (g!.language as Lang) : "it");
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

/** WhatsApp: se la Cloud API è collegata invia davvero (e registra in chat); altrimenti apre wa.me col testo pronto. */
export async function sendWhatsAppToGuest(g: Guest | undefined, text: string, meta?: SendMeta): Promise<SendResult> {
  const digits = (g?.phone ?? "").replace(/\D/g, "");
  if (!g || !digits) return { ok: false, how: "none", message: "L'ospite non ha un numero di telefono." };
  const wa = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  if (await whatsappConnected()) {
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

export async function sendEmailToGuest(g: Guest | undefined, subject: string, text: string, structure?: { name?: string; email?: string; photoColor?: string }, meta?: SendMeta): Promise<SendResult> {
  if (!g?.email) return { ok: false, how: "none", message: "L'ospite non ha un indirizzo email." };
  try {
    const r = await fetch("/api/email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "guest_message", to: g.email, subject, text, accent: structure?.photoColor, booking: { structureName: structure?.name, structureEmail: structure?.email, color: structure?.photoColor } }),
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
type ThreadMsgLite = { dir?: string; text?: string; ts?: number; via?: string; bid?: string; rem?: string };

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
      if (m.rem && m.bid === b.id) { add(b.id, m.rem, m.ts, via); continue; }
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
/** "oggi 10:12" · "ieri 18:40" · "3/10 09:05" */
export function whenLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts), n = new Date(now);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (day === today) return `oggi ${hm}`;
  if (day === today - 86400000) return `ieri ${hm}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${hm}`;
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
export function reminderNotes(log: Record<string, ReminderEntry[]> | undefined): Partial<Record<"checkin" | "pay" | "tax" | "guide" | "review", string>> {
  if (!log) return {};
  return { checkin: reminderSummary(log.checkin), pay: reminderSummary(log["pay-saldo"]), tax: reminderSummary(log["pay-tassa"]), guide: reminderSummary(log.guide), review: reminderSummary(log.review) };
}
