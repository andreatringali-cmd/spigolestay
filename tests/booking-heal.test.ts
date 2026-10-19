import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const H = await import("../src/lib/booking-heal.ts");
const { healRoundedTotals, healDuplicates, needsChannexCheck, reconcilePatches, mergePatches, applyPatches, findOctorateTwins, twinFillPatch, duplicatePatch } = H;

let n = 0;
const bk = (o: Record<string, unknown> = {}): any => ({
  id: `b${++n}`, structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", guestId: "g1", channel: "booking", status: "confirmed",
  checkIn: "2026-10-20", checkOut: "2026-10-23", adults: 2, children: 0, extId: "channex:C1", code: "4812345678", total: 346, paid: 0, ...o,
});
const apply = (list: any[], patches: any[]) => applyPatches(list, patches);

// ── a) totali con i centesimi ──
test("totali: Booking da Channex con totale intero e incassato con i centesimi (< 1 €) → totale = incassato", () => {
  const b = bk({ total: 346, paid: 346.6 });
  assert.deepEqual(healRoundedTotals([b]), [{ id: b.id, patch: { total: 346.6 } }]);
});
test("totali: incassato 0, distante 1 € o più, già uguale, annullata, altro canale/origine → nessuna patch", () => {
  assert.deepEqual(healRoundedTotals([bk({ total: 346, paid: 0 })]), []);
  assert.deepEqual(healRoundedTotals([bk({ total: 346, paid: 347 })]), []);   // distanza esatta 1 €
  assert.deepEqual(healRoundedTotals([bk({ total: 346, paid: 340.6 })]), []);  // più lontano
  assert.deepEqual(healRoundedTotals([bk({ total: 346.6, paid: 346.6 })]), []);
  assert.deepEqual(healRoundedTotals([bk({ total: 346, paid: 346.6, status: "cancelled" })]), []);
  assert.deepEqual(healRoundedTotals([bk({ total: 346, paid: 346.6, channel: "airbnb" })]), []);
  assert.deepEqual(healRoundedTotals([bk({ total: 346, paid: 346.6, extId: "octorate:9" })]), []);
  assert.deepEqual(healRoundedTotals([bk({ total: undefined, paid: 346.6 })]), []);
  assert.deepEqual(healRoundedTotals([bk({ total: 346.5, paid: 346.6 })]), []); // il totale ha già i centesimi: non si tocca
});
test("totali: idempotente", () => {
  const list = [bk({ total: 346, paid: 346.6 })];
  assert.deepEqual(healRoundedTotals(apply(list, healRoundedTotals(list))), []);
});

// ── b) doppioni Octorate / Channex ──
const pair = (c: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => {
  const chx = bk({ id: "C", extId: "channex:C1", total: 346, paid: 0, unitId: null, ...c });
  const oct = bk({ id: "O", extId: "octorate:77", total: 346.6, paid: 346.6, commissionAmount: 51.99, unitId: "u2", note: "Importato da Octorate · arrivo alle 22", ...o });
  return [chx, oct];
};
const byId = (patches: any[], id: string) => patches.find((p: any) => p.id === id)?.patch;

test("doppioni: la riga Channex riceve commissione, incassato, totale esatto, camera e nota; l'Octorate è annullata (non cancellata)", () => {
  const list = pair();
  const p = healDuplicates(list);
  const c = byId(p, "C"), o = byId(p, "O");
  assert.equal(c.commissionAmount, 51.99);
  assert.equal(c.paid, 346.6);
  assert.equal(c.total, 346.6);
  assert.equal(c.unitId, "u2");
  assert.match(c.note, /arrivo alle 22/);
  assert.doesNotMatch(c.note, /Importato da Octorate/);
  assert.equal(o.status, "cancelled");
  assert.match(o.note, /^Duplicato \(Octorate\) di 4812345678: unito alla prenotazione Channex/);
  assert.equal(p.length, 2);
});
test("doppioni: idempotente (seconda esecuzione = nessuna patch)", () => {
  const list = pair();
  const after = apply(list, healDuplicates(list));
  assert.deepEqual(healDuplicates(after), []);
  assert.equal(after.find((b: any) => b.id === "O").status, "cancelled");
});
test("doppioni: la commissione già presente sulla Channex NON viene sovrascritta; incassato = il maggiore, mai la somma", () => {
  const p = healDuplicates(pair({ commissionAmount: 40, paid: 100 }, { paid: 346.6 }));
  assert.equal(byId(p, "C").commissionAmount, undefined);
  assert.equal(byId(p, "C").paid, 346.6);
  const p2 = healDuplicates(pair({ paid: 500 }, { paid: 346.6 }));
  assert.equal(byId(p2, "C")?.paid, undefined);
});
test("doppioni: se la Channex ha già una camera la tiene (mai spostata)", () => {
  const p = healDuplicates(pair({ unitId: "u1" }));
  assert.equal(byId(p, "C").unitId, undefined);
});
test("doppioni: camere DIVERSE ed entrambe occupate da altre prenotazioni → ambiguo, nessuna patch", () => {
  const [c, o] = pair({ unitId: "u1" }, { unitId: "u2" });
  const third1 = bk({ id: "T1", extId: "site:1", code: "X1", unitId: "u1" });
  const third2 = bk({ id: "T2", extId: "site:2", code: "X2", unitId: "u2" });
  assert.deepEqual(healDuplicates([c, o, third1, third2]), []);
  assert.deepEqual(healDuplicates([c, o, third1]), []); // basta una delle due occupata
  assert.equal(healDuplicates([c, o]).length, 2);       // libere entrambe: si procede
  // un'altra prenotazione ANNULLATA sulla stessa camera non conta
  assert.equal(healDuplicates([c, o, { ...third1, status: "cancelled" }]).length, 2);
});
test("doppioni: la camera dell'Octorate non si porta sulla Channex se occupata da altri", () => {
  const [c, o] = pair({ unitId: null }, { unitId: "u2" });
  const p = healDuplicates([c, o, bk({ id: "T2", extId: "site:2", code: "X2", unitId: "u2" })]);
  assert.equal(byId(p, "C")?.unitId, undefined);
  assert.equal(byId(p, "O").status, "cancelled");
});
test("doppioni: date, struttura, canale o codice diversi → non sono la stessa prenotazione", () => {
  assert.deepEqual(healDuplicates(pair({}, { checkOut: "2026-10-24" })), []);
  assert.deepEqual(healDuplicates(pair({}, { structureId: "st-2" })), []);
  assert.deepEqual(healDuplicates(pair({}, { channel: "airbnb" })), []);
  assert.deepEqual(healDuplicates(pair({}, { code: "999" })), []);
  assert.deepEqual(healDuplicates(pair({ code: undefined }, { code: undefined })), []);
});
test("doppioni: righe già annullate o numero di righe diverso (ambiguo) → nessuna patch", () => {
  assert.deepEqual(healDuplicates(pair({}, { status: "cancelled" })), []);
  assert.deepEqual(healDuplicates(pair({ status: "cancelled" })), []);
  const [c, o] = pair();
  const o2 = { ...o, id: "O2", extId: "octorate:78" };
  assert.deepEqual(healDuplicates([c, o, o2]), []);
});
test("doppioni: prenotazione a più camere → coppie abbinate per tipologia", () => {
  const c1 = bk({ id: "C1", extId: "channex:C1", roomTypeId: "rt-a", unitId: null, total: 100 });
  const c2 = bk({ id: "C2", extId: "channex:C1", roomTypeId: "rt-b", unitId: null, total: 200 });
  const o1 = bk({ id: "O1", extId: "octorate:1", roomTypeId: "rt-b", unitId: "ub", paid: 200, total: 200 });
  const o2 = bk({ id: "O2", extId: "octorate:2", roomTypeId: "rt-a", unitId: "ua", paid: 100, total: 100 });
  const p = healDuplicates([c1, c2, o1, o2]);
  assert.equal(byId(p, "C1").unitId, "ua"); assert.equal(byId(p, "C1").paid, 100);
  assert.equal(byId(p, "C2").unitId, "ub"); assert.equal(byId(p, "C2").paid, 200);
  assert.equal(byId(p, "O1").status, "cancelled"); assert.equal(byId(p, "O2").status, "cancelled");
  // tipologie non abbinabili → ambiguo
  const o3 = { ...o2, roomTypeId: "rt-z" };
  assert.deepEqual(healDuplicates([c1, c2, o1, o3]), []);
});
test("doppioni: righe di altri tipi (iCal, manuali) non entrano mai", () => {
  assert.deepEqual(healDuplicates(pair({}, { extId: "ical:abc" })), []);
  assert.deepEqual(healDuplicates(pair({ extId: undefined })), []);
});
test("duplicatePatch: non duplica la nota se già segnata; findOctorateTwins trova solo righe Octorate attive con stesse date", () => {
  const first = duplicatePatch({ note: "x" }, "123");
  assert.equal(duplicatePatch({ note: first.note }, "123").note, first.note);
  const [c, o] = pair();
  const list = [c, o, { ...o, id: "O3", extId: "octorate:3", checkIn: "2026-11-01" }, { ...o, id: "O4", extId: "octorate:4", status: "cancelled" }];
  assert.deepEqual(findOctorateTwins(list, { structureId: "st-1", code: "4812345678", channel: "booking", ranges: [{ ci: "2026-10-20", co: "2026-10-23" }] }), [1]);
  assert.deepEqual(findOctorateTwins(list, { structureId: "st-1", code: "", channel: "booking", ranges: [{ ci: "2026-10-20", co: "2026-10-23" }] }), []);
});
test("twinFillPatch: riempie solo i campi vuoti", () => {
  const out = twinFillPatch({ cleaningFee: 0, arrivalTime: "18:00", paid: 0 }, { cleaningFee: 30, arrivalTime: "22:00", cityTaxPaid: true, paid: 50, extras: [{ name: "x", price: 1 }] });
  assert.deepEqual(out, { paid: 50, cleaningFee: 30, cityTaxPaid: true, extras: [{ name: "x", price: 1 }] });
});

test("twinFillPatch: il consenso privacy del check-in (quando/da chi) si porta dalla gemella se manca", () => {
  const out = twinFillPatch({}, { privacyConsentAt: "2026-10-10T08:00:00.000Z", privacyConsentBy: "operator" });
  assert.deepEqual(out, { privacyConsentAt: "2026-10-10T08:00:00.000Z", privacyConsentBy: "operator" });
});

// ── c) quali prenotazioni rileggere / patch da Channex ──
const today = "2026-10-16";
const T0 = Date.UTC(2026, 9, 16, 12);
test("needsChannexCheck: Booking da Channex da 30 giorni fa in avanti, senza commissione o con totale intero; prima senza commissione", () => {
  const list = [
    bk({ id: "1", extId: "channex:A", commissionAmount: 10, total: 346.6, checkOut: "2026-12-01" }),                 // tutto a posto: no
    bk({ id: "2", extId: "channex:B", commissionAmount: undefined, total: 346.6, checkOut: "2026-12-05" }),          // senza commissione
    bk({ id: "3", extId: "channex:C", commissionAmount: 10, total: 400, checkOut: "2026-11-01" }),                   // totale intero, ha commissione
    bk({ id: "4", extId: "channex:D", commissionAmount: undefined, checkOut: "2026-09-01" }),                        // troppo vecchia (check-out prima di 30 gg fa)
    bk({ id: "5", extId: "channex:E", commissionAmount: undefined, checkOut: "2026-10-01" }),                        // 15 gg fa: ok
    bk({ id: "6", extId: "octorate:9", commissionAmount: undefined, checkOut: "2026-12-01" }),                       // non Channex
    bk({ id: "7", extId: "channex:G", commissionAmount: undefined, checkOut: "2026-12-01", status: "cancelled" }),
    bk({ id: "8", extId: "channex:H", commissionAmount: undefined, checkOut: "2026-12-01", channel: "airbnb" }),
  ];
  assert.deepEqual(needsChannexCheck(list, today, {}, T0), ["E", "B", "C"]);
  assert.deepEqual(needsChannexCheck(list, today, {}, T0, 2), ["E", "B"]);
});
test("needsChannexCheck: ricorda l'esito per 24 ore", () => {
  const list = [bk({ extId: "channex:B", commissionAmount: undefined, checkOut: "2026-12-05" })];
  assert.deepEqual(needsChannexCheck(list, today, { B: T0 - 3 * 3600_000 }, T0), []);
  assert.deepEqual(needsChannexCheck(list, today, { B: T0 - 25 * 3600_000 }, T0), ["B"]);
});

const res = (o: any = {}) => ({ id: "C1", ok: true, status: "modified", rooms: [{ checkIn: "2026-10-20", checkOut: "2026-10-23", total: 346.6, commissionAmount: 51.99, paymentFee: 5.2 }], ...o });
test("reconcilePatches: commissione, costo d'incasso e totale con i centesimi", () => {
  const b = bk({ id: "X", total: 346 });
  assert.deepEqual(reconcilePatches([b], [res()]), [{ id: "X", patch: { commissionAmount: 51.99, paymentFee: 5.2, total: 346.6 } }]);
});
test("reconcilePatches: non sovrascrive cifre esistenti, non cambia totali lontani o già con i centesimi", () => {
  assert.deepEqual(reconcilePatches([bk({ id: "X", total: 346.6, commissionAmount: 40, paymentFee: 1 })], [res()]), []);
  assert.deepEqual(reconcilePatches([bk({ id: "X", total: 300, commissionAmount: 40, paymentFee: 1 })], [res()]), []); // 300 vs 346,6: troppo distante
  assert.deepEqual(reconcilePatches([bk({ id: "X", total: undefined, commissionAmount: 40, paymentFee: 1 })], [res()]), [{ id: "X", patch: { total: 346.6 } }]);
});
test("reconcilePatches: nessuna commissione da Channex → nessuna scrittura per quel campo; cancellata/errore/righe diverse → nulla", () => {
  const b = bk({ id: "X", total: 346.6 });
  assert.deepEqual(reconcilePatches([b], [res({ rooms: [{ checkIn: "2026-10-20", checkOut: "2026-10-23", total: 346.6 }] })]), []);
  assert.deepEqual(reconcilePatches([b], [res({ status: "cancelled" })]), []);
  assert.deepEqual(reconcilePatches([b], [res({ ok: false, error: "x", rooms: undefined })]), []);
  assert.deepEqual(reconcilePatches([bk({ id: "X", checkOut: "2026-10-25" })], [res()]), []);              // date diverse
  assert.deepEqual(reconcilePatches([b, bk({ id: "Y" })], [res()]), []);                                     // 2 righe, 1 camera
});
test("reconcilePatches: più camere abbinate per ordine e date; idempotente", () => {
  const r1 = bk({ id: "R1", total: 100, checkIn: "2026-10-20", checkOut: "2026-10-23" });
  const r2 = bk({ id: "R2", total: 200, checkIn: "2026-10-21", checkOut: "2026-10-23" });
  const rr = res({ rooms: [
    { checkIn: "2026-10-20", checkOut: "2026-10-23", total: 100.4, commissionAmount: 10 },
    { checkIn: "2026-10-21", checkOut: "2026-10-23", total: 200, commissionAmount: 20 },
  ] });
  const p = reconcilePatches([r1, r2], [rr]);
  assert.deepEqual(p, [{ id: "R1", patch: { commissionAmount: 10, total: 100.4 } }, { id: "R2", patch: { commissionAmount: 20 } }]);
  assert.deepEqual(reconcilePatches(apply([r1, r2], p), [rr]), []);
});
test("mergePatches somma i campi per id", () => {
  assert.deepEqual(mergePatches([{ id: "a", patch: { total: 1 } }], [{ id: "a", patch: { paid: 2 } }, { id: "b", patch: { paid: 3 } }]),
    [{ id: "a", patch: { total: 1, paid: 2 } }, { id: "b", patch: { paid: 3 } }]);
});

// ── totale dalla somma delle notti (qualsiasi canale Channex) ──
test("healTotalsFromNights: Expedia 381 → 381,40 dalle 5 notti da 76,28", () => {
  const { healTotalsFromNights } = H;
  const rates = { "2026-10-21": 76.28, "2026-10-22": 76.28, "2026-10-23": 76.28, "2026-10-24": 76.28, "2026-10-25": 76.28 };
  const b = bk({ channel: "expedia", checkIn: "2026-10-21", checkOut: "2026-10-26", total: 381, nightlyRates: rates });
  assert.deepEqual(healTotalsFromNights([b]), [{ id: b.id, patch: { total: 381.4 } }]);
});
test("healTotalsFromNights: non tocca totali già esatti, differenze ≥ 1 €, notti mancanti, annullate, non Channex", () => {
  const { healTotalsFromNights } = H;
  const r = { "2026-10-21": 76.28, "2026-10-22": 76.28 };
  const base = { channel: "expedia", checkIn: "2026-10-21", checkOut: "2026-10-23", nightlyRates: r };
  assert.deepEqual(healTotalsFromNights([bk({ ...base, total: 152.56 })]), []);        // già esatto
  assert.deepEqual(healTotalsFromNights([bk({ ...base, total: 150 })]), []);           // differenza ≥ 1 €
  assert.deepEqual(healTotalsFromNights([bk({ ...base, total: 153, checkOut: "2026-10-24" })]), []); // notte senza prezzo
  assert.deepEqual(healTotalsFromNights([bk({ ...base, total: 153, status: "cancelled" })]), []);
  assert.deepEqual(healTotalsFromNights([bk({ ...base, total: 153, extId: "octorate:1" })]), []);
});
