import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// ics.ts importa "./types" senza estensione: lo risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const { parseICS, toISO, toNum, toChannel, normName, makeUnitAssigner, importIcsEvents } = await import("../src/lib/ics.ts");

const cal = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//IT", ...events, "END:VCALENDAR"].join("\r\n");
const ev = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

// ───────────────────────── toISO / toNum / toChannel / normName ─────────────────────────
test("toISO: formati data comuni (ISO, gg/mm/aaaa, gg.mm.aa, gg-mm-aaaa)", () => {
  assert.equal(toISO("2026-09-24"), "2026-09-24");
  assert.equal(toISO("2026-09-24T14:30:00Z"), "2026-09-24");
  assert.equal(toISO("24/09/2026"), "2026-09-24");
  assert.equal(toISO("4/9/2026"), "2026-09-04");
  assert.equal(toISO("04.09.26"), "2026-09-04");
  assert.equal(toISO("4-9-2026"), "2026-09-04");
  assert.equal(toISO("  24/09/2026  "), "2026-09-24");
});

test("toISO: numero seriale Excel e date testuali in italiano", () => {
  assert.equal(toISO("46289"), "2026-09-24");
  assert.equal(toISO("46289.0"), "2026-09-24");
  assert.equal(toISO("24 settembre 2026"), "2026-09-24");
  assert.equal(toISO("mercoledì 24 settembre 2026"), "2026-09-24");
  assert.equal(toISO("3 gen 2027"), "2027-01-03");
  assert.equal(toISO("24-set-2026"), "2026-09-24");
});

test("toISO: vuoto o non riconoscibile = stringa vuota", () => {
  assert.equal(toISO(""), "");
  assert.equal(toISO("   "), "");
  assert.equal(toISO("boh"), "");
});

test("toISO: un numero corto (es. una camera '101' in una colonna sbagliata) non dovrebbe diventare una data", () => {
  assert.equal(toISO("123"), "");
  assert.equal(toISO("101"), "");
});

test("toNum: importi all'italiana e all'inglese semplice, simboli ignorati", () => {
  assert.equal(toNum("350"), 350);
  assert.equal(toNum("€ 350,50"), 350.5);
  assert.equal(toNum("1.234,56"), 1234.56);
  assert.equal(toNum("1.234"), 1234); // il punto seguito da 3 cifre e' il separatore delle migliaia
  assert.equal(toNum("12.5"), 12.5);
  assert.equal(toNum("-12,5"), -12.5);
  assert.equal(toNum("EUR 99"), 99);
  assert.equal(toNum(""), undefined);
  assert.equal(toNum("abc"), undefined);
});

test("toChannel: SUMMARY Octorate -> canale Xenora", () => {
  assert.equal(toChannel("booking_xml - Mario Rossi"), "booking");
  assert.equal(toChannel("Airbnb (Not available)"), "airbnb");
  assert.equal(toChannel("Expedia"), "expedia");
  assert.equal(toChannel("VRBO"), "expedia");
  assert.equal(toChannel("hotelBeds"), "hotelbeds");
  assert.equal(toChannel("Hotel Beds"), "hotelbeds");
  assert.equal(toChannel("Agoda"), "agoda");
  assert.equal(toChannel("Hostelworld"), "other");
  assert.equal(toChannel("octoevo"), "direct");
  assert.equal(toChannel("WuBook"), "direct");
  assert.equal(toChannel(""), "direct");
  assert.equal(toChannel("qualcosa di mai visto"), "direct");
});

test("normName: minuscolo, solo lettere e cifre, spazi singoli", () => {
  assert.equal(normName("  Camera  Doppia — Vista Mare! "), "camera doppia vista mare");
  assert.equal(normName(""), "");
});

// ───────────────────────── parseICS ─────────────────────────
test("parseICS: evento giornaliero (VALUE=DATE) -> check-in DTSTART, check-out DTEND + 1 giorno (convenzione Octorate)", () => {
  const [e] = parseICS(cal(ev("UID:abc-1@octorate", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260612", "SUMMARY:Mario Rossi | booking_xml", "LOCATION:Doppia")));
  assert.equal(e.uid, "abc-1@octorate");
  assert.equal(e.checkIn, "2026-06-10");
  assert.equal(e.checkOut, "2026-06-13");
  assert.equal(e.guest, "Mario Rossi");
  assert.equal(e.room, "Doppia");
  assert.equal(e.blocked, false);
});

test("parseICS: date con ora (UTC e locali) usano solo la parte data", () => {
  const evs = parseICS(cal(
    ev("UID:1", "DTSTART:20260610T140000Z", "DTEND:20260611T100000Z", "SUMMARY:Anna"),
    ev("UID:2", "DTSTART;TZID=Europe/Rome:20260620T150000", "DTEND;TZID=Europe/Rome:20260621T110000", "SUMMARY:Luca"),
  ));
  assert.deepEqual(evs.map((e) => [e.uid, e.checkIn, e.checkOut]), [["1", "2026-06-10", "2026-06-12"], ["2", "2026-06-20", "2026-06-22"]]);
});

test("parseICS: il 'Period' nella DESCRIPTION vince su DTSTART/DTEND (check-out reale)", () => {
  const [e] = parseICS(cal(ev("UID:p1", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260612", "SUMMARY:Mario Rossi", "DESCRIPTION:Period : 10/06/2026 - 13/06/2026\\nTotal: 350\\,50")));
  assert.equal(e.checkIn, "2026-06-10");
  assert.equal(e.checkOut, "2026-06-13");
  assert.equal(e.total, 350.5);
});

test("parseICS: passaggio di mese e di anno con DTEND + 1", () => {
  const evs = parseICS(cal(
    ev("UID:m", "DTSTART;VALUE=DATE:20260130", "DTEND;VALUE=DATE:20260131", "SUMMARY:A"),
    ev("UID:y", "DTSTART;VALUE=DATE:20261230", "DTEND;VALUE=DATE:20261231", "SUMMARY:B"),
    ev("UID:b", "DTSTART;VALUE=DATE:20280228", "DTEND;VALUE=DATE:20280228", "SUMMARY:C"), // 2028 bisestile
  ));
  assert.deepEqual(evs.map((e) => e.checkOut), ["2026-02-01", "2027-01-01", "2028-02-29"]);
});

test("parseICS: righe lunghe piegate (a capo + spazio o tab) vengono ricomposte", () => {
  const raw = [
    "BEGIN:VEVENT", "UID:fold-1", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611",
    "SUMMARY:Maria Grazia Del", " la Valle | booking_xml",
    "DESCRIPTION:Richiesta: arrivo tardi,", "\tcamera tranquilla",
    "END:VEVENT",
  ].join("\r\n");
  const [e] = parseICS(raw);
  assert.equal(e.guest, "Maria Grazia Della Valle");
  assert.ok(e.note.includes("camera tranquilla"));
});

test("parseICS: fine riga solo LF o solo CR funzionano come CRLF", () => {
  const body = ["BEGIN:VEVENT", "UID:x", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:Test", "END:VEVENT"];
  assert.equal(parseICS(body.join("\n")).length, 1);
  assert.equal(parseICS(body.join("\r")).length, 1);
});

test("parseICS: caratteri speciali con escape (virgola, punto e virgola, a capo, backslash)", () => {
  const [e] = parseICS(cal(ev("UID:s", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:Rossi\\, Mario | direct", "DESCRIPTION:Nota\\; con punto e virgola\\nseconda riga C:\\\\dati", "LOCATION:Suite\\, piano 2")));
  assert.equal(e.guest, "Rossi, Mario");
  assert.equal(e.note, "Nota; con punto e virgola seconda riga C:\\dati");
  assert.equal(e.room, "Suite, piano 2");
});

test("parseICS: caratteri accentati e unicode restano intatti", () => {
  const [e] = parseICS(cal(ev("UID:u", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:Zoë Müller-Çelik | airbnb")));
  assert.equal(e.guest, "Zoë Müller-Çelik");
});

test("parseICS: ospite dall'ORGANIZER CN se presente, altrimenti dal SUMMARY (fino al ' | ' o a ' Camera')", () => {
  const evs = parseICS(cal(
    ev("UID:o", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:Altro nome", "ORGANIZER;CN=Giulia Bianchi:mailto:g@example.com"),
    ev("UID:c", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:Paolo Verdi Camera 3 booking_xml"),
  ));
  assert.equal(evs[0].guest, "Giulia Bianchi");
  assert.equal(evs[1].guest, "Paolo Verdi");
});

test("parseICS: blocchi e manutenzioni (italiano e inglese) sono 'blocked' e senza nome ospite", () => {
  for (const summary of ["Airbnb (Not available)", "CLOSED - Not available", "Non disponibile", "Bloccato dal proprietario", "Out of order", "Fuori servizio", "Manutenzione bagno", "Unavailable"]) {
    const [e] = parseICS(cal(ev("UID:b", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", `SUMMARY:${summary}`)));
    assert.equal(e.blocked, true, summary);
    assert.equal(e.guest, "", summary);
  }
  const [ok] = parseICS(cal(ev("UID:n", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:Mario Rossi")));
  assert.equal(ok.blocked, false);
});

test("parseICS: totale e ospiti da DESCRIPTION/SUMMARY (formati '€ 1.234,56', 'Total', 'N pax')", () => {
  const evs = parseICS(cal(
    ev("UID:t1", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:A | 3 pax | € 1.234,56"),
    ev("UID:t2", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:B - €200"),
    ev("UID:t3", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:C"),
  ));
  assert.equal(evs[0].total, 1234.56);
  assert.equal(evs[0].adults, 3);
  assert.equal(evs[1].total, 200);
  assert.equal(evs[2].total, undefined);
  assert.equal(evs[2].adults, undefined);
});

test("parseICS: 'Total' nella DESCRIPTION con separatore delle migliaia mantiene i centesimi", () => {
  const [a] = parseICS(cal(ev("UID:a", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:A", "DESCRIPTION:Total: € 1.234\\,56")));
  assert.equal(a.total, 1234.56);
  const [b] = parseICS(cal(ev("UID:b", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY:B", "DESCRIPTION:Total: 1,234.56")));
  assert.equal(b.total, 1234.56);
});

test("parseICS: eventi senza date vengono scartati; con solo la data di inizio resta il check-out vuoto", () => {
  const evs = parseICS(cal(
    ev("UID:vuoto", "SUMMARY:Senza date"),
    ev("UID:solo-inizio", "DTSTART;VALUE=DATE:20260610", "SUMMARY:Solo inizio"),
  ));
  assert.equal(evs.length, 1);
  assert.equal(evs[0].checkIn, "2026-06-10");
  assert.equal(evs[0].checkOut, "");
});

test("parseICS: testo vuoto, senza VEVENT o spazzatura = nessun evento, senza errori", () => {
  assert.deepEqual(parseICS(""), []);
  assert.deepEqual(parseICS("BEGIN:VCALENDAR\r\nEND:VCALENDAR"), []);
  assert.deepEqual(parseICS("<html><body>404 Not Found</body></html>"), []);
});

test("parseICS: piu' eventi nello stesso file mantengono l'ordine e gli UID", () => {
  const evs = parseICS(cal(...Array.from({ length: 5 }, (_, i) => ev(`UID:e${i}`, `DTSTART;VALUE=DATE:2026061${i}`, `DTEND;VALUE=DATE:2026061${i}`, `SUMMARY:Ospite ${i}`))));
  assert.deepEqual(evs.map((e) => e.uid), ["e0", "e1", "e2", "e3", "e4"]);
});

test("parseICS: un evento con STATUS:CANCELLED non dovrebbe diventare una prenotazione", () => {
  const out = parseICS(cal(ev("UID:x", "STATUS:CANCELLED", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260612", "SUMMARY:Mario Rossi")));
  assert.equal(out.length === 0 || out[0].blocked === true, true);
});

test("parseICS: SUMMARY con parametri (es. SUMMARY;LANGUAGE=it:...) dovrebbe essere letto", () => {
  const [e] = parseICS(cal(ev("UID:l", "DTSTART;VALUE=DATE:20260610", "DTEND;VALUE=DATE:20260611", "SUMMARY;LANGUAGE=it:Mario Rossi")));
  assert.equal(e.guest, "Mario Rossi");
});

// ───────────────────────── makeUnitAssigner ─────────────────────────
const U = (id: string, roomTypeId = "rt1", structureId = "S") => ({ id, roomTypeId, structureId, name: id });
const B = (o: Record<string, unknown>) => ({ id: "b?", structureId: "S", status: "confirmed", ...o });
const noAdd = () => { throw new Error("non doveva creare camere"); };
const T = (s: string) => s;

test("makeUnitAssigner: riusa la prima camera libera e impila le prenotazioni (bin-packing)", () => {
  const assign = makeUnitAssigner([U("u1"), U("u2")] as never, [], "S");
  assert.equal(assign("rt1", "2026-06-10", "2026-06-12", noAdd, T), "u1");
  assert.equal(assign("rt1", "2026-06-11", "2026-06-13", noAdd, T), "u2"); // si sovrappone alla prima
  assert.equal(assign("rt1", "2026-06-12", "2026-06-14", noAdd, T), "u1"); // check-out = check-in: u1 e' di nuovo libera
});

test("makeUnitAssigner: tutte occupate -> null (overbooking, nessuna camera fantasma)", () => {
  const assign = makeUnitAssigner([U("u1")] as never, [], "S");
  assert.equal(assign("rt1", "2026-06-10", "2026-06-12", noAdd, T), "u1");
  assert.equal(assign("rt1", "2026-06-11", "2026-06-13", noAdd, T), null);
});

test("makeUnitAssigner: tipologia senza camere -> ne crea una sola 'Camera 1' e poi la riusa", () => {
  const created: unknown[] = [];
  const add = (u: unknown) => { created.push(u); return "nuova-1"; };
  const assign = makeUnitAssigner([], [], "S");
  assert.equal(assign("rt9", "2026-06-10", "2026-06-12", add, T), "nuova-1");
  assert.equal(assign("rt9", "2026-06-12", "2026-06-14", add, T), "nuova-1");
  assert.equal(assign("rt9", "2026-06-11", "2026-06-13", add, T), null); // sovrapposta e ormai esiste una camera
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], { structureId: "S", roomTypeId: "rt9", name: "Camera 1" });
});

test("makeUnitAssigner: considera le prenotazioni esistenti (ma non le cancellate ne' quelle escluse) e solo la struttura giusta", () => {
  const units = [U("u1"), U("u2"), U("x1", "rt1", "ALTRA")] as never;
  const bookings = [
    B({ id: "b1", unitId: "u1", checkIn: "2026-06-10", checkOut: "2026-06-15" }),
    B({ id: "b2", unitId: "u2", checkIn: "2026-06-10", checkOut: "2026-06-15", status: "cancelled" }),
  ] as never;
  assert.equal(makeUnitAssigner(units, bookings, "S")("rt1", "2026-06-11", "2026-06-13", noAdd, T), "u2");
  assert.equal(makeUnitAssigner(units, bookings, "S", new Set(["b1"]))("rt1", "2026-06-11", "2026-06-13", noAdd, T), "u1");
  assert.equal(makeUnitAssigner(units, bookings, "ALTRA")("rt1", "2026-06-11", "2026-06-13", noAdd, T), "x1");
});

test("makeUnitAssigner: funziona anche con prenotazioni in ordine sparso", () => {
  const assign = makeUnitAssigner([U("u1"), U("u2")] as never, [], "S");
  assert.equal(assign("rt1", "2026-08-01", "2026-08-05", noAdd, T), "u1");
  assert.equal(assign("rt1", "2026-06-01", "2026-06-05", noAdd, T), "u1"); // prima nel tempo, stessa camera libera in quelle date
  assert.equal(assign("rt1", "2026-08-03", "2026-08-04", noAdd, T), "u2");
});

// ───────────────────────── importIcsEvents ─────────────────────────
function mkCtx(init: { bookings?: any[]; units?: any[]; roomTypes?: any[] } = {}) {
  const st = { bookings: [...(init.bookings ?? [])] as any[], units: [...(init.units ?? [])] as any[], roomTypes: [...(init.roomTypes ?? [])] as any[], guests: [] as any[], deleted: [] as string[], updated: [] as { id: string; patch: any }[] };
  let n = 0;
  const ctx = {
    get bookings() { return st.bookings; }, get units() { return st.units; }, get roomTypes() { return st.roomTypes; },
    addGuest: (g: { fullName?: string }) => { st.guests.push(g); return `g${st.guests.length}`; },
    addBooking: (b: any) => { st.bookings.push({ id: `nb${++n}`, ...b }); },
    updateBooking: (id: string, patch: any) => { st.updated.push({ id, patch }); const b = st.bookings.find((x) => x.id === id); if (b) Object.assign(b, patch); },
    deleteBooking: (id: string) => { st.deleted.push(id); st.bookings = st.bookings.filter((b) => b.id !== id); },
    addRoomType: (rt: any) => { const id = `rt-new${st.roomTypes.length + 1}`; st.roomTypes.push({ id, ...rt }); return id; },
    addUnit: (u: any) => { const id = `u-new${st.units.length + 1}`; st.units.push({ id, ...u }); return id; },
    t: (s: string) => s,
  };
  return { st, ctx: ctx as never };
}
const E = (o: Record<string, unknown> = {}) => ({ uid: "uid-1", guest: "Mario Rossi", checkIn: "2026-06-10", checkOut: "2026-06-13", blocked: false, channelText: "booking_xml", note: "Nota", room: "Doppia", ...o });
const RT = { id: "rt1", structureId: "S", name: "Doppia", beds: 2, basePrice: 100 };

test("importIcsEvents: prenotazione nuova -> ospite, canale, camera assegnata, nota 'Importato da ICS'", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1")] });
  const r = importIcsEvents([E({ total: 300, adults: 3 })] as never, { structureId: "S" }, ctx);
  assert.deepEqual(r, { created: 1, updated: 0 });
  const b = st.bookings[0];
  assert.equal(b.roomTypeId, "rt1"); assert.equal(b.unitId, "u1"); assert.equal(b.channel, "booking");
  assert.equal(b.adults, 3); assert.equal(b.total, 300); assert.equal(b.extId, "uid-1"); assert.equal(b.status, "confirmed");
  assert.equal(b.note, "Importato da ICS · Nota");
  assert.equal(st.guests[0].fullName, "Mario Rossi");
});

test("importIcsEvents: idempotente per UID -> la seconda volta aggiorna, non duplica, e non tocca la camera assegnata a mano", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1"), U("u2")] });
  importIcsEvents([E()] as never, { structureId: "S" }, ctx);
  st.bookings[0].unitId = "u2"; // il gestore sposta la prenotazione
  const r = importIcsEvents([E({ checkOut: "2026-06-14", total: 450 })] as never, { structureId: "S" }, ctx);
  assert.deepEqual(r, { created: 0, updated: 1 });
  assert.equal(st.bookings.length, 1);
  assert.equal(st.bookings[0].unitId, "u2");
  assert.equal(st.bookings[0].checkOut, "2026-06-14");
  assert.equal(st.bookings[0].total, 450);
});

test("importIcsEvents: eventi a 0 notti, senza date o con date invertite vengono scartati; il resto e' ordinato per check-in", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1"), U("u2")] });
  const r = importIcsEvents([
    E({ uid: "z", checkIn: "2026-07-01", checkOut: "2026-07-03" }), E({ uid: "zero", checkIn: "2026-06-10", checkOut: "2026-06-10" }),
    E({ uid: "inv", checkIn: "2026-06-12", checkOut: "2026-06-10" }), E({ uid: "vuoto", checkIn: "", checkOut: "" }),
    E({ uid: "a", checkIn: "2026-06-01", checkOut: "2026-06-03" }),
  ] as never, { structureId: "S" }, ctx);
  assert.equal(r.created, 2);
  assert.deepEqual(st.bookings.map((b) => b.extId), ["a", "z"]);
});

test("importIcsEvents: i blocchi sono esclusi di default; con includeBlocked diventano canale 'blocked' con nome 'Non disponibile'", () => {
  const blk = E({ uid: "blk", blocked: true, guest: "", channelText: "Not available" });
  const a = mkCtx({ roomTypes: [RT], units: [U("u1")] });
  assert.equal(importIcsEvents([blk] as never, { structureId: "S" }, a.ctx).created, 0);
  const b = mkCtx({ roomTypes: [RT], units: [U("u1")] });
  assert.equal(importIcsEvents([blk] as never, { structureId: "S", includeBlocked: true }, b.ctx).created, 1);
  assert.equal(b.st.bookings[0].channel, "blocked");
  assert.equal(b.st.guests[0].fullName, "Non disponibile");
});

test("importIcsEvents: ospite senza nome = 'Ospite (da ICS)'; adulti arrotondati e mai sotto 1; default 2", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1"), U("u2"), U("u3")] });
  importIcsEvents([E({ uid: "1", guest: "", adults: 2.6 }), E({ uid: "2", adults: 0 }), E({ uid: "3", adults: undefined })] as never, { structureId: "S" }, ctx);
  assert.equal(st.guests[0].fullName, "Ospite (da ICS)");
  assert.deepEqual(st.bookings.map((b) => b.adults), [3, 1, 2]);
});

test("importIcsEvents: nota troncata a 280 caratteri", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1")] });
  importIcsEvents([E({ note: "x".repeat(1000) })] as never, { structureId: "S" }, ctx);
  assert.equal(st.bookings[0].note.length, 280);
});

test("importIcsEvents: tipologia abbinata per nome (anche parziale); se manca viene creata con posti letto dai pax", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT, { id: "rt2", structureId: "S", name: "Suite Vista Mare", beds: 2, basePrice: 200 }], units: [U("u1", "rt1"), U("u2", "rt2")] });
  importIcsEvents([
    E({ uid: "1", room: "doppia" }), E({ uid: "2", room: "Suite", checkIn: "2026-07-01", checkOut: "2026-07-03" }),
    E({ uid: "3", room: "Loft Nuovo", adults: 4, checkIn: "2026-08-01", checkOut: "2026-08-03" }),
  ] as never, { structureId: "S" }, ctx);
  assert.equal(st.bookings[0].roomTypeId, "rt1");
  assert.equal(st.bookings[1].roomTypeId, "rt2");
  const nuovo = st.roomTypes.find((r) => r.name === "Loft Nuovo");
  assert.ok(nuovo);
  assert.equal(nuovo.beds, 4);
  assert.equal(st.bookings[2].roomTypeId, nuovo.id);
  assert.ok(st.units.some((u) => u.roomTypeId === nuovo.id)); // e' stata creata anche la camera
});

test("importIcsEvents: roomMap esplicita e '__new__'", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1")] });
  importIcsEvents([E({ uid: "1", room: "Stanza A" }), E({ uid: "2", room: "Stanza B", checkIn: "2026-07-01", checkOut: "2026-07-02" })] as never, { structureId: "S", roomMap: { "Stanza A": "rt1", "Stanza B": "__new__" } }, ctx);
  assert.equal(st.bookings[0].roomTypeId, "rt1");
  assert.ok(st.roomTypes.some((r) => r.name === "Stanza B"));
});

test("importIcsEvents: overbooking -> prenotazione importata SENZA camera (unitId null), non una camera inventata", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1")] });
  importIcsEvents([E({ uid: "1" }), E({ uid: "2", guest: "Anna" })] as never, { structureId: "S" }, ctx);
  assert.equal(st.bookings[0].unitId, "u1");
  assert.equal(st.bookings[1].unitId, null);
  assert.equal(st.units.length, 1);
});

test("importIcsEvents: camera specifica (targetUnit) forza tipologia e camera, anche in aggiornamento", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1"), U("u2")] });
  importIcsEvents([E()] as never, { structureId: "S", targetUnit: "u2" }, ctx);
  assert.equal(st.bookings[0].unitId, "u2");
  st.bookings[0].unitId = "u1";
  importIcsEvents([E({ checkOut: "2026-06-14" })] as never, { structureId: "S", targetUnit: "u2" }, ctx);
  assert.equal(st.bookings[0].unitId, "u2");
});

test("importIcsEvents con replacePrev: sostituisce SOLO le importazioni da file, mai Channex/sito/Stripe/Octorate ne' le prenotazioni manuali", () => {
  const old = (id: string, extra: Record<string, unknown>) => B({ id, unitId: "u1", checkIn: "2026-01-01", checkOut: "2026-01-02", note: "Importato da ICS · x", ...extra });
  const { st, ctx } = mkCtx({
    roomTypes: [RT], units: [U("u1")],
    bookings: [
      old("file", { extId: "uid-vecchio" }), old("channex", { extId: "channex:1" }), old("sito", { extId: "site:a:b" }),
      old("stripe", { extId: "stripe:1" }), old("octo", { extId: "octorate:1" }), old("manuale", { note: "Prenotazione telefonica" }),
      old("altra-struttura", { structureId: "ALTRA", extId: "uid-x" }),
    ] as never,
  });
  importIcsEvents([E({ uid: "nuovo" })] as never, { structureId: "S", replacePrev: true }, ctx);
  assert.deepEqual(st.deleted, ["file"]);
  assert.ok(st.bookings.some((b) => b.extId === "nuovo"));
  assert.equal(st.bookings.length, 7); // 7 - 1 eliminata + 1 nuova
});

test("importIcsEvents con replacePrev: dopo la sostituzione la camera liberata e' di nuovo disponibile", () => {
  const old = B({ id: "file", unitId: "u1", checkIn: "2026-06-10", checkOut: "2026-06-13", note: "Importato da ICS", extId: "uid-vecchio" });
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1")], bookings: [old] as never });
  importIcsEvents([E()] as never, { structureId: "S", replacePrev: true }, ctx);
  assert.equal(st.bookings[0].unitId, "u1");
});

test("importIcsEvents: etichetta di provenienza personalizzata nella nota", () => {
  const { st, ctx } = mkCtx({ roomTypes: [RT], units: [U("u1")] });
  importIcsEvents([E({ note: "" })] as never, { structureId: "S", source: "CSV" }, ctx);
  assert.equal(st.bookings[0].note, "Importato da CSV");
});
