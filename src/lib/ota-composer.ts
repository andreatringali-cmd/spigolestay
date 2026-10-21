// Logica PURA del compositore delle conversazioni OTA (src/components/booking-panel/OtaThreadChat.tsx): scelta dei modelli per struttura,
// lingua dell'ospite, quando proporre «Traduci», avvisi sulle regole dei portali, limite di caratteri, bozza conservata per conversazione.
// Nessuna rete, nessun React: testabile (tests/ota-composer.test.ts).
import { detectLang, pickGuestLang, type GuestLang } from "./concierge-i18n";

/** Limite di Channex per un messaggio (la route /api/channex/threads rifiuta oltre 4000 caratteri). */
export const OTA_MAX_CHARS = 4000;
export type CounterState = "hidden" | "ok" | "warn" | "over";
/** Il contatore compare solo quando ci si avvicina al limite (da 80%); «over» = troppo lungo, l'invio è bloccato. */
export function counterState(len: number, max = OTA_MAX_CHARS): CounterState {
  if (len > max) return "over";
  if (len >= Math.round(max * 0.9)) return "warn";
  if (len >= Math.round(max * 0.8)) return "ok";
  return "hidden";
}

// ───────────────────────── Modelli ─────────────────────────
export interface TplLike { id: string; name: string; texts?: Record<string, string>; srcId?: string; structureIds?: string[] }
export interface TplOption<T extends TplLike = TplLike> { tpl: T; /** Il modello contiene il link di pagamento: nelle chat dei portali non si usa. */ needsPaymentLink: boolean }

// Ordine dei modelli collegati ai passaggi (come in Messaggi → Modelli); quelli del titolare dopo, per nome.
const STEP_RANK: Record<string, number> = { selfcheckin: 0, pay: 1, guida: 2, info: 3, tax: 5, checkout: 8 };
const hasText = (t: TplLike) => Object.values(t.texts ?? {}).some((v) => (v ?? "").trim());

/** Modelli della struttura (quelli per tutte le strutture o per quella indicata), non vuoti, nell'ordine dei passaggi poi per nome. */
export function templatesForStructure<T extends TplLike>(all: T[], structureId: string): TplOption<T>[] {
  return all
    .filter((t) => (t.name || "").trim() && hasText(t) && (!t.structureIds?.length || t.structureIds.includes(structureId)))
    .map((tpl) => ({ tpl, needsPaymentLink: Object.values(tpl.texts ?? {}).some((v) => /\{link_pagamento\}/i.test(v ?? "")) }))
    .sort((a, b) => {
      const ra = a.tpl.srcId ? STEP_RANK[a.tpl.srcId] ?? 4 : 9, rb = b.tpl.srcId ? STEP_RANK[b.tpl.srcId] ?? 4 : 9;
      return ra - rb || a.tpl.name.localeCompare(b.tpl.name, "it");
    });
}

/** In quale lingua è scritto il testo che si inserisce: quella dell'ospite se il modello ce l'ha, altrimenti italiano, altrimenti la prima scritta. Specchio di templateRawFor (template-fill.ts). */
export function templateTextLang(tpl: Pick<TplLike, "texts">, lang: GuestLang): string {
  const tx = tpl.texts ?? {};
  if (tx[lang]?.trim()) return lang;
  if (tx.it?.trim()) return "it";
  return Object.keys(tx).find((k) => tx[k]?.trim()) ?? "it";
}

// ───────────────────────── Lingua ─────────────────────────
/** Lingua in cui scrivere all'ospite: se nei suoi messaggi recenti scrive chiaramente in una lingua vince quella, poi la lingua della scheda ospite, poi l'italiano. */
export function replyLang(guestLang: string | undefined | null, msgs: { sender: string; text: string }[]): GuestLang {
  const recent = msgs.filter((m) => m.sender === "guest" && m.text.trim()).slice(-3).map((m) => m.text).join("\n");
  return pickGuestLang(guestLang, recent);
}

/** Proporre «Traduci» sotto un messaggio dell'ospite? Non se è chiaramente italiano o troppo breve per dire. Lingue non riconosciute (russo, olandese…) sì, se il testo non è breve. */
export function needsTranslation(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 4) return false;
  const d = detectLang(t);
  if (d.lang === "it") return false;
  if (d.lang) return true;
  return t.length >= 20 || /[^\x00-ɏ]/.test(t); // alfabeti non latini: sempre
}

// ───────────────────────── Regole dei portali ─────────────────────────
export type OtaRisk = "link" | "email" | "phone" | "chat" | "payment" | "card";
/** Cosa nel testo i portali (Booking.com, Airbnb, Expedia) possono bloccare od oscurare nelle chat: link esterni, email, telefoni, inviti a passare su WhatsApp, pagamenti fuori portale. */
export function otaRisks(text: string): OtaRisk[] {
  const out: OtaRisk[] = [];
  if (/(?:https?:\/\/|www\.)\S+/i.test(text)) out.push("link");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) out.push("email");
  // Numero di carta: 13-19 cifre (anche a gruppi). Lo si toglie dal testo prima di cercare i telefoni, così non conta due volte.
  const CARD = /(?:^|\D)((?:\d[ -]?){12,18}\d)(?=\D|$)/g;
  const card = /(?:^|\D)(?:\d[ -]?){12,18}\d(?=\D|$)/.test(text);
  if (card) out.push("card");
  const phones = text.replace(CARD, " ").match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
  if (phones.some((p) => p.trim().startsWith("+") || p.replace(/\D/g, "").length >= 9)) out.push("phone");
  if (/\b(whatsapp|telegram|viber|signal)\b/i.test(text)) out.push("chat");
  if (/\b(iban|bonifico|paypal|revolut|western\s*union|bank transfer|wire transfer|virement|überweisung|transferencia)\b/i.test(text)) out.push("payment");
  return out;
}
const RISK_LABEL: Record<OtaRisk, string> = { link: "link", email: "indirizzi email", phone: "numeri di telefono", chat: "inviti a scrivere su WhatsApp o altre app", payment: "pagamenti fuori dal portale", card: "numeri di carta" };
export const otaRiskList = (risks: OtaRisk[]): string => risks.map((r) => RISK_LABEL[r]).join(", ");

// ───────────────────────── Bozza conservata per conversazione ─────────────────────────
export const OTA_DRAFT_PREFIX = "xn:otadraft:";
export const OTA_DRAFT_TTL_MS = 30 * 24 * 3600 * 1000;
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export interface SavedDraft { text: string; ai: boolean }

/** Bozza non inviata di una conversazione (vuota se non c'è, è scaduta o lo storage non risponde). */
export function loadDraft(store: StorageLike | null | undefined, threadId: string, now = Date.now()): SavedDraft {
  try {
    const raw = store?.getItem(OTA_DRAFT_PREFIX + threadId);
    if (!raw) return { text: "", ai: false };
    const p = JSON.parse(raw) as { t?: unknown; ts?: unknown; ai?: unknown };
    if (typeof p.t !== "string" || !p.t.trim() || typeof p.ts !== "number" || now - p.ts > OTA_DRAFT_TTL_MS) { store?.removeItem(OTA_DRAFT_PREFIX + threadId); return { text: "", ai: false }; }
    return { text: p.t, ai: p.ai === true };
  } catch { return { text: "", ai: false }; }
}
/** Salva (o, se vuota, cancella) la bozza. Non lancia mai. */
export function saveDraft(store: StorageLike | null | undefined, threadId: string, text: string, ai = false, now = Date.now()): void {
  try {
    if (!store) return;
    if (!text.trim()) store.removeItem(OTA_DRAFT_PREFIX + threadId);
    else store.setItem(OTA_DRAFT_PREFIX + threadId, JSON.stringify({ t: text, ts: now, ...(ai ? { ai: true } : {}) }));
  } catch { /* storage pieno o non disponibile: la bozza resta solo nel campo */ }
}
