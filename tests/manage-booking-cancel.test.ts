import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Annullamento da parte dell'ospite (/gestisci): prima dell'arrivo, solo prenotazioni dirette, rimborso come destination charge.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; internal?: boolean; rateLimited?: boolean; refundFail?: string; refundAmount?: number } };
G.__stubs = { calls: {} };
const { POST } = await import("../src/app/api/manage-booking/cancel/route.ts");

const DATA_KEY = "spigolestay:data:v1";
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

function scenario(booking: Record<string, unknown>) {
  const data = {
    structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", currency: "€" }],
    roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia" }],
    units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }],
    guests: [{ id: "g1", firstName: "Giulia", lastName: "Rossi", email: "giulia@example.com" }],
    bookings: [{ id: "b-1", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: day(30), checkOut: day(33), total: 300, paid: 100, refundable: true, cancelDays: 7, stripePaymentIntent: "pi_1", ...booking }],
  };
  const { db, client } = makeFakeDb({
    public_sites: [{ slug: "casa-ortigia", user_id: "owner-1", structure_id: "st-1" }],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }],
    memberships: [], org_state: [],
  });
  Object.assign(G.__stubs, { calls: {}, admin: client, internal: false, rateLimited: false, refundFail: undefined, refundAmount: undefined });
  return { state: () => JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]) };
}
async function cancel() {
  const req = new Request("https://xenora.test/api/manage-booking/cancel", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ slug: "casa-ortigia", b: "b-1" }) });
  const res = (await POST(req)) as unknown as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
}

test("rimborso: sull'account piattaforma (nessun header stripeAccount) con reverse_transfer, anche senza stripeAccountId salvato", async () => {
  const sc = scenario({});
  const r = await cancel();
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.refunded, 100);
  const call = G.__stubs.calls.refund[0];
  assert.equal(call.params.payment_intent, "pi_1");
  assert.equal(call.params.reverse_transfer, true);
  assert.equal("refund_application_fee" in call.params, false);
  assert.equal(call.opts?.stripeAccount, undefined);
  const b = sc.state().bookings[0];
  assert.equal(b.status, "cancelled"); assert.equal(b.cancelledBy, "guest"); assert.equal(b.refundedAmount, 100);
});

test("rimborso fallito: la prenotazione NON viene annullata e l'ospite riceve un errore chiaro", async () => {
  const sc = scenario({});
  G.__stubs.refundFail = "No such payment_intent";
  const r = await cancel();
  assert.equal(r.status, 502); assert.equal(r.json.ok, false); assert.equal(r.json.error, "refund_failed");
  assert.match(r.json.message, /NON/);
  assert.equal(sc.state().bookings[0].status, "confirmed");
});

test("soggiorno gia' iniziato (check-in oggi o passato): annullamento rifiutato, nessun rimborso", async () => {
  for (const ci of [day(0), day(-1), day(-10)]) {
    const sc = scenario({ checkIn: ci, checkOut: day(5) });
    const r = await cancel();
    assert.equal(r.status, 409, ci); assert.equal(r.json.error, "stay_started");
    assert.equal(sc.state().bookings[0].status, "confirmed");
    assert.equal((G.__stubs.calls.refund ?? []).length, 0);
  }
});

test("canale non diretto (es. Booking.com): l'ospite non puo' annullare da qui", async () => {
  const sc = scenario({ channel: "booking" });
  const r = await cancel();
  assert.equal(r.status, 403); assert.equal(r.json.error, "not_cancellable");
  assert.equal(sc.state().bookings[0].status, "confirmed");
  assert.equal((G.__stubs.calls.refund ?? []).length, 0);
});

test("tariffa non rimborsabile: si annulla senza chiamare Stripe", async () => {
  const sc = scenario({ refundable: false });
  const r = await cancel();
  assert.equal(r.status, 200); assert.equal(r.json.refunded, 0);
  assert.equal((G.__stubs.calls.refund ?? []).length, 0);
  assert.equal(sc.state().bookings[0].status, "cancelled");
});

test("troppe richieste dallo stesso IP: 429", async () => {
  scenario({});
  G.__stubs.rateLimited = true;
  const r = await cancel();
  assert.equal(r.status, 429);
});
