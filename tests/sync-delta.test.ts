import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const W = await import("../src/lib/sync-window.ts");
const D = await import("../src/lib/sync-delta.ts");

const KEY = "spigolestay:data:v1";
const TODAY = "2026-10-19";
const bk = (id: string, ci: string, co: string, extra: Record<string, unknown> = {}) => ({ id, structureId: "s1", guestId: "g-" + id, checkIn: ci, checkOut: co, status: "confirmed", updatedAt: 1000, ...extra });
const guest = (id: string, extra: Record<string, unknown> = {}) => ({ id, fullName: "Ospite " + id, updatedAt: 1000, ...extra });

// Archivio completo d'esempio: 3 prenotazioni vecchie, 1 recente, 1 in corso, 1 futura; ospiti collegati + 2 ospiti vecchi senza prenotazioni.
function fullRow(): Record<string, string> {
  const data = {
    structures: [{ id: "s1", name: "Casa", updatedAt: 1 }],
    roomTypes: [{ id: "rt1", structureId: "s1", name: "Doppia", updatedAt: 1 }],
    units: [{ id: "u1", structureId: "s1", roomTypeId: "rt1", name: "1", updatedAt: 1 }],
    bookings: [
      bk("old1", "2024-05-01", "2024-05-03"), bk("old2", "2025-02-10", "2025-02-12"), bk("old3", "2025-08-01", "2025-08-05"),
      bk("recent", "2026-09-01", "2026-09-04"), bk("now", "2026-10-18", "2026-10-21"), bk("future", "2026-12-24", "2026-12-27"),
    ],
    guests: [guest("g-old1"), guest("g-old2"), guest("g-old3"), guest("g-recent"), guest("g-now"), guest("g-future"), guest("g-nobooking-1"), guest("g-nobooking-2")],
    events: [{ id: "e1", title: "Festa", updatedAt: 5 }],
    rateOverrides: { "rt1|2026-10-20": 120 },
    activities: [{ id: "a1", ts: 10, text: "x" }],
    _deleted: { bookings: ["gone1"] },
  };
  return { [KEY]: JSON.stringify(data), "spigolestay:threads:v1": "{}", "spigolestay:promos": "[1,2]" };
}
const parse = (row: Record<string, string>) => JSON.parse(row[KEY]);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

test("finestra: prenotazioni recenti e future restano, le vecchie no; ospiti solo quelli collegati; il resto del blocco passa intero", () => {
  const { data, stats } = W.windowRowData(fullRow(), TODAY, 400);
  const d = parse(data!);
  assert.deepEqual(ids(d.bookings), ["future", "now", "recent"]);           // 400 giorni indietro dal 19.10.2026 = 15.09.2025 → old3 (ago 2025) fuori
  assert.deepEqual(ids(d.guests), ["g-future", "g-now", "g-recent"]);
  assert.equal(d.structures.length, 1); assert.equal(d.roomTypes.length, 1); assert.equal(d.units.length, 1); assert.equal(d.events.length, 1);
  assert.deepEqual(d.rateOverrides, { "rt1|2026-10-20": 120 });
  assert.deepEqual(d._deleted, { bookings: ["gone1"] });
  assert.equal(data!["spigolestay:threads:v1"], "{}"); assert.equal(data!["spigolestay:promos"], "[1,2]"); // chiavi piatte intatte
  assert.equal(stats!.bookingsTotal, 6); assert.equal(stats!.bookingsKept, 3);
});

test("finestra: una camera di gruppo in finestra tiene tutto il gruppo; un ospite appena creato resta; date mancanti = si tiene", () => {
  const row = fullRow(); const d = parse(row);
  d.bookings.push(bk("grp-a", "2024-01-01", "2024-01-03", { groupId: "G1" }), bk("grp-b", "2026-11-01", "2026-11-03", { groupId: "G1" }), { id: "nodates", structureId: "s1" });
  d.guests.push(guest("g-new", { updatedAt: Date.parse(TODAY + "T00:00:00Z") - 86400000 }));
  row[KEY] = JSON.stringify(d);
  const w = parse(W.windowRowData(row, TODAY, 400).data!);
  assert.ok(ids(w.bookings).includes("grp-a") && ids(w.bookings).includes("grp-b"));
  assert.ok(ids(w.bookings).includes("nodates"));
  assert.ok(ids(w.guests).includes("g-new"));
});

test("finestra: blocco illeggibile o assente = non si tocca nulla (mai nascondere dati)", () => {
  const bad = { [KEY]: "{non json", x: "1" };
  assert.deepEqual(W.windowRowData(bad, TODAY).data, bad);
  assert.equal(W.windowRowData(null, TODAY).data, null);
  assert.deepEqual(W.windowRowData({ x: "1" }, TODAY).data, { x: "1" });
});

// Il browser: parte dalla finestra, modifica, la fusione (qui simulata) dà `merged`; il delta si applica all'archivio completo.
function roundTrip(edit: (win: Record<string, string>) => Record<string, string>, base?: Record<string, string>) {
  const full = fullRow();
  const win = W.windowRowData(full, TODAY, 400).data!;
  const merged = edit(JSON.parse(JSON.stringify(win)));
  const delta = D.buildDelta(win, base ?? win, merged);
  const res = D.applyDelta(full, delta);
  return { full, win, merged, delta, res, after: parse(res.row) };
}

test("delta: nessuna modifica = delta vuoto, e nessuna perdita applicandolo", () => {
  const { delta, res, full } = roundTrip((w) => w);
  assert.ok(D.isEmptyDelta(delta));
  assert.deepEqual(parse(res.row), parse(full));
});

test("delta: modificare una prenotazione in finestra cambia SOLO quella; le vecchie e gli ospiti fuori finestra restano", () => {
  const { after, delta } = roundTrip((w) => { const d = parse(w); d.bookings.find((b: any) => b.id === "now").notes = "ciao"; d.bookings.find((b: any) => b.id === "now").updatedAt = 2000; w[KEY] = JSON.stringify(d); return w; });
  assert.equal(delta.colls.bookings.upsert.length, 1);
  assert.equal(after.bookings.length, 6);                                      // le 3 vecchie sono ancora lì
  assert.equal(after.bookings.find((b: any) => b.id === "now").notes, "ciao");
  assert.equal(after.guests.length, 8);                                        // anche gli ospiti senza prenotazioni
});

test("delta: nuova prenotazione + nuovo ospite", () => {
  const { after } = roundTrip((w) => { const d = parse(w); d.bookings.push(bk("new1", "2026-11-10", "2026-11-12")); d.guests.push(guest("g-new1")); w[KEY] = JSON.stringify(d); return w; });
  assert.equal(after.bookings.length, 7); assert.equal(after.guests.length, 9);
  assert.ok(after.bookings.some((b: any) => b.id === "new1"));
});

test("delta: cancellare una prenotazione (con lapide) la toglie dall'archivio e registra la lapide; le altre restano", () => {
  const { after, delta } = roundTrip((w) => { const d = parse(w); d.bookings = d.bookings.filter((b: any) => b.id !== "recent"); d._deleted = { bookings: ["gone1", "recent"] }; w[KEY] = JSON.stringify(d); return w; });
  assert.deepEqual(delta.colls.bookings.del, ["recent"]); assert.deepEqual(delta.tombs.bookings, ["recent"]);
  assert.ok(!after.bookings.some((b: any) => b.id === "recent"));
  assert.equal(after.bookings.length, 5);
  assert.deepEqual(after._deleted.bookings, ["gone1", "recent"]);
});

test("delta: cancellare con la sola lapide (entità fuori finestra) la toglie comunque dall'archivio", () => {
  const { after } = roundTrip((w) => { const d = parse(w); d._deleted = { bookings: ["gone1", "old1"] }; w[KEY] = JSON.stringify(d); return w; });
  assert.ok(!after.bookings.some((b: any) => b.id === "old1"));
  assert.equal(after.bookings.length, 5);
});

test("delta: un'entità uscita dalla finestra ma ancora nel browser (uguale alla base) NON viene rimandata", () => {
  const full = fullRow();
  const win = W.windowRowData(full, TODAY, 400).data!;
  // il browser ha ancora «old3» (era in finestra ieri): è nella base e nel fuso, ma non nella finestra attuale del server
  const d = parse(win); d.bookings.push(bk("old3", "2025-08-01", "2025-08-05"));
  const merged = { ...win, [KEY]: JSON.stringify(d) }; const base = merged;
  const delta = D.buildDelta(win, base, merged);
  assert.ok(D.isEmptyDelta(delta));
});

test("delta: l'assenza di un'entità fuori finestra NON è mai una cancellazione", () => {
  const { after, delta } = roundTrip((w) => w);
  assert.equal(delta.colls.bookings, undefined);
  assert.ok(after.bookings.some((b: any) => b.id === "old1"));
});

test("delta: campi del blocco (rateOverrides) e chiavi piatte cambiano per valore; le chiavi piatte non si cancellano mai", () => {
  const { after, res, delta } = roundTrip((w) => {
    const d = parse(w); d.rateOverrides["rt1|2026-10-21"] = 99; w[KEY] = JSON.stringify(d);
    w["spigolestay:promos"] = "[1,2,3]"; delete w["spigolestay:threads:v1"]; return w;
  });
  assert.deepEqual(after.rateOverrides, { "rt1|2026-10-20": 120, "rt1|2026-10-21": 99 });
  assert.equal(res.row["spigolestay:promos"], "[1,2,3]");
  assert.equal(res.row["spigolestay:threads:v1"], "{}");              // mancante nel fuso ≠ cancellata sul server
  assert.deepEqual(Object.keys(delta.flat), ["spigolestay:promos"]);
});

test("delta: «activities» e «_deletedLeads» si uniscono, non si sovrascrivono (il server può averne di nuove)", () => {
  const full = fullRow(); const fd = parse(full); fd.activities.push({ id: "a-server", ts: 50 }); fd._deletedLeads = ["email:x"]; full[KEY] = JSON.stringify(fd);
  const delta = D.emptyDelta(); delta.fields.activities = [{ id: "a-client", ts: 20 }]; delta.fields._deletedLeads = ["email:y"];
  const after = parse(D.applyDelta(full, delta).row);
  assert.deepEqual(after.activities.map((a: any) => a.id), ["a-server", "a-client", "a1"]);
  assert.deepEqual(after._deletedLeads, ["email:x", "email:y"]);
});

test("protezione: cancellare più di 40 prenotazioni in una volta è rifiutato senza conferma; con conferma passa", () => {
  const full = fullRow(); const fd = parse(full);
  for (let i = 0; i < 60; i++) fd.bookings.push(bk("x" + i, "2026-11-01", "2026-11-02"));
  full[KEY] = JSON.stringify(fd);
  const delta = D.emptyDelta(); delta.colls.bookings = { upsert: [], del: Array.from({ length: 50 }, (_, i) => "x" + i) };
  assert.throws(() => D.applyDelta(full, delta), (e: any) => e.code === "mass_delete");
  delta.confirm = true;
  assert.equal(parse(D.applyDelta(full, delta).row).bookings.length, 6 + 10);
});

test("protezione: la stessa cancellazione come «del» e come lapide conta una volta; lapidi di massa senza conferma sono rifiutate", () => {
  const full = fullRow();
  const delta = D.emptyDelta();
  delta.colls.bookings = { upsert: [], del: ["now"] }; delta.tombs.bookings = ["now"];
  assert.doesNotThrow(() => D.applyDelta(full, delta));
  const massTombs = D.emptyDelta(); massTombs.tombs.bookings = Array.from({ length: 60 }, (_, i) => "y" + i);
  assert.throws(() => D.applyDelta(full, massTombs), (e: any) => e.code === "mass_delete");
});

test("applicare due volte lo stesso delta dà lo stesso risultato (idempotente)", () => {
  const { delta, full } = roundTrip((w) => { const d = parse(w); d.bookings.push(bk("new1", "2026-11-10", "2026-11-12")); d.bookings = d.bookings.filter((b: any) => b.id !== "recent"); d._deleted = { bookings: ["gone1", "recent"] }; w[KEY] = JSON.stringify(d); return w; });
  const once = D.applyDelta(full, delta).row;
  const twice = D.applyDelta(once, delta).row;
  assert.deepEqual(parse(twice), parse(once));
});

test("blocco dati illeggibile sul server: nessuna modifica applicata", () => {
  assert.throws(() => D.applyDelta({ [KEY]: "{rotto" }, D.emptyDelta()), (e: any) => e.code === "bad_data");
});

test("le lapidi del delta si UNISCONO a quelle del server (mai sostituite)", () => {
  const full = fullRow();
  const d = D.emptyDelta(); d.tombs.bookings = ["nuova-lapide"];
  assert.deepEqual(parse(D.applyDelta(full, d).row)._deleted.bookings, ["gone1", "nuova-lapide"]);
});
