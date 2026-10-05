import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAiSite, buildQuote, buildJsonLd, buildLlmsTxt, type PricingDeps } from "../src/lib/ai-site-core.ts";

const deps: PricingDeps = {
  effectiveBase: (rt) => rt.basePrice,
  effectiveClosed: (rt) => !!rt.salesClosed,
  weekendPctFromRaw: () => 25,
};
const ORIGIN = "https://xenora.it";

// Snapshot "pubblico" con DENTRO dati sensibili che NON devono mai uscire.
const snapshot = (over: { bookings?: unknown[]; rt?: Record<string, unknown> } = {}) => ({
  "spigolestay:data:v1": JSON.stringify({
    structures: [{
      id: "s1", name: "Casa Test", type: "B&B", city: "Siracusa", province: "SR", address: "Via Roma", streetNumber: "1", phone: "+39 333 1112222", email: "info@casatest.it",
      services: ["Wi-Fi", "Aria condizionata"], cancelPolicy: "flessibile", cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2, cityTaxMaxNights: 7, checkInFrom: "15:00", checkOutBy: "10:30",
      // sensibili:
      accessInfo: "CODICE PORTONE 1313", stripeAccount: "acct_SEGRETO123", iban: "IT60X0542811101000000123456", vat: "IT01234567890", taxCode: "RSSMRA80A01H501U", alloggiatiUser: "utente.questura",
    }],
    roomTypes: [{ id: "r1", structureId: "s1", name: "Deluxe", beds: 2, basePrice: 80, maxOccupancy: 3, minStay: 2, description: "Camera luminosa", amenities: ["TV"], ...(over.rt ?? {}) }],
    units: [{ id: "u1", roomTypeId: "r1", structureId: "s1", name: "SH_1", accessInfo: "KEYBOX 9999" }],
    bookings: over.bookings ?? [],
    rateOverrides: {},
    directReviews: [{ structureId: "s1", rating: 10 }, { structureId: "s1", rating: 8 }],
    guests: [{ id: "g1", fullName: "Mario Segreto", email: "mario@segreto.it" }],
  }),
  "spigolestay:sito": JSON.stringify({ nome: "Casa Test Siracusa", tagline: "Il tuo B&B a Ortigia" }),
});
const build = (over?: Parameters<typeof snapshot>[0]) => buildAiSite("casa-test", snapshot(over), { structure_id: "s1" }, ORIGIN, deps)!;

test("nessun dato sensibile esce: né nella scheda, né in JSON-LD, né in llms.txt", () => {
  const d = build();
  const all = JSON.stringify(d.site) + JSON.stringify(buildJsonLd(d.site, ORIGIN)) + buildLlmsTxt(d.site, ORIGIN) + JSON.stringify(buildQuote(d, "2026-10-05", "2026-10-07", 2, 0, ORIGIN));
  for (const secret of ["1313", "acct_SEGRETO123", "IT60X05428", "IT01234567890", "RSSMRA80A01H501U", "utente.questura", "KEYBOX", "9999", "Mario Segreto", "mario@segreto.it"]) {
    assert.equal(all.includes(secret), false, "è uscito: " + secret);
  }
});

test("scheda: nome dal sito, camere, valutazione media su 5, link di prenotazione", () => {
  const d = build();
  assert.equal(d.site.name, "Casa Test Siracusa");
  assert.equal(d.site.rooms.length, 1);
  assert.equal(d.site.rooms[0].fromPrice, 80);
  assert.deepEqual(d.site.rating, { value5: 4.5, count: 2 });
  assert.equal(d.site.bookingUrl, `${ORIGIN}/prenota?site=casa-test`);
  assert.ok(d.site.policies.cityTax?.includes("2 € a persona a notte"));
});

test("preventivo: camera libera → prezzo del soggiorno e link diretto con date e ospiti", () => {
  const q = buildQuote(build(), "2026-10-05", "2026-10-07", 2, 0, ORIGIN); // lun-mar: nessun weekend
  assert.equal(q.nights, 2);
  assert.equal(q.options.length, 1);
  assert.equal(q.options[0].total, 160);
  assert.equal(q.options[0].averagePerNight, 80);
  assert.ok(q.options[0].bookingUrl.includes("checkin=2026-10-05") && q.options[0].bookingUrl.includes("rt=r1") && q.options[0].bookingUrl.includes("adults=2"));
});

test("weekend: la maggiorazione si applica a venerdì, sabato e domenica", () => {
  const q = buildQuote(build({ rt: { minStay: 1 } }), "2026-10-09", "2026-10-10", 2, 0, ORIGIN); // venerdì
  assert.equal(q.options[0].total, 100); // 80 + 25%
});

test("occupata, bloccata o fuori servizio = non disponibile; cancellata = libera", () => {
  const busy = { unitId: "u1", status: "confirmed", channel: "booking", checkIn: "2026-10-06", checkOut: "2026-10-08" };
  assert.equal(buildQuote(build({ bookings: [busy] }), "2026-10-05", "2026-10-07", 2, 0, ORIGIN).options.length, 0);
  const blocked = { unitId: "u1", status: "confirmed", channel: "blocked", checkIn: "2026-10-05", checkOut: "2026-10-08" };
  const qb = buildQuote(build({ bookings: [blocked] }), "2026-10-05", "2026-10-07", 2, 0, ORIGIN);
  assert.equal(qb.options.length, 0); assert.match(qb.unavailable[0].reason, /Nessuna camera libera/);
  const cancelled = { ...busy, status: "cancelled" };
  assert.equal(buildQuote(build({ bookings: [cancelled] }), "2026-10-05", "2026-10-07", 2, 0, ORIGIN).options.length, 1);
  // stesso giorno di partenza/arrivo: non si sovrappone
  const edge = { unitId: "u1", status: "confirmed", channel: "booking", checkIn: "2026-10-03", checkOut: "2026-10-05" };
  assert.equal(buildQuote(build({ bookings: [edge] }), "2026-10-05", "2026-10-07", 2, 0, ORIGIN).options.length, 1);
});

test("limiti: ospiti oltre la capienza e soggiorno sotto il minimo", () => {
  const d = build();
  assert.match(buildQuote(d, "2026-10-05", "2026-10-07", 4, 0, ORIGIN).unavailable[0].reason, /Ospiti massimi: 3/);
  assert.match(buildQuote(d, "2026-10-05", "2026-10-06", 2, 0, ORIGIN).unavailable[0].reason, /minimo: 2 notti/);
});

test("JSON-LD: tipo, camere, azione di prenotazione, nessun HTML pericoloso", () => {
  const ld = buildJsonLd(build().site, ORIGIN) as Record<string, unknown>;
  assert.equal(ld["@type"], "BedAndBreakfast");
  assert.equal((ld.containsPlace as unknown[]).length, 1);
  assert.equal((ld.potentialAction as { "@type": string })["@type"], "ReserveAction");
  assert.equal((ld.aggregateRating as { ratingValue: number }).ratingValue, 4.5);
  assert.equal(JSON.stringify(ld).includes("<script"), false);
});

test("llms.txt: sezioni e istruzioni per prenotare", () => {
  const t = buildLlmsTxt(build().site, ORIGIN);
  assert.ok(t.startsWith("# Casa Test Siracusa"));
  assert.ok(t.includes("## Camere") && t.includes("**Deluxe**"));
  assert.ok(t.includes(`${ORIGIN}/api/ai/casa-test/quote?checkin=`));
  assert.ok(t.includes("senza commissioni"));
});
