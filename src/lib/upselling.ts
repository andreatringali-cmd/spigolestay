// Motore dell'Upselling: regole di proposta per prenotazione, registro offerte e statistiche.
// Funzioni PURE (nessuno stato, nessun I/O): la pagina le usa e le scrive con updateBooking.
// Dati reali soltanto: prezzi = quelli impostati dal gestore nel catalogo extra della struttura
// (Structure.extras); offerte = Booking.upsellOffers; extra venduti = Booking.extras.

import type { Booking, ExtraKind, ExtraService, Guest, UpsellOffer } from "./types";
import { DEFAULT_EXTRAS } from "./types";
import { nights as nightsBetween, parseISO, toISO } from "./dates";
import { eur } from "./format";

type BookingExtra = NonNullable<Booking["extras"]>[number];

export const KIND_LABEL: Record<ExtraKind, string> = {
  "late-checkout": "Late check-out",
  "early-checkin": "Early check-in",
  breakfast: "Colazione",
  parking: "Parcheggio",
  transfer: "Transfer",
  excursion: "Escursione / esperienza",
  other: "Altro",
};
export const KINDS = Object.keys(KIND_LABEL) as ExtraKind[];

export const PER_LABEL: Record<ExtraService["per"], string> = { stay: "a soggiorno", night: "a notte", person: "a persona", day: "a giornata" };
export const MONTHS_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export const isActive = (e: ExtraService) => e.active !== false;

// ── Categoria ───────────────────────────────────────────────────────────────────────────────
// Se il gestore non ha scelto una categoria la deduciamo dal nome (così i cataloghi già esistenti
// beneficiano delle regole senza dover essere riconfigurati).
export function kindOf(e: Pick<ExtraService, "kind" | "name" | "id">): ExtraKind {
  if (e.kind) return e.kind;
  const t = `${e.name} ${e.id}`.toLowerCase();
  if (/late\s*-?\s*check|check-?out\s*(posticipat|tardiv)|uscita tardiv|latecheckout/.test(t)) return "late-checkout";
  if (/early\s*-?\s*check|check-?in\s*(anticipat)|earlycheckin/.test(t)) return "early-checkin";
  if (/colazione|breakfast/.test(t)) return "breakfast";
  if (/parcheggio|parking|garage|\bbox\b/.test(t)) return "parking";
  if (/transfer|navetta|shuttle|\btaxi\b|\bncc\b/.test(t)) return "transfer";
  if (/escursion|gommone|barca|\btour\b|\bbici|noleggio|degustazion|esperienza|visita|gita|lezione|massaggio|\bspa\b|cena|aperitivo/.test(t)) return "excursion";
  return "other";
}

// ── Prezzo verificato dal gestore? ──────────────────────────────────────────────────────────
// Gli esempi precaricati (DEFAULT_EXTRAS) hanno prezzi indicativi, NON decisi dal gestore: finché
// non li conferma (o li modifica) non vengono mai proposti a un ospite.
const DEFAULT_BY_ID = new Map(DEFAULT_EXTRAS.map((e) => [e.id, e]));
export function isPriceUnverified(e: ExtraService): boolean {
  if (e.confirmed === true) return false;
  if (e.confirmed === false) return true;
  const d = DEFAULT_BY_ID.get(e.id);
  return !!d && d.name === e.name && d.price === e.price;
}

// ── Stagione, quantità e importi ────────────────────────────────────────────────────────────
export function hasSeason(e: ExtraService): boolean {
  return !!e.seasonFrom && !!e.seasonTo;
}
export function seasonLabel(e: ExtraService): string {
  if (!hasSeason(e)) return "Tutto l'anno";
  return `${MONTHS_IT[(e.seasonFrom as number) - 1]} → ${MONTHS_IT[(e.seasonTo as number) - 1]}`;
}
const monthInSeason = (m: number, from: number, to: number) => (from <= to ? m >= from && m <= to : m >= from || m <= to);

// L'extra è disponibile in almeno una notte del soggiorno?
export function inSeason(e: ExtraService, checkIn: string, checkOut: string): boolean {
  if (!hasSeason(e)) return true;
  const from = e.seasonFrom as number, to = e.seasonTo as number;
  const start = parseISO(checkIn);
  const n = Math.min(400, Math.max(1, nightsBetween(checkIn, checkOut)));
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (monthInSeason(d.getMonth() + 1, from, to)) return true;
  }
  return false;
}

// Importo di UNA unità dell'extra per questa prenotazione (stessa regola del web check-in:
// a notte = prezzo × notti, a persona = prezzo × adulti, a soggiorno/giornata = prezzo).
export function unitAmount(e: Pick<ExtraService, "price" | "per">, b: Pick<Booking, "checkIn" | "checkOut" | "adults">): number {
  const n = Math.max(1, nightsBetween(b.checkIn, b.checkOut));
  if (e.per === "night") return e.price * n;
  if (e.per === "person") return e.price * Math.max(1, b.adults ?? 1);
  return e.price;
}
const round2 = (x: number) => Math.round(x * 100) / 100;

// ── Match tra voce della prenotazione e voce di catalogo ────────────────────────────────────
const baseName = (n: string) => n.replace(/\s×\s?\d+$/u, "").trim().toLowerCase();
export function entryMatches(entry: BookingExtra, e: Pick<ExtraService, "id" | "name">): boolean {
  if (entry.extraId) return entry.extraId === e.id;
  return baseName(entry.name) === e.name.trim().toLowerCase();
}
export const entryName = (name: string, qty: number) => (qty > 1 ? `${name} ×${qty}` : name);

// ── Proposte automatiche per prenotazione ───────────────────────────────────────────────────
export interface Proposal {
  extra: ExtraService;
  kind: ExtraKind;
  status: "ok" | "warn" | "skip";
  reason: string;      // perché è proposto (ok/warn) o perché non lo è (skip)
  unit: number;        // importo di 1 unità per questa prenotazione
  maxQty: number;
}

const fmtShort = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

export interface ProposalCtx {
  extras: ExtraService[];     // catalogo della struttura della prenotazione
  bookings: Booking[];        // prenotazioni della stessa struttura (per le verifiche di disponibilità camera)
  today: string;
}

export function proposalsFor(b: Booking, ctx: ProposalCtx): Proposal[] {
  const n = Math.max(1, nightsBetween(b.checkIn, b.checkOut));
  const inHouse = b.checkIn <= ctx.today;
  const sameUnit = b.unitId ? ctx.bookings.filter((o) => o.id !== b.id && o.unitId === b.unitId && o.status !== "cancelled") : [];
  const out: Proposal[] = [];
  for (const e of ctx.extras) {
    if (!isActive(e)) continue;
    const kind = kindOf(e);
    const base = { extra: e, kind, unit: round2(unitAmount(e, b)), maxQty: Math.max(1, e.maxQty ?? 99) };
    const skip = (reason: string) => out.push({ ...base, status: "skip", reason });
    const ok = (reason: string, status: "ok" | "warn" = "ok") => out.push({ ...base, status, reason });

    if (!(e.price > 0)) { skip("prezzo non impostato nel catalogo"); continue; }
    if (isPriceUnverified(e)) { skip("prezzo di esempio: confermalo nel catalogo prima di proporlo"); continue; }
    if ((b.extras ?? []).some((x) => entryMatches(x, e))) { skip("già nella prenotazione"); continue; }
    if (!inSeason(e, b.checkIn, b.checkOut)) { skip(`fuori stagione (${seasonLabel(e)})`); continue; }
    if (e.minNights && n < e.minNights) { skip(`richiede almeno ${e.minNights} notti (soggiorno di ${n})`); continue; }
    const prev = (b.upsellOffers ?? []).filter((o) => (o.items ?? []).some((it) => it.extraId === e.id));
    if (prev.some((o) => o.status === "declined")) { skip("già rifiutato dall'ospite"); continue; }
    if (kind === "parking" && b.parking) { skip("parcheggio già prenotato"); continue; }
    if (kind === "breakfast" && /colazione|breakfast/i.test(b.ratePlanName ?? "")) { skip("colazione già inclusa nel piano tariffario"); continue; }

    let reason = "";
    let status: "ok" | "warn" = "ok";
    if (kind === "late-checkout") {
      if (b.unitId) {
        const clash = sameUnit.find((o) => o.checkIn === b.checkOut);
        if (clash) { skip(`la camera ha un arrivo il giorno della partenza (${fmtShort(b.checkOut)})`); continue; }
        reason = `Nessun arrivo il ${fmtShort(b.checkOut)} nella stessa camera: il late check-out è fattibile`;
      } else { reason = "Camera non ancora assegnata: verifica che sia libera dopo la partenza"; status = "warn"; }
    } else if (kind === "early-checkin") {
      if (inHouse) { skip("l'ospite è già arrivato"); continue; }
      if (b.unitId) {
        const clash = sameUnit.find((o) => o.checkOut === b.checkIn);
        if (clash) { skip(`la camera si libera solo il giorno dell'arrivo (${fmtShort(b.checkIn)})`); continue; }
        reason = `Camera libera la notte prima del ${fmtShort(b.checkIn)}: l'early check-in è fattibile`;
      } else { reason = "Camera non ancora assegnata: verifica che sia libera prima dell'arrivo"; status = "warn"; }
    } else if (kind === "parking") reason = "Non risulta ancora prenotato il parcheggio";
    else if (kind === "breakfast") reason = e.per === "person" ? `Colazione per ${Math.max(1, b.adults)} ${b.adults === 1 ? "adulto" : "adulti"} nel soggiorno` : "Colazione non inclusa nel piano";
    else if (kind === "transfer") reason = inHouse ? "Utile per la partenza" : `Transfer per l'arrivo del ${fmtShort(b.checkIn)}`;
    else if (kind === "excursion") reason = n >= 2 ? `Soggiorno di ${n} notti: tempo per un'esperienza` : "Esperienza proponibile durante il soggiorno";
    else reason = "Servizio aggiuntivo disponibile";
    if (prev.some((o) => o.status === "sent")) {
      const last = prev.filter((o) => o.status === "sent").sort((a, c) => c.at - a.at)[0];
      reason += ` · già proposto il ${new Date(last.at).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })} (in attesa)`;
      status = "warn";
    }
    ok(reason, status);
  }
  const rank = { ok: 0, warn: 1, skip: 2 } as const;
  return out.sort((a, c) => rank[a.status] - rank[c.status] || c.unit - a.unit);
}

export const proposable = (ps: Proposal[]) => ps.filter((p) => p.status !== "skip");
// Ricavo MASSIMO teorico se l'ospite accettasse tutte le proposte (1 unità per extra).
export const potentialOf = (ps: Proposal[]) => round2(proposable(ps).reduce((a, p) => a + p.unit, 0));

// ── Offerte: esito, registro, scritture ─────────────────────────────────────────────────────
export type OfferOutcome = "pending" | "accepted" | "declined" | "expired" | "removed";

// Le voci dell'offerta effettivamente presenti nella prenotazione (qualunque ne sia l'origine:
// accettazione registrata a mano oppure scelte dall'ospite dal link di check-in online).
export function presentEntries(o: UpsellOffer, b: Booking): BookingExtra[] {
  const found: BookingExtra[] = [];
  for (const it of o.items ?? []) {
    const hit = (b.extras ?? []).find((x) => (x.offerId === o.id && x.extraId === it.extraId) || entryMatches(x, { id: it.extraId, name: it.name }));
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

export function offerOutcome(o: UpsellOffer, b: Booking, today: string): OfferOutcome {
  if (o.status === "declined") return "declined";
  const present = presentEntries(o, b);
  if (o.status === "accepted") return present.length ? "accepted" : "removed";
  if (present.length) return "accepted"; // l'ospite li ha scelti dal link di check-in online
  if (b.checkOut <= today) return "expired";
  return "pending";
}
export const offerRevenue = (o: UpsellOffer, b: Booking) => round2(presentEntries(o, b).reduce((a, x) => a + (x.price || 0), 0));
export const offerAcceptedViaLink = (o: UpsellOffer, b: Booking, today: string) => o.status === "sent" && offerOutcome(o, b, today) === "accepted";

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `of-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

export function newOffer(via: UpsellOffer["via"], items: UpsellOffer["items"], status: UpsellOffer["status"] = "sent"): UpsellOffer {
  const now = Date.now();
  return { id: uid(), at: now, via, items, total: round2(items.reduce((a, i) => a + i.amount, 0)), status, ...(status !== "sent" ? { decidedAt: now } : {}) };
}

export function itemsFromPicks(picks: { p: Proposal; qty: number }[]): UpsellOffer["items"] {
  return picks.map(({ p, qty }) => ({ extraId: p.extra.id, name: p.extra.name, qty, amount: round2(p.unit * qty) }));
}

// Patch della prenotazione che REGISTRA un'offerta appena inviata (stato "sent").
export function patchRecordSent(b: Booking, offer: UpsellOffer): Partial<Booking> {
  return { upsellOffers: [...(b.upsellOffers ?? []), offer] };
}

// Patch che ACCETTA un'offerta: aggiunge gli extra alla prenotazione (il totale ospite si ricalcola
// da solo: bookingGrandTotal somma Booking.extras), marca l'offerta come accettata e, per il
// parcheggio, attiva il flag che seleziona i codici d'accesso "con parcheggio" nella guida.
export function patchAccept(b: Booking, offer: UpsellOffer, catalog: ExtraService[]): Partial<Booking> {
  const now = Date.now();
  const extras = [...(b.extras ?? [])];
  let parking = b.parking;
  for (const it of offer.items) {
    const already = extras.some((x) => entryMatches(x, { id: it.extraId, name: it.name }));
    if (!already) extras.push({ name: entryName(it.name, it.qty), price: it.amount, extraId: it.extraId, qty: it.qty, offerId: offer.id });
    const cat = catalog.find((c) => c.id === it.extraId);
    if (kindOf(cat ?? { id: it.extraId, name: it.name }) === "parking") parking = true;
  }
  const accepted: UpsellOffer = { ...offer, status: "accepted", decidedAt: now };
  const list = b.upsellOffers ?? [];
  const upsellOffers = list.some((o) => o.id === offer.id) ? list.map((o) => (o.id === offer.id ? accepted : o)) : [...list, accepted];
  return { extras, upsellOffers, ...(parking ? { parking: true } : {}) };
}

export const patchSetStatus = (b: Booking, offerId: string, status: UpsellOffer["status"]): Partial<Booking> => ({
  upsellOffers: (b.upsellOffers ?? []).map((o) => (o.id === offerId ? { ...o, status, ...(status === "sent" ? { decidedAt: undefined } : { decidedAt: Date.now() }) } : o)),
});
export const patchDeleteOffer = (b: Booking, offerId: string): Partial<Booking> => ({ upsellOffers: (b.upsellOffers ?? []).filter((o) => o.id !== offerId) });

// ── Lingua e testo del messaggio ────────────────────────────────────────────────────────────
export type Lang = "it" | "en" | "fr" | "de" | "es";
const COUNTRY_LANG: Record<string, Lang> = { IT: "it", FR: "fr", DE: "de", AT: "de", CH: "de", ES: "es", MX: "es", AR: "es", CO: "es", CL: "es" };
export function guestLang(g?: Pick<Guest, "language" | "country">): Lang {
  const l = (g?.language ?? "").slice(0, 2).toLowerCase();
  if (l === "it" || l === "en" || l === "fr" || l === "de" || l === "es") return l;
  const c = (g?.country ?? "").trim().toUpperCase();
  if (COUNTRY_LANG[c]) return COUNTRY_LANG[c];
  return "it";
}

const MSG: Record<Lang, { hello: (n: string) => string; intro: (d: string) => string; reply: string; link: string; bye: string; loc: string; total: string }> = {
  it: { hello: (n) => `Ciao ${n},`, intro: (d) => `per rendere ancora più speciale il tuo soggiorno dal ${d}, possiamo aggiungere:`, reply: "Rispondi a questo messaggio per confermare e ci pensiamo noi.", link: "Oppure aggiungili direttamente dal tuo check-in online:", bye: "A presto,", loc: "it-IT", total: "Totale" },
  en: { hello: (n) => `Hi ${n},`, intro: (d) => `to make your stay from ${d} even more special, we can add:`, reply: "Just reply to this message to confirm and we'll take care of it.", link: "Or add them directly from your online check-in:", bye: "See you soon,", loc: "en-GB", total: "Total" },
  fr: { hello: (n) => `Bonjour ${n},`, intro: (d) => `pour rendre votre séjour du ${d} encore plus agréable, nous pouvons ajouter :`, reply: "Répondez à ce message pour confirmer, nous nous occupons du reste.", link: "Ou ajoutez-les directement depuis votre check-in en ligne :", bye: "À bientôt,", loc: "fr-FR", total: "Total" },
  de: { hello: (n) => `Hallo ${n},`, intro: (d) => `um Ihren Aufenthalt ab dem ${d} noch besonderer zu machen, können wir anbieten:`, reply: "Antworten Sie einfach auf diese Nachricht, wir kümmern uns darum.", link: "Oder fügen Sie sie direkt in Ihrem Online-Check-in hinzu:", bye: "Bis bald,", loc: "de-DE", total: "Gesamt" },
  es: { hello: (n) => `Hola ${n},`, intro: (d) => `para hacer tu estancia desde el ${d} aún más especial, podemos añadir:`, reply: "Responde a este mensaje para confirmar y nos encargamos de todo.", link: "O añádelos directamente desde tu check-in online:", bye: "¡Hasta pronto!", loc: "es-ES", total: "Total" },
};

export function buildOfferMessage(o: { lang: Lang; firstName: string; structureName: string; checkIn: string; items: UpsellOffer["items"]; link?: string }): string {
  const m = MSG[o.lang];
  const d = parseISO(o.checkIn).toLocaleDateString(m.loc, { day: "numeric", month: "long" });
  const list = o.items.map((i) => `• ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""} — ${eur(i.amount)}`).join("\n");
  const sum = o.items.reduce((a, i) => a + i.amount, 0);
  const total = o.items.length > 1 && sum > 0 ? `\n${m.total}: ${eur(sum)}` : "";
  return `${m.hello(o.firstName)}\n${m.intro(d)}\n\n${list}${total}\n\n${m.reply}${o.link ? `\n${m.link} ${o.link}` : ""}\n\n${m.bye}\n${o.structureName}`.replace(/\n{3,}/g, "\n\n").trim();
}

// ── Statistiche ─────────────────────────────────────────────────────────────────────────────
export interface ExtraStat { key: string; extraId: string; structureId: string; name: string; offered: number; accepted: number; declined: number; soldQty: number; soldRevenue: number }
export interface UpsellStats {
  bookings: number;             // prenotazioni (non annullate) nel periodo
  withExtra: number;            // quante hanno almeno un extra di catalogo
  offers: number;               // offerte inviate (escluse le vendite dirette)
  accepted: number; declined: number; expired: number; pending: number; removed: number;
  direct: number;               // vendite dirette registrate a mano (non pesano sul tasso di conversione)
  conversion: number | null;    // accettate / (accettate + rifiutate + scadute); null se nessuna offerta decisa
  acceptedRevenue: number;      // € incassabili dalle offerte accettate e dalle vendite dirette (voci ancora presenti in prenotazione)
  pendingValue: number;         // € delle offerte in attesa di risposta
  soldRevenue: number;          // € extra di catalogo venduti (qualunque origine: offerte, check-in online, a mano)
  otherRevenue: number;         // € extra/consumi liberi non presenti nel catalogo
  paidShare: number;            // € di extra venduti su prenotazioni già saldate
  perExtra: ExtraStat[];
}

export interface StatsInput { bookings: Booking[]; catalogOf: (structureId: string) => ExtraService[]; today: string }

export function upsellStats({ bookings, catalogOf, today }: StatsInput): UpsellStats {
  const s: UpsellStats = { bookings: 0, withExtra: 0, offers: 0, accepted: 0, declined: 0, expired: 0, pending: 0, removed: 0, direct: 0, conversion: null, acceptedRevenue: 0, pendingValue: 0, soldRevenue: 0, otherRevenue: 0, paidShare: 0, perExtra: [] };
  const per = new Map<string, ExtraStat>();
  const stat = (sid: string, e: { id: string; name: string }) => {
    const key = `${sid}|${e.id}`;
    let r = per.get(key);
    if (!r) { r = { key, extraId: e.id, structureId: sid, name: e.name, offered: 0, accepted: 0, declined: 0, soldQty: 0, soldRevenue: 0 }; per.set(key, r); }
    return r;
  };
  for (const b of bookings) {
    if (b.status === "cancelled" || b.channel === "blocked") continue;
    s.bookings++;
    const cat = catalogOf(b.structureId);
    let any = false;
    const grand = (b.total ?? 0) + (b.cleaningFee ?? 0) + (b.extras ?? []).reduce((a, x) => a + (x.price || 0), 0);
    const settled = grand > 0 && (b.paid ?? 0) >= grand;
    for (const x of b.extras ?? []) {
      const c = cat.find((e) => entryMatches(x, e));
      if (c) { any = true; const r = stat(b.structureId, c); r.soldQty += x.qty ?? 1; r.soldRevenue = round2(r.soldRevenue + (x.price || 0)); s.soldRevenue += x.price || 0; if (settled) s.paidShare += x.price || 0; }
      else s.otherRevenue += x.price || 0;
    }
    if (any) s.withExtra++;
    for (const o of b.upsellOffers ?? []) {
      const out = offerOutcome(o, b, today);
      if (o.via === "diretto") {
        s.direct++;
        if (out === "accepted") s.acceptedRevenue += offerRevenue(o, b);
        continue;
      }
      s.offers++;
      if (out === "accepted") { s.accepted++; s.acceptedRevenue += offerRevenue(o, b); }
      else if (out === "declined") s.declined++;
      else if (out === "expired") s.expired++;
      else if (out === "removed") s.removed++;
      else { s.pending++; s.pendingValue += o.total; }
      for (const it of o.items) {
        const r = stat(b.structureId, { id: it.extraId, name: it.name });
        r.offered++;
        if (out === "accepted") r.accepted++; else if (out === "declined" || out === "expired") r.declined++;
      }
    }
  }
  const decided = s.accepted + s.declined + s.expired;
  s.conversion = decided > 0 ? s.accepted / decided : null;
  s.soldRevenue = round2(s.soldRevenue); s.otherRevenue = round2(s.otherRevenue); s.acceptedRevenue = round2(s.acceptedRevenue); s.pendingValue = round2(s.pendingValue); s.paidShare = round2(s.paidShare);
  s.perExtra = [...per.values()].sort((a, c) => c.soldRevenue - a.soldRevenue || c.offered - a.offered);
  return s;
}

// Un tasso storico è usabile per una STIMA solo se c'è abbastanza storia (altrimenti non inventiamo nulla).
export const MIN_DECIDED_FOR_ESTIMATE = 5;
export function estimateRate(s: UpsellStats): number | null {
  return s.conversion !== null && s.accepted + s.declined + s.expired >= MIN_DECIDED_FOR_ESTIMATE ? s.conversion : null;
}

export const todayISO = () => toISO(new Date());
