import test from "node:test";
import assert from "node:assert/strict";
import { isOffHours, otaAutoActive } from "../src/lib/aiConcierge.ts";
import { parseChannexMessage, appendOtaMessage, otaLabel, messageHookSecret, parseAttachments, parseChannexTime, pickMessageStore, hasSameOut, normText } from "../src/lib/channex-messages.ts";

const ev = (over: Record<string, unknown> = {}) => ({ event: "message", property_id: "P1", payload: { id: "m1", message: " Ciao ", sender: "guest", booking_id: "B1", property_id: "P1", ...over } });

test("parseChannexMessage: messaggio dell'ospite", () => {
  assert.deepEqual(parseChannexMessage(ev()), { id: "m1", text: "Ciao", bookingId: "B1", propertyId: "P1", sender: "guest" });
});
test("parseChannexMessage: scarta altri mittenti, altri eventi e dati incompleti", () => {
  assert.equal(parseChannexMessage(ev({ sender: "system" })), null);
  assert.equal(parseChannexMessage({ ...ev(), event: "booking" }), null);
  assert.equal(parseChannexMessage(ev({ booking_id: "" })), null);
  assert.equal(parseChannexMessage(ev({ message: "  " })), null);
  assert.equal(parseChannexMessage(null), null);
});
test("parseChannexMessage: solo allegato → testo segnaposto", () => {
  assert.match(parseChannexMessage(ev({ message: "", have_attachment: true }))!.text, /Allegato/);
});
test("parseChannexMessage: messaggio della struttura (fuori da Xenora) con orario", () => {
  const m = parseChannexMessage(ev({ sender: "property", message: "Benvenuto", inserted_at: "2026-10-10T08:00:00.000000" }))!;
  assert.equal(m.sender, "property");
  assert.equal(m.ts, Date.parse("2026-10-10T08:00:00Z"));
  assert.equal(parseChannexMessage(ev({ sender: "property" }))!.ts, undefined);
});
test("parseChannexTime: UTC se manca il fuso", () => {
  assert.equal(parseChannexTime("2021-07-28T04:25:15.000000"), Date.parse("2021-07-28T04:25:15Z"));
  assert.equal(parseChannexTime("2021-07-28T06:25:15+02:00"), Date.parse("2021-07-28T04:25:15Z"));
  assert.equal(parseChannexTime("boh"), undefined);
  assert.equal(parseChannexTime(undefined), undefined);
});
const API = "https://staging.channex.io/api/v1";
test("parseAttachments: stringhe, oggetti, URL relativi e link non sicuri", () => {
  const r = parseAttachments([
    "https://cdn.example.com/a/foto%20casa.jpg?sig=1",
    "attachments/abc/doc.pdf",
    "/api/v1/attachments/xyz/pianta.png",
    { url: "https://x.it/f.pdf", file_name: "Contratto.pdf" },
    "javascript:alert(1)", "data:text/html,x", "//evil.com/x", "", null, 5,
    "https://cdn.example.com/a/foto%20casa.jpg?sig=1",
  ], API);
  assert.deepEqual(r, [
    { url: "https://cdn.example.com/a/foto%20casa.jpg?sig=1", name: "foto casa.jpg" },
    { url: `${API}/attachments/abc/doc.pdf`, name: "doc.pdf" },
    { url: "https://staging.channex.io/api/v1/attachments/xyz/pianta.png", name: "pianta.png" },
    { url: "https://x.it/f.pdf", name: "Contratto.pdf" },
  ]);
  assert.deepEqual(parseAttachments(undefined, API), []);
  assert.equal(parseAttachments(Array.from({ length: 30 }, (_, i) => `https://a.it/${i}.jpg`), API).length, 10);
});
test("parseChannexMessage: allegato → link nel messaggio", () => {
  const m = parseChannexMessage(ev({ message: "", have_attachment: true, attachments: ["https://a.it/x.pdf"] }), API)!;
  assert.equal(m.text, "📎 Allegato");
  assert.deepEqual(m.attachments, [{ url: "https://a.it/x.pdf", name: "x.pdf" }]);
  const conTesto = parseChannexMessage(ev({ message: "Ecco", attachments: ["https://a.it/y.jpg"] }), API)!;
  assert.equal(conTesto.text, "Ecco");
});
test("pickMessageStore: preferisce la riga di una struttura condivisa; il thread resta nello stato personale", () => {
  assert.deepEqual(pickMessageStore([{ tenant_id: "U1", org_id: null }]), { tenantId: "U1", orgId: null });
  assert.deepEqual(pickMessageStore([{ tenant_id: "U1", org_id: null }, { tenant_id: "U2", org_id: "O1" }]), { tenantId: "U2", orgId: "O1" });
  assert.equal(pickMessageStore([]), null);
  assert.equal(pickMessageStore(null), null);
  assert.equal(pickMessageStore([{ tenant_id: null, org_id: "O1" }]), null);
});
test("appendOtaMessage: prenotazione di una struttura condivisa (solo in org_state) + allegati", () => {
  const blob: Record<string, string> = { "spigolestay:data:v1": JSON.stringify({ bookings: [] }) };
  const org = { bookings: [{ id: "bk9", extId: "channex:B1", guestId: "G9", channel: "airbnb" }] };
  const msg = { id: "m1", text: "📎 Allegato", bookingId: "B1", propertyId: "P1", sender: "guest" as const, attachments: [{ url: "https://a.it/x.pdf", name: "x.pdf" }] };
  assert.equal(appendOtaMessage(blob, msg, 5).status, "no_booking"); // senza i dati dell'org non si trova
  assert.deepEqual(appendOtaMessage(blob, msg, 5, [org]), { status: "added", guestId: "G9", bookingId: "bk9", channel: "Airbnb" });
  const t = JSON.parse(blob["spigolestay:threads:v1"]);
  assert.deepEqual(t.G9[0], { id: "chx:m1", dir: "in", text: "📎 Allegato", ts: 5, via: "Airbnb", att: msg.attachments });
  assert.equal(appendOtaMessage(blob, msg, 6, [org]).status, "duplicate");
});
test("appendOtaMessage: messaggio della struttura → out, con orario, idempotente", () => {
  const blob: Record<string, string> = { "spigolestay:data:v1": JSON.stringify({ bookings: [{ id: "bk1", extId: "channex:B1", guestId: "G1", channel: "booking" }] }) };
  const msg = { id: "o1", text: "Benvenuto!", bookingId: "B1", propertyId: "P1", sender: "property" as const, ts: 1_000_000 };
  assert.equal(appendOtaMessage(blob, msg, 9_999_999).status, "added");
  const t = JSON.parse(blob["spigolestay:threads:v1"]);
  assert.deepEqual(t.G1[0], { id: "chx:o1", dir: "out", text: "Benvenuto!", ts: 1_000_000, via: "Booking.com" });
  assert.equal(appendOtaMessage(blob, msg, 2).status, "duplicate");
});
test("appendOtaMessage: la risposta già inviata da Xenora non si duplica (stesso testo, entro 10 minuti)", () => {
  const base = 1_700_000_000_000;
  const mk = () => ({ "spigolestay:data:v1": JSON.stringify({ bookings: [{ id: "bk1", extId: "channex:B1", guestId: "G1", channel: "booking" }] }),
    "spigolestay:threads:v1": JSON.stringify({ G1: [{ id: "loc", dir: "out", text: "Benvenuto  a\nSiracusa ", ts: base, via: "Booking.com" }] }) });
  const m = (id: string, ts: number, text = "Benvenuto a Siracusa") => ({ id, text, bookingId: "B1", propertyId: "P1", sender: "property" as const, ts });
  const a = mk(); assert.equal(appendOtaMessage(a, m("r1", base + 9 * 60_000), 1).status, "duplicate");
  const b = mk(); assert.equal(appendOtaMessage(b, m("r2", base + 11 * 60_000), 1).status, "added"); // fuori finestra
  const c = mk(); assert.equal(appendOtaMessage(c, m("r3", base + 1000, "Altro testo"), 1).status, "added");
  // un messaggio dell'ospite con lo stesso testo non è mai un duplicato di una nostra risposta
  const d = mk(); assert.equal(appendOtaMessage(d, { ...m("g1", base), sender: "guest" }, base).status, "added");
});
test("hasSameOut / normText", () => {
  assert.equal(normText("  a \n b  "), "a b");
  assert.equal(hasSameOut([{ dir: "in", text: "ciao", ts: 0 }], "ciao", 0), false);
  assert.equal(hasSameOut([{ dir: "out", text: "ciao", ts: 0 }], " ciao ", 600_000), true);
  assert.equal(hasSameOut([{ dir: "out", text: "ciao", ts: 0 }], "ciao", 600_001), false);
});
test("appendOtaMessage: aggiunge al thread dell'ospite e non duplica", () => {
  const blob: Record<string, string> = {
    "spigolestay:data:v1": JSON.stringify({ bookings: [{ id: "bk1", extId: "channex:B1", guestId: "G1", channel: "booking" }] }),
    "spigolestay:threads:v1": JSON.stringify({ G1: [{ id: "x", dir: "out", text: "hi", ts: 1 }] }),
  };
  const msg = { id: "m1", text: "Ciao", bookingId: "B1", propertyId: "P1", sender: "guest" as const };
  assert.deepEqual(appendOtaMessage(blob, msg, 1000), { status: "added", guestId: "G1", bookingId: "bk1", channel: "Booking.com" });
  const t = JSON.parse(blob["spigolestay:threads:v1"]);
  assert.equal(t.G1.length, 2);
  assert.deepEqual(t.G1[1], { id: "chx:m1", dir: "in", text: "Ciao", ts: 1000, via: "Booking.com" });
  assert.equal(appendOtaMessage(blob, msg, 2000).status, "duplicate");
  assert.equal(JSON.parse(blob["spigolestay:threads:v1"]).G1.length, 2);
});
test("appendOtaMessage: prenotazione sconosciuta", () => {
  assert.equal(appendOtaMessage({}, { id: "m", text: "t", bookingId: "B9", propertyId: "P", sender: "guest" }, 1).status, "no_booking");
});
test("otaLabel e segreto", () => {
  assert.equal(otaLabel("airbnb"), "Airbnb");
  assert.equal(otaLabel("expedia"), "Expedia");
  assert.equal(otaLabel(undefined), "OTA");
  assert.equal(messageHookSecret({}), "");
  assert.equal(messageHookSecret({ CRON_SECRET: "a" }), messageHookSecret({ CRON_SECRET: "a" }));
  assert.notEqual(messageHookSecret({ CRON_SECRET: "a" }), messageHookSecret({ CRON_SECRET: "b" }));
});

test("fascia fuori orario: ora italiana, anche a cavallo della mezzanotte", () => {
  const at = (iso: string) => new Date(iso); // ottobre: Roma = UTC+2
  assert.equal(isOffHours(at("2026-10-07T20:00:00Z"), 21, 9), true); // 22:00 a Roma
  assert.equal(isOffHours(at("2026-10-07T03:00:00Z"), 21, 9), true); // 05:00
  assert.equal(isOffHours(at("2026-10-07T08:00:00Z"), 21, 9), false); // 10:00
  assert.equal(isOffHours(at("2026-10-07T10:00:00Z"), 12, 14), true); // 12:00, fascia senza mezzanotte
  assert.equal(isOffHours(at("2026-10-07T20:00:00Z"), 9, 9), false);
});
test("otaAutoActive: serve il Concierge acceso e la modalità giusta", () => {
  const night = new Date("2026-10-07T20:00:00Z"), day = new Date("2026-10-07T08:00:00Z");
  const p = { enabled: true, otaMode: "offhours" as const, otaFrom: 21, otaTo: 9 };
  assert.equal(otaAutoActive(p, night), true);
  assert.equal(otaAutoActive(p, day), false);
  assert.equal(otaAutoActive({ ...p, otaMode: "always" }, day), true);
  assert.equal(otaAutoActive({ ...p, otaMode: "off" }, night), false);
  assert.equal(otaAutoActive({ ...p, enabled: false, otaMode: "always" }, night), false);
});
