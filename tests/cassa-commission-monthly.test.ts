import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { cleanRule, normalizePayoutMap, payoutDate, payoutSummary, commissionDateFor, commissionRuleFor, commissionMonthOf } = await import("../src/lib/payouts.ts");
const { computeAuto, computeForecast, computeLedger, computeBalances, projectBalance, groupBookingRows, monthlyCommissionInfo, OPENING_CAT } = await import("../src/lib/cassa.ts");
const { commissionOf } = await import("../src/lib/booking.ts");

const D = (s: Record<string, unknown>) => ({ "*": s }) as never;
// Booking: incasso ogni giovedì (lordo) + commissioni tutte insieme il 15 del mese dopo
const MONTHLY = D({ booking: { mode: "weekly", weekday: 4, commission: { mode: "monthly", day: 15 } } });
const TOGETHER = D({ booking: { mode: "weekly", weekday: 4 } }); // predefinito: commissione insieme all'incasso
const guests = [{ id: "g1", fullName: "Anna" }, { id: "g2", fullName: "Luca" }, { id: "g3", fullName: "Rosa" }];
const stx = (id: string) => ({ id, name: id === "s1" ? "Spigolehouse" : "Spigolerooms" });
const B = (id: string, g: string, checkIn: string, checkOut: string, o: Record<string, unknown> = {}) => ({ id, structureId: "s1", guestId: g, channel: "booking", status: "confirmed", checkIn, checkOut, total: 100, paid: 100, commissionAmount: 15, ...o });
const auto = (bks: unknown[], map: never = MONTHLY, active = "all") => computeAuto(bks as never, guests as never, stx as never, active, "banca", map, ["banca", "contanti"]);
const aggs = (a: { id: string }[]) => a.filter((m) => m.id.startsWith("auto-commm-"));
const perBooking = (a: { id: string }[]) => a.filter((m) => m.id.startsWith("auto-comm-"));

test("impostazione: valida, ripulita, e il formato salvato senza commissioni non cambia", () => {
  assert.deepEqual(cleanRule({ mode: "weekly", weekday: 4 }), { mode: "weekly", days: 0, weekday: 4, monthDay: 1 }); // nessuna chiave in più
  assert.ok(!("commission" in cleanRule({ mode: "weekly", commission: undefined })));
  assert.deepEqual(cleanRule({ mode: "weekly", commission: { mode: "monthly", day: 15 } }).commission, { mode: "monthly", day: 15 });
  assert.deepEqual(cleanRule({ mode: "arrival", commission: { mode: "monthly", day: 1 } }).commission, { mode: "monthly", day: 1 });
  assert.deepEqual(cleanRule({ commission: { mode: "monthly", day: 28 } }).commission, { mode: "monthly", day: 28 });
  // giorno mancante / fuori da 1..28 / non intero → predefinito 15; modo sconosciuto → ignorata
  for (const day of [undefined, 0, 29, 31, 4.5, "15", -3, null]) assert.deepEqual(cleanRule({ commission: { mode: "monthly", day } }).commission, { mode: "monthly", day: 15 }, String(day));
  assert.equal(cleanRule({ commission: { mode: "together" } }).commission, undefined);
  assert.equal(cleanRule({ commission: "monthly" }).commission, undefined);
  assert.equal(cleanRule({ commission: null }).commission, undefined);
  // round-trip del salvataggio e formato vecchio (globale) con commissioni
  const saved = JSON.parse(JSON.stringify({ s1: { booking: cleanRule({ mode: "weekly", weekday: 4, commission: { mode: "monthly", day: 20 } }) } }));
  assert.deepEqual(normalizePayoutMap(saved).s1.booking?.commission, { mode: "monthly", day: 20 });
  assert.deepEqual(normalizePayoutMap({ booking: { mode: "weekly", commission: { mode: "monthly", day: 15 } } })["*"].booking?.commission, { mode: "monthly", day: 15 });
  // un'impostazione vecchia (senza commission) resta senza
  assert.equal(normalizePayoutMap({ "*": { booking: { mode: "weekly", weekday: 4 } } })["*"].booking?.commission, undefined);
  assert.equal(payoutSummary({ mode: "weekly", weekday: 4 }), "Bonifico settimanale · giovedì");
  assert.equal(payoutSummary({ mode: "weekly", weekday: 4, commission: { mode: "monthly", day: 15 } }), "Bonifico settimanale · giovedì · commissioni il 15 del mese dopo");
});

test("la regola delle commissioni non cambia la data dell'incasso", () => {
  const b = { channel: "booking" as const, checkIn: "2026-10-20", checkOut: "2026-10-22" };
  assert.equal(payoutDate(b, MONTHLY), payoutDate(b, TOGETHER));
  assert.equal(payoutDate(b, MONTHLY), "2026-10-29");
  assert.equal(commissionRuleFor(MONTHLY, "booking", "s1")?.day, 15);
  assert.equal(commissionRuleFor(MONTHLY, "expedia", "s1"), undefined); // solo il portale impostato
  assert.equal(commissionRuleFor(MONTHLY, "direct", "s1"), undefined);
  assert.equal(commissionRuleFor(TOGETHER, "booking", "s1"), undefined);
});

test("mese del check-out → giorno N del mese dopo (gennaio → 15 febbraio, febbraio → 15 marzo, dicembre → 15 gennaio dell'anno dopo)", () => {
  assert.equal(commissionDateFor("2027-01", 15), "2027-02-15");
  assert.equal(commissionDateFor("2027-02", 15), "2027-03-15");
  assert.equal(commissionDateFor("2026-12", 15), "2027-01-15");
  assert.equal(commissionDateFor("2027-01", 28), "2027-02-28"); // 28 esiste sempre
  assert.equal(commissionDateFor("2028-01", 28), "2028-02-28");
  assert.equal(commissionDateFor("2027-01", 31), "2027-02-28"); // difesa: un giorno oltre la fine del mese non esce mai dal mese
  assert.equal(commissionMonthOf({ checkIn: "2027-01-30", checkOut: "2027-02-02" }), "2027-02"); // vale il CHECK-OUT, non l'arrivo
});

test("modalità mensile: nessuna commissione per prenotazione, un movimento per mese di check-out con la somma ai centesimi", () => {
  const bks = [
    B("b1", "g1", "2027-01-10", "2027-01-12", { commissionAmount: 10.1 }),
    B("b2", "g2", "2027-01-28", "2027-02-02", { commissionAmount: 20.2 }), // arrivo gennaio, check-out febbraio → febbraio
    B("b3", "g3", "2027-01-20", "2027-01-31", { commissionAmount: 0.07 }),
    B("b4", "g1", "2026-12-29", "2027-01-03", { commissionAmount: 12.34 }), // check-out gennaio (arrivo dicembre)
    B("b5", "g2", "2026-12-20", "2026-12-23", { commissionAmount: 5.5 }), // dicembre → 15 gennaio 2027
  ];
  const a = auto(bks);
  assert.equal(perBooking(a).length, 0);
  const g = aggs(a);
  assert.deepEqual(g.map((m) => [m.id, m.date, m.amount]).sort(), [
    ["auto-commm-s1-booking-2026-12", "2027-01-15", 5.5],
    ["auto-commm-s1-booking-2027-01", "2027-02-15", 22.51], // 10.10 + 0.07 + 12.34, senza errori di virgola mobile
    ["auto-commm-s1-booking-2027-02", "2027-03-15", 20.2],
  ]);
  const gen = g.find((m) => m.id.endsWith("2027-01"))!;
  assert.equal(gen.kind, "out"); assert.equal(gen.cat, "commissioni"); assert.equal(gen.auto, true); assert.equal(gen.conto, "banca");
  assert.equal(gen.channel, "booking"); assert.equal(gen.bookingStructureId, "s1");
  assert.deepEqual(gen.commRefs?.slice().sort(), ["b1", "b3", "b4"]);
  assert.equal(gen.desc, "Commissioni Booking.com · gennaio 2027 · 3 prenotazioni");
  assert.equal(g.find((m) => m.id.endsWith("2027-02"))!.desc, "Commissioni Booking.com · febbraio 2027 · 1 prenotazione");
  // gli incassi restano lordi, uno per prenotazione, alla data del bonifico settimanale
  const inc = a.filter((m) => m.id.startsWith("auto-in-"));
  assert.equal(inc.length, 5); assert.ok(inc.every((m) => m.amount === 100));
});

test("modalità predefinita: nessun cambio (una commissione per prenotazione alla data dell'incasso, nessun aggregato)", () => {
  const bks = [B("b1", "g1", "2027-01-10", "2027-01-12"), B("b2", "g2", "2027-01-28", "2027-02-02", { commissionAmount: 20 })];
  const a = auto(bks, TOGETHER);
  assert.equal(aggs(a).length, 0);
  assert.deepEqual(perBooking(a).map((m) => [m.id, m.amount, m.date]), [["auto-comm-b1", 15, "2027-01-14"], ["auto-comm-b2", 20, "2027-02-04"]]);
  // senza alcuna impostazione e con commission esplicitamente assente: stesso risultato di sempre
  assert.deepEqual(auto(bks, {} as never).map((m) => m.id), ["auto-in-b1", "auto-comm-b1", "auto-in-b2", "auto-comm-b2"]);
  assert.deepEqual(auto(bks, D({ booking: cleanRule({ mode: "weekly", weekday: 4, commission: undefined }) })).map((m) => m.id), a.map((m) => m.id));
});

test("nessuna doppia conta e nessuna commissione persa: il totale delle commissioni è lo stesso nelle due modalità", () => {
  const bks = [B("b1", "g1", "2027-01-10", "2027-01-12", { commissionAmount: 33.33 }), B("b2", "g2", "2027-03-01", "2027-03-05", { commissionAmount: 41.67, paymentFee: 1.5 }), B("b3", "g3", "2027-01-15", "2027-01-18", { commissionAmount: 0.01 })];
  const sum = (a: { id: string; amount: number }[]) => Math.round(a.filter((m) => m.id.startsWith("auto-comm")).reduce((s, m) => s + Math.round(m.amount * 100), 0)) / 100;
  const expected = Math.round(bks.reduce((s, b) => s + Math.round(commissionOf(b as never) * 100), 0)) / 100;
  assert.equal(sum(auto(bks, TOGETHER)), expected);
  assert.equal(sum(auto(bks, MONTHLY)), expected);
  // nessuna prenotazione è sia commissione singola sia parte di un aggregato
  const a = auto(bks, MONTHLY);
  assert.equal(perBooking(a).length, 0);
  assert.equal(aggs(a).reduce((n, m) => n + (m.commRefs?.length ?? 0), 0), 3);
});

test("annullate e blocchi esclusi; prenotazioni senza commissione non generano nulla; un mese vuoto non genera nulla", () => {
  const bks = [
    B("b1", "g1", "2027-01-10", "2027-01-12", { status: "cancelled" }),
    B("b2", "g2", "2027-01-10", "2027-01-12", { channel: "blocked" }),
    B("b3", "g3", "2027-02-10", "2027-02-12", { commissionAmount: 0 }),
    B("b4", "g1", "2027-03-10", "2027-03-12", { commissionAmount: 9 }),
  ];
  const g = aggs(auto(bks));
  assert.deepEqual(g.map((m) => [m.id, m.amount]), [["auto-commm-s1-booking-2027-03", 9]]);
  // solo annullate → niente di niente
  assert.deepEqual(aggs(auto([bks[0]])), []);
  // se una prenotazione viene annullata dopo, l'aggregato la esclude (tutto è calcolato al volo)
  const live = [B("b1", "g1", "2027-01-10", "2027-01-12"), B("b2", "g2", "2027-01-20", "2027-01-22", { commissionAmount: 25 })];
  assert.equal(aggs(auto(live))[0].amount, 40);
  assert.equal(aggs(auto([live[0], { ...live[1], status: "cancelled" }]))[0].amount, 15);
  // cambia la commissione di una prenotazione → cambia l'aggregato
  assert.equal(aggs(auto([live[0], { ...live[1], commissionAmount: 30 }]))[0].amount, 45);
});

test("due strutture non si mescolano; il nome struttura compare solo se ce n'è più di una", () => {
  const bks = [B("b1", "g1", "2027-01-10", "2027-01-12", { structureId: "s1" }), B("b2", "g2", "2027-01-10", "2027-01-12", { structureId: "s2", commissionAmount: 22 })];
  const g = aggs(auto(bks));
  assert.deepEqual(g.map((m) => [m.id, m.amount, m.bookingStructureId]).sort(), [["auto-commm-s1-booking-2027-01", 15, "s1"], ["auto-commm-s2-booking-2027-01", 22, "s2"]]);
  assert.equal(g.find((m) => m.bookingStructureId === "s1")!.desc, "Commissioni Booking.com · Spigolehouse · gennaio 2027 · 1 prenotazione");
  // una sola struttura visibile (selezionata): niente nome
  const one = aggs(auto(bks, MONTHLY, "s2"));
  assert.equal(one.length, 1);
  assert.equal(one[0].desc, "Commissioni Booking.com · gennaio 2027 · 1 prenotazione");
  // regole diverse per struttura: s1 mensile, s2 insieme all'incasso
  const mixed = auto(bks, { s1: { booking: { mode: "weekly", weekday: 4, commission: { mode: "monthly", day: 10 } } }, s2: { booking: { mode: "weekly", weekday: 4 } } } as never);
  assert.deepEqual(aggs(mixed).map((m) => [(m as { bookingStructureId?: string }).bookingStructureId, (m as { date?: string }).date]), [["s1", "2027-02-10"]]);
  assert.deepEqual(perBooking(mixed).map((m) => (m as { ref?: string }).ref), ["b2"]);
});

test("solo il portale impostato: gli altri canali restano con la commissione per prenotazione", () => {
  const bks = [B("b1", "g1", "2027-01-10", "2027-01-12"), B("b2", "g2", "2027-01-10", "2027-01-12", { channel: "expedia", commissionAmount: 18 })];
  const a = auto(bks);
  assert.deepEqual(aggs(a).map((m) => (m as { channel?: string }).channel), ["booking"]);
  assert.deepEqual(perBooking(a).map((m) => [(m as { ref?: string }).ref, (m as { channel?: string }).channel]), [["b2", "expedia"]]);
});

test("saldo, estratto conto e proiezione seguono solo i movimenti veri (incassi lordi + aggregato)", () => {
  const bks = [B("b1", "g1", "2027-01-10", "2027-01-12"), B("b2", "g2", "2027-01-20", "2027-01-22", { commissionAmount: 25 })];
  const a = auto(bks); // incassi 100 + 100 (giovedì 14.01 e 28.01), commissioni 40 il 15.02
  const open = { id: "open", date: "2027-01-01", kind: "in" as const, cat: OPENING_CAT, desc: "Saldo", amount: 1000, conto: "banca" };
  const movs = [open, ...a];
  const ledger = computeLedger(movs);
  const agg = aggs(a)[0];
  assert.equal(ledger.balanceAfter.get(agg.id), 1160); // 1000 + 200 − 40: le commissioni non sono state tolte prima
  assert.equal(ledger.balanceAfter.get("auto-in-b1"), 1100);
  assert.equal(ledger.balanceAfter.get("auto-in-b2"), 1200);
  const bal = computeBalances(movs, "2027-02-20", ["banca", "contanti"]);
  assert.equal(bal.banca.saldo, 1160);
  assert.equal(computeBalances(movs, "2027-02-10", ["banca"]).banca.saldo, 1200); // prima del 15.02 l'aggregato non c'è ancora
  assert.equal(projectBalance(movs, computeBalances(movs, "2027-02-10", ["banca"]), "2027-02-10", "2027-02-28"), 1160);
});

test("registro: l'incasso della singola prenotazione resta una riga semplice (nessuna commissione unita), l'aggregato è una riga a sé", () => {
  const bks = [B("b1", "g1", "2027-01-10", "2027-01-12"), B("b2", "g2", "2027-01-20", "2027-01-22", { commissionAmount: 25 })];
  const rows = groupBookingRows(auto(bks)); // senza raggruppamenti
  assert.deepEqual(rows.map((r) => r.type), ["mov", "mov", "mov"]);
  const aggRow = rows.find((r) => r.type === "mov" && r.mov.commRefs);
  assert.ok(aggRow && aggRow.type === "mov" && aggRow.mov.amount === 40);
  // con il bonifico settimanale: i due incassi dello stesso giovedì si riuniscono, l'aggregato resta fuori dal bonifico
  const weekly = auto([B("b1", "g1", "2027-01-10", "2027-01-12"), B("b2", "g2", "2027-01-11", "2027-01-13", { commissionAmount: 25 })]);
  const rows2 = groupBookingRows(weekly, (ch) => ch === "booking");
  assert.deepEqual(rows2.map((r) => r.type).sort(), ["mov", "payout"]);
  const p = rows2.find((r) => r.type === "payout");
  assert.ok(p && p.type === "payout");
  if (p?.type === "payout") { assert.equal(p.gross, 200); assert.equal(p.comm, 0); assert.equal(p.net, 200); assert.equal(p.count, 2); }
});

test("informazione sulla riga della prenotazione: importo, % reale e data della trattenuta, solo in modalità mensile", () => {
  const b = B("b1", "g1", "2027-01-10", "2027-01-12", { commissionAmount: 15 });
  assert.deepEqual(monthlyCommissionInfo(b as never, MONTHLY), { amount: 15, pct: 15, date: "2027-02-15" });
  assert.equal(monthlyCommissionInfo(b as never, TOGETHER), undefined);
  assert.equal(monthlyCommissionInfo({ ...b, status: "cancelled" } as never, MONTHLY), undefined);
  assert.equal(monthlyCommissionInfo({ ...b, commissionAmount: 0 } as never, MONTHLY), undefined);
  assert.equal(monthlyCommissionInfo({ ...b, commissionAmount: 21.5, total: 200, paymentFee: 1 } as never, MONTHLY)?.pct, 11.3); // (21,5 + 1) / 200
});

test("previsione e chiamate esistenti: computeForecast non genera commissioni e funziona con la modalità mensile", () => {
  const bks = [B("b1", "g1", "2027-01-10", "2027-01-12", { paid: 0 })];
  const f = computeForecast(bks as never, guests as never, stx as never, [], "all", "2027-01-01", "2027-06-30", "banca", MONTHLY, ["banca"]);
  assert.deepEqual(f.map((m) => [m.id, m.amount]), [["fc-in-b1", 100]]);
  // le commissioni aggregate sono nei movimenti automatici: entrano nel saldo previsto dopo oggi
  const a = auto([B("b1", "g1", "2027-01-10", "2027-01-12")]);
  const open = { id: "open", date: "2027-01-01", kind: "in" as const, cat: OPENING_CAT, desc: "Saldo", amount: 500, conto: "banca" };
  const bal = computeBalances([open, ...a], "2027-01-31", ["banca"]);
  assert.equal(bal.banca.saldo, 600);
  assert.equal(projectBalance([open, ...a], bal, "2027-01-31", "2027-02-28"), 585);
});
