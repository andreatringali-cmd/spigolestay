import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Secondo giro QA sulle API: book/confirm solo per sessioni "book" della struttura, rimozione socio che revoca l'invito,
// pay-confirm legato a prenotazione e conto, URL di ritorno di /api/stripe/quote solo sul nostro sito, check-in con tetti.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; session?: unknown; rateLimited?: boolean } };
G.__stubs = { calls: {} };
const quote = await import("../src/app/api/stripe/quote/route.ts");
const bookConfirm = await import("../src/app/api/stripe/book/confirm/route.ts");
const payConfirm = await import("../src/app/api/checkin/pay-confirm/route.ts");
const members = await import("../src/app/api/org/members/route.ts");
const { sanitizeDoc, sanitizeInvoiceRequest } = await import("../src/lib/checkin-sanitize.ts");

const DATA_KEY = "spigolestay:data:v1";
const post = async (handler: (r: Request) => Promise<unknown>, body: unknown, headers: Record<string, string> = {}) => {
  const res = (await handler(new Request("https://xenora.test/api/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers }, body: JSON.stringify(body) }))) as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
};

// ---- stripe/quote: URL di ritorno e testi ----
// Un preventivo valido (struttura del proprietario con conto Stripe): ora la route ricava conto e importo dal server (vedi stripe-quote.test.ts).
function quoteScenario() {
  const data = { structures: [{ id: "st-1", name: "Casa", stripeAccount: "acct_REAL" }], roomTypes: [{ id: "rt-1", structureId: "st-1", name: "Doppia", basePrice: 100 }], units: [{ id: "u1", roomTypeId: "rt-1", structureId: "st-1" }], guests: [], bookings: [] };
  const { client } = makeFakeDb({ app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }], memberships: [], org_state: [] });
  G.__stubs.calls = {}; G.__stubs.admin = client; G.__stubs.rateLimited = false;
}
const validQuote = (over: Record<string, unknown> = {}) => ({ amount: 150, metadata: { sid: "st-1", rt: "rt-1", ci: "2027-05-10", co: "2027-05-13", tot: "300", dep: "150", uid: "owner-1" }, ...over });
test("quote: successUrl/cancelUrl su un altro dominio = rifiutati; sul nostro sito = ok", async () => {
  quoteScenario();
  const bad = await post(quote.POST, validQuote({ successUrl: "https://sito-falso.example/ok", cancelUrl: "https://xenora.test/x" }));
  assert.equal(bad.status, 400); assert.equal(bad.json.error, "invalid_return_url");
  const bad2 = await post(quote.POST, validQuote({ successUrl: "https://xenora.test/x", cancelUrl: "javascript:alert(1)" }));
  assert.equal(bad2.status, 400);
  assert.equal(G.__stubs.calls.sessionCreate, undefined);
  const ok = await post(quote.POST, validQuote({ successUrl: "https://xenora.test/checkin?b=1&site=a", cancelUrl: "https://xenora.test/checkin?b=1" }));
  assert.equal(ok.status, 200);
  const none = await post(quote.POST, validQuote());
  assert.equal(none.status, 200);
});

test("quote: label e desc senza link (saldo dal check-in: testi liberi del client, ripuliti)", async () => {
  const data = { structures: [{ id: "st-1", name: "Casa", stripeAccount: "acct_REAL" }], roomTypes: [{ id: "rt-1", structureId: "st-1" }], units: [], guests: [], bookings: [{ id: "b-1", structureId: "st-1", roomTypeId: "rt-1", status: "confirmed", channel: "direct", checkIn: "2027-05-10", checkOut: "2027-05-13", total: 300, paid: 0 }] };
  const { client } = makeFakeDb({ app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }], memberships: [], org_state: [] });
  G.__stubs.calls = {}; G.__stubs.admin = client; G.__stubs.rateLimited = false;
  await post(quote.POST, { amount: 5, label: "Verifica account https://evil.example/x conferma carta", desc: "vai su www.evil.example ora", metadata: { bookingId: "b-1" } });
  const li = G.__stubs.calls.sessionCreate[0].line_items[0].price_data.product_data;
  assert.ok(!/evil/.test(li.name)); assert.ok(!/evil/.test(li.description));
  assert.equal(li.name, "Verifica account conferma carta");
});

// ---- stripe/book/confirm ----
function bookScenario(session: Record<string, unknown>) {
  const { client } = makeFakeDb({
    public_sites: [{ slug: "casa", user_id: "owner-1", structure_id: "st-1" }, { slug: "altra", user_id: "owner-1", structure_id: "st-2" }],
    memberships: [], org_state: [],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify({ structures: [{ id: "st-1", stripeAccount: "acct_1" }, { id: "st-2", stripeAccount: "acct_2" }] }) } }],
  });
  Object.assign(G.__stubs, { calls: {}, admin: client, session });
}
const BOOK = { kind: "book", slug: "casa", s: "st-1", rt: "rt-1", ci: "2027-01-10", co: "2027-01-12", ad: "2", ch: "0", tot: "200", dep: "50", gn: "Anna Bianchi", ge: "a@example.com" };
const paidSess = (metadata: Record<string, string>) => ({ id: "cs_1", payment_status: "paid", amount_total: 5000, metadata, payment_intent: "pi_1" });

test("book/confirm: sessione di /api/stripe/quote (kind quote) NON crea prenotazioni", async () => {
  bookScenario(paidSess({ ...BOOK, kind: "quote", tot: "1", dep: "0.5", ci: "2026-12-01", co: "2027-11-30" }));
  const r = await post(bookConfirm.POST, { session_id: "cs_1", slug: "casa" });
  assert.equal(r.status, 400); assert.equal(r.json.error, "not_a_booking_session");
  assert.equal(G.__stubs.calls.internalFetch, undefined);
});

test("book/confirm: sessione 'book' di un'altra struttura (stesso proprietario) rifiutata", async () => {
  bookScenario(paidSess(BOOK));
  const r = await post(bookConfirm.POST, { session_id: "cs_1", slug: "altra" });
  assert.equal(r.status, 400); assert.equal(r.json.error, "not_a_booking_session");
  assert.equal(G.__stubs.calls.internalFetch, undefined);
});

test("book/confirm: sessione 'book' della struttura giusta registra la prenotazione", async () => {
  bookScenario(paidSess(BOOK));
  const r = await post(bookConfirm.POST, { session_id: "cs_1", slug: "casa" });
  assert.notEqual(r.json.error, "not_a_booking_session"); // (il finto internalFetch non ha un corpo JSON: l'esito finale non conta qui)
  assert.equal(G.__stubs.calls.internalFetch.length, 1);
  assert.equal(G.__stubs.calls.internalFetch[0].body.slug, "casa");
});

// ---- checkin/pay-confirm ----
function payScenario(session: Record<string, unknown>, stripeAccount?: string) {
  const data = {
    structures: [{ id: "st-1", name: "Casa", ...(stripeAccount ? { stripeAccount } : {}) }], roomTypes: [], units: [], guests: [{ id: "g1" }],
    bookings: [{ id: "b-A", structureId: "st-1", guestId: "g1", status: "confirmed", total: 500, paid: 0 }, { id: "b-B", structureId: "st-1", guestId: "g1", status: "confirmed", total: 500, paid: 0 }],
  };
  const { db, client } = makeFakeDb({
    public_sites: [{ slug: "casa", user_id: "owner-1", structure_id: "st-1" }], memberships: [], org_state: [],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }],
  });
  Object.assign(G.__stubs, { calls: {}, admin: client, session, rateLimited: false });
  return { paid: (id: string) => (JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]).bookings as any[]).find((b) => b.id === id).paid };
}
const saldo = (bookingId: string, dest?: string) => ({ id: "cs_9", payment_status: "paid", amount_total: 30000, metadata: { kind: "quote", bookingId }, payment_intent: dest ? { id: "pi_9", transfer_data: { destination: dest } } : "pi_9" });

test("pay-confirm: sessione pagata per la prenotazione A NON accredita la prenotazione B", async () => {
  const sc = payScenario(saldo("b-A"));
  const r = await post(payConfirm.POST, { slug: "casa", b: "b-B", session_id: "cs_9" });
  assert.notEqual(r.status, 200); assert.equal(sc.paid("b-B"), 0);
  const ok = await post(payConfirm.POST, { slug: "casa", b: "b-A", session_id: "cs_9" });
  assert.equal(ok.status, 200); assert.equal(sc.paid("b-A"), 300);
});

test("pay-confirm: con conto collegato, il pagamento deve essere arrivato a quel conto", async () => {
  const sc = payScenario(saldo("b-A", "acct_attaccante"), "acct_1");
  const r = await post(payConfirm.POST, { slug: "casa", b: "b-A", session_id: "cs_9" });
  assert.equal(r.status, 400); assert.equal(r.json.error, "session_account_mismatch"); assert.equal(sc.paid("b-A"), 0);
  const sc2 = payScenario(saldo("b-A", "acct_1"), "acct_1");
  const ok = await post(payConfirm.POST, { slug: "casa", b: "b-A", session_id: "cs_9" });
  assert.equal(ok.status, 200); assert.equal(sc2.paid("b-A"), 300);
});

// ---- org/members: rimuovere un socio revoca anche l'invito ----
test("members: 'rimuovi' toglie la membership E l'invito accettato (il vecchio link non lo riporta dentro)", async () => {
  const { db, client } = makeFakeDb({
    memberships: [{ org_id: "org-1", user_id: "owner-1", role: "owner" }, { org_id: "org-1", user_id: "socio-1", role: "member" }],
    org_state: [{ org_id: "org-1", data: { [DATA_KEY]: JSON.stringify({ structures: [{ id: "st-1" }] }) } }],
    profiles: [{ user_id: "socio-1", email: "Socio@Example.com" }],
    org_invites: [
      { org_id: "org-1", code: "c1", email: "socio@example.com", status: "accepted", accepted_by: "socio-1" },
      { org_id: "org-1", code: "c2", email: "socio@example.com", status: "accepted", accepted_by: null }, // vecchio invito senza accepted_by
      { org_id: "org-1", code: "c3", email: "altro@example.com", status: "pending" },
    ],
  });
  (client as any).auth = { getUser: async () => ({ data: { user: { id: "owner-1" } } }) };
  Object.assign(G.__stubs, { admin: client });
  const r = await post(members.POST, { structureId: "st-1", userId: "socio-1", remove: true }, { authorization: "Bearer t" });
  assert.equal(r.status, 200); assert.equal(r.json.removed, true);
  assert.deepEqual(db.tables.memberships.map((m) => m.user_id), ["owner-1"]);
  assert.deepEqual(db.tables.org_invites.map((i) => i.code), ["c3"]);
});

// ---- check-in: tetti su anagrafica e richiesta fattura ----
test("sanitizeDoc: tetti di lunghezza, tipi non stringa scartati", () => {
  const d = sanitizeDoc({ firstName: " Anna ", lastName: "B".repeat(500), sex: "FEMMINA", birthPlace: "x".repeat(5_000_000), docNumber: " AX1 ", citizenship: { a: 1 } });
  assert.equal(d.firstName, "Anna"); assert.equal(d.lastName.length, 80); assert.equal(d.sex, "F");
  assert.equal(d.birthPlace?.length, 120); assert.equal(d.docNumber, "AX1"); assert.equal(d.citizenship, undefined);
  assert.equal(sanitizeDoc(null).firstName, "");
});

test("sanitizeInvoiceRequest: solo chiavi note, testi tagliati, kind in elenco", () => {
  assert.equal(sanitizeInvoiceRequest(undefined), undefined);
  assert.equal(sanitizeInvoiceRequest([1]), undefined);
  const r = sanitizeInvoiceRequest({ wants: true, kind: "hacker", name: "N".repeat(9999), note: "y".repeat(4_000_000), extra: { deep: 1 }, vat: "IT123", country: "IT", sdiCode: "0000000" })!;
  assert.deepEqual(Object.keys(r).sort(), ["country", "name", "sdiCode", "vat", "wants"]);
  assert.equal((r.name as string).length, 120);
  assert.equal(sanitizeInvoiceRequest({ wants: "true" })!.wants, false);
  assert.equal(sanitizeInvoiceRequest({ wants: true, kind: "societa" })!.kind, "societa");
});
