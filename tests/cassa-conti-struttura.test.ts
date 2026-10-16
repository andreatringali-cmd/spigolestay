import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const C = await import("../src/lib/cassa.ts");
const { computeAuto, computeForecast, computeBalances, balanceParts, loadConti, saveConti, loadContiPrefs, saveContiPrefs, routeFor, contoVisible, contiForScope, contiOfStructure, contiKeysInScope, contoUnassigned, contoKeyFromLabel, contoDisplayLabel, moveContoOfStructure, countOnConto, moveWithin, principalOf, OPENING_CAT } = C;

const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = v; } };
const reset = () => { for (const k of Object.keys(store)) delete store[k]; };

// 3 strutture: s1 Spigolehouse, s2 Spigolerooms, s3 Central Perk.
const NAMES: Record<string, string> = { s1: "Spigolehouse", s2: "Spigolerooms", s3: "Central Perk" };
const stx = (id: string) => ({ id, name: NAMES[id] });
const nameOf = (id: string) => NAMES[id] ?? id;
const guests = [{ id: "g1", fullName: "Anna" }];
const B = (id: string, structureId: string, o: Record<string, unknown> = {}) => ({ id, structureId, guestId: "g1", channel: "booking", status: "confirmed", checkIn: "2026-10-20", checkOut: "2026-10-22", total: 300, paid: 300, ...o });

// Conti: Spigolehouse e Spigolerooms hanno contanti, banca, carta (solo s1) e Revolut (solo s1); Central Perk ha i SUOI, anche con lo stesso nome.
const CONTI = [
  { key: "contanti", label: "Contanti", structureIds: ["s1", "s2"] },
  { key: "banca", label: "Banca", structureIds: ["s1", "s2"] },
  { key: "carta", label: "Carta / POS", structureIds: ["s1"] },
  { key: "conto-revolut", label: "Revolut", structureIds: ["s1"] },
  { key: "conto-contanti", label: "Contanti", structureIds: ["s3"] },
  { key: "conto-banca", label: "Banca", structureIds: ["s3"] },
  { key: "conto-revolut@s3", label: "Revolut", structureIds: ["s3"] },
];
const PREFS = { order: [], principal: "banca", principalBy: { s1: "conto-revolut", s3: "conto-banca" } };

test("visibilità dei conti per ambito: tutte / una / sottoinsieme; i vecchi conti non assegnati si vedono ovunque", () => {
  const keys = (scope: unknown) => contiForScope(CONTI, scope as never).map((c) => c.key);
  assert.deepEqual(keys("all"), CONTI.map((c) => c.key), "con 'Tutte' si vedono tutti i conti");
  assert.deepEqual(keys("s3"), ["conto-contanti", "conto-banca", "conto-revolut@s3"], "Central Perk non vede i conti di Spigolehouse");
  assert.deepEqual(keys("s2"), ["contanti", "banca"]);
  assert.deepEqual(keys(["s1", "s2"]), ["contanti", "banca", "carta", "conto-revolut"]);
  assert.deepEqual(keys(["s2", "s3"]), ["contanti", "banca", "conto-contanti", "conto-banca", "conto-revolut@s3"]);
  const old = { key: "conto-vecchio", label: "Vecchio" };
  for (const scope of ["all", "s1", "s3", ["s1", "s2"]]) assert.equal(contoVisible(old, scope as never), true, "non assegnato = visibile ovunque");
  assert.equal(contoVisible({ ...old, structureIds: [] }, "s1"), true, "elenco vuoto = non assegnato");
  assert.deepEqual(contiOfStructure(CONTI, "s3").map((c) => c.key), ["conto-contanti", "conto-banca", "conto-revolut@s3"]);
  assert.equal(contiOfStructure(CONTI, "").length, CONTI.length, "senza struttura nessuna restrizione");
});

test("formato salvato VECCHIO (senza strutture): si carica uguale, resta non assegnato, e salvando non aggiunge nulla", () => {
  reset();
  store["spigolestay:cassa:conti"] = JSON.stringify([{ key: "paypal", label: "PayPal", removed: true }, { key: "conto-revolut", label: "Revolut" }, { key: "banca", label: "Banca principale" }]);
  const conti = loadConti();
  assert.deepEqual(conti.map((c) => c.key), ["contanti", "banca", "carta", "conto-revolut"]);
  assert.ok(conti.every((c) => c.structureIds === undefined), "nessun conto è assegnato da solo");
  for (const scope of ["all", "s1", "s3", ["s1", "s3"]]) assert.equal(contiForScope(conti, scope as never).length, conti.length);
  saveConti(conti);
  assert.ok(!store["spigolestay:cassa:conti"].includes("structureIds"), "il formato resta quello vecchio finché non si assegna");
  // le prenotazioni di ogni struttura vanno dove andavano prima: principale globale e contanti
  const auto = computeAuto([B("o1", "s3"), B("d3", "s3", { channel: "direct", paid: 100 })] as never, guests as never, stx as never, "all");
  assert.equal(auto.find((m) => m.id === "auto-in-o1")?.conto, "banca");
  assert.equal(auto.find((m) => m.id === "auto-in-d3")?.conto, "contanti");
});

test("assegnazione alle strutture: si salva e si ricarica (anche sui conti di base), con le strutture pulite", () => {
  reset();
  saveConti([
    { key: "contanti", label: "Contanti", structureIds: ["s1", "s2"] },
    { key: "banca", label: "Banca" },
    { key: "carta", label: "Carta / POS" },
    { key: "paypal", label: "PayPal" },
    { key: "conto-revolut", label: "Revolut", structureIds: ["s1", "all", "", "s1"] },
  ]);
  const back = loadConti();
  assert.deepEqual(back.find((c) => c.key === "contanti")?.structureIds, ["s1", "s2"]);
  assert.equal(back.find((c) => c.key === "banca")?.structureIds, undefined);
  assert.deepEqual(back.find((c) => c.key === "conto-revolut")?.structureIds, ["s1"], "duplicati e valori non validi tolti");
  // dati rovinati non rompono il caricamento
  store["spigolestay:cassa:conti"] = JSON.stringify([{ key: "conto-x", label: "X", structureIds: "s1" }, { key: "conto-y", label: "Y", structureIds: [1, null] }]);
  assert.ok(loadConti().filter((c) => c.key.startsWith("conto-")).every((c) => c.structureIds === undefined));
});

test("conto principale PER STRUTTURA: preferenza propria, ripiego sul globale, mai un conto di un'altra struttura", () => {
  reset();
  assert.deepEqual(loadContiPrefs(), { order: [], principal: "banca" }, "senza preferenze: come prima");
  saveContiPrefs(PREFS);
  assert.deepEqual(loadContiPrefs().principalBy, { s1: "conto-revolut", s3: "conto-banca" });
  assert.equal(principalOf(CONTI, PREFS, "s1"), "conto-revolut");
  assert.equal(principalOf(CONTI, PREFS, "s3"), "conto-banca");
  assert.equal(principalOf(CONTI, PREFS, "s2"), "banca", "s2 non ha una preferenza: vale il globale (suo conto)");
  // il globale punta a un conto di Spigolehouse: Central Perk, senza preferenza, NON lo usa
  const p2 = { order: [], principal: "conto-revolut" };
  assert.equal(principalOf(CONTI, p2, "s3"), "conto-banca");
  assert.equal(principalOf(CONTI, p2, "s1"), "conto-revolut");
  // preferenza vecchia verso un conto sconosciuto (dati vecchi): vale come prima
  assert.equal(principalOf([{ key: "contanti", label: "Contanti" }, { key: "banca", label: "Banca" }], { order: [], principal: "conto-boh" }, "s1"), "conto-boh");
  // una struttura senza alcun conto non perde i movimenti: ripiego sull'elenco completo
  assert.equal(principalOf(CONTI, PREFS, "s9"), "banca");
});

test("incasso automatico: il conto è quello della struttura che incassa (principale, contanti, carta)", () => {
  const router = (sid: string) => routeFor(CONTI, PREFS, sid);
  const bks = [
    B("o1", "s1"), B("o2", "s2"), B("o3", "s3"),
    B("d1", "s1", { channel: "direct", paid: 100 }), B("d3", "s3", { channel: "direct", paid: 100 }),
    B("k1", "s1", { channel: "direct", paid: 80, paymentMethod: "carta" }), B("k2", "s2", { channel: "direct", paid: 80, paymentMethod: "carta" }), B("k3", "s3", { channel: "direct", paid: 80, paymentMethod: "carta" }),
    B("c3", "s3", { channel: "direct", paid: 50, paymentMethod: "contanti" }), B("c2", "s2", { channel: "direct", paid: 50, paymentMethod: "contanti" }),
  ];
  const a = computeAuto(bks as never, guests as never, stx as never, "all", router);
  const conto = (id: string) => a.find((m) => m.id === id)?.conto;
  assert.equal(conto("auto-in-o1"), "conto-revolut", "principale di Spigolehouse");
  assert.equal(conto("auto-in-o2"), "banca", "principale di Spigolerooms");
  assert.equal(conto("auto-in-o3"), "conto-banca", "principale di Central Perk");
  assert.equal(conto("auto-comm-o1"), "conto-revolut");
  assert.equal(conto("auto-comm-o3"), "conto-banca", "anche la commissione segue la struttura");
  assert.equal(conto("auto-in-d1"), "contanti");
  assert.equal(conto("auto-in-d3"), "conto-contanti", "i contanti di Central Perk sono i SUOI");
  assert.equal(conto("auto-in-c3"), "conto-contanti");
  assert.equal(conto("auto-in-c2"), "contanti");
  assert.equal(conto("auto-in-k1"), "carta", "Spigolehouse ha la carta");
  assert.equal(conto("auto-in-k2"), "banca", "senza un conto carta adatto: sul suo principale");
  assert.equal(conto("auto-in-k3"), "conto-banca");
  // nessun movimento di Central Perk finisce su un conto di Spigolehouse e viceversa
  const of3 = a.filter((m) => m.bookingStructureId === "s3").map((m) => m.conto);
  assert.ok(of3.every((k) => ["conto-contanti", "conto-banca", "conto-revolut@s3"].includes(k)));
  const of1 = a.filter((m) => m.bookingStructureId === "s1").map((m) => m.conto);
  assert.ok(of1.every((k) => ["contanti", "banca", "carta", "conto-revolut"].includes(k)));
  // previsione: stessa regola
  const f = computeForecast([B("f3", "s3", { paid: 0, checkIn: "2026-11-02" }), B("f1", "s1", { paid: 0, checkIn: "2026-11-02" })] as never, guests as never, stx as never, [], "all", "2026-10-14", "2026-12-31", router);
  assert.equal(f.find((m) => m.ref === "f3")?.conto, "conto-banca");
  assert.equal(f.find((m) => m.ref === "f1")?.conto, "conto-revolut");
  // la prenotazione spostata di camera in un'altra struttura incassa nella struttura che l'ha ricevuta
  const moved = computeAuto([B("m1", "s2", { movedFrom: { structureId: "s3" } })] as never, guests as never, stx as never, "all", router);
  assert.equal(moved.find((m) => m.id === "auto-in-m1")?.conto, "conto-banca");
});

test("il commissioni mensili tutte insieme seguono il principale della struttura", () => {
  const router = (sid: string) => routeFor(CONTI, PREFS, sid);
  const payouts = { s3: { booking: { mode: "arrival", commission: { mode: "monthly", day: 15 } } }, s1: { booking: { mode: "arrival", commission: { mode: "monthly", day: 15 } } } };
  const a = computeAuto([B("o1", "s1"), B("o3", "s3")] as never, guests as never, stx as never, "all", router, payouts as never);
  const monthly = a.filter((m) => m.id.startsWith("auto-commm-"));
  assert.equal(monthly.find((m) => m.bookingStructureId === "s3")?.conto, "conto-banca");
  assert.equal(monthly.find((m) => m.bookingStructureId === "s1")?.conto, "conto-revolut");
});

test("due strutture con un conto dallo STESSO NOME: chiavi distinte, saldi e movimenti separati, il totale è la somma", () => {
  // «Revolut» creato per s3 quando esiste già per s1: conto NUOVO, non riusato né fuso
  const k = contoKeyFromLabel("Revolut", [{ key: "conto-revolut", label: "Revolut", structureIds: ["s1"] }], "s3");
  assert.equal(k, "conto-revolut@s3");
  assert.equal(contoKeyFromLabel("Revolut", [{ key: "conto-revolut", label: "Revolut" }, { key: "conto-revolut@s3", label: "Revolut" }], "s3"), "conto-revolut@s3-2", "mai una chiave già esistente");
  assert.equal(contoKeyFromLabel("Revolut", [{ key: "conto-revolut", label: "Revolut" }]), "conto-revolut-2", "senza struttura: come prima");
  assert.equal(contoKeyFromLabel("Revolut", [{ key: "banca", label: "Banca" }], "s3"), "conto-revolut", "nessuna collisione: chiave semplice");
  assert.equal(contoKeyFromLabel("Contanti", CONTI.slice(0, 2), "s3"), "conto-contanti", "il nome 'Contanti' non riusa il conto 'contanti'");

  const mv = (id: string, date: string, kind: "in" | "out", amount: number, structureId: string, conto: string, cat = "altro") => ({ id, date, kind, cat, desc: id, amount, conto, structureId });
  const op = (id: string, date: string, amount: number, structureId: string, conto: string) => mv(id, date, "in", amount, structureId, conto, OPENING_CAT);
  const movs = [
    op("o1", "2026-10-01", 1000, "s1", "conto-revolut"), mv("a1", "2026-10-05", "out", 100, "s1", "conto-revolut"),
    op("o3", "2026-10-01", 500, "s3", "conto-revolut@s3"), mv("a3", "2026-10-06", "in", 40, "s3", "conto-revolut@s3"),
  ];
  const TODAY = "2026-10-20";
  const bal = (scope: unknown) => computeBalances(movs as never, TODAY, contiKeysInScope(CONTI, movs as never, scope as never), scope as never);
  const all = bal("all");
  assert.equal(all["conto-revolut"].saldo, 900);
  assert.equal(all["conto-revolut@s3"].saldo, 540, "Central Perk ha il suo saldo, separato");
  assert.equal(Object.values(all).reduce((s, b) => s + b.saldo, 0), 1440, "con tutte le strutture il totale è la somma");
  const s3 = bal("s3");
  assert.equal(s3["conto-revolut"], undefined, "Central Perk non vede né somma il Revolut di Spigolehouse");
  assert.equal(s3["conto-revolut@s3"].saldo, 540);
  const s1 = bal("s1");
  assert.equal(s1["conto-revolut@s3"], undefined);
  assert.equal(s1["conto-revolut"].saldo, 900);
  assert.equal(bal(["s1", "s3"])["conto-revolut"].saldo + bal(["s1", "s3"])["conto-revolut@s3"].saldo, 1440);
  // nei menu i due «Revolut» si distinguono dalle strutture
  const labels = CONTI.filter((c) => c.label === "Revolut").map((c) => contoDisplayLabel(c, CONTI, nameOf));
  assert.deepEqual(labels, ["Revolut (Spigolehouse)", "Revolut (Central Perk)"]);
  assert.equal(contoDisplayLabel(CONTI[2], CONTI, nameOf), "Carta / POS", "nome unico: invariato");
});

test("movimenti su un conto NON assegnato alla loro struttura: segnalati, mai persi dal saldo", () => {
  const m = { conto: "conto-revolut", structureId: "s3" };
  assert.equal(contoUnassigned(m, CONTI), true, "voce di Central Perk sul Revolut di Spigolehouse");
  assert.equal(contoUnassigned({ conto: "conto-revolut", structureId: "s1" }, CONTI), false);
  assert.equal(contoUnassigned({ conto: "conto-revolut", structureId: undefined }, CONTI), false, "le voci comuni non hanno l'avviso");
  assert.equal(contoUnassigned({ conto: "conto-revolut", bookingStructureId: "s3" }, CONTI), true);
  assert.equal(contoUnassigned({ conto: "conto-vecchio", structureId: "s3" }, [{ key: "conto-vecchio", label: "V" }]), false, "conto non assegnato = visibile ovunque");
  assert.equal(contoUnassigned({ conto: "sparito", structureId: "s3" }, CONTI), false, "conto eliminato: comportamento di prima");
  // il conto compare nell'ambito di s3 (con i suoi movimenti) anche se non è suo
  const movs = [{ id: "x", date: "2026-10-05", kind: "out", cat: "tasse", desc: "x", amount: 30, conto: "conto-revolut", structureId: "s3" }];
  assert.ok(contiKeysInScope(CONTI, movs as never, "s3").includes("conto-revolut"));
  assert.ok(!contiKeysInScope(CONTI, [], "s3").includes("conto-revolut"));
  assert.ok(!contiKeysInScope(CONTI, movs as never, "s2").includes("conto-revolut"), "non compare nelle altre strutture");
});

test("spostamento in blocco: solo i movimenti di UNA struttura, da un conto a un altro", () => {
  const mv = (id: string, conto: string, structureId?: string, cat = "tasse") => ({ id, conto, structureId, cat });
  const list = [mv("a", "conto-revolut", "s3"), mv("b", "conto-revolut", "s3", OPENING_CAT), mv("c", "conto-revolut", "s1"), mv("d", "banca", "s3"), mv("e", "conto-revolut", undefined), mv("f", "conto-revolut", "all")];
  const r = moveContoOfStructure(list, "s3", "conto-revolut", "conto-banca");
  assert.deepEqual(r.ids, ["a", "b"], "anche il saldo di partenza della struttura segue il suo conto");
  assert.deepEqual(r.list.map((x) => x.conto), ["conto-banca", "conto-banca", "conto-revolut", "banca", "conto-revolut", "conto-revolut"], "le altre strutture e le voci comuni restano dove sono");
  assert.deepEqual(list.map((x) => x.conto)[0], "conto-revolut", "l'originale non viene modificato");
  assert.equal(countOnConto(list, "s3", "conto-revolut"), 2);
  assert.equal(countOnConto(list, "s1", "conto-revolut"), 1);
  for (const bad of [moveContoOfStructure(list, "", "conto-revolut", "banca"), moveContoOfStructure(list, "all", "conto-revolut", "banca"), moveContoOfStructure(list, "s3", "banca", "banca"), moveContoOfStructure(list, "s3", "inesistente", "banca")]) {
    assert.deepEqual(bad.ids, []);
    assert.equal(bad.list, list, "nessun cambiamento: stessa lista");
  }
  // dopo lo spostamento il movimento non è più segnalato
  assert.equal(contoUnassigned({ conto: r.list[0].conto, structureId: "s3" }, CONTI), false);
  // e i saldi seguono: il saldo di partenza di Central Perk passa al nuovo conto
  const movs = [
    { id: "o", date: "2026-10-01", kind: "in", cat: OPENING_CAT, desc: "o", amount: 700, conto: "conto-revolut", structureId: "s3" },
    { id: "u", date: "2026-10-05", kind: "out", cat: "tasse", desc: "u", amount: 100, conto: "conto-revolut", structureId: "s3" },
  ];
  const moved = moveContoOfStructure(movs, "s3", "conto-revolut", "conto-banca").list;
  const b = computeBalances(moved as never, "2026-10-20", ["conto-revolut", "conto-banca"], "s3");
  assert.equal(b["conto-banca"].saldo, 600);
  assert.equal(b["conto-revolut"].saldo, 0);
  assert.deepEqual(balanceParts(moved as never, "2026-10-20", ["conto-revolut"], "s3"), []);
});

test("ordine dei conti nella lista di una struttura: si scambia col vicino VISIBILE", () => {
  const list = [{ key: "a" }, { key: "x" }, { key: "b" }, { key: "y" }, { key: "c" }];
  assert.deepEqual(moveWithin(list, "b", -1, ["a", "b", "c"]).map((c) => c.key), ["b", "x", "a", "y", "c"]);
  assert.deepEqual(moveWithin(list, "b", 1, ["a", "b", "c"]).map((c) => c.key), ["a", "x", "c", "y", "b"]);
  assert.equal(moveWithin(list, "a", -1, ["a", "b", "c"]), list);
  assert.equal(moveWithin(list, "c", 1, ["a", "b", "c"]), list);
});

test("salvando il saldo di partenza di una struttura, i saldi COMUNI degli stessi conti si sostituiscono da soli (solo di quei conti)", () => {
  const { openingsReplacedBy } = C;
  const op = (id: string, conto: string, structureId?: string) => ({ id, date: "2026-10-01", kind: "in", cat: OPENING_CAT, desc: id, amount: 100, conto, structureId });
  const movs = [op("c-banca", "banca"), op("c-rev", "conto-revolut"), op("c-cont", "contanti", "all"), op("s1-banca", "banca", "s1"), op("s2-banca", "banca", "s2"), op("s3-rev", "conto-revolut", "s3"), { ...op("m", "banca", "s1"), cat: "tasse" }];
  const ids = (saved: { sid: string; conto: string }[]) => openingsReplacedBy(movs as never, saved).map((m) => m.id).sort();
  // salvo Banca di s1: sostituisce il suo vecchio saldo e il saldo comune della Banca; non il Revolut comune né i saldi di s2
  assert.deepEqual(ids([{ sid: "s1", conto: "banca" }]), ["c-banca", "s1-banca"]);
  // salvo Banca e Contanti di s1 e Banca di s2
  assert.deepEqual(ids([{ sid: "s1", conto: "banca" }, { sid: "s2", conto: "banca" }, { sid: "s1", conto: "contanti" }]), ["c-banca", "c-cont", "s1-banca", "s2-banca"]);
  assert.deepEqual(ids([{ sid: "s3", conto: "conto-revolut" }]), ["c-rev", "s3-rev"]);
  assert.deepEqual(ids([]), [], "se non si salva nulla non si toglie nulla");
  assert.ok(!ids([{ sid: "s1", conto: "banca" }]).includes("m"), "i movimenti normali non si toccano mai");
});
