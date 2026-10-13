import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { planFicPayment, markFicPayment, ficHttpMessage, ficPaymentsTotal } = await import("../src/lib/invoicing/fic-payments.ts");

const cfg = { accessToken: "tok", companyId: "77" };
const one = [{ id: 11, amount: 104.96, due_date: "2026-11-12", status: "not_paid" }];

test("plan: incasso che copre il totale -> voce paid con data e conto", () => {
  const p = planFicPayment(one, { paid: true, amountEur: 104.96, paidDate: "2026-10-13", accountId: 5 });
  assert.equal(p.action, "update");
  if (p.action !== "update") return;
  assert.deepEqual(p.payments[0], { id: 11, amount: 104.96, due_date: "2026-11-12", status: "paid", paid_date: "2026-10-13", payment_account: { id: 5 } });
});

test("plan: incasso parziale -> nessuna modifica", () => {
  const p = planFicPayment(one, { paid: true, amountEur: 50, paidDate: "2026-10-13", accountId: 5 });
  assert.equal(p.action, "partial");
  assert.match(p.message, /incasso parziale non sincronizzato/);
});

test("plan: gia' pagato -> noop; senza conto -> need_account; conto gia' sulla voce riusato", () => {
  assert.equal(planFicPayment([{ id: 1, amount: 10, status: "paid" }], { paid: true, amountEur: 10, paidDate: "2026-10-13" }).action, "noop");
  assert.equal(planFicPayment(one, { paid: true, amountEur: 104.96, paidDate: "2026-10-13" }).action, "need_account");
  const p = planFicPayment([{ id: 1, amount: 10, status: "not_paid", payment_account: { id: 9, name: "X" } }], { paid: true, amountEur: 10, paidDate: "2026-10-13" });
  assert.equal(p.action, "update");
  if (p.action === "update") assert.deepEqual(p.payments[0].payment_account, { id: 9 });
});

test("plan: voci stornate intatte e non contano nel totale; rate: tutte paid solo se coperto tutto", () => {
  const list = [{ id: 1, amount: 60, status: "not_paid" }, { id: 2, amount: 40, status: "not_paid" }, { id: 3, amount: 99, status: "reversed" }];
  assert.equal(ficPaymentsTotal(list), 100);
  assert.equal(planFicPayment(list, { paid: true, amountEur: 60, paidDate: "d", accountId: 1 }).action, "partial");
  const p = planFicPayment(list, { paid: true, amountEur: 100, paidDate: "2026-10-13", accountId: 1 });
  assert.equal(p.action, "update");
  if (p.action === "update") { assert.deepEqual(p.payments.map((x) => x.status), ["paid", "paid", "reversed"]); assert.equal(p.payments.length, 3); }
});

test("plan: annulla incasso -> not_paid senza data e conto; gia' non pagato -> noop", () => {
  const p = planFicPayment([{ id: 1, amount: 10, status: "paid", paid_date: "2026-10-01", payment_account: { id: 3 } }], { paid: false, paidDate: "x" });
  assert.equal(p.action, "update");
  if (p.action === "update") assert.deepEqual(p.payments[0], { id: 1, amount: 10, status: "not_paid" });
  assert.equal(planFicPayment(one, { paid: false, paidDate: "x" }).action, "noop");
});

test("messaggi di errore leggibili", () => {
  assert.match(ficHttpMessage(401), /ricollega/);
  assert.match(ficHttpMessage(403), /permessi/);
  assert.match(ficHttpMessage(404), /non trovato/);
  assert.match(ficHttpMessage(422, { error: { message: "Validation", validation_result: { payments_list: ["Conto mancante"] } } }), /rifiutato.*Conto mancante/);
});

type Call = { method: string; url: string; body?: { data: { payments_list: Record<string, unknown>[] } } };
async function withFetch(handler: (c: Call) => Response, run: () => Promise<void>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const c: Call = { method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = real; }
  return calls;
}
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

test("markFicPayment: coperto -> GET, conti, PUT con la sola payments_list", async () => {
  let res;
  const calls = await withFetch((c) => {
    if (c.method === "GET" && c.url.includes("/issued_documents/123")) return J({ data: { id: 123, payments_list: one } });
    if (c.url.endsWith("/info/payment_accounts")) return J({ data: [{ id: 4, name: "PayPal", virtual: true }, { id: 5, name: "Banca", virtual: false }] });
    if (c.method === "PUT") return J({ data: { id: 123, items_list: [{}], payments_list: [{ id: 11, status: "paid" }] } });
    return J({}, 500);
  }, async () => { res = await markFicPayment(cfg, "fic:123", { paid: true, amount: 104.96, paidDate: "2026-10-13" }); });
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET", "PUT"]);
  assert.ok(calls[0].url.endsWith("/c/77/issued_documents/123?fieldset=detailed"));
  assert.ok(calls[2].url.endsWith("/c/77/issued_documents/123"));
  assert.deepEqual(calls[2].body, { data: { payments_list: [{ id: 11, amount: 104.96, due_date: "2026-11-12", status: "paid", paid_date: "2026-10-13", payment_account: { id: 5 } }] } });
  assert.deepEqual(res, { ok: true, changed: true, kind: "synced", message: "Segnato come pagato anche su Fatture in Cloud ✓" });
});

test("markFicPayment: parziale -> nessuna chiamata PUT", async () => {
  let res: { kind: string; message: string } | undefined;
  const calls = await withFetch(() => J({ data: { payments_list: one } }), async () => { res = await markFicPayment(cfg, "fic:123", { paid: true, amount: 20 }); });
  assert.deepEqual(calls.map((c) => c.method), ["GET"]);
  assert.equal(res?.kind, "partial");
  assert.match(res?.message ?? "", /incasso parziale non sincronizzato/);
});

test("markFicPayment: errori 403/404/422 e rete -> mai eccezioni", async () => {
  for (const [st, re] of [[403, /permessi/], [404, /non trovato/]] as const) {
    let res: { ok: boolean; message: string } | undefined;
    await withFetch(() => J({ error: { message: "x" } }, st), async () => { res = await markFicPayment(cfg, "fic:1", { paid: true, amount: 1 }); });
    assert.equal(res?.ok, false);
    assert.match(res?.message ?? "", re);
  }
  let r422: { ok: boolean; message: string } | undefined;
  await withFetch((c) => (c.method === "PUT" ? J({ error: { message: "Conto non valido" } }, 422) : J({ data: { payments_list: [{ ...one[0], payment_account: { id: 2 } }] } })), async () => { r422 = await markFicPayment(cfg, "fic:1", { paid: true, amount: 104.96 }); });
  assert.equal(r422?.ok, false);
  assert.match(r422?.message ?? "", /rifiutato.*Conto non valido/);
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("down"); }) as typeof fetch;
  try {
    const r = await markFicPayment(cfg, "fic:1", { paid: true, amount: 1 });
    assert.equal(r.ok, false);
    assert.match(r.message, /non raggiungibile/);
  } finally { globalThis.fetch = real; }
});

test("markFicPayment: annulla incasso -> PUT not_paid; id non valido -> errore senza rete", async () => {
  let res: { kind: string } | undefined;
  const calls = await withFetch((c) => (c.method === "GET"
    ? J({ data: { payments_list: [{ id: 11, amount: 5, status: "paid", paid_date: "2026-10-01", payment_account: { id: 5 } }] } })
    : J({ data: { items_list: [{}], payments_list: [{ id: 11, status: "not_paid" }] } })), async () => { res = await markFicPayment(cfg, "fic:9", { paid: false }); });
  assert.deepEqual(calls[1].body, { data: { payments_list: [{ id: 11, amount: 5, status: "not_paid" }] } });
  assert.equal(res?.kind, "synced");
  const none = await withFetch(() => J({}), async () => { const r = await markFicPayment(cfg, "fic:abc", { paid: true, amount: 1 }); assert.equal(r.ok, false); });
  assert.equal(none.length, 0);
});
