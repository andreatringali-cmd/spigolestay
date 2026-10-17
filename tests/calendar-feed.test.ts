import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { foldLine, buildIcs, bookingEvents, pulizieEvents } = await import("../src/lib/calendar-feed.ts");
const { todayRome, addDaysYmd } = await import("../src/lib/dates-rome.ts");

const bytes = (s: string) => new TextEncoder().encode(s).length;

test("foldLine: righe corte invariate; lunghe piegate a 75 OTTETTI (non caratteri) e ricomponibili", () => {
  const short = "SUMMARY:Mario Rossi";
  assert.equal(foldLine(short), short);
  // 40 lettere accentate = 80 byte UTF-8 ma solo 40 caratteri: con il vecchio taglio a 75 caratteri non veniva piegata.
  const accented = "SUMMARY:" + "è".repeat(40);
  const folded = foldLine(accented);
  assert.ok(folded.includes("\r\n "), "deve essere piegata");
  for (const [i, l] of folded.split("\r\n").entries()) assert.ok(bytes(l) <= 75, `riga ${i}: ${bytes(l)} ottetti`);
  assert.equal(folded.replace(/\r\n /g, ""), accented); // ricomponendo si ritrova l'originale
});

test("foldLine: non spezza le coppie surrogate (emoji) né le sequenze UTF-8", () => {
  const line = "SUMMARY:" + "🧹".repeat(30) + " Pulizia camera";
  const folded = foldLine(line);
  const parts = folded.split("\r\n");
  for (const p of parts) {
    assert.ok(bytes(p) <= 75, `${bytes(p)} ottetti`);
    // nessuna metà di coppia surrogata a inizio/fine riga
    assert.ok(!/[\uD800-\uDBFF]$/.test(p), "coppia surrogata spezzata in coda");
    assert.ok(!/^ ?[\uDC00-\uDFFF]/.test(p), "coppia surrogata spezzata in testa");
  }
  assert.equal(folded.replace(/\r\n /g, ""), line);
});

test("foldLine: caratteri ASCII lunghi, righe da esattamente 75 e 76 ottetti", () => {
  assert.equal(foldLine("A".repeat(75)), "A".repeat(75));
  const f = foldLine("A".repeat(76));
  assert.deepEqual(f.split("\r\n").map((p) => p.length), [75, 2]);
  const g = foldLine("B".repeat(200));
  for (const l of g.split("\r\n")) assert.ok(l.length <= 75);
  assert.equal(g.replace(/\r\n /g, ""), "B".repeat(200));
});

const future = addDaysYmd(todayRome(), 10);
const future2 = addDaysYmd(todayRome(), 12);
const data = {
  structures: [{ id: "s1", name: "Spigolehouse" }],
  units: [{ id: "u1", structureId: "s1", name: "Camera 1" }],
  guests: [{ id: "g1", fullName: "Mario Rossi" }],
  bookings: [
    { id: "b1", structureId: "s1", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", code: "XEN-1", checkIn: future, checkOut: future2, adults: 2, children: 0 },
    { id: "b2", structureId: "s1", unitId: "u1", guestId: "g1", status: "confirmed", channel: "blocked", checkIn: future, checkOut: future2, adults: 1 },
    { id: "b3", structureId: "s1", unitId: "u1", guestId: "g1", status: "confirmed", channel: "booking", code: "123", checkIn: future2, checkOut: addDaysYmd(future2, 1), adults: 1 },
  ],
};

test("feed prenotazioni: i blocchi camera (channel blocked) non compaiono; il canale ha l'etichetta, non il codice interno", () => {
  const ev = bookingEvents(data);
  assert.equal(ev.length, 2);
  assert.ok(!ev.some((e) => e.uid.includes("b2")));
  const d = ev.find((e) => e.uid.includes("b1"))!;
  assert.match(d.description!, /Canale: Diretta/);
  assert.ok(!/Canale: direct/.test(d.description!));
  assert.match(ev.find((e) => e.uid.includes("b3"))!.description!, /Canale: Booking\.com/);
});

test("feed pulizie: niente turnover per i blocchi; fine giornata = giorno dopo (aritmetica di calendario)", () => {
  const ev = pulizieEvents(data);
  // b1 parte il giorno future2 e b3 arriva lo stesso giorno: turnover; il blocco b2 non genera nulla di suo
  const out = ev.filter((e) => e.startISO === future2);
  assert.equal(out.length, 1);
  assert.match(out[0].summary, /turnover/);
  assert.equal(out[0].endISO, addDaysYmd(future2, 1));
  assert.equal(ev.some((e) => e.startISO === future), false); // il check-out del solo blocco b2 non diventa pulizia
});

test("buildIcs: ogni riga entro 75 ottetti anche con emoji e accenti", () => {
  const ics = buildIcs("Pulizie", [{ uid: "x@y", startISO: "2027-03-27", endISO: "2027-03-28", summary: "🧹 Pulizia Spigolehouse Camera “Città” — turnover (partenza + arrivo) con un nome molto lungo per forzare la piega", description: "Codice: XEN-1 · Canale: Diretta" }]);
  for (const l of ics.split("\r\n")) assert.ok(bytes(l) <= 75, `${bytes(l)}: ${l}`);
  assert.match(ics, /DTSTART;VALUE=DATE:20270327/);
  assert.match(ics, /DTEND;VALUE=DATE:20270328/);
});
