import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// server-booking-guard.ts importa "@/lib/pricing": lo risolve l'hook di tests/helpers. Lato server non c'e' localStorage:
// il motore prezzi deve funzionare lo stesso (nessuna regola weekend propria = nessuna maggiorazione nel calcolo del minimo).
register("./helpers/alias-loader.mjs", import.meta.url);
const { stayFloor, hasFreeUnit, clientIp, loadOwnerStructureData, mergeOwnerData } = await import("../src/lib/server-booking-guard.ts");

const DATA_KEY = "spigolestay:data:v1";
const rt = (id: string, basePrice: number, extra: Record<string, unknown> = {}) => ({ id, structureId: "S1", name: id, beds: 2, basePrice, ...extra });
const od = (over: Record<string, unknown> = {}) => ({ roomTypes: [rt("A", 100)], units: [{ id: "u1", roomTypeId: "A" }, { id: "u2", roomTypeId: "A" }], bookings: [], rateOverrides: {}, ...over }) as never;
const bk = (o: Record<string, unknown>) => ({ id: "b", status: "confirmed", ...o });

// ───────────────────────── stayFloor (tetto di prezzo: 50% del listino) ─────────────────────────
test("stayFloor: meta' della somma delle notti a listino", () => {
  assert.equal(stayFloor(od(), "A", "2026-06-15", "2026-06-18"), 150); // lun-mer: 3 x 100 = 300
  assert.equal(stayFloor(od(), "A", "2026-06-15", "2026-06-16"), 50);
});

test("stayFloor: arrotondato per difetto al euro (favorevole al cliente)", () => {
  assert.equal(stayFloor(od({ roomTypes: [rt("A", 101)] }), "A", "2026-06-15", "2026-06-18"), 151); // 303 / 2 = 151,5
  assert.equal(stayFloor(od({ roomTypes: [rt("A", 99)] }), "A", "2026-06-15", "2026-06-16"), 49); // 49,5
});

test("stayFloor: il minimo NON include la maggiorazione weekend (calcolata con weekend a 0)", () => {
  // venerdi' 12, sabato 13, domenica 14 giugno 2026: 3 notti a 100
  assert.equal(stayFloor(od(), "A", "2026-06-12", "2026-06-15"), 150);
});

test("stayFloor: gli override del calendario abbassano o alzano il minimo", () => {
  const d = od({ rateOverrides: { "A|2026-06-16": 40, "2026-06-17": 300 } });
  // 15: 100, 16: 40 (per tipologia), 17: 300 (per giorno) = 440 -> 220
  assert.equal(stayFloor(d, "A", "2026-06-15", "2026-06-18"), 220);
});

test("stayFloor: tipologia derivata segue la madre", () => {
  const d = od({ roomTypes: [rt("A", 100), rt("B", 0, { deriveFrom: "A", deriveMode: "percent", deriveValue: 50 })] });
  assert.equal(stayFloor(d, "B", "2026-06-15", "2026-06-17"), 150); // 2 x 150 = 300 -> 150
});

test("stayFloor: prezzi non impostati, tipologia ignota o date incoerenti = nessun controllo (null)", () => {
  assert.equal(stayFloor(od({ roomTypes: [rt("A", 0)] }), "A", "2026-06-15", "2026-06-18"), null);
  assert.equal(stayFloor(od(), "ZZZ", "2026-06-15", "2026-06-18"), null);
  assert.equal(stayFloor(od(), "A", "2026-06-18", "2026-06-15"), null);
  assert.equal(stayFloor(od(), "A", "2026-06-15", "2026-06-15"), null);
  assert.equal(stayFloor(od(), "A", "boh", "boh"), null);
});

test("stayFloor: un soggiorno molto lungo si ferma a 400 notti (nessun ciclo infinito)", () => {
  assert.equal(stayFloor(od(), "A", "2026-01-01", "2030-01-01"), 20000); // 400 x 100 / 2
});

test("stayFloor: un totale di 1 euro su un soggiorno da 2000 euro e' sotto il minimo", () => {
  const d = od({ roomTypes: [rt("A", 200)] });
  const floor = stayFloor(d, "A", "2026-06-15", "2026-06-25")!; // 10 notti x 200
  assert.equal(floor, 1000);
  assert.ok(1 < floor);
});

// ───────────────────────── hasFreeUnit ─────────────────────────
test("hasFreeUnit: libera, occupata e sovrapposizioni parziali", () => {
  const d = od({ bookings: [bk({ unitId: "u1", checkIn: "2026-06-10", checkOut: "2026-06-15" }), bk({ unitId: "u2", checkIn: "2026-06-12", checkOut: "2026-06-14" })] });
  assert.equal(hasFreeUnit(d, "A", "2026-06-20", "2026-06-22"), true);
  assert.equal(hasFreeUnit(d, "A", "2026-06-13", "2026-06-14"), false); // occupate entrambe
  assert.equal(hasFreeUnit(d, "A", "2026-06-14", "2026-06-16"), true); // u2 libera dal 14
  assert.equal(hasFreeUnit(d, "A", "2026-06-08", "2026-06-11"), true); // u2 libera
});

test("hasFreeUnit: check-out = check-in non e' sovrapposizione", () => {
  const d = od({ units: [{ id: "u1", roomTypeId: "A" }], bookings: [bk({ unitId: "u1", checkIn: "2026-06-10", checkOut: "2026-06-15" })] });
  assert.equal(hasFreeUnit(d, "A", "2026-06-15", "2026-06-17"), true);
  assert.equal(hasFreeUnit(d, "A", "2026-06-08", "2026-06-10"), true);
  assert.equal(hasFreeUnit(d, "A", "2026-06-14", "2026-06-16"), false);
});

test("hasFreeUnit: le cancellate non occupano; blocchi e manutenzioni si", () => {
  const d = od({ units: [{ id: "u1", roomTypeId: "A" }], bookings: [bk({ unitId: "u1", checkIn: "2026-06-10", checkOut: "2026-06-15", status: "cancelled" })] });
  assert.equal(hasFreeUnit(d, "A", "2026-06-11", "2026-06-12"), true);
  const blocco = od({ units: [{ id: "u1", roomTypeId: "A" }], bookings: [bk({ unitId: "u1", channel: "blocked", checkIn: "2026-06-10", checkOut: "2026-06-15" })] });
  assert.equal(hasFreeUnit(blocco, "A", "2026-06-11", "2026-06-12"), false);
});

test("hasFreeUnit: camere fuori servizio ignorate; nessuna camera = null (non verificabile)", () => {
  const d = od({ units: [{ id: "u1", roomTypeId: "A", outOfService: true }, { id: "u2", roomTypeId: "A" }], bookings: [bk({ unitId: "u2", checkIn: "2026-06-10", checkOut: "2026-06-15" })] });
  assert.equal(hasFreeUnit(d, "A", "2026-06-11", "2026-06-12"), false);
  assert.equal(hasFreeUnit(od({ units: [] }), "A", "2026-06-11", "2026-06-12"), null);
  assert.equal(hasFreeUnit(od(), "ALTRA", "2026-06-11", "2026-06-12"), null);
  assert.equal(hasFreeUnit(od({ units: [{ id: "u1", roomTypeId: "A", outOfService: true }] }), "A", "2026-06-11", "2026-06-12"), null);
});

test("hasFreeUnit: prenotazioni di altre camere non contano", () => {
  const d = od({ units: [{ id: "u1", roomTypeId: "A" }], bookings: [bk({ unitId: "uX", checkIn: "2026-06-10", checkOut: "2026-06-15" }), bk({ unitId: null, checkIn: "2026-06-10", checkOut: "2026-06-15" })] });
  assert.equal(hasFreeUnit(d, "A", "2026-06-11", "2026-06-12"), true);
});

// ───────────────────────── clientIp ─────────────────────────
test("clientIp: primo indirizzo di x-forwarded-for, senza spazi; assente = 'unknown'", () => {
  const r = (h: Record<string, string>) => new Request("https://x", { headers: h });
  assert.equal(clientIp(r({ "x-forwarded-for": "1.2.3.4" })), "1.2.3.4");
  assert.equal(clientIp(r({ "x-forwarded-for": " 1.2.3.4 , 10.0.0.1, 10.0.0.2" })), "1.2.3.4");
  assert.equal(clientIp(r({})), "unknown");
  assert.equal(clientIp(r({ "x-forwarded-for": "" })), "unknown");
});

// ───────────────────────── loadOwnerStructureData ─────────────────────────
const blob = (data: unknown) => ({ [DATA_KEY]: JSON.stringify(data) });
const state = (structures: string[], extra: Record<string, unknown> = {}) => ({ structures: structures.map((id) => ({ id })), roomTypes: [rt("A", 100)], units: [{ id: "u1", roomTypeId: "A" }], bookings: [], ...extra });

test("loadOwnerStructureData: struttura personale -> dati dall'app_state del proprietario", async () => {
  const { client } = makeFakeDb({ memberships: [], app_state: [{ user_id: "own", data: blob(state(["S1"], { rateOverrides: { "2026-06-15": 90 } })) }] });
  const r = await loadOwnerStructureData(client as never, "own", "S1");
  assert.ok(r);
  assert.equal(r.roomTypes.length, 1); assert.equal(r.units.length, 1);
  assert.deepEqual(r.rateOverrides, { "2026-06-15": 90 });
});

test("loadOwnerStructureData: struttura condivisa -> dati dall'org_state di cui il proprietario e' membro", async () => {
  const { client } = makeFakeDb({
    memberships: [{ user_id: "own", org_id: "org-1" }, { user_id: "altro", org_id: "org-2" }],
    org_state: [{ org_id: "org-1", data: blob(state(["S1"], { bookings: [{ id: "b1" }] })) }, { org_id: "org-2", data: blob(state(["S9"])) }],
    app_state: [{ user_id: "own", data: blob(state(["S-personale"])) }],
  });
  const r = await loadOwnerStructureData(client as never, "own", "S1");
  assert.ok(r);
  assert.equal(r.bookings.length, 1);
});

test("loadOwnerStructureData: struttura inesistente, dati rotti o errore del database -> null (nessun controllo, mai un'eccezione)", async () => {
  const a = makeFakeDb({ memberships: [], app_state: [{ user_id: "own", data: blob(state(["S1"])) }] });
  assert.equal(await loadOwnerStructureData(a.client as never, "own", "ALTRA"), null);
  const b = makeFakeDb({ memberships: [], app_state: [{ user_id: "own", data: { [DATA_KEY]: "{rotto" } }] });
  assert.equal(await loadOwnerStructureData(b.client as never, "own", "S1"), null);
  const c = makeFakeDb({});
  assert.equal(await loadOwnerStructureData(c.client as never, "sconosciuto", "S1"), null);
  const boom = { from() { throw new Error("db giu'"); } };
  assert.equal(await loadOwnerStructureData(boom as never, "own", "S1"), null);
});

test("loadOwnerStructureData: rateOverrides assente o non oggetto = {}", async () => {
  const { client } = makeFakeDb({ memberships: [], app_state: [{ user_id: "own", data: blob(state(["S1"], { rateOverrides: "boh" })) }] });
  const r = await loadOwnerStructureData(client as never, "own", "S1");
  assert.deepEqual(r!.rateOverrides, {});
});

// ───────────────────────── mergeOwnerData (personale + organizzazioni) ─────────────────────────
test("mergeOwnerData: unisce strutture, tipologie, camere e prenotazioni di piu' blob senza doppioni", () => {
  const personal = { structures: [], roomTypes: [], units: [], bookings: [{ id: "b1", unitId: null }] };
  const org = { structures: [{ id: "S1" }], roomTypes: [rt("A", 100)], units: [{ id: "u1", roomTypeId: "A" }], bookings: [{ id: "b1", unitId: "u1" }, { id: "b2", unitId: "u1" }], rateOverrides: { x: 1 } };
  const m = mergeOwnerData([personal, org]);
  assert.equal(m.structures.length, 1);
  assert.equal(m.roomTypes.length, 1);
  assert.equal(m.units.length, 1);
  assert.deepEqual(m.bookings.map((b) => b.id), ["b1", "b2"]); // b1: vale la prima occorrenza (personale)
  assert.deepEqual(m.rateOverrides, { x: 1 });
});

test("mergeOwnerData: con camere solo nell'organizzazione hasFreeUnit funziona sui dati uniti", () => {
  const org = { structures: [{ id: "S1" }], roomTypes: [rt("A", 100)], units: [{ id: "u1", roomTypeId: "A" }], bookings: [{ id: "b1", unitId: "u1", status: "confirmed", checkIn: "2026-06-15", checkOut: "2026-06-18" }] };
  const m = mergeOwnerData([{}, org]);
  const d = { roomTypes: m.roomTypes, units: m.units, bookings: m.bookings, rateOverrides: m.rateOverrides } as never;
  assert.equal(hasFreeUnit(d, "A", "2026-06-16", "2026-06-17"), false);
  assert.equal(hasFreeUnit(d, "A", "2026-06-18", "2026-06-19"), true);
});
