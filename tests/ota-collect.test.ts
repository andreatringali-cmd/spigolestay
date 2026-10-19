import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { balanceDue, paymentStatus, otaCoveredAmount, stayDue } = await import("../src/lib/incassi.ts");
const { effectivePayMethod, otaPayDetail, collectRuleOf } = await import("../src/lib/pay-method.ts");

const st = (rule?: Record<string, { collect?: "auto" | "ota" | "property"; payout?: "bonifico" | "carta" }>) => ({ id: "s1", name: "S", cityTax: false, channelCollect: rule }) as never;
const bk = (o: Record<string, unknown> = {}) => ({ id: "b1", structureId: "s1", channel: "booking", checkIn: "2026-11-01", checkOut: "2026-11-03", adults: 2, children: 0, total: 200, paid: 0, ...o }) as never;

test("regola del canale: l'OTA incassa → niente saldo dovuto, il soggiorno risulta pagato all'OTA", () => {
  const s = st({ booking: { collect: "ota", payout: "bonifico" } });
  assert.equal(otaCoveredAmount(bk(), s), 200);
  assert.equal(balanceDue(bk(), s), 0);
  assert.equal(stayDue(bk(), s), 0);
  assert.equal(paymentStatus(bk(), s), "saldato");
  assert.equal(effectivePayMethod(bk(), collectRuleOf(s, "booking")).method, "ota");
  assert.equal(otaPayDetail(bk(), collectRuleOf(s, "booking")), "bonifico");
});
test("senza regola (o con «incasso io»): il saldo resta quello di prima", () => {
  assert.equal(balanceDue(bk(), st()), 200);
  assert.equal(balanceDue(bk(), st({ booking: { collect: "property" } })), 200);
  assert.equal(paymentStatus(bk(), st({ booking: { collect: "auto" } })), "da incassare");
});
test("il dato della prenotazione vince sulla regola del canale", () => {
  const s = st({ booking: { collect: "ota" } });
  assert.equal(balanceDue(bk({ otaInfo: { paymentCollect: "property" } }), s), 200); // dice che incassa la struttura
  const s2 = st({ booking: { collect: "property" } });
  assert.equal(balanceDue(bk({ otaInfo: { paymentCollect: "ota" } }), s2), 0); // dice che incassa l'OTA
});
test("restano dovuti extra e pulizia aggiunti dalla struttura; l'incassato registrato non si conta due volte", () => {
  const s = st({ booking: { collect: "ota" } });
  assert.equal(balanceDue(bk({ cleaningFee: 30 }), s), 30);
  assert.equal(balanceDue(bk({ paid: 200 }), s), 0);
  assert.equal(paymentStatus(bk({ paid: 200 }), s), "saldato");
});
test("prenotazione diretta: la regola non c'entra", () => {
  assert.equal(balanceDue(bk({ channel: "direct" }), st({ direct: { collect: "ota" } })), 200);
});

test("Accelerator Fee di Expedia dalle note di Channex", async () => {
  const { otaAcceleratorFee } = await import("../src/lib/booking.ts");
  assert.equal(otaAcceleratorFee({ otaInfo: { notes: "Accelerator Fee: €18.78\nCollect Amount: €154.92\nOTA Commission: €28.14" } }), 18.78);
  assert.equal(otaAcceleratorFee({ otaInfo: { notes: "Accelerator Fee: 7,5" } }), 7.5);
  assert.equal(otaAcceleratorFee({ otaInfo: { notes: "Collect Amount: €10" } }), 0);
  assert.equal(otaAcceleratorFee({}), 0);
});

test("OTA che incassa: se `paid` arriva già al totale del soggiorno non si conta due volte; gli extra restano dovuti", () => {
  const s = st({ airbnb: { collect: "ota" } });
  const a = (o: Record<string, unknown> = {}) => bk({ channel: "airbnb", total: 300, extras: [{ name: "Culla", price: 40 }], ...o });
  assert.equal(balanceDue(a({ paid: 300 }), s), 40);   // incasso dell'OTA già registrato: restano solo gli extra
  assert.equal(balanceDue(a({ paid: 0 }), s), 40);     // non registrato: coperto dal portale, restano gli extra
  assert.equal(balanceDue(a({ paid: 40 }), s), 0);     // extra pagati in contanti
});
