// Pulizia dei dati destinati allo snapshot PUBBLICO (public_sites).
// Funzioni pure, senza dipendenze: testabili con node --test.
// Lo snapshot è leggibile da chiunque (la tabella public_sites è pubblica): qui si
// tolgono tutti i campi che non servono a nessuna pagina pubblica e che sono privati.

type Rec = Record<string, unknown>;

// Campi struttura da NON pubblicare: dati fiscali/bancari, credenziali e codici d'accesso,
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

// Campi camera fisica da NON pubblicare (codici serratura, note interne, motivi di fuori servizio).
export const UNIT_PRIVATE = ["accessInfo", "notes", "oosReason"];

function strip(o: Rec, keys: string[]): Rec {
  const c = { ...o };
  for (const k of keys) delete c[k];
  return c;
}

export const cleanStructure = (s: Rec): Rec => strip(s, STRUCT_PRIVATE);
export const cleanUnit = (u: Rec): Rec => strip(u, UNIT_PRIVATE);

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
