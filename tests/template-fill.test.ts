import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const store: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } };
const T = await import("../src/lib/template-fill.ts");

const guest: any = { id: "g1", fullName: "Anna Rossi", firstName: "Anna", language: "it" };
const booking: any = { id: "b1", structureId: "s1", unitId: "u1", roomTypeId: "rt1", guestId: "g1", channel: "booking", status: "confirmed", checkIn: "2026-10-19", checkOut: "2026-10-23", adults: 2, children: 0, total: 300, paid: 0 };
const structure: any = { id: "s1", name: "Casa Bella", checkInFrom: "15:00" };
const deps = { bookings: [booking], getUnit: () => ({ id: "u1", name: "Camera 2", code: "2" }) as any, getRoomType: () => undefined };

test("modello collegato al passaggio: trovato per srcId e struttura, vuoto ignorato", () => {
  store[T.TEMPLATES_KEY] = JSON.stringify([
    { id: "t1", name: "checkin_online", srcId: "selfcheckin", texts: { it: "Ciao {ospite}, check-in qui: {link_checkin}", en: "" } },
    { id: "t2", name: "vuoto", srcId: "guida", texts: { it: "  " } },
    { id: "t3", name: "altra struttura", srcId: "checkout", structureIds: ["s2"], texts: { it: "Ciao" } },
  ]);
  assert.equal(T.linkedTemplate("selfcheckin", "s1")?.id, "t1");
  assert.equal(T.linkedTemplate("guida", "s1"), null);       // testo vuoto: si usa il testo di base
  assert.equal(T.linkedTemplate("checkout", "s1"), null);    // valido solo per un'altra struttura
  assert.equal(T.linkedTemplate("checkout", "s2")?.id, "t3");
  assert.equal(T.templateRawFor(T.linkedTemplate("selfcheckin", "s1")!, guest), "Ciao {ospite}, check-in qui: {link_checkin}");
});

test("fillTemplateNow: segnaposto riempiti con i dati della prenotazione", () => {
  const out = T.fillTemplateNow("Ciao {ospite}, benvenuto a {struttura}, camera {camera}, notti {notti}. {checkin}", booking, guest, structure, deps);
  assert.ok(out.startsWith("Ciao Anna, benvenuto a Casa Bella, camera Camera 2, notti 4."));
  assert.ok(out.includes("19.10.2026"));
  assert.ok(!out.includes("{"));
});
