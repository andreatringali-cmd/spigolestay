import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// /api/public-booking: politica di cancellazione dal piano (anche per chiamate anonime), validazione di email/date/lunghezze,
// voucher completo, avviso al titolare (rispetta il toggle), "prenotata il" nel fuso italiano.
register("./helpers/stubs-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; internal?: boolean; rateLimited?: boolean } };
G.__stubs = { calls: {} };
const { POST } = await import("../src/app/api/public-booking/route.ts");

const DATA_KEY = "spigolestay:data:v1";
const calls = (k: string) => G.__stubs.calls[k] ?? [];
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

function scenario(opts: { st?: Record<string, unknown>; blobExtra?: Record<string, string>; internal?: boolean } = {}) {
  const data = {
    structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", currency: "€", photoColor: "#112233", address: "Via Roma", streetNumber: "1", city: "Siracusa", ...(opts.st ?? {}) }],
    roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia", beds: 2, basePrice: 100 }],
    units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1", name: "Allegra" }], guests: [] as any[], bookings: [] as any[],
  };
  const { db, client } = makeFakeDb({
    public_sites: [{ slug: "casa-ortigia", user_id: "owner-1", structure_id: "st-1" }],
    app_state: [{ user_id: "owner-1", rev: 1, data: { [DATA_KEY]: JSON.stringify(data), ...(opts.blobExtra ?? {}) } }], memberships: [], org_state: [],
  });
  Object.assign(G.__stubs, { calls: {}, admin: client, internal: !!opts.internal, rateLimited: false });
  return { db, state: () => JSON.parse((db.tables.app_state[0].data as any)[DATA_KEY]) };
}
const body = (o: Record<string, unknown> = {}) => ({
  slug: "casa-ortigia", rt: "rt-dbl", ci: day(30), co: day(33), adults: 2, children: 0, total: 300, token: "tok-1", planName: "Flessibile",
  guest: { firstName: "Giulia", lastName: "Rossi", email: "giulia@example.com", phone: "+393331112233", country: "IT" }, ...o,
});
async function post(b: Record<string, unknown>) {
  const res = (await POST(new Request("https://xenora.test/api/public-booking", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify(b) }))) as unknown as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
}
const voucher = () => calls("internalFetch").find((c) => c.body.kind === "voucher");
const notify = () => calls("internalFetch").find((c) => c.body.kind === "notify");

test("email dell'ospite non valida = 400 bad_email e nulla viene scritto; email assente resta ammessa", async () => {
  const sc = scenario();
  for (const email of ["non-una-email", "a@b", "a b@c.it", "<script>@x.it"]) {
    const r = await post(body({ guest: { firstName: "G", lastName: "R", email } }));
    assert.equal(r.status, 400, email); assert.equal(r.json.error, "bad_email");
  }
  assert.equal(sc.state().bookings.length, 0);
  assert.equal((await post(body({ guest: { firstName: "G" }, token: "senza-mail" }))).status, 200);
});

test("date impossibili (30 febbraio) = 400 anche se il formato e' giusto", async () => {
  const sc = scenario();
  const y = new Date().getUTCFullYear() + 1;
  assert.equal((await post(body({ ci: `${y}-02-30`, co: `${y}-03-02` }))).status, 400);
  assert.equal((await post(body({ ci: `${y}-13-01`, co: `${y}-13-03` }))).status, 400);
  assert.equal(sc.state().bookings.length, 0);
});

test("lunghezze limitate: nome/cognome 80, telefono 30, Paese 60; caratteri di controllo tolti", async () => {
  const sc = scenario();
  await post(body({ guest: { firstName: "N".repeat(500), lastName: "C\u0007" + "x".repeat(500), email: "a@b.it", phone: "3".repeat(200), country: "P".repeat(200) } }));
  const g = sc.state().guests[0];
  assert.equal(g.firstName.length, 80); assert.ok(g.lastName.length <= 80); assert.ok(!/[\u0000-\u001f]/.test(g.lastName)); assert.equal(g.phone.length, 30); assert.equal(g.country.length, 60);
});

test("la nota dell'ospite non viene troncata a 500 caratteri (fino a 1500)", async () => {
  const sc = scenario();
  const nota = "Arrivo tardi, " + "richiesta ".repeat(100) + "FINE";
  await post(body({ note: nota }));
  assert.ok(sc.state().bookings[0].note.endsWith("FINE")); assert.ok(nota.length > 500 && nota.length < 1500);
  await post(body({ note: "y".repeat(4000), token: "t2", ci: day(40), co: day(42) }));
  assert.equal(sc.state().bookings[1].note.length, 1500);
});

test("politica di cancellazione: anche l'anonimo la ottiene — dal PIANO del proprietario, non da quello che dichiara", async () => {
  const plans = [{ id: "p", name: "Standard", refundable: true, cancelDays: 10, deposit: "none", minStay: 1 }, { id: "n", name: "Super", refundable: false, minStay: 1 }];
  const sc = scenario({ blobExtra: { "spigolestay:rateplans": JSON.stringify(plans) } });
  await post(body({ planName: "Standard", refundable: false, cancelDays: 99, token: "a" }));
  await post(body({ planName: "Super", refundable: true, cancelDays: 5, token: "b", ci: day(40), co: day(42) }));
  await post(body({ planName: "Inventato", refundable: true, cancelDays: 5, token: "c", ci: day(50), co: day(52) }));
  const [a, b, c] = sc.state().bookings;
  assert.deepEqual([a.refundable, a.cancelDays], [true, 10]);
  assert.deepEqual([b.refundable, b.cancelDays], [undefined, undefined]);
  assert.deepEqual([c.refundable, c.cancelDays], [undefined, undefined], "piano sconosciuto = non rimborsabile");
  assert.equal(a.paid, 0, "il rimborso resta subordinato a paid>0 e al PaymentIntent: l'anonimo non ne ha");
  assert.equal(a.stripePaymentIntent, undefined);
});

test("voucher: acconto versato, tassa di soggiorno, camera assegnata, stato, richieste e totali", async () => {
  scenario({ internal: true, st: { cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2 } });
  await post(body({ deposit: 90, stripePaymentIntent: "pi_1", refundable: true, cancelDays: 3, note: "Culla per favore" }));
  const b = voucher()!.body.booking;
  assert.equal(b.paid, 90); assert.equal(b.cityTaxAmount, 12); assert.equal(b.grandTotal, 312); assert.equal(b.due, 222);
  assert.equal(b.unitName, "Allegra"); assert.equal(b.status, "confirmed"); assert.equal(b.guestRequests, "Culla per favore");
  assert.equal(b.refundable, true); assert.equal(b.cancelDays, 3);
  assert.equal(b.guestName, "Giulia Rossi"); // nomi di campo esistenti invariati
  assert.ok("structureName" in b && "checkIn" in b && "ratePlan" in b && "cancelPolicy" in b);
});

test("avviso al TITOLARE: nuova prenotazione dal sito, con brand, canale Diretto, testo e link alla prenotazione", async () => {
  const sc = scenario();
  await post(body({ note: "Arrivo alle 22" }));
  const n = notify()!.body;
  assert.equal(n.to, "info@casa.example"); assert.equal(n.event, "newBooking"); assert.equal(n.channelLabel, "Diretto");
  assert.equal(n.brand.name, "Casa Ortigia"); assert.equal(n.brand.color, "#112233"); assert.equal(n.brand.address, "Via Roma 1 Siracusa");
  assert.match(n.text, /Giulia Rossi/); assert.match(n.text, /Arrivo: \d{2}\.\d{2}\.\d{4}/); assert.match(n.text, /Richieste dell'ospite: Arrivo alle 22/);
  assert.equal(n.ctaUrl, `https://test.xenora.local/prenotazioni?b=${sc.state().bookings[0].id}`); assert.equal(n.ctaLabel, "Apri la prenotazione");
  assert.match(n.subject, /Nuova prenotazione/);
});

test("avviso al titolare: spento se 'Nuove prenotazioni' e' disattivato; nessun avviso se la prenotazione e' rifiutata", async () => {
  scenario({ blobExtra: { "spigolestay:notifs": JSON.stringify({ newBooking: false }) } });
  await post(body());
  assert.equal(notify(), undefined); assert.ok(voucher(), "il voucher all'ospite parte comunque");
  scenario();
  await post(body({ guest: { email: "non-valida" } }));
  assert.equal(calls("internalFetch").length, 0);
});

test("'prenotata il' e' il giorno di calendario italiano (non UTC): 22:30 UTC del 10 giugno = 11 giugno in Italia", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-10T22:30:00Z") });
  try {
    const sc = scenario({ internal: true });
    const r = await post(body({ ci: "2026-07-10", co: "2026-07-12", deposit: 50, stripePaymentIntent: "pi_1" }));
    assert.equal(r.status, 200);
    const b = sc.state().bookings[0];
    assert.equal(b.bookedOn, "2026-06-11"); assert.equal(b.paidAt, "2026-06-11");
  } finally { mock.timers.reset(); }
});

test("'oggi' per le date e' quello italiano: dopo mezzanotte italiana l'arrivo di 'ieri' (UTC) non e' piu' tollerato come oggi", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-10T22:30:00Z") }); // in Italia e' gia' l'11
  try {
    scenario();
    assert.equal((await post(body({ ci: "2026-06-10", co: "2026-06-12", total: undefined }))).status, 200, "ieri (10) e' ancora tollerato");
    assert.equal((await post(body({ ci: "2026-06-09", co: "2026-06-12", token: "t2", total: undefined }))).json.error, "bad_dates");
  } finally { mock.timers.reset(); }
});
