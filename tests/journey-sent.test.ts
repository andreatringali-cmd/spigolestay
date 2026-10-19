import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { journeyOf, internalNote } = await import("../src/lib/booking-journey.ts");

const b: any = { id: "b1", structureId: "s1", channel: "booking", status: "confirmed", checkIn: "2026-10-19", checkOut: "2026-10-23", adults: 1, children: 0, total: 100, paid: 0 };
const step = (r: any, key: string) => r.steps.find((s: any) => s.key === key);

test("Check-in: dopo l'invio del messaggio il passaggio è verde (fatto), il dettaglio dice cosa manca", () => {
  const before = journeyOf(b, { today: "2026-10-19", guideSent: false });
  assert.equal(step(before, "checkin").state, "late");
  const after = journeyOf(b, { today: "2026-10-19", guideSent: false, reminderNotes: { checkin: "inviato 2 volte" } });
  assert.equal(step(after, "checkin").state, "done");
  assert.ok(step(after, "checkin").detail.includes("non ha ancora compilato") && step(after, "checkin").detail.includes("inviato 2 volte"));
});
test("Pagamento: il link inviato non lo rende fatto (resta da incassare)", () => {
  const r = journeyOf(b, { today: "2026-10-19", guideSent: false, reminderNotes: { pay: "inviato 1 volta" } });
  assert.notEqual(step(r, "pay").state, "done");
});
test("nota interna: via la dicitura «Importato da Octorate»", () => {
  assert.equal(internalNote("Importato da Octorate · Late arrival"), "Late arrival");
  assert.equal(internalNote("Importato da CSV"), "");
});

test("Check-in verde per messaggio inviato: il clic riapre l'azione (non porta ad Adempimenti)", async () => {
  const { stepOpensModal } = await import("../src/lib/booking-journey.ts");
  const after = journeyOf(b, { today: "2026-10-19", guideSent: false, reminderNotes: { checkin: "inviato 2 volte" } });
  assert.equal(stepOpensModal(step(after, "checkin")), true);
  // dati davvero completi: fatto davvero, il clic porta alla pagina
  const full = journeyOf({ ...b, webCheckin: true } as any, { today: "2026-10-19", guideSent: false });
  assert.equal(step(full, "checkin").state, "done");
  assert.equal(stepOpensModal(step(full, "checkin")), false);
});
