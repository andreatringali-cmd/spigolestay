import test from "node:test";
import assert from "node:assert/strict";
import {
  readRevisionGuestData, mergeOtaOverCarried, sumDaysExact, roomTotalExact, cleanOtaNotes, describeCancelPenalties,
} from "../src/lib/channex-guestdata.ts";

// Revision di esempio costruite sugli esempi della documentazione Channex (bookings-collection).
const bookingCom = {
  amount: "153.00", arrival_hour: "15:30", notes: "You have a booker that would like free parking.\nQuiet room please.",
  payment_collect: "property", payment_type: null, ota_commission: "22.95",
};
const bookingComRoom = {
  amount: "153.00", days: { "2020-11-13": "76.50", "2020-11-14": "76.50" },
  occupancy: { adults: 2, children: 1, infants: 0, ages: [5] },
  meta: {
    meal_plan: "Breakfast is included in the room rate.",
    cancel_penalties: [
      { amount: "76.50", currency: "GBP", from: "2020-11-12T00:00:00" },
      { amount: "0.00", currency: "GBP", from: "2020-11-09T17:32:51" },
    ],
  },
};

test("Booking.com: note, orario, età bambini, pagamento, penali, totale ai centesimi", () => {
  const g = readRevisionGuestData(bookingCom, bookingComRoom);
  assert.equal(g.arrivalTime, "15:30");
  assert.match(g.guestRequests!, /free parking/);
  assert.deepEqual(g.childAges, [5]);
  assert.equal(g.total, 153);
  assert.equal(g.otaInfo!.paymentCollect, "property");
  assert.equal(g.otaInfo!.paymentType, undefined);
  assert.equal(g.otaInfo!.mealPlan, "Breakfast is included in the room rate.");
  // penali ordinate per data
  assert.deepEqual(g.otaInfo!.cancelPenalties!.map((p) => p.amount), [0, 76.5]);
  assert.equal(describeCancelPenalties(g.otaInfo!.cancelPenalties), "Cancellazione gratuita fino al 12/11/2020; poi penale di 76,50 GBP");
});

test("Expedia: free_text uguale a notes non duplicato, payment_instruction e preferenze", () => {
  const rev = { amount: "85.00", arrival_hour: null, notes: "Room with View please", payment_collect: null, payment_type: null };
  const room = {
    amount: "85.00", days: { "2021-11-10": "85.00" }, occupancy: { adults: 2, children: 0, infants: 0 },
    meta: { bed_preferences: "1 Double Bed", cancel_penalties: [], free_text: "Room with View please", smoking_preferences: "Non-Smoking", payment_instruction: "Collect payment from traveler upon arrival." },
  };
  const g = readRevisionGuestData(rev, room);
  assert.equal(g.guestRequests, "Room with View please");
  assert.equal(g.arrivalTime, undefined);
  assert.equal(g.childAges, undefined);
  assert.equal(g.otaInfo!.bedPreferences, "1 Double Bed");
  assert.equal(g.otaInfo!.smokingPreferences, "Non-Smoking");
  assert.match(g.otaInfo!.paymentInstruction!, /upon arrival/);
  assert.equal(g.otaInfo!.cancelPenalties, undefined);
});

test("Airbnb: le righe finanziarie nelle note non sono richieste dell'ospite", () => {
  const notes = "Listing Base Price: 300.00\nTotal Paid Amount: 0.00\nTransient Occupancy Tax Paid Amount: 0.00\nListing Cancellation Payout: 249.60\nArriverò tardi\n";
  assert.equal(cleanOtaNotes(notes), "Arriverò tardi");
  assert.equal(cleanOtaNotes("Listing Base Price: 300.00\nTotal Paid Amount: 0.00"), undefined);
  assert.equal(readRevisionGuestData({ notes: "Listing Base Price: 300.00" }, undefined).guestRequests, undefined);
});

test("payment_collect ota + credit_card; valori sconosciuti ignorati; ages null", () => {
  const g = readRevisionGuestData(
    { payment_collect: "ota", payment_type: "credit_card" },
    { occupancy: { adults: 2, children: 0, infants: 0, ages: null }, days: { "2025-04-14": "2093.00" } },
  );
  assert.equal(g.otaInfo!.paymentCollect, "ota");
  assert.equal(g.otaInfo!.paymentType, "credit_card");
  assert.equal(g.childAges, undefined);
  const h = readRevisionGuestData({ payment_collect: "boh", payment_type: "xx", arrival_hour: "25:99" }, undefined);
  assert.equal(h.otaInfo, undefined);
  assert.equal(h.arrivalTime, undefined);
});

test("importi: centesimi esatti, niente errori di virgola mobile, fallback su room.amount e amount", () => {
  assert.equal(sumDaysExact({ a: "0.10", b: "0.20", c: "76.55" }), 76.85);
  assert.equal(roomTotalExact({ days: { "2026-01-01": "100.55", "2026-01-02": "99.45" } }, "999", true), 200);
  assert.equal(roomTotalExact({ days: { "2026-01-01": "100.55" } }, "999", true), 100.55); // niente arrotondamento all'euro
  assert.equal(roomTotalExact({ amount: "321.10" }, "999", false), 321.1);
  assert.equal(roomTotalExact({}, "220.40", true), 220.4);
  assert.equal(roomTotalExact({}, "220.40", false), 0); // l'amount della prenotazione solo alla prima camera
  assert.equal(readRevisionGuestData({}, {}).total, undefined);
});

test("mergeOtaOverCarried: il testo dell'ospite non viene perso, l'OTA aggiorna se cambia", () => {
  const first = readRevisionGuestData({ notes: "Culla in camera", arrival_hour: "18:00" }, undefined);
  // prima importazione sopra una riga con dati scritti dall'ospite al check-in
  const m1 = mergeOtaOverCarried(first, { guestRequests: "Allergia alle noci", arrivalTime: "20:00" }, undefined);
  assert.equal(m1.guestRequests, "Allergia alle noci\nCulla in camera");
  assert.equal(m1.arrivalTime, undefined); // senza storico OTA vince l'orario dell'ospite
  // seconda revision uguale: nessun cambio
  const m2 = mergeOtaOverCarried(first, { guestRequests: "Culla in camera", arrivalTime: "18:00" }, first.otaInfo);
  assert.equal(m2.guestRequests, "Culla in camera");
  // l'OTA cambia testo e orario → aggiornati (il carried era il vecchio testo OTA)
  const next = readRevisionGuestData({ notes: "Culla e balcone", arrival_hour: "19:00" }, undefined);
  const m3 = mergeOtaOverCarried(next, { guestRequests: "Culla in camera", arrivalTime: "18:00" }, first.otaInfo);
  assert.equal(m3.guestRequests, "Culla e balcone");
  assert.equal(m3.arrivalTime, "19:00");
  // orario cambiato lato ospite e OTA invariata → resta quello dell'ospite
  const m4 = mergeOtaOverCarried(first, { guestRequests: "Culla in camera", arrivalTime: "21:00" }, first.otaInfo);
  assert.equal(m4.arrivalTime, undefined);
  // età bambini: l'OTA vince quando le manda
  assert.deepEqual(mergeOtaOverCarried({ childAges: [4, 9] }, { childAges: [3] }).childAges, [4, 9]);
});

test("describeCancelPenalties: penale immediata e nessuna penale", () => {
  assert.equal(describeCancelPenalties(undefined), undefined);
  assert.equal(describeCancelPenalties([{ amount: 0, from: "2026-01-01T00:00:00" }]), "Cancellazione senza penale");
  assert.equal(describeCancelPenalties([{ amount: 50, currency: "EUR", from: "2026-01-01T00:00:00" }]), "Penale di 50,00 EUR dal 01/01/2026");
});
