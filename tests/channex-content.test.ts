import test from "node:test";
import assert from "node:assert/strict";
import { buildHotelPolicyBody, matchFacilities, buildPropertyUpdate, buildDescription, contentChecklist, countryCode } from "../src/lib/channex-content.ts";

const base = { name: "Spigolehouse", city: "Siracusa", address: "Via Roma 1", phone: "+393293071740", lat: 37.0755, lng: 15.2866, services: ["Wi-Fi", "Aria condizionata", "Colazione", "Balcone"], checkInFrom: "15:00", checkOutBy: "10:30", cancelPolicy: "flessibile" as const, description: "B&B nel centro di Siracusa con camere luminose, bagno privato e colazione inclusa." };

test("politica della struttura: orari, wifi, parcheggio, animali, fumo", () => {
  const p = buildHotelPolicyBody("PROP", { ...base, pets: true, smoking: false, services: ["Wi-Fi", "Parcheggio"], checkInFrom: "14:00", checkOutBy: "11:00", maxGuests: 4 }).hotel_policy;
  assert.equal(p.property_id, "PROP");
  assert.equal(p.checkin_from_time, "14:00"); assert.equal(p.checkin_to_time, "20:00"); assert.equal(p.checkout_from_time, "07:00"); assert.equal(p.checkout_to_time, "11:00");
  assert.equal(p.checkin_time, "14:00"); assert.equal(p.checkout_time, "11:00");
  assert.equal(p.internet_access_type, "wifi"); assert.equal(p.internet_access_cost, null);
  assert.equal(p.parking_type, "on_site"); assert.equal(p.pets_policy, "allowed"); assert.equal(p.smoking_policy, "no_smoking");
  assert.equal(p.max_count_of_guests, 4);
});

test("politica: valori di ripiego sensati e orari non validi scartati; senza property_id nell'aggiornamento", () => {
  const p = buildHotelPolicyBody(null, { name: "X", checkInFrom: "boh", checkOutBy: "25:99", services: [] }).hotel_policy;
  assert.equal("property_id" in p, false);
  assert.equal(p.checkin_from_time, "15:00"); assert.equal(p.checkin_to_time, "20:00"); assert.equal(p.checkout_from_time, "07:00"); assert.equal(p.checkout_to_time, "10:30");
  assert.equal(p.internet_access_type, "none"); assert.equal(p.parking_type, "none");
  assert.equal(p.pets_policy, "not_allowed"); assert.equal(p.max_count_of_guests, 6);
  assert.equal(buildHotelPolicyBody("P", { name: "X", minAge: 18 }).hotel_policy.is_adults_only, true);
});

test("orari: check-in tardivo, check-out presto e check-in fino a mezzanotte", () => {
  const a = buildHotelPolicyBody(null, { name: "X", checkInFrom: "21:00", checkInTo: "23:00", checkOutBy: "06:30" }).hotel_policy;
  assert.equal(a.checkin_to_time, "23:00"); assert.equal(a.checkout_from_time, "00:00"); assert.equal(a.checkout_to_time, "06:30");
  assert.equal(buildHotelPolicyBody(null, { name: "X", checkInFrom: "21:00" }).hotel_policy.checkin_to_time, "23:59");
});

test("servizi → facility di Channex per parole chiave, senza doppioni e con l'elenco di quelli non trovati", () => {
  const opts = [{ id: "1", title: "Free WiFi" }, { id: "2", title: "Air conditioning" }, { id: "3", title: "Breakfast available" }, { id: "4", title: "Balcony" }, { id: "5", title: "Free parking" }];
  const r = matchFacilities(["Wi-Fi", "Aria condizionata", "Colazione", "Balcone", "Parcheggio", "Cassaforte", "Qualcosa di strano"], opts);
  assert.deepEqual(r.ids, ["1", "2", "3", "4", "5"]);
  assert.deepEqual(r.unmatched, ["Cassaforte", "Qualcosa di strano"]);
  assert.deepEqual(matchFacilities(["Wi-Fi", "Wi-Fi"], opts).ids, ["1"]);
  assert.deepEqual(matchFacilities(undefined, opts), { ids: [], matched: [], unmatched: [] });
});

test("aggiornamento della struttura: solo i campi presenti, coordinate a 7 decimali, descrizione, policy e servizi", () => {
  const u = buildPropertyUpdate(base, { hotelPolicyId: "HP", facilityIds: ["1", "2"] }).property;
  assert.equal(u.address, "Via Roma 1"); assert.equal(u.city, "Siracusa"); assert.equal(u.country, "IT");
  assert.equal(u.latitude, "37.0755000"); assert.equal(u.longitude, "15.2866000");
  assert.equal(u.hotel_policy_id, "HP"); assert.deepEqual(u.facilities, ["1", "2"]);
  assert.equal("default_cancellation_policy_id" in u, false);
  assert.equal((u.content as { description: string }).description, base.description);
  const empty = buildPropertyUpdate({ name: "Y" }, {}).property;
  for (const k of ["address", "phone", "latitude", "email", "facilities", "hotel_policy_id"]) assert.equal(k in empty, false, k);
});

test("descrizione di ripiego e codice paese", () => {
  assert.match(buildDescription({ name: "Casa Mia", city: "Noto" }), /Casa Mia a Noto/);
  assert.equal(countryCode("Italia"), "IT"); assert.equal(countryCode("fr"), "FR"); assert.equal(countryCode(undefined), "IT"); assert.equal(countryCode("Spagna"), "ES");
});

test("elenco di controllo: segnala cosa manca", () => {
  assert.equal(contentChecklist(base).every((c) => c.ok), true);
  const miss = contentChecklist({ name: "X" }).filter((c) => !c.ok).map((c) => c.key);
  assert.deepEqual(miss, ["description", "address", "location", "services", "times", "cancel"]);
  assert.equal(contentChecklist({ ...base, lat: 0, lng: 0 }).find((c) => c.key === "location")?.ok, false);
});
