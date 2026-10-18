// Cronologia di UNA prenotazione (scheda "Timeline" del pannello prenotazione).
//
// Modulo PURO: nessun accesso a rete, database o browser. Riceve la prenotazione, le righe già lette dal server
// (route /api/booking-timeline) e i dati che vivono nel browser (registro attività, chat, registro invii) e restituisce
// gli eventi in ordine di tempo, senza doppioni evidenti, già scritti in italiano.
//
// Principio: è una cronologia utile al TITOLARE (cosa è successo e cosa è stato inviato all'ospite, per evitare doppi invii),
// non una copia tecnica dei webhook. Ogni fonte che non esiste per quella prenotazione semplicemente non produce righe.

import type { Booking, Guest, Structure } from "./types";
import { eur } from "./format";
import { spiegaErroreWa } from "./invii-log";

const TZ = "Europe/Rome";

export type TimelineTone = "ok" | "info" | "warn" | "err" | "muted";

/** Metadati interni dei messaggi all'ospite, usati per togliere lo stesso invio visto da più fonti. */
export interface TimelineMsgMeta {
  /** Quanto è "ricca" la fonte: la chat (testo reale) batte il registro invii, che batte il log tecnico del cron. */
  rank: number;
  /** Canali toccati: "email" | "whatsapp". Vuoto = non noto (vale per qualunque canale). */
  channels: string[];
  ok: boolean;
}

export interface TimelineEvent {
  /** Epoch ms, oppure stringa ISO (solo data "yyyy-mm-dd" = ora non nota, oppure data e ora). */
  at: number | string;
  kind: string;
  title: string;
  detail?: string;
  tone: TimelineTone;
  /** Da dove arriva l'informazione (etichetta breve in italiano). */
  source: string;
  /** Chiave per togliere lo stesso fatto raccontato da due fonti nello stesso giorno (vince quella con l'ora). */
  uniq?: string;
  /** Priorità tra eventi con la stessa `uniq` (più alto = vince). */
  prio?: number;
  msg?: TimelineMsgMeta;
  /** Revisione del portale che ha generato l'evento (serve a mostrare cosa è cambiato in una modifica). */
  revisionId?: string;
}

// ─── Righe lette dal server (già normalizzate dalla route) ───────────────────────────────────────────────────────────
export type ServerEvent =
  | { src: "invii_log"; at: string; job: string; channel: string; ok: boolean; detail?: string }
  | { src: "auto_message_log"; at: string; templateId: string; slotDate?: string }
  | { src: "channex_bookings"; at: string; revisionId?: string; status: string; otaCode?: string }
  | { src: "booking_events"; at: string; kind: string; message: string }
  | { src: "alloggiati_schedine"; at: string; stato: string; errorCount?: number; firstError?: string }
  | { src: "istat_rows"; at: string; stato: string }
  | { src: "documents"; at: string; step: "draft" | "issued" | "sent" | "delivered" | "rejected"; docKind?: string; label?: string };

// ─── Dati del browser ────────────────────────────────────────────────────────────────────────────────────────────────
export interface ActivityLike { ts: number; type: string; text: string; structureId?: string }
export interface ThreadMsgLike { id?: string; dir?: string; text?: string; ts?: number; via?: string; bid?: string; rem?: string; rems?: string[]; sys?: string; st?: string }
export interface SentLike { key?: string; guest?: string; tpl?: string; via?: string; ts?: number }

export interface TimelineClient {
  activities?: ActivityLike[];
  /** Chat per ospite (`spigolestay:threads:v1`): guestId → messaggi. */
  threads?: Record<string, ThreadMsgLike[]>;
  /** Registro «Invii programmati» (`spigolestay:msgsent`). */
  msgsent?: SentLike[];
  /** id (o srcId) del modello → nome, per dare un nome ai messaggi automatici del cron. */
  templateNames?: Record<string, string>;
  /** L'ospite ha altre prenotazioni vive: le fonti senza id prenotazione (registro attività, link di pagamento in chat) diventano ambigue e si saltano. */
  guestHasOtherBookings?: boolean;
  /** Id di tutte le camere del gruppo (se la prenotazione è di gruppo); default: solo questa. */
  bookingIds?: string[];
}

export interface TimelineInput {
  booking: Partial<Booking> & { id: string };
  guest?: Partial<Guest> | null;
  structure?: Partial<Structure> | null;
  server?: ServerEvent[];
  client?: TimelineClient;
}

// ─── Date ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const isDateOnly = (at: number | string): boolean => typeof at === "string" && DATE_ONLY.test(at.trim());

/** Istante in ms di un evento. Una data senza ora vale le 10:00 UTC di quel giorno (a metà giornata in Italia), così si ordina dentro il suo giorno. */
export function atMs(at: number | string | null | undefined): number | null {
  if (at === null || at === undefined || at === "") return null;
  if (typeof at === "number") return Number.isFinite(at) && at > 0 ? at : null;
  const s = at.trim();
  if (DATE_ONLY.test(s)) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d, 10, 0, 0); }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

const dtfParts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function romeParts(ms: number): { y: string; m: string; d: string; hh: string; mm: string } {
  const o = { y: "", m: "", d: "", hh: "", mm: "" };
  for (const p of dtfParts.formatToParts(new Date(ms))) {
    if (p.type === "year") o.y = p.value; else if (p.type === "month") o.m = p.value; else if (p.type === "day") o.d = p.value;
    else if (p.type === "hour") o.hh = p.value === "24" ? "00" : p.value; else if (p.type === "minute") o.mm = p.value;
  }
  return o;
}
/** "yyyy-mm-dd" del giorno italiano in cui cade l'evento. */
export function eventDay(at: number | string): string {
  if (isDateOnly(at)) return String(at).trim();
  const ms = atMs(at); if (ms === null) return "";
  const p = romeParts(ms); return `${p.y}-${p.m}-${p.d}`;
}
/** "gg.mm.aaaa hh:mm" (fuso Europe/Rome); per le date senza ora solo "gg.mm.aaaa". */
export function fmtEventAt(at: number | string): string {
  if (isDateOnly(at)) { const [y, m, d] = String(at).trim().split("-"); return `${d}.${m}.${y}`; }
  const ms = atMs(at); if (ms === null) return "";
  const p = romeParts(ms); return `${p.d}.${p.m}.${p.y} ${p.hh}:${p.mm}`;
}
const itDate = (iso?: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "")); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };

// ─── Piccoli aiuti di testo ──────────────────────────────────────────────────────────────────────────────────────────
const CHANNEL_LABEL: Record<string, string> = {
  booking: "Booking.com", airbnb: "Airbnb", expedia: "Expedia / Vrbo", agoda: "Agoda", google: "Google Hotel", hotelbeds: "HotelBeds", other: "un portale", direct: "Diretta", blocked: "Bloccato",
};
const chLabel = (c?: string) => (c === "whatsapp" ? "WhatsApp" : c === "email" ? "email" : c || "");
/** Testo breve su una riga, senza link (i link sono lunghi e non servono a chi legge la cronologia). */
export function snippet(text: string | undefined, max = 110): string {
  const t = String(text ?? "").replace(/https?:\/\/\S+/g, "link").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
const cut = (s: string | undefined, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const uniqList = <T,>(a: T[]): T[] => Array.from(new Set(a));
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Canali (email / whatsapp) nominati in una stringa tipo "Email e WhatsApp", "WhatsApp (link)". */
export function channelsOfVia(via: string | undefined): string[] {
  const v = (via ?? "").toLowerCase();
  const out: string[] = [];
  if (/mail/.test(v)) out.push("email");
  if (/whatsapp/.test(v)) out.push("whatsapp");
  return out;
}
function viaText(via: string | undefined): string {
  const v = (via ?? "").trim();
  if (!v) return "";
  if (/whatsapp \(link\)/i.test(v)) return "WhatsApp, dal tuo telefono";
  if (/^email e whatsapp$/i.test(v)) return "email e WhatsApp";
  if (/^email$/i.test(v)) return "email";
  if (/^whatsapp$/i.test(v)) return "WhatsApp";
  return v.replace(/[^\p{L}\p{N}\s.,()'’-]/gu, "").trim() || v;
}

const REM_TITLE: Record<string, string> = {
  checkin: "Promemoria check-in inviato",
  guide: "Guida agli ospiti inviata",
  checkout: "Promemoria di partenza inviato",
  voucher: "Voucher inviato",
  "pay-saldo": "Link di pagamento del saldo inviato",
  "pay-tassa": "Link della tassa di soggiorno inviato",
  review: "Richiesta di recensione inviata",
};
const REM_SHORT: Record<string, string> = { checkin: "check-in", guide: "guida", checkout: "partenza", voucher: "voucher", "pay-saldo": "saldo", "pay-tassa": "tassa di soggiorno", review: "recensione" };

/** Titolo della creazione, secondo l'origine della prenotazione ("Arrivata da Booking.com", "Inserita a mano", "Dal sito"). */
export function creationTitle(b: Partial<Booking>, structureName?: string): string {
  const ch = String(b.channel ?? "");
  if (ch === "direct") {
    const src = String(b.source ?? "");
    const ext = String(b.extId ?? "");
    const fromSite = src === "sito" || ext.startsWith("site:") || (src !== "manuale" && (!!b.stripePaymentIntent || !!b.stripeSessionId || /^SPG-\d{4}-\d+$/.test(String(b.code ?? "").trim()) || !!b.ratePlanName));
    return fromSite ? `Prenotazione dal sito${structureName ? ` ${structureName}` : " ufficiale"}` : "Prenotazione inserita a mano";
  }
  const label = CHANNEL_LABEL[ch];
  if (label && ch !== "blocked") return ch === "other" ? "Arrivata da un portale (OTA)" : `Arrivata da ${label}`;
  return "Prenotazione creata";
}

// ─── Costruzione degli eventi, fonte per fonte ───────────────────────────────────────────────────────────────────────
type Ctx = { b: TimelineInput["booking"]; guestName: string; structureName: string; ids: Set<string>; client: TimelineClient };
const push = (out: TimelineEvent[], e: TimelineEvent | null) => { if (e && atMs(e.at) !== null) out.push(e); };

function fromBooking(c: Ctx, out: TimelineEvent[]) {
  const b = c.b;
  const created = creationTitle(b, c.structureName);
  const codeNote = b.code ? `Codice ${b.code}` : undefined;
  push(out, { at: (b.bookedOn as string | undefined) ?? "", kind: "created", title: created, detail: codeNote, tone: "info", source: "Prenotazione", uniq: "created", prio: 9 });

  // Annullamento
  if (b.cancelledAt) {
    const who = b.cancelledBy === "guest" ? "dall'ospite" : b.cancelledBy === "host" ? "dalla struttura" : "";
    const bits: string[] = [];
    const ref = num(b.refundedAmount);
    if (ref > 0) bits.push(`Rimborsati ${eur(ref)}`);
    const unref = num((b as { unrefundedAmount?: number }).unrefundedAmount); // scritto all'annullamento dal link di gestione (vedi manage-booking.unrefundedOf)
    if (unref > 0) bits.push(`Da rimborsare a mano ${eur(unref)}`);
    push(out, { at: b.cancelledAt, kind: "cancelled", title: `Prenotazione annullata${who ? " " + who : ""}`, detail: bits.join(" · ") || undefined, tone: "err", source: "Prenotazione", uniq: "cancelled", prio: 5 });
  }

  // Richiesta di modifica dell'ospite dal link di gestione
  if (b.changeRequest?.at) {
    const cr = b.changeRequest;
    const bits: string[] = [];
    if (cr.ci || cr.co) bits.push(`${itDate(cr.ci) || "…"} → ${itDate(cr.co) || "…"}`);
    if (cr.adults) bits.push(`${cr.adults} adulti${cr.children ? `, ${cr.children} bambini` : ""}`);
    if (cr.message) bits.push(`«${cut(cr.message, 90)}»`);
    push(out, { at: cr.at, kind: "change_request", title: "L'ospite ha chiesto una modifica", detail: bits.join(" · ") || undefined, tone: "warn", source: "Prenotazione" });
  }
  if (b.movedFrom?.at) push(out, { at: b.movedFrom.at, kind: "moved", title: `Spostata da ${b.movedFrom.structureName || "un'altra struttura"}`, tone: "info", source: "Prenotazione" });

  // Check-in online
  const consent = b.privacyConsentAt;
  if (consent) {
    const byOp = b.privacyConsentBy === "operator";
    const title = byOp ? "Check-in compilato dall'operatore" : b.webCheckin ? "Check-in online completato" : "Consenso privacy registrato";
    push(out, { at: consent, kind: "checkin", title, detail: byOp ? "Consenso privacy registrato dall'operatore" : "Consenso privacy dato dall'ospite", tone: "ok", source: "Check-in" });
  }

  // Richiesta di recensione (campo scritto sia dal cron sia dall'invio manuale)
  if (num(b.reviewRequestedAt) > 0) {
    const ch = b.reviewRequestChannel;
    push(out, {
      at: num(b.reviewRequestedAt), kind: "review_request", title: `Richiesta di recensione inviata${ch ? ` (${chLabel(ch)})` : ""}`, tone: "ok", source: "Messaggi",
      msg: { rank: 1, channels: ch ? [ch] : [], ok: true },
    });
  }

  // Offerte di extra
  for (const o of b.upsellOffers ?? []) {
    const names = (o.items ?? []).map((i) => i.name).filter(Boolean).join(", ");
    const tot = o.total ? ` (${eur(o.total)})` : "";
    const detail = `${names}${tot}`.trim() || undefined;
    if (o.via === "diretto") {
      push(out, { at: o.at, kind: "upsell", title: "Extra venduti di persona", detail, tone: "ok", source: "Extra" });
      continue;
    }
    const viaT = o.via === "whatsapp" ? "WhatsApp" : o.via === "email" ? "email" : "testo copiato";
    push(out, { at: o.at, kind: "upsell", title: o.via === "copy" ? "Offerta di extra preparata (testo copiato)" : `Offerta di extra inviata (${viaT})`, detail, tone: "info", source: "Extra" });
    if (o.status === "accepted" && o.decidedAt) push(out, { at: o.decidedAt, kind: "upsell", title: "Offerta di extra accettata", detail, tone: "ok", source: "Extra" });
    if (o.status === "declined" && o.decidedAt) push(out, { at: o.decidedAt, kind: "upsell", title: "Offerta di extra rifiutata", detail, tone: "muted", source: "Extra" });
  }

  paymentEvents(c, out);
}

/** Pagamenti online: la data esatta c'è solo per l'ultimo (`paidAt`, giorno) o per le notifiche in chat; il resto si ricava senza inventare ore. */
function paymentEvents(c: Ctx, out: TimelineEvent[]) {
  const b = c.b;
  const online = Math.round(num(b.paidOnline) * 100) / 100;
  if (online <= 0) return;
  const extras = (b.stripeExtraPayments ?? []).filter((x) => num(x.amount) > 0);
  const extraSum = Math.round(extras.reduce((a, x) => a + num(x.amount), 0) * 100) / 100;
  const main = Math.round((online - extraSum) * 100) / 100;
  const lastDay = b.paidAt || "";
  const payKey = (amount: number, day: string) => `pay:${Math.round(amount * 100)}:${day}`;
  if (!extras.length) {
    const day = lastDay || (b.bookedOn ? String(b.bookedOn).slice(0, 10) : "");
    push(out, { at: day, kind: "payment", title: `Pagamento online di ${eur(online)}`, tone: "ok", source: "Pagamenti", uniq: payKey(online, day), prio: 1 });
    return;
  }
  if (main > 0.005) {
    const day = b.bookedOn ? String(b.bookedOn).slice(0, 10) : "";
    push(out, { at: day, kind: "payment", title: `Pagamento online di ${eur(main)} (acconto)`, tone: "ok", source: "Pagamenti", uniq: payKey(main, day), prio: 1 });
  }
  const last = extras[extras.length - 1];
  const before = extras.slice(0, -1);
  if (before.length && lastDay) {
    const s = Math.round(before.reduce((a, x) => a + num(x.amount), 0) * 100) / 100;
    push(out, { at: lastDay, kind: "payment", title: `Altri pagamenti online per ${eur(s)}`, detail: "Data esatta non registrata", tone: "ok", source: "Pagamenti", uniq: payKey(s, lastDay), prio: 1 });
  }
  if (lastDay) push(out, { at: lastDay, kind: "payment", title: `Pagamento online di ${eur(num(last.amount))} (saldo)`, tone: "ok", source: "Pagamenti", uniq: payKey(num(last.amount), lastDay), prio: 1 });
}

function creationFromServer(c: Ctx, s: Extract<ServerEvent, { src: "channex_bookings" }>, first: boolean): TimelineEvent {
  const code = s.otaCode ? `Codice ${s.otaCode}` : undefined;
  if (s.status === "new") {
    if (first) return { at: s.at, kind: "created", title: creationTitle(c.b, c.structureName), detail: code, tone: "info", source: "Portale", uniq: "created", prio: 3 };
    return { at: s.at, kind: "ota_revision", title: "Nuova revisione dal portale", detail: code, tone: "muted", source: "Portale" };
  }
  if (s.status === "modified") return { at: s.at, kind: "ota_modified", title: "Modificata dal portale", detail: code, tone: "info", source: "Portale", revisionId: s.revisionId };
  if (s.status === "cancelled") return { at: s.at, kind: "cancelled", title: "Cancellata dal portale", detail: code, tone: "err", source: "Portale", uniq: "cancelled", prio: 4 };
  return { at: s.at, kind: "ota_revision", title: `Revisione dal portale (${s.status || "sconosciuta"})`, tone: "muted", source: "Portale" };
}

const DOC_KIND: Record<string, string> = { fattura: "Fattura", nota_di_credito: "Nota di credito", ricevuta_non_fiscale: "Ricevuta" };

/** Righe della tabella `documents` → eventi del server (una per passaggio con una data). Esportata per i test e per la route. */
export function documentServerEvents(row: { doc_kind?: string | null; number_label?: string | null; stato?: string | null; created_at?: string | null; issued_at?: string | null; sent_at?: string | null; delivered_at?: string | null; updated_at?: string | null }): ServerEvent[] {
  const out: ServerEvent[] = [];
  const base = { src: "documents" as const, docKind: row.doc_kind ?? undefined, label: row.number_label ?? undefined };
  if (row.issued_at) out.push({ ...base, at: row.issued_at, step: "issued" });
  else if (row.created_at && (row.stato === "bozza" || !row.stato)) out.push({ ...base, at: row.created_at, step: "draft" });
  if (row.sent_at) out.push({ ...base, at: row.sent_at, step: "sent" });
  if (row.delivered_at) out.push({ ...base, at: row.delivered_at, step: "delivered" });
  if (row.stato === "scartata" && (row.updated_at || row.sent_at)) out.push({ ...base, at: (row.updated_at || row.sent_at) as string, step: "rejected" });
  return out;
}

function fromServer(c: Ctx, server: ServerEvent[], out: TimelineEvent[]) {
  const hasDocs = server.some((s) => s.src === "documents");
  const hasSchedinaEvent = server.some((s) => s.src === "booking_events" && s.kind === "schedina");
  const hasIstatEvent = server.some((s) => s.src === "booking_events" && s.kind === "istat");

  // Revisioni del portale: la prima "new" è la creazione; revisioni quasi identiche (stesso stato entro 2 minuti) sono una sola.
  const rev = server.filter((s): s is Extract<ServerEvent, { src: "channex_bookings" }> => s.src === "channex_bookings").sort((a, z) => (atMs(a.at) ?? 0) - (atMs(z.at) ?? 0));
  let seenNew = false; let lastKey = ""; let lastAt = 0;
  for (const r of rev) {
    const t = atMs(r.at) ?? 0;
    if (r.status === lastKey && t - lastAt < 120_000) { lastAt = t; continue; }
    lastKey = r.status; lastAt = t;
    push(out, creationFromServer(c, r, r.status === "new" && !seenNew));
    if (r.status === "new") seenNew = true;
  }

  // Schedine Alloggiati e ISTAT dalle tabelle di lavoro: servono solo se il registro eventi non ha già l'invio.
  const sched = server.filter((s): s is Extract<ServerEvent, { src: "alloggiati_schedine" }> => s.src === "alloggiati_schedine");
  if (!hasSchedinaEvent) {
    const sent = sched.filter((s) => s.stato === "inviata");
    const groups = new Map<string, number>();
    for (const s of sent) { const k = eventDay(s.at) + String(Math.floor((atMs(s.at) ?? 0) / 60_000)); groups.set(k, (groups.get(k) ?? 0) + 1); }
    const done = new Set<string>();
    for (const s of sent) {
      const k = eventDay(s.at) + String(Math.floor((atMs(s.at) ?? 0) / 60_000));
      if (done.has(k)) continue; done.add(k);
      const n = groups.get(k) ?? 1;
      push(out, { at: s.at, kind: "alloggiati", title: "Schedina Alloggiati inviata alla Questura", detail: n > 1 ? `${n} schedine` : undefined, tone: "ok", source: "Alloggiati" });
    }
  }
  const bad = sched.filter((s) => s.stato !== "inviata" && s.stato !== "pronta" && (s.errorCount ?? 0) > 0).sort((a, z) => (atMs(z.at) ?? 0) - (atMs(a.at) ?? 0))[0];
  if (bad) push(out, { at: bad.at, kind: "alloggiati_warn", title: "Schedina Alloggiati da correggere", detail: bad.firstError ? cut(bad.firstError, 120) + ((bad.errorCount ?? 0) > 1 ? ` (+${(bad.errorCount ?? 1) - 1})` : "") : undefined, tone: "warn", source: "Alloggiati" });

  if (!hasIstatEvent) {
    const seen = new Set<string>();
    for (const s of server) {
      if (s.src !== "istat_rows" || s.stato !== "sent") continue;
      const k = eventDay(s.at); if (seen.has(k)) continue; seen.add(k);
      push(out, { at: s.at, kind: "istat", title: "Movimento ISTAT inviato", tone: "ok", source: "ISTAT" });
    }
  }

  for (const s of server) {
    switch (s.src) {
      case "booking_events": {
        if (s.kind === "documento" && hasDocs) break; // lo raccontano meglio le righe dei documenti
        const title = s.kind === "schedina" ? "Schedina Alloggiati inviata alla Questura" : s.kind === "istat" ? "Movimento ISTAT inviato" : cut(s.message, 140);
        const tone: TimelineTone = /scartat/i.test(s.message) ? "err" : "ok";
        push(out, { at: s.at, kind: s.kind === "schedina" ? "alloggiati" : s.kind, title, tone, source: s.kind === "schedina" ? "Alloggiati" : s.kind === "istat" ? "ISTAT" : s.kind === "documento" ? "Documenti" : "Registro" });
        break;
      }
      case "documents": {
        const known = s.docKind ? s.docKind in DOC_KIND : false;
        const k = DOC_KIND[s.docKind ?? ""] ?? "Documento";
        const lbl = s.label ? ` n. ${s.label}` : "";
        const fem = known; // fattura, nota di credito, ricevuta: femminili; "documento" generico: maschile
        const verb = (f: string, m: string) => (fem ? f : m);
        const title = s.step === "draft" ? `${k} in bozza` : s.step === "issued" ? `${k}${lbl} ${verb("emessa", "emesso")}` : s.step === "sent" ? `${k}${lbl} ${verb("inviata", "inviato")} allo SdI` : s.step === "delivered" ? `${k}${lbl} ${verb("consegnata", "consegnato")} (SdI)` : `${k}${lbl} ${verb("scartata", "scartato")} dallo SdI`;
        push(out, { at: s.at, kind: "documento", title, tone: s.step === "rejected" ? "err" : s.step === "draft" ? "muted" : "ok", source: "Documenti" });
        break;
      }
      case "invii_log": push(out, invioEvent(s)); break;
      case "auto_message_log": {
        const name = c.client.templateNames?.[s.templateId];
        push(out, { at: s.at, kind: "msg_auto", title: `Messaggio automatico inviato${name ? ` «${name}»` : ""}`, detail: s.slotDate ? `Previsto per il ${itDate(s.slotDate)}` : undefined, tone: "ok", source: "Messaggi", msg: { rank: 0, channels: [], ok: true } });
        break;
      }
      default: break;
    }
  }
}

/** Una riga del registro invii (`invii_log`): job "messaggi" (modelli automatici) o "checkin" (promemoria della sera prima). */
function invioEvent(s: Extract<ServerEvent, { src: "invii_log" }>): TimelineEvent | null {
  const ch = chLabel(s.channel);
  const channels = s.channel === "email" || s.channel === "whatsapp" ? [s.channel] : [];
  const raw = String(s.detail ?? "");
  if (s.job === "checkin") {
    if (s.ok) return { at: s.at, kind: "msg_checkin", title: `Promemoria check-in inviato (${ch})`, detail: cut(raw.replace(/^promemoria check-in\s*→\s*/i, ""), 120) || undefined, tone: "ok", source: "Messaggi", msg: { rank: 1, channels, ok: true } };
    return { at: s.at, kind: "msg_checkin", title: `Promemoria check-in non inviato (${ch})`, detail: cut(raw.replace(/^promemoria check-in(\s*→\s*[^\s:]+)?:?\s*/i, ""), 140) || undefined, tone: "err", source: "Messaggi", msg: { rank: 1, channels, ok: false } };
  }
  if (s.job !== "messaggi") return null;
  const [tplRaw, rest = ""] = raw.split(/\s→\s/, 2);
  const tpl = cut(tplRaw, 60);
  if (s.ok) return { at: s.at, kind: "msg_auto", title: `Messaggio automatico${tpl ? ` «${tpl}»` : ""} inviato (${ch})`, detail: cut(rest, 100) || undefined, tone: "ok", source: "Messaggi", msg: { rank: 1, channels, ok: true } };
  const colon = rest.indexOf(": ");
  const reason = colon >= 0 ? rest.slice(colon + 2) : "";
  const why = (s.channel === "whatsapp" ? spiegaErroreWa(reason) : "") || cut(reason, 140);
  return { at: s.at, kind: "msg_auto", title: `Messaggio automatico${tpl ? ` «${tpl}»` : ""} non inviato (${ch})`, detail: why || undefined, tone: "err", source: "Messaggi", msg: { rank: 1, channels, ok: false } };
}

function fromThreads(c: Ctx, out: TimelineEvent[]) {
  const guestId = String(c.b.guestId ?? "");
  const thread = guestId ? c.client.threads?.[guestId] ?? [] : [];
  const sessions = new Set(c.b.paidSessions ?? []);
  for (const m of thread) {
    if (!m || m.dir !== "out" || typeof m.ts !== "number") continue;
    const id = String(m.id ?? "");

    // Avviso di pagamento ricevuto dal link in chat: riconosciuto dalla sessione Stripe registrata sulla prenotazione.
    if (m.sys === "payment" && id.startsWith("pay:")) {
      if (!sessions.has(id.slice(4)) && c.client.guestHasOtherBookings !== false) continue;
      const mm = /Pagamento ricevuto\s+€\s*([\d.,]+)\s*\(([^)]+)\)/i.exec(m.text ?? "");
      if (!mm) continue;
      const amount = Number(mm[1].replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(amount)) continue;
      const what = /tassa/i.test(mm[2]) ? "tassa di soggiorno" : "saldo";
      push(out, { at: m.ts, kind: "payment", title: `Pagamento online di ${eur(amount)} (${what})`, tone: "ok", source: "Pagamenti", uniq: `pay:${Math.round(amount * 100)}:${eventDay(m.ts)}`, prio: 5 });
      continue;
    }

    const ours = m.bid && c.ids.has(m.bid);
    let rems = uniqList([...(m.rem ? [m.rem] : []), ...(Array.isArray(m.rems) ? m.rems : [])]);
    if (!ours) {
      if (m.rem || m.bid) continue; // appartiene a un'altra prenotazione dello stesso ospite
      // Link di pagamento mandato dalla chat: senza id prenotazione si attribuisce solo se l'ospite non ha altri soggiorni.
      if (c.client.guestHasOtherBookings || !(m.text ?? "").includes("chat-pay/go")) continue;
      rems = [/tass|tax|taxe|steuer|tasa/i.test(m.text ?? "") ? "pay-tassa" : "pay-saldo"];
    }
    const via = viaText(m.via);
    const auto = id.startsWith("auto:");
    let title: string;
    if (rems.length === 1) title = `${REM_TITLE[rems[0]] ?? "Messaggio inviato all'ospite"}${via ? ` (${via})` : ""}`;
    else if (rems.length > 1) title = `Messaggio ${auto ? "automatico " : ""}inviato: ${rems.map((r) => REM_SHORT[r] ?? r).join(" + ")}${via ? ` (${via})` : ""}`;
    else title = `Messaggio ${auto ? "automatico " : ""}inviato all'ospite${via ? ` (${via})` : ""}`;
    const detail = (auto ? "Automatico · " : "") + snippet(m.text);
    const fail = m.st === "failed";
    if (fail) title = `Messaggio non consegnato${via ? ` (${via})` : ""}`;
    push(out, { at: m.ts, kind: "msg", title, detail: detail.trim() || undefined, tone: fail ? "err" : /dal tuo telefono/.test(via) ? "info" : "ok", source: "Messaggi", msg: { rank: 3, channels: channelsOfVia(m.via), ok: !fail } });
  }
}

function fromSentLog(c: Ctx, out: TimelineEvent[]) {
  for (const e of c.client.msgsent ?? []) {
    if (!e || typeof e.key !== "string" || typeof e.ts !== "number") continue;
    let mine = false;
    for (const id of c.ids) if (e.key.includes(id)) { mine = true; break; }
    if (!mine) continue;
    push(out, { at: e.ts, kind: "msg_auto", title: `Messaggio automatico${e.tpl ? ` «${cut(e.tpl, 60)}»` : ""} inviato${e.via ? ` (${viaText(e.via)})` : ""}`, tone: "ok", source: "Messaggi", msg: { rank: 2, channels: channelsOfVia(e.via), ok: true } });
  }
}

/** Registro attività dello store: non porta l'id della prenotazione, solo il nome dell'ospite nel testo. Si usa solo se l'ospite ha UNA sola prenotazione viva. */
function fromActivities(c: Ctx, out: TimelineEvent[]) {
  const name = c.guestName.trim();
  if (!name || c.client.guestHasOtherBookings !== false) return;
  const sid = String(c.b.structureId ?? "");
  for (const a of c.client.activities ?? []) {
    if (!a || typeof a.ts !== "number" || typeof a.text !== "string") continue;
    if (a.structureId && sid && a.structureId !== sid) continue;
    const i = a.text.indexOf(` — ${name}`);
    if (i < 0) continue;
    const head = a.text.slice(0, i).trim();
    const tail = a.text.slice(i + 3 + name.length).trim();
    if (a.type === "booking" && head === "Nuova prenotazione") push(out, { at: a.ts, kind: "created", title: creationTitle(c.b, c.structureName), tone: "info", source: "Registro", uniq: "created", prio: 2 });
    else if (a.type === "booking" && head === "Prenotazione modificata") push(out, { at: a.ts, kind: "edited", title: "Prenotazione modificata", detail: (/^\((.+)\)$/.exec(tail)?.[1] && `Cambiato: ${/^\((.+)\)$/.exec(tail)![1]}`) || undefined, tone: "info", source: "Registro" });
    else if (a.type === "cancel" && head === "Prenotazione annullata") push(out, { at: a.ts, kind: "cancelled", title: "Prenotazione annullata", tone: "err", source: "Registro", uniq: "cancelled", prio: 2 });
  }
}

// ─── Pulizia finale: doppioni ────────────────────────────────────────────────────────────────────────────────────────
const dayOf = (e: TimelineEvent) => eventDay(e.at);

/**
 * Stesso fatto (`uniq`) raccontato da più fonti: resta una sola riga, preferendo quella con l'ora esatta e poi la priorità più alta.
 * La creazione è unica per prenotazione; pagamenti e annullamenti si confrontano solo nello stesso giorno italiano.
 * L'ora di un'altra fonte sostituisce la sola data della prenotazione solo se cade nello stesso giorno (altrimenti è un'importazione successiva).
 */
function dedupeUniq(events: TimelineEvent[], bookedDay: string): TimelineEvent[] {
  const keyOf = (e: TimelineEvent) => (e.uniq === "created" ? "created" : `${e.uniq}|${dayOf(e)}`);
  const score = (x: TimelineEvent) => {
    const timed = !isDateOnly(x.at);
    const sameDay = x.uniq !== "created" || !bookedDay || dayOf(x) === bookedDay;
    return (timed && sameDay ? 100 : 0) + (x.prio ?? 0);
  };
  const best = new Map<string, TimelineEvent>();
  for (const e of events) {
    if (!e.uniq) continue;
    const k = keyOf(e);
    const cur = best.get(k);
    if (!cur || score(e) > score(cur)) best.set(k, e);
  }
  return events.filter((e) => !e.uniq || best.get(keyOf(e)) === e);
}

const WINDOW_MS = 10 * 60_000;
/** Lo stesso messaggio visto da più fonti (chat, registro invii, log del cron): resta la fonte più ricca. Gli insuccessi non si tolgono mai. */
function dedupeMessages(events: TimelineEvent[]): TimelineEvent[] {
  const msgs = events.filter((e) => e.msg && e.msg.ok);
  const drop = new Set<TimelineEvent>();
  for (const e of msgs) {
    const t = atMs(e.at) ?? 0;
    for (const f of msgs) {
      if (f === e || drop.has(f)) continue;
      if (f.msg!.rank <= e.msg!.rank) continue;
      if (Math.abs((atMs(f.at) ?? 0) - t) > WINDOW_MS) continue;
      const a = e.msg!.channels, z = f.msg!.channels;
      if (a.length && z.length && !a.some((x) => z.includes(x))) continue;
      drop.add(e); break;
    }
  }
  return events.filter((e) => !drop.has(e));
}

/** Insuccessi ripetuti identici nello stesso giorno (il cron riprova a ogni giro): una riga sola con il numero di tentativi. */
function collapseFailures(events: TimelineEvent[]): TimelineEvent[] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    if (e.tone !== "err" || !e.msg) continue;
    const k = `${e.title}|${e.detail ?? ""}|${dayOf(e)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const drop = new Set<TimelineEvent>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, z) => (atMs(a.at) ?? 0) - (atMs(z.at) ?? 0));
    const last = list[list.length - 1];
    last.detail = `${last.detail ? last.detail + " · " : ""}${list.length} tentativi`;
    for (const x of list.slice(0, -1)) drop.add(x);
  }
  return events.filter((e) => !drop.has(e));
}

/**
 * Cronologia della prenotazione, dalla più vecchia alla più recente. Ogni fonte mancante non produce righe.
 * Nessun dato personale oltre a quello che il titolare vede già nella scheda (nome ospite, indirizzo a cui è stato inviato un messaggio).
 */
export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const client = input.client ?? {};
  const b = input.booking;
  const ids = new Set<string>([b.id, ...(client.bookingIds ?? [])]);
  const c: Ctx = { b, guestName: String(input.guest?.fullName ?? ""), structureName: String(input.structure?.name ?? ""), ids, client };

  const all: TimelineEvent[] = [];
  fromBooking(c, all);
  fromServer(c, input.server ?? [], all);
  fromThreads(c, all);
  fromSentLog(c, all);
  fromActivities(c, all);

  const clean = collapseFailures(dedupeMessages(dedupeUniq(all, b.bookedOn ? eventDay(b.bookedOn) : "")));
  const order = (e: TimelineEvent) => atMs(e.at) ?? 0;
  // A parità di istante: prima la creazione, poi il resto in ordine di inserimento (sort stabile), l'annullamento per ultimo.
  const rank = (e: TimelineEvent) => (e.kind === "created" ? 0 : e.kind === "cancelled" ? 2 : 1);
  return clean
    .map((e, i) => ({ e, i }))
    .sort((a, z) => order(a.e) - order(z.e) || rank(a.e) - rank(z.e) || a.i - z.i)
    .map((x) => x.e);
}
