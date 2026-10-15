import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { payoutDate, cleanRule, payoutSummary, payoutSettingsFor, normalizePayoutMap, isGroupedPayout } = await import("../src/lib/payouts.ts");
const { groupBookingRows, computeAuto, computeForecast } = await import("../src/lib/cassa.ts");

// impostazioni predefinite ("*") nel nuovo formato per struttura
const D = (s: Record<string, unknown>) => ({ "*": s }) as never;
const bk = (o: Record<string, unknown> = {}) => ({ channel: "booking" as const, checkIn: "2026-10-20", checkOut: "2026-10-22", ...o });

test("senza impostazioni (o con 'arrivo') vale la data di arrivo; la diretta non cambia mai", () => {
  assert.equal(payoutDate(bk(), D({})), "2026-10-20");
  assert.equal(payoutDate(bk(), D({ booking: { mode: "arrival" } })), "2026-10-20");
  assert.equal(payoutDate(bk({ channel: "direct" }), D({ direct: { mode: "monthly" } })), "2026-10-20");
});

test("carta virtuale: al check-out o N giorni dopo", () => {
  assert.equal(payoutDate(bk(), D({ booking: { mode: "checkout", days: 0 } })), "2026-10-22");
  assert.equal(payoutDate(bk(), D({ booking: { mode: "checkout", days: 3 } })), "2026-10-25");
});

test("bonifico settimanale del giovedì: il primo giovedì DOPO il check-out (mercoledì → giovedì dopo, giovedì → +7)", () => {
  const s = D({ booking: { mode: "weekly" as const, weekday: 4 } });
  assert.equal(payoutDate(bk({ checkOut: "2026-10-21" }), s), "2026-10-22"); // mercoledì 21 → giovedì 22
  assert.equal(payoutDate(bk({ checkOut: "2026-10-22" }), s), "2026-10-29"); // giovedì 22 → giovedì 29
  assert.equal(payoutDate(bk({ checkOut: "2026-10-15" }), s), "2026-10-22"); // giovedì 15 → 22
  assert.equal(payoutDate(bk({ checkOut: "2026-10-16" }), s), "2026-10-22"); // venerdì 16 → 22
});

test("bonifico mensile: check-out del mese, pagati il giorno scelto del mese dopo (anche a fine anno e con giorni oltre la fine del mese)", () => {
  assert.equal(payoutDate(bk({ checkOut: "2026-10-31" }), D({ booking: { mode: "monthly", monthDay: 5 } })), "2026-11-05");
  assert.equal(payoutDate(bk({ checkOut: "2026-12-15" }), D({ booking: { mode: "monthly", monthDay: 1 } })), "2027-01-01");
  assert.equal(payoutDate(bk({ checkOut: "2027-01-10" }), D({ booking: { mode: "monthly", monthDay: 31 } })), "2027-02-28");
});

test("impostazioni lette dal browser: valori non validi tornano ai predefiniti", () => {
  assert.deepEqual(cleanRule({ mode: "boh", weekday: 9, monthDay: 0, days: -2 }), { mode: "arrival", days: 0, weekday: 4, monthDay: 1 });
  assert.deepEqual(cleanRule({ mode: "weekly", weekday: 1 }), { mode: "weekly", days: 0, weekday: 1, monthDay: 1 });
  assert.equal(payoutSummary({ mode: "weekly", weekday: 4 }), "Bonifico settimanale · giovedì");
  assert.equal(payoutSummary(undefined), "Alla data di arrivo");
});

const guests = [{ id: "g1", fullName: "Anna" }, { id: "g2", fullName: "Luca" }];
const st = () => ({ id: "s1", name: "Casa" });
const B = (id: string, g: string, checkIn: string, checkOut: string, o: Record<string, unknown> = {}) => ({ id, structureId: "s1", guestId: g, channel: "booking", status: "confirmed", checkIn, checkOut, total: 100, paid: 100, commissionAmount: 15, ...o });

test("Cassa: incasso e commissione cadono alla data del bonifico, non all'arrivo", () => {
  const settings = D({ booking: { mode: "weekly" as const, weekday: 4 } });
  const a = computeAuto([B("b1", "g1", "2026-10-20", "2026-10-22")] as never, guests as never, st as never, "all", "banca", settings);
  assert.deepEqual(a.map((m) => m.date), ["2026-10-29", "2026-10-29"]);
  assert.ok(a.every((m) => m.channel === "booking"));
});

test("Cassa: la previsione usa la data di incasso (arrivo passato ma bonifico futuro entra, arrivo futuro ma bonifico oltre l'orizzonte no)", () => {
  const settings = D({ booking: { mode: "monthly" as const, monthDay: 5 } });
  const f = computeForecast([B("b1", "g1", "2026-10-10", "2026-10-12", { paid: 0 }), B("b2", "g2", "2026-10-20", "2026-10-22", { paid: 0 })] as never, guests as never, st as never, [], "all", "2026-10-14", "2026-10-31", "banca", settings);
  assert.deepEqual(f, []); // entrambi pagati il 5 novembre: oltre l'orizzonte
  const f2 = computeForecast([B("b1", "g1", "2026-10-10", "2026-10-12", { paid: 0 })] as never, guests as never, st as never, [], "all", "2026-10-14", "2026-11-30", "banca", settings);
  assert.deepEqual(f2.map((m) => [m.id, m.date]), [["fc-in-b1", "2026-11-05"]]);
});

test("registro: le prenotazioni dello stesso bonifico si riuniscono in una voce con lordo, commissioni e netto", () => {
  const settings = D({ booking: { mode: "weekly" as const, weekday: 4 } });
  const mov = computeAuto([B("b1", "g1", "2026-10-20", "2026-10-22"), B("b2", "g2", "2026-10-21", "2026-10-23", { total: 200, paid: 200, commissionAmount: 30 }), B("b3", "g1", "2026-10-26", "2026-10-30")] as never, guests as never, st as never, "all", "banca", settings);
  const rows = groupBookingRows(mov, (ch) => ch === "booking");
  assert.deepEqual(rows.map((r) => r.type), ["payout", "payout"]); // 29.10 (b1,b2) e 05.11 (b3)
  const p = rows.find((r) => r.type === "payout" && r.date === "2026-10-29");
  assert.ok(p && p.type === "payout");
  if (p && p.type === "payout") { assert.equal(p.count, 2); assert.equal(p.gross, 300); assert.equal(p.comm, 45); assert.equal(p.net, 255); assert.equal(p.items.length, 2); assert.equal(p.movIds.length, 4); }
  // senza canali da raggruppare resta la voce per prenotazione
  assert.deepEqual(groupBookingRows(mov).map((r) => r.type), ["booking", "booking", "booking"]);
});

// ── Impostazioni PER STRUTTURA ──────────────────────────────────────────────────────────────────────────────────────────
const WEEKLY_THU = { booking: { mode: "weekly" as const, weekday: 4 } };
const MONTHLY_5 = { booking: { mode: "monthly" as const, monthDay: 5 } };

test("payoutSettingsFor: proprie → predefinite → vuote", () => {
  const map = { "*": MONTHLY_5, s1: WEEKLY_THU, s3: {} } as never;
  assert.deepEqual(payoutSettingsFor(map, "s1"), WEEKLY_THU);          // proprie
  assert.deepEqual(payoutSettingsFor(map, "s2"), MONTHLY_5);           // non ne ha: eredita "*"
  assert.deepEqual(payoutSettingsFor(map, undefined), MONTHLY_5);      // senza struttura: predefinite
  assert.deepEqual(payoutSettingsFor(map, "s3"), {});                  // proprie vuote = tutto alla data di arrivo
  assert.deepEqual(payoutSettingsFor({ s1: WEEKLY_THU } as never, "s2"), {}); // né proprie né predefinite
  assert.deepEqual(payoutSettingsFor({} as never, "s1"), {});
  assert.deepEqual(payoutSettingsFor(null, "s1"), {});
});

test("formato vecchio (chiavi = canali) letto come predefinite, senza perdere nulla", () => {
  const old = { booking: { mode: "weekly", weekday: 4 }, expedia: { mode: "monthly", monthDay: 10 } };
  const m = normalizePayoutMap(old);
  assert.deepEqual(Object.keys(m), ["*"]);
  assert.equal(m["*"].booking?.mode, "weekly");
  assert.equal(m["*"].expedia?.monthDay, 10);
  assert.equal(payoutSettingsFor(m, "qualsiasi").booking?.weekday, 4);
  // anche passato direttamente (senza normalizzare) a payoutSettingsFor / payoutDate
  assert.equal(payoutSettingsFor(old as never, "s9").expedia?.mode, "monthly");
  assert.equal(payoutDate(bk({ checkOut: "2026-10-21" }), old as never), "2026-10-22");
  // nuovo formato: resta com'è (ripulito)
  const nuovo = normalizePayoutMap({ "*": { booking: { mode: "boh" } }, s1: { booking: { mode: "weekly", weekday: 9 } } });
  assert.equal(nuovo["*"].booking?.mode, "arrival");
  assert.equal(nuovo.s1.booking?.weekday, 4);
  assert.deepEqual(normalizePayoutMap(null), {});
  assert.deepEqual(normalizePayoutMap([]), {});
  assert.deepEqual(normalizePayoutMap({}), {});
});

test("payoutDate: stessa prenotazione-tipo, due strutture con regole diverse → date diverse; senza regole proprie eredita le predefinite", () => {
  const map = { "*": WEEKLY_THU, s2: MONTHLY_5 } as never;
  const b = (structureId: string) => bk({ structureId, checkOut: "2026-10-21" });
  assert.equal(payoutDate(b("s1"), map), "2026-10-22"); // eredita: giovedì
  assert.equal(payoutDate(b("s2"), map), "2026-11-05"); // propria: mensile
  assert.equal(payoutDate(b("s3"), { s2: MONTHLY_5 } as never), "2026-10-20"); // nessuna regola → arrivo
});

test("Cassa: ogni prenotazione usa le impostazioni della propria struttura (computeAuto e computeForecast)", () => {
  const map = { s1: WEEKLY_THU, s2: MONTHLY_5 } as never;
  const stx = (id: string) => ({ id, name: id });
  const bks = [B("b1", "g1", "2026-10-20", "2026-10-22", { structureId: "s1" }), B("b2", "g2", "2026-10-20", "2026-10-22", { structureId: "s2" })];
  const a = computeAuto(bks as never, guests as never, stx as never, "all", "banca", map);
  assert.deepEqual(a.filter((m) => m.id.startsWith("auto-in-")).map((m) => [m.ref, m.date, m.bookingStructureId]), [["b1", "2026-10-29", "s1"], ["b2", "2026-11-05", "s2"]]);
  const f = computeForecast(bks.map((b) => ({ ...b, paid: 0 })) as never, guests as never, stx as never, [], "all", "2026-10-14", "2026-12-31", "banca", map);
  assert.deepEqual(f.map((m) => [m.ref, m.date]), [["b1", "2026-10-29"], ["b2", "2026-11-05"]]);
});

test("registro: il bonifico unico non mescola strutture (anche con stessa data e stesso canale)", () => {
  const map = { "*": WEEKLY_THU } as never; // stessa regola, ma strutture diverse = bonifici diversi
  const stx = (id: string) => ({ id, name: id });
  const mov = computeAuto([B("b1", "g1", "2026-10-20", "2026-10-22", { structureId: "s1" }), B("b2", "g2", "2026-10-20", "2026-10-22", { structureId: "s2" }), B("b3", "g1", "2026-10-21", "2026-10-23", { structureId: "s1" })] as never, guests as never, stx as never, "all", "banca", map);
  const rows = groupBookingRows(mov, (ch, sid) => isGroupedPayout(map, ch, sid));
  assert.deepEqual(rows.map((r) => r.type), ["payout", "payout"]);
  const p1 = rows.find((r) => r.type === "payout" && r.structureId === "s1");
  const p2 = rows.find((r) => r.type === "payout" && r.structureId === "s2");
  assert.ok(p1 && p2 && p1.type === "payout" && p2.type === "payout");
  if (p1?.type === "payout" && p2?.type === "payout") { assert.equal(p1.count, 2); assert.equal(p2.count, 1); assert.notEqual(p1.id, p2.id); assert.equal(p1.date, p2.date); }
});

test("registro: il raggruppamento dipende dalla struttura della riga", () => {
  const map = { s1: WEEKLY_THU, s2: {} } as never; // s1 bonifico settimanale, s2 alla data di arrivo
  const stx = (id: string) => ({ id, name: id });
  const mov = computeAuto([B("b1", "g1", "2026-10-20", "2026-10-22", { structureId: "s1" }), B("b2", "g2", "2026-10-20", "2026-10-22", { structureId: "s2" })] as never, guests as never, stx as never, "all", "banca", map);
  const rows = groupBookingRows(mov, (ch, sid) => isGroupedPayout(map, ch, sid));
  assert.deepEqual(rows.map((r) => r.type).sort(), ["booking", "payout"]);
  assert.equal(isGroupedPayout(map, "booking", "s1"), true);
  assert.equal(isGroupedPayout(map, "booking", "s2"), false);
  assert.equal(isGroupedPayout(map, "booking", "s9"), false);
});
