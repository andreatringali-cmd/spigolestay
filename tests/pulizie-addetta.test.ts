import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const L = await import("../src/lib/pulizie-addetta.ts");

// Settimana di prova: lun 12/10/2026 … dom 18/10/2026
const MON = "2026-10-12", TUE = "2026-10-13", WED = "2026-10-14", THU = "2026-10-15", SUN = "2026-10-18";
const chk = (taskId: string, targetId: string, date: string, i = 0) => ({ id: `${taskId}-${targetId}-${date}-${i}`, taskId, targetId, date, at: `${date}T09:0${i}:00`, updatedAt: 1 });

test("settimana ISO: lunedì come primo giorno", () => {
  assert.equal(L.isoWeekday(MON), 1);
  assert.equal(L.isoWeekday(SUN), 7);
  assert.equal(L.weekStart(THU), MON);
  assert.equal(L.weekStart(SUN), MON);
  assert.deepEqual(L.weekDates(WED).slice(0, 2), [MON, TUE]);
  assert.equal(L.weekDates(WED).length, 7);
});

test("mesi: spostamento e nome", () => {
  assert.equal(L.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(L.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(L.monthName("2026-10"), "ottobre 2026");
});

test("frequenza: normalizzazione ed etichetta", () => {
  assert.deepEqual(L.normalizeFreq({ kind: "weekly", times: 0 }), { kind: "weekly", times: 1 });
  assert.deepEqual(L.normalizeFreq({ kind: "weekly", times: 99 }), { kind: "weekly", times: 7 });
  assert.deepEqual(L.normalizeFreq({ kind: "days", days: [5, 2, 2, 9, 0] }), { kind: "days", days: [2, 5] });
  assert.deepEqual(L.normalizeFreq({ kind: "days", days: [] }), { kind: "weekly", times: 1 });
  assert.equal(L.freqLabel({ kind: "weekly", times: 1 }), "1 volta a settimana");
  assert.equal(L.freqLabel({ kind: "weekly", times: 2 }), "2 volte a settimana");
  assert.equal(L.freqLabel({ kind: "days", days: [2, 5] }), "Mar · Ven");
  assert.equal(L.requiredPerWeek({ kind: "days", days: [1, 3, 5] }), 3);
});

test("N volte a settimana: avanzamento 1/2, poi fatta; urgente quando i giorni rimasti non bastano più", () => {
  const t = { id: "t1", freq: { kind: "weekly", times: 2 } } as const;
  let s = L.taskState(t, "z", [], MON);
  assert.deepEqual([s.done, s.required, s.state], [0, 2, "todo"]); // lunedì: ci sono 7 giorni, 2 volte bastano
  s = L.taskState(t, "z", [], SUN);
  assert.equal(s.state, "urgent"); // domenica: ne servono 2 e resta 1 giorno
  s = L.taskState(t, "z", [chk("t1", "z", MON)], WED);
  assert.deepEqual([s.done, s.state], [1, "todo"]);
  s = L.taskState(t, "z", [chk("t1", "z", MON), chk("t1", "z", WED)], WED);
  assert.deepEqual([s.done, s.state], [2, "done"]);
  assert.equal(s.today?.date, WED);
  // le spunte della settimana scorsa o di un altro luogo non contano
  s = L.taskState(t, "z", [chk("t1", "z", "2026-10-09"), chk("t1", "altro", MON), chk("t2", "z", MON)], WED);
  assert.equal(s.done, 0);
});

test("una volta a settimana: urgente solo l'ultimo giorno", () => {
  const t = { id: "t1", freq: { kind: "weekly", times: 1 } } as const;
  assert.equal(L.taskState(t, "z", [], SUN).state, "urgent");
  assert.equal(L.taskState(t, "z", [], THU).state, "todo");
});

test("giorni fissi (mar/ven): dovuta il martedì, in ritardo il mercoledì, poi più tardi/fatta", () => {
  const t = { id: "t1", freq: { kind: "days", days: [2, 5] } } as const;
  let s = L.taskState(t, "z", [], MON);
  assert.deepEqual([s.state, s.nextDay, s.overdue], ["later", 2, false]);
  s = L.taskState(t, "z", [], TUE);
  assert.deepEqual([s.state, s.overdue], ["urgent", false]);
  s = L.taskState(t, "z", [], WED);
  assert.deepEqual([s.state, s.overdue], ["urgent", true]);
  s = L.taskState(t, "z", [chk("t1", "z", TUE)], WED);
  assert.deepEqual([s.state, s.nextDay, s.overdue, s.done], ["later", 5, false, 1]);
  s = L.taskState(t, "z", [chk("t1", "z", TUE), chk("t1", "z", "2026-10-16")], "2026-10-16");
  assert.equal(s.state, "done");
});

test("spunta: aggiunge, e un secondo tocco nello stesso giorno la toglie (soft-delete)", () => {
  const base = { taskId: "t1", targetId: "z", todayISO: THU, nowISO: `${THU}T10:00:00`, nowMs: 100 };
  const a = L.toggleCheck([], { ...base, newId: "c1" });
  assert.equal(a.length, 1);
  assert.equal(a[0].date, THU);
  const b = L.toggleCheck(a, { ...base, newId: "c2", nowMs: 200 });
  assert.equal(b.length, 1);
  assert.equal(b[0]._deleted, true);
  assert.equal(b[0].updatedAt, 200); // il timbro più recente fa vincere la cancellazione nella fusione per id
  assert.equal(L.liveChecks(b).length, 0);
  const c = L.toggleCheck(b, { ...base, newId: "c3", nowMs: 300 });
  assert.equal(L.liveChecks(c).length, 1); // si può rispuntare
});

test("luoghi: zona per struttura per le voci comuni, camere per quelle di camera", () => {
  const structures = [{ id: "s1", name: "House" }, { id: "s2", name: "Rooms" }] as never[];
  const units = [{ id: "u10", structureId: "s1", name: "10" }, { id: "u2", structureId: "s1", name: "2" }, { id: "u3", structureId: "s2", name: "3" }] as never[];
  const common = { id: "t", name: "x", scope: "common", freq: { kind: "weekly", times: 1 } } as never;
  assert.deepEqual(L.targetsFor(common, structures, units).map((t: { id: string }) => t.id), ["zona:s1", "zona:s2"]);
  assert.deepEqual(L.targetsFor({ ...(common as object), structureId: "s2" } as never, structures, units).map((t: { id: string }) => t.id), ["zona:s2"]);
  const room = { id: "t", name: "x", scope: "room", freq: { kind: "weekly", times: 1 } } as never;
  assert.deepEqual(L.targetsFor(room, structures, units).map((t: { label: string }) => t.label), ["2", "10", "3"]); // ordine naturale
  assert.deepEqual(L.targetsFor({ ...(room as object), structureId: "s1", unitIds: ["u10"] } as never, structures, units).map((t: { id: string }) => t.id), ["u10"]);
});

test("avanzamento della settimana: ogni voce conta al massimo il richiesto", () => {
  const structures = [{ id: "s1", name: "House" }] as never[];
  const tasks = [
    { id: "a", name: "A", scope: "common", freq: { kind: "weekly", times: 2 } },
    { id: "b", name: "B", scope: "common", freq: { kind: "weekly", times: 1 } },
    { id: "c", name: "C", scope: "common", freq: { kind: "weekly", times: 1 }, _deleted: true },
  ] as never[];
  const checks = [chk("a", "zona:s1", MON), chk("a", "zona:s1", TUE), chk("a", "zona:s1", WED), chk("c", "zona:s1", MON)];
  const w = L.weekSummary(tasks, structures, [], checks, THU);
  assert.deepEqual(w, { required: 3, done: 2, targets: 2, completed: 1 });
});

test("ore: lettura con virgola, limiti e formato", () => {
  assert.equal(L.parseHours("4,5"), 4.5);
  assert.equal(L.parseHours("3.25"), 3.25);
  assert.equal(L.parseHours(""), null);
  assert.equal(L.parseHours("0"), null);
  assert.equal(L.parseHours("25"), null);
  assert.equal(L.parseHours("abc"), null);
  assert.equal(L.fmtHours(4.5), "4,5 h");
  assert.equal(L.fmtHours(8), "8 h");
});

test("riepilogo mensile: ore totali, attività, ripartizione in parti uguali e ore senza attività", () => {
  const tasks = [{ id: "t1", name: "Scale" }, { id: "t2", name: "Vetri" }] as never[];
  const hours = [
    { id: "h1", date: "2026-10-12", hours: 6, updatedAt: 1 },
    { id: "h2", date: "2026-10-13", hours: 4, updatedAt: 1 },
    { id: "h3", date: "2026-10-14", hours: 2, updatedAt: 1, _deleted: true }, // cancellata: non conta
    { id: "h4", date: "2026-09-30", hours: 5, updatedAt: 1 },                   // altro mese
  ] as never[];
  const checks = [chk("t1", "z", "2026-10-12"), chk("t2", "z", "2026-10-12"), { ...chk("t2", "z", "2026-10-12", 1), _deleted: true }, chk("t1", "z", "2026-10-20")] as never[];
  const roomDates = ["2026-10-12", "2026-10-12", "2026-10-12", "2026-10-12", "2026-09-30"];
  const s = L.monthSummary({ ym: "2026-10", hours, checks, roomDates, tasks });
  assert.equal(s.totalHours, 10);
  assert.equal(s.daysWorked, 2);
  assert.equal(s.roomsCleaned, 4);
  assert.equal(s.taskChecks, 3);
  // 12/10: 6 ore su 4 camere + 2 voci = 6 attività → 1 ora ciascuna
  const d12 = s.days.find((d: { date: string }) => d.date === "2026-10-12");
  assert.deepEqual(d12, { date: "2026-10-12", hours: 6, rooms: 4, checks: 2 });
  const rooms = s.perTask.find((r: { id: string }) => r.id === L.ROOMS_ROW_ID);
  assert.deepEqual([rooms?.checks, rooms?.estHours], [4, 4]);
  assert.equal(s.perTask.find((r: { id: string }) => r.id === "t1")?.estHours, 1);
  // 13/10: 4 ore ma nessuna attività spuntata → non assegnate; 20/10: attività senza ore
  assert.equal(s.unallocatedHours, 4);
  assert.equal(s.days.find((d: { date: string }) => d.date === "2026-10-20")?.hours, 0);
});

test("segnalazioni: crea per camera o zona, risolvi e riapri, elimina (soft-delete); testo vuoto ignorato", () => {
  const structures = [{ id: "s1", name: "House" }] as never[];
  const units = [{ id: "u1", structureId: "s1", name: "Camera 1" }] as never[];
  const targets = L.issueTargets(structures, units);
  assert.deepEqual(targets.map((t: { unitId: string }) => t.unitId), ["zona:s1", "u1"]);
  const p = { id: "i1", target: targets[1], type: "guasto", note: "  Non funziona la TV  ", dateISO: THU, nowISO: `${THU}T09:00:00`, nowMs: 10 };
  let list = L.createIssue([], p);
  assert.equal(list.length, 1);
  assert.equal(list[0].note, "Non funziona la TV");
  assert.equal(list[0].structureId, "s1");
  assert.equal(L.createIssue(list, { ...p, id: "i2", note: "   " }).length, 1);
  list = L.setIssueResolved(list, "i1", true, `${THU}T11:00:00`, 20);
  assert.deepEqual([list[0].resolved, list[0].resolvedAt], [true, `${THU}T11:00:00`]);
  list = L.setIssueResolved(list, "i1", false, "x", 30);
  assert.deepEqual([list[0].resolved, list[0].resolvedAt], [false, undefined]);
  list = L.removeEntity(list, "i1", 40);
  assert.equal(list[0]._deleted, true);
  assert.equal(L.isZoneId("zona:s1"), true);
  assert.equal(L.isZoneId("u1"), false);
});

test("acquisti: importo, abbinamento alle scorte e riepilogo del periodo", () => {
  assert.equal(L.parseMoney("12,50"), 12.5);
  assert.equal(L.parseMoney(""), undefined);
  assert.equal(L.parseMoney("-3"), undefined);
  assert.equal(L.parseMoney("abc"), undefined);
  const stock = [{ id: "p1", name: "Carta  igienica", structureId: "s1", qty: 2 }, { id: "p2", name: "Anticalcare", structureId: "s1", qty: 1, _deleted: true }] as never[];
  assert.equal(L.matchStock(stock, "carta igienica", "s1")?.id, "p1");
  assert.equal(L.matchStock(stock, "carta igienica", "s2"), undefined);
  assert.equal(L.matchStock(stock, "anticalcare", "s1"), undefined); // eliminata
  const o = (id: string, name: string, date: string, qty: number, cost?: number, extra = {}) => ({ id, productId: "", productName: name, structureId: "s1", date, qty, cost, updatedAt: 1, ...extra });
  const orders = [
    o("1", "Carta igienica", "2026-10-03T10:00:00", 12, 8.4),
    o("2", "carta igienica", "2026-10-20T10:00:00", 6, 4.2),
    o("3", "Spugne", "2026-10-21T10:00:00", 3),
    o("4", "Detersivo", "2026-10-22T10:00:00", 1, 3, { _deleted: true }),
    o("5", "Fuori mese", "2026-09-30T23:00:00", 1, 99),
  ] as never[];
  const { from, to } = L.monthBounds("2026-10");
  const s = L.summarizePurchases(orders, from, to);
  assert.equal(s.total, 12.6);
  assert.equal(s.count, 3);
  assert.equal(s.withoutCost, 1);
  assert.deepEqual(s.rows[0], { name: "Carta igienica", qty: 18, cost: 12.6, count: 2 });
});

test("profilo solo Pulizie: porta dritto alla pagina; chi ha altro no", () => {
  assert.equal(L.isPulizieOnly({ pulizie: "edit" }), true);
  assert.equal(L.isPulizieOnly({ pulizie: "edit", cassa: "none", prenotazioni: "none" }), true);
  assert.equal(L.isPulizieOnly({ pulizie: "view" }), true);
  assert.equal(L.isPulizieOnly({ pulizie: "edit", calendario: "view" }), false);
  assert.equal(L.isPulizieOnly({ prenotazioni: "edit" }), false);
  assert.equal(L.isPulizieOnly({ cassa: "none" }), false);
  assert.equal(L.isPulizieOnly(undefined), false);
});

test("agenda: arrivi, partenze e fermi per i giorni a venire", () => {
  const structures = [{ id: "s1", name: "House" }] as never[];
  const units = [{ id: "u1", structureId: "s1", roomTypeId: "r1", name: "1" }, { id: "u2", structureId: "s1", roomTypeId: "r1", name: "2" }] as never[];
  const roomTypes = [{ id: "r1", structureId: "s1", name: "Doppia", beds: 2 }] as never[];
  const bk = (id: string, unitId: string, checkIn: string, checkOut: string) => ({ id, unitId, structureId: "s1", checkIn, checkOut, status: "confirmed", channel: "direct", guestId: "g", adults: 2, children: 0 });
  const bookings = [bk("a", "u1", "2026-10-15", "2026-10-18"), bk("b", "u2", "2026-10-13", "2026-10-16")] as never[];
  const ag = L.buildAgenda({ from: THU, days: 3, structures, units, roomTypes, bookings });
  assert.deepEqual(ag.map((d: { date: string }) => d.date), ["2026-10-15", "2026-10-16", "2026-10-17"]);
  // 15: arriva la 1, la 2 è ferma (in casa)
  assert.deepEqual([ag[0].arrivi, ag[0].partenze, ag[0].fermi], [1, 0, 1]);
  // 16: parte la 2, la 1 è ferma
  assert.deepEqual([ag[1].arrivi, ag[1].partenze, ag[1].fermi], [0, 1, 1]);
  // 17: solo la 1 ferma
  assert.deepEqual([ag[2].arrivi, ag[2].partenze, ag[2].fermi], [0, 0, 1]);
  assert.equal(ag[2].rooms.length, 1);
});
