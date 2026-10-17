import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// /gestisci (ospite): finestra di rimborso nel fuso italiano, promessa di rimborso = rimborso reale, validazione delle modifiche, email di annullamento.
register("./helpers/stubs-loader.mjs", import.meta.url);
register("./helpers/stripe-full-stub-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
process.env.STRIPE_SECRET_KEY = "sk_test_finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; rateLimited?: boolean; refundFail?: string; refundFailCode?: string } };
G.__stubs = { calls: {} };
const info = await import("../src/app/api/manage-booking/route.ts");
const cancelRoute = await import("../src/app/api/manage-booking/cancel/route.ts");
const modify = await import("../src/app/api/manage-booking/modify/route.ts");
const { refundEligible, stripeRefundPlan } = await import("../src/lib/manage-booking.ts");

const DATA_KEY = "spigolestay:data:v1";
const calls = (k: string) => G.__stubs.calls[k] ?? [];
const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);

function scenario(booking: Record<string, unknown> = {}) {
  const data = {
    structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", currency: "€", logo: "https://cdn.example/logo.png", phone: "+39 0931" }],
    roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia" }], units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }],
    guests: [{ id: "g1", firstName: "Giulia", lastName: "Rossi", email: "giulia@example.com" }],
    bookings: [{ id: "b-1", structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: day(30), checkOut: day(33), total: 300, paid: 100, refundable: true, cancelDays: 7, stripePaymentIntent: "pi_1", ...booking }],
  };
  const { db, client } = makeFakeDb({ public_sites: [{ slug: "casa", user_id: "owner-1", structure_id: "st-1" }], app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }], memberships: [], org_state: [] });
  Object.assign(G.__stubs, { calls: {}, admin: client, rateLimited: false, refundFail: undefined, refundFailCode: undefined });
  return { state: () => JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]) };
}
const call = async (fn: (r: Request) => Promise<unknown>, method: string, payload?: unknown, qs = "") => {
  const res = (await fn(new Request("https://xenora.test/api/mb" + qs, { method, headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, ...(payload ? { body: JSON.stringify(payload) } : {}) }))) as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
};
const getInfo = () => call(info.GET, "GET", undefined, "?slug=casa&b=b-1");
const doCancel = () => call(cancelRoute.POST, "POST", { slug: "casa", b: "b-1" });

// ───────────────────────── finestra gratuita nel fuso italiano ─────────────────────────
test("refundEligible: la scadenza e' arrivo meno N giorni e 'oggi' e' il giorno italiano, non UTC", () => {
  const b = { refundable: true, cancelDays: 2, checkIn: "2026-07-10" };
  assert.deepEqual(refundEligible(b, "2026-07-08T21:30:00Z"), { free: true, freeUntil: "2026-07-08" }); // 23:30 italiane dell'8: ultimo giorno
  assert.deepEqual(refundEligible(b, "2026-07-08T22:30:00Z"), { free: false, freeUntil: "2026-07-08" }); // 00:30 italiane del 9: scaduta (in UTC era ancora l'8)
  assert.equal(refundEligible(b, "2026-07-01T10:00:00Z").free, true);
});

test("refundEligible: cambio ora legale e fine mese; non rimborsabile / senza data = mai gratuita", () => {
  assert.equal(refundEligible({ refundable: true, cancelDays: 1, checkIn: "2026-03-30" }, "2026-03-28T22:59:00Z").freeUntil, "2026-03-29");
  assert.equal(refundEligible({ refundable: true, cancelDays: 3, checkIn: "2026-03-02" }, "2026-02-27T10:00:00Z").freeUntil, "2026-02-27");
  assert.equal(refundEligible({ refundable: true, cancelDays: 0, checkIn: "2026-07-10" }, "2026-07-09T10:00:00Z").free, true);
  assert.deepEqual(refundEligible({ refundable: false, cancelDays: 5, checkIn: "2026-07-10" }, "2026-07-01T10:00:00Z"), { free: false, freeUntil: null });
  assert.deepEqual(refundEligible({ refundable: true, checkIn: "" }, "2026-07-01T10:00:00Z"), { free: false, freeUntil: null });
});

test("GET /gestisci tra le 00:00 e le 02:00 italiane: la finestra scaduta risulta scaduta", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-08T22:30:00Z") });
  try {
    scenario({ checkIn: "2026-07-10", checkOut: "2026-07-12", cancelDays: 2 });
    const r = await getInfo();
    assert.equal(r.json.booking.free, false); assert.equal(r.json.booking.freeUntil, "2026-07-08"); assert.equal(r.json.booking.canRefund, false);
  } finally { mock.timers.reset(); }
});

// ───────────────────────── promessa = rimborso reale ─────────────────────────
test("stripeRefundPlan: principale + pagamenti successivi; cifra stimata = somma, mai oltre l'incassato", () => {
  assert.deepEqual(stripeRefundPlan({ paid: 300, paidOnline: 300, stripePaymentIntent: "pi_1", stripeExtraPayments: [{ pi: "pi_2", amount: 200 }] }), { main: "pi_1", extras: [{ pi: "pi_2", amount: 200 }], estimate: 300 });
  assert.equal(stripeRefundPlan({ paid: 350, paidOnline: 300, stripePaymentIntent: "pi_1", stripeExtraPayments: [{ pi: "pi_2", amount: 200 }] }).estimate, 300, "i 50 € a mano non si rimborsano da Stripe");
  assert.equal(stripeRefundPlan({ paid: 200, stripeExtraPayments: [{ pi: "pi_2", amount: 200 }, { pi: "pi_2", amount: 5 }, { pi: "", amount: 9 }] }).estimate, 200);
  assert.equal(stripeRefundPlan({ paid: 100, stripePaymentIntent: "pi_1" }).estimate, 100);
  assert.equal(stripeRefundPlan({ paid: 0, stripePaymentIntent: "pi_1" }).estimate, 0);
});

test("la promessa di rimborso di GET coincide con quello che l'annullamento rimborsa davvero (principale + saldo online)", async () => {
  for (const b of [{ paid: 300, paidOnline: 300, stripeExtraPayments: [{ pi: "pi_2", amount: 200 }] }, { paid: 350, paidOnline: 300, stripeExtraPayments: [{ pi: "pi_2", amount: 200 }] }, { paid: 100 }, { paid: 250, paidOnline: 250, stripePaymentIntent: "", stripeExtraPayments: [{ pi: "pi_9", amount: 250 }] }]) {
    scenario(b);
    const promised = (await getInfo()).json.booking.refundAmount;
    scenario(b);
    const done = (await doCancel()).json;
    assert.equal(promised, done.refunded, JSON.stringify(b));
  }
});

test("GET /gestisci: include il logo della struttura", async () => {
  scenario();
  assert.equal((await getInfo()).json.structure.logo, "https://cdn.example/logo.png");
});

// ───────────────────────── annullamento: email e rimborso gia' fatto ─────────────────────────
test("annullamento con quota non rimborsabile in automatico: l'email all'ospite riceve 'unrefunded' (la struttura lo contattera'), non 'nessun rimborso'", async () => {
  scenario({ paid: 350, paidOnline: 300, stripeExtraPayments: [{ pi: "pi_2", amount: 200 }] });
  const r = await doCancel();
  assert.equal(r.json.unrefunded, 50);
  const guest = calls("internalFetch").find((c) => c.body.kind === "cancel").body.booking;
  assert.equal(guest.refunded, 300); assert.equal(guest.unrefunded, 50); assert.equal(guest.cancelPolicy, undefined);
  const hostMail = calls("internalFetch").find((c) => c.body.kind === "notify").body; const host = hostMail.text; assert.equal(hostMail.event, "cancel");
  assert.match(host, /€ 300,00/); assert.match(host, /€ 50,00/);
});

test("annullamento senza alcun pagamento tracciato: nessun rimborso, 'unrefunded' 0 e la politica compare nell'email", async () => {
  scenario({ paid: 0, stripePaymentIntent: undefined });
  const r = await doCancel();
  assert.equal(r.json.refunded, 0); assert.equal(r.json.unrefunded, 0);
  const guest = calls("internalFetch").find((c) => c.body.kind === "cancel").body.booking;
  assert.equal(guest.unrefunded, 0); assert.match(guest.cancelPolicy, /Cancellazione gratuita fino a 7 giorni/);
});

test("pagamento gia' rimborsato del tutto dalla dashboard (charge_already_refunded): l'annullamento procede senza errore", async () => {
  const sc = scenario();
  G.__stubs.refundFail = "Charge already refunded"; G.__stubs.refundFailCode = "charge_already_refunded";
  const r = await doCancel();
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  assert.equal(sc.state().bookings[0].status, "cancelled");
});

// ───────────────────────── richiesta di modifica ─────────────────────────
const mod = (p: Record<string, unknown>) => call(modify.POST, "POST", { slug: "casa", b: "b-1", ...p });

test("modifica: partenza prima/uguale all'arrivo, arrivo nel passato, date inesistenti = 400 bad_dates e nulla viene salvato", async () => {
  const sc = scenario();
  for (const p of [{ ci: day(40), co: day(40) }, { ci: day(40), co: day(38) }, { ci: day(-3), co: day(2) }, { ci: "2027-02-30", co: "2027-03-02" }, { co: day(10) }, { ci: day(40) }, { ci: day(30), co: day(95) }]) {
    const r = await mod(p);
    assert.equal(r.status, 400, JSON.stringify(p)); assert.equal(r.json.error, "bad_dates");
  }
  assert.equal(sc.state().bookings[0].changeRequest, undefined);
  assert.equal(calls("internalFetch").length, 0);
});

test("modifica: date valide = richiesta salvata e gestore avvisato; solo un messaggio resta ammesso", async () => {
  const sc = scenario();
  assert.equal((await mod({ ci: day(40), co: day(43), message: "Possiamo spostarci?" })).status, 200);
  assert.equal(sc.state().bookings[0].changeRequest.ci, day(40));
  assert.equal(calls("internalFetch")[0].body.kind, "notify"); assert.equal(calls("internalFetch")[0].body.event, "modified"); assert.equal(calls("internalFetch")[0].body.brand.name, "Casa Ortigia");
  assert.match(calls("internalFetch")[0].body.text, /Nuove date richieste: \d{2}\.\d{2}\.\d{4} → \d{2}\.\d{2}\.\d{4}/);
  assert.equal((await mod({ message: "Solo una domanda" })).status, 200);
  assert.equal((await mod({})).json.error, "empty_request");
});

test("info prenotazione: grandTotal, balance (>= 0), cancellable e channel per la pagina /gestisci", async () => {
  scenario();
  const a = (await getInfo()).json.booking;
  assert.equal(a.grandTotal, 300); assert.equal(a.balance, 200); assert.equal(a.cancellable, true); assert.equal(a.channel, "direct");
  scenario({ paid: 450 });
  assert.equal((await getInfo()).json.booking.balance, 0, "mai negativo");
  scenario({ extras: [{ name: "Culla", price: 20 }], cleaningFee: 30 });
  const x = (await getInfo()).json.booking;
  assert.equal(x.grandTotal, 350); assert.equal(x.balance, 250);
});

test("info prenotazione: cancellable e' falso per portali, soggiorno iniziato e prenotazioni annullate", async () => {
  scenario({ channel: "booking" });
  const p = (await getInfo()).json.booking;
  assert.equal(p.cancellable, false); assert.equal(p.channel, "booking");
  scenario({ checkIn: day(-1), checkOut: day(2) });
  assert.equal((await getInfo()).json.booking.cancellable, false);
  scenario({ checkIn: day(0), checkOut: day(2) });
  assert.equal((await getInfo()).json.booking.cancellable, false, "il giorno d'arrivo non si annulla da qui (come /cancel)");
  scenario({ status: "cancelled" });
  assert.equal((await getInfo()).json.booking.cancellable, false);
});
