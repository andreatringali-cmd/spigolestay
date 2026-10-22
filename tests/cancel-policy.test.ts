import { test } from "node:test";
import assert from "node:assert/strict";
import { CANCEL_RULES, cancelRuleOf, withStructureCancel, plansWithStructureCancel, cancelRuleText } from "../src/lib/cancel-policy.ts";
import { resolvePlanPolicy } from "../src/lib/plan-policy.ts";
import { cancelParams, CANCEL_TITLES } from "../src/lib/channex-content.ts";
import { CANCEL_POLICIES } from "../src/lib/types.ts";

const PLANS = [
  { id: "flex", name: "Flessibile", refundable: true, cancelDays: 3, deposit: "none" },
  { id: "nonref", name: "Non rimborsabile", adjPct: -10, refundable: false, deposit: "prepaid" },
  { id: "long", name: "Lunga permanenza", adjPct: -12, refundable: false, minStay: 1, deposit: "deposit", depositPct: 50, cancelDays: 5 },
];
const ctx = { roomTypeId: "r", checkIn: "2027-01-10", nights: 3, structureId: "s" };

test("regola unica: Moderata = gratis fino a 7 giorni prima", () => {
  assert.deepEqual(CANCEL_RULES.moderata, { refundable: true, days: 7 });
  assert.equal(cancelRuleText("moderata"), "Cancellazione gratuita fino a 7 giorni prima");
  assert.equal(cancelRuleText("rigida"), "Non rimborsabile");
  assert.equal(cancelRuleOf("boh"), null);
  assert.ok(CANCEL_POLICIES.find((p) => p.key === "moderata")!.desc.includes("7 giorni"));
});
test("la politica della struttura sostituisce quella dei piani (tutti i piani uguali)", () => {
  for (const p of PLANS) {
    const e = withStructureCancel(p, "moderata");
    assert.equal(e.refundable, true); assert.equal(e.cancelDays, 7);
  }
  assert.equal(plansWithStructureCancel(PLANS, "rigida").every((p) => p.refundable === false && p.cancelDays === 0), true);
  // nessuna politica scelta: i piani restano com'erano
  assert.deepEqual(plansWithStructureCancel(PLANS, undefined), PLANS);
});
test("server: rimborso e giorni vengono dalla struttura, per qualunque piano scelto", () => {
  for (const name of ["Flessibile", "Non rimborsabile", "Lunga permanenza"]) {
    const r = resolvePlanPolicy(PLANS, name, { ...ctx, cancelPolicy: "moderata" });
    assert.equal(r.found, true); assert.equal(r.refundable, true); assert.equal(r.cancelDays, 7);
  }
  // senza politica della struttura vale ancora quella del piano (comportamento di prima)
  assert.equal(resolvePlanPolicy(PLANS, "Non rimborsabile", ctx).refundable, false);
  // piano sconosciuto: sempre prepagato e non rimborsabile (non si inventa nulla)
  assert.equal(resolvePlanPolicy(PLANS, "Boh", { ...ctx, cancelPolicy: "moderata" }).refundable, false);
});
test("server: l'acconto segue il piano con la regola della struttura (stessa cifra mostrata nella pagina)", () => {
  // «Lunga permanenza» ha acconto 50%: con la struttura Moderata è rimborsabile e l'acconto resta 50%
  assert.equal(resolvePlanPolicy(PLANS, "Lunga permanenza", { ...ctx, cancelPolicy: "moderata" }).depositPct, 50);
  // con la struttura Rigida nessun rimborso e si paga tutto
  assert.equal(resolvePlanPolicy(PLANS, "Lunga permanenza", { ...ctx, cancelPolicy: "rigida" }).depositPct, 100);
});
test("Channex/Google: Moderata = 7 giorni (168 ore) con un titolo chiaro", () => {
  assert.equal(cancelParams("moderata").deadlineHours, 168);
  assert.equal(CANCEL_TITLES.moderata, "Cancellazione gratuita fino a 7 giorni prima");
  assert.equal(cancelParams("rigida").nonRefundable, true);
});

test("la tabella del server (plan-policy) coincide con quella condivisa (cancel-policy)", () => {
  for (const k of ["flessibile", "moderata", "rigida"] as const) {
    const r = resolvePlanPolicy([{ name: "X", refundable: false, cancelDays: 0 }], "X", { ...ctx, cancelPolicy: k });
    assert.equal(r.refundable, CANCEL_RULES[k].refundable, k);
    assert.equal(r.cancelDays, CANCEL_RULES[k].refundable ? CANCEL_RULES[k].days : 0, k);
  }
});
