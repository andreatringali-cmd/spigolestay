import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const X = await import("../src/lib/booking-extras.ts");
const { bookingExtrasTotal, bookingGrandTotal, bookingPaidTotal, lordoOf } = await import("../src/lib/booking.ts");
const { patchAccept } = await import("../src/lib/upselling.ts");

const stay = { checkIn: "2026-11-10", checkOut: "2026-11-13", adults: 2 }; // 3 notti, 2 adulti
const byId = (id: string) => X.SUGGESTED_EXTRAS.find((e) => e.id === id)!;

test("i tre extra suggeriti ci sono: animali a pagamento, culla gratuita, letto aggiuntivo a notte", () => {
  assert.deepEqual(X.SUGGESTED_EXTRAS.map((e) => e.id), ["animale-domestico", "culla-da-campo", "letto-aggiuntivo"]);
  assert.ok(byId("animale-domestico").price > 0);
  assert.equal(byId("animale-domestico").per, "stay");
  assert.equal(byId("culla-da-campo").price, 0);
  assert.equal(byId("culla-da-campo").free, true);
  assert.equal(byId("letto-aggiuntivo").per, "night");
});

test("catalogo della struttura: i suggeriti mancanti si aggiungono senza duplicati", () => {
  assert.equal(X.missingSuggested(undefined).length, 3);
  const cat = [{ id: "culla-da-campo", name: "Culla", price: 0, per: "stay" as const }, { id: "bici", name: "Bici", price: 10, per: "day" as const }];
  assert.deepEqual(X.missingSuggested(cat).map((e) => e.id), ["animale-domestico", "letto-aggiuntivo"]);
  const all = X.catalogWithSuggested(cat);
  assert.equal(all.length, 4);
  assert.equal(new Set(all.map((e) => e.id)).size, 4);
  assert.equal(X.selectableExtras([{ id: "x", name: "Spento", price: 5, per: "stay", active: false }]).some((e) => e.id === "x"), false);
});

test("una tantum: prezzo x quantita', e la voce porta extraId e qty", () => {
  const pet = byId("animale-domestico");
  const e1 = X.setExtraQty([], pet, 1, stay);
  assert.equal(e1.length, 1);
  assert.equal(e1[0].price, pet.price);
  assert.equal(e1[0].extraId, "animale-domestico");
  assert.equal(e1[0].qty, 1);
  assert.equal(e1[0].name, pet.name);
  const e2 = X.setExtraQty(e1, pet, 2, stay);
  assert.equal(e2.length, 1); // stessa voce, nessun doppione
  assert.equal(e2[0].price, pet.price * 2);
  assert.equal(e2[0].qty, 2);
  assert.match(e2[0].name, /×2$/);
});

test("a notte: prezzo x notti x quantita'", () => {
  const bed = byId("letto-aggiuntivo"); // 20 / notte, 3 notti
  assert.equal(X.extraUnitAmount(bed, stay), 60);
  const e = X.setExtraQty([], bed, 2, stay);
  assert.equal(e[0].price, 120);
  assert.equal(X.entryQty(e, bed), 2);
});

test("gratis: la culla entra con importo 0 e non cambia il totale", () => {
  const cot = byId("culla-da-campo");
  const e = X.setExtraQty([], cot, 1, stay);
  assert.equal(e.length, 1);
  assert.equal(e[0].price, 0);
  assert.equal(X.entryQty(e, cot), 1);
  const b = { checkIn: stay.checkIn, checkOut: stay.checkOut, total: 300, extras: e };
  assert.equal(bookingExtrasTotal(b), 0);
  assert.equal(bookingPaidTotal(b), 300);
});

test("quantita' 0 toglie la voce; il tetto maxQty vale", () => {
  const pet = byId("animale-domestico"); // maxQty 2
  let e = X.setExtraQty([], pet, 5, stay);
  assert.equal(e[0].qty, 2);
  e = X.setExtraQty(e, pet, 0, stay);
  assert.deepEqual(e, []);
  assert.deepEqual(X.setExtraQty([], pet, 0, stay), []);
});

test("il totale ospite li somma una volta sola, in tutte le viste", () => {
  const pet = byId("animale-domestico");
  const bed = byId("letto-aggiuntivo");
  let e = X.setExtraQty([], pet, 1, stay); // 10
  e = X.setExtraQty(e, bed, 1, stay); // 60
  const b = { checkIn: stay.checkIn, checkOut: stay.checkOut, adults: 2, total: 300, cleaningFee: 30, extras: e, channel: "direct" as const };
  assert.equal(bookingExtrasTotal(b), 70);
  assert.equal(X.entriesTotal(e), 70);
  assert.equal(bookingPaidTotal(b), 400);
  assert.equal(lordoOf(b), 400);
  assert.equal(bookingGrandTotal(b, undefined), 400); // senza tassa di soggiorno configurata
});

test("nessun doppio conteggio con l'Upselling: stessa voce per extraId, anche con offerta accettata", () => {
  const pet = byId("animale-domestico");
  const offer = { id: "o1", at: 1, via: "diretto" as const, items: [{ extraId: pet.id, name: pet.name, qty: 1, amount: 10 }], total: 10, status: "sent" as const };
  const booking = { checkIn: stay.checkIn, checkOut: stay.checkOut, adults: 2, total: 300, extras: [] as never[] };
  const patch = patchAccept(booking as never, offer, [pet]);
  const afterOffer = (patch.extras ?? []) as never[];
  assert.equal(afterOffer.length, 1);
  // il gestore alza la quantita' dalla scheda prenotazione: la voce dell'offerta viene aggiornata, non duplicata
  const bumped = X.setExtraQty(afterOffer, pet, 2, stay);
  assert.equal(bumped.length, 1);
  assert.equal(bumped[0].offerId, "o1");
  assert.equal(bumped[0].price, 20);
  // e accettare di nuovo la stessa offerta non aggiunge una seconda riga
  const again = patchAccept({ ...booking, extras: bumped } as never, offer, [pet]);
  assert.equal((again.extras ?? []).length, 1);
});

test("voci libere (fuori catalogo) restano distinte e si possono togliere", () => {
  const pet = byId("animale-domestico");
  let e = [{ name: "Transfer", price: 80 }] as never[];
  e = X.setExtraQty(e, pet, 1, stay);
  const free = X.freeEntries(e, X.selectableExtras(undefined));
  assert.equal(free.length, 1);
  assert.equal(free[0].entry.name, "Transfer");
  assert.equal(X.entriesTotal(e), 90);
});

test("voci vecchie senza extraId si riconoscono dal nome (anche con xN)", () => {
  const pet = byId("animale-domestico");
  const old = [{ name: `${pet.name} ×2`, price: 20 }] as never[];
  assert.equal(X.entryQty(old, pet), 2); // senza qty salvata si legge dal nome
  const upd = X.setExtraQty(old, pet, 2, stay);
  assert.equal(upd.length, 1);
  assert.equal(upd[0].extraId, "animale-domestico");
});

test("etichetta della modalita'", () => {
  assert.equal(X.pricingLabel(byId("culla-da-campo")), "gratis");
  assert.equal(X.pricingLabel(byId("animale-domestico")), "una tantum");
  assert.equal(X.pricingLabel(byId("letto-aggiuntivo")), "a notte");
  assert.equal(X.pricingLabel({ price: 0, per: "stay" }), "prezzo da impostare");
});
