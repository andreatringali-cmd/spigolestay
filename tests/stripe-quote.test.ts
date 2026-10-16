import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Pagamento di un preventivo: i metadata della sessione sono una whitelist (kind/source non falsificabili) e la conferma
// accetta solo sessioni nate da un preventivo, con importo coerente.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; session?: unknown } };
G.__stubs = { calls: {} };
const quote = await import("../src/app/api/stripe/quote/route.ts");
const confirm = await import("../src/app/api/stripe/quote/confirm/route.ts");

const DATA_KEY = "spigolestay:data:v1";
const post = async (handler: (r: Request) => Promise<unknown>, body: unknown) => {
  const res = (await handler(new Request("https://xenora.test/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))) as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
};

test("quote: kind e source non sono falsificabili e le chiavi fuori whitelist (fee_total, ecc.) vengono scartate", async () => {
  G.__stubs.calls = {};
  const r = await post(quote.POST, { amount: 50, source: "direct", metadata: { kind: "book", source: "ota", fee_total: "99999", fee_base: "1", slug: "x", sid: "st-1", ci: "2027-01-10", co: "2027-01-12", tot: "50", dep: "50", uid: "owner-1" } });
  assert.equal(r.status, 200);
  const params = G.__stubs.calls.sessionCreate[0];
  assert.equal(params.metadata.kind, "quote");
  assert.equal(params.metadata.source, "direct");
  assert.equal(params.payment_intent_data.metadata.kind, "quote");
  assert.equal(params.metadata.fee_total, undefined);
  assert.equal(params.metadata.slug, undefined);
  assert.equal(params.metadata.sid, "st-1"); assert.equal(params.metadata.uid, "owner-1");
});

function confirmScenario(session: Record<string, unknown>) {
  const { db, client } = makeFakeDb({
    profiles: [],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify({ structures: [{ id: "st-1" }], roomTypes: [{ id: "rt-1", structureId: "st-1" }], units: [{ id: "u1", roomTypeId: "rt-1" }], guests: [], bookings: [] }) } }],
  });
  Object.assign(G.__stubs, { calls: {}, admin: client, session });
  return { state: () => JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]) };
}
const paid = (metadata: Record<string, string>, amount_total = 5000) => ({ payment_status: "paid", amount_total, metadata, payment_intent: "pi_9" });
const META = { kind: "quote", uid: "owner-1", sid: "st-1", rt: "rt-1", ci: "2027-01-10", co: "2027-01-12", tot: "50", dep: "50" };

test("conferma: una sessione che non e' di un preventivo (kind book/chatpay o con bookingId) viene rifiutata", async () => {
  for (const meta of [{ ...META, kind: "book" }, { ...META, kind: "chatpay" }, { ...META, bookingId: "b-1" }, { ...META, kind: "" }]) {
    const sc = confirmScenario(paid(meta));
    const r = await post(confirm.POST, { session_id: "cs_1" });
    assert.equal(r.status, 400, JSON.stringify(meta)); assert.equal(r.json.error, "not_a_quote");
    assert.equal(sc.state().bookings.length, 0);
  }
});

test("conferma: importo incassato diverso da quello dichiarato nei metadata = rifiutata", async () => {
  const sc = confirmScenario(paid(META, 50)); // 0,50 € pagati contro dep=50 €
  const r = await post(confirm.POST, { session_id: "cs_1" });
  assert.equal(r.status, 400); assert.equal(r.json.error, "amount_mismatch");
  assert.equal(sc.state().bookings.length, 0);
});

test("conferma: preventivo regolare = prenotazione creata", async () => {
  const sc = confirmScenario(paid(META));
  const r = await post(confirm.POST, { session_id: "cs_1" });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  assert.equal(sc.state().bookings.length, 1);
  assert.equal(sc.state().bookings[0].paid, 50);
});
