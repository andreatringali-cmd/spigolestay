import { test } from "node:test";
import assert from "node:assert/strict";
import { guestKey, normName, normPhone, isNameKey, realEmail, groupDuplicates } from "../src/lib/guest-key.ts";

test("normName: maiuscole, accenti e spazi non contano", () => {
  assert.equal(normName("  José   Müller "), "jose muller");
  assert.equal(normName("Dajnowska Martyna"), normName("dajnowska  MARTYNA"));
});

test("normPhone: ignora prefisso internazionale e zero iniziale", () => {
  assert.equal(normPhone("+39 329 123 4567"), normPhone("0039 3291234567"));
  assert.equal(normPhone("12345"), ""); // troppo corto: non è un contatto affidabile
});

test("realEmail: le email di inoltro dei portali non identificano la persona", () => {
  assert.equal(realEmail("Mario@Gmail.com"), "mario@gmail.com");
  assert.equal(realEmail("abc123@guest.booking.com"), "");
  assert.equal(realEmail("x@m.airbnb.com"), "");
  assert.equal(realEmail("x@reply.expediapartnercentral.com"), "");
  assert.equal(realEmail("senza-chiocciola"), "");
});

test("chiave: email reale, poi nome+paese, poi telefono", () => {
  assert.equal(guestKey({ fullName: "A B", email: "X@Y.it" }), "e:x@y.it");
  assert.equal(guestKey({ fullName: "Franzo Sonia", country: "IT" }), "n:franzo sonia|it");
  assert.equal(isNameKey(guestKey({ fullName: "Franzo Sonia" })), true);
  assert.equal(guestKey({ fullName: "Franzo Sonia", email: "x@guest.booking.com", country: "IT" }), "n:franzo sonia|it"); // email di inoltro: si usa il nome
  assert.equal(guestKey({ fullName: "A B", phone: "+39 329 123 4567" }), "t:" + normPhone("+39 329 123 4567")); // nome troppo corto: telefono
});

test("nomi corti ma reali (papo, ulma) ora sono riconosciuti; generici e minuscoli mai", () => {
  assert.equal(guestKey({ fullName: "papo" }), "n:papo|");
  assert.equal(guestKey({ fullName: "Ulma" }), "n:ulma|");
  assert.equal(guestKey({ fullName: "Ospite" }), null);
  assert.equal(guestKey({ fullName: "Ospite (da ICS)" }), null);
  assert.equal(guestKey({ fullName: "Non disponibile" }), null);
  assert.equal(guestKey({ fullName: "Li" }), null);
  assert.equal(guestKey({ fullName: "" }), null);
});

const g = (id: string, fullName: string, extra: Record<string, string> = {}) => ({ id, fullName, ...extra });

test("doppioni: stesso nome senza dati = una sola scheda", () => {
  const out = groupDuplicates([g("1", "papo"), g("2", "Papo"), g("3", "papo"), g("4", "altra persona")]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].map((x) => x.id).sort(), ["1", "2", "3"]);
});

test("doppioni: email di Booking diverse per ogni prenotazione non separano la stessa persona", () => {
  const out = groupDuplicates([
    g("1", "Mastretta Paolo", { email: "aaa@guest.booking.com", phone: "+39 333 111 2222", country: "IT" }),
    g("2", "Mastretta Paolo", { email: "bbb@guest.booking.com", phone: "+39 333 999 8888" }),
  ]);
  assert.equal(out.length, 1);
});

test("doppioni: paese vuoto non separa, paese diverso sì", () => {
  assert.equal(groupDuplicates([g("1", "Gavin Coates", { country: "GB" }), g("2", "Gavin Coates")]).length, 1);
  assert.equal(groupDuplicates([g("1", "Marco Rossi", { country: "IT" }), g("2", "Marco Rossi", { country: "DE" })]).length, 0);
});

test("doppioni: due email reali diverse = persone diverse (anche con lo stesso nome)", () => {
  assert.equal(groupDuplicates([g("1", "Marco Rossi", { email: "marco@a.it" }), g("2", "Marco Rossi", { email: "marco@b.it" })]).length, 0);
});

test("doppioni: stessa email reale o stesso telefono = stessa persona anche con nome scritto diverso", () => {
  assert.equal(groupDuplicates([g("1", "Luigi R", { email: "l@x.it" }), g("2", "Rotondo Luigi", { email: "L@x.it" })]).length, 1);
  assert.equal(groupDuplicates([g("1", "Anna", { phone: "333 1234567" }), g("2", "Anna Bianchi", { phone: "+39 3331234567" })]).length, 1);
});

test("doppioni: i nomi generici non vengono mai uniti", () => {
  assert.equal(groupDuplicates([g("1", "Ospite"), g("2", "Ospite"), g("3", "Non disponibile"), g("4", "Non disponibile")]).length, 0);
});

test("ricerca per parole: 'luigi rotondo' trova 'Rotondo Luigi' (l'ordine non conta)", () => {
  const hay = normName("Rotondo Luigi luigi@x.it IT");
  const match = (q: string) => normName(q).split(" ").filter(Boolean).every((tk) => hay.includes(tk));
  assert.equal(match("luigi rotondo"), true);
  assert.equal(match("Rotondo   LUIGI"), true);
  assert.equal(match("rot lui"), true);      // anche pezzi di parola
  assert.equal(match("luigi bianchi"), false);
  assert.equal(match("  "), true);           // nessun testo = nessun filtro
});
