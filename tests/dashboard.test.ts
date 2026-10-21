import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysISO, adempimentiStato, buildAdempimenti, buildControlli, buildSetupSteps, buildTodo, cumulative, diffDays, greetingFor, isLive, monthStats,
  namesLine, occupancyOutlook, occupancyStrip, splitDay, statusSentence, todaySentence, unassignedArrivals, type DBooking, type DUnit,
} from "../src/lib/dashboard.ts";

const T = "2026-10-06";
let n = 0;
const bk = (o: Partial<DBooking> & { checkIn: string; checkOut: string }): DBooking => ({
  id: `b${++n}`, guestId: `g${n}`, structureId: "s1", unitId: null, channel: "booking", status: "confirmed", adults: 2, children: 0, ...o,
});
const units: DUnit[] = [{ id: "u1", structureId: "s1" }, { id: "u2", structureId: "s1" }, { id: "u3", structureId: "s1" }, { id: "u4", structureId: "s1", outOfService: true }];

test("date: somma giorni e differenze senza fuso", () => {
  assert.equal(addDaysISO("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysISO("2026-03-28", 1), "2026-03-29"); // cambio ora legale
  assert.equal(addDaysISO("2026-03-29", 1), "2026-03-30");
  assert.equal(diffDays("2026-10-08", T), 2);
});

test("prenotazioni vere: esclude annullate, no-show e blocchi", () => {
  assert.equal(isLive({ status: "confirmed", channel: "airbnb" }), true);
  assert.equal(isLive({ status: "cancelled", channel: "airbnb" }), false);
  assert.equal(isLive({ status: "no_show", channel: "airbnb" }), false);
  assert.equal(isLive({ status: "confirmed", channel: "blocked" }), false);
});

test("saluto per fascia oraria", () => {
  assert.equal(greetingFor(8), "Buongiorno");
  assert.equal(greetingFor(15), "Buon pomeriggio");
  assert.equal(greetingFor(21), "Buonasera");
  assert.equal(greetingFor(2), "Buonasera");
});

test("movimenti del giorno e turnover", () => {
  const a = bk({ checkIn: T, checkOut: "2026-10-09", unitId: "u1" });
  const d = bk({ checkIn: "2026-10-03", checkOut: T, unitId: "u1" });
  const s = bk({ checkIn: "2026-10-04", checkOut: "2026-10-08", unitId: "u2" });
  const x = bk({ checkIn: "2026-10-01", checkOut: "2026-10-03", unitId: "u3" });
  const r = splitDay([a, d, s, x], T);
  assert.deepEqual(r.arrivals.map((b) => b.id), [a.id]);
  assert.deepEqual(r.departures.map((b) => b.id), [d.id]);
  assert.deepEqual(r.inHouse.map((b) => b.id), [s.id]);
  assert.deepEqual([...r.turnoverUnits], ["u1"]);
});

test("frase-sintesi del giorno", () => {
  assert.equal(todaySentence(2, 2, 5).map((p) => p.text).join(""), "Oggi 2 arrivi, 2 partenze e 5 soggiorni in corso.");
  assert.equal(todaySentence(1, 0, 0).map((p) => p.text).join(""), "Oggi 1 arrivo.");
  assert.equal(todaySentence(0, 1, 1).map((p) => p.text).join(""), "Oggi 1 partenza e 1 soggiorno in corso.");
  assert.equal(todaySentence(0, 0, 3).map((p) => p.text).join(""), "Nessun movimento oggi, 3 soggiorni in corso.");
  assert.match(todaySentence(0, 0, 0)[0].text, /tranquilla/);
  assert.equal(todaySentence(1, 0, 0)[1].tone, "ok");
  assert.equal(statusSentence(0, 0), "Tutto in regola: niente da sistemare.");
  assert.equal(statusSentence(1, 0), "1 cosa da sistemare.");
  assert.equal(statusSentence(3, 1), "3 cose da sistemare, 1 urgente.");
  assert.equal(statusSentence(4, 2), "4 cose da sistemare, 2 urgenti.");
});

test("striscia occupazione: notti, arrivi, partenze, camere fuori servizio escluse", () => {
  const live = [
    bk({ checkIn: "2026-10-04", checkOut: "2026-10-08", unitId: "u1" }),   // notti 6,7
    bk({ checkIn: T, checkOut: "2026-10-07", unitId: "u2" }),              // notte 6, arrivo oggi
    bk({ checkIn: "2026-10-07", checkOut: "2026-10-09", unitId: null }),   // senza camera: occupa comunque
    bk({ checkIn: "2026-10-05", checkOut: "2026-10-07", unitId: "u4" }),   // camera fuori servizio: ignorata
    bk({ checkIn: "2026-10-20", checkOut: "2026-10-22", unitId: "u3" }),   // fuori finestra
    bk({ checkIn: "2026-09-20", checkOut: "2026-10-01", unitId: "u3" }),   // prima della finestra
  ];
  const cells = occupancyStrip(live, units, T, 4);
  assert.equal(cells.length, 4);
  assert.equal(cells[0].total, 3);
  assert.deepEqual(cells.map((c) => c.occupied), [2, 2, 1, 0]);
  assert.deepEqual(cells.map((c) => c.pct), [67, 67, 33, 0]);
  assert.deepEqual(cells.map((c) => c.arrivals), [1, 1, 0, 0]);
  assert.deepEqual(cells.map((c) => c.departures), [0, 1, 1, 1]);
  assert.equal(cells[0].isToday, true);
  assert.equal(cells[1].iso, "2026-10-07");
  assert.equal(cells[0].dow, 2); // martedì
});

test("striscia occupazione: mai oltre il 100% e senza camere non divide per zero", () => {
  const live = [bk({ checkIn: T, checkOut: "2026-10-07" }), bk({ checkIn: T, checkOut: "2026-10-07" })];
  assert.equal(occupancyStrip(live, [{ id: "x", structureId: "s1" }], T, 1)[0].pct, 100);
  assert.equal(occupancyStrip(live, [], T, 1)[0].pct, 0);
});

test("ricavi del mese per notte: maturati, da vivere, canali", () => {
  const rate = (b: DBooking) => (b.channel === "direct" ? 100 : 50);
  const live = [
    bk({ checkIn: "2026-09-29", checkOut: "2026-10-02", channel: "booking" }),   // notti 29/9, 30/9, 1/10: nel mese solo l'1
    bk({ checkIn: "2026-10-05", checkOut: "2026-10-08", channel: "direct" }),    // 5,6,7
    bk({ checkIn: "2026-10-30", checkOut: "2026-11-03", channel: "direct" }),    // 30,31 nel mese
  ];
  const m = monthStats(live, "2026-10-01", "2026-11-01", T, (b) => rate(b));
  assert.equal(m.daily.length, 31);
  assert.equal(m.total, 50 + 3 * 100 + 2 * 100);
  assert.equal(m.earned, 50 + 100);            // 1 e 5 ottobre (prima di oggi)
  assert.equal(m.ahead, m.total - m.earned);
  assert.equal(m.byChannel[0].channel, "direct");
  assert.equal(m.byChannel[0].count, 2);
  assert.equal(m.byChannel[0].revenue, 500);
  assert.equal(m.byChannel[1].revenue, 50);
  const cum = cumulative(m.daily);
  assert.equal(cum[30], m.total);
  assert.equal(cum[0], 50);
});

test("monthStats: l'aggregato Altro mostra il portale solo se è lo stesso per tutte le prenotazioni", () => {
  const rate1 = () => 100;
  const one = monthStats([
    bk({ checkIn: "2026-10-05", checkOut: "2026-10-06", channel: "other", otaName: "bb.it" }),
    bk({ checkIn: "2026-10-07", checkOut: "2026-10-08", channel: "other", otaName: "bb.it" }),
  ], "2026-10-01", "2026-11-01", T, rate1);
  assert.equal(one.byChannel[0].name, "bb.it");
  assert.equal(one.byChannel[0].mixed, undefined);
  const many = monthStats([
    bk({ checkIn: "2026-10-05", checkOut: "2026-10-06", channel: "other", otaName: "bb.it" }),
    bk({ checkIn: "2026-10-07", checkOut: "2026-10-08", channel: "other", otaName: "HotelBeds" }),
  ], "2026-10-01", "2026-11-01", T, rate1);
  assert.equal(many.byChannel[0].name, undefined);
  assert.equal(many.byChannel[0].mixed, true);
});

const steps = (o: Record<string, "done" | "todo" | "late" | "na">) => Object.entries(o).map(([key, state]) => ({ key, state }));
const base = () => ({
  today: T, journeyFor: () => null as ReturnType<typeof steps> | null, schedinaOf: () => "inviata" as const, istatPending: () => false,
  taxOf: () => 0, balanceOf: () => 0, nameOf: (b: DBooking) => `Ospite ${b.id}`,
});

test("adempimenti: niente da fare = lista vuota e stato ok", () => {
  const items = buildAdempimenti({ ...base(), bookings: [bk({ checkIn: T, checkOut: "2026-10-08" }), bk({ checkIn: "2026-10-01", checkOut: "2026-10-04" })] });
  assert.deepEqual(items, []);
  assert.deepEqual(adempimentiStato(items), { total: 0, urgent: 0, today: 0, backlog: 0, tone: "ok" });
});

test("adempimenti: check-in, schedine, saldi e tassa con urgenza e ordine", () => {
  const arrToday = bk({ checkIn: T, checkOut: "2026-10-09", unitId: "u1" });
  const inHouse = bk({ checkIn: "2026-10-04", checkOut: "2026-10-08", unitId: "u2" });
  const depToday = bk({ checkIn: "2026-10-02", checkOut: T, unitId: "u3" });
  const recent = bk({ checkIn: "2026-10-01", checkOut: "2026-10-04", unitId: "u3" });
  const future = bk({ checkIn: "2026-10-12", checkOut: "2026-10-14" });
  const stepsOf = (b: DBooking) => {
    if (b.id === arrToday.id) return steps({ checkin: "todo", guide: "late", tax: "todo" });
    if (b.id === inHouse.id) return steps({ checkin: "late", guide: "done", tax: "todo" });
    if (b.id === depToday.id) return steps({ checkin: "done", tax: "todo" });
    if (b.id === recent.id) return steps({ checkin: "done", tax: "late" });
    return steps({ checkin: "todo", guide: "todo" });
  };
  const items = buildAdempimenti({
    ...base(), bookings: [arrToday, inHouse, depToday, recent, future], journeyFor: stepsOf,
    schedinaOf: (b) => (b.id === arrToday.id ? "none" : b.id === inHouse.id ? "pronta" : b.id === recent.id ? "da_validare" : "inviata"),
    istatPending: (b) => b.id === recent.id,
    taxOf: () => 8, balanceOf: (b) => (b.id === depToday.id ? 120.5 : b.id === inHouse.id ? 80 : 0),
    questuraErrors: 2,
  });
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(by.checkin.count, 2);                 // arrivo di oggi + in casa; il futuro non conta
  assert.equal(by.checkin.tone, "err");              // l'ospite in casa è in ritardo
  assert.equal(by.questura.count, 3);                // none (oggi), pronta, da_validare (recente: schedina ancora aperta)
  assert.equal(by.questura.tone, "err");
  assert.equal(by.qerr.count, 2);
  assert.equal(by.pay.count, 2);
  assert.equal(by.pay.amount, 200.5);
  assert.equal(by.pay.tone, "err");                  // c'è una partenza oggi con saldo aperto
  assert.equal(by.tax.count, 2);                     // partenza di oggi + partita 2 giorni fa; in casa non ancora
  assert.equal(by.tax.amount, 16);
  assert.equal(by.istat.count, 1);
  assert.equal(by.guide.count, 1);
  assert.equal(by.guide.tone, "err");
  // ordine: prima gli urgenti per importanza (check-in, Questura, errori, saldi, tassa, guida), poi gli avvisi (ISTAT)
  assert.deepEqual(items.map((i) => i.key), ["checkin", "questura", "qerr", "pay", "tax", "guide", "istat"]);
  const st = adempimentiStato(items);
  assert.equal(st.tone, "err");
  assert.equal(st.total, 2 + 3 + 2 + 2 + 2 + 1 + 1);
});

test("adempimenti: i ritardi vengono prima delle scadenze di oggi", () => {
  const a = bk({ checkIn: T, checkOut: "2026-10-09" });   // oggi: check-in da fare (avviso)
  const c = bk({ checkIn: "2026-10-04", checkOut: "2026-10-08" }); // in casa: saldo aperto (avviso)
  const items = buildAdempimenti({
    ...base(), bookings: [a, c], journeyFor: (b) => steps({ checkin: b.id === a.id ? "todo" : "done" }),
    schedinaOf: (b) => (b.id === c.id ? "none" : "inviata"), balanceOf: (b) => (b.id === c.id ? 10 : 0),
  });
  // schedina mancante per chi è arrivato 2 giorni fa = in ritardo: sale sopra il check-in di oggi
  assert.deepEqual(items.map((i) => [i.key, i.tone]), [["questura", "err"], ["checkin", "warn"], ["pay", "warn"]]);
});

test("adempimenti: schedine mai preparate oltre 3 giorni non gonfiano la lista", () => {
  const old = bk({ checkIn: "2026-09-20", checkOut: "2026-09-25" });
  const items = buildAdempimenti({ ...base(), bookings: [old], schedinaOf: () => "none" });
  assert.deepEqual(items, []);
});

test("nomi: massimo due poi 'e altri N'", () => {
  assert.equal(namesLine(["Rossi", "Bianchi"]), "Rossi, Bianchi");
  assert.equal(namesLine(["Rossi", "Bianchi", "Verdi", "Neri"]), "Rossi, Bianchi e altri 2");
  assert.equal(namesLine(["Rossi", "Rossi", ""]), "Rossi");
});

test("arrivi senza camera: solo nell'orizzonte indicato", () => {
  const live = [
    bk({ checkIn: T, checkOut: "2026-10-08" }), bk({ checkIn: "2026-10-09", checkOut: "2026-10-10" }),
    bk({ checkIn: "2026-10-30", checkOut: "2026-11-01" }), bk({ checkIn: "2026-10-09", checkOut: "2026-10-10", unitId: "u1" }),
  ];
  assert.deepEqual(unassignedArrivals(live, T, 7), { count: 2, nearest: 0 });
  assert.deepEqual(unassignedArrivals([live[2]], T, 7), { count: 0, nearest: null });
});

test("da controllare: ordine, toni e testi", () => {
  const out = buildControlli({
    unassigned: { count: 2, nearest: 1 }, contacts: { count: 3, urgent: 1 },
    invii: [{ label: "Planning pulizie non consegnato su WhatsApp", href: "/pulizie" }],
    pulse: [{ channel: "airbnb", label: "Airbnb", level: "warn", headline: "Poche prenotazioni", detail: "Meno del solito" }],
    oos: 1,
  });
  assert.deepEqual(out.map((x) => x.key), ["invio0", "senzacamera", "contatti", "canale-airbnb", "oos"]);
  assert.equal(out[1].tone, "err"); assert.equal(out[1].detail, "il primo è domani");
  assert.equal(out[2].tone, "err"); assert.equal(out[2].detail, "1 arriva entro 10 giorni");
  assert.equal(out[3].label, "Airbnb: poche prenotazioni");
  assert.equal(out[4].tone, "dim");
  assert.deepEqual(buildControlli({ unassigned: { count: 0, nearest: null }, contacts: { count: 0, urgent: 0 }, invii: [], pulse: [], oos: 0 }), []);
});

const facts = (o: Partial<import("../src/lib/dashboard.ts").SetupFacts> = {}) => ({ id: "s1", name: "Casa Uno", profile: true, rooms: 3, pricedTypes: 2, totalTypes: 2, guide: true, ...o });

test("configurazione: struttura appena creata = nessun passo fatto, non completa", () => {
  const st = buildSetupSteps({ structures: [facts({ profile: false, rooms: 0, pricedTypes: 0, totalTypes: 0, guide: false })], channels: false, extraUsers: false });
  assert.deepEqual(st.steps.map((x) => x.key), ["struttura", "camere", "prezzi", "guida", "canali", "utenti"]);
  assert.equal(st.done, 0); assert.equal(st.pct, 0); assert.equal(st.complete, false);
  assert.equal(st.steps[0].href, "/strutture/s1"); // una sola struttura: apre la sua scheda
});

test("configurazione: senza strutture tutto è da fare e il passo canali non risulta fatto", () => {
  const st = buildSetupSteps({ structures: [], channels: true, extraUsers: false });
  assert.equal(st.done, 0); assert.equal(st.complete, false);
  assert.equal(st.steps[0].href, "/strutture");
});

test("configurazione: i collaboratori sono facoltativi, conta quel che manca davvero", () => {
  const ok = buildSetupSteps({ structures: [facts()], channels: true, extraUsers: false });
  assert.equal(ok.complete, true); assert.equal(ok.done, 5); assert.equal(ok.total, 6); assert.equal(ok.pct, 83);
  assert.equal(ok.steps.find((x) => x.key === "utenti")?.optional, true);
  const noGuide = buildSetupSteps({ structures: [facts({ guide: false })], channels: true, extraUsers: true });
  assert.equal(noGuide.complete, false); assert.equal(noGuide.pct, 83);
  assert.equal(noGuide.steps.find((x) => x.key === "guida")?.done, false);
});

test("configurazione: con più strutture un passo è fatto solo se lo è in tutte e dice quali mancano", () => {
  const st = buildSetupSteps({ structures: [facts(), facts({ id: "s2", name: "Casa Due", rooms: 0, pricedTypes: 1, totalTypes: 2 })], channels: true, extraUsers: false });
  const camere = st.steps.find((x) => x.key === "camere")!, prezzi = st.steps.find((x) => x.key === "prezzi")!;
  assert.equal(camere.done, false); assert.deepEqual(camere.missing, ["Casa Due"]);
  assert.equal(prezzi.done, false); assert.deepEqual(prezzi.missing, ["Casa Due"]);
  assert.equal(st.steps[0].href, "/strutture"); // più strutture: elenco
  assert.equal(st.complete, false);
});

test("da fare: urgenti prima, adempimenti prima dei controlli a parità, testi con il numero", () => {
  const items = [
    { key: "pay", short: "Saldi", one: "saldo da incassare", many: "saldi da incassare", count: 2, tone: "warn" as const, detail: "Rossi, Bianchi", amount: 300, href: "/pagamenti", bookingIds: [] },
    { key: "checkin", short: "Check-in", one: "check-in online da completare", many: "check-in online da completare", count: 1, tone: "err" as const, detail: "Verdi", href: "/adempimenti", bookingIds: [] },
    { key: "tax", short: "Tassa", one: "tassa di soggiorno da incassare", many: "tassa di soggiorno da incassare", count: 3, tone: "warn" as const, detail: "", amount: 12, href: "/tassa-soggiorno", bookingIds: [] },
  ];
  const ctr = buildControlli({ unassigned: { count: 2, nearest: 0 }, contacts: { count: 0, urgent: 0 }, invii: [], pulse: [], oos: 1 });
  const rows = buildTodo(items, ctr);
  assert.deepEqual(rows.map((r) => r.key), ["checkin", "senzacamera", "pay", "tax", "oos"]);
  assert.equal(rows[0].title, "1 check-in online da completare"); assert.equal(rows[0].label, "Urgente"); assert.equal(rows[0].action, "Sollecita");
  assert.equal(rows[1].title, "2 arrivi senza camera assegnata"); assert.equal(rows[1].action, "Assegna");
  assert.equal(rows[2].label, "Oggi"); assert.equal(rows[2].amount, 300); assert.equal(rows[2].detail, "Rossi, Bianchi");
  assert.equal(rows[3].title, "3 tasse di soggiorno da incassare"); assert.equal(rows[3].detail, undefined);
  assert.equal(rows[4].tone, "dim"); assert.equal(rows[4].title, "1 camera fuori servizio");
  assert.deepEqual(buildTodo([], []), []);
});

test("occupazione: media, giorno più pieno e più libero, giorni al completo; senza camere tutto a zero", () => {
  const units: DUnit[] = [{ id: "u1", structureId: "s1" }, { id: "u2", structureId: "s1" }];
  const live = [bk({ checkIn: T, checkOut: "2026-10-08", unitId: "u1" }), bk({ checkIn: T, checkOut: "2026-10-07", unitId: "u2" })];
  const cells = occupancyStrip(live, units, T, 4, T); // 6, 7, 8, 9 ottobre: 100%, 50%, 0%, 0%
  assert.deepEqual(cells.map((c) => c.pct), [100, 50, 0, 0]);
  const o = occupancyOutlook(cells);
  assert.equal(o.avg, 38); assert.equal(o.fullDays, 1);
  assert.deepEqual(o.peak, { iso: "2026-10-06", pct: 100 }); assert.deepEqual(o.low, { iso: "2026-10-08", pct: 0 });
  assert.deepEqual(occupancyOutlook(occupancyStrip([], [], T, 3, T)), { avg: 0, peak: null, low: null, fullDays: 0 });
});
