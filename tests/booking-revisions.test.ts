import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { normalizeRevision, diffRevisions, revisionLabel, revisionKind, dmy, money, romeDateTime, guestsLabel, redactRaw, stripRaw } = await import("../src/lib/booking-revisions.ts");

const base = {
  id: "6a5871b7-1111-2222-3333-444444444444", booking_id: "bk-1", status: "new", ota_name: "Booking.com", ota_reservation_code: "123456",
  arrival_date: "2026-10-28", departure_date: "2026-10-31", amount: "300.00", currency: "EUR", ota_commission: "45.00",
  inserted_at: "2026-10-17T05:26:43.000000", notes: "Late arrival",
  customer: { name: "Mario", surname: "Rossi", mail: "m@x.it", phone: "+39 333", country: "IT" },
  occupancy: { adults: 2, children: 0, infants: 0 },
  payment_collect: "property", payment_type: null,
  guarantee: { card_number: "411111******1111", card_type: "VI", cardholder_name: "Mario Rossi", cvv: "***", is_virtual: false },
  rooms: [{
    room_type_id: "rt1", rate_plan_id: "rp1", checkin_date: "2026-10-28", checkout_date: "2026-10-31",
    occupancy: { adults: 2, children: 0, infants: 0 }, amount: "300.00",
    days: { "2026-10-28": "100.00", "2026-10-29": "100.00", "2026-10-30": "100.00" },
    guests: [{ name: "Mario", surname: "Rossi" }],
    meta: { meal_plan: "Colazione inclusa", cancel_penalties: [{ amount: "0.00", currency: "EUR", from: "2026-10-01T00:00:00" }, { amount: "100.00", currency: "EUR", from: "2026-10-20T00:00:00" }] },
  }],
  services: [{ name: "Breakfast", type: "Breakfast", nights: 3, persons: 2, price_mode: "Per person per night", total_price: "30.00" }],
};
const modified = {
  ...base, id: "0dab24c7-aaaa-bbbb-cccc-dddddddddddd", status: "modified", inserted_at: "2026-10-17T05:27:33.123456",
  arrival_date: "2026-10-30", departure_date: "2026-11-01", amount: "225.56", ota_commission: "33.83", notes: "Late arrival, quiet room",
  occupancy: { adults: 3, children: 0, infants: 0 },
  rooms: [{ ...base.rooms[0], checkin_date: "2026-10-30", checkout_date: "2026-11-01", occupancy: { adults: 3, children: 0, infants: 0 }, amount: "225.56", days: { "2026-10-30": "112.78", "2026-10-31": "112.78" } }],
  services: [],
};

test("revisionLabel / revisionKind", () => {
  assert.equal(revisionLabel("new"), "Nuovo");
  assert.equal(revisionLabel("modified"), "Modificata");
  assert.equal(revisionLabel("cancelled"), "Cancellata");
  assert.equal(revisionLabel("boh"), "Revisione");
  assert.equal(revisionKind("CANCELED"), "cancelled");
});

test("normalizeRevision: campi leggibili", () => {
  const v = normalizeRevision(base);
  assert.equal(v.shortId, "6a5871b7");
  assert.equal(v.kind, "new");
  assert.equal(v.label, "Nuovo");
  assert.equal(v.atLabel, "17.10.2026 07:26:43"); // 05:26:43 UTC = 07:26:43 in Italia (CEST)
  assert.equal(v.nights, 3);
  assert.equal(v.total, 300);
  assert.equal(v.commission, 45);
  assert.equal(v.customer.name, "Mario Rossi");
  assert.equal(v.rooms.length, 1);
  assert.equal(v.rooms[0].nightly.length, 3);
  assert.equal(v.rooms[0].guests[0], "Mario Rossi");
  assert.equal(v.charges.length, 1);
  assert.equal(v.charges[0].amount, 30);
  assert.ok(v.policies.some((p) => p.startsWith("Cancellazione gratuita fino al 20.10.2026")));
  assert.ok(v.policies.includes("Pasti: Colazione inclusa"));
  assert.equal(v.guarantee?.cardType, "VI");
});

test("raw: garanzia ridotta a card_type/is_virtual, resto invariato e originale non mutato", () => {
  const v = normalizeRevision(base);
  const g = v.raw!.guarantee as Record<string, unknown>;
  assert.deepEqual(g, { card_type: "VI", is_virtual: false });
  assert.equal(v.raw!.notes, "Late arrival");
  assert.equal(base.guarantee.card_number, "411111******1111");
  const j = redactRaw({ attributes: { guarantee: { cvv: "123", card_type: "MC" } } });
  assert.deepEqual((j.attributes as any).guarantee, { card_type: "MC" });
});

test("redactRaw: token del vault, scadenza, IBAN e chiavi card/cvv/cvc rimossi ovunque, anche annidati", () => {
  const j = redactRaw({
    id: "r1", notes: "ok",
    guarantee: { token: "tok_123", expiration_date: "12/30", card_number: "4111", cardholder_name: "M R", cvv: "1", card_type: "VI", is_virtual: true, extra: "x" },
    payment: { iban: "IT60X", cvc: "123", credit_card_last4: "1111", amount: "10.00" },
    rooms: [{ meta: { card_holder: "X", meal_plan: "BB", vault_token: "t" } }],
  }) as any;
  assert.deepEqual(j.guarantee, { card_type: "VI", is_virtual: true });
  assert.deepEqual(j.payment, { amount: "10.00" });
  assert.deepEqual(j.rooms[0].meta, { meal_plan: "BB" });
  assert.equal(j.notes, "ok");
  assert.ok(!/tok_123|4111|12\/30|IT60X/.test(JSON.stringify(j)));
  assert.deepEqual(redactRaw({ guarantee: "stringa" }), {});
  assert.deepEqual(redactRaw(null as any), {});
});

test("stripRaw: toglie il JSON originale dalla vista senza toccare il resto", () => {
  const v = normalizeRevision(base);
  assert.ok(v.raw);
  const s = stripRaw(v);
  assert.equal("raw" in s, false);
  assert.equal(s.revisionId, v.revisionId);
  assert.equal(s.total, 300);
  assert.ok(v.raw);
});

test("normalizeRevision: forma JSON:API e dati mancanti non rompono", () => {
  const v = normalizeRevision({ id: "abcdefgh-1", attributes: { status: "cancelled", arrival_date: "2026-01-02", departure_date: "2026-01-04" } }, { importedAt: "2026-01-01T10:00:00+00:00" });
  assert.equal(v.shortId, "abcdefgh");
  assert.equal(v.label, "Cancellata");
  assert.equal(v.nights, 2);
  assert.equal(v.total, null);
  assert.equal(v.atLabel, "01.01.2026 11:00:00");
  const empty = normalizeRevision(null);
  assert.equal(empty.revisionId, "");
  assert.equal(empty.rooms.length, 0);
});

test("diffRevisions: modifica con date, notti, totale, ospiti, commissione, note", () => {
  const d = diffRevisions(normalizeRevision(base), normalizeRevision(modified));
  assert.ok(d.includes("Arrivo: 28.10.2026 → 30.10.2026"), d.join("|"));
  assert.ok(d.includes("Notti: 3 → 2"));
  assert.ok(d.includes("Totale: € 300,00 → € 225,56"));
  assert.ok(d.includes("Ospiti: 2 adulti → 3 adulti"));
  assert.ok(d.includes("Commissione: € 45,00 → € 33,83"));
  assert.ok(d.includes("Note: modificate"));
  assert.ok(d.includes("Spesa rimossa: Breakfast (€ 30,00)"));
  assert.ok(d.includes("Partenza: 31.10.2026 → 01.11.2026"));
  assert.ok(!d.some((l) => /id|system/i.test(l)));
});

test("diffRevisions: prezzo per notte, prima revisione, nessuna differenza, cancellazione", () => {
  const a = normalizeRevision(base);
  assert.deepEqual(diffRevisions(null, a), []);
  assert.deepEqual(diffRevisions(a, normalizeRevision({ ...base, id: "zzzzzzzz-9", inserted_at: "2026-10-18T10:00:00" })), []);
  const cheaper = normalizeRevision({ ...base, id: "yyyyyyyy-9", amount: "290.00", rooms: [{ ...base.rooms[0], days: { "2026-10-28": "90.00", "2026-10-29": "100.00", "2026-10-30": "100.00" } }] });
  const d = diffRevisions(a, cheaper);
  assert.ok(d.includes("Prezzo 28.10.2026: € 100,00 → € 90,00"), d.join("|"));
  assert.ok(d.includes("Totale: € 300,00 → € 290,00"));
  const canc = diffRevisions(a, normalizeRevision({ ...base, id: "xxxxxxxx-9", status: "cancelled" }));
  assert.deepEqual(canc, ["Prenotazione cancellata"]);
});

test("diffRevisions: più camere e limite righe prezzo", () => {
  const days = (v: number) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`2026-11-${String(i + 1).padStart(2, "0")}`, v.toFixed(2)]));
  const mk = (id: string, v: number, rooms: number) => normalizeRevision({
    ...base, id, arrival_date: "2026-11-01", departure_date: "2026-11-11", amount: String(v * 10 * rooms),
    rooms: Array.from({ length: rooms }, () => ({ ...base.rooms[0], checkin_date: "2026-11-01", checkout_date: "2026-11-11", days: days(v), amount: String(v * 10) })),
  });
  const d = diffRevisions(mk("aaaaaaaa-1", 50, 1), mk("bbbbbbbb-2", 60, 2));
  assert.ok(d.includes("Camere: 1 → 2"));
  assert.equal(d.filter((l) => l.includes(" · Prezzo ") || l.startsWith("Prezzo ")).length, 6);
  assert.ok(d.some((l) => l.startsWith("… e altre 4 notti")));
});

test("helper di formato", () => {
  assert.equal(dmy("2026-10-28"), "28.10.2026");
  assert.equal(dmy(""), "");
  assert.equal(money(null), "—");
  assert.equal(money(76.5, "GBP"), "GBP 76,50");
  assert.equal(guestsLabel(1), "1 adulto");
  assert.equal(guestsLabel(2, 1, 2), "2 adulti, 1 bambino, 2 neonati");
  assert.equal(romeDateTime("2026-01-15T23:30:00Z", false).label, "16.01.2026 00:30");
  assert.equal(romeDateTime("non-una-data").iso, null);
});

test("normalizeRevision: RUID, politiche dell'OTA e depositi", () => {
  const v = normalizeRevision({
    ...base, ruid: "UmFuZG9tSVYkc2Rl", unique_id: "BDC-123456",
    deposits: [{ amount: "50.00", currency: "EUR" }],
    rooms: [{ ...base.rooms[0], meta: { ...base.rooms[0].meta, policies: "Deposito: il cliente paga nei 3 giorni prima dell'arrivo." } }],
  });
  assert.equal(v.ruid, "UmFuZG9tSVYkc2Rl");
  assert.equal(v.uniqueId, "BDC-123456");
  assert.equal(v.policiesText, "Deposito: il cliente paga nei 3 giorni prima dell'arrivo.");
  assert.equal(v.deposits, "50,00 EUR");
  const w = normalizeRevision(base);
  assert.equal(w.ruid, undefined);
  assert.equal(w.policiesText, undefined);
  assert.equal(w.deposits, undefined);
});

test("normalizeRevision: garanzia — solo dati non sensibili, codice promozionale", () => {
  const virt = normalizeRevision({
    ...base,
    guarantee: { card_type: "MC", card_number: "557093******7948", expiration_date: "10/2031", cardholder_name: "virtual card", cvv: "123", is_virtual: true },
    virtual_card_current_balance: 15492, virtual_card_decimal_places: 2, virtual_card_currency_code: "EUR", virtual_card_effective_date: "2026-10-19",
    rooms: [{ ...base.rooms[0], meta: { promotion: "Pacchetto 15%" } }],
  });
  assert.deepEqual(virt.guarantee, { cardType: "MC", isVirtual: true, cardNumber: "557093******7948", expiry: "10/2031", holder: "virtual card", cvv: true, vccActivation: "2026-10-19", vccBalance: 154.92, vccCurrency: "EUR" });
  assert.equal(virt.rooms[0].promotion, "Pacchetto 15%");
  assert.ok(!JSON.stringify(virt.guarantee).includes("123")); // il CVV non esce mai
  // numero intero: ridotto a primi 6 + ultimi 4
  const full = normalizeRevision({ ...base, guarantee: { card_type: "VI", card_number: "4111111111111111", is_virtual: true } });
  assert.equal(full.guarantee?.cardNumber, "411111******1111");
  // carta NON virtuale (di un ospite): niente numero, scadenza, titolare
  const guest = normalizeRevision({ ...base, guarantee: { card_type: "VI", card_number: "411111******1111", expiration_date: "12/2030", cardholder_name: "Mario Rossi", cvv: "999", is_virtual: false } });
  assert.deepEqual(guest.guarantee, { cardType: "VI", isVirtual: false, cvv: true });
});
