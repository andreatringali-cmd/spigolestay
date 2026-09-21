import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastConsumption } from "../src/lib/forniture/forecast.ts";

const base = {
  structureId: "s1",
  today: "2026-10-01",
  horizonDays: 30,
  products: [
    { id: "kit", pack_size: 100, consumption_per_arrival: 1, consumption_per_guest_night: 0 },
    { id: "capsule", pack_size: 100, consumption_per_arrival: 0, consumption_per_guest_night: 2 },
  ],
  rules: [
    { product_id: "kit", enabled: true, safety_stock: 0 },
    { product_id: "capsule", enabled: true, safety_stock: 0 },
  ],
  stock: [] as { product_id: string; qty_on_hand?: number }[],
};

test("0 arrivi → nessuna riga di riordino", () => {
  const lines = forecastConsumption({ ...base, bookings: [] });
  assert.equal(lines.length, 0);
});

test("1 camera, 10 arrivi, 2 notti l'uno → kit e capsule arrotondati al pack", () => {
  const bookings = [];
  for (let i = 0; i < 10; i++) {
    const d = String(2 + i).padStart(2, "0"); // check-in 02..11 ottobre, 2 notti, 2 ospiti
    bookings.push({ structureId: "s1", checkIn: `2026-10-${d}`, checkOut: `2026-10-${String(2 + i + 2).padStart(2, "0")}`, adults: 2, status: "confirmed" });
  }
  const lines = forecastConsumption({ ...base, bookings });
  const kit = lines.find((l) => l.product_id === "kit")!;
  const cap = lines.find((l) => l.product_id === "capsule")!;
  assert.equal(kit.arrivals, 10);
  assert.equal(kit.need, 10);          // 10 arrivi × 1
  assert.equal(kit.qty, 100);          // arrotondato al pack 100
  // ospiti·notti = 10 prenotazioni × 2 notti × 2 ospiti = 40 → capsule need 80
  assert.equal(cap.guestNights, 40);
  assert.equal(cap.need, 80);
  assert.equal(cap.qty, 100);
});

test("giacenza copre il fabbisogno → niente ordine", () => {
  const bookings = [{ structureId: "s1", checkIn: "2026-10-05", checkOut: "2026-10-07", adults: 2, status: "confirmed" }];
  const lines = forecastConsumption({ ...base, bookings, stock: [{ product_id: "kit", qty_on_hand: 50 }, { product_id: "capsule", qty_on_hand: 50 }] });
  // 1 arrivo × 1 = 1 kit, giacenza 50 copre → nessun kit. capsule 1×2notti×2osp=4, giacenza 50 → niente.
  assert.equal(lines.length, 0);
});

test("arrotondamento al pack: fabbisogno 101 con pack 96 → 192", () => {
  const lines = forecastConsumption({
    structureId: "s1", today: "2026-10-01", horizonDays: 30,
    products: [{ id: "carta", pack_size: 96, consumption_per_arrival: 101, consumption_per_guest_night: 0 }],
    rules: [{ product_id: "carta", enabled: true, safety_stock: 0 }],
    bookings: [{ structureId: "s1", checkIn: "2026-10-03", checkOut: "2026-10-04", adults: 1, status: "confirmed" }],
  });
  assert.equal(lines[0].need, 101);
  assert.equal(lines[0].qty, 192);      // ceil(101/96)=2 → 192
});

test("prodotto senza regola attiva → ignorato", () => {
  const lines = forecastConsumption({
    ...base,
    rules: [{ product_id: "kit", enabled: false, safety_stock: 0 }],
    bookings: [{ structureId: "s1", checkIn: "2026-10-03", checkOut: "2026-10-05", adults: 2, status: "confirmed" }],
  });
  assert.equal(lines.find((l) => l.product_id === "kit"), undefined);
});

test("prenotazioni fuori finestra o cancellate escluse", () => {
  const lines = forecastConsumption({
    ...base,
    bookings: [
      { structureId: "s1", checkIn: "2026-12-20", checkOut: "2026-12-22", adults: 2, status: "confirmed" }, // fuori orizzonte
      { structureId: "s1", checkIn: "2026-10-05", checkOut: "2026-10-07", adults: 2, status: "cancelled" },  // cancellata
      { structureId: "s2", checkIn: "2026-10-05", checkOut: "2026-10-07", adults: 2, status: "confirmed" },  // altra struttura
    ],
  });
  assert.equal(lines.length, 0);
});
