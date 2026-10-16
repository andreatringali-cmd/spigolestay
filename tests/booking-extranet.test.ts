import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// booking.ts legge localStorage (percentuali di default): si simula come negli altri test.
register("./helpers/alias-loader.mjs", import.meta.url);
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(), key: () => null, length: 0,
} as Storage;

const X = await import("../src/lib/booking-extranet.ts");
const { commissionOf, lordoOf } = await import("../src/lib/booking.ts");

const HEADER = "Nome dell'ospite  Arrivo  Partenza  Alloggi  Data di prenotazione  Stato  Prezzo  Commissione e costi  Numero prenotazione";
const KARLA = "Karla Jimenez Genius 2 adulti 14 ott 2026 15 ott 2026 Camera Matrimoniale Deluxe con Balcone 9 ott 2026 OK Pagamento tramite Booking.com € 72,96 Bonifico € 17,88 5136521644";
const HANNA = "Hanna Lowthion Genius 3 adulti Hai 1 messaggio di un ospite a cui rispondere 16 ott 2026 18 ott 2026 1 x Camera Matrimoniale Deluxe con Balcone, 1 x Camera Tripla con Balcone 16 ago 2026 OK Pagamento tramite Booking.com € 346,60 Bonifico € 84,92 6514447005";
const SUSANNE = "Susanne Kleiner Genius 2 adulti 10 ott 2026 16 ott 2026 Camera Tripla con Balcone 26 ago 2026 Cancellata € 0 Bonifico € 0 6750215607";

test("parser: i tre esempi reali, su una riga ciascuno, con intestazione e totali che tornano", () => {
  const txt = [HEADER, KARLA, HANNA, SUSANNE, "Commissione e costi: € 102,80 Prezzo totale: € 419,56"].join("\n");
  const p = X.parseExtranetText(txt);
  assert.equal(p.rows.length, 3);
  assert.deepEqual(p.warnings, []);
  const [k, h, s] = p.rows;
  assert.deepEqual([k.code, k.guest, k.checkIn, k.checkOut, k.bookedOn, k.status, k.price, k.commission], ["5136521644", "Karla Jimenez", "2026-10-14", "2026-10-15", "2026-10-09", "ok", 72.96, 17.88]);
  assert.deepEqual([h.code, h.guest, h.checkIn, h.checkOut, h.bookedOn, h.price, h.commission], ["6514447005", "Hanna Lowthion", "2026-10-16", "2026-10-18", "2026-08-16", 346.6, 84.92]);
  assert.match(h.accommodation, /1 x Camera Matrimoniale Deluxe con Balcone, 1 x Camera Tripla con Balcone/);
  assert.deepEqual([s.code, s.guest, s.status, s.statusText, s.price, s.commission], ["6750215607", "Susanne Kleiner", "cancelled", "Cancellata", 0, 0]);
  assert.deepEqual(p.totals, { commission: 102.8, price: 419.56, pages: 1 });
});

test("parser: righe spezzate una colonna per riga, tab, spazi doppi e nbsp", () => {
  const spezzato = ["Karla Jimenez", "Genius", "2 adulti", "14 ott 2026", "15 ott 2026", "Camera Matrimoniale Deluxe con Balcone", "9 ott 2026", "OK", "Pagamento tramite Booking.com", "€ 72,96", "Bonifico", "€ 17,88", "5136521644", "", "Susanne Kleiner", "Genius", "2 adulti", "10 ott 2026", "16 ott 2026", "Camera Tripla con Balcone", "26 ago 2026", "Cancellata", "€ 0", "Bonifico", "€ 0", "6750215607"].join("\n");
  const p = X.parseExtranetText(spezzato);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].price, 72.96);
  assert.equal(p.rows[1].status, "cancelled");
  const tab = KARLA.split(" € ").join("\t€ ").replace("Genius", "\tGenius\t");
  const q = X.parseExtranetText(tab);
  assert.equal(q.rows.length, 1);
  assert.deepEqual([q.rows[0].guest, q.rows[0].price, q.rows[0].commission], ["Karla Jimenez", 72.96, 17.88]);
});

test("parser: importi con migliaia, mesi in tutte le forme, stato diverso da OK, numeri uguali ripetuti", () => {
  const a = "Mario Rossi 1 adulto 3 set 2026 10 sett 2026 Camera Tripla 1 lug 2026 No show Pagamento tramite Booking.com € 1.234,56 Bonifico € 302,47 1111111111";
  const p = X.parseExtranetText(`${a}\n${a}`);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].price, 1234.56);
  assert.equal(p.rows[0].commission, 302.47);
  assert.equal(p.rows[0].checkOut, "2026-09-10");
  assert.equal(p.rows[0].status, "other");
  assert.equal(p.rows[0].statusText, "No show");
  assert.ok(p.warnings.some((w) => /ripetut/.test(w)));
});

test("parser: segnala totale in fondo che non torna, righe senza date e testo vuoto", () => {
  const p = X.parseExtranetText([KARLA, "Commissione e costi: € 20,00 Prezzo totale: € 100,00"].join("\n"));
  assert.equal(p.rows.length, 1);
  assert.equal(p.warnings.filter((w) => /non coincide/.test(w)).length, 2);
  const q = X.parseExtranetText("Pippo Pluto OK € 10,00 € 1,00 9999999999");
  assert.equal(q.rows.length, 0);
  assert.ok(q.warnings.length >= 1);
  assert.deepEqual(X.parseExtranetText("   ").rows, []);
});

test("parser: più pagine incollate, i totali in fondo si sommano", () => {
  const p = X.parseExtranetText([KARLA, "Commissione e costi: € 17,88 Prezzo totale: € 72,96", HEADER, SUSANNE, HANNA, "Commissione e costi: € 84,92 Prezzo totale: € 346,60"].join("\n"));
  assert.equal(p.rows.length, 3);
  assert.deepEqual(p.totals, { commission: 102.8, price: 419.56, pages: 2 });
  assert.deepEqual(p.warnings, []);
});

// ---- confronto -------------------------------------------------------------------------------------------------------------------------

let n = 0;
function bk(over: Record<string, unknown> = {}) {
  n++;
  return { id: `b${n}`, structureId: "s1", roomTypeId: "t1", unitId: null, guestId: "g1", channel: "booking", status: "confirmed", checkIn: "2026-10-14", checkOut: "2026-10-15", adults: 2, children: 0, total: 72.96, paid: 0, code: "5136521644", extId: "channex:abc", ...over } as never;
}
const guests = [{ id: "g1", fullName: "Karla Jimenez" }, { id: "g2", fullName: "Hanna Lowthion" }, { id: "g3", fullName: "Altro Nome" }] as never;
const rowsOf = (...t: string[]) => X.parseExtranetText(t.join("\n")).rows;

test("confronto: ok quando totale, commissione e date coincidono (tolleranza 0,02)", () => {
  const c = X.compareWithBookings(rowsOf(KARLA), [bk({ total: 72.95, commissionAmount: 17.88 })], guests);
  assert.equal(c.matches[0].outcome, "ok");
  assert.deepEqual(c.matches[0].diffs, []);
});

test("confronto: differenze per campo (totale, commissione, incassato, date, ospite)", () => {
  const b = bk({ total: 72.5, paid: 72.5, commissionAmount: 12, checkOut: "2026-10-16", guestId: "g3" });
  const m = X.compareWithBookings(rowsOf(KARLA), [b], guests).matches[0];
  assert.equal(m.outcome, "differenze");
  assert.deepEqual(m.diffs.map((d) => d.field).sort(), ["checkOut", "commissione", "incassato", "ospite", "totale"]);
  assert.equal(m.diffs.find((d) => d.field === "totale")!.fixable, true);
  assert.equal(m.diffs.find((d) => d.field === "checkOut")!.fixable, false);
});

test("confronto: mancante in Xenora, cancellata su Booking e attiva in Xenora (solo segnalazione), cancellata ovunque", () => {
  const c = X.compareWithBookings(rowsOf(KARLA, SUSANNE), [bk({ code: "6750215607", total: 400, guestId: "g3" })], guests);
  assert.equal(c.matches[0].outcome, "mancante_in_xenora");
  assert.equal(c.matches[1].outcome, "differenze");
  assert.deepEqual(c.matches[1].diffs.filter((d) => d.field === "stato").map((d) => d.fixable), [false]);
  assert.deepEqual(X.proposeAlign(c.matches[1]), []); // mai cancellare da soli
  const c2 = X.compareWithBookings(rowsOf(SUSANNE), [bk({ code: "6750215607", status: "cancelled", total: 400, checkIn: "2026-10-10", checkOut: "2026-10-16" })], guests);
  assert.equal(c2.matches[0].outcome, "ok");
});

test("confronto: doppione quando lo stesso numero arriva da octorate e da channex", () => {
  const c = X.compareWithBookings(rowsOf(KARLA), [bk({ extId: "octorate:1", commissionAmount: 17.88 }), bk({ extId: "channex:x", commissionAmount: 17.88 })], guests);
  assert.equal(c.matches[0].outcome, "doppione");
  assert.deepEqual(X.proposeAlign(c.matches[0]), []);
  // due camere dello stesso gruppo channex NON sono un doppione
  const g = X.compareWithBookings(rowsOf(HANNA), [bk({ code: "6514447005", total: 200, guestId: "g2", checkIn: "2026-10-16", checkOut: "2026-10-18" }), bk({ code: "6514447005", total: 146.6, guestId: "g2", checkIn: "2026-10-16", checkOut: "2026-10-18" })], guests);
  assert.notEqual(g.matches[0].outcome, "doppione");
});

test("confronto: solo_in_xenora (check-out nell'intervallo, assente dall'elenco) e altra_struttura", () => {
  const dentro = bk({ code: "7000000001", checkIn: "2026-10-10", checkOut: "2026-10-15", guestId: "g3" });
  const fuori = bk({ code: "7000000002", checkIn: "2026-12-10", checkOut: "2026-12-14" });
  const altro = bk({ code: "7000000003", structureId: "s2", checkIn: "2026-10-10", checkOut: "2026-10-14" });
  const diretta = bk({ code: "7000000004", channel: "direct", checkIn: "2026-10-10", checkOut: "2026-10-14" });
  const c = X.compareWithBookings(rowsOf(KARLA, SUSANNE), [bk({ commissionAmount: 17.88 }), bk({ code: "6750215607", status: "cancelled" }), dentro, fuori, altro, diretta], guests);
  assert.deepEqual(c.onlyInXenora.map((o) => o.code), ["7000000001"]);
  const d = X.compareWithBookings(rowsOf(KARLA, SUSANNE, HANNA), [bk({ commissionAmount: 17.88 }), bk({ code: "6750215607", status: "cancelled" }), bk({ code: "6514447005", structureId: "s2", total: 346.6 })], guests);
  assert.equal(d.dominantStructureId, "s1");
  assert.equal(d.matches[2].outcome, "altra_struttura");
  assert.equal(d.matches[0].outcome, "ok");
});

// ---- allineamento ----------------------------------------------------------------------------------------------------------------------

test("proposeAlign: una camera, totale/commissione/incassato vicini al prezzo", () => {
  const b = bk({ total: 72.5, paid: 72.5, commissionAmount: 12 });
  const [m] = X.compareWithBookings(rowsOf(KARLA), [b], guests).matches;
  const p = X.proposeAlign(m);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].patch, { total: 72.96, commissionAmount: 17.88, paid: 72.96 });
  assert.equal(p[0].patch.status, undefined);
  // dopo l'allineamento è tutto uguale
  const after = { ...(b as object), ...p[0].patch } as never;
  assert.equal(X.compareWithBookings(rowsOf(KARLA), [after], guests).matches[0].outcome, "ok");
});

test("proposeAlign: incassato a zero o molto diverso non si tocca; totale troppo diverso non si allinea", () => {
  const zero = bk({ total: 72.5, paid: 0, commissionAmount: 12 });
  const [mz] = X.compareWithBookings(rowsOf(KARLA), [zero], guests).matches;
  assert.deepEqual(X.proposeAlign(mz)[0].patch, { total: 72.96, commissionAmount: 17.88 });
  const lontano = bk({ total: 72.5, paid: 30, commissionAmount: 12 });
  assert.equal("paid" in X.proposeAlign(X.compareWithBookings(rowsOf(KARLA), [lontano], guests).matches[0])[0].patch, false);
  const diverso = bk({ total: 100, paid: 0, commissionAmount: 12 });
  const [md] = X.compareWithBookings(rowsOf(KARLA), [diverso], guests).matches;
  assert.equal(md.needsReview, true);
  assert.deepEqual(X.proposeAlign(md), []);
});

test("proposeAlign: il costo d'incasso già presente resta, la commissione esatta si scrive per differenza", () => {
  const b = bk({ total: 72.96, paid: 0, paymentFee: 1.5, commissionAmount: 10 });
  const [m] = X.compareWithBookings(rowsOf(KARLA), [b], guests).matches;
  assert.equal(m.xenora.commission, 11.5);
  const p = X.proposeAlign(m);
  assert.deepEqual(p[0].patch, { commissionAmount: 16.38 });
  assert.equal(commissionOf({ ...(b as object), ...p[0].patch } as never), 17.88);
});

test("proposeAlign: due camere, ripartizione proporzionale e somma esatta ai centesimi", () => {
  const code = "6514447005";
  const a = bk({ code, guestId: "g2", checkIn: "2026-10-16", checkOut: "2026-10-18", total: 200, paid: 200, commissionAmount: 40 });
  const b = bk({ code, guestId: "g2", checkIn: "2026-10-16", checkOut: "2026-10-18", total: 146, paid: 146, commissionAmount: 35 });
  const [m] = X.compareWithBookings(rowsOf(HANNA), [a, b], guests).matches;
  assert.equal(m.active.length, 2);
  assert.equal(m.xenora.total, 346);
  assert.equal(m.outcome, "differenze");
  const p = X.proposeAlign(m);
  assert.equal(p.length, 2);
  const tot = p.reduce((s, x) => s + Math.round((x.patch.total ?? 0) * 100), 0);
  const com = p.reduce((s, x) => s + Math.round((x.patch.commissionAmount ?? 0) * 100), 0);
  const paid = p.reduce((s, x) => s + Math.round((x.patch.paid ?? 0) * 100), 0);
  assert.equal(tot, 34660);
  assert.equal(com, 8492);
  assert.equal(paid, 34660);
  // la riga più grande è quella da 200: prende quota maggiore
  assert.ok((p[0].patch.total ?? 0) > (p[1].patch.total ?? 0));
  const after = [a, b].map((x, i) => ({ ...(x as object), ...p[i].patch })) as never[];
  assert.equal(X.compareWithBookings(rowsOf(HANNA), after, guests).matches[0].outcome, "ok");
  assert.equal(lordoOf(after[0]) + lordoOf(after[1]), 346.6);
});

test("splitCents: somma esatta, resto sulla riga più grande, pesi nulli = parti uguali", () => {
  const s = X.splitCents(100, [1, 1, 1]);
  assert.equal(s.reduce((a, x) => a + x, 0), 100);
  const t = X.splitCents(1001, [3, 7]);
  assert.equal(t.reduce((a, x) => a + x, 0), 1001);
  assert.ok(t[1] > t[0]);
  assert.deepEqual(X.splitCents(10, [0, 0]), [5, 5]);
});

test("statistica: percentuale reale per riga, media/min/max e 'tutte uguali'", () => {
  const rows = rowsOf(KARLA, HANNA, SUSANNE);
  const s = X.commissionStats(rows)!;
  assert.equal(s.items.length, 2); // la cancellata (prezzo 0) non conta
  assert.ok(Math.abs(s.items[0].pct - 24.5) < 0.1);
  assert.equal(s.allEqual, true);
  assert.ok(s.min <= s.avg && s.avg <= s.max);
  const diversa = X.commissionStats([{ ...rows[0] }, { ...rows[1], commission: 50 }])!;
  assert.equal(diversa.allEqual, false);
  assert.equal(X.commissionStats([rows[2]]), null);
  assert.equal(commissionOf(bk({ total: 100, commissionAmount: 24.5 })), 24.5);
});

test("summarizeAlign: variazioni di totale, commissioni e incassato", () => {
  const b = bk({ total: 72.5, paid: 72.5, commissionAmount: 12 });
  const [m] = X.compareWithBookings(rowsOf(KARLA), [b], guests).matches;
  const s = X.summarizeAlign(X.proposeAlign(m), [b]);
  assert.deepEqual(s, { bookings: 1, dTotal: 0.46, dCommission: 5.88, dPaid: 0.46 });
});
