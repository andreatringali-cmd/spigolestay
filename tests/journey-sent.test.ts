import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { journeyOf, internalNote, stepOpensModal } = await import("../src/lib/booking-journey.ts");

const b: any = { id: "b1", structureId: "s1", channel: "booking", status: "confirmed", checkIn: "2026-10-19", checkOut: "2026-10-23", adults: 1, children: 0, total: 100, paid: 0 };
const step = (r: any, key: string) => r.steps.find((s: any) => s.key === key);

test("Check-in: rosso finché l'ospite non compila (anche dopo l'invio del messaggio), verde quando ha compilato", () => {
  const sentNotYet = journeyOf(b, { today: "2026-10-19", guideSent: false, reminderNotes: { checkin: "inviato 2 volte" } });
  assert.equal(step(sentNotYet, "checkin").state, "late");
  assert.notEqual(step(sentNotYet, "checkin").sent, true);               // niente arancione «inviato»
  assert.ok(step(sentNotYet, "checkin").detail.includes("inviato 2 volte")); // l'informazione resta
  assert.equal(step(journeyOf(b, { today: "2026-10-10", guideSent: false }), "checkin").state, "late"); // anche prima dell'arrivo
  const done = journeyOf({ ...b, webCheckin: true } as any, { today: "2026-10-19", guideSent: false });
  assert.equal(step(done, "checkin").state, "done");
});
test("Schedina Questura e ISTAT: automatiche, non cliccabili", () => {
  const r = journeyOf(b, { today: "2026-10-19", guideSent: false });
  for (const k of ["alloggiati", "istat"]) { assert.equal(step(r, k).locked, true); assert.equal(stepOpensModal(step(r, k)), false); }
});
test("Pagamento: il link inviato non lo rende fatto; Pagamento e Tassa aprono sempre le azioni", () => {
  const r = journeyOf(b, { today: "2026-10-19", guideSent: false, reminderNotes: { pay: "inviato 1 volta" } });
  assert.notEqual(step(r, "pay").state, "done");
  assert.equal(stepOpensModal({ key: "pay", state: "done" }), true);
  assert.equal(stepOpensModal({ key: "tax", state: "done" }), true);
  assert.equal(stepOpensModal({ key: "pay", state: "na" }), false);
  assert.equal(stepOpensModal({ key: "invoice", state: "done" }), false);
});
test("nota interna: via la dicitura «Importato da Octorate»", () => {
  assert.equal(internalNote("Importato da Octorate · Late arrival"), "Late arrival");
  assert.equal(internalNote("Importato da CSV"), "");
});
test("Schedina e ISTAT: verdi appena sono nelle sezioni (check-in compilato), arancioni se la schedina va corretta", () => {
  const ci: any = { ...b, webCheckin: true };
  const ctx = (schedina: any, istat: any) => ({ today: "2026-10-18", guideSent: false, schedina, istat });
  const pronta = journeyOf(ci, ctx("pronta", "pending"));
  assert.equal(step(pronta, "alloggiati").state, "done");
  assert.equal(step(pronta, "istat").state, "done");
  assert.equal(step(journeyOf(ci, ctx("da_validare", "pending")), "alloggiati").state, "late");
  assert.notEqual(step(journeyOf(ci, ctx("none", "none")), "alloggiati").state, "done");
  assert.notEqual(step(journeyOf(b, ctx("none", "pending")), "istat").state, "done"); // riga ISTAT senza check-in compilato: ancora da fare
});
test("Check-in completato: il clic apre la scheda, non porta su Adempimenti", () => {
  assert.equal(stepOpensModal({ key: "checkin", state: "done" }), true);
});
