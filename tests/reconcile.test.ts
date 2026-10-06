import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyOutcomes, skipReasons, outcomesToCsv, type ImportOutcome, type VerifyBooking } from "../src/lib/import/reconcile.ts";

const o = (row: number, guest: string, ci: string, co: string, status: ImportOutcome["status"], extra: Partial<ImportOutcome> = {}): ImportOutcome =>
  ({ row, guest, checkIn: ci, checkOut: co, room: "Deluxe", code: "", status, ...extra });

test("verifica per identificativo: tutte trovate, importi che tornano", () => {
  const outcomes = [o(2, "Dajnowska Martyna", "2026-10-09", "2026-10-10", "nuova", { extId: "octorate:1", total: 76.3 }), o(3, "Dajnowska Martyna", "2026-10-09", "2026-10-10", "nuova", { extId: "octorate:2", total: 68.6 })];
  const bks: VerifyBooking[] = [
    { extId: "octorate:1", guestName: "Dajnowska Martyna", checkIn: "2026-10-09", checkOut: "2026-10-10", total: 76.3 },
    { extId: "octorate:2", guestName: "Dajnowska Martyna", checkIn: "2026-10-09", checkOut: "2026-10-10", total: 68.6 },
  ];
  const v = verifyOutcomes(outcomes, bks);
  assert.equal(v.expected, 2); assert.equal(v.found, 2); assert.equal(v.missing.length, 0);
  assert.equal(Math.round(v.fileTotal * 100), Math.round(v.systemTotal * 100));
  assert.equal(v.amountDiffs.length, 0);
});

test("verifica: una riga mancante e un importo diverso vengono segnalati", () => {
  const outcomes = [o(2, "A Rossi", "2026-10-09", "2026-10-10", "nuova", { extId: "x:1", total: 100 }), o(3, "B Verdi", "2026-10-11", "2026-10-12", "gia_presente", { extId: "x:2", total: 50 }), o(4, "C Neri", "2026-10-13", "2026-10-14", "nuova", { extId: "x:3", total: 10 })];
  const bks: VerifyBooking[] = [
    { extId: "x:1", guestName: "A Rossi", checkIn: "2026-10-09", checkOut: "2026-10-10", total: 90 },   // importo diverso
    { extId: "x:2", guestName: "B Verdi", checkIn: "2026-10-11", checkOut: "2026-10-12", total: 50 },
  ];                                                                                                     // x:3 manca
  const v = verifyOutcomes(outcomes, bks);
  assert.equal(v.found, 2); assert.equal(v.missing.length, 1); assert.equal(v.missing[0].row, 4);
  assert.equal(v.amountDiffs.length, 1); assert.equal(v.amountDiffs[0].system, 90);
});

test("senza identificativo: ospite+date contando le copie (più camere, stesso ospite)", () => {
  const outcomes = [o(2, "Papo", "2026-10-09", "2026-10-10", "nuova"), o(3, "papo", "2026-10-09", "2026-10-10", "nuova")];
  assert.equal(verifyOutcomes(outcomes, [{ guestName: "Papo", checkIn: "2026-10-09", checkOut: "2026-10-10" }]).missing.length, 1); // ne serve una per riga
  assert.equal(verifyOutcomes(outcomes, [{ guestName: "Papo", checkIn: "2026-10-09", checkOut: "2026-10-10" }, { guestName: "PAPO", checkIn: "2026-10-09", checkOut: "2026-10-10" }]).missing.length, 0);
});

test("le righe scartate non sono 'attese' e i motivi si contano", () => {
  const outcomes = [o(2, "", "", "", "scartata", { reason: "nome mancante" }), o(3, "X Y", "", "", "scartata", { reason: "date non riconosciute" }), o(4, "Z", "", "", "scartata", { reason: "nome mancante" })];
  assert.equal(verifyOutcomes(outcomes, []).expected, 0);
  assert.deepEqual(skipReasons(outcomes), [{ reason: "nome mancante", count: 2 }, { reason: "date non riconosciute", count: 1 }]);
});

test("CSV: intestazione, BOM, virgolette e righe non trovate", () => {
  const a = o(2, 'Mario "Rossi"; Jr', "2026-10-09", "2026-10-10", "nuova", { total: 12.5 });
  const csv = outcomesToCsv([a], new Set([a]));
  assert.ok(csv.startsWith("﻿riga;ospite;"));
  assert.ok(csv.includes('"Mario ""Rossi""; Jr"'));
  assert.ok(csv.includes("NON TROVATA in Xenora"));
  assert.ok(outcomesToCsv([a]).includes("importata"));
});

test("riga presente in un'altra struttura: non è 'mancante' e non conta negli importi", () => {
  const out: ImportOutcome[] = [
    { row: 2, guest: "Mario Rossi", checkIn: "2026-10-01", checkOut: "2026-10-03", room: "", code: "", extId: "octorate:1", total: 100, status: "gia_presente" },
    { row: 3, guest: "Anna Verdi", checkIn: "2026-10-05", checkOut: "2026-10-06", room: "", code: "", extId: "octorate:2", total: 50, status: "gia_presente" },
    { row: 4, guest: "Luca Neri", checkIn: "2026-10-07", checkOut: "2026-10-08", room: "", code: "", extId: "octorate:3", total: 70, status: "gia_presente" },
  ];
  const mine = [{ extId: "octorate:1", guestName: "Mario Rossi", checkIn: "2026-10-01", checkOut: "2026-10-03", total: 100 }];
  const others = [{ extId: "octorate:2", guestName: "Anna Verdi", checkIn: "2026-10-05", checkOut: "2026-10-06", total: 50, structure: "Spigolerooms" }];
  const v = verifyOutcomes(out, mine, others);
  assert.equal(v.found, 1); assert.equal(v.expected, 2);
  assert.deepEqual(v.elsewhere.map((e) => [e.outcome.row, e.structure]), [[3, "Spigolerooms"]]);
  assert.deepEqual(v.missing.map((m) => m.row), [4]);
  assert.equal(v.fileTotal, 170); assert.equal(v.systemTotal, 100);
});

test("importo diverso su riga già presente = modificato dopo, non anomalia", () => {
  const out: ImportOutcome[] = [{ row: 2, guest: "Papo", checkIn: "2026-10-13", checkOut: "2026-10-21", room: "", code: "", extId: "octorate:9", total: 616, status: "gia_presente" }];
  const v = verifyOutcomes(out, [{ extId: "octorate:9", guestName: "Papo", checkIn: "2026-10-13", checkOut: "2026-10-21", total: 0 }]);
  assert.equal(v.amountDiffs.length, 0); assert.equal(v.editedLater.length, 1);
});
