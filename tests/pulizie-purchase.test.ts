import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const P = await import("../src/lib/pulizie-purchase.ts");

const TENANT = "11111111-2222-4333-8444-555555555555";
const ORDER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const base = { id: ORDER, date: "2026-10-14T09:30:00", name: "Carta igienica", qty: 12, cost: 18.5, structureId: "st1", conto: "carta" };

test("movimento di Prima nota da un acquisto: uscita, Forniture, importo in centesimi, data dell'acquisto, id = id dell'acquisto", () => {
  const r = P.buildPurchaseMovement(base, TENANT);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.row, { id: ORDER, tenant_id: TENANT, structure_id: "st1", date: "2026-10-14", kind: "out", cat: "forniture", descr: "Materiale: Carta igienica × 12", amount_cents: 1850, conto: "carta" });
});

test("movimento: quantità con virgola, spazi normalizzati, conto sconosciuto → contanti, senza struttura → null", () => {
  const r = P.buildPurchaseMovement({ ...base, name: "  Detersivo   vetri ", qty: 1.5, conto: "conto-strano", structureId: undefined }, TENANT);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.row.descr, "Materiale: Detersivo vetri × 1,5");
  assert.equal(r.row.conto, "contanti");
  assert.equal(r.row.structure_id, null);
});

test("movimento: senza importo (o a zero) non si crea nulla; dati non validi sono rifiutati", () => {
  for (const cost of [undefined, 0, -3, Number.NaN]) assert.equal(P.buildPurchaseMovement({ ...base, cost }, TENANT).ok, false);
  assert.equal(P.buildPurchaseMovement({ ...base, id: "non-uuid" }, TENANT).ok, false);
  assert.equal(P.buildPurchaseMovement({ ...base, name: "  " }, TENANT).ok, false);
  assert.equal(P.buildPurchaseMovement({ ...base, qty: 0 }, TENANT).ok, false);
  assert.equal(P.buildPurchaseMovement({ ...base, date: "14/10/2026" }, TENANT).ok, false);
  assert.equal(P.buildPurchaseMovement(base, "xyz").ok, false);
});

test("idempotenza: lo stesso acquisto dà sempre lo stesso movimento (stesso id e stessi dati)", () => {
  const a = P.buildPurchaseMovement(base, TENANT);
  const b = P.buildPurchaseMovement({ ...base }, TENANT);
  assert.deepEqual(a, b);
  if (a.ok) assert.equal(a.row.id, base.id);
});

test("createPurchaseOrder: con importo parte 'pending' col conto scelto; senza importo nessun collegamento", () => {
  const rc = { path: `${TENANT}/${ORDER}.jpg`, name: "scontrino.jpg", type: "image/jpeg" };
  const withCost = P.createPurchaseOrder({ id: ORDER, productName: "Spugne", structureId: "st1", date: "2026-10-14T10:00:00", qty: 3, cost: 4.2, conto: "banca", receipt: rc, nowMs: 1 });
  assert.equal(withCost.cash, "pending");
  assert.equal(withCost.payConto, "banca");
  assert.deepEqual(withCost.receipt, rc);
  assert.equal(withCost.source, "addetta");
  const noCost = P.createPurchaseOrder({ id: ORDER, productName: "Spugne", structureId: "st1", date: "2026-10-14T10:00:00", qty: 3, nowMs: 1 });
  assert.equal(noCost.cash, undefined);
  const zero = P.createPurchaseOrder({ id: ORDER, productName: "Spugne", structureId: "st1", date: "2026-10-14T10:00:00", qty: 3, cost: 0, nowMs: 1 });
  assert.equal(zero.cash, undefined);
  assert.equal(P.createPurchaseOrder({ id: ORDER, productName: "x", structureId: "s", date: "2026-10-14T10:00:00", qty: 1, cost: 2, conto: "paypal", nowMs: 1 }).payConto, "contanti");
});

test("planCashSync: crea solo i 'pending' con importo; togli solo i 'done' eliminati; gli acquisti vecchi (senza cash) non si toccano", () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const o = (n: number, extra: Record<string, unknown>) => ({ id: id(n), productId: "", productName: "x", structureId: "s", date: "2026-10-01T10:00:00", qty: 1, cost: 5, source: "addetta", ...extra });
  const orders = [
    o(1, { cash: "pending" }),
    o(2, { cash: "pending", _deleted: true }),
    o(3, { cash: "done" }),
    o(4, { cash: "done", _deleted: true }),
    o(5, {}),                              // vecchio: potrebbe essere già in Cassa a mano
    o(6, { _deleted: true }),              // vecchio eliminato
    o(7, { cash: "pending", cost: undefined }),
    o(8, { cash: "failed" }),
  ] as never[];
  const plan = P.planCashSync(orders);
  assert.deepEqual(plan.create.map((x: { id: string }) => x.id), [id(1)]);
  assert.deepEqual(plan.remove.map((x: { id: string }) => x.id), [id(4)]);
  // dopo la registrazione non c'è più nulla da fare: ripetere non produce altro lavoro
  const after = P.markCash(orders, new Set([id(1)]), "done", 99);
  assert.deepEqual(P.planCashSync(after).create, []);
  assert.equal(after.find((x: { id: string }) => x.id === id(1))!.updatedAt, 99);
});

test("receiptsByMovement: dal movimento (stesso id dell'acquisto) allo scontrino", () => {
  const rc = { path: `${TENANT}/${ORDER}.pdf`, name: "s.pdf", type: "application/pdf" };
  const m = P.receiptsByMovement([{ id: ORDER, receipt: rc, cash: "done" }, { id: "x", cash: "done" }, { id: "y", receipt: rc, cash: "done", _deleted: true }] as never[]);
  assert.deepEqual(m.get(ORDER), rc);
  assert.equal(m.size, 1);
});

test("validazione file scontrino: tipi ammessi, dimensione, vuoto", () => {
  assert.deepEqual(P.validateReceiptFile({ type: "image/jpeg", size: 300_000 }), { ok: true, ext: "jpg", type: "image/jpeg" });
  assert.equal(P.validateReceiptFile({ type: "application/pdf", size: 1000 }).ok, true);
  assert.equal(P.validateReceiptFile({ type: "image/webp; charset=x", size: 1000 }).ok, true);
  assert.equal(P.validateReceiptFile({ type: "image/svg+xml", size: 1000 }).ok, false);
  assert.equal(P.validateReceiptFile({ type: "text/html", size: 1000 }).ok, false);
  assert.equal(P.validateReceiptFile({ type: "image/png", size: 0 }).ok, false);
  assert.equal(P.validateReceiptFile({ type: "image/png", size: P.RECEIPT_MAX_BYTES + 1 }).ok, false);
  assert.equal(P.validateReceiptFile({ type: "image/png", size: P.RECEIPT_MAX_BYTES }).ok, true);
});

test("firma del file: il tipo reale deve essere JPEG/PNG/WebP/PDF", () => {
  assert.equal(P.sniffReceiptType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(P.sniffReceiptType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(P.sniffReceiptType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(P.sniffReceiptType(new TextEncoder().encode("%PDF-1.7\n")), "application/pdf");
  assert.equal(P.sniffReceiptType(new TextEncoder().encode("<html><script>")), null);
  assert.equal(P.sniffReceiptType(new Uint8Array(0)), null);
});

test("percorso scontrino: solo file dell'account, niente '..' né altri tenant", () => {
  const other = "99999999-2222-4333-8444-555555555555";
  const f = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
  const path = P.receiptPathFor(TENANT, f, "jpg");
  assert.equal(path, `${TENANT}/${f}.jpg`);
  assert.equal(P.isReceiptPathOf(TENANT, path), true);
  assert.equal(P.isReceiptPathOf(other, path), false);
  assert.equal(P.isReceiptPathOf(TENANT, `${TENANT}/../${other}/${f}.jpg`), false);
  assert.equal(P.isReceiptPathOf(TENANT, `${TENANT}/${f}.exe`), false);
  assert.equal(P.isReceiptPathOf(TENANT, `${TENANT}x/${f}.jpg`), false);
  assert.equal(P.isReceiptPathOf(TENANT, undefined), false);
  assert.equal(P.isReceiptPathOf("non-uuid", "non-uuid/" + f + ".jpg"), false);
});

test("riduzione foto: lato lungo a 1600, proporzioni mantenute, mai ingrandire", () => {
  assert.deepEqual(P.fitWithin(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(P.fitWithin(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(P.fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(P.fitWithin(0, 10), { width: 0, height: 0 });
});

test("nome file pulito e UUID generati validi", () => {
  assert.equal(P.cleanFileName("C:\\foto\\scontrino 1.jpg"), "scontrino 1.jpg");
  assert.equal(P.cleanFileName(""), "scontrino");
  assert.equal(P.cleanFileName("a".repeat(200)).length, 80);
  for (let i = 0; i < 5; i++) assert.equal(P.isUuid(P.newUuid()), true);
});
