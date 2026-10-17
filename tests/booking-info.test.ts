import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);

const B = await import("../src/lib/booking-info.ts");

test("fmtDateWd: giorno della settimana italiano abbreviato + gg.mm.aaaa", () => {
  assert.equal(B.fmtDateWd("2026-10-30"), "ven 30.10.2026");
  assert.equal(B.fmtDateWd("2026-10-17"), "sab 17.10.2026");
  assert.equal(B.fmtDateWd("2026-11-01"), "dom 01.11.2026");
  assert.equal(B.fmtDateWd("2026-10-30T10:00:00Z"), "ven 30.10.2026");
  assert.equal(B.fmtDateWd(""), "");
  assert.equal(B.fmtDateWd("boh"), "boh");
  assert.equal(B.weekdayOfISO("2027-02-28"), "dom");
});

test("occupancyLabel: formato Channex, neonati solo se noti", () => {
  assert.equal(B.occupancyLabel({ adults: 2, children: 0, cribs: 0 }), "A: 2 C: 0 I: 0");
  assert.equal(B.occupancyLabel({ adults: 2, children: 1 }), "A: 2 C: 1");
  assert.equal(B.occupancyLabel({ adults: 1, children: 0, cribs: 1 }), "A: 1 C: 0 I: 1");
});

test("splitFrom e cancelPenaltyLines: data gg.mm.aaaa + ora, ordinate", () => {
  assert.deepEqual(B.splitFrom("2026-10-28 00:00:00"), { date: "28.10.2026", time: "00:00" });
  assert.deepEqual(B.splitFrom("2026-10-28T14:30:00+02:00"), { date: "28.10.2026", time: "14:30" });
  assert.deepEqual(B.splitFrom("2026-10-28"), { date: "28.10.2026" });
  const lines = B.cancelPenaltyLines([
    { from: "2026-10-29 18:00:00", amount: 120.5, currency: "EUR" },
    { from: "2026-10-01 00:00:00", amount: 0, currency: "EUR" },
  ]);
  assert.deepEqual(lines, [
    { from: "01.10.2026 00:00", amount: 0, currency: "EUR", free: true },
    { from: "29.10.2026 18:00", amount: 120.5, currency: "EUR", free: false },
  ]);
  assert.deepEqual(B.cancelPenaltyLines(undefined), []);
  assert.deepEqual(B.cancelPenaltyLines([]), []);
});

test("directCancelText: rimborsabile / non rimborsabile / nessun dato", () => {
  assert.match(B.directCancelText({ refundable: false, checkIn: "2026-10-30" })!, /Non rimborsabile/);
  assert.equal(
    B.directCancelText({ refundable: true, cancelDays: 5, checkIn: "2026-10-30" }),
    "Cancellazione gratuita fino a 5 giorni prima del check-in (entro il 25.10.2026)",
  );
  assert.match(B.directCancelText({ refundable: true, cancelDays: 1, checkIn: "2026-10-30" })!, /1 giorno prima/);
  assert.match(B.directCancelText({ refundable: true, cancelDays: 0, checkIn: "2026-10-30" })!, /giorno del check-in \(30\.10\.2026\)/);
  assert.equal(B.directCancelText({ refundable: true, checkIn: "2026-10-30" }), "Cancellazione gratuita");
  assert.equal(B.directCancelText({ checkIn: "2026-10-30" }), undefined);
});

test("nightRows: dettaglio solo con nightlyRates, subtotale ai centesimi", () => {
  const amountOf = (rates: Record<string, number>) => (d: string) => rates[d] ?? 0;
  const rates = { "2026-10-30": 100.1, "2026-10-31": 120.2 };
  const r = B.nightRows({ checkIn: "2026-10-30", checkOut: "2026-11-01", total: 220.3, nightlyRates: rates }, amountOf(rates));
  assert.equal(r.exact, true);
  assert.deepEqual(r.rows.map((x) => [x.label, x.amount]), [["ven 30.10.2026", 100.1], ["sab 31.10.2026", 120.2]]);
  assert.equal(r.subtotal, 220.3);
  const none = B.nightRows({ checkIn: "2026-10-30", checkOut: "2026-11-01", total: 200 }, () => 999);
  assert.deepEqual(none, { exact: false, rows: [], subtotal: 200 });
});

test("groupRooms: tutte le righe del gruppo nella stessa struttura, annullate escluse", () => {
  const mk = (id: string, o: Record<string, unknown> = {}) => ({ id, structureId: "S", groupId: "G", status: "confirmed", channel: "booking", ...o });
  const a = mk("a"), b = mk("b"), c = mk("c", { status: "cancelled" }), d = mk("d", { structureId: "T" }), e = mk("e", { groupId: "H" });
  assert.deepEqual(B.groupRooms(a, [a, b, c, d, e]).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(B.groupRooms(c, [a, b, c]).map((x) => x.id), ["a", "b", "c"]); // la camera aperta resta anche se annullata
  const solo = { id: "z", structureId: "S", status: "confirmed" };
  assert.deepEqual(B.groupRooms(solo, [a, solo]), [solo]);
});

test("guestNames: titolare + co-ospiti senza doppioni", () => {
  assert.deepEqual(B.guestNames({}, { fullName: "Mario Rossi" }), ["Mario Rossi"]);
  assert.deepEqual(
    B.guestNames({ primaryGuest: { firstName: "Mario", lastName: "Rossi" }, extraGuests: [{ firstName: "Anna", lastName: "Rossi" }, { firstName: "mario", lastName: "rossi" }] }, { fullName: "Mario Rossi" }),
    ["Mario Rossi", "Anna Rossi"],
  );
  assert.deepEqual(B.guestNames({}, null), []);
});

test("detectGenius: solo se il dato esiste", () => {
  assert.equal(B.detectGenius(["Quiet room please", undefined]), undefined);
  assert.equal(B.detectGenius(["Booker is a Genius member"]), "Genius Booker");
  assert.equal(B.detectGenius([undefined, "Genius level 2 discount"]), "Genius Booker · livello 2");
  assert.equal(B.detectGenius([]), undefined);
});

test("notesBlocks: testo intero, vuoti e doppioni esclusi, nota automatica nascosta", () => {
  assert.deepEqual(B.notesBlocks({}), []);
  const ota = "Late arrival\nQuiet room";
  assert.deepEqual(
    B.notesBlocks({ otaInfo: { notes: ota }, guestRequests: ota, note: "Prenotazione BOOKING via Channex · 12345" }),
    [{ key: "ota", text: ota }],
  );
  assert.deepEqual(
    B.notesBlocks({ otaInfo: { notes: ota }, guestRequests: "Culla per favore", note: "Cliente VIP" }),
    [{ key: "ota", text: ota }, { key: "note", text: "Cliente VIP" }, { key: "guest", text: "Culla per favore" }],
  );
  assert.deepEqual(B.notesBlocks({ note: "   " }), []);
});

test("channexIdOf e channelDisplay", () => {
  assert.equal(B.channexIdOf("channex:abc-123"), "abc-123");
  assert.equal(B.channexIdOf("octorate:xyz"), undefined);
  assert.equal(B.channexIdOf(undefined), undefined);
  assert.equal(B.channelDisplay({ extId: "channex:1", otaName: "BookingCom", channelLabel: "Booking.com", structureName: "Spigole Rooms" }), "BookingCom - Spigole Rooms");
  assert.equal(B.channelDisplay({ extId: "channex:1", channelLabel: "Booking.com", structureName: "Spigole Rooms" }), "Booking.com - Spigole Rooms");
  assert.equal(B.channelDisplay({ extId: "ical:1", channelLabel: "Airbnb", structureName: "X" }), "Airbnb");
});

test("countryName / languageName: codice → nome italiano, altrimenti testo com'è", () => {
  assert.equal(B.countryName("IT"), "Italia");
  assert.equal(B.countryName(""), "");
  assert.equal(B.countryName("Germania"), "Germania");
  assert.equal(B.languageName("en"), "inglese");
  assert.equal(B.languageName("Italiano"), "Italiano");
});

test("safeMailtoHref / safeTelHref: niente parametri iniettati dai dati OTA", () => {
  assert.equal(B.safeMailtoHref("mario@rossi.it"), "mailto:mario@rossi.it");
  assert.equal(B.safeMailtoHref(" a@b.it?bcc=x@y.it&body=ciao#z "), "mailto:a@b.itbcc=x@y.itbody=ciaoz");
  assert.ok(!B.safeMailtoHref("a@b.it?bcc=x@y.it")!.includes("?"));
  assert.ok(!B.safeMailtoHref("a@b.it&cc=x@y.it")!.includes("&"));
  assert.equal(B.safeMailtoHref("a b@c.it"), "mailto:ab@c.it");
  assert.equal(B.safeMailtoHref("  "), undefined);
  assert.equal(B.safeMailtoHref(undefined), undefined);
  assert.equal(B.safeTelHref("+39 333 1234567"), "tel:+393331234567");
  assert.equal(B.safeTelHref("333?x=1"), "tel:333x=1");
  assert.equal(B.safeTelHref(null), undefined);
});
