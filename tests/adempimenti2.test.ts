import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysISO, buildArrivalGroups, buildCalendar, buildTasks, buildTimeline, compareTasks, diffDays, nextTask, nWord, questuraDeadline, relDay,
  shortDate, spanLabel, summarize, type ABooking, type DocRow, type PassiveRow, type PGuest, type SchedRow, type Task, type TasksInput,
} from "../src/lib/adempimenti2.ts";

const T = "2026-10-06";
const NOW = new Date(`${T}T10:00:00`).getTime(); // ora locale: la scadenza Questura è calcolata in ora locale
const FULL: PGuest = { firstName: "Mario", lastName: "Rossi", sex: "M", birthDate: "1980-01-01", birthPlace: "Roma", citizenship: "IT", docType: "CI", docNumber: "AB1" };

let n = 0;
const bk = (o: Partial<ABooking> & { checkIn: string; checkOut: string }): ABooking => ({
  id: `b${++n}`, guestId: `g${n}`, structureId: "s1", code: `C${String(n).padStart(3, "0")}`, status: "confirmed", channel: "booking", adults: 2, children: 0, ...o,
});
/** Prenotazione con check-in online completo (2 ospiti con tutti i dati). */
const done = (o: Partial<ABooking> & { checkIn: string; checkOut: string }): ABooking => bk({ webCheckin: true, primaryGuest: FULL, extraGuests: [{ ...FULL, firstName: "Anna" }], ...o });
const sched = (b: ABooking, stato: string, arrival = b.checkIn): SchedRow => ({ id: `s${++n}`, arrival, stato, booking_id: b.id, structure_id: b.structureId });

function run(over: Partial<TasksInput<ABooking>> & { bookings: ABooking[] }) {
  return buildTasks<ABooking>({
    today: T, nowMs: NOW, primaryOf: (b) => b.primaryGuest, nameOf: (b) => `Ospite ${b.code}`, sched: [], istat: [],
    taxOf: () => 0, balanceOf: () => 0, totalOf: () => 0, docs: [], passive: [], ...over,
  });
}
const byKind = (tasks: Task[], kind: string) => tasks.filter((t) => t.kind === kind);

test("date e testi", () => {
  assert.equal(addDaysISO("2026-10-31", 1), "2026-11-01");
  assert.equal(diffDays("2026-10-08", T), 2);
  assert.equal(shortDate("2026-10-06"), "6 ott");
  assert.equal(relDay("2026-10-06", T), "oggi");
  assert.equal(relDay("2026-10-07", T), "domani");
  assert.equal(relDay("2026-10-04", T), "2 giorni fa");
  assert.equal(relDay("2026-10-09", T), "tra 3 giorni");
  assert.equal(nWord(1, "schedina", "schedine"), "1 schedina");
  assert.equal(spanLabel(20 * 60000), "20 minuti");
  assert.equal(spanLabel(3600000), "1 ora");
  assert.equal(spanLabel(5 * 3600000), "5 ore");
  assert.equal(spanLabel(86400000 + 3 * 3600000), "1 giorno e 3 ore");
  assert.equal(spanLabel(-3 * 86400000), "3 giorni");
});

test("scadenza Questura: arrivo + 24 ore (arrivo assunto alle 14:00)", () => {
  const ok = questuraDeadline(T, NOW); // scade domani alle 14:00 = 28 ore da ora
  assert.equal(ok.over, false);
  assert.equal(ok.deadlineISO, "2026-10-07");
  assert.equal(ok.label, "Scade tra 1 giorno e 4 ore");
  const late = questuraDeadline("2026-10-04", NOW); // scaduta il 5 alle 14:00 = 20 ore fa
  assert.equal(late.over, true);
  assert.equal(late.label, "In ritardo di 20 ore");
  assert.equal(questuraDeadline("2026-10-03", NOW).label, "In ritardo di 1 giorno e 20 ore");
});

test("gruppi: più camere dello stesso gruppo sono UNA voce, stato aggregato", () => {
  const a = done({ checkIn: T, checkOut: "2026-10-08", groupId: "G1", code: "A1" });
  const b = bk({ checkIn: T, checkOut: "2026-10-08", groupId: "G1", code: "A2" }); // check-in non fatto
  const c = done({ checkIn: T, checkOut: "2026-10-08", code: "B1" });
  const g = buildArrivalGroups([a, b, c], (x) => x.primaryGuest);
  assert.equal(g.length, 2);
  const grp = g.find((x) => x.key === "G1")!;
  assert.equal(grp.rooms, 2);
  assert.equal(grp.rep.code, "A1");
  assert.equal(grp.cat, "todo");
  assert.equal(g.find((x) => x.rep.code === "B1")!.cat, "done");
  // completo ma con dati non validi (manca la nascita) = da correggere, non "fatto"
  const bad = bk({ checkIn: T, checkOut: "2026-10-08", webCheckin: true, adults: 1, primaryGuest: { ...FULL, birthDate: undefined } });
  assert.equal(buildArrivalGroups([bad], (x) => x.primaryGuest)[0].cat, "fix");
});

test("check-in: urgenza per data di arrivo, finestra di 3 giorni, esclude annullate/no-show/bloccate", () => {
  const late = bk({ checkIn: "2026-10-04", checkOut: "2026-10-08" });              // in casa, check-in mancante
  const today = bk({ checkIn: T, checkOut: "2026-10-08", adults: 2, webCheckin: true, primaryGuest: FULL }); // 1/2 = incompleto
  const soon = bk({ checkIn: "2026-10-08", checkOut: "2026-10-10" });
  const far = bk({ checkIn: "2026-10-12", checkOut: "2026-10-14" });               // oltre l'orizzonte
  const gone = bk({ checkIn: "2026-10-01", checkOut: "2026-10-05" });              // già partito
  const canc = bk({ checkIn: T, checkOut: "2026-10-08", status: "cancelled" });
  const blk = bk({ checkIn: T, checkOut: "2026-10-08", channel: "blocked" });
  const ok = done({ checkIn: T, checkOut: "2026-10-08" });
  const r = run({ bookings: [late, today, soon, far, gone, canc, blk, ok] });
  const ci = r.tasks.filter((t) => t.ente === "checkin");
  assert.deepEqual(ci.map((t) => [t.repId, t.urgency]), [[late.id, "late"], [today.id, "today"], [soon.id, "soon"]]);
  assert.equal(ci[0].dueLabel, "In ritardo di 2 giorni");
  assert.equal(ci[1].status, "Incompleto 1/2");
  assert.equal(ci[1].dueLabel, "Arriva oggi");
  assert.equal(ci[2].dueLabel, "Arrivo tra 2 giorni");
  assert.equal(ci[0].action.kind, "resolve");
  assert.equal(ci[0].action.step, "checkin");
  assert.equal(r.done.checkin, 1); // l'arrivo di oggi completo
});

test("check-in completo ma con dati non validi: voce 'da correggere' con azione Correggi", () => {
  const bad = bk({ checkIn: T, checkOut: "2026-10-08", adults: 1, webCheckin: true, primaryGuest: { ...FULL, birthPlace: "" } });
  const r = run({ bookings: [bad] });
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].kind, "checkin_fix");
  assert.equal(r.tasks[0].action.kind, "fix");
});

test("Questura: pronta solo se il check-in è completo e nessuna schedina della prenotazione è da validare", () => {
  const a = done({ checkIn: T, checkOut: "2026-10-08" });
  const b = bk({ checkIn: T, checkOut: "2026-10-08" });                   // check-in NON completo
  const c = done({ checkIn: T, checkOut: "2026-10-08" });
  const f = done({ checkIn: "2026-10-10", checkOut: "2026-10-12" });      // arrivo futuro
  const rows = [sched(a, "pronta"), sched(a, "pronta"), sched(b, "pronta"), sched(c, "pronta"), sched(c, "da_validare"), sched(f, "pronta")];
  const r = run({ bookings: [a, b, c, f], sched: rows });
  const send = byKind(r.tasks, "questura_send");
  assert.equal(send.length, 1);
  assert.equal(send[0].repId, a.id);
  assert.equal(send[0].count, 2); // due schedine, una voce
  assert.equal(send[0].urgency, "today");
  assert.equal(send[0].dueISO, "2026-10-07");
  assert.match(send[0].dueLabel, /^Scade tra /);
  // la prenotazione con schedina da validare compare come "dati non accettati"
  const fix = byKind(r.tasks, "questura_fix");
  assert.deepEqual(fix.map((t) => t.repId), [c.id]);
});

test("Questura: oltre le 24 ore dall'arrivo è in ritardo; le inviate di ieri/oggi contano come fatte", () => {
  const a = done({ checkIn: "2026-10-04", checkOut: "2026-10-08" });
  const sentToday = done({ checkIn: T, checkOut: "2026-10-08" });
  const sentOld = done({ checkIn: "2026-09-01", checkOut: "2026-09-03" });
  const r = run({ bookings: [a, sentToday, sentOld], sched: [sched(a, "pronta"), sched(sentToday, "inviata"), sched(sentOld, "inviata")] });
  const send = byKind(r.tasks, "questura_send");
  assert.equal(send[0].urgency, "late");
  assert.equal(send[0].dueLabel, "In ritardo di 20 ore");
  assert.equal(r.done.questura, 1);
});

test("Questura: la correzione dei dati non si conta due volte; prenotazioni senza schedina da preparare", () => {
  const bad = bk({ checkIn: T, checkOut: "2026-10-08", adults: 1, webCheckin: true, primaryGuest: { ...FULL, sex: undefined } });
  const r1 = run({ bookings: [bad], sched: [sched(bad, "da_validare")] });
  assert.equal(byKind(r1.tasks, "checkin_fix").length, 1);
  assert.equal(byKind(r1.tasks, "questura_fix").length, 0);

  const nosched1 = done({ checkIn: T, checkOut: "2026-10-08" });
  const nosched2 = done({ checkIn: "2026-10-03", checkOut: "2026-10-07" });
  const old = done({ checkIn: "2026-09-20", checkOut: "2026-09-22" });   // oltre una settimana: non si prepara
  const future = done({ checkIn: "2026-10-09", checkOut: "2026-10-10" }); // futuro: non ancora dovuta
  const r2 = run({ bookings: [nosched1, nosched2, old, future] });
  const prep = byKind(r2.tasks, "questura_prepare");
  assert.equal(prep.length, 1);
  assert.equal(prep[0].count, 2);
  assert.equal(prep[0].action.kind, "sync");
  assert.equal(prep[0].action.sync, "alloggiati");
  assert.equal(prep[0].urgency, "late"); // l'arrivo del 3 è già oltre le 24 ore
});

test("ISTAT: una voce per struttura, solo movimenti pending di prenotazioni vive già arrivate", () => {
  const a = done({ checkIn: T, checkOut: "2026-10-08" });
  const b = done({ checkIn: "2026-10-04", checkOut: "2026-10-08" });
  const c = done({ checkIn: "2026-10-05", checkOut: "2026-10-08", structureId: "s2" });
  const x = done({ checkIn: T, checkOut: "2026-10-08", status: "cancelled" });
  const row = (bb: ABooking, stato: string, arrival = bb.checkIn): SchedRow => ({ id: `i${++n}`, arrival, stato, booking_id: bb.id, structure_id: bb.structureId });
  const r = run({ bookings: [a, b, c, x], istat: [row(a, "pending"), row(b, "pending"), row(c, "pending"), row(x, "pending"), row(a, "pending", "2026-10-20"), row(b, "sent", T)] });
  const ist = byKind(r.tasks, "istat_send");
  assert.equal(ist.length, 2);
  const s1 = ist.find((t) => t.structureId === "s1")!;
  assert.equal(s1.count, 2);
  assert.equal(s1.title, "2 movimenti da comunicare");
  assert.equal(s1.meta[0], "Arrivi dal 4 ott");
  assert.equal(s1.urgency, "today"); // nessuna scadenza nota: non si dichiara "in ritardo"
  assert.equal(r.done.istat, 1);
});

test("tassa di soggiorno e saldi: solo partenze recenti; in ritardo / oggi / domani", () => {
  const left = done({ checkIn: "2026-10-01", checkOut: "2026-10-04" });         // partito da 2 giorni
  const today = done({ checkIn: "2026-10-03", checkOut: T });                    // parte oggi
  const tomorrow = done({ checkIn: "2026-10-04", checkOut: "2026-10-07" });      // parte domani
  const stay = done({ checkIn: "2026-10-04", checkOut: "2026-10-10" });          // in casa, parte tra giorni
  const ancient = done({ checkIn: "2026-08-01", checkOut: "2026-08-04" });       // oltre 14 giorni
  const paid = done({ checkIn: "2026-10-03", checkOut: T, cityTaxPaid: true });
  const r = run({
    bookings: [left, today, tomorrow, stay, ancient, paid],
    taxOf: () => 8,
    balanceOf: (b) => (b === paid ? 0 : 100),
    totalOf: () => 200,
  });
  const tax = byKind(r.tasks, "tax");
  assert.deepEqual(tax.map((t) => [t.repId, t.urgency]), [[left.id, "late"], [today.id, "today"]]);
  assert.equal(tax[0].dueLabel, "In ritardo di 2 giorni");
  assert.equal(tax[1].dueLabel, "Parte oggi");
  assert.equal(tax[0].amount, 8);
  const pay = byKind(r.tasks, "pay");
  assert.deepEqual(pay.map((t) => [t.repId, t.urgency]), [[left.id, "late"], [today.id, "today"], [tomorrow.id, "soon"]]);
  assert.equal(pay[2].dueLabel, "Parte domani");
  assert.equal(r.done.tassa, 1);       // la tassa incassata del check-out di oggi
  assert.equal(r.done.pagamenti, 1);   // il saldo saldato di oggi
});

test("fatture: scartate SdI, da incassare per scadenza, fornitori; senza scadenza non sono scadenze", () => {
  const d = (id: string, o: Partial<DocRow>): DocRow => ({ id, structure_id: "s1", number_label: `F${id}`, stato: "emessa", doc_kind: "fattura", name: `Cliente ${id}`, due_date: null, residuo_cents: 10000, ...o });
  const docs = [
    d("1", { stato: "scartata" }),
    d("2", { due_date: "2026-10-01" }),         // scaduta da 5 giorni
    d("3", { due_date: T }),
    d("4", { due_date: "2026-10-09" }),         // entro 7 giorni
    d("5", { due_date: "2026-11-30" }),         // lontana
    d("6", {}),                                 // senza scadenza
    d("7", { due_date: "2026-10-01", residuo_cents: 0 }),
    d("8", { due_date: "2026-10-01", doc_kind: "nota_di_credito" }),
  ];
  const passive: PassiveRow[] = [
    { id: "p1", structure_id: "s1", supplier_name: "Enel", due_date: "2026-10-02", total_cents: 5000, paid: false },
    { id: "p2", structure_id: "s1", supplier_name: "Acqua", due_date: "2026-10-02", total_cents: 5000, paid: true },
    { id: "p3", structure_id: "s1", supplier_name: "Gas", due_date: "2026-10-08", total_cents: 7000, paid: false },
  ];
  const r = run({ bookings: [], docs, passive });
  assert.deepEqual(byKind(r.tasks, "doc_rejected").map((t) => t.title), ["Cliente 1"]);
  const un = byKind(r.tasks, "doc_unpaid");
  assert.deepEqual(un.map((t) => [t.title, t.urgency]), [["Cliente 2", "late"], ["Cliente 3", "today"], ["Cliente 4", "soon"]]);
  assert.equal(un[0].dueLabel, "Scaduta da 5 giorni");
  assert.equal(un[1].dueLabel, "Scade oggi");
  assert.equal(un[2].dueLabel, "Scade tra 3 giorni");
  assert.equal(un[0].amount, 100);
  const sup = byKind(r.tasks, "supplier");
  assert.deepEqual(sup.map((t) => [t.title, t.urgency, t.dueLabel]), [["Enel", "late", "Scaduta da 4 giorni"], ["Gas", "soon", "Scade tra 2 giorni"]]);
  assert.equal(sup[0].amount, 50);
});

test("ordinamento: urgenza, poi ente, poi scadenza", () => {
  const late = bk({ checkIn: "2026-10-04", checkOut: "2026-10-08" });
  const a = done({ checkIn: T, checkOut: "2026-10-08" });
  const r = run({ bookings: [late, a], sched: [sched(a, "pronta")] });
  const kinds = r.tasks.map((t) => t.kind);
  assert.deepEqual(kinds, ["checkin", "questura_send"]); // in ritardo prima del "da fare oggi", anche se la Questura ha priorità di ente
  assert.ok(compareTasks(r.tasks[0], r.tasks[1]) < 0);
});

test("riepilogo: anello = fatti / (fatti + da fare adesso); i 'prossimi giorni' non contano", () => {
  const late = bk({ checkIn: "2026-10-04", checkOut: "2026-10-08" });
  const soon = bk({ checkIn: "2026-10-08", checkOut: "2026-10-10" });
  const ok1 = done({ checkIn: T, checkOut: "2026-10-08" });
  const ok2 = done({ checkIn: T, checkOut: "2026-10-08" });
  const ok3 = done({ checkIn: T, checkOut: "2026-10-08" });
  const r = run({ bookings: [late, soon, ok1, ok2, ok3], sched: [sched(ok1, "inviata"), sched(ok2, "inviata"), sched(ok3, "inviata")] });
  const s = summarize(r.tasks, r.done);
  assert.equal(s.late, 1);
  assert.equal(s.soon, 1);
  assert.equal(s.todo, 1);
  assert.equal(s.done, 6); // 3 check-in completi + 3 schedine inviate
  assert.equal(s.pct, 86); // 6 / (6 + 1)
  assert.equal(s.tone, "err");
  assert.equal(s.byEnte.find((e) => e.ente === "checkin")!.total, 2);
  assert.equal(s.byEnte.find((e) => e.ente === "questura")!.tone, "ok");
  // tutto in regola
  const empty = summarize([], { questura: 0, istat: 0, tassa: 0, checkin: 0, pagamenti: 0, fatture: 0 });
  assert.equal(empty.pct, 100);
  assert.equal(empty.tone, "ok");
});

test("prossima cosa da fare: la più urgente, mai un 'prossimi giorni'", () => {
  const soon = bk({ checkIn: "2026-10-08", checkOut: "2026-10-10" });
  assert.equal(nextTask(run({ bookings: [soon] }).tasks), null);
  const late = bk({ checkIn: "2026-10-04", checkOut: "2026-10-08" });
  assert.equal(nextTask(run({ bookings: [soon, late] }).tasks)?.repId, late.id);
  assert.equal(nextTask([]), null);
});

test("calendario: oggi raccoglie ritardi e voci senza data; arrivi con check-in mancante", () => {
  const late = bk({ checkIn: "2026-10-04", checkOut: "2026-10-08" });
  const soon = bk({ checkIn: "2026-10-08", checkOut: "2026-10-10" });
  const ok = done({ checkIn: "2026-10-08", checkOut: "2026-10-10" });
  const far = bk({ checkIn: "2026-10-11", checkOut: "2026-10-12" });      // dentro i 7 giorni, fuori dall'orizzonte dei check-in: solo "arrivi"
  const bookings = [late, soon, ok, far];
  const r = run({ bookings });
  const cal = buildCalendar(r.tasks, bookings, (b) => b.primaryGuest, T, 7);
  assert.equal(cal.length, 7);
  assert.equal(cal[0].label, "Oggi");
  assert.equal(cal[0].due, 1);
  assert.equal(cal[0].late, 1);
  assert.equal(cal[2].iso, "2026-10-08");
  assert.equal(cal[2].due, 1);
  assert.equal(cal[2].arrivals, 2);
  assert.equal(cal[2].arrivalsMissing, 1);
  assert.equal(cal[5].arrivals, 1);
  assert.equal(cal[5].due, 0);
});

test("cronologia: invii alla Questura e solleciti, dal più recente", () => {
  const t = (iso: string) => Date.parse(iso);
  const tl = buildTimeline(
    [
      { id: "1", created_at: "2026-10-05T23:00:00Z", count: 3, stato: "sent", structure_id: "s1" },
      { id: "2", created_at: "2026-10-04T23:00:00Z", count: 1, stato: "error", structure_id: "s1" },
      { id: "3", created_at: "invalid", count: 1, stato: "sent", structure_id: "s1" },
    ],
    [{ ts: t("2026-10-06T08:00:00Z"), kind: "checkin", via: "WhatsApp", bookingId: "b1" }, { ts: t("2026-10-05T12:00:00Z"), kind: "pay-saldo", via: "Email", bookingId: "b2" }],
    3,
  );
  assert.equal(tl.length, 3);
  assert.deepEqual(tl.map((e) => e.id.split(":")[0]), ["rem", "sub", "rem"]);
  assert.equal(tl[0].title, "Sollecito check-in");
  assert.equal(tl[1].title, "3 schedine inviate alla Questura");
  assert.equal(tl[1].ok, true);
});
