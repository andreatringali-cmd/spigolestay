import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

// Expedia: l'importo ricevuto è il pagamento NETTO all'hotel; ota_commission è la somma di TUTTE le trattenute (allineamento tariffe,
// acceleratore, commissione), già tolte da quell'importo. Il netto mostrato NON deve scendere di nuovo (508 → 401).
register("./helpers/stubs-loader.mjs", import.meta.url);
process.env.CHANNEX_API_KEY = "chiave-di-prova";
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0,
} as Storage;
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]> } };
G.__stubs = { calls: {} };
const { importSingleRevision } = await import("../src/lib/channex-inbound.ts");
const B = await import("../src/lib/booking.ts");
const { computeCommissionEstimates } = await import("../src/lib/commission-estimate.ts");
const { realChannelCommission } = await import("../src/lib/revenue-yoy.ts");

const DATA_KEY = "spigolestay:data:v1";
const MAP = { channex_property_id: "prop-1", tenant_id: "tenant-1", structure_id: "st-1", rooms: { "chx-dbl": "rt-dbl" }, org_id: null as string | null };
const baseData = (bookings: any[] = []) => ({
  structures: [{ id: "st-1", name: "Casa Ortigia" }],
  roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia", beds: 2, basePrice: 100 }],
  units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1" }, { id: "u2", roomTypeId: "rt-dbl", structureId: "st-1" }],
  guests: [] as any[], bookings,
});
const days = (n: number, price: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`2099-10-${String(12 + i).padStart(2, "0")}`, price]));
const rev = (ota: string, o: Record<string, unknown> = {}) => ({
  id: "rev-1", property_id: "prop-1", booking_id: "bk-1", status: "new", ota_reservation_code: "R-1", ota_name: ota,
  arrival_date: "2099-10-12", departure_date: "2099-10-19", amount: "508.13", currency: "EUR", ota_commission: "106.59",
  customer: { name: "Anna", surname: "Verdi", mail: "anna@example.com" },
  rooms: [{ room_type_id: "chx-dbl", checkin_date: "2099-10-12", checkout_date: "2099-10-19", occupancy: { adults: 2, children: 0 }, days: days(7, "72.59") }],
  ...o,
});
async function importOne(ota: string, bookings: any[] = [], o: Record<string, unknown> = {}) {
  const { db, client } = makeFakeDb({
    channex_map: [MAP],
    app_state: [{ user_id: MAP.tenant_id, rev: 1, data: { [DATA_KEY]: JSON.stringify(baseData(bookings)) } }],
    org_state: [], channex_bookings: [],
  });
  G.__stubs.calls = {};
  await importSingleRevision(client as never, rev(ota, o) as never);
  const row = db.tables["app_state"].find((r: any) => r.user_id === MAP.tenant_id) as any;
  return JSON.parse(row.data[DATA_KEY]).bookings.filter((b: any) => b.status !== "cancelled");
}

test("Expedia da Channex: il netto resta quanto incassa l'hotel, le trattenute non si sottraggono due volte", async () => {
  const [b] = await importOne("Expedia");
  assert.equal(b.channel, "expedia");
  assert.equal(b.total, 508.13);
  assert.equal(b.netTotal, true);
  assert.equal(b.otaDeductions, 106.59); // solo informativo
  assert.equal("commissionAmount" in b, false);
  assert.equal("commissionPct" in b, false);
  assert.equal(B.commissionOf(b), 0);
  assert.equal(B.commissionPctOf(b), 0);
  assert.equal(B.nettoOf(b), 508.13); // NON 401,54
  assert.equal(B.commissionShareOf(b), 0);
});

test("Expedia: una vecchia riga già salvata col vecchio modello (commissione = trattenute) mostra comunque il netto corretto", () => {
  const old = { channel: "expedia" as const, total: 508, commissionAmount: 106.59, extId: "channex:bk-1", structureId: "st-1" };
  assert.equal(B.nettoOf(old), 508);
  assert.equal(B.commissionOf(old), 0);
});

test("Expedia: una modifica non fa risorgere la commissione riportata dalla vecchia riga", async () => {
  const [first] = await importOne("Expedia");
  const old = { ...first, commissionAmount: 106.59, commissionPct: 21 };
  const [b] = await importOne("Expedia", [old], { id: "rev-2", status: "modified" });
  assert.equal("commissionAmount" in b, false);
  assert.equal("commissionPct" in b, false);
  assert.equal(B.nettoOf(b), 508.13);
});

test("Altri canali invariati: Booking con la stessa ota_commission continua a sottrarla dal lordo", async () => {
  const [b] = await importOne("Booking.com");
  assert.equal(b.commissionAmount, 106.59);
  assert.equal("netTotal" in b, false);
  assert.equal(B.commissionOf(b), 106.59);
  assert.equal(B.nettoOf(b), 401.54);
});

test("Expedia importata da altra fonte (es. Octorate, totale lordo) mantiene commissione e netto", () => {
  const o = { channel: "expedia" as const, total: 600, commissionAmount: 90, extId: "octo:55" };
  assert.equal(B.commissionOf(o), 90);
  assert.equal(B.nettoOf(o), 510);
  // netTotal:false esplicito riporta una riga channex al calcolo normale
  assert.equal(B.commissionOf({ ...o, extId: "channex:x", netTotal: false }), 90);
});

test("le righe a totale netto non inquinano stima e media delle commissioni reali", () => {
  const net = { channel: "expedia", total: 500, commissionAmount: 100, extId: "channex:a", checkIn: "2099-01-01", structureId: "S", status: "confirmed" };
  assert.deepEqual(computeCommissionEstimates(Array.from({ length: 6 }, () => net), "2099-02-01"), {});
  assert.equal(realChannelCommission(Array.from({ length: 3 }, () => net) as never, "expedia", "S", "2098-01-01"), null);
});
