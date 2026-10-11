import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// I servizi importano "@/lib/..." senza estensione: li risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
// Invio reale spento (come in sviluppo / senza credenziali complete).
delete process.env.ALLOGGIATI_LIVE;
delete process.env.ISTAT_LIVE;
const { sendReady, ALLOGGIATI_SIMULATED_MSG } = await import("../src/lib/alloggiati/service.ts");
const { closeDay, ISTAT_SIMULATED_MSG } = await import("../src/lib/istat/service.ts");

type Op = { table: string; op: string };

// Finto client Supabase: ogni catena di filtri e' "attendibile"; registra le scritture.
function fakeAdmin(tables: Record<string, unknown>) {
  const ops: Op[] = [];
  const admin = {
    from(table: string) {
      const result = { data: tables[table] ?? null, error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "lte", "in", "order", "limit"]) chain[m] = () => chain;
      for (const m of ["insert", "update", "delete", "upsert"]) chain[m] = () => { ops.push({ table, op: m }); return chain; };
      chain.maybeSingle = async () => ({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null });
      chain.single = chain.maybeSingle;
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      return chain;
    },
  };
  return { admin: admin as never, ops };
}

test("Alloggiati: invio reale spento -> esito simulato, nessuna scrittura", async () => {
  const { admin, ops } = fakeAdmin({
    alloggiati_schedine: [{ id: "s1", booking_id: "b1", ruolo: "16", arrival: "2026-01-01", guest: { cognome: "Rossi", perm: 2 } }],
    alloggiati_settings: { username: "u", password_enc: "pw", ws_code_enc: "ws" },
  });
  const r = await sendReady(admin, "t1", "st1");
  assert.equal(r.simulated, true);
  assert.equal(r.ok, false);
  assert.equal(r.sent, 0);
  assert.equal(r.message, ALLOGGIATI_SIMULATED_MSG);
  assert.match(r.message, /Simulato/);
  // Nessun insert/update/delete: niente submission, niente "inviata", niente eventi, niente purga foto.
  assert.deepEqual(ops, []);
});

test("Alloggiati: credenziali incomplete -> errore chiaro (non simulato), nessuna scrittura", async () => {
  const { admin, ops } = fakeAdmin({
    alloggiati_schedine: [{ id: "s1", booking_id: "b1", ruolo: "16", arrival: "2026-01-01", guest: {} }],
    alloggiati_settings: null,
  });
  const r = await sendReady(admin, "t1", "st1");
  assert.equal(r.ok, false);
  assert.equal(r.sent, 0);
  assert.notEqual(r.simulated, true);
  assert.deepEqual(ops, []);
});

test("ISTAT: invio reale spento -> esito simulato, righe non segnate inviate", async () => {
  const { admin, ops } = fakeAdmin({
    istat_settings: { username: "u", password_enc: "pw" },
    istat_rows: [{ id: "r1", booking_id: "b1" }],
  });
  const r = await closeDay(admin, "t1", "st1", "2026-01-01");
  assert.equal(r.simulated, true);
  assert.equal(r.ok, false);
  assert.equal(r.sent, 0);
  assert.equal(r.message, ISTAT_SIMULATED_MSG);
  assert.deepEqual(ops, []);
});
