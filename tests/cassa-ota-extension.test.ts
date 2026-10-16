import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { computeAuto, otaExtensionOf } = await import("../src/lib/cassa.ts");

const guests = [{ id: "g1", fullName: "Anna" }];
const stx = () => ({ id: "s1", name: "Central Perk" });
const MAP = { "*": { booking: { mode: "arrival" } } } as never;
const B = (o: Record<string, unknown>) => ({ id: "b1", structureId: "s1", guestId: "g1", channel: "booking", status: "confirmed", checkIn: "2026-10-12", checkOut: "2026-10-15", total: 359.64, paid: 359.64, commissionAmount: 82.72, paymentFee: 5.39, nightlyRates: { "2026-10-12": 119.88, "2026-10-13": 119.88, "2026-10-14": 119.88 }, ...o });
const run = (b: unknown) => computeAuto([b] as never, guests as never, stx as never, "all", "banca", MAP, ["banca", "contanti"]);
const ins = (a: { id: string; kind: string }[]) => a.filter((m) => m.kind === "in");

test("OTA non prolungata: un solo incasso, nessuna separazione", () => {
  assert.equal(otaExtensionOf(B({}) as never), null);
  const i = ins(run(B({})));
  assert.equal(i.length, 1);
  assert.equal((i[0] as unknown as { amount: number }).amount, 359.64);
});

test("OTA prolungata a mano: il portale incassa le sue notti, le notti in più entrano in contanti alla fine della prenotazione originale", () => {
  const b = B({ checkOut: "2026-10-18", total: 579.64, paid: 579.64 });
  assert.deepEqual(otaExtensionOf(b as never), { ota: 359.64, extra: 220, from: "2026-10-15" });
  const i = ins(run(b)) as unknown as { id: string; amount: number; conto: string; date: string }[];
  assert.equal(i.length, 2);
  const portal = i.find((m) => m.id === "auto-in-b1")!;
  const extra = i.find((m) => m.id === "auto-in-resto-b1")!;
  assert.equal(portal.amount, 359.64);
  assert.equal(portal.conto, "banca");
  assert.equal(extra.amount, 220);
  assert.equal(extra.conto, "contanti");
  assert.equal(extra.date, "2026-10-15");
  assert.equal(Math.round((portal.amount + extra.amount) * 100), 57964);
});

test("OTA prolungata ma non ancora pagata il di più: solo la parte del portale", () => {
  const i = ins(run(B({ checkOut: "2026-10-18", total: 579.64, paid: 359.64 })));
  assert.equal(i.length, 1);
  assert.equal((i[0] as unknown as { amount: number }).amount, 359.64);
});

test("diretta o senza dettaglio notti: nessuna separazione", () => {
  assert.equal(otaExtensionOf(B({ channel: "direct", total: 579.64 }) as never), null);
  assert.equal(otaExtensionOf(B({ nightlyRates: undefined, total: 579.64 }) as never), null);
  assert.equal(otaExtensionOf(B({ total: 359.9 }) as never), null); // scarto sotto 50 centesimi: arrotondamento
});
