// Dati della struttura da inviare a Channex (e quindi a Google Hotel): descrizione, servizi, politica della struttura, posizione.
// Moduli PURI (niente rete): costruiscono i corpi delle richieste e dicono cosa manca. Formati dalla documentazione Channex (Properties, Hotel Policy, Facilities).

export interface StructureContent {
  name: string;
  description?: string;
  type?: string;
  city?: string;
  address?: string;
  postalCode?: string;
  country?: string;          // "Italia" o codice ISO
  phone?: string;
  email?: string;
  lat?: number;
  lng?: number;
  services?: string[];
  checkInFrom?: string;      // "15:00"
  checkInTo?: string;        // "20:00"
  checkOutBy?: string;       // "10:30"
  smoking?: boolean;
  pets?: boolean;
  minAge?: number;
  cancelPolicy?: "flessibile" | "moderata" | "rigida";
  maxGuests?: number;        // ospiti massimi di una singola camera/prenotazione
  currency?: string;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const pad = (t: string) => { const m = t.match(HHMM); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null; };

/** ISO 3166-1 alpha-2 dal nome del paese (solo i casi che servono; default Italia). */
export function countryCode(c?: string): string {
  const s = (c ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  if (/ital/i.test(s) || !s) return "IT";
  const map: Record<string, string> = { francia: "FR", spagna: "ES", germania: "DE", grecia: "GR", malta: "MT", portogallo: "PT", svizzera: "CH", austria: "AT" };
  return map[s.toLowerCase()] ?? "IT";
}

export interface ContentCheck { key: string; label: string; ok: boolean; hint?: string }

/** Cosa c'è e cosa manca in Xenora per soddisfare i requisiti di Google (mostrato come elenco spuntato). */
export function contentChecklist(c: StructureContent): ContentCheck[] {
  const desc = (c.description ?? "").trim();
  return [
    { key: "description", label: "Descrizione", ok: desc.length >= 40, hint: "Scrivila in Strutture (almeno 40 caratteri)." },
    { key: "address", label: "Indirizzo, città e telefono", ok: !!(c.address?.trim() && c.city?.trim() && c.phone?.trim()), hint: "Devono coincidere con la scheda Google Maps." },
    { key: "location", label: "Posizione sulla mappa", ok: typeof c.lat === "number" && typeof c.lng === "number" && !(c.lat === 0 && c.lng === 0), hint: "Latitudine e longitudine, in Strutture." },
    { key: "services", label: "Servizi", ok: (c.services?.length ?? 0) > 0, hint: "Spunta i servizi in Strutture." },
    { key: "times", label: "Orari di check-in e check-out", ok: !!(c.checkInFrom && c.checkOutBy), hint: "In Strutture → Check-in / check-out." },
    { key: "cancel", label: "Politica di cancellazione", ok: !!c.cancelPolicy, hint: "In Strutture → Policy." },
  ];
}

/** Descrizione da inviare: quella della struttura, altrimenti una frase semplice con i soli dati certi. */
export function buildDescription(c: StructureContent): string {
  const d = (c.description ?? "").trim();
  if (d) return d.slice(0, 4000);
  const where = c.city ? ` a ${c.city}` : "";
  return `${c.name}${where}: ${c.type || "struttura ricettiva"}. Prenota direttamente per il miglior prezzo.`.slice(0, 4000);
}

const has = (services: string[] | undefined, re: RegExp) => (services ?? []).some((s) => re.test(s));

/** Corpo della richiesta "hotel_policy" di Channex (POST /hotel_policies o PUT /hotel_policies/:id). */
export function buildHotelPolicyBody(propertyId: string | null, c: StructureContent): { hotel_policy: Record<string, unknown> } {
  const wifi = has(c.services, /wi-?fi|internet/i);
  const parking = has(c.services, /parcheggio|parking/i);
  const checkInFrom = pad(c.checkInFrom ?? "") ?? "15:00";
  const checkInTo = pad(c.checkInTo ?? "") ?? (checkInFrom < "20:00" ? "20:00" : "23:59");
  const checkOutTo = pad(c.checkOutBy ?? "") ?? "10:30";
  const checkOutFrom = checkOutTo > "07:00" ? "07:00" : "00:00";
  const policy: Record<string, unknown> = {
    title: "Politica della struttura",
    currency: (c.currency || "EUR").toUpperCase().slice(0, 3),
    is_adults_only: (c.minAge ?? 0) >= 18,
    max_count_of_guests: Math.max(1, Math.round(c.maxGuests || 6)),
    // Channex (API reale) vuole quattro orari: da/a per il check-in e per il check-out. La documentazione parla di checkin_time/checkout_time: si inviano anche quelli.
    checkin_from_time: checkInFrom,
    checkin_to_time: checkInTo,
    checkout_from_time: checkOutFrom,
    checkout_to_time: checkOutTo,
    checkin_time: checkInFrom,
    checkout_time: checkOutTo,
    internet_access_type: wifi ? "wifi" : "none",
    internet_access_coverage: "entire_property",
    internet_access_cost: null, // gratuito
    parking_type: parking ? "on_site" : "none",
    parking_reservation: "not_needed",
    parking_is_private: true,
    pets_policy: c.pets ? "allowed" : "not_allowed",
    pets_non_refundable_fee: "0.00",
    pets_refundable_deposit: "0.00",
    smoking_policy: c.smoking ? "permitted_areas_only" : "no_smoking",
  };
  if (propertyId) policy.property_id = propertyId;
  return { hotel_policy: policy };
}

// Servizio di Xenora → parole che compaiono nel nome della facility di Channex (inglese).
const FACILITY_RULES: { service: RegExp; facility: RegExp[] }[] = [
  { service: /wi-?fi|internet/i, facility: [/free wi-?fi/i, /wi-?fi/i, /wireless internet/i] },
  { service: /aria condizionata|climatizz/i, facility: [/air conditioning/i] },
  { service: /riscaldamento/i, facility: [/heating/i] },
  { service: /parcheggio/i, facility: [/free parking/i, /parking/i] },
  { service: /colazione/i, facility: [/breakfast/i] },
  { service: /cucina/i, facility: [/kitchen/i] },
  { service: /lavatrice/i, facility: [/washing machine/i, /laundry/i] },
  { service: /lavastoviglie/i, facility: [/dishwasher/i] },
  { service: /^tv$|televis/i, facility: [/flat-?screen tv/i, /television/i, /\btv\b/i] },
  { service: /balcone/i, facility: [/balcony/i] },
  { service: /terrazza/i, facility: [/terrace/i] },
  { service: /vista mare|sea view/i, facility: [/sea view/i] },
  { service: /ascensore/i, facility: [/elevator/i, /\blift\b/i] },
  { service: /animali/i, facility: [/pets allowed/i, /pet/i] },
  { service: /culla/i, facility: [/cot/i, /crib/i] },
  { service: /asciugacapelli/i, facility: [/hairdryer/i, /hair dryer/i] },
  { service: /cassaforte/i, facility: [/safe/i] },
  { service: /deposito bagagli/i, facility: [/luggage storage/i, /baggage storage/i] },
  { service: /reception 24/i, facility: [/24-?hour front desk/i, /front desk/i] },
];

/** Abbina i servizi di Xenora alle facility di Channex. `unmatched` = servizi senza corrispondenza (non bloccano nulla). */
export function matchFacilities(services: string[] | undefined, options: { id: string; title: string }[]): { ids: string[]; matched: string[]; unmatched: string[] } {
  const ids: string[] = [], matched: string[] = [], unmatched: string[] = [];
  for (const s of services ?? []) {
    const rule = FACILITY_RULES.find((r) => r.service.test(s));
    let found: { id: string; title: string } | undefined;
    if (rule) for (const re of rule.facility) { found = options.find((o) => re.test(o.title)); if (found) break; }
    if (found && !ids.includes(found.id)) { ids.push(found.id); matched.push(`${s} → ${found.title}`); }
    else if (!found) unmatched.push(s);
  }
  return { ids, matched, unmatched };
}

/** Corpo del PUT /properties/:id con i soli campi che abbiamo (quelli assenti restano com'erano su Channex). */
export function buildPropertyUpdate(c: StructureContent, x: { hotelPolicyId?: string; cancellationPolicyId?: string; facilityIds?: string[] }): { property: Record<string, unknown> } {
  const p: Record<string, unknown> = { timezone: "Europe/Rome" };
  const set = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== "") p[k] = v; };
  set("address", c.address?.trim());
  set("city", c.city?.trim());
  set("zip_code", c.postalCode?.trim());
  set("country", countryCode(c.country));
  set("phone", c.phone?.trim().slice(0, 32));
  if (c.email && /^\S+@\S+\.\S+$/.test(c.email.trim())) p.email = c.email.trim();
  if (typeof c.lat === "number" && typeof c.lng === "number" && !(c.lat === 0 && c.lng === 0)) { p.latitude = c.lat.toFixed(7); p.longitude = c.lng.toFixed(7); }
  set("hotel_policy_id", x.hotelPolicyId);
  set("default_cancellation_policy_id", x.cancellationPolicyId);
  if (x.facilityIds?.length) p.facilities = x.facilityIds;
  p.content = { description: buildDescription(c) };
  return { property: p };
}

// ── Politica di cancellazione ──────────────────────────────────────────────────────────────────────────────────
// Channex non documenta questa risorsa: i nomi dei campi derivano dall'oggetto che restituisce nelle API di lettura (cancellation_policy_*). Se la creazione viene rifiutata
// con un errore di validazione che elenca campi mancanti, si completano con valori di ripiego e si riprova (vedi completeCancellationBody).
export type CancelKind = "flessibile" | "moderata" | "rigida";
export const CANCEL_TITLES: Record<CancelKind, string> = { flessibile: "Flessibile", moderata: "Moderata", rigida: "Rigida (non rimborsabile)" };

/** Parametri della politica: ore di preavviso per la cancellazione gratuita e penale (in notti) dopo quel termine. Rigida = nessun rimborso: preavviso 0 e penale di tutto il soggiorno. */
export function cancelParams(kind: CancelKind): { deadlineHours: number; penaltyNights: number; nonRefundable: boolean } {
  if (kind === "moderata") return { deadlineHours: 120, penaltyNights: 1, nonRefundable: false };
  if (kind === "rigida") return { deadlineHours: 0, penaltyNights: 1, nonRefundable: true };
  return { deadlineHours: 24, penaltyNights: 1, nonRefundable: false };
}

/** Primo tentativo di corpo per la creazione (campi con e senza prefisso: Channex ignora quelli che non conosce). */
export function buildCancellationPolicyBody(propertyId: string, kind: CancelKind, currency = "EUR"): { cancellation_policy: Record<string, unknown> } {
  const p = cancelParams(kind);
  return {
    cancellation_policy: {
      property_id: propertyId, title: CANCEL_TITLES[kind], currency: currency.toUpperCase().slice(0, 3),
      cancellation_policy_logic: p.nonRefundable ? "non_refundable" : "deadline",
      cancellation_policy_mode: "nights", cancellation_policy_penalty: String(p.penaltyNights),
      cancellation_policy_deadline: p.deadlineHours, cancellation_policy_deadline_type: "hours",
    },
  };
}

// Valori di ripiego per i campi che Channex dovesse chiedere (nome → valore). Usati solo dopo un errore di validazione "can't be blank".
const FALLBACKS: Record<string, (kind: CancelKind) => unknown> = {
  title: (k) => CANCEL_TITLES[k], currency: () => "EUR",
  logic: (k) => (cancelParams(k).nonRefundable ? "non_refundable" : "deadline"), mode: () => "nights", penalty: (k) => String(cancelParams(k).penaltyNights),
  deadline: (k) => cancelParams(k).deadlineHours, deadline_type: () => "hours",
  guarantee_payment_policy: () => "none", guarantee_payment_amount: () => "0.00", non_show_policy: () => "none",
};
/** Aggiunge al corpo i campi che l'errore di validazione dice mancanti. Ritorna null se non c'è nulla da aggiungere (inutile riprovare). */
export function completeCancellationBody(body: { cancellation_policy: Record<string, unknown> }, details: unknown, kind: CancelKind): { cancellation_policy: Record<string, unknown> } | null {
  if (!details || typeof details !== "object") return null;
  const next = { ...body.cancellation_policy };
  let added = false;
  for (const key of Object.keys(details as Record<string, unknown>)) {
    if (key in next) continue;
    const bare = key.replace(/^cancellation_policy_/, "");
    const f = FALLBACKS[key] ?? FALLBACKS[bare];
    if (f) { next[key] = f(kind); added = true; }
  }
  return added ? { cancellation_policy: next } : null;
}
