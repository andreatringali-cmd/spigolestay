import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { cityTaxOfGroup, cityTaxShareOf, cityTaxOfBooking } = await import("../src/lib/booking.ts");
const { chatPayContext } = await import("../src/lib/chat-pay.ts");

// Central Perk: 4% a persona/notte, tetto 5 €, max 7 notti, minori sotto i 14 anni esenti
const CP = { id: "cp", cityTax: true, cityTaxMode: "percent", cityTaxPercent: 4, cityTaxCap: 5, cityTaxMaxNights: 7, cityTaxChildFreeUnder: 14 } as never;
const room = (id: string, o: Record<string, unknown> = {}) => ({ id, adults: 2, children: 0, checkIn: "2026-10-16", checkOut: "2026-10-17", total: 86.63, ...o });

test("due camere da 2 adulti: la tassa è calcolata una volta sul gruppo (6,93), non 3,47 + 3,47 = 6,94", () => {
  assert.equal(cityTaxOfBooking(CP, room("a") as never), 3.47);
  const rows = [room("a"), room("b")];
  assert.equal(cityTaxOfGroup(CP, rows as never), 6.93);
  const a = cityTaxShareOf(CP, rows as never, "a"), b = cityTaxShareOf(CP, rows as never, "b");
  assert.equal(Math.round((a + b) * 100), 693); // le quote sommano ESATTAMENTE il totale
  assert.deepEqual([a, b].sort(), [3.46, 3.47]);
});

test("camere con persone diverse: il costo a persona e il tetto usano tutti gli ospiti del gruppo", () => {
  const rows = [room("a", { adults: 1, total: 60 }), room("b", { adults: 3, total: 240 })];
  const g = cityTaxOfGroup(CP, rows as never);
  assert.equal(g, 12); // (300 / 4 ospiti) = 75 a persona/notte → 4% = 3 → tetto non raggiunto, × 4 persone
  const a = cityTaxShareOf(CP, rows as never, "a"), b = cityTaxShareOf(CP, rows as never, "b");
  assert.equal(Math.round((a + b) * 100), 1200);
  assert.equal(a, 3); assert.equal(b, 9); // in proporzione ai paganti
});

test("una sola camera o date diverse: nessuna fusione", () => {
  assert.equal(cityTaxOfGroup(CP, [room("a")] as never), 3.47);
  assert.equal(cityTaxShareOf(CP, [room("a")] as never, "a"), 3.47);
  const diff = [room("a"), room("b", { checkOut: "2026-10-18", total: 173.26 })];
  assert.equal(cityTaxOfGroup(CP, diff as never), Math.round((cityTaxOfBooking(CP, diff[0] as never) + cityTaxOfBooking(CP, diff[1] as never)) * 100) / 100);
});

test("link di pagamento della tassa: usa la quota del gruppo, in centesimi", () => {
  const bks = [{ ...room("a"), groupId: "g", status: "confirmed", channel: "booking", structureId: "cp", paid: 0 }, { ...room("b"), groupId: "g", status: "confirmed", channel: "booking", structureId: "cp", paid: 0 }];
  const ctxA = chatPayContext(bks[0] as never, CP, false, bks as never);
  const ctxB = chatPayContext(bks[1] as never, CP, false, bks as never);
  assert.equal(ctxA.cityTaxCents + ctxB.cityTaxCents, 693);
});

test("residuo di un gruppo: ogni camera con la sua quota di tassa, la somma è il saldo del gruppo", async () => {
  const { groupRowBalances } = await import("../src/lib/booking.ts");
  const rows = [{ ...room("a"), cleaningFee: 0, paid: 86.63 }, { ...room("b"), cleaningFee: 0, paid: 86.63 }];
  const bals = groupRowBalances(CP, rows as never);
  assert.equal(Math.round(bals.reduce((a, r) => a + r.balance * 100, 0)), 693); // camere già pagate: resta solo la tassa del gruppo
  assert.deepEqual(bals.map((r) => r.balance).sort(), [3.46, 3.47]);
});

test("contesto di gruppo: elenco e totali usano la quota del gruppo (6,93 in tutto), le prenotazioni singole restano com'erano", async () => {
  const { setGroupTaxContext, cityTaxOfBooking: ctb, bookingGrandTotal } = await import("../src/lib/booking.ts");
  const g = (id: string) => ({ ...room(id), groupId: "g", status: "confirmed", channel: "booking", structureId: "cp", cleaningFee: 0 });
  const single = { ...room("s"), status: "confirmed", channel: "booking", structureId: "cp" };
  setGroupTaxContext([g("a"), g("b"), single] as never, () => CP);
  const a = ctb(CP, g("a") as never), b = ctb(CP, g("b") as never);
  assert.equal(Math.round((a + b) * 100), 693);
  assert.equal(ctb(CP, single as never), 3.47);
  assert.equal(bookingGrandTotal(g("a") as never, CP), Math.round((86.63 + a) * 100) / 100);
  setGroupTaxContext([], () => CP); // pulizia: nessuna quota residua
  assert.equal(ctb(CP, g("a") as never), 3.47);
});

test("gruppo: la quota di tassa già incassata a parte (cityTaxPaid) non rientra nel residuo; se è dentro paid (cityTaxInPaid) sì", async () => {
  const { groupRowBalances } = await import("../src/lib/booking.ts");
  const rows = [room("a"), room("b")];
  const base = groupRowBalances(CP, rows as never);
  const aTax = base.find((r) => r.id === "a")!.tax;
  assert.ok(aTax > 0);
  const cash = groupRowBalances(CP, [room("a", { cityTaxPaid: true }), room("b")] as never);
  assert.equal(cash.find((r) => r.id === "a")!.balance, 86.63); // niente tassa
  assert.equal(cash.find((r) => r.id === "b")!.balance, base.find((r) => r.id === "b")!.balance);
  const inPaid = groupRowBalances(CP, [room("a", { cityTaxPaid: true, cityTaxInPaid: true }), room("b")] as never);
  assert.equal(inPaid.find((r) => r.id === "a")!.balance, base.find((r) => r.id === "a")!.balance);
});
