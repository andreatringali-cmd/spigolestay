import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { notifyBookingLines } = await import("../src/lib/booking-notify.ts");

const base = {
  ev: "newBooking" as const,
  booking: { code: "XEN-2026-0017", checkIn: "2026-10-29", checkOut: "2026-10-30", adults: 2, children: 1, total: 30, paid: 0, arrivalTime: "18:30", parking: true, guestRequests: "Letto   aggiunto" },
  guest: { fullName: "Mario Rossi", phone: "+39 333 1112233", email: "mario@esempio.it", country: "IT" },
  structureName: "Spigolehouse", roomLabel: "Deluxe · 3", channelLabel: "Diretta",
};

test("email di nuova prenotazione: tutte le informazioni, date gg.mm.aaaa", () => {
  const t = notifyBookingLines(base).join("\n");
  assert.match(t, /^Mario Rossi/);
  assert.match(t, /Telefono: \+39 333 1112233/);
  assert.match(t, /Email: mario@esempio\.it/);
  assert.match(t, /Struttura: Spigolehouse/);
  assert.match(t, /Camera: Deluxe · 3/);
  assert.match(t, /Arrivo: 29\.10\.2026 · previsto alle 18:30/);
  assert.match(t, /Partenza: 30\.10\.2026/);
  assert.match(t, /Soggiorno: 1 notte · 2 adulti, 1 bambino/);
  assert.match(t, /Canale: Diretta/);
  assert.match(t, /Codice prenotazione: XEN-2026-0017/);
  assert.match(t, /Totale: € 30,00/);
  assert.match(t, /Da incassare: € 30,00/);
  assert.match(t, /Parcheggio richiesto/);
  assert.match(t, /Richieste dell'ospite: Letto aggiunto/);
  assert.ok(!t.includes("2026-10-29"));
});

test("senza nome non scrive solo 'Ospite' ma lo dice; niente righe vuote doppie o in coda", () => {
  const lines = notifyBookingLines({ ...base, guest: undefined, booking: { checkIn: "2026-10-29", checkOut: "2026-10-31" } });
  assert.equal(lines[0], "Ospite (nome non indicato)");
  assert.ok(!lines.some((l, i) => l === "" && (lines[i - 1] === "" || i === lines.length - 1)));
  assert.match(lines.join("\n"), /Soggiorno: 2 notti/);
});

test("pagamento: mostra l'incasso registrato e l'importo residuo", () => {
  const t = notifyBookingLines({ ...base, ev: "payment", paymentAmount: 10, booking: { ...base.booking, paid: 10 } }).join("\n");
  assert.match(t, /Già incassato: € 10,00/);
  assert.match(t, /Da incassare: € 20,00/);
  assert.match(t, /Incasso registrato: € 10,00/);
});

test("pulizia: il Totale la include (alloggio + pulizia = totale) ed è coerente con 'Da incassare'", () => {
  const t = notifyBookingLines({ ...base, booking: { ...base.booking, total: 1200, cleaningFee: 34.5, paid: 100 } }).join("\n");
  assert.match(t, /Alloggio: € 1\.200,00/); // migliaia sempre separate
  assert.match(t, /Pulizia: € 34,50/);
  assert.match(t, /Totale: € 1\.234,50/);
  assert.match(t, /Già incassato: € 100,00/);
  assert.match(t, /Da incassare: € 1\.134,50/);
});

test("senza pulizia il Totale è l'alloggio e non compaiono righe a zero", () => {
  const t = notifyBookingLines({ ...base, booking: { ...base.booking, total: 30, cleaningFee: 0 } }).join("\n");
  assert.match(t, /Totale: € 30,00/);
  assert.doesNotMatch(t, /Pulizia|Alloggio/);
});

test("persone al singolare: 1 adulto, 1 bambino", () => {
  const t = notifyBookingLines({ ...base, booking: { ...base.booking, adults: 1, children: 1 } }).join("\n");
  assert.match(t, /1 notte · 1 adulto, 1 bambino/);
});
