import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// La chiave Channex va impostata PRIMA di caricare i moduli (si legge all'import). La coda con limite 20/min è sostituita da un passa-avanti (stubs-loader).
register("./helpers/stubs-loader.mjs", import.meta.url);
process.env.CHANNEX_API_KEY = "chiave-di-prova";
const { summarizeRevision, reconcileBookings, revisionCommission } = await import("../src/lib/channex-reconcile.ts");
const { getLatestRevisionOfBooking } = await import("../src/lib/channex.ts");

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const rev = (o: Record<string, unknown> = {}): any => ({
  id: "rev-1", property_id: "prop-1", booking_id: "bk-12345678", status: "modified", ota_reservation_code: "4812345678", ota_name: "Booking.com",
  arrival_date: "2026-10-20", departure_date: "2026-10-23", amount: "346.60", currency: "EUR", ota_commission: "51.99",
  rooms: [{ room_type_id: "chx-dbl", checkin_date: "2026-10-20", checkout_date: "2026-10-23", days: { "2026-10-20": "115.50", "2026-10-21": "115.50", "2026-10-22": "115.60" } }],
  ...o,
});

// ── cifre esatte da una revision ──
test("summarizeRevision: totale con i centesimi, commissione ota_commission e costo d'incasso dalle note", () => {
  const s = summarizeRevision(rev({ notes: "Payment charge is EUR 5.20" }));
  assert.equal(s.ok, true);
  assert.equal(s.id, "bk-12345678");
  assert.equal(s.status, "modified");
  assert.equal(s.total, 346.6);
  assert.equal(s.commissionAmount, 51.99);
  assert.equal(s.paymentFee, 5.2);
  assert.deepEqual(s.rooms, [{ checkIn: "2026-10-20", checkOut: "2026-10-23", total: 346.6, commissionAmount: 51.99, paymentFee: 5.2 }]);
});
test("summarizeRevision: senza ota_commission (né commission) la commissione è assente; commission vale come ripiego", () => {
  const s = summarizeRevision(rev({ ota_commission: undefined }));
  assert.equal(s.commissionAmount, undefined);
  assert.equal(s.rooms![0].commissionAmount, undefined);
  assert.equal(s.total, 346.6);
  assert.equal(summarizeRevision(rev({ ota_commission: undefined, commission: 12.5 })).commissionAmount, 12.5);
  assert.equal(revisionCommission({ ota_commission: "0" }), undefined);
  assert.equal(revisionCommission({ ota_commission: "abc" }), undefined);
});
test("summarizeRevision: più camere → commissione ripartita con splitCommission (la somma torna al centesimo)", () => {
  const s = summarizeRevision(rev({
    amount: "300.00", ota_commission: "45.00",
    rooms: [
      { room_type_id: "a", checkin_date: "2026-10-20", checkout_date: "2026-10-23", amount: "100.00" },
      { room_type_id: "b", checkin_date: "2026-10-20", checkout_date: "2026-10-23", amount: "200.00" },
    ],
  }));
  assert.deepEqual(s.rooms!.map((r: any) => r.commissionAmount), [15, 30]);
  assert.deepEqual(s.rooms!.map((r: any) => r.total), [100, 200]);
  assert.equal(s.total, 300);
});
test("summarizeRevision: solo Booking.com (Expedia è un importo netto, Airbnb ha altre regole)", () => {
  assert.equal(summarizeRevision(rev({ ota_name: "Expedia" })).ok, false);
  assert.equal(summarizeRevision(rev({ ota_name: "Airbnb" })).error, "canale_non_supportato");
});

// ── route: logica con Channex finto ──
const deps = (revs: Record<string, any>, over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  let t = 0;
  return {
    calls,
    d: {
      fetchLatest: async (id: string) => { calls.push(id); const r = revs[id]; return r instanceof Error ? { ok: false, status: 500, error: r.message } : r ? { ok: true, status: 200, revision: r } : { ok: false, status: 404, error: "non trovata" }; },
      allowedProps: new Set(["prop-1"]), now: () => (t += 10), ...over,
    },
  };
};
const ID1 = "bk-12345678", ID2 = "bk-87654321", ID3 = "bk-11112222";

test("reconcileBookings: con e senza ota_commission", async () => {
  const { d } = deps({ [ID1]: rev(), [ID2]: rev({ booking_id: ID2, ota_commission: undefined }) });
  const o = await reconcileBookings([ID1, ID2], d as never);
  assert.equal(o.results.length, 2);
  assert.equal(o.results[0].commissionAmount, 51.99);
  assert.equal(o.results[1].ok, true);
  assert.equal(o.results[1].commissionAmount, undefined);
  assert.equal(o.stopped, undefined);
});
test("reconcileBookings: id non validi scartati, duplicati uniti, tetto di richieste (il resto in skipped)", async () => {
  const many = Array.from({ length: 12 }, (_, i) => `bk-0000000${i}`.padEnd(14, "x"));
  const revs: Record<string, any> = {};
  many.forEach((id) => { revs[id] = rev({ booking_id: id }); });
  const { d, calls } = deps(revs);
  const o = await reconcileBookings([...many, many[0], "../../x", "", "a b"], d as never);
  assert.equal(calls.length, 8);
  assert.equal(o.results.length, 8);
  assert.deepEqual(o.skipped, many.slice(8));
});
test("reconcileBookings: ci si ferma al secondo errore di fila e subito su 429", async () => {
  const { d, calls } = deps({ [ID1]: new Error("boom"), [ID2]: new Error("boom") });
  const o = await reconcileBookings([ID1, ID2, ID3], d as never);
  assert.equal(o.stopped, "errori");
  assert.equal(calls.length, 2);
  assert.deepEqual(o.skipped, [ID3]);
  assert.equal(o.results[0].ok, false);
  const rl = deps({}, { fetchLatest: async () => ({ ok: false, status: 429, error: "troppe" }) });
  const o2 = await reconcileBookings([ID1, ID2], rl.d as never);
  assert.equal(o2.stopped, "errori");
  assert.deepEqual(o2.skipped, [ID2]);
});
test("reconcileBookings: un errore isolato non ferma il giro (la serie di errori si azzera)", async () => {
  const { d } = deps({ [ID1]: rev(), [ID3]: rev({ booking_id: ID3 }) }); // ID2 non esiste → 404
  const o = await reconcileBookings([ID1, ID2, ID3], d as never);
  assert.deepEqual(o.results.map((r: any) => r.ok), [true, false, true]);
  assert.equal(o.stopped, undefined);
});
test("reconcileBookings: tetto di tempo", async () => {
  let t = 0;
  const { d } = deps({ [ID1]: rev(), [ID2]: rev({ booking_id: ID2 }) }, { now: () => (t += 15000) });
  const o = await reconcileBookings([ID1, ID2], d as never, { budgetMs: 20000 });
  assert.equal(o.stopped, "tempo");
  assert.equal(o.results.length, 1);
  assert.deepEqual(o.skipped, [ID2]);
});
test("reconcileBookings: property di un altro utente o revision di un'altra prenotazione → rifiutate", async () => {
  const { d } = deps({ [ID1]: rev({ property_id: "prop-altrui" }), [ID2]: rev({ booking_id: "bk-ALTRA-999" }) });
  const o = await reconcileBookings([ID1, ID2], d as never);
  assert.deepEqual(o.results.map((r: any) => r.error), ["non_autorizzato", "revision_non_corrispondente"]);
  assert.equal(o.results[0].commissionAmount, undefined);
});

// ── lettura della revision da Channex (fetch finto, nessuna rete vera) ──
async function withFetch<T>(handler: (url: string) => Response, fn: (urls: string[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch; const urls: string[] = [];
  globalThis.fetch = (async (url: string) => { urls.push(String(url)); return handler(String(url)); }) as typeof fetch;
  try { return await fn(urls); } finally { globalThis.fetch = original; }
}
test("getLatestRevisionOfBooking: una sola richiesta filtrata per booking_id (revision più recente), dettagli già presenti", async () => {
  await withFetch(() => json({ data: [{ id: "rev-9", attributes: rev({ id: undefined }) }] }), async (urls) => {
    const r = await getLatestRevisionOfBooking("bk-12345678");
    assert.equal(r.ok, true);
    assert.equal(r.revision!.id, "rev-9");
    assert.equal(r.revision!.ota_commission, "51.99");
    assert.equal(urls.length, 1);
    assert.match(urls[0], /\/booking_revisions\?filter\[booking_id\]=bk-12345678&order\[inserted_at\]=desc&pagination\[limit\]=1$/);
  });
});
test("getLatestRevisionOfBooking: se l'elenco non porta i dettagli rilegge la revision per id", async () => {
  await withFetch((u) => u.includes("/booking_revisions/rev-9") ? json({ data: { id: "rev-9", attributes: rev() } }) : json({ data: [{ id: "rev-9", attributes: { booking_id: "bk-12345678", status: "modified" } }] }), async (urls) => {
    const r = await getLatestRevisionOfBooking("bk-12345678");
    assert.equal(r.ok, true);
    assert.equal(r.revision!.ota_commission, "51.99");
    assert.equal(urls.length, 2);
    assert.match(urls[1], /\/booking_revisions\/rev-9$/);
  });
});
test("getLatestRevisionOfBooking: nessuna revision / errore Channex → ok:false con stato", async () => {
  await withFetch(() => json({ data: [] }), async () => { const r = await getLatestRevisionOfBooking("bk-1"); assert.equal(r.ok, false); assert.equal(r.status, 404); });
  await withFetch(() => json({ errors: { title: "Forbidden" } }, 403), async () => { const r = await getLatestRevisionOfBooking("bk-1"); assert.equal(r.ok, false); assert.equal(r.status, 403); });
});
test("percorso completo: Channex finto → cifre per prenotazione, senza ota_commission nessuna commissione", async () => {
  await withFetch((u) => json({ data: [{ id: "r", attributes: u.includes("bk-12345678") ? rev() : rev({ booking_id: ID2, ota_commission: undefined }) }] }), async () => {
    const o = await reconcileBookings([ID1, ID2], { fetchLatest: getLatestRevisionOfBooking, allowedProps: new Set(["prop-1"]), now: () => Date.now() });
    assert.equal(o.results[0].commissionAmount, 51.99);
    assert.equal(o.results[1].commissionAmount, undefined);
    assert.equal(o.results[1].total, 346.6);
  });
});
