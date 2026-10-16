import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { scopeVisible, cashScopeOf, scopeIds, movSid, computeAuto, computeScheduled, computeForecast, computeBalances, balanceParts, balanceTotalsBySid, computeLedger, projectBalance, openingOf, OPENING_CAT } = await import("../src/lib/cassa.ts");

// 3 strutture: s1 Spigolehouse, s2 Spigolerooms, s3 Central Perk.
const NAMES: Record<string, string> = { s1: "Spigolehouse", s2: "Spigolerooms", s3: "Central Perk" };
const stx = (id: string) => ({ id, name: NAMES[id] });
const guests = [{ id: "g1", fullName: "Anna" }];
const B = (id: string, structureId: string, o: Record<string, unknown> = {}) => ({ id, structureId, guestId: "g1", channel: "direct", status: "confirmed", checkIn: "2026-10-10", checkOut: "2026-10-12", total: 100, paid: 100, ...o });
const bks = [B("b1", "s1"), B("b2", "s2"), B("b3", "s3")];
const auto = (scope: unknown) => computeAuto(bks as never, guests as never, stx as never, scope as never, "banca", {}, ["banca", "contanti"]);
const ref = (list: { ref?: string }[]) => list.map((m) => m.ref).sort();

const TODAY = "2026-10-20";
const mv = (id: string, date: string, kind: "in" | "out", amount: number, structureId: string | undefined, conto = "banca", cat = "altro") => ({ id, date, kind, cat, desc: id, amount, conto, structureId });
const open = (id: string, date: string, amount: number, structureId: string | undefined, conto = "banca") => mv(id, date, amount >= 0 ? "in" : "out", Math.abs(amount), structureId, conto, OPENING_CAT);

test("scopeVisible: tutte / una / sottoinsieme / sottoinsieme completo", () => {
  assert.equal(scopeVisible("s1", "all"), true);
  assert.equal(scopeVisible(undefined, "all"), true, "con 'Tutte' si vedono anche le voci comuni");
  assert.equal(scopeVisible("all", "all"), true);
  assert.equal(scopeVisible("s1", "s1"), true);
  assert.equal(scopeVisible("s2", "s1"), false);
  assert.equal(scopeVisible(undefined, "s1"), false);
  assert.equal(scopeVisible("s1", ["s1", "s2"]), true);
  assert.equal(scopeVisible("s2", ["s1", "s2"]), true);
  assert.equal(scopeVisible("s3", ["s1", "s2"]), false, "Central Perk non compare con Spigolehouse + Spigolerooms");
  assert.equal(scopeVisible(undefined, ["s1", "s2"]), false, "le voci senza struttura non si vedono in un sottoinsieme");
  assert.equal(scopeVisible("all", ["s1", "s2"]), false, "il vecchio valore 'all' è una voce comune");
  assert.equal(scopeVisible("s1", []), false);
});

test("cashScopeOf: la selezione che copre tutte le strutture vale 'all'", () => {
  const all = ["s1", "s2", "s3"];
  assert.equal(cashScopeOf(["s1", "s2", "s3"], all), "all");
  assert.equal(cashScopeOf([], all), "all");
  assert.equal(cashScopeOf(["s3", "s1", "s2"], all), "all");
  assert.equal(cashScopeOf(["s2"], all), "s2");
  assert.deepEqual(cashScopeOf(["s1", "s2"], all), ["s1", "s2"]);
  assert.equal(cashScopeOf(["s1"], ["s1"]), "all", "un account con una sola struttura vede anche i comuni");
  assert.deepEqual(scopeIds(["s1", "s2"], all), ["s1", "s2"]);
  assert.deepEqual(scopeIds("all", all), all);
  assert.deepEqual(scopeIds("s3", all), ["s3"]);
});

test("computeAuto: il sottoinsieme [s1, s2] non vede s3; tutte = somma; una sola = solo la sua", () => {
  assert.deepEqual(ref(auto(["s1", "s2"])), ["b1", "b2"]);
  assert.deepEqual(ref(auto("all")), ["b1", "b2", "b3"]);
  assert.deepEqual(ref(auto("s3")), ["b3"]);
  assert.deepEqual(ref(auto(["s3"])), ["b3"]);
  assert.deepEqual(ref(auto([])), []);
});

const rule = (id: string, structureId: string | undefined, o: Record<string, unknown> = {}) => ({ id, kind: "out", cat: "tasse", desc: id, amount: 50, conto: "banca", structureId, freq: "monthly", day: 5, start: "2026-09-01", auto: true, ...o });

test("computeScheduled / computeForecast: le regole di s3 non compaiono con [s1, s2]", () => {
  const rules = [rule("r1", "s1"), rule("r2", "s2"), rule("r3", "s3"), rule("rc", undefined)];
  const sched = (scope: unknown) => [...new Set(computeScheduled(rules as never, new Set(), scope as never, "2026-10-31").map((m) => m.ref))].sort();
  assert.deepEqual(sched(["s1", "s2"]), ["r1", "r2"]);
  assert.deepEqual(sched("s3"), ["r3"]);
  assert.deepEqual(sched("all"), ["r1", "r2", "r3", "rc"]);
  const fc = (scope: unknown) => [...new Set(computeForecast([B("f1", "s1", { paid: 0, checkIn: "2026-11-02" }), B("f3", "s3", { paid: 0, checkIn: "2026-11-02" })] as never, guests as never, stx as never, rules as never, scope as never, TODAY, "2026-12-31", "banca", {}, ["banca"]).map((m) => m.ref))].sort();
  assert.deepEqual(fc(["s1", "s2"]), ["f1", "r1", "r2"]);
  assert.deepEqual(fc("s3"), ["f3", "r3"]);
  assert.deepEqual(fc("all"), ["f1", "f3", "r1", "r2", "r3", "rc"]);
});

test("esempio reale: il movimento «Tasse e imposte» di s3 non è visibile con [s1, s2]", () => {
  const manual = [mv("tasse-s3", "2026-10-15", "out", 300, "s3", "banca", "tasse"), mv("tasse-s1", "2026-10-15", "out", 120, "s1", "banca", "tasse"), mv("comune", "2026-10-15", "out", 10, undefined)];
  const visible = (scope: unknown) => manual.filter((m) => scopeVisible(m.structureId, scope as never)).map((m) => m.id);
  assert.deepEqual(visible(["s1", "s2"]), ["tasse-s1"]);
  assert.deepEqual(visible("s3"), ["tasse-s3"]);
  assert.deepEqual(visible("all"), ["tasse-s3", "tasse-s1", "comune"]);
});

test("saldi per struttura sommati, ognuno dalla propria data di apertura", () => {
  const movs = [
    open("o1", "2026-10-01", 1000, "s1"),
    mv("a1", "2026-09-20", "in", 77, "s1"),   // prima dell'apertura di s1: ignorato
    mv("a2", "2026-10-05", "out", 100, "s1"),
    open("o2", "2026-10-10", 500, "s2"),
    mv("b1", "2026-10-05", "in", 40, "s2"),   // prima dell'apertura di s2: ignorato (anche se dopo quella di s1)
    mv("b2", "2026-10-12", "in", 60, "s2"),
    open("o3", "2026-10-15", 200, "s3"),
    mv("c1", "2026-10-18", "out", 20, "s3"),
    mv("c2", "2026-10-25", "out", 999, "s3"),  // futuro: non conta nel saldo attuale
  ];
  const b = computeBalances(movs as never, TODAY, ["banca"], "all");
  assert.equal(b.banca.saldo, 900 + 560 + 180);
  assert.equal(b.banca.since, "2026-10-15", "since = la data di apertura più recente");
  assert.equal(b.banca.start, 1700);
  // sottoinsiemi: solo le strutture dell'ambito
  assert.equal(computeBalances(movs as never, TODAY, ["banca"], ["s1", "s2"]).banca.saldo, 900 + 560);
  assert.equal(computeBalances(movs as never, TODAY, ["banca"], "s3").banca.saldo, 180);
  assert.equal(computeBalances(movs as never, TODAY, ["banca"], "s2").banca.saldo, 560);
  const tot = balanceTotalsBySid(balanceParts(movs as never, TODAY, ["banca"], ["s1", "s2"]));
  assert.deepEqual(tot.sort((x, y) => (x.sid < y.sid ? -1 : 1)), [{ sid: "s1", saldo: 900 }, { sid: "s2", saldo: 560 }]);
});

test("più conti per struttura: ogni (struttura, conto) ha il suo saldo", () => {
  const movs = [open("o1", "2026-10-01", 100, "s1", "banca"), open("o2", "2026-10-01", 50, "s1", "contanti"), open("o3", "2026-10-01", 900, "s2", "banca"), mv("x", "2026-10-02", "in", 10, "s2", "contanti")];
  const b = computeBalances(movs as never, TODAY, ["banca", "contanti"], "all");
  assert.equal(b.banca.saldo, 1000);
  assert.equal(b.contanti.saldo, 50, "s2 non ha un saldo di partenza sui contanti: i suoi movimenti non contano");
  assert.equal(computeBalances(movs as never, TODAY, ["banca", "contanti"], "s2").contanti.since, undefined);
  assert.equal(openingOf(movs as never, "s1", "contanti")?.amount, 50);
  assert.equal(openingOf(movs as never, "s2", "contanti"), undefined);
});

test("vecchia apertura SENZA struttura: conta solo con 'all', copre le strutture senza saldo proprio", () => {
  const movs = [
    open("old", "2026-10-01", 1000, undefined),
    mv("a", "2026-10-05", "in", 100, "s1"),
    mv("b", "2026-10-06", "out", 30, "s2"),
    mv("c", "2026-10-07", "out", 5, undefined),
  ];
  // come prima: apertura comune + tutti i movimenti dopo la data
  const all = computeBalances(movs as never, TODAY, ["banca"], "all");
  assert.equal(all.banca.saldo, 1065);
  assert.equal(all.banca.since, "2026-10-01");
  // negli altri ambiti la vecchia apertura non c'è
  assert.equal(computeBalances(movs as never, TODAY, ["banca"], ["s1", "s2"]).banca.since, undefined);
  assert.equal(computeBalances(movs as never, TODAY, ["banca"], "s1").banca.since, undefined);
  // appena s1 scrive il proprio saldo, i suoi movimenti passano a quello (niente doppio conteggio)
  const mixed = [...movs, open("s1o", "2026-10-03", 400, "s1")];
  const m = computeBalances(mixed as never, TODAY, ["banca"], "all");
  assert.equal(m.banca.saldo, 1000 - 30 - 5 + 400 + 100);
  assert.equal(computeBalances(mixed as never, TODAY, ["banca"], "s1").banca.saldo, 500);
  assert.equal(computeBalances(mixed as never, TODAY, ["banca"], ["s1", "s2"]).banca.saldo, 500, "s2 non ha un saldo proprio: da solo non conta");
});

test("estratto conto e saldo previsto: somma coerente per struttura", () => {
  const movs = [
    open("o1", "2026-10-01", 1000, "s1"),
    open("o2", "2026-10-10", 500, "s2"),
    mv("a", "2026-10-05", "out", 100, "s1"),
    mv("b", "2026-10-12", "in", 60, "s2"),
    mv("pre", "2026-10-06", "in", 40, "s2"),      // prima dell'apertura di s2
    mv("c", "2026-10-30", "in", 25, "s1"),        // futuro
    mv("d", "2026-10-31", "out", 5, "s2"),        // futuro
    mv("e", "2026-10-31", "out", 7, "s3"),        // futuro, s3 senza saldo
  ];
  const l = computeLedger(movs as never, ["s1", "s2"]);
  assert.equal(l.balanceAfter.get("o1"), 1000);
  assert.equal(l.balanceAfter.get("a"), 900);
  assert.equal(l.balanceAfter.get("pre"), 900, "prima dell'apertura di s2 non cambia il totale");
  assert.equal(l.balanceAfter.get("o2"), 1400);
  assert.equal(l.balanceAfter.get("b"), 1460);
  assert.equal(l.balanceAfter.get("c"), 1485);
  assert.equal(l.balanceAfter.get("d"), 1480);
  assert.equal(l.order.has("e"), false, "s3 non è nell'ambito");
  assert.equal(computeLedger(movs as never, "s2").balanceAfter.get("b"), 560);
  // con 'all' un movimento di s3 senza saldo proprio non cambia il totale
  assert.equal(computeLedger(movs as never, "all").balanceAfter.get("e"), 1480);
  // previsione: saldo di oggi + movimenti futuri delle strutture che hanno il saldo
  const bal = computeBalances(movs as never, TODAY, ["banca"], ["s1", "s2"]);
  assert.equal(bal.banca.saldo, 900 + 560);
  assert.equal(projectBalance(movs as never, bal, TODAY, "2026-12-31", ["s1", "s2"]), 1460 + 25 - 5);
  assert.equal(projectBalance(movs as never, bal, TODAY, "2026-12-31", "all"), 1460 + 25 - 5, "s3 non ha un saldo: i suoi movimenti non contano nemmeno nella previsione");
});

test("ledger con la vecchia apertura comune: invariato con 'all', escluso dagli altri ambiti", () => {
  const movs = [open("old", "2026-10-01", 1000, undefined), mv("a", "2026-10-05", "in", 100, "s1"), mv("b", "2026-10-06", "out", 30, "s2")];
  const l = computeLedger(movs as never);
  assert.equal(l.balanceAfter.get("a"), 1100);
  assert.equal(l.balanceAfter.get("b"), 1070);
  const lS = computeLedger(movs as never, ["s1", "s2"]);
  assert.equal(lS.balanceAfter.get("a"), null, "nessun saldo senza l'apertura comune");
  assert.equal(movSid({ bookingStructureId: "s1" }), "s1");
  assert.equal(movSid({ structureId: "all" }), "");
});
