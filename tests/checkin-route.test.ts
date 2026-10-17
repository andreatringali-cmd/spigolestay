import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Route /api/checkin (GET e POST) con un database finto: consenso e firma, prenotazione non attiva, dati che non si perdono al reinvio,
// check-in di gruppo che non tocca l'anagrafica del prenotante, email al titolare senza dati sensibili.
register("./helpers/checkin-route-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as Storage;
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; internal?: boolean; rateLimited?: boolean; operator?: boolean; operatorId?: string } };
G.__stubs = { calls: {} };
const route = await import("../src/app/api/checkin/route.ts");
const M = await import("../src/lib/media.ts");
const { todayRome, addDaysYmd } = await import("../src/lib/dates-rome.ts");

const OWNER = "11111111-1111-4111-8111-111111111111";
const DATA_KEY = "spigolestay:data:v1";
const ref = (n: number) => M.mediaRef(M.PRIVATE_BUCKET, M.scopedPath("u", OWNER, "png", `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`));
const SIGN = ref(1);
const today = todayRome();
const ci = addDaysYmd(today, 1), co = addDaysYmd(today, 4);

function scenario(bookings: Record<string, unknown>[], structure: Record<string, unknown> = {}, guest: Record<string, unknown> = {}) {
  const data = {
    structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", currency: "€", accessInfo: "Codice portone 1313", stripeAccount: "acct_123", cityTax: true, cityTaxMode: "percent", cityTaxPercent: 4, cityTaxCap: 5, cityTaxMaxNights: 7, cityTaxChildFreeUnder: 14, ...structure }],
    roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia" }],
    units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1", name: "Allegra", accessInfo: "Keybox 2323" }, { id: "u2", roomTypeId: "rt-dbl", structureId: "st-1", name: "Ortigia" }],
    guests: [{ id: "g1", firstName: "Giulia", lastName: "Rossi", fullName: "Giulia Rossi", email: "giulia@example.com", docNumber: "RS111", docPlace: "Roma", ...guest }],
    bookings: bookings.map((b) => ({ id: "b-1", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: ci, checkOut: co, adults: 2, children: 0, total: 300, signature: SIGN, ...b })),
  };
  const { db, client } = makeFakeDb({
    public_sites: [{ slug: "casa-ortigia", user_id: OWNER, structure_id: "st-1" }],
    app_state: [{ user_id: OWNER, rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }],
    memberships: [], org_state: [],
  });
  Object.assign(G.__stubs, { calls: {}, admin: client, internal: false, rateLimited: false, operator: false, operatorId: OWNER });
  return { state: () => JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]), db };
}
const person = (o: Record<string, unknown> = {}) => ({ firstName: "Mario", lastName: "Verdi", sex: "M", birthDate: "1980-01-01", birthPlace: "Roma", citizenship: "Italia", docType: "Passaporto", docNumber: "YA123", docPlace: "Roma", ...o });
async function post(body: Record<string, unknown>, opts: { operator?: boolean } = {}) {
  G.__stubs.operator = !!opts.operator;
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" };
  if (opts.operator) headers.authorization = "Bearer x";
  const req = new Request("https://xenora.test/api/checkin", { method: "POST", headers, body: JSON.stringify({ slug: "casa-ortigia", b: "b-1", consent: true, doc: person(), signature: SIGN, ...body }) });
  const res = (await route.POST(req)) as unknown as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
}
async function get(b = "b-1", opts: { operator?: boolean } = {}) {
  G.__stubs.operator = !!opts.operator;
  const headers: Record<string, string> = { "x-forwarded-for": "9.9.9.9" };
  if (opts.operator) headers.authorization = "Bearer x";
  const res = (await route.GET(new Request(`https://xenora.test/api/checkin?slug=casa-ortigia&b=${b}`, { headers }))) as unknown as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
}

test("POST senza consenso → 400; ospite anonimo senza firma → 400; l'operatore non deve firmare ma il consenso serve", async () => {
  scenario([{}]);
  assert.deepEqual((await post({ consent: false })).json.error, "consent_required");
  const noSign = await post({ signature: undefined });
  assert.equal(noSign.status, 400); assert.equal(noSign.json.error, "signature_required");
  const op = await post({ signature: undefined }, { operator: true });
  assert.equal(op.status, 200);
  assert.equal((await post({ consent: undefined }, { operator: true })).status, 400);
});

test("sesso e data di nascita non validi: data inesistente/futura → 400; sesso diverso da M/F scartato", async () => {
  const sc = scenario([{}]);
  assert.equal((await post({ doc: person({ birthDate: "2999-01-01" }) })).json.error, "invalid_birth_date");
  assert.equal((await post({ doc: person({ birthDate: "31/12/1990" }) })).json.error, "invalid_birth_date");
  assert.equal((await post({ extraGuests: [person({ firstName: "Anna", birthDate: "1990-02-30" })] })).json.error, "invalid_birth_date");
  const ok = await post({ doc: person({ sex: "X" }) });
  assert.equal(ok.status, 200);
  assert.equal(sc.state().bookings[0].primaryGuest.sex, undefined);
});

test("POST salva consenso (quando e da chi), primaryGuest e webCheckin; email al titolare senza documento né nascita", async () => {
  const sc = scenario([{}]);
  const r = await post({ arrival: "16:00-18:00", guestRequests: "culla" });
  assert.equal(r.status, 200);
  const b = sc.state().bookings[0];
  assert.equal(b.webCheckin, true); assert.equal(b.arrivalTime, "16:00-18:00"); assert.equal(b.guestRequests, "culla");
  assert.equal(b.primaryGuest.docNumber, "YA123");
  assert.match(b.privacyConsentAt, /^\d{4}-\d{2}-\d{2}T/); assert.equal(b.privacyConsentBy, "guest");
  const mail = G.__stubs.calls.internalFetch?.[0]?.body;
  assert.ok(mail, "email al titolare inviata");
  const raw = JSON.stringify(mail.guests);
  assert.ok(!/YA123|1980-01-01|docNumber|birthDate/.test(raw), raw);
  assert.equal(mail.guests[0].lastName, "Verdi");
  assert.equal(mail.booking.bookingId, b.id, "l'email al titolare porta l'id per il link alla scheda /prenotazioni?b=");
});

test("prenotazione annullata/no-show → 409; soggiorno concluso → 409 all'ospite ma non all'operatore", async () => {
  scenario([{ status: "cancelled" }]);
  const a = await post({}); assert.equal(a.status, 409); assert.equal(a.json.error, "booking_inactive");
  scenario([{ status: "no_show" }]);
  assert.equal((await post({}, { operator: true })).status, 409);
  scenario([{ checkIn: addDaysYmd(today, -5), checkOut: addDaysYmd(today, -2) }]);
  assert.equal((await post({})).status, 409);
  assert.equal((await post({}, { operator: true })).status, 200);
});

test("riapertura del link: orario, richieste, dati fattura e ospiti già salvati non si cancellano con valori vuoti", async () => {
  const sc = scenario([{
    webCheckin: true, arrivalTime: "16:00-18:00", guestRequests: "allergia ai latticini",
    invoiceRequest: { wants: true, kind: "societa", name: "ACME SRL", vat: "IT123" },
    primaryGuest: person({ docNumber: "OLD1", docPlace: "Siracusa" }),
    extraGuests: [person({ firstName: "Luigi", lastName: "Bianchi", docNumber: "L1", docPhotoFront: ref(7) })],
  }]);
  const r = await post({
    arrival: "Non lo so", guestRequests: "", invoiceRequest: { wants: false },
    doc: person({ docNumber: "OLD1", docPlace: "" }),
    extraGuests: [person({ firstName: "Luiggi", lastName: "Bianchi", docNumber: "", docPlace: "" })], // refuso nel nome, documento non riscritto
  });
  assert.equal(r.status, 200);
  const b = sc.state().bookings[0];
  assert.equal(b.arrivalTime, "16:00-18:00");
  assert.equal(b.guestRequests, "allergia ai latticini");
  assert.equal(b.invoiceRequest.wants, true); assert.equal(b.invoiceRequest.vat, "IT123");
  assert.equal(b.primaryGuest.docPlace, "Siracusa"); // campo vuoto: resta il vecchio
  assert.equal(b.extraGuests.length, 1);
  assert.equal(b.extraGuests[0].firstName, "Luiggi"); assert.equal(b.extraGuests[0].docNumber, "L1");
  assert.equal(b.extraGuests[0].docPhotoFront, ref(7)); // foto non cancellata per un refuso
});

test("l'operatore (che ha il modulo precompilato) sostituisce i dati: può togliere un ospite", async () => {
  const sc = scenario([{ webCheckin: true, extraGuests: [person({ firstName: "Luigi", lastName: "Bianchi" })] }]);
  const r = await post({ extraGuests: [] }, { operator: true });
  assert.equal(r.status, 200);
  assert.equal(sc.state().bookings[0].extraGuests.length, 0);
  assert.equal(sc.state().bookings[0].privacyConsentBy, "operator");
});

test("età dei minori dalle date di nascita: aggiornano childAges (esenzione tassa)", async () => {
  const sc = scenario([{ adults: 2, children: 1, childAges: [] }]);
  const r = await post({
    doc: person({ birthDate: "1985-01-01" }),
    extraGuests: [person({ firstName: "Anna", sex: "F", birthDate: "1987-01-01" }), person({ firstName: "Pio", birthDate: addDaysYmd(today, -365 * 9) })],
  });
  assert.equal(r.status, 200);
  const ages = sc.state().bookings[0].childAges;
  assert.equal(ages.length, 1); assert.ok(ages[0] >= 8 && ages[0] <= 10, String(ages));
});

test("check-in di GRUPPO: ogni camera scrive solo il proprio primaryGuest, l'anagrafica del prenotante resta intatta", async () => {
  const sc = scenario([
    { id: "b-1", groupId: "G", unitId: "u1" },
    { id: "b-2", groupId: "G", unitId: "u2", signature: SIGN },
  ]);
  // camera 2: capocamera diverso dal prenotante (un'altra persona), con la sua foto documento già presente
  const r = await post({ b: "b-2", doc: person({ firstName: "Ugo", lastName: "Neri", docNumber: "UN9" }) });
  assert.equal(r.status, 200);
  const st = sc.state();
  const g = st.guests[0];
  assert.equal(g.firstName, "Giulia"); assert.equal(g.lastName, "Rossi"); assert.equal(g.docNumber, "RS111"); // intatta
  assert.equal(st.bookings[1].primaryGuest.lastName, "Neri"); assert.equal(st.bookings[1].primaryGuest.docNumber, "UN9");
  assert.equal(st.bookings[0].primaryGuest, undefined); // l'altra camera non è toccata
});

test("prenotazione singola: l'anagrafica ospite si aggiorna ancora, senza perdere campi già presenti", async () => {
  const sc = scenario([{}]);
  const r = await post({ doc: person({ docPlace: "" }) });
  assert.equal(r.status, 200);
  const g = sc.state().guests[0];
  assert.equal(g.lastName, "Verdi"); assert.equal(g.docNumber, "YA123");
  assert.equal(g.docPlace, "Roma"); // la scheda aveva già "Roma": il campo vuoto non la cancella
});

test("GET: istruzioni di accesso solo per prenotazioni confermate non concluse; Stripe solo se può incassare", async () => {
  scenario([{}], { stripeChargesEnabled: false });
  let j = (await get()).json;
  assert.equal(j.ok, true);
  assert.equal(j.structure.accessInfo, "Codice portone 1313"); assert.equal(j.unit.accessInfo, "Keybox 2323");
  assert.equal(j.structure.stripeAccount, ""); // non può incassare: non si espone
  scenario([{}], { stripeChargesEnabled: true });
  j = (await get()).json;
  assert.equal(j.structure.stripeAccount, "acct_123");
  scenario([{ status: "tentative" }]);
  j = (await get()).json;
  assert.equal(j.structure.accessInfo, ""); assert.equal(j.unit.accessInfo, "");
});

test("GET: annullata → {inactive:true}; conclusa → inactive per l'ospite, aperta per l'operatore", async () => {
  scenario([{ status: "cancelled" }]);
  let j = (await get()).json;
  assert.equal(j.inactive, true); assert.equal(j.ok, false); assert.equal(j.booking, undefined);
  assert.equal(j.structure.name, "Casa Ortigia");
  scenario([{ checkIn: addDaysYmd(today, -5), checkOut: addDaysYmd(today, -2) }]);
  assert.equal((await get()).json.inactive, true);
  assert.equal((await get("b-1", { operator: true })).json.ok, true);
});

test("GET gruppo: l'ospite della camera viene dal suo primaryGuest, non dall'anagrafica del prenotante; niente foto condivise", async () => {
  scenario(
    [{ id: "b-1", groupId: "G" }, { id: "b-2", groupId: "G", primaryGuest: person({ firstName: "Ugo", lastName: "Neri", docNumber: "UN9" }) }],
    {}, { docPhotoFront: ref(9) },
  );
  const j = (await get("b-2", { operator: true })).json;
  assert.equal(j.guest.lastName, "Neri"); assert.equal(j.guest.docNumber, "UN9");
  assert.equal(j.guest.docPhotoFront, null); // la foto sull'anagrafica è del prenotante
  assert.equal(j.returning, false);
});

test("GET: restituisce structure.id (guida ospite) e operator riconosciuto dal SERVER, anche per prenotazione non attiva", async () => {
  scenario([{}]);
  const anon = await get("b-1");
  assert.equal(anon.json.structure.id, "st-1");
  assert.equal(anon.json.operator, false);
  const op = await get("b-1", { operator: true });
  assert.equal(op.json.operator, true);
  scenario([{ status: "cancelled" }]);
  const inactive = await get("b-1");
  assert.equal(inactive.json.inactive, true);
  assert.equal(inactive.json.structure.id, "st-1");
});
