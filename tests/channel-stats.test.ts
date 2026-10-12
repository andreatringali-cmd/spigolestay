import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// channel-stats importa "@/lib/booking": lo risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const { periodRange, channelStats } = await import("../src/lib/channel-stats.ts");

const b = (channel: string, checkIn: string, checkOut: string, total: number, extra: Record<string, unknown> = {}) =>
  ({ channel, status: "confirmed", structureId: "S1", checkIn, checkOut, total, ...extra }) as never;

test("periodi sulle date di arrivo", () => {
  assert.deepEqual(periodRange("last30", "2026-10-12"), { from: "2026-09-13", to: "2026-10-13" });
  assert.deepEqual(periodRange("next30", "2026-10-12"), { from: "2026-10-12", to: "2026-11-11" });
  assert.deepEqual(periodRange("year", "2026-10-12"), { from: "2026-01-01", to: "2027-01-01" });
});

test("conta per canale: prenotazioni, notti, lordo, commissione esatta, netto, quota sul lordo", () => {
  const r = channelStats([
    b("booking", "2026-10-01", "2026-10-03", 200, { commissionAmount: 40 }),            // 2 notti, commissione 20%
    b("booking", "2026-10-05", "2026-10-06", 100, { commissionAmount: 20 }),            // 1 notte
    b("direct", "2026-10-07", "2026-10-09", 100),                                       // 2 notti, nessuna commissione
  ], { from: "2026-09-01", to: "2026-11-01" });
  const bk = r.rows.find((x) => x.channel === "booking")!;
  assert.equal(bk.bookings, 2); assert.equal(bk.nights, 3); assert.equal(bk.gross, 300); assert.equal(bk.commission, 60); assert.equal(bk.net, 240);
  assert.equal(bk.avgNight, 100); assert.equal(bk.commissionPct, 20);
  assert.equal(Math.round(bk.shareGross), 75);
  assert.equal(r.rows[0].channel, "booking", "ordinati per lordo decrescente");
  assert.equal(r.totals.bookings, 3); assert.equal(r.totals.gross, 400); assert.equal(r.totals.net, 340);
});

test("annullate, blocchi, altre strutture e arrivi fuori periodo non contano nei ricavi", () => {
  const r = channelStats([
    b("booking", "2026-10-01", "2026-10-02", 100, { status: "cancelled" }),
    b("blocked", "2026-10-01", "2026-10-05", 0),
    b("booking", "2026-10-01", "2026-10-02", 100, { structureId: "S2" }),
    b("booking", "2026-08-01", "2026-08-02", 100),
    b("booking", "2026-10-10", "2026-10-11", 80),
  ], { from: "2026-09-13", to: "2026-10-13", structureId: "S1" });
  const bk = r.rows.find((x) => x.channel === "booking")!;
  assert.equal(bk.bookings, 1); assert.equal(bk.gross, 80); assert.equal(bk.cancelled, 1);
  assert.equal(r.rows.some((x) => x.channel === "blocked"), false);
});

test("nessuna prenotazione: tabella vuota, totali a zero, niente divisioni per zero", () => {
  const r = channelStats([], { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(r.rows, []);
  assert.equal(r.totals.gross, 0); assert.equal(r.totals.avgNight, null); assert.equal(r.totals.commissionPct, null);
});

const { monthRanges, channelInsights } = await import("../src/lib/channel-stats.ts");
const lab = (c: string) => ({ booking: "Booking.com", direct: "Diretta", expedia: "Expedia / Vrbo" } as Record<string, string>)[c] ?? c;

test("mesi: 5 prima, il corrente, 2 dopo, anche a cavallo d'anno", () => {
  const m = monthRanges("2026-10-12", 5, 2);
  assert.equal(m.length, 8);
  assert.deepEqual([m[0].key, m[5].key, m[7].key], ["2026-05", "2026-10", "2026-12"]);
  assert.equal(m[5].current, true); assert.equal(m[6].future, true); assert.equal(m[4].future, false);
  assert.deepEqual([m[5].from, m[5].to], ["2026-10-01", "2026-11-01"]);
  const y = monthRanges("2026-01-15", 2, 1);
  assert.deepEqual([y[0].key, y[2].key], ["2025-11", "2026-01"]);
  assert.equal(y[2].to, "2026-02-01");
});

test("spunti: dipendenza da un canale, commissioni in notti equivalenti, risparmio diretto, cancellazioni", () => {
  const rows = [
    b("booking", "2026-10-01", "2026-10-03", 800, { commissionAmount: 200 }),
    b("booking", "2026-10-04", "2026-10-06", 800, { commissionAmount: 200 }),
    b("direct", "2026-10-07", "2026-10-09", 400),
    ...Array.from({ length: 4 }, () => b("expedia", "2026-10-10", "2026-10-11", 100, { status: "cancelled" })),
    b("expedia", "2026-10-10", "2026-10-11", 100, { commissionAmount: 20 }),
  ];
  const res = channelStats(rows, { from: "2026-10-01", to: "2026-11-01" });
  const ins = channelInsights(res, lab);
  assert.match(ins.find((i) => i.id === "dipendenza")!.text, /Booking\.com pesa il \d+% dei ricavi/);
  assert.equal(ins.find((i) => i.id === "dipendenza")!.tone, "warn");
  assert.ok(ins.some((i) => i.id === "commissioni"));
  assert.equal(ins.length <= 4, true);
});

test("spunti: nessun dato = nessuno spunto; ricavi equilibrati = tono ok", () => {
  assert.deepEqual(channelInsights(channelStats([], { from: "2026-10-01", to: "2026-11-01" }), lab), []);
  const res = channelStats([b("booking", "2026-10-01", "2026-10-02", 100), b("direct", "2026-10-03", "2026-10-04", 100)], { from: "2026-10-01", to: "2026-11-01" });
  assert.equal(channelInsights(res, lab)[0].tone, "ok");
});
