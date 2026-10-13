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
  const policy: Record<string, unknown> = {
    title: "Politica della struttura",
    currency: (c.currency || "EUR").toUpperCase().slice(0, 3),
    is_adults_only: (c.minAge ?? 0) >= 18,
    max_count_of_guests: Math.max(1, Math.round(c.maxGuests || 6)),
    checkin_time: pad(c.checkInFrom ?? "") ?? "15:00",
    checkout_time: pad(c.checkOutBy ?? "") ?? "10:30",
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
