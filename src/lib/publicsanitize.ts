// Pulizia dei dati destinati allo snapshot PUBBLICO (public_sites).
// Funzioni pure, senza dipendenze: testabili con node --test.
// Lo snapshot è leggibile da chiunque (la tabella public_sites è pubblica): qui si
// restano SOLO i campi dichiarati pubblici (LISTA BIANCA): un campo nuovo aggiunto in futuro alla struttura o alla camera non finisce mai
// nello snapshot per distrazione; se una pagina pubblica ne ha bisogno lo si aggiunge qui di proposito.

type Rec = Record<string, unknown>;

// Campi struttura da NON pubblicare (resta come rete di sicurezza e per i test: la lista bianca sotto è la regola vera): dati fiscali/bancari, credenziali e codici d'accesso,
// identificativi di integrazioni (Stripe, Google Calendar, Alloggiati) e dati di fatturazione.
// Nessuna pagina pubblica (/[slug], /prenota, /embed, widget, feed metasearch, XenoraBook, AI)
// li legge: i pagamenti passano da /api/stripe/book, che legge lo stripeAccount dal server.
export const STRUCT_PRIVATE = [
  "vat", "taxCode", "iban", "ibanHolder",
  "accessInfo",
  "stripeAccount", "stripeChargesEnabled",
  "alloggiatiUser", "istat",
  "gcalId", "gcalVerifiedId",
  "sdi", "pec", "businessName",
];

// Campi camera fisica da NON pubblicare (codici serratura, note interne, motivi di fuori servizio, regole di servizio/pulizia).
export const UNIT_PRIVATE = ["accessInfo", "notes", "oosReason"];

// LISTA BIANCA struttura: tutto ciò che le pagine pubbliche (/[slug], /prenota, /embed, widget, feed metasearch, XenoraBook, schede AI, Google Ads) leggono.
// Fuori: dati fiscali e bancari, credenziali, codici d'accesso, integrazioni (Stripe, Google Calendar, Alloggiati), referente interno, id dell'organizzazione.
export const STRUCT_PUBLIC = [
  "id", "updatedAt", "name", "groupName", "order", "active", "type", "description", "photoColor", "logo",
  "city", "address", "streetNumber", "postalCode", "province", "region", "country", "zone", "lat", "lng",
  "phone", "phone2", "email", "whatsapp", "website", "facebook", "instagram", "linkedin", "tiktok", "privacyUrl",
  "googlePlaceId", "googleAdsId", "googleAdsLabel",
  "cin", "cir", "services",
  "checkInFrom", "checkInTo", "checkOutBy", "selfCheckin",
  "cityTax", "cityTaxMode", "cityTaxAmount", "cityTaxPercent", "cityTaxCap", "cityTaxMaxNights", "cityTaxChildFreeUnder", "cityTaxComune",
  "cancelPolicy", "smoking", "pets", "minAge", "quietFrom", "quietTo",
  "payMethods", "currency", "language",
  "extras", "depositPct", "crossSuggestEnabled", "networkOptIn",
];

// LISTA BIANCA camera fisica: identità, posizione e dotazioni (nessun codice, nota interna o regola di servizio).
export const UNIT_PUBLIC = [
  "id", "updatedAt", "structureId", "roomTypeId", "name", "order", "outOfService",
  "code", "floor", "view", "photos", "amenities", "bedConfig", "size",
];

function strip(o: Rec, keys: string[]): Rec {
  const c = { ...o };
  for (const k of keys) delete c[k];
  return c;
}
function pick(o: Rec, keys: string[]): Rec {
  const c: Rec = {};
  for (const k of keys) if (k in o && o[k] !== undefined) c[k] = o[k];
  return c;
}

// Prima la lista bianca, poi (doppia cintura) la lista nera: se un campo privato finisse per errore tra i pubblici, viene comunque tolto.
export const cleanStructure = (s: Rec): Rec => strip(pick(s, STRUCT_PUBLIC), STRUCT_PRIVATE);
export const cleanUnit = (u: Rec): Rec => strip(pick(u, UNIT_PUBLIC), UNIT_PRIVATE);

// Prenotazioni: SOLO ciò che serve per l'occupazione. L'id reale non viene pubblicato
// (sostituito da un indice non riutilizzabile: nessuna pagina pubblica cerca per id).
export function cleanBookings(list: Rec[]): Rec[] {
  return list.map((b, i) => ({
    id: `occ${i}`,
    structureId: b.structureId,
    roomTypeId: b.roomTypeId,
    unitId: b.unitId ?? null,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    status: b.status,
    channel: b.channel,
  }));
}
