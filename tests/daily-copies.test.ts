import test from "node:test";
import assert from "node:assert/strict";
import { fmtBytes, groupCopies, type CopyRow } from "../src/lib/daily-copies.ts";

const row = (id: string, day: string, bytes: number, rev = 1): CopyRow => ({ id, day, bytes, rev, takenAt: `${day}T01:10:00Z` });

test("groupCopies: raggruppa per account, copie dalla più recente, totali e ultimo giorno", () => {
  const out = groupCopies("user", [row("a", "2026-10-19", 100), row("b", "2026-10-20", 50), row("a", "2026-10-21", 300), row("a", "2026-10-20", 200)], new Map([["a", "zeta@example.com"], ["b", "alfa@example.com"]]));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => x.label), ["alfa@example.com", "zeta@example.com"]);        // ordine alfabetico per etichetta
  const a = out.find((x) => x.id === "a")!;
  assert.deepEqual(a.copies.map((c) => c.day), ["2026-10-21", "2026-10-20", "2026-10-19"]);
  assert.equal(a.totalBytes, 600);
  assert.equal(a.lastDay, "2026-10-21");
  assert.equal(a.kind, "user");
});

test("groupCopies: etichetta mancante -> testo di ripiego con l'inizio dell'id; righe non valide ignorate", () => {
  const out = groupCopies("org", [row("12345678-aaaa", "2026-10-21", 10), { id: "x" } as unknown as CopyRow], new Map());
  assert.equal(out.length, 1);
  assert.match(out[0].label, /Organizzazione senza nome \(12345678\)/);
});

test("groupCopies: nessuna riga -> nessun account", () => {
  assert.deepEqual(groupCopies("user", [], new Map()), []);
});

test("fmtBytes: unità e virgola italiana", () => {
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(2048), "2,0 KB");
  assert.equal(fmtBytes(340 * 1024), "340 KB");
  assert.equal(fmtBytes(1.5 * 1024 * 1024), "1,5 MB");
  assert.equal(fmtBytes(-1), "—");
});
