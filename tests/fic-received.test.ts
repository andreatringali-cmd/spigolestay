import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const m = await import("../src/lib/invoicing/fic-received.ts");
const { mapFicReceivedToPassive, buildPreview, dedupStatus, extractFicIds, listFicReceivedDocuments, listAllFicReceived, FicScopeError } = m;
const { FIC_SCOPES } = await import("../src/lib/invoicing/fic-oauth.ts");

const cfg = { accessToken: "tok", companyId: "77" };

const expense = {
  id: 501, type: "expense", entity: { id: 9, name: "ENEL Energia SpA", vat_number: "IT06655971007", country_iso: "IT" },
  date: "2026-09-12", description: "Energia elettrica agosto", amount_net: 100.5, amount_vat: 22.11, amount_gross: 122.61,
  invoice_number: "FT/123", e_invoice: true, next_due_date: "2026-10-12",
  payments_list: [{ id: 1, amount: 122.61, due_date: "2026-10-12", paid_date: null, status: "not_paid" }],
};

test("FIC ricevute: lo scope di sola lettura e' tra quelli richiesti", () => {
  assert.ok(FIC_SCOPES.split(" ").includes("received_documents:r"));
  assert.ok(!FIC_SCOPES.includes("received_documents:a"));
});

test("mapping: fattura elettronica non pagata", () => {
  const d = mapFicReceivedToPassive(expense);
  assert.equal(d.supplier_name, "ENEL Energia SpA");
  assert.equal(d.supplier_vat, "IT06655971007");
  assert.equal(d.doc_number, "FT/123");
  assert.equal(d.doc_date, "2026-09-12");
  assert.equal(d.doc_type, "fattura");
  assert.equal(d.taxable_cents, 10050);
  assert.equal(d.vat_cents, 2211);
  assert.equal(d.total_cents, 12261);
  assert.equal(d.due_date, "2026-10-12");
  assert.equal(d.paid, false);
  assert.equal(d.paid_at, null);
  assert.ok(d.notes.startsWith("[fic:501]"));
  assert.deepEqual(extractFicIds(d.notes), [501]);
});

test("mapping: tutti i pagamenti saldati = pagata, con data dell'ultimo", () => {
  const d = mapFicReceivedToPassive({ ...expense, payments_list: [
    { due_date: "2026-10-01", paid_date: "2026-09-30", status: "paid" }, { due_date: "2026-10-12", paid_date: "2026-10-10", status: "paid" },
  ] });
  assert.equal(d.paid, true);
  assert.equal(d.paid_at, "2026-10-10");
});

test("mapping: un pagamento ancora da fare = non pagata, scadenza = la prima non pagata", () => {
  const d = mapFicReceivedToPassive({ ...expense, next_due_date: null, payments_list: [
    { due_date: "2026-10-01", paid_date: "2026-09-30", status: "paid" }, { due_date: "2026-11-15", status: "not_paid" },
  ] });
  assert.equal(d.paid, false);
  assert.equal(d.due_date, "2026-11-15");
});

test("mapping: nota di credito (importi positivi), spesa senza numero, nome da first/last name, chiave var_date", () => {
  const nc = mapFicReceivedToPassive({ id: 7, type: "passive_credit_note", entity: { name: "X" }, date: "2026-08-01", amount_net: -10, amount_vat: -2.2, invoice_number: "NC1" });
  assert.equal(nc.doc_type, "nota_credito");
  assert.equal(nc.total_cents, 1220);
  const sp = mapFicReceivedToPassive({ id: 8, type: "expense", entity: { first_name: "Mario", last_name: "Rossi" }, var_date: "2026-08-02", amount_net: 5, amount_vat: 0 });
  assert.equal(sp.doc_type, "spesa");
  assert.equal(sp.doc_number, null);
  assert.equal(sp.supplier_name, "Mario Rossi");
  assert.equal(sp.doc_date, "2026-08-02");
});

test("deduplica: stesso id FIC = importata; stesso fornitore+numero+anno inseriti a mano = possibile; altrimenti nuova", () => {
  const d = mapFicReceivedToPassive(expense);
  assert.equal(dedupStatus(d, []), "new");
  assert.equal(dedupStatus(d, [{ supplier_name: "x", doc_number: "1", doc_date: "2026-01-01", notes: "boh [fic:501] altro" }]), "imported");
  assert.equal(dedupStatus(d, [{ supplier_name: " enel energia spa ", doc_number: "ft/123", doc_date: "2026-02-02", notes: null }]), "possible");
  assert.equal(dedupStatus(d, [{ supplier_name: "ENEL Energia SpA", doc_number: "FT/123", doc_date: "2025-02-02", notes: null }]), "new");
  assert.equal(dedupStatus(d, [{ supplier_name: "ENEL Energia SpA", doc_number: "FT/9", doc_date: "2026-02-02", notes: "[fic:5011]" }]), "new");
});

test("anteprima: scarta id ripetuti e ordina per data decrescente", () => {
  const items = buildPreview([expense, expense, { ...expense, id: 502, date: "2026-10-01" }], [{ supplier_name: "", doc_number: null, doc_date: null, notes: "[fic:502]" }]);
  assert.deepEqual(items.map((i: { ficId: number }) => i.ficId), [502, 501]);
  assert.deepEqual(items.map((i: { status: string }) => i.status), ["imported", "new"]);
});

// ---- fetch simulato -------------------------------------------------------
async function withFetch<T>(handler: (url: string) => Response, fn: (calls: string[]) => Promise<T>): Promise<T> {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => { calls.push(String(url)); return handler(String(url)); }) as typeof fetch;
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}
const ok = (data: unknown[], extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ data, total: data.length, last_page: 1, ...extra }), { status: 200 });

test("elenco: richiesta GET con Bearer, tipo, periodo (q) e ordinamento", async () => {
  await withFetch(() => ok([expense]), async (calls) => {
    const r = await listFicReceivedDocuments(cfg, { from: "2026-07-01", to: "2026-10-13" });
    assert.equal(r.docs.length, 1);
    const u = decodeURIComponent(calls[0]);
    assert.ok(u.startsWith("https://api-v2.fattureincloud.it/c/77/received_documents?"));
    assert.ok(u.includes("type=expense"));
    assert.ok(u.includes("date >= '2026-07-01' and date <= '2026-10-13'"));
    assert.ok(u.includes("sort=-date"));
  });
});

test("elenco: 403/401 = errore chiaro di scope mancante", async () => {
  for (const status of [401, 403]) {
    await withFetch(() => new Response("{}", { status }), async () => {
      await assert.rejects(() => listFicReceivedDocuments(cfg, { from: "2026-07-01", to: "2026-10-13" }), (e: unknown) => e instanceof FicScopeError && /Ricollega Fatture in Cloud/.test((e as Error).message));
    });
  }
});

test("elenco: se FIC rifiuta q (400) si riprova senza q e il periodo e' filtrato lato nostro", async () => {
  await withFetch((u) => decodeURIComponent(u).includes("q=") ? new Response(JSON.stringify({ error: { message: "bad q" } }), { status: 400 }) : ok([expense, { ...expense, id: 1, date: "2020-01-01" }]), async (calls) => {
    const r = await listFicReceivedDocuments(cfg, { from: "2026-07-01", to: "2026-10-13" });
    assert.equal(calls.length, 2);
    assert.deepEqual(r.docs.map((d: { id: number }) => d.id), [501]); // il documento del 2020 e' fuori periodo
  });
});

test("elenco: altri errori portano il messaggio di FIC", async () => {
  await withFetch(() => new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }), async () => {
    await assert.rejects(() => listFicReceivedDocuments(cfg, { from: "2026-07-01", to: "2026-10-13" }), /500.*boom/);
  });
});

test("elenco: periodo non valido rifiutato senza chiamare FIC", async () => {
  await withFetch(() => ok([]), async (calls) => {
    await assert.rejects(() => listFicReceivedDocuments(cfg, { from: "ieri", to: "2026-10-13" }), /Periodo non valido/);
    assert.equal(calls.length, 0);
  });
});

test("listAll: scorre le pagine fino all'ultima", async () => {
  await withFetch((u) => {
    const page = Number(/page=(\d+)/.exec(u)![1]);
    return ok([{ ...expense, id: 600 + page }], { last_page: 3, current_page: page });
  }, async (calls) => {
    const all = await listAllFicReceived(cfg, { from: "2026-07-01", to: "2026-10-13", type: "expense" });
    assert.deepEqual(all.map((d: { id: number }) => d.id), [601, 602, 603]);
    assert.equal(calls.length, 3);
  });
});
