import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { syncSchedine } = await import("../src/lib/alloggiati/service.ts");
const { todayRome, addDaysYmd } = await import("../src/lib/dates-rome.ts");

type Row = Record<string, unknown>;
// Mini client Supabase in memoria: select / eq / neq / in / delete / insert su alloggiati_schedine + app_state/org_state/alloggiati_settings.
function makeClient(tables: Record<string, Row[]>) {
  const t = structuredClone(tables);
  const from = (name: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "delete" | "insert" = "select";
    let payload: Row[] = [];
    const q: Record<string, unknown> = {
      select: () => q,
      delete: () => { mode = "delete"; return q; },
      insert: (p: Row | Row[]) => { mode = "insert"; payload = Array.isArray(p) ? p : [p]; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      maybeSingle: async () => ({ data: (t[name] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        const rows = (t[name] ??= []);
        if (mode === "insert") { rows.push(...structuredClone(payload)); return Promise.resolve({ data: null, error: null }).then(res); }
        if (mode === "delete") { t[name] = rows.filter((r) => !filters.every((f) => f(r))); return Promise.resolve({ data: null, error: null }).then(res); }
        return Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).map((r) => structuredClone(r)), error: null }).then(res);
      },
    };
    return q;
  };
  return { client: { from }, tables: t };
}

const person = (n: string) => ({ firstName: n, lastName: "Rossi", sex: "M", birthDate: "1980-01-01", birthPlace: "Roma", citizenship: "ITALIA", docType: "IDENT", docNumber: "AA1", docPlace: "ROMA" });

test("syncSchedine: una prenotazione con schedina già INVIATA non ne ricrea di nuove; si aggiungono solo i guest_ref mancanti", async () => {
  const checkIn = addDaysYmd(todayRome(), 1), checkOut = addDaysYmd(todayRome(), 3);
  const booking = { id: "b1", structureId: "s1", guestId: "g1", status: "confirmed", channel: "direct", checkIn, checkOut, adults: 2, children: 0, primaryGuest: person("Mario"), extraGuests: [person("Anna")] };
  const blob = { structures: [{ id: "s1" }], bookings: [booking], guests: [] };
  const { client, tables } = makeClient({
    app_state: [{ user_id: "t1", data: { "spigolestay:data:v1": JSON.stringify(blob) } }],
    alloggiati_schedine: [{ id: "x1", tenant_id: "t1", structure_id: "s1", booking_id: "b1", guest_ref: "primary", stato: "inviata", arrival: checkIn }],
  });
  const r = await syncSchedine(client as never, "t1", {});
  const rows = tables.alloggiati_schedine;
  assert.equal(rows.filter((x) => x.stato === "inviata").length, 1); // l'inviata resta
  assert.equal(rows.filter((x) => x.guest_ref === "primary").length, 1); // nessuna nuova riga per il principale
  assert.equal(rows.filter((x) => x.guest_ref === "extra:0").length, 1); // il co-ospite mancante si crea
  assert.equal(r.count, 1);
  // seconda esecuzione: stesso risultato (idempotente), nessun duplicato
  await syncSchedine(client as never, "t1", {});
  assert.equal(tables.alloggiati_schedine.filter((x) => x.guest_ref === "primary").length, 1);
  assert.equal(tables.alloggiati_schedine.filter((x) => x.guest_ref === "extra:0").length, 1);
});

test("syncSchedine: senza schedine inviate le righe si creano per tutti e si rigenerano senza doppioni", async () => {
  const checkIn = addDaysYmd(todayRome(), 1), checkOut = addDaysYmd(todayRome(), 2);
  const booking = { id: "b2", structureId: "s1", guestId: "g1", status: "confirmed", channel: "direct", checkIn, checkOut, adults: 1, children: 0, primaryGuest: person("Mario") };
  const { client, tables } = makeClient({ app_state: [{ user_id: "t1", data: { "spigolestay:data:v1": JSON.stringify({ structures: [{ id: "s1" }], bookings: [booking], guests: [] }) } }], alloggiati_schedine: [] });
  await syncSchedine(client as never, "t1", {});
  await syncSchedine(client as never, "t1", {});
  assert.equal(tables.alloggiati_schedine.length, 1);
  assert.equal(tables.alloggiati_schedine[0].stato, "pronta");
});
