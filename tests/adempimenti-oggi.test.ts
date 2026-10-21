import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { AdempimentiInput } from "../src/lib/adempimenti-oggi.ts";

register("./helpers/alias-loader.mjs", import.meta.url);
const { computeAdempimentiOggi } = await import("../src/lib/adempimenti-oggi.ts");

// UNA sola regola per il numero «Adempimenti oggi»: pagina, Dashboard e badge laterale lo leggono tutti da qui.
const T = "2026-10-19";
let n = 0;
type B = AdempimentiInput["bookings"][number];
// Check-in completo e valido (tutti i dati richiesti dalla schedina).
const fullGuest = { firstName: "Mario", lastName: "Rossi", sex: "M" as const, birthDate: "1980-01-01", birthPlace: "Roma", citizenship: "IT", docType: "CI", docNumber: "AB123", docPlace: "Roma" };
const bk = (o: Partial<B> & { checkIn: string }): B => ({
  id: `b${++n}`, guestId: `g${n}`, structureId: "s1", unitId: null, roomTypeId: "rt", checkOut: "2026-10-22", adults: 1, children: 0, status: "confirmed", channel: "direct", ...o,
} as unknown as B);
const done = (o: Partial<B> & { checkIn: string }): B => bk({ webCheckin: true, primaryGuest: fullGuest, ...o } as Partial<B> & { checkIn: string });
const run = (p: Partial<AdempimentiInput>) => computeAdempimentiOggi({ bookings: [], getGuest: () => undefined, today: T, sched: [], istat: [], docs: [], pays: [], passive: [], ...p });
const sr = (b: B, stato: string, arrival = T) => ({ id: `sc${++n}`, arrival, stato, booking_id: b.id, structure_id: "s1" });

test("nessun dato: tutto in ordine", () => {
  const r = run({});
  assert.equal(r.counts.total, 0);
  assert.equal(r.counts.allClear, true);
});

test("arrivo oggi senza check-in: 1 voce (da completare); con check-in completo e valido non conta", () => {
  const senza = bk({ checkIn: T });
  assert.equal(run({ bookings: [senza] }).counts.total, 1);
  const fatto = done({ checkIn: T });
  const r = run({ bookings: [fatto] });
  assert.equal(r.counts.total, 0);
  assert.equal(r.groupsCheckedIn.length, 1);
});

test("arrivo di domani o di ieri senza check-in: non conta (la regola guarda gli arrivi di OGGI)", () => {
  assert.equal(run({ bookings: [bk({ checkIn: "2026-10-20" }), bk({ checkIn: "2026-10-18" })] }).counts.total, 0);
});

test("prenotazione annullata, no-show o blocco camera: non conta mai", () => {
  const list = [bk({ checkIn: T, status: "cancelled" }), bk({ checkIn: T, status: "no_show" }), bk({ checkIn: T, channel: "blocked" })];
  assert.equal(run({ bookings: list }).counts.total, 0);
});

test("check-in parziale (1 ospite su 2): resta da completare; gruppo di camere = UNA voce", () => {
  const parziale = bk({ checkIn: T, adults: 2, webCheckin: true, primaryGuest: fullGuest } as Partial<B> & { checkIn: string });
  assert.equal(run({ bookings: [parziale] }).groupsNoCheckin.length, 1);
  const g1 = bk({ checkIn: T, groupId: "G" }), g2 = bk({ checkIn: T, groupId: "G" }), g3 = bk({ checkIn: T, groupId: "G" });
  const r = run({ bookings: [g1, g2, g3] });
  assert.equal(r.groupsNoCheckin.length, 1);
  assert.equal(r.groupsNoCheckin[0].rooms, 3);
  assert.equal(r.counts.total, 1);
});

test("check-in completo ma dati non validi (manca il luogo di rilascio): da correggere, conta 1", () => {
  const incompleto = bk({ checkIn: T, webCheckin: true, primaryGuest: { ...fullGuest, docPlace: "" } } as Partial<B> & { checkIn: string });
  const r = run({ bookings: [incompleto] });
  assert.equal(r.groupsToFix.length, 1);
  assert.equal(r.counts.total, 1);
});

test("schedina pronta da inviare: 1 voce per prenotazione (anche con più schedine) ed è urgente", () => {
  const b = done({ checkIn: T, adults: 1 });
  const r = run({ bookings: [b], sched: [sr(b, "pronta"), sr(b, "pronta")] });
  assert.equal(r.schedToSendG.length, 1);
  assert.equal(r.schedToSendG[0].count, 2);
  assert.equal(r.counts.total, 1);
  assert.equal(r.counts.urgent, 1);
});

test("schedina pronta ma check-in incompleto, oppure con una schedina da validare, oppure arrivo futuro: non si può inviare", () => {
  const inc = bk({ checkIn: T, adults: 2, webCheckin: true, primaryGuest: fullGuest } as Partial<B> & { checkIn: string });
  assert.equal(run({ bookings: [inc], sched: [sr(inc, "pronta")] }).schedToSendG.length, 0);
  const ok = done({ checkIn: T });
  assert.equal(run({ bookings: [ok], sched: [sr(ok, "pronta"), sr(ok, "da_validare")] }).schedToSendG.length, 0);
  const fut = done({ checkIn: "2026-10-25" });
  assert.equal(run({ bookings: [fut], sched: [sr(fut, "pronta", "2026-10-25")] }).schedToSendG.length, 0);
});

test("arretrati: la schedina pronta di un arrivo passato conta ancora; quella già inviata no", () => {
  const vecchia = done({ checkIn: "2026-10-16", checkOut: "2026-10-20" });
  assert.equal(run({ bookings: [vecchia], sched: [sr(vecchia, "pronta", "2026-10-16")] }).counts.total, 1);
  assert.equal(run({ bookings: [vecchia], sched: [sr(vecchia, "inviata", "2026-10-16")] }).counts.total, 0);
});

test("ISTAT da inviare: conta se l'arrivo è oggi o passato e la prenotazione è viva; gli inviati e i futuri no", () => {
  const b = done({ checkIn: T });
  const row = (stato: string, arrival: string, booking = b) => ({ id: `i${++n}`, arrival, stato, booking_id: booking.id, structure_id: "s1" });
  assert.equal(run({ bookings: [b], istat: [row("pending", T)] }).counts.total, 1);
  assert.equal(run({ bookings: [b], istat: [row("pending", "2026-10-15")] }).counts.total, 1); // arretrato
  assert.equal(run({ bookings: [b], istat: [row("sent", T)] }).counts.total, 0);
  assert.equal(run({ bookings: [b], istat: [row("pending", "2026-10-25")] }).counts.total, 0);
  const annullata = done({ checkIn: T, status: "cancelled" });
  assert.equal(run({ bookings: [annullata], istat: [row("pending", T, annullata)] }).counts.total, 0);
});

test("partenza oggi con tassa di soggiorno e saldo aperto: NON sono voci di questa regola (si gestiscono in Pagamenti / Tassa)", () => {
  const parte = done({ checkIn: "2026-10-16", checkOut: T, total: 187, paid: 0 } as Partial<B> & { checkIn: string });
  const r = run({ bookings: [parte] });
  assert.equal(r.counts.total, 0);
});

test("saldo: i documenti con residuo da incassare contano (tenendo conto degli incassi parziali); i saldati no", () => {
  const doc = (id: string, cents: number, stato = "emessa") => ({ id, structure_id: "s1", number_label: id, stato, total_cents: cents, counterpart: { name: "X" } });
  const r = run({ docs: [doc("d1", 10000), doc("d2", 5000), doc("d3", 2000)], pays: [{ document_id: "d2", amount_cents: 5000 }, { document_id: "d3", amount_cents: 500 }] });
  assert.deepEqual(r.docsUnpaid.map((d) => d.id), ["d1", "d3"]);
  assert.equal(r.counts.total, 2);
});

test("fattura scartata dallo SdI e fornitore scaduto: urgenti; fornitore non ancora scaduto o pagato: no", () => {
  const rej = { id: "r1", structure_id: "s1", number_label: "1", stato: "scartata", total_cents: 100, counterpart: null };
  const pv = (id: string, due: string, paid = false) => ({ id, structure_id: "s1", supplier_name: id, due_date: due, total_cents: 100, paid });
  const r = run({ docs: [rej], passive: [pv("a", "2026-10-10"), pv("b", "2026-10-30"), pv("c", "2026-10-01", true)] });
  assert.equal(r.docsRejected.length, 1);
  assert.deepEqual(r.passiveOverdue.map((p) => p.id), ["a"]);
  assert.equal(r.counts.total, 2);
  assert.equal(r.counts.urgent, 2);
});

test("totale = somma delle voci; urgenti + da fare = totale", () => {
  const a = bk({ checkIn: T });                     // check-in da completare (da fare)
  const b = done({ checkIn: T });                   // schedina pronta (urgente)
  const r = run({ bookings: [a, b], sched: [sr(b, "pronta")] });
  assert.equal(r.counts.total, 2);
  assert.equal(r.counts.urgent + r.counts.toDo, r.counts.total);
  assert.equal(r.counts.checkinTodo, 1);
});
