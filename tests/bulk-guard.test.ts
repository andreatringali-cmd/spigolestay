import test from "node:test";
import assert from "node:assert/strict";
import { BULK_THRESHOLD, needsBulkGuard, isConfirmWordOk, backupFileName, buildBackupPayload } from "../src/lib/bulk-guard.ts";

test("soglia: da 20 in su scatta la protezione", () => {
  assert.equal(BULK_THRESHOLD, 20);
  assert.equal(needsBulkGuard(0), false);
  assert.equal(needsBulkGuard(1), false);
  assert.equal(needsBulkGuard(19), false);
  assert.equal(needsBulkGuard(20), true);
  assert.equal(needsBulkGuard(1696), true);
  assert.equal(needsBulkGuard(NaN), false);
});

test("parola di conferma: ELIMINA maiuscolo/minuscolo, spazi ignorati", () => {
  for (const ok of ["ELIMINA", "elimina", "Elimina", "  ELIMINA ", "eli mina", "\tElimina\n"]) assert.equal(isConfirmWordOk(ok), true, ok);
  for (const no of ["", "   ", "ELIMINAA", "elimin", "cancella", "ELIMINA tutto"]) assert.equal(isConfirmWordOk(no), false, no);
});

test("nome file con data e ora locali", () => {
  const d = new Date(2026, 9, 12, 9, 30, 45);
  assert.equal(backupFileName("ospiti", d), "xenora-copia-prima-di-eliminare-ospiti-2026-10-12-0930.json");
  assert.equal(backupFileName("Prenotazioni importate", new Date(2026, 0, 5, 14, 7)), "xenora-copia-prima-di-eliminare-prenotazioni-importate-2026-01-05-1407.json");
  assert.equal(backupFileName("", d), "xenora-copia-prima-di-eliminare-dati-2026-10-12-0930.json");
});

test("payload: intestazione, totale e dati intatti", () => {
  const d = new Date(Date.UTC(2026, 9, 12, 7, 30));
  const items = [{ id: "a", fullName: "Mario" }, { id: "b", fullName: "Anna" }];
  const p = buildBackupPayload("ospiti", items, d);
  assert.equal(p.app, "xenora");
  assert.equal(p.tipo, "copia-prima-di-eliminare");
  assert.equal(p.elementi, "ospiti");
  assert.equal(p.totale, 2);
  assert.equal(p.creatoIl, "2026-10-12T07:30:00.000Z");
  assert.deepEqual(p.dati, items);
  assert.deepEqual(JSON.parse(JSON.stringify(p)).dati, items);
});
