import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPhone, checkEmail, contactReport } from "../src/lib/contacts-check.ts";

test("numeri validi scritti in modi diversi diventano formato internazionale", () => {
  assert.equal(checkPhone("3473824353", { country: "IT" }).pretty, "+39 347 382 4353");
  assert.equal(checkPhone("+39 349 438 8460").e164, "+393494388460");
  assert.equal(checkPhone("0039 347 9352622").e164, "+393479352622");
  assert.equal(checkPhone("347-382-4353").status, "ok");
  assert.equal(checkPhone("+39 (347) 382.4353").e164, "+393473824353");
});

test("senza prefisso si dà per scontato il Paese dell'ospite, altrimenti l'Italia", () => {
  const p = checkPhone("0651964616", { country: "NL" });
  assert.equal(p.e164, "+31651964616"); assert.equal(p.assumed, true);
  assert.equal(checkPhone("3473824353").e164, "+393473824353");
});

test("prefisso scritto senza +", () => {
  assert.equal(checkPhone("442036847925").e164, "+442036847925");
});

test("cifra mancante o in più: non valido con il motivo", () => {
  const short = checkPhone("+39 347 93526");
  assert.equal(short.status, "invalid"); assert.match(short.reason!, /corto|non valido/);
  const long = checkPhone("+39 347 3824353 0123");
  assert.equal(long.status, "invalid");
});

test("prefisso sbagliato per il Paese dell'ospite: propone la correzione", () => {
  const p = checkPhone("+1 0651964616", { country: "NL" });
  assert.equal(p.status, "invalid"); assert.equal(p.fix?.value, "+31 6 51964616");
});

test("formato delle OTA con trattini", () => {
  assert.equal(checkPhone("44-3-308225121-").status, "ok");
  assert.equal(checkPhone("1-204-9810938-").e164, "+12049810938");
  assert.equal(checkPhone("0-0-0783121974-").status, "landline"); // 0783 = Oristano, fisso italiano
});

test("fisso: segnalato, non invalido", () => {
  assert.equal(checkPhone("+39 0931 123456").status, "landline");
  assert.equal(checkPhone("").status, "missing");
  assert.equal(checkPhone("abc").status, "invalid");
});

test("email: ok, ponte OTA, errori di battitura, non valide", () => {
  assert.equal(checkEmail("Anna.Rossi@Gmail.com ").clean, "anna.rossi@gmail.com");
  assert.equal(checkEmail("drizzo.106864@guest.booking.com").status, "relay");
  assert.equal(checkEmail("3meee8xg8d@m.expediapartnercentral.com").status, "relay");
  assert.equal(checkEmail("x@m.airbnb.com").status, "relay");
  const t = checkEmail("mario@gmial.com"); assert.equal(t.status, "typo"); assert.equal(t.suggestion, "mario@gmail.com");
  assert.equal(checkEmail("mario@gmail.con").suggestion, "mario@gmail.com");
  assert.equal(checkEmail("mario@libero.co").suggestion, "mario@libero.it");
  assert.equal(checkEmail("mario@gmx.ch").status, "ok"); // dominio reale diverso da gmx.de: nessuna "correzione"
  assert.equal(checkEmail("mario@aziendina.it").status, "ok");
  assert.equal(checkEmail("mario.gmail.com").reason, "manca la @");
  assert.equal(checkEmail("mario@gmail").status, "invalid");
  assert.equal(checkEmail("mario@@gmail.com").status, "invalid");
  assert.equal(checkEmail("").status, "missing");
  assert.equal(checkEmail("mailto:<a.b@yahoo.it>.").clean, "a.b@yahoo.it");
});

test("riepilogo: nessun contatto, numero errato con email buona, email con refuso", () => {
  const none = contactReport({});
  assert.equal(none.reachable, false); assert.equal(none.issues[0].key, "no_contact"); assert.equal(none.issues[0].level, "err");
  const badPhone = contactReport({ phone: "+39 347 93526", email: "a@b-azienda.it" });
  assert.equal(badPhone.reachable, true); assert.equal(badPhone.issues[0].key, "phone_invalid");
  const typo = contactReport({ phone: "3473824353", email: "mario@gmial.com" });
  assert.equal(typo.whatsapp, true); assert.equal(typo.issues[0].key, "email_typo"); assert.equal(typo.issues[0].fix?.value, "mario@gmail.com");
  const ok = contactReport({ phone: "+39 349 438 8460", email: "drizzo.106864@guest.booking.com" });
  assert.equal(ok.issues.length, 0);
  const onlyBad = contactReport({ phone: "0-0-0783121974-", email: "" });
  assert.equal(onlyBad.issues[0].key, "no_contact"); assert.match(onlyBad.issues[0].detail!, /telefono/);
});

test("formati reali delle OTA trovati negli archivi", () => {
  const e = (s: string) => checkPhone(s).e164;
  assert.equal(e("39-335-6314360-"), "+393356314360");
  assert.equal(e("39--3934335777-"), "+393934335777");
  assert.equal(e("0-0-18574458226-"), "+18574458226");
  assert.equal(e("36--202217136-"), "+36202217136");
  assert.equal(e("34-1-965993399-"), "+34965993399");
  assert.equal(e("0033681404586"), "+33681404586");
  assert.equal(checkPhone("0-0-0660444723-").status, "landline"); // fisso romano
  assert.equal(checkPhone("280256").status, "invalid");
  const noCountry = checkPhone("691735487");
  assert.equal(noCountry.status, "invalid"); assert.match(noCountry.reason!, /senza prefisso/);
  assert.equal(checkPhone("691735487", { country: "ES" }).e164, "+34691735487");
});

import { upcomingContactIssues } from "../src/lib/contacts-upcoming.ts";
import { contactReportCached } from "../src/lib/contacts-check.ts";
import { waDigits } from "../src/lib/contacts-check.ts";

test("WhatsApp: cifre complete di prefisso anche per numeri scritti senza", () => {
  assert.equal(waDigits("3473824353", "IT"), "393473824353");
  assert.equal(waDigits("+39 349 438 8460"), "393494388460");
  assert.equal(waDigits("39-335-6314360-"), "393356314360");
  assert.equal(waDigits("12"), "12");
});

test("ospiti in arrivo con contatto da correggere: solo prenotazioni vive, la più vicina, ordinati per urgenza", () => {
  const guests = [
    { id: "g1", fullName: "Senza Contatti" },
    { id: "g2", fullName: "Mail Sbagliata", phone: "3473824353", email: "x@gmial.com" },
    { id: "g3", fullName: "Tutto Ok", phone: "+39 349 438 8460", email: "a@azienda.it" },
    { id: "g4", fullName: "Lontano", email: "no-at" },
  ];
  const b = (id: string, guestId: string, checkIn: string, over: Record<string, string> = {}) => ({ id, guestId, checkIn, checkOut: "2026-12-31", status: "confirmed", channel: "booking", structureId: "s", ...over });
  const out = upcomingContactIssues([
    b("1", "g1", "2026-10-09"), b("2", "g2", "2026-10-20"), b("3", "g3", "2026-10-08"), b("4", "g4", "2027-03-01"),
    b("5", "g1", "2026-09-01"), b("6", "g2", "2026-10-07", { status: "cancelled" }),
  ], guests, "2026-10-06", contactReportCached);
  assert.deepEqual(out.map((x) => x.guest.id), ["g1", "g2"]); // g3 senza problemi, g4 oltre i 60 giorni
  assert.equal(out[0].urgent, true); assert.equal(out[0].days, 3);
  assert.equal(out[1].urgent, false);
});
