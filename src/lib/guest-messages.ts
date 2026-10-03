// Messaggi all'ospite condivisi tra la chat e la vista prenotazioni: testi nelle 5 lingue,
// invio WhatsApp/email e registrazione nella conversazione. Solo lato browser.

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
export function recordOutgoing(guestId: string, text: string, via: string, wid?: string) {
  try {
    const all = JSON.parse(localStorage.getItem(THREADS_KEY) || "{}") as Record<string, unknown[]>;
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    all[guestId] = [...(all[guestId] ?? []), { id, dir: "out", text, ts: Date.now(), via, ...(wid ? { wid, st: "sent" } : {}) }];
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
export async function sendWhatsAppToGuest(g: Guest | undefined, text: string): Promise<SendResult> {
  const digits = (g?.phone ?? "").replace(/\D/g, "");
  if (!g || !digits) return { ok: false, how: "none", message: "L'ospite non ha un numero di telefono." };
  const wa = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  if (await whatsappConnected()) {
    try {
      const r = await apiPost<{ ok?: boolean; id?: string; message?: string }>("whatsapp/send", { to: digits, text });
      if (r?.ok !== false) { recordOutgoing(g.id, text, "Prenotazioni", r?.id); return { ok: true, how: "api", message: "Inviato su WhatsApp ✓" }; }
      window.open(wa, "_blank", "noopener");
      return { ok: true, how: "link", message: `${r?.message || "WhatsApp non ha accettato il messaggio (fuori dalle 24 ore?)"} Ho aperto WhatsApp col testo pronto: invialo da lì.` };
    } catch (e) {
      window.open(wa, "_blank", "noopener");
      return { ok: true, how: "link", message: `${e instanceof Error ? e.message : "Invio non riuscito"}. Ho aperto WhatsApp col testo pronto: invialo da lì.` };
    }
  }
  window.open(wa, "_blank", "noopener");
  recordOutgoing(g.id, text, "Prenotazioni (WhatsApp)");
  return { ok: true, how: "link", message: "Ho aperto WhatsApp col testo pronto: premi invio lì per mandarlo." };
}

export async function sendEmailToGuest(g: Guest | undefined, subject: string, text: string, structure?: { name?: string; email?: string; photoColor?: string }): Promise<SendResult> {
  if (!g?.email) return { ok: false, how: "none", message: "L'ospite non ha un indirizzo email." };
  try {
    const r = await fetch("/api/email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "guest_message", to: g.email, subject, text, accent: structure?.photoColor, booking: { structureName: structure?.name, structureEmail: structure?.email, color: structure?.photoColor } }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.ok) { recordOutgoing(g.id, text, "Email"); return { ok: true, how: "api", message: "Email inviata ✓" }; }
    return { ok: false, how: "none", message: j?.error || "Email non inviata, riprova." };
  } catch { return { ok: false, how: "none", message: "Email non inviata: connessione assente." }; }
}
