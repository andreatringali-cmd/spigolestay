import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const {
  normVat, normCf, normName, counterpartToFicClient, ficClientToCounterpart, planClientSync, listFicClients, listAllFicClients, createFicClient,
} = await import("../src/lib/invoicing/fic-clients.ts");

const cp = (o: Record<string, unknown>) => ({ id: String(Math.random()), kind: "societa", name: "X", ...o }) as never;

test("normalizzazione: P.IVA con prefisso IT e spazi, CF minuscolo, nome senza accenti e ordine parole", () => {
  assert.equal(normVat("IT 012 3456 7890"), "01234567890");
  assert.equal(normVat("it01234567890"), "01234567890");
  assert.equal(normVat("DE123456789"), "DE123456789");
  assert.equal(normCf(" rssmra80a01h501u "), "RSSMRA80A01H501U");
  assert.equal(normName("Rossi  Mario"), normName("mario ROSSI"));
  assert.equal(normName("Caffè D'Oro S.r.l."), normName("CAFFE DORO SRL"));
});

test("mapping Xenora → FIC: società italiana con SDI e PEC", () => {
  const f = counterpartToFicClient(cp({ name: "Acme Srl", vat: "01234567890", address: "Via Roma 1", cap: "96100", city: "Siracusa", province: "SR", country: "IT", sdi_code: "ABC1234", pec: "acme@pec.it", email: "a@acme.it" }));
  assert.deepEqual(f, {
    name: "Acme Srl", type: "company", vat_number: "01234567890", address_street: "Via Roma 1", address_postal_code: "96100", address_city: "Siracusa",
    address_province: "SR", email: "a@acme.it", certified_email: "acme@pec.it", country: "Italia", country_iso: "IT", e_invoice: true, ei_code: "ABC1234",
  });
});

test("mapping Xenora → FIC: privato = person con nome/cognome; codice 0000000 se manca; PA se codice a 6 caratteri; estero senza e-fattura", () => {
  const p = counterpartToFicClient(cp({ kind: "privato", name: "Mario Rossi", tax_code: "RSSMRA80A01H501U" })) as Record<string, unknown>;
  assert.equal(p.type, "person"); assert.equal(p.first_name, "Mario"); assert.equal(p.last_name, "Rossi"); assert.equal(p.ei_code, "0000000");
  const single = counterpartToFicClient(cp({ kind: "privato", name: "Madonna" })) as Record<string, unknown>;
  assert.equal(single.first_name, undefined);
  assert.equal((counterpartToFicClient(cp({ name: "Comune", sdi_code: "UFABCD" })) as Record<string, unknown>).type, "pa");
  const e = counterpartToFicClient(cp({ kind: "estero", name: "Hotel GmbH", vat: "DE123456789", country: "DE" })) as Record<string, unknown>;
  assert.equal(e.country_iso, "DE"); assert.equal(e.e_invoice, undefined); assert.equal(e.ei_code, undefined);
});

test("mapping FIC → Xenora: person → privato, società, estero, codice destinatario di default scartato", () => {
  const a = ficClientToCounterpart({ type: "person", first_name: "Mario", last_name: "Rossi", tax_code: "RSSMRA80A01H501U", country_iso: "IT", ei_code: "0000000" });
  assert.equal(a.kind, "privato"); assert.equal(a.name, "Mario Rossi"); assert.equal(a.sdi_code, null); assert.equal(a.country, "IT");
  const b = ficClientToCounterpart({ type: "company", name: "Acme Srl", vat_number: "01234567890", address_street: "Via Roma 1", address_postal_code: "96100", address_city: "Siracusa", address_province: "SR", country: "Italia", ei_code: "ABC1234", certified_email: "acme@pec.it" });
  assert.equal(b.kind, "societa"); assert.equal(b.country, "IT"); assert.equal(b.sdi_code, "ABC1234"); assert.equal(b.pec, "acme@pec.it"); assert.equal(b.cap, "96100");
  const c = ficClientToCounterpart({ type: "company", name: "Hotel GmbH", country_iso: "DE" });
  assert.equal(c.kind, "estero"); assert.equal(c.country, "DE");
});

test("abbinamento per P.IVA (anche con prefisso IT e nome diverso): non si ricrea né si reimporta", () => {
  const plan = planClientSync(
    [cp({ id: "1", name: "Acme Srl", vat: "01234567890" })],
    [{ id: 10, name: "ACME S.R.L. (sede)", vat_number: "IT01234567890" }],
  );
  assert.equal(plan.toSend.length, 0); assert.equal(plan.toImport.length, 0); assert.equal(plan.aligned, 1);
});

test("abbinamento per codice fiscale (anche CF di società = P.IVA incrociati)", () => {
  const p1 = planClientSync([cp({ id: "1", kind: "privato", name: "Mario Rossi", tax_code: "rssmra80a01h501u" })], [{ id: 1, type: "person", name: "Rossi Mario Giovanni", tax_code: "RSSMRA80A01H501U" }]);
  assert.equal(p1.toSend.length, 0); assert.equal(p1.toImport.length, 0);
  const p2 = planClientSync([cp({ id: "2", name: "Bar Sole", vat: "01234567890" })], [{ id: 2, name: "Bar Sole di Neri", tax_code: "01234567890" }]);
  assert.equal(p2.toSend.length, 0); assert.equal(p2.toImport.length, 0);
});

test("abbinamento per nome normalizzato solo se senza identificativi fiscali in conflitto", () => {
  const same = planClientSync([cp({ id: "1", name: "Booking.com B.V." })], [{ id: 1, name: "booking.com bv", vat_number: "NL805734958B01" }]);
  assert.equal(same.toSend.length, 0); assert.equal(same.toImport.length, 0);
  const conflict = planClientSync([cp({ id: "2", name: "Mario Rossi Srl", vat: "01234567890" })], [{ id: 2, name: "Mario Rossi Srl", vat_number: "09876543210" }]);
  assert.equal(conflict.toSend.length, 1); assert.equal(conflict.toImport.length, 1);
});

test("piano: manca da una parte → da inviare / da importare; doppioni dello stesso elenco esclusi", () => {
  const plan = planClientSync(
    [cp({ id: "a", name: "Solo Xenora", vat: "11111111111" }), cp({ id: "b", name: "Solo Xenora (bis)", vat: "11111111111" }), cp({ id: "c", name: "Comune", vat: "22222222222" }), cp({ id: "d", name: "" })],
    [{ id: 1, name: "Comune", vat_number: "22222222222" }, { id: 2, name: "Solo FIC", vat_number: "33333333333" }, { id: 3, name: "Solo FIC srl", vat_number: "33333333333" }],
  );
  assert.deepEqual(plan.toSend.map((c: { id: string }) => c.id), ["a"]);
  assert.equal(plan.duplicatesXenora.length, 1);
  assert.deepEqual(plan.toImport.map((f: { id: number }) => f.id), [2]);
  assert.equal(plan.duplicatesFic.length, 1);
  assert.equal(plan.aligned, 1);
});

function mockFetch(handler: (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Response) {
  const calls: { url: string; method: string; body?: Record<string, unknown>; auth?: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined, auth: init?.headers?.Authorization });
    return handler(String(url), init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const cfg = { accessToken: "tok", companyId: "77" };

test("listFicClients / listAllFicClients: URL, intestazioni e paginazione", async () => {
  const m = mockFetch((url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    return new Response(JSON.stringify({ current_page: page, last_page: 2, total: 3, data: page === 1 ? [{ id: 1, name: "A" }, { id: 2, name: "B" }] : [{ id: 3, name: "C" }] }), { status: 200 });
  });
  try {
    const one = await listFicClients(cfg, 1);
    assert.equal(one.clients.length, 2); assert.equal(one.lastPage, 2);
    assert.match(m.calls[0].url, /\/c\/77\/entities\/clients\?/);
    assert.match(m.calls[0].url, /fieldset=detailed/); assert.match(m.calls[0].url, /per_page=100/);
    assert.equal(m.calls[0].auth, "Bearer tok");
    const all = await listAllFicClients(cfg);
    assert.deepEqual(all.clients.map((c: { id: number }) => c.id), [1, 2, 3]); assert.equal(all.truncated, false);
  } finally { m.restore(); }
});

test("createFicClient: POST con body { data }, restituisce l'id; errore FIC → eccezione leggibile", async () => {
  let fail = false;
  const m = mockFetch(() => fail
    ? new Response(JSON.stringify({ error: { message: "Validation error", validation_result: { vat_number: ["non valida"] } } }), { status: 422 })
    : new Response(JSON.stringify({ data: { id: 555, name: "Acme" } }), { status: 200 }));
  try {
    const r = await createFicClient(cfg, { name: "Acme", type: "company" });
    assert.equal(r.id, 555);
    assert.equal(m.calls[0].method, "POST"); assert.match(m.calls[0].url, /\/c\/77\/entities\/clients$/);
    assert.deepEqual(m.calls[0].body, { data: { name: "Acme", type: "company" } });
    fail = true;
    await assert.rejects(() => createFicClient(cfg, { name: "Acme" }), /422.*Validation error.*non valida/);
  } finally { m.restore(); }
});
