import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb, type FakeDb } from "./helpers/fake-supabase.ts";

// channex-inbound.ts importa moduli che farebbero rete o richiedono Next.js: l'hook li sostituisce con finti che
// registrano le chiamate in globalThis.__stubs. La chiave Channex va impostata PRIMA di caricare il modulo (si legge all'import).
register("./helpers/stubs-loader.mjs", import.meta.url);
process.env.CHANNEX_API_KEY = "chiave-di-prova";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown } };
G.__stubs = { calls: {} };
const { channelFromOta, importSingleRevision, importBookings } = await import("../src/lib/channex-inbound.ts");

const DATA_KEY = "spigolestay:data:v1";
const calls = (k: string) => G.__stubs.calls[k] ?? [];

// ── fetch finto: nessuna chiamata di rete vera ──
type FeedCfg = { revisions?: any[]; properties?: any[] };
async function withChannex<T>(cfg: FeedCfg, fn: (acks: string[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const acks: string[] = [];
  globalThis.fetch = (async (url: string, init?: { method?: string }) => {
    const u = String(url);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const ack = u.match(/booking_revisions\/([^/]+)\/ack$/);
    if (ack && init?.method === "POST") { acks.push(decodeURIComponent(ack[1])); return json({}); }
    if (u.includes("/booking_revisions/feed")) return json({ data: (cfg.revisions ?? []).map((r) => ({ id: r.id, attributes: r })) });
    if (u.endsWith("/properties")) return json({ data: cfg.properties ?? [] });
    return json({}, 404);
  }) as typeof fetch;
  try { return await fn(acks); } finally { globalThis.fetch = original; }
}

// ── dati di prova ──
const MAP = { channex_property_id: "prop-1", tenant_id: "tenant-1", structure_id: "st-1", rooms: { "chx-dbl": "rt-dbl", "chx-fam": "rt-fam" }, org_id: null as string | null };
const baseData = (over: Record<string, unknown> = {}) => ({
  structures: [{ id: "st-1", name: "Casa Ortigia", email: "owner@example.com", gcalId: "cal-1" }],
  roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia", beds: 2, basePrice: 100 }, { id: "rt-fam", structureId: "st-1", name: "Familiare", beds: 4, basePrice: 150 }],
  units: [
    { id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }, { id: "u2", roomTypeId: "rt-dbl", structureId: "st-1" },
    { id: "u3", roomTypeId: "rt-fam", structureId: "st-1" },
  ],
  guests: [] as any[], bookings: [] as any[], ...over,
});
const seedBooking = (o: Record<string, unknown> = {}) => ({
  id: "old-1", groupId: "g-old", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", guestId: "g-1", channel: "booking", status: "confirmed",
  checkIn: "2099-06-10", checkOut: "2099-06-13", adults: 2, children: 0, total: 360, cleaningFee: 0, paid: 0, extId: "channex:bk-1", code: "4812345678",
  source: "channex", note: "Prenotazione BOOKING via Channex · 4812345678", updatedAt: 1000, ...o,
});
// Prenotazione di un altro ospite: codice OTA ed extId diversi, cosi' non viene scambiata per quella della revision.
const altra = (o: Record<string, unknown> = {}) => seedBooking({ id: "altra", groupId: "g-altra", extId: "site:1:1", code: "ALTRO-1", guestId: "g-2", ...o });
const rev = (o: Record<string, unknown> = {}) => ({
  id: "rev-1", property_id: "prop-1", booking_id: "bk-1", status: "new", ota_reservation_code: "4812345678", ota_name: "Booking.com",
  arrival_date: "2099-06-10", departure_date: "2099-06-13", amount: "360.00", currency: "EUR",
  customer: { name: "Giulia", surname: "Rossi", mail: "giulia.rossi@example.com", phone: "+393331112233", country: "IT" },
  rooms: [{ room_type_id: "chx-dbl", checkin_date: "2099-06-10", checkout_date: "2099-06-13", occupancy: { adults: 2, children: 0 },
    days: { "2099-06-10": "120.00", "2099-06-11": "120.00", "2099-06-12": "120.00" } }],
  ...o,
});
const room = (o: Record<string, unknown> = {}) => ({ room_type_id: "chx-dbl", checkin_date: "2099-06-10", checkout_date: "2099-06-13", occupancy: { adults: 2, children: 0 }, ...o });

function scenario(data: Record<string, unknown> = baseData(), opts: { map?: typeof MAP; extraMaps?: any[]; extraStates?: any[]; rev?: number; blobExtra?: Record<string, string> } = {}) {
  const map = opts.map ?? MAP;
  const { db, client } = makeFakeDb({
    channex_map: [map, ...(opts.extraMaps ?? [])],
    app_state: [{ user_id: map.tenant_id, rev: opts.rev ?? 1, data: { [DATA_KEY]: JSON.stringify(data), ...(opts.blobExtra ?? {}) } }, ...(opts.extraStates ?? [])],
    org_state: map.org_id ? [{ org_id: map.org_id, rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }] : [],
    channex_bookings: [],
  });
  G.__stubs.calls = {};
  const stateOf = (table = "app_state", key = map.org_id ? map.org_id : map.tenant_id) => {
    const row = db.tables[table].find((r) => (r.user_id ?? r.org_id) === key) as any;
    return JSON.parse(row.data[DATA_KEY]);
  };
  return { db, client: client as never, state: () => stateOf(map.org_id ? "org_state" : "app_state"), stateOf, map };
}
const live = (s: any) => s.bookings.filter((b: any) => b.status !== "cancelled");
const lapidi = (s: any): string[] => s._deleted?.bookings ?? [];

// ───────────────────────── channelFromOta ─────────────────────────
test("channelFromOta: riconosce i canali principali da come li scrive Channex", () => {
  for (const n of ["Booking.com", "BookingCom", "booking", "BOOKING.COM"]) assert.equal(channelFromOta(n), "booking", n);
  for (const n of ["Airbnb", "AirBnB", "airbnb.com"]) assert.equal(channelFromOta(n), "airbnb", n);
  for (const n of ["Expedia", "VRBO", "HomeAway", "Expedia Affiliate Network"]) assert.equal(channelFromOta(n), "expedia", n);
  for (const n of ["Hotelbeds", "Hotel Beds", "HBEDS"]) assert.equal(channelFromOta(n), "hotelbeds", n);
});

test("channelFromOta: assente o vuoto = diretta; diretta/CRS/sito = diretta; altri portali = other", () => {
  assert.equal(channelFromOta(undefined), "direct");
  assert.equal(channelFromOta(""), "direct");
  assert.equal(channelFromOta("Direct"), "direct");
  assert.equal(channelFromOta("CRS"), "direct");
  assert.equal(channelFromOta("Website"), "direct");
  for (const n of ["Agoda", "Hostelworld", "Ctrip", "Trip.com"]) assert.equal(channelFromOta(n), "other", n);
});

test("channelFromOta: un nome come 'Direct Booking' dovrebbe essere diretta, non Booking.com", { todo: "BUG probabile: il controllo 'book' viene prima di 'direct'/'website' (channex-inbound.ts riga 59 vs 63)" }, () => {
  assert.equal(channelFromOta("Direct Booking"), "direct");
  assert.equal(channelFromOta("Website booking engine"), "direct");
});

// ───────────────────────── nuova prenotazione ─────────────────────────
test("nuova prenotazione: riga completa, ospite creato, ACK, registro, email, calendario e disponibilità", async () => {
  const sc = scenario();
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev() as never);
    assert.deepEqual({ ok: out.ok, imported: out.imported, acked: out.acked, skipped: out.skipped, errors: out.errors }, { ok: true, imported: 1, acked: 1, skipped: 0, errors: [] });
    assert.deepEqual(acks, ["rev-1"]);
  });
  const s = sc.state();
  assert.equal(s.bookings.length, 1);
  const b = s.bookings[0];
  assert.equal(b.channel, "booking");
  assert.equal(b.status, "confirmed");
  assert.equal(b.extId, "channex:bk-1");
  assert.equal(b.code, "4812345678");
  assert.equal(b.source, "channex");
  assert.equal(b.unitId, "u1");
  assert.equal(b.roomTypeId, "rt-dbl");
  assert.equal(b.total, 360);
  assert.equal(b.adults, 2);
  assert.equal(b.paid, 0);
  assert.deepEqual(b.nightlyRates, { "2099-06-10": 120, "2099-06-11": 120, "2099-06-12": 120 });
  assert.equal(b.note, "Prenotazione BOOKING via Channex · 4812345678");
  const g = s.guests.find((x: any) => x.id === b.guestId);
  assert.equal(g.fullName, "Giulia Rossi");
  assert.equal(g.email, "giulia.rossi@example.com");
  assert.equal(g.country, "IT");
  assert.equal(s.activities[0].type, "booking");
  assert.match(s.activities[0].text, /importata — Giulia Rossi · BOOKING \(Channex\)/);
  // audit + ultimo import
  assert.equal(sc.db.tables.channex_bookings.length, 1);
  assert.equal(sc.db.tables.channex_bookings[0].revision_id, "rev-1");
  assert.ok(sc.db.tables.channex_map[0].last_import_at);
  // effetti collaterali
  assert.equal(calls("gcalUpsert")[0].calendarId, "cal-1");
  assert.equal(calls("gcalUpsert")[0].startDate, "2099-06-10");
  assert.equal(calls("gcalUpsert")[0].endDateExclusive, "2099-06-13");
  assert.equal(calls("internalFetch").length, 1);
  assert.equal(calls("internalFetch")[0].body.to, "owner@example.com");
  assert.equal(calls("internalFetch")[0].body.subject, "Nuova prenotazione OTA · Giulia Rossi");
  assert.deepEqual(calls("poolPush")[0].touched, [{ structureId: "st-1", roomTypeId: "rt-dbl" }]);
});

test("nuova prenotazione: ospite senza email né nome = 'Ospite OTA'; email già nota (maiuscole diverse) = ospite riusato", async () => {
  const sc = scenario();
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ customer: {} }) as never); });
  assert.equal(sc.state().guests[0].fullName, "Ospite OTA");

  const sc2 = scenario(baseData({ guests: [{ id: "g-esist", fullName: "Giulia Rossi", email: "Giulia.Rossi@Example.com" }] }));
  await withChannex({}, async () => { await importSingleRevision(sc2.client, rev({ id: "rev-9", booking_id: "bk-9" }) as never); });
  assert.equal(sc2.state().guests.length, 1);
  assert.equal(sc2.state().bookings[0].guestId, "g-esist");
});

test("nuova prenotazione: adulti mai sotto 1, date incoerenti (check-out <= check-in) scartate, nessun ACK", async () => {
  const sc = scenario();
  await withChannex({}, async (acks) => {
    await importSingleRevision(sc.client, rev({ rooms: [room({ occupancy: { adults: 0, children: 1 }, amount: "100" })] }) as never);
    assert.equal(sc.state().bookings[0].adults, 1);
    assert.equal(sc.state().bookings[0].children, 1);
    const sc2 = scenario();
    const out = await importSingleRevision(sc2.client, rev({ id: "rev-2", rooms: [room({ checkin_date: "2099-06-13", checkout_date: "2099-06-13" })] }) as never);
    assert.equal(sc2.state().bookings.length, 0);
    assert.equal(out.skipped, 1);
    assert.deepEqual(acks, ["rev-1"]); // solo la prima
  });
});

test("soggiorno già concluso: non importato ma scaricato dal feed (ACK); una cancellazione passata invece passa", async () => {
  const sc = scenario();
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev({ arrival_date: "2020-01-10", departure_date: "2020-01-13", rooms: [room({ checkin_date: "2020-01-10", checkout_date: "2020-01-13" })] }) as never);
    assert.equal(out.skipped, 1); assert.equal(out.imported, 0);
    assert.deepEqual(acks, ["rev-1"]);
    assert.equal(sc.state().bookings.length, 0);
  });
  const sc2 = scenario(baseData({ bookings: [seedBooking({ checkIn: "2020-01-10", checkOut: "2020-01-13" })] }));
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc2.client, rev({ status: "cancelled", arrival_date: "2020-01-10", departure_date: "2020-01-13" }) as never);
    assert.equal(out.cancelled, 1);
    assert.equal(sc2.state().bookings[0].status, "cancelled");
    assert.deepEqual(acks, ["rev-1"]);
  });
});

test("property non collegata: saltata senza ACK (resta nel feed); la property di test della certificazione invece si ACKa", async () => {
  const sc = scenario();
  await withChannex({ properties: [{ id: "prop-cert", attributes: { title: "Test Property - Xenora" } }] }, async (acks) => {
    const o1 = await importSingleRevision(sc.client, rev({ property_id: "prop-sconosciuta" }) as never);
    assert.equal(o1.skipped, 1); assert.equal(o1.acked, 0);
    const o2 = await importSingleRevision(sc.client, rev({ id: "rev-cert", property_id: "prop-cert" }) as never);
    assert.equal(o2.acked, 1);
    assert.deepEqual(acks, ["rev-cert"]);
    assert.equal(sc.state().bookings.length, 0);
  });
});

// ───────────────────────── modifica ─────────────────────────
test("modifica: la riga viene sostituita (id nuovo), la vecchia lapidata, e si riportano incassi e dati del gestore (CARRY)", async () => {
  const old = seedBooking({ paid: 120, cityTaxPaid: true, webCheckin: true, invoiceNo: "FT-2099/12", extras: [{ name: "Navetta", price: 30 }], color: "#ff0000", note: "Ospite VIP, arriva tardi", bookedOn: "2099-03-01", docPhotoFront: "doc.jpg" });
  const sc = scenario(baseData({ guests: [{ id: "g-1", fullName: "Giulia Rossi", email: "giulia.rossi@example.com" }], bookings: [old] }));
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev({ id: "rev-2", arrival_date: "2099-06-11", departure_date: "2099-06-14", amount: "420.00",
      rooms: [room({ checkin_date: "2099-06-11", checkout_date: "2099-06-14", days: { "2099-06-11": "140.00", "2099-06-12": "140.00", "2099-06-13": "140.00" } })] }) as never);
    assert.equal(out.imported, 1);
    assert.deepEqual(acks, ["rev-2"]);
  });
  const s = sc.state();
  assert.equal(live(s).length, 1);
  const b = s.bookings[0];
  assert.notEqual(b.id, "old-1");
  assert.deepEqual(lapidi(s), ["old-1"]);
  assert.equal(b.checkIn, "2099-06-11"); assert.equal(b.checkOut, "2099-06-14"); assert.equal(b.total, 420);
  assert.equal(b.paid, 120);
  assert.equal(b.cityTaxPaid, true);
  assert.equal(b.webCheckin, true);
  assert.equal(b.invoiceNo, "FT-2099/12");
  assert.deepEqual(b.extras, [{ name: "Navetta", price: 30 }]);
  assert.equal(b.color, "#ff0000");
  assert.equal(b.docPhotoFront, "doc.jpg");
  assert.equal(b.bookedOn, "2099-03-01");
  assert.equal(b.note, "Ospite VIP, arriva tardi"); // la nota del gestore non viene sovrascritta
  assert.equal(b.guestId, "g-1"); // ospite riusato per email
  assert.ok(b.updatedAt > 1000);
  assert.match(s.activities[0].text, /aggiornata/);
  // una modifica non rimanda l'email di "nuova prenotazione" ma toglie dal calendario la vecchia riga
  assert.equal(calls("internalFetch").length, 0);
  assert.deepEqual(calls("gcalDelete").map((c) => c.ev), ["evold-1"]);
});

test("modifica: commissione e costo d'incasso già noti (Octorate) NON si perdono se Channex non li manda", async () => {
  const old = seedBooking({ commissionAmount: 54, commissionPct: 15, paymentFee: 5.4 });
  const sc = scenario(baseData({ bookings: [old] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-2" }) as never); });
  const b = sc.state().bookings[0];
  assert.equal(b.commissionAmount, 54);
  assert.equal(b.commissionPct, 15);
  assert.equal(b.paymentFee, 5.4);
});

test("modifica: se Channex manda la commissione, vince su quella riportata (con i centesimi)", async () => {
  const old = seedBooking({ commissionAmount: 54, commissionPct: 15, paymentFee: 5.4 });
  const sc = scenario(baseData({ bookings: [old] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-2", ota_commission: "21.456", notes: "Payment charge is EUR 3.2" }) as never); });
  const b = sc.state().bookings[0];
  assert.equal(b.commissionAmount, 21.46);
  assert.equal(b.paymentFee, 3.2);
});

test("commissione: assente, zero o campo alternativo 'commission'", async () => {
  const run = async (extra: Record<string, unknown>) => {
    const sc = scenario();
    await withChannex({}, async () => { await importSingleRevision(sc.client, rev(extra) as never); });
    return sc.state().bookings[0];
  };
  assert.equal("commissionAmount" in (await run({})), false);
  assert.equal("commissionAmount" in (await run({ ota_commission: "0" })), false);
  assert.equal("commissionAmount" in (await run({ ota_commission: "abc" })), false);
  assert.equal((await run({ commission: 42 })).commissionAmount, 42);
  assert.equal((await run({ ota_commission: 18 })).commissionAmount, 18);
});

test("modifica: la camera già assegnata si tiene se è ancora libera, altrimenti la prima libera", async () => {
  // la prenotazione era su u2 (libera): resta su u2 anche se u1 è libera
  const a = scenario(baseData({ bookings: [seedBooking({ unitId: "u2" })] }));
  await withChannex({}, async () => { await importSingleRevision(a.client, rev({ id: "rev-2" }) as never); });
  assert.equal(a.state().bookings[0].unitId, "u2");

  // nelle nuove date u2 è occupata da un'altra prenotazione: si passa a u1
  const other = altra({ id: "x-1", unitId: "u2", checkIn: "2099-06-14", checkOut: "2099-06-16" });
  const b = scenario(baseData({ bookings: [seedBooking({ unitId: "u2" }), other] }));
  await withChannex({}, async () => {
    await importSingleRevision(b.client, rev({ id: "rev-2", arrival_date: "2099-06-13", departure_date: "2099-06-15", rooms: [room({ checkin_date: "2099-06-13", checkout_date: "2099-06-15", amount: "200" })] }) as never);
  });
  const nb = live(b.state()).find((x: any) => x.extId === "channex:bk-1");
  assert.equal(nb.unitId, "u1");
});

test("modifica ritrovata anche se la riga era salvata con l'id della revision invece del booking_id (niente doppione)", async () => {
  const sc = scenario(baseData({ bookings: [seedBooking({ extId: "channex:rev-2" })] })); // import precedente senza booking_id: chiave = id revision
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-2" }) as never); });
  const s = sc.state();
  assert.equal(s.bookings.length, 1);
  assert.equal(s.bookings[0].extId, "channex:bk-1"); // da ora la chiave stabile e' il booking_id
});

test("prenotazione importata prima da Octorate: riconosciuta dal codice OTA, sostituita (non raddoppiata) e dati riportati", async () => {
  const octo = seedBooking({ id: "oct-1", extId: "octorate:99", paid: 100, note: "Importato da Octorate", unitId: "u2", commissionAmount: 50 });
  const sc = scenario(baseData({ bookings: [octo, seedBooking({ id: "altra", extId: "octorate:100", code: "999", unitId: "u1" })] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev() as never); });
  const s = sc.state();
  assert.equal(s.bookings.length, 2); // l'altra prenotazione (codice diverso) e' intatta
  const nb = s.bookings.find((b: any) => b.extId === "channex:bk-1");
  assert.equal(nb.paid, 100);
  assert.equal(nb.commissionAmount, 50);
  assert.equal(nb.unitId, "u2");
  assert.equal(nb.note, "Importato da Octorate");
  assert.deepEqual(lapidi(s), ["oct-1"]);
});

test("il codice OTA uguale in un'altra struttura non fa scambiare le prenotazioni", async () => {
  const sc = scenario(baseData({ bookings: [seedBooking({ id: "altra-str", structureId: "st-2", extId: "octorate:1", unitId: null })] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev() as never); });
  assert.equal(sc.state().bookings.length, 2);
  assert.deepEqual(lapidi(sc.state()), []);
});

test("la stessa revision elaborata due volte (webhook + sincronizzazione) non crea doppioni", async () => {
  const sc = scenario();
  await withChannex({}, async () => {
    await importSingleRevision(sc.client, rev() as never);
    await importSingleRevision(sc.client, rev() as never);
  });
  const s = sc.state();
  assert.equal(s.bookings.length, 1);
  assert.equal(lapidi(s).length, 1); // la prima copia e' stata lapidata
});

// ───────────────────────── cancellazione ─────────────────────────
test("cancellazione: tutte le righe si marcano cancelled con updatedAt avanzato, ACK, email e calendario", async () => {
  const sc = scenario(baseData({
    guests: [{ id: "g-1", fullName: "Giulia Rossi" }],
    bookings: [seedBooking({ id: "r1", groupId: "g" }), seedBooking({ id: "r2", groupId: "g", unitId: "u2" }), seedBooking({ id: "estranea", extId: "channex:altro", unitId: "u3", roomTypeId: "rt-fam" })],
  }));
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev({ id: "rev-3", status: "cancelled" }) as never);
    assert.equal(out.cancelled, 1);
    assert.deepEqual(acks, ["rev-3"]);
  });
  const s = sc.state();
  const by = (id: string) => s.bookings.find((b: any) => b.id === id);
  assert.equal(by("r1").status, "cancelled"); assert.equal(by("r2").status, "cancelled");
  assert.ok(by("r1").updatedAt > 1000 && by("r2").updatedAt > 1000);
  assert.equal(by("estranea").status, "confirmed");
  assert.equal(calls("gcalDelete").length, 2);
  assert.equal(calls("internalFetch")[0].body.subject, "Prenotazione OTA cancellata · Giulia Rossi");
  assert.equal(s.activities[0].type, "cancel");
  assert.match(s.activities[0].text, /Cancellazione OTA — Giulia Rossi/);
  assert.deepEqual(calls("poolPush")[0].touched.map((t: any) => t.roomTypeId).sort(), ["rt-dbl", "rt-dbl"]);
});

test("cancellazione di una prenotazione mai importata: conteggiata e ACKata, nessuna riga, nessun registro", async () => {
  const sc = scenario();
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev({ status: "cancelled" }) as never);
    assert.equal(out.cancelled, 1); assert.equal(out.acked, 1);
    assert.deepEqual(acks, ["rev-1"]);
  });
  assert.equal(sc.state().bookings.length, 0);
  assert.equal((sc.state().activities ?? []).length, 0);
});

test("cancellazione di una prenotazione che arrivava da Octorate: trovata dal codice OTA", async () => {
  const sc = scenario(baseData({ bookings: [seedBooking({ id: "oct-1", extId: "octorate:99" })] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ status: "cancelled" }) as never); });
  assert.equal(sc.state().bookings[0].status, "cancelled");
});

test("la camera di una prenotazione cancellata torna libera per la nuova prenotazione", async () => {
  const sc = scenario(baseData({ bookings: [altra({ id: "c1", status: "cancelled", unitId: "u1" })] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-5", booking_id: "bk-5", ota_reservation_code: "555" }) as never); });
  assert.equal(sc.state().bookings.find((b: any) => b.extId === "channex:bk-5").unitId, "u1");
});

// ───────────────────────── multi-camera ─────────────────────────
test("multi-camera: una riga per camera, stesso groupId, camere diverse, commissione e costo d'incasso divisi al centesimo", async () => {
  const r = rev({
    amount: "300.00", ota_commission: "30.00", notes: "Payment charge is EUR 3.00",
    rooms: [
      room({ days: { "2099-06-10": "100.00", "2099-06-11": "50.00", "2099-06-12": "50.00" } }), // 200
      room({ days: { "2099-06-10": "50.00", "2099-06-11": "25.00", "2099-06-12": "25.00" } }), // 100
    ],
  });
  const sc = scenario();
  await withChannex({}, async () => { await importSingleRevision(sc.client, r as never); });
  const bs = sc.state().bookings;
  assert.equal(bs.length, 2);
  assert.equal(bs[0].groupId, bs[1].groupId);
  assert.notEqual(bs[0].unitId, bs[1].unitId);
  assert.deepEqual(bs.map((b: any) => b.unitId).sort(), ["u1", "u2"]);
  assert.deepEqual(bs.map((b: any) => b.total), [200, 100]);
  assert.deepEqual(bs.map((b: any) => b.commissionAmount), [20, 10]);
  assert.deepEqual(bs.map((b: any) => b.paymentFee), [2, 1]);
  assert.equal(bs[0].guestId, bs[1].guestId);
  // una sola email di "nuova prenotazione" per camera? Il codice ne manda una per riga: lo si documenta
  assert.equal(calls("internalFetch").length, 2);
});

test("multi-camera: la carta virtuale (solo metadati) sta sulla prima camera; nessun dato carta finisce nel salvataggio", async () => {
  const r = rev({
    is_virtual_card: true, virtual_card_current_balance: "36000", virtual_card_decimal_places: 2, virtual_card_currency_code: "EUR",
    virtual_card_effective_date: "2099-06-10", virtual_card_expiration_date: "2099-07-10",
    credit_card: { number: "4111111111111111", cvv: "123", cardholder_name: "VIRTUAL CARD" },
    rooms: [room({ amount: "180" }), room({ amount: "180" })],
  });
  const sc = scenario();
  await withChannex({}, async () => { await importSingleRevision(sc.client, r as never); });
  const bs = sc.state().bookings;
  assert.deepEqual(bs[0].otaCard, { present: true, currency: "EUR", balance: 360, effectiveDate: "2099-06-10", expirationDate: "2099-07-10" });
  assert.equal(bs[1].otaCard, undefined);
  const raw = JSON.stringify(sc.db.tables.app_state[0].data);
  assert.ok(!raw.includes("4111111111111111"));
  assert.ok(!raw.includes("VIRTUAL CARD"));
});

test("carta virtuale: se era gia' stata segnata 'addebitata' resta tale anche dopo la modifica", async () => {
  const old = seedBooking({ otaCard: { present: true, balance: 360, charged: true } });
  const sc = scenario(baseData({ bookings: [old] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-2", is_virtual_card: true, virtual_card_current_balance: 360 }) as never); });
  assert.equal(sc.state().bookings[0].otaCard.charged, true);
  // e senza carta nella nuova revision si conserva quella precedente
  const sc2 = scenario(baseData({ bookings: [old] }));
  await withChannex({}, async () => { await importSingleRevision(sc2.client, rev({ id: "rev-2" }) as never); });
  assert.deepEqual(sc2.state().bookings[0].otaCard, { present: true, balance: 360, charged: true });
});

test("modifica da 2 camere a 1: la camera in piu' viene lapidata, nessun residuo", async () => {
  const sc = scenario(baseData({ bookings: [seedBooking({ id: "m1", groupId: "g", paid: 50 }), seedBooking({ id: "m2", groupId: "g", unitId: "u2", paid: 70 })] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-2" }) as never); });
  const s = sc.state();
  assert.equal(s.bookings.length, 1);
  assert.deepEqual(lapidi(s).sort(), ["m1", "m2"]);
  assert.ok([50, 70].includes(s.bookings[0].paid)); // l'incasso di una delle due righe vecchie e' stato riportato
});

test("modifica a 2 camere invariate: l'incasso e la camera di ogni riga restano alla riga che aveva quel prezzo", { todo: "BUG: le righe sostituite vengono abbinate in ordine inverso (prevIdx ordinato a decrescere, channex-inbound.ts riga 321 + 377): la camera 1 prende i dati della camera 2" }, async () => {
  const sc = scenario(baseData({ bookings: [
    seedBooking({ id: "m1", groupId: "g", paid: 50, total: 200, unitId: "u1" }),
    seedBooking({ id: "m2", groupId: "g", paid: 70, total: 100, unitId: "u2" }),
  ] }));
  const rooms = [
    room({ days: { "2099-06-10": "100.00", "2099-06-11": "50.00", "2099-06-12": "50.00" } }), // 200
    room({ days: { "2099-06-10": "50.00", "2099-06-11": "25.00", "2099-06-12": "25.00" } }), // 100
  ];
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-2", amount: "300", rooms }) as never); });
  const bs = sc.state().bookings;
  assert.deepEqual(bs.map((b: any) => [b.total, b.paid, b.unitId]), [[200, 50, "u1"], [100, 70, "u2"]]);
});

// ───────────────────────── camera occupata / tipologia non mappata ─────────────────────────
test("camera libera preferita a quelle occupate; bordo check-out = check-in non e' sovrapposizione; fuori servizio saltata", async () => {
  const data = baseData({
    units: [{ id: "u0", roomTypeId: "rt-dbl", structureId: "st-1", outOfService: true }, { id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }, { id: "u2", roomTypeId: "rt-dbl", structureId: "st-1" }],
    bookings: [altra({ id: "occ", unitId: "u1", checkIn: "2099-06-08", checkOut: "2099-06-12" })],
  });
  const sc = scenario(data);
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev() as never); });
  assert.equal(sc.state().bookings.find((b: any) => b.extId === "channex:bk-1").unitId, "u2"); // u0 fuori servizio, u1 occupata

  const data2 = baseData({ bookings: [altra({ id: "prima", unitId: "u1", checkIn: "2099-06-07", checkOut: "2099-06-10" })] });
  const sc2 = scenario(data2);
  await withChannex({}, async () => { await importSingleRevision(sc2.client, rev() as never); });
  assert.equal(sc2.state().bookings.find((b: any) => b.extId === "channex:bk-1").unitId, "u1"); // l'altro parte il giorno in cui arriva questa
});

test("tutte le camere della tipologia occupate: la prenotazione OTA viene comunque registrata (overbooking visibile), sulla prima camera", async () => {
  const data = baseData({ bookings: [
    altra({ id: "o1", unitId: "u1" }), altra({ id: "o2", extId: "site:2:2", code: "ALTRO-2", unitId: "u2" }),
  ] });
  const sc = scenario(data);
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev({ id: "rev-7", booking_id: "bk-7", ota_reservation_code: "777" }) as never);
    assert.equal(out.imported, 1);
    assert.deepEqual(acks, ["rev-7"]);
  });
  const nb = sc.state().bookings.find((b: any) => b.extId === "channex:bk-7");
  assert.equal(nb.status, "confirmed");
  assert.equal(nb.unitId, "u1");
});

test("tipologia senza camere fisiche: la riga si crea senza camera (unitId null)", async () => {
  const sc = scenario(baseData({ units: [] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev() as never); });
  assert.equal(sc.state().bookings[0].unitId, null);
});

test("tipologia NON mappata: nessuna riga, NON ackata (resta nel feed), disponibilita' non inviata", async () => {
  const sc = scenario();
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev({ rooms: [room({ room_type_id: "chx-sconosciuta" })] }) as never);
    assert.equal(out.imported, 0); assert.equal(out.skipped, 1); assert.equal(out.acked, 0);
    assert.deepEqual(acks, []);
  });
  assert.equal(sc.state().bookings.length, 0);
  assert.equal(sc.db.tables.channex_bookings.length, 0);
  assert.equal(calls("poolPush").length, 0);
});

test("due camere di cui una non mappata: si importa la mappata e si fa l'ACK", async () => {
  const sc = scenario();
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev({ rooms: [room({ amount: "200" }), room({ room_type_id: "chx-sconosciuta" })] }) as never);
    assert.equal(out.imported, 1);
    assert.deepEqual(acks, ["rev-1"]);
  });
  assert.equal(sc.state().bookings.length, 1);
});

test("modifica che non ha nessuna camera mappata: le righe esistenti vengono RIPRISTINATE, non cancellate, e niente ACK", async () => {
  const old = seedBooking({ paid: 77 });
  const sc = scenario(baseData({ bookings: [old] }));
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev({ id: "rev-2", rooms: [room({ room_type_id: "chx-sconosciuta" })] }) as never);
    assert.equal(out.skipped, 1); assert.deepEqual(acks, []);
  });
  const s = sc.state();
  assert.equal(s.bookings.length, 1);
  assert.equal(s.bookings[0].id, "old-1");
  assert.equal(s.bookings[0].paid, 77);
  assert.deepEqual(lapidi(s), []);
});

// ───────────────────────── rete di sicurezza contro i doppioni ─────────────────────────
test("rete di sicurezza: due gruppi vivi con lo stesso extId (elaborazioni sovrapposte) -> resta il piu' recente, l'altro e' lapidato", async () => {
  const a = seedBooking({ id: "dup-vecchio", groupId: "g-a", updatedAt: 1000 });
  const b = seedBooking({ id: "dup-nuovo", groupId: "g-b", updatedAt: 5000, unitId: "u2" });
  const sc = scenario(baseData({ bookings: [a, b] }));
  // revision senza camere mappate: le righe tolte vengono rimesse e la rete di sicurezza fa il resto
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-2", rooms: [room({ room_type_id: "chx-sconosciuta" })] }) as never); });
  const s = sc.state();
  assert.deepEqual(live(s).map((x: any) => x.id), ["dup-nuovo"]);
  assert.deepEqual(lapidi(s), ["dup-vecchio"]);
});

test("rete di sicurezza: le righe di una stessa prenotazione multi-camera (stesso groupId) NON vengono toccate", async () => {
  const sc = scenario(baseData({ bookings: [seedBooking({ id: "m1", groupId: "g", updatedAt: 1 }), seedBooking({ id: "m2", groupId: "g", unitId: "u2", updatedAt: 2 })] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-2", rooms: [room({ room_type_id: "chx-sconosciuta" })] }) as never); });
  assert.equal(live(sc.state()).length, 2);
  assert.deepEqual(lapidi(sc.state()), []);
});

test("le lapidi precedenti si conservano e si accumulano senza ripetizioni", async () => {
  const sc = scenario(baseData({ _deleted: { bookings: ["vecchia-1", "old-1"] }, bookings: [seedBooking()] }));
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev({ id: "rev-2" }) as never); });
  assert.deepEqual(lapidi(sc.state()), ["vecchia-1", "old-1"]);
});

// ───────────────────────── store, conflitti, feed ─────────────────────────
test("struttura condivisa (org_id): si scrive in org_state e non nell'app_state personale", async () => {
  const sc = scenario(baseData(), { map: { ...MAP, org_id: "org-1" } });
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev() as never); });
  assert.equal(sc.state().bookings.length, 1);
  const personal = JSON.parse((sc.db.tables.app_state[0].data as any)[DATA_KEY]);
  assert.equal(personal.bookings.length, 0);
  assert.ok(sc.db.log.some((l) => l.op === "update" && l.table === "org_state"));
  assert.ok(!sc.db.log.some((l) => l.op === "update" && l.table === "app_state"));
});

test("conflitto di revisione (qualcuno ha scritto tra lettura e scrittura): riprova una volta e importa una sola volta", async () => {
  const sc = scenario();
  let bumped = false;
  sc.db.afterSelect = (table, db) => { if (table === "app_state" && !bumped) { bumped = true; (db.tables.app_state[0] as any).rev = 5; } };
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev() as never);
    assert.deepEqual(out.errors, []);
    assert.deepEqual(acks, ["rev-1"]);
    assert.equal(out.acked, 1);
  });
  assert.equal(sc.state().bookings.length, 1);
  assert.equal(sc.db.log.filter((l) => l.op === "update" && l.table === "app_state").length, 2);
  assert.equal(sc.db.tables.app_state[0].rev, 6);
});

test("conflitto di revisione: il riepilogo dice 1 importata, non 2", { todo: "BUG: i contatori di ImportSummary (imported/cancelled/skipped) si incrementano dentro applyOnce e vengono contati due volte quando il tentativo viene ripetuto (channex-inbound.ts righe 312/427/434 + 467)" }, async () => {
  const sc = scenario();
  let bumped = false;
  sc.db.afterSelect = (table, db) => { if (table === "app_state" && !bumped) { bumped = true; (db.tables.app_state[0] as any).rev = 5; } };
  await withChannex({}, async () => {
    const out = await importSingleRevision(sc.client, rev() as never);
    assert.equal(out.imported, 1);
  });
});

test("conflitto che persiste: errore segnalato, nessun ACK (la revision resta nel feed)", async () => {
  const sc = scenario();
  sc.db.afterSelect = (table, db) => { if (table === "app_state") (db.tables.app_state[0] as any).rev = Number((db.tables.app_state[0] as any).rev) + 10; };
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev() as never);
    assert.equal(out.errors.length, 1);
    assert.match(out.errors[0], /scrittura app_state fallita/);
    assert.equal(out.acked, 0); assert.deepEqual(acks, []);
  });
  assert.equal(sc.state().bookings.length, 0);
});

test("errore di scrittura nel database: segnalato e nessun ACK", async () => {
  const sc = scenario();
  sc.db.failUpdate = { app_state: "connessione persa" };
  await withChannex({}, async (acks) => {
    const out = await importSingleRevision(sc.client, rev() as never);
    assert.equal(out.errors.length, 1); assert.deepEqual(acks, []);
  });
});

test("importBookings: una scrittura per proprietario, property sconosciute saltate, passate scaricate, errore del feed riportato", async () => {
  const map2 = { channex_property_id: "prop-2", tenant_id: "tenant-2", structure_id: "st-9", rooms: { "chx-x": "rt-x" }, org_id: null };
  const data2 = { structures: [{ id: "st-9" }], roomTypes: [{ id: "rt-x", structureId: "st-9", name: "Suite", beds: 2, basePrice: 200 }], units: [{ id: "ux", roomTypeId: "rt-x", structureId: "st-9" }], guests: [], bookings: [] };
  const sc = scenario(baseData(), { extraMaps: [map2], extraStates: [{ user_id: "tenant-2", rev: 1, data: { [DATA_KEY]: JSON.stringify(data2) } }] });
  const revisions = [
    rev({ id: "r-a", booking_id: "b-a", ota_reservation_code: "A" }),
    rev({ id: "r-b", booking_id: "b-b", ota_reservation_code: "B", rooms: [room({ amount: "90" }), room({ amount: "90" })] }),
    rev({ id: "r-c", booking_id: "b-c", property_id: "prop-2", rooms: [room({ room_type_id: "chx-x", amount: "400" })] }),
    rev({ id: "r-d", booking_id: "b-d", property_id: "prop-ignota" }),
    rev({ id: "r-e", booking_id: "b-e", arrival_date: "2020-02-01", departure_date: "2020-02-04" }),
  ];
  await withChannex({ revisions }, async (acks) => {
    const out = await importBookings(sc.client);
    assert.equal(out.ok, true);
    assert.equal(out.feed, 5);
    assert.equal(out.imported, 3);
    assert.equal(out.skipped, 2); // sconosciuta + passata
    assert.deepEqual(acks.sort(), ["r-a", "r-b", "r-c", "r-e"]); // la sconosciuta resta nel feed
    assert.equal(out.acked, 4);
  });
  assert.equal(sc.db.log.filter((l) => l.op === "update" && l.table === "app_state").length, 2); // una per tenant
  assert.equal(sc.state().bookings.length, 3); // 1 + 2 camere
  assert.equal(sc.stateOf("app_state", "tenant-2").bookings.length, 1);

  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  try {
    const bad = await importBookings(sc.client);
    assert.equal(bad.ok, false); assert.equal(bad.imported, 0); assert.equal(bad.errors.length, 1);
  } finally { globalThis.fetch = original; }
});

test("importBookings: nuova + modifica della stessa prenotazione nello stesso feed -> una riga sola", async () => {
  const sc = scenario();
  const revisions = [rev({ id: "r1" }), rev({ id: "r2", arrival_date: "2099-06-12", departure_date: "2099-06-14", rooms: [room({ checkin_date: "2099-06-12", checkout_date: "2099-06-14", amount: "250" })] })];
  await withChannex({ revisions }, async () => { await importBookings(sc.client); });
  const s = sc.state();
  assert.equal(live(s).length, 1);
  assert.equal(live(s)[0].checkIn, "2099-06-12");
  assert.equal(live(s)[0].total, 250);
});

test("avvisi disattivati nelle preferenze: nessuna email al titolare; senza email di struttura nemmeno", async () => {
  const sc = scenario(baseData(), { blobExtra: { "spigolestay:notifs": JSON.stringify({ newBooking: false }) } });
  await withChannex({}, async () => { await importSingleRevision(sc.client, rev() as never); });
  assert.equal(calls("internalFetch").length, 0);
  const sc2 = scenario(baseData({ structures: [{ id: "st-1", name: "Casa" }] }));
  await withChannex({}, async () => { await importSingleRevision(sc2.client, rev() as never); });
  assert.equal(calls("internalFetch").length, 0);
  assert.equal(calls("gcalUpsert").length, 0); // senza gcalId nessuna sincronizzazione calendario
});
