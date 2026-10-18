// ============================================================
//  Revisioni di una prenotazione Channex: modello leggibile + confronto tra due revisioni.
//  Modulo PURO (nessun accesso a rete/DB): testabile con `node --test`.
//
//  Una "revisione" è ciò che l'OTA ha mandato a Channex a ogni evento della prenotazione:
//  Nuovo (prima volta), Modificata (cambio date/ospiti/prezzo/note...), Cancellata.
//  Campi letti, tutti dalla documentazione ufficiale Channex (bookings-collection):
//   revisione: id, booking_id, system_id, unique_id, status (new|modified|cancelled), ota_name, ota_reservation_code,
//              arrival_date, departure_date, arrival_hour, amount, currency, notes, ota_commission,
//              payment_collect, payment_type, occupancy, customer, services[], guarantee, inserted_at
//   camera:    checkin_date, checkout_date, room_type_id, rate_plan_id, occupancy{adults,children,infants,ages},
//              guests[], days{data:importo}, amount, services[], taxes[], meta (penali, pasti, ...)
// ============================================================
import { eur } from "./format";
import { describeCancelPenalties, readRevisionGuestData, roomTotalExact } from "./channex-guestdata";

type Json = Record<string, unknown>;

export type RevisionKind = "new" | "modified" | "cancelled" | "unknown";

export interface RevisionCharge { label: string; detail?: string; amount: number | null; kind: "servizio" | "tassa" | "spesa"; inclusive?: boolean }
export interface RevisionNight { date: string; amount: number }
export interface RevisionRoomView {
  roomTypeId?: string; ratePlanId?: string;
  promotion?: string;            // codice promozionale dell'OTA (room.meta.promotion)
  checkIn: string; checkOut: string; nights: number;
  adults: number; children: number; infants: number; childAges: number[];
  guests: string[];
  total: number | null;
  nightly: RevisionNight[];
  charges: RevisionCharge[];
}
export interface RevisionCustomer { genius?: boolean; name: string; email?: string; phone?: string; country?: string; city?: string; address?: string; zip?: string; language?: string }

export interface RevisionView {
  revisionId: string;
  shortId: string;               // primi 8 caratteri dell'id revisione ("Identificativo del sistema")
  systemId?: string;             // system_id dell'OTA, se presente
  bookingId?: string;
  kind: RevisionKind;
  label: string;                 // Nuovo / Modificata / Cancellata
  rawStatus: string;
  at: string | null;             // istante ISO (inserted_at di Channex, altrimenti la data di importazione)
  atLabel: string;               // "17.10.2026 07:27:33" (ora italiana)
  channel?: string;              // nome dell'OTA
  otaCode?: string;
  uniqueId?: string;
  ruid?: string;                 // RUID di Channex (identificativo univoco della revisione presso l'OTA)
  policiesText?: string;         // «Politiche» come le scrive l'OTA (Booking.com: room.meta.policies)
  deposits?: string;             // depositi della prenotazione ("50,00 EUR"), vuoto se non ce ne sono
  currency: string;
  checkIn: string; checkOut: string; nights: number;
  arrivalHour?: string;
  adults: number; children: number; infants: number;
  total: number | null;
  commission: number | null;
  paymentCollect?: string; paymentType?: string;
  notes?: string;
  customer: RevisionCustomer;
  rooms: RevisionRoomView[];
  charges: RevisionCharge[];     // servizi/spese/tasse a livello di prenotazione e di camera
  policies: string[];            // politiche di cancellazione, pasti, pagamento...
  // Garanzia: SOLO dati non sensibili. Numero (se già mascherato dall'OTA), scadenza e titolare solo per le carte VIRTUALI delle OTA; mai il CVV (solo se c'è).
  guarantee?: { cardType?: string; isVirtual?: boolean; cardNumber?: string; expiry?: string; holder?: string; cvv?: boolean; vccActivation?: string; vccBalance?: number; vccCurrency?: string };
  raw?: Json;                    // attributi originali senza dati di carta/token (solo su richiesta: la route lo toglie con stripRaw)
}

/** Vista senza il JSON originale (pesa parecchio e serve solo quando si apre «Dati originali»). */
export function stripRaw(view: RevisionView): RevisionView {
  const { raw: _raw, ...rest } = view;
  void _raw;
  return rest;
}

// ── Utilità ──────────────────────────────────────────────────
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? (v.trim() || undefined) : typeof v === "number" ? String(v) : undefined);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const intOr0 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** "2026-10-28" → "28.10.2026" (altro → invariato; vuoto → ""). */
export function dmy(iso?: string | null): string {
  const m = ISO_DAY.exec(String(iso ?? ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? "");
}

function nightsBetween(a: string, b: string): number {
  const ma = ISO_DAY.exec(a), mb = ISO_DAY.exec(b);
  if (!ma || !mb) return 0;
  const d = (Date.UTC(+mb[1], +mb[2] - 1, +mb[3]) - Date.UTC(+ma[1], +ma[2] - 1, +ma[3])) / 86_400_000;
  return Math.max(0, Math.round(d));
}

/** Importo con la valuta: euro come "€ 1.234,00", altre valute con il codice ("GBP 76,50"). Valore assente → "—". */
export function money(n: number | null | undefined, currency?: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const c = (currency || "EUR").toUpperCase();
  return c === "EUR" ? eur(n) : eur(n, c);
}

const ROME_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
/** Istante → "gg.mm.aaaa hh:mm:ss" in ora italiana. Stringhe senza fuso (Channex: "2019-04-23T10:03:29.335485") sono UTC. */
export function romeDateTime(ts?: string | null, withSeconds = true): { iso: string | null; label: string } {
  if (!ts) return { iso: null, label: "" };
  let s = String(ts).trim().replace(" ", "T");
  if (!/(z|[+-]\d{2}:?\d{2})$/i.test(s)) s += "Z";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { iso: null, label: String(ts) };
  const p: Record<string, string> = {};
  for (const x of ROME_PARTS.formatToParts(d)) p[x.type] = x.value;
  const hms = `${p.hour}:${p.minute}${withSeconds ? `:${p.second}` : ""}`;
  return { iso: d.toISOString(), label: `${p.day}.${p.month}.${p.year} ${hms}` };
}

// ── Etichetta di stato ───────────────────────────────────────
export function revisionKind(status: unknown): RevisionKind {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "new") return "new";
  if (s === "modified") return "modified";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "unknown";
}
/** Stato Channex (new/modified/cancelled) → "Nuovo" / "Modificata" / "Cancellata". Stato ignoto → "Revisione". */
export function revisionLabel(status: unknown): string {
  const k = revisionKind(status);
  return k === "new" ? "Nuovo" : k === "modified" ? "Modificata" : k === "cancelled" ? "Cancellata" : "Revisione";
}

/** Persone: "2 adulti, 1 bambino, 1 neonato". */
export function guestsLabel(adults: number, children = 0, infants = 0): string {
  const parts = [`${adults} ${adults === 1 ? "adulto" : "adulti"}`];
  if (children > 0) parts.push(`${children} ${children === 1 ? "bambino" : "bambini"}`);
  if (infants > 0) parts.push(`${infants} ${infants === 1 ? "neonato" : "neonati"}`);
  return parts.join(", ");
}

// ── Normalizzazione ──────────────────────────────────────────
/** Codice promozionale di una camera (Channex: room.meta.promotion, a volte un oggetto con il nome). */
function roomPromotion(room: Json): string | undefined {
  const m = isObj(room.meta) ? room.meta : null;
  const text = (p: unknown): string | undefined => (isObj(p) ? str(p.name) ?? str(p.title) ?? str(p.description) ?? str(p.code) : str(p));
  const found: string[] = [];
  for (const src of [m, room]) {
    if (!src) continue;
    for (const k of Object.keys(src)) {
      if (!/promo/i.test(k)) continue;
      const v = src[k];
      for (const x of Array.isArray(v) ? v : [v]) { const t = text(x); if (t && !found.includes(t)) found.push(t); }
    }
  }
  return found.length ? found.join(", ") : undefined;
}

/** Numero carta SOLO se già mascherato dall'OTA (primi 6 e ultimi 4); un numero intero viene ridotto a 6+4, mai mostrato per esteso. */
function maskedCardNumber(v: unknown): string | undefined {
  const n = str(v)?.replace(/\s+/g, "");
  if (!n) return undefined;
  const digits = n.replace(/\D/g, "");
  if (/[*xX•]/.test(n)) return n.length <= 24 ? n : undefined;
  return digits.length >= 12 ? `${digits.slice(0, 6)}${"*".repeat(Math.max(digits.length - 10, 4))}${digits.slice(-4)}` : undefined;
}

function chargeOf(s: unknown, kind: RevisionCharge["kind"]): RevisionCharge | null {
  if (!isObj(s)) return null;
  const label = str(s.name) || str(s.type);
  if (!label) return null;
  const amount = numOrNull(s.total_price);
  const bits: string[] = [];
  const persons = intOr0(s.persons), nights = intOr0(s.nights);
  if (persons) bits.push(`${persons} ${persons === 1 ? "persona" : "persone"}`);
  if (nights) bits.push(`${nights} ${nights === 1 ? "notte" : "notti"}`);
  const mode = str(s.price_mode);
  if (mode) bits.push(mode.toLowerCase());
  return { label, kind, amount, ...(bits.length ? { detail: bits.join(" · ") } : {}), ...(typeof s.is_inclusive === "boolean" ? { inclusive: s.is_inclusive } : {}) };
}

const SENSITIVE_KEY = /card|cvv|cvc|token|iban|expir/i;
const GUARANTEE_KEEP = ["card_type", "is_virtual"];

function scrubSensitive(v: unknown, depth = 0): void {
  if (depth > 12) return;
  if (Array.isArray(v)) { for (const x of v) scrubSensitive(x, depth + 1); return; }
  if (!isObj(v)) return;
  for (const k of Object.keys(v)) {
    if (k === "guarantee") {
      // Garanzia: allowlist (solo tipo carta e se è virtuale). Token del PCI vault, scadenza, titolare, numero, CVV non escono mai dal server.
      const g = v[k];
      if (isObj(g)) { const kept: Json = {}; for (const f of GUARANTEE_KEEP) if (f in g) kept[f] = g[f]; v[k] = kept; } else delete v[k];
      continue;
    }
    if (SENSITIVE_KEY.test(k)) { delete v[k]; continue; }
    scrubSensitive(v[k], depth + 1);
  }
}

/**
 * Copia dei dati originali senza dati di pagamento: `guarantee` ridotta a card_type/is_virtual e, ovunque, chiavi che
 * contengono card/cvv/cvc/token/iban/expir (numero, CVV, titolare, scadenza, token del vault Channex) rimosse.
 * Xenora non è un ente PCI e non li mostra né li copia.
 */
export function redactRaw(row: Json): Json {
  const out: Json = JSON.parse(JSON.stringify(row ?? {}));
  scrubSensitive(out);
  return out;
}

/** RUID: Channex non lo documenta, quindi si cerca nei posti dove di solito sta (attributi, meta della prenotazione, meta del cliente o della garanzia). */
function ruidOf(rev: Json, customerMeta: Json): string | undefined {
  const gm = isObj(rev.guarantee) && isObj(rev.guarantee.meta) ? rev.guarantee.meta : {};
  const m = isObj(rev.meta) ? rev.meta : {};
  return str(rev.ruid) ?? str(m.ruid) ?? str(customerMeta.ruid) ?? str(gm.ruid);
}

function guaranteeView(g: Json, rev: Json): NonNullable<RevisionView["guarantee"]> {
  const gm: Json = isObj(g.meta) ? g.meta : {}; // Channex: i campi virtual_card_* stanno in guarantee.meta
  const pick = (k: string) => g[k] ?? gm[k] ?? rev[k];
  const isVirtual = typeof g.is_virtual === "boolean" ? g.is_virtual : pick("is_virtual_card") === true ? true : undefined;
  const rawBal = numOrNull(pick("virtual_card_current_balance"));
  const dec = numOrNull(pick("virtual_card_decimal_places")) ?? 0;
  const balance = rawBal == null ? undefined : dec > 0 ? rawBal / Math.pow(10, dec) : rawBal;
  const act = str(pick("virtual_card_effective_date"));
  const cvv = str(g.cvv);
  return {
    ...(str(g.card_type) ? { cardType: str(g.card_type) } : {}),
    ...(isVirtual !== undefined ? { isVirtual } : {}),
    // Numero, scadenza e titolare solo per le carte virtuali (dati del canale, non di un ospite); il CVV mai: solo se presente.
    ...(isVirtual && maskedCardNumber(g.card_number) ? { cardNumber: maskedCardNumber(g.card_number) } : {}),
    ...(isVirtual && str(g.expiration_date) ? { expiry: str(g.expiration_date) } : {}),
    ...(isVirtual && str(g.cardholder_name) ? { holder: str(g.cardholder_name) } : {}),
    ...(cvv ? { cvv: true } : {}),
    ...(act ? { vccActivation: act } : {}),
    ...(balance != null ? { vccBalance: balance } : {}),
    ...(str(pick("virtual_card_currency_code")) ? { vccCurrency: str(pick("virtual_card_currency_code")) } : {}),
  };
}

/**
 * Riga Channex (id + attributi della revisione, come restituita da getBookingRevision) → modello leggibile.
 * `opts.importedAt`: data di importazione (channex_bookings.imported_at), usata se la revisione non porta inserted_at.
 */
export function normalizeRevision(row: unknown, opts: { importedAt?: string | null } = {}): RevisionView {
  const r: Json = isObj(row) ? row : {};
  const attrs: Json = isObj(r.attributes) ? (r.attributes as Json) : r;
  const rev: Json = { ...attrs, ...(r.id !== undefined && attrs.id === undefined ? { id: r.id } : {}) };
  const revisionId = String(rev.id ?? r.id ?? "");
  const rawStatus = String(rev.status ?? "");
  const kind = revisionKind(rawStatus);
  const when = romeDateTime(str(rev.inserted_at) ?? opts.importedAt ?? null);

  const roomsRaw = arr(rev.rooms).filter(isObj);
  const rooms: RevisionRoomView[] = roomsRaw.map((room, i) => {
    const occ = isObj(room.occupancy) ? room.occupancy : {};
    const ci = str(room.checkin_date) ?? str(rev.arrival_date) ?? "";
    const co = str(room.checkout_date) ?? str(rev.departure_date) ?? "";
    const days = isObj(room.days) ? room.days : {};
    const nightly: RevisionNight[] = Object.entries(days)
      .filter(([d]) => ISO_DAY.test(d))
      .map(([date, v]) => ({ date, amount: numOrNull(v) ?? 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const total = roomTotalExact(room, rev.amount, i === 0);
    const charges = [
      ...arr(room.services).map((s) => chargeOf(s, "servizio")),
      ...arr(room.taxes).map((s) => chargeOf(s, "tassa")),
    ].filter((x): x is RevisionCharge => !!x);
    const guests = arr(room.guests).filter(isObj).map((g) => [str(g.name), str(g.surname)].filter(Boolean).join(" ")).filter(Boolean);
    return {
      ...(str(room.room_type_id) ? { roomTypeId: str(room.room_type_id) } : {}),
      ...(str(room.rate_plan_id) ? { ratePlanId: str(room.rate_plan_id) } : {}),
      ...(roomPromotion(room) ? { promotion: roomPromotion(room) } : {}),
      checkIn: ci, checkOut: co, nights: nightsBetween(ci, co),
      adults: intOr0(occ.adults), children: intOr0(occ.children), infants: intOr0(occ.infants),
      childAges: arr(occ.ages).map(Number).filter((n) => Number.isFinite(n) && n >= 0),
      guests, total: total > 0 ? total : null, nightly, charges,
    };
  });

  const arrival = str(rev.arrival_date) ?? rooms.map((x) => x.checkIn).filter(Boolean).sort()[0] ?? "";
  const departure = str(rev.departure_date) ?? rooms.map((x) => x.checkOut).filter(Boolean).sort().slice(-1)[0] ?? "";
  const occTop = isObj(rev.occupancy) ? rev.occupancy : null;
  const sum = (k: "adults" | "children" | "infants") => rooms.reduce((a, x) => a + x[k], 0);
  const adults = occTop ? intOr0(occTop.adults) : sum("adults");
  const children = occTop ? intOr0(occTop.children) : sum("children");
  const infants = occTop ? intOr0(occTop.infants) : sum("infants");

  let total = numOrNull(rev.amount);
  if (total === null) { const s = rooms.reduce((a, x) => a + (x.total ?? 0), 0); total = s > 0 ? s : null; }

  const c = isObj(rev.customer) ? rev.customer : {};
  const cm: Json = isObj(c.meta) ? c.meta : {};
  const customer: RevisionCustomer = {
    ...(cm.is_genius === true || cm.is_genius === "true" ? { genius: true } : {}), // Booking.com: customer.meta.is_genius
    name: [str(c.name), str(c.surname)].filter(Boolean).join(" "),
    ...(str(c.mail) || str(c.email) ? { email: str(c.mail) ?? str(c.email) } : {}),
    ...(str(c.phone) ? { phone: str(c.phone) } : {}),
    ...(str(c.country) ? { country: str(c.country) } : {}),
    ...(str(c.city) ? { city: str(c.city) } : {}),
    ...(str(c.address) ? { address: str(c.address) } : {}),
    ...(str(c.zip) || str(c.postal_code) ? { zip: str(c.zip) ?? str(c.postal_code) } : {}),
    ...(str(c.language) ? { language: str(c.language) } : {}),
  };

  // Politiche leggibili: penali di cancellazione, pasti, istruzioni di pagamento, preferenze (da meta delle camere).
  const policies: string[] = [];
  const addPolicy = (p?: string) => { if (p && !policies.includes(p)) policies.push(p); };
  roomsRaw.forEach((room, i) => {
    const info = readRevisionGuestData(rev, room, i === 0).otaInfo;
    addPolicy(describeCancelPenalties(info?.cancelPenalties));
    if (info?.mealPlan) addPolicy(`Pasti: ${info.mealPlan}`);
    if (info?.paymentInstruction) addPolicy(`Pagamento: ${info.paymentInstruction}`);
    if (info?.bedPreferences) addPolicy(`Letti: ${info.bedPreferences}`);
    if (info?.smokingPreferences) addPolicy(`Fumatori: ${info.smokingPreferences}`);
  });

  const policiesText = [...new Set(roomsRaw.map((room) => (isObj(room.meta) ? str(room.meta.policies) : undefined)).filter((x): x is string => !!x))].join("\n\n");
  const depList = Array.isArray(rev.deposits) ? rev.deposits : rev.deposit != null ? [rev.deposit] : [];
  const deposits = depList.map((d) => {
    if (isObj(d)) { const a = numOrNull(d.amount ?? d.value); const cur = str(d.currency) ?? str(rev.currency) ?? "EUR"; return a != null ? `${a.toFixed(2).replace(".", ",")} ${cur.toUpperCase()}` : undefined; }
    const a = numOrNull(d); return a != null ? `${a.toFixed(2).replace(".", ",")} ${(str(rev.currency) ?? "EUR").toUpperCase()}` : undefined;
  }).filter((x): x is string => !!x).join(", ");

  const charges = [
    ...arr(rev.services).map((s) => chargeOf(s, "servizio")),
    ...rooms.flatMap((x) => x.charges),
  ].filter((x): x is RevisionCharge => !!x);

  const g = isObj(rev.guarantee) ? rev.guarantee : null;
  const notes = str(rev.notes);

  return {
    revisionId, shortId: revisionId.slice(0, 8),
    ...(str(rev.system_id) ? { systemId: str(rev.system_id) } : {}),
    ...(str(rev.booking_id) ? { bookingId: str(rev.booking_id) } : {}),
    kind, label: revisionLabel(rawStatus), rawStatus,
    at: when.iso, atLabel: when.label,
    ...(str(rev.ota_name) ? { channel: str(rev.ota_name) } : {}),
    ...(str(rev.ota_reservation_code) ? { otaCode: str(rev.ota_reservation_code) } : {}),
    ...(str(rev.unique_id) ? { uniqueId: str(rev.unique_id) } : {}),
    ...(ruidOf(rev, cm) ? { ruid: ruidOf(rev, cm) } : {}),
    ...(policiesText ? { policiesText } : {}),
    ...(deposits ? { deposits } : {}),
    currency: (str(rev.currency) ?? "EUR").toUpperCase(),
    checkIn: arrival, checkOut: departure, nights: nightsBetween(arrival, departure),
    ...(str(rev.arrival_hour) ? { arrivalHour: str(rev.arrival_hour)!.slice(0, 5) } : {}),
    adults, children, infants, total,
    commission: numOrNull(rev.ota_commission ?? rev.commission),
    ...(str(rev.payment_collect) ? { paymentCollect: str(rev.payment_collect) } : {}),
    ...(str(rev.payment_type) ? { paymentType: str(rev.payment_type) } : {}),
    ...(notes ? { notes } : {}),
    customer, rooms, charges, policies,
    ...(g ? { guarantee: guaranteeView(g, rev) } : {}),
    raw: redactRaw(r),
  };
}

// ── Etichette dei valori ─────────────────────────────────────
export const COLLECT_LABEL: Record<string, string> = { property: "la struttura", ota: "l'OTA" };
export const PAYTYPE_LABEL: Record<string, string> = { credit_card: "carta di credito", bank_transfer: "bonifico" };
const collectOf = (v?: string) => (v ? COLLECT_LABEL[v] ?? v : "—");
const payTypeOf = (v?: string) => (v ? PAYTYPE_LABEL[v] ?? v : "—");

// ── Confronto tra due revisioni ──────────────────────────────
const chargeKey = (c: RevisionCharge, n: number) => `${c.kind}:${c.label.toLowerCase()}#${n}`;
function chargeMap(list: RevisionCharge[]): Map<string, RevisionCharge> {
  const seen = new Map<string, number>(); const out = new Map<string, RevisionCharge>();
  for (const c of list) { const base = `${c.kind}:${c.label.toLowerCase()}`; const n = (seen.get(base) ?? 0) + 1; seen.set(base, n); out.set(chargeKey(c, n), c); }
  return out;
}
const MAX_PRICE_LINES = 6;

/**
 * Cosa è cambiato da `prev` a `next`, in righe leggibili in italiano ("Arrivo: 28.10.2026 → 30.10.2026").
 * Ignora i campi tecnici (id, system_id, date di arrivo del messaggio, raw). `prev` assente (prima revisione) → [].
 * Array vuoto = nessuna differenza di rilievo.
 */
export function diffRevisions(prev: RevisionView | null | undefined, next: RevisionView): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const cur = next.currency || prev.currency;
  const chg = (label: string, a: string, b: string) => { if (a !== b) out.push(`${label}: ${a || "—"} → ${b || "—"}`); };

  if (next.kind === "cancelled" && prev.kind !== "cancelled") out.push("Prenotazione cancellata");
  else if (prev.kind === "cancelled" && next.kind !== "cancelled") out.push("Prenotazione ripristinata");

  chg("Canale", prev.channel ?? "", next.channel ?? "");
  chg("Codice prenotazione", prev.otaCode ?? "", next.otaCode ?? "");
  chg("Arrivo", dmy(prev.checkIn), dmy(next.checkIn));
  chg("Partenza", dmy(prev.checkOut), dmy(next.checkOut));
  chg("Notti", String(prev.nights), String(next.nights));
  chg("Orario di arrivo", prev.arrivalHour ?? "", next.arrivalHour ?? "");
  chg("Ospiti", guestsLabel(prev.adults, prev.children, prev.infants), guestsLabel(next.adults, next.children, next.infants));
  chg("Totale", money(prev.total, prev.currency), money(next.total, cur));
  if (prev.currency !== next.currency) chg("Valuta", prev.currency, next.currency);
  chg("Commissione", money(prev.commission, prev.currency), money(next.commission, cur));
  chg("Pagamento incassato da", collectOf(prev.paymentCollect), collectOf(next.paymentCollect));
  chg("Tipo di pagamento", payTypeOf(prev.paymentType), payTypeOf(next.paymentType));
  chg("Cliente", prev.customer.name, next.customer.name);
  chg("Email", prev.customer.email ?? "", next.customer.email ?? "");
  chg("Telefono", prev.customer.phone ?? "", next.customer.phone ?? "");
  chg("Paese", prev.customer.country ?? "", next.customer.country ?? "");

  const pn = (prev.notes ?? "").trim(), nn = (next.notes ?? "").trim();
  if (pn !== nn) out.push(!pn ? "Note: aggiunte" : !nn ? "Note: rimosse" : "Note: modificate");

  // Camere
  if (prev.rooms.length !== next.rooms.length) out.push(`Camere: ${prev.rooms.length} → ${next.rooms.length}`);
  const multi = prev.rooms.length > 1 || next.rooms.length > 1;
  const priceLines: string[] = [];
  const common = Math.min(prev.rooms.length, next.rooms.length);
  for (let i = 0; i < common; i++) {
    const a = prev.rooms[i], b = next.rooms[i];
    const pre = multi ? `Camera ${i + 1} · ` : "";
    if (a.roomTypeId !== b.roomTypeId) out.push(`${pre}Tipologia camera: modificata`);
    if (a.ratePlanId !== b.ratePlanId) out.push(`${pre}Tariffa: modificata`);
    if (multi) {
      chg(`${pre}Arrivo`, dmy(a.checkIn), dmy(b.checkIn));
      chg(`${pre}Partenza`, dmy(a.checkOut), dmy(b.checkOut));
      chg(`${pre}Ospiti`, guestsLabel(a.adults, a.children, a.infants), guestsLabel(b.adults, b.children, b.infants));
      chg(`${pre}Totale`, money(a.total, prev.currency), money(b.total, cur));
    }
    if (a.childAges.join(",") !== b.childAges.join(",") && (a.childAges.length || b.childAges.length)) {
      chg(`${pre}Età bambini`, a.childAges.join(", "), b.childAges.join(", "));
    }
    // Prezzo per notte: solo le notti presenti in entrambe (le notti aggiunte/tolte sono già spiegate da Arrivo/Partenza/Notti).
    const before = new Map(a.nightly.map((n) => [n.date, n.amount]));
    for (const n of b.nightly) {
      const old = before.get(n.date);
      if (old !== undefined && Math.round(old * 100) !== Math.round(n.amount * 100)) priceLines.push(`${pre}Prezzo ${dmy(n.date)}: ${money(old, prev.currency)} → ${money(n.amount, cur)}`);
    }
  }
  out.push(...priceLines.slice(0, MAX_PRICE_LINES));
  if (priceLines.length > MAX_PRICE_LINES) out.push(`… e altre ${priceLines.length - MAX_PRICE_LINES} notti con prezzo diverso`);

  // Spese, servizi e tasse
  const ca = chargeMap(prev.charges), cb = chargeMap(next.charges);
  for (const [k, c] of cb) {
    const o = ca.get(k);
    if (!o) out.push(`Spesa aggiunta: ${c.label}${c.amount !== null ? ` (${money(c.amount, cur)})` : ""}`);
    else if ((o.amount ?? null) !== (c.amount ?? null)) out.push(`Spesa «${c.label}»: ${money(o.amount, prev.currency)} → ${money(c.amount, cur)}`);
  }
  for (const [k, c] of ca) if (!cb.has(k)) out.push(`Spesa rimossa: ${c.label}${c.amount !== null ? ` (${money(c.amount, prev.currency)})` : ""}`);

  if (prev.policies.join("|") !== next.policies.join("|")) out.push("Politiche: modificate");
  return out;
}
