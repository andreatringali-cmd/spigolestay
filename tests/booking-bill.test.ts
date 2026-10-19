import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { billOf, billMessage } = await import("../src/lib/booking-bill.ts");

const st = { id: "s1", name: "Casa", channelCollect: { booking: { collect: "ota" } } } as never;
const b = (o: Record<string, unknown> = {}) => ({ id: "b1", structureId: "s1", channel: "direct", checkIn: "2026-11-01", checkOut: "2026-11-03", adults: 2, children: 0, total: 200, paid: 0, ...o }) as never;

test("conto: soggiorno + extra personalizzati + voce libera, da pagare = totale − incassato", () => {
  const bill = billOf(b({ paid: 50, extras: [{ name: "Late checkout", price: 20 }, { name: "Culla", price: 10, qty: 2 }, { name: "Transfer", price: 35 }] }), undefined);
  assert.equal(bill.total, 265);
  assert.equal(bill.paid, 50);
  assert.equal(bill.due, 215);
  assert.deepEqual(bill.lines.map((l) => l.label), ["Soggiorno", "Late checkout", "Culla × 2", "Transfer"]);
});
test("conto OTA che incassa: il soggiorno è già pagato al portale, restano gli extra", () => {
  const bill = billOf(b({ channel: "booking", extras: [{ name: "Late checkout", price: 20 }] }), st);
  assert.equal(bill.paidAtPortal, 200);
  assert.equal(bill.due, 20);
});
test("messaggio del conto: righe, già pagato, da pagare (testo modificabile)", () => {
  const bill = billOf(b({ extras: [{ name: "Late checkout", price: 20 }] }), undefined);
  const m = billMessage(bill, { lang: "it", name: "Mario", property: "Casa" });
  assert.ok(m.startsWith("Buongiorno Mario,\necco il conto del suo soggiorno presso Casa:"));
  assert.ok(m.includes("• Soggiorno: € 200,00") && m.includes("• Late checkout: € 20,00") && m.includes("Da pagare: € 220,00") && m.endsWith("Grazie!"));
  assert.ok(billMessage(bill, { lang: "fr" }).includes("Reste à payer"));
  assert.ok(billMessage(bill, { lang: "xx" }).includes("Amount due")); // lingua sconosciuta → inglese (le altre ricevono l'inglese)
  assert.ok(!billMessage(bill, { lang: "it" }).includes("Buongiorno ,")); // senza nome: «Buongiorno,»
});
