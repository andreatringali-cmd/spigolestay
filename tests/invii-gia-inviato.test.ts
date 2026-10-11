import test from "node:test";
import assert from "node:assert/strict";
import { giaInviato } from "../src/lib/invii-log.ts";

// Finto client Supabase che registra i filtri applicati e restituisce l'esito scelto.
function fakeAdmin(result: { data?: unknown[] | null; error?: { message: string } | null } | "throw") {
  const filters: Record<string, unknown> = {};
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte"]) q[m] = (...a: unknown[]) => { if (m !== "select") filters[`${m}:${a[0]}`] = a[1]; return q; };
  q.limit = async () => { if (result === "throw") throw new Error("boom"); return { data: result.data ?? null, error: result.error ?? null }; };
  return { admin: { from: (t: string) => { filters.table = t; return q; } } as never, filters };
}

const NOW = Date.parse("2026-10-11T12:00:00Z");

test("c'è un invio riuscito recente: già inviato, con i filtri giusti (20 ore, ok=true, canale)", async () => {
  const { admin, filters } = fakeAdmin({ data: [{ id: "1" }] });
  const r = await giaInviato(admin, "T", "checkin", "B1", 20, "email", NOW);
  assert.deepEqual(r, { gia: true });
  assert.equal(filters.table, "invii_log");
  assert.equal(filters["eq:tenant_id"], "T");
  assert.equal(filters["eq:job"], "checkin");
  assert.equal(filters["eq:ref"], "B1");
  assert.equal(filters["eq:ok"], true);
  assert.equal(filters["eq:channel"], "email");
  assert.equal(filters["gte:at"], "2026-10-10T16:00:00.000Z");
});

test("nessuna riga: non è già inviato", async () => {
  const r = await giaInviato(fakeAdmin({ data: [] }).admin, "T", "checkin", "B1", 20);
  assert.deepEqual(r, { gia: false });
});

test("query in errore o eccezione: NON blocca l'invio, riporta l'errore", async () => {
  const e1 = await giaInviato(fakeAdmin({ error: { message: "tabella mancante" } }).admin, "T", "checkin", "B1", 20);
  assert.equal(e1.gia, false);
  assert.equal(e1.errore, "tabella mancante");
  const e2 = await giaInviato(fakeAdmin("throw").admin, "T", "checkin", "B1", 20);
  assert.equal(e2.gia, false);
  assert.equal(e2.errore, "boom");
});
