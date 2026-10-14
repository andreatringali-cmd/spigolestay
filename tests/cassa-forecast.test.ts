import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { computeForecast, projectBalance, presetRange, matchesQuery, OPENING_CAT } = await import("../src/lib/cassa.ts");

const TODAY = "2026-10-14";
const guests = [{ id: "g1", fullName: "Anna Di Napoli" }];
const st = () => ({ id: "s1", name: "Spigolehouse" });
const bk = (o: Record<string, unknown>) => ({ id: "b1", structureId: "s1", guestId: "g1", channel: "booking", status: "confirmed", checkIn: "2026-10-20", checkOut: "2026-10-22", total: 300, paid: 100, ...o });

test("previsione: saldo ancora da incassare delle prenotazioni in arrivo, alla data di arrivo", () => {
  const f = computeForecast([bk({}), bk({ id: "b2", checkIn: "2026-10-10" }), bk({ id: "b3", paid: 300 }), bk({ id: "b4", status: "cancelled" }), bk({ id: "b5", channel: "direct" }), bk({ id: "b6", checkIn: "2027-03-01" })] as never, guests as never, st as never, [], "all", TODAY, "2026-12-31");
  assert.deepEqual(f.map((m) => m.id).sort(), ["fc-in-b1", "fc-in-b5"]);
  const m = f.find((x) => x.id === "fc-in-b1")!;
  assert.equal(m.amount, 200);
  assert.equal(m.date, "2026-10-20");
  assert.equal(m.conto, "banca");
  assert.equal(f.find((x) => x.id === "fc-in-b5")!.conto, "contanti");
  assert.ok(m.forecast && m.desc.includes("da incassare"));
});

test("previsione: occorrenze future dei pagamenti programmati, da domani fino all'orizzonte", () => {
  const rule = { id: "r1", kind: "out" as const, cat: "utenze", desc: "Luce", amount: 80, conto: "banca", freq: "monthly" as const, day: 5, start: "2026-09-05", auto: true };
  const f = computeForecast([], [], st as never, [rule], "all", TODAY, "2027-01-31");
  assert.deepEqual(f.map((m) => m.date), ["2026-11-05", "2026-12-05", "2027-01-05"]);
  assert.ok(f.every((m) => m.sched && m.forecast && m.amount === 80));
});

test("saldo previsto: saldo attuale dei conti con saldo di partenza + movimenti dei giorni dopo oggi", () => {
  const balances = { banca: { saldo: 1000, since: "2026-10-01", start: 1000 }, contanti: { saldo: 50 } };
  const movs = [
    { id: "a", date: "2026-10-20", kind: "in" as const, cat: "prenotazioni", desc: "x", amount: 200, conto: "banca" },
    { id: "b", date: "2026-10-25", kind: "out" as const, cat: "utenze", desc: "y", amount: 80, conto: "banca" },
    { id: "c", date: "2026-11-30", kind: "in" as const, cat: "prenotazioni", desc: "z", amount: 999, conto: "banca" },   // oltre la data
    { id: "d", date: "2026-10-18", kind: "in" as const, cat: "altro", desc: "w", amount: 70, conto: "contanti" },        // conto senza saldo di partenza
    { id: "e", date: "2026-10-10", kind: "in" as const, cat: "altro", desc: "v", amount: 5, conto: "banca" },            // già passato
    { id: "f", date: "2026-10-22", kind: "in" as const, cat: OPENING_CAT, desc: "o", amount: 9, conto: "banca" },
  ];
  assert.equal(projectBalance(movs, balances as never, TODAY, "2026-11-15"), 1120); // 1000 + 200 − 80
});

test("periodi predefiniti", () => {
  assert.deepEqual(presetRange("future", TODAY), { from: "2026-10-14", to: "" });
  assert.deepEqual(presetRange("all", TODAY), { from: "", to: "" });
  assert.deepEqual(presetRange("month", TODAY), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(presetRange("prevMonth", TODAY), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(presetRange("prevMonth", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(presetRange("year", TODAY), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(presetRange("prevYear", TODAY), { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(presetRange("month", "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" });
});

test("ricerca: descrizione, categoria, conto e importo", () => {
  const m = { id: "x", date: "2026-10-14", kind: "in" as const, cat: "prenotazioni", desc: "Di Napoli Anna · Spigolehouse", amount: 854.37, conto: "banca" };
  assert.equal(matchesQuery(m, "", {}), true);
  assert.equal(matchesQuery(m, "napoli", {}), true);
  assert.equal(matchesQuery(m, "napoli spigole", {}), true);
  assert.equal(matchesQuery(m, "rossi", {}), false);
  assert.equal(matchesQuery(m, "revolut", { conto: "Revolut" }), true);
  assert.equal(matchesQuery(m, "854,37", {}), true);
  assert.equal(matchesQuery(m, "854.37", {}), true);
  assert.equal(matchesQuery(m, "utenze", { cat: "Prenotazioni" }), false);
});

test("scadenza modificata: cambiano solo i dati di quel mese (importo, data, descrizione, categoria, conto), la regola resta uguale", async () => {
  const { applyOverrides, occurrenceKey } = await import("../src/lib/cassa.ts");
  const rule = { id: "r1", kind: "out" as const, cat: "pulizie", desc: "Pulizie", amount: 500, conto: "banca", freq: "monthly" as const, day: 4, start: "2026-10-04", auto: true };
  const f = computeForecast([], [], st as never, [rule], "all", TODAY, "2027-01-31");
  assert.deepEqual(f.map((m) => m.date), ["2026-11-04", "2026-12-04", "2027-01-04"]);
  const key = occurrenceKey(f[0]);
  assert.equal(key, "r1|2026-11-04");
  const out = applyOverrides(f, { [key]: { amount: 640.5, date: "2026-11-06", desc: "Pulizie + biancheria", cat: "forniture", conto: "contanti" } });
  assert.deepEqual([out[0].amount, out[0].date, out[0].desc, out[0].cat, out[0].conto, out[0].edited], [640.5, "2026-11-06", "Pulizie + biancheria", "forniture", "contanti", true]);
  assert.equal(out[0].id, f[0].id);                       // stessa riga, stesso id
  assert.equal(occurrenceKey(out[0]), key);               // la chiave resta quella originale anche dopo aver spostato la data
  assert.deepEqual([out[1].amount, out[1].edited], [500, undefined]); // le altre scadenze non cambiano
  assert.equal(applyOverrides(f, {}), f);
});
