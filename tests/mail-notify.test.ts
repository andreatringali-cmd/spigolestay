import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const N = await import("../src/lib/mail/notify-email.ts");
const P = await import("../src/lib/mail/notify-payload.ts");

const brand = { name: "Spigole House", logo: "https://x.supabase.co/l.png", address: "Via Roma 1 Siracusa", accent: "#285f92" };
const booking = {
  bookingId: "b-123", code: "5551234567", guestName: "Alice Dettoni", guestPhone: "+39 333 1112233", guestEmail: "alice@esempio.it", guestCountry: "NL",
  roomLabel: "Deluxe · 3", checkIn: "2027-01-01", checkOut: "2027-01-03", nights: 2, adults: 2, children: 1, bookedOn: "2026-10-10",
  stay: 62, extras: 0, cleaning: 0, cityTax: 4, total: 62, paid: 0, due: 66, commission: 9.3, commissionEstimate: true, net: 52.7,
  guestRequests: "Letto   aggiunto",
};

test("oggetto standard: evento · ospite · canale · arrivo gg.mm.aaaa · struttura", () => {
  assert.equal(N.notifySubject("cancel", { guestName: "Alice Dettoni", channelLabel: "Booking.com", checkIn: "2027-01-01", structureName: "Spigole House" }), "Cancellata · Alice Dettoni · Booking.com · 01.01.2027 · Spigole House");
  assert.equal(N.notifySubject("newBooking", { guestName: "Alice", checkIn: "2027-01-01", structureName: "S" }), "Nuova prenotazione · Alice · 01.01.2027 · S");
  assert.equal(N.notifySubject("modified", { guestName: "Alice" }), "Modificata · Alice");
  assert.match(N.notifySubject("payment", { guestName: "Alice", amount: 50 }), /^Pagamento ricevuto · Alice · € 50,00$/);
});

test("layout ricco: struttura, chip canale, badge, riepilogo, contatti cliccabili, richieste, CTA alla scheda", () => {
  const { html, subject } = N.notifyEmailHtml({
    event: "newBooking", brand, channelLabel: "Booking.com", structureName: "Spigole House", booking,
    ctaUrl: "https://xenora.it/prenotazioni?b=b-123",
  });
  assert.equal(subject, "Nuova prenotazione · Alice Dettoni · Booking.com · 01.01.2027 · Spigole House");
  assert.ok(html.includes("Spigole House"));
  assert.match(html, /<img [^>]*src="https:\/\/x\.supabase\.co\/l\.png"/);
  assert.match(html, /background:#003580/); // chip Booking.com
  assert.ok(html.includes("Alice Dettoni"));
  assert.ok(html.includes("ven 01.01.2027"), "arrivo con giorno della settimana");
  assert.ok(html.includes("dom 03.01.2027") || html.includes("dom. 03.01.2027") || /\d{2}\.01\.2027/.test(html));
  assert.ok(html.includes("2 notti · 2 adulti, 1 bambino"), "plurali");
  assert.ok(html.includes("5551234567"));
  assert.ok(html.includes("10.10.2026"), "prenotata il");
  assert.match(html, /href="tel:\+393331112233"/);
  assert.match(html, /href="mailto:alice@esempio\.it"/);
  assert.match(html, /href="https:\/\/wa\.me\/393331112233"/);
  assert.ok(html.includes("Paesi Bassi (NL)"));
  assert.ok(html.includes("Letto aggiunto"), "richiesta evidenziata, spazi normalizzati");
  assert.ok(html.includes("€ 62,00") && html.includes("€ 66,00"));
  assert.ok(html.includes("Commissione OTA (stima)"));
  assert.ok(html.includes("Netto per la struttura (stima)"));
  assert.ok(html.includes('href="https://xenora.it/prenotazioni?b=b-123"'));
  assert.match(html, /<title>Nuova prenotazione/);
  assert.doesNotMatch(html, /undefined|NaN|null/);
  assert.doesNotMatch(html, /display:\s*flex/);
});

test("cancellazione: nessun 'Da incassare'; commissione esatta senza '(stima)'", () => {
  const { html } = N.notifyEmailHtml({ event: "cancel", brand, channelLabel: "Booking.com", booking: { ...booking, commissionEstimate: false, paid: 20 } });
  assert.doesNotMatch(html, /Da incassare/);
  assert.ok(html.includes("Totale (annullato)"));
  assert.ok(html.includes("Già incassato"));
  assert.ok(!html.includes("Commissione OTA"), "commissione e netto non pertinenti su una cancellazione");
  // sulle nuove prenotazioni, invece, c'è
  const n = N.notifyEmailHtml({ event: "newBooking", brand, booking });
  assert.ok(n.html.includes("Da incassare"));
});

test("pagamento: incasso registrato in evidenza", () => {
  const { html, subject } = N.notifyEmailHtml({ event: "payment", brand, booking: { ...booking, payment: 30, paid: 30, due: 36 } });
  assert.ok(html.includes("Incasso registrato"));
  assert.ok(html.includes("€ 30,00"));
  assert.match(subject, /Pagamento ricevuto · Alice Dettoni · .*€ 30,00/);
});

test("solo testo (altri chiamanti): stessa shell curata, nessun layout ricco", () => {
  const { html, subject } = N.notifyEmailHtml({ subject: "Documento rifiutato", text: "Riga 1\nRiga 2 <b>", ctaUrl: "https://xenora.it/documenti/1", ctaLabel: "Apri il documento", accent: "#4F46E5" });
  assert.equal(subject, "Documento rifiutato");
  assert.ok(html.includes("Riga 1\nRiga 2 &lt;b&gt;"));
  assert.ok(html.includes("Apri il documento"));
  assert.match(html, /<meta name="viewport"/);
  // con event ma senza booking: badge + testo
  const ev = N.notifyEmailHtml({ event: "message", text: "Ciao", subject: "Nuovo messaggio da Anna" });
  assert.ok(/NUOVO MESSAGGIO|Nuovo messaggio/i.test(ev.html));
});

test("WhatsApp: prefisso internazionale; cellulare italiano senza prefisso → 39; numero dubbio → nessun link", () => {
  assert.equal(N.waNumber("+39 333 111 2233"), "393331112233");
  assert.equal(N.waNumber("0031 6 1234 5678"), "31612345678");
  assert.equal(N.waNumber("333 1112233"), "393331112233");
  assert.equal(N.waNumber("12345"), "");
  assert.equal(N.waNumber(""), "");
});

// ── payload costruito da gestionale e server ──
const structure = { id: "s1", name: "Spigole House", photoColor: "#285f92", logo: "https://x.supabase.co/l.png", address: "Via Roma", streetNumber: "1", city: "Siracusa", currency: "€", email: "info@spigole.it" };
const bk = { id: "b-123", structureId: "s1", roomTypeId: "rt", unitId: null, guestId: "g", channel: "booking", status: "confirmed", checkIn: "2027-01-01", checkOut: "2027-01-03", adults: 2, children: 0, total: 62, paid: 0, code: "5551234567", commissionAmount: 9.3 };

test("payload: oggetto, brand, canale, link diretto alla scheda, importi coerenti", () => {
  const body = P.buildNotifyPayload({ ev: "cancel", booking: bk as never, guest: { fullName: "Alice Dettoni", phone: "+39 333 1112233" }, structure: structure as never, roomLabel: "Deluxe · 3", channelLabel: "Booking.com", origin: "https://xenora.it/" });
  assert.equal(body.kind, "notify");
  assert.equal(body.event, "cancel");
  assert.equal(body.subject, "Cancellata · Alice Dettoni · Booking.com · 01.01.2027 · Spigole House");
  assert.equal(body.ctaUrl, "https://xenora.it/prenotazioni?b=b-123");
  assert.deepEqual(body.brand, { name: "Spigole House", logoUrl: structure.logo, color: "#285f92", address: "Via Roma 1 Siracusa" });
  assert.equal(body.channelLabel, "Booking.com");
  const nb = body.booking as Record<string, unknown>;
  assert.equal(nb.total, 62);
  assert.equal(nb.commission, 9.3);
  assert.equal(nb.commissionEstimate, false); // cifra esatta dal portale
  assert.equal(nb.net, 52.7);
  assert.equal(nb.nights, 2);
  assert.ok(typeof body.text === "string" && (body.text as string).includes("Alice Dettoni"));
  // prenotazione ELIMINATA: il link porta all'elenco, non a una scheda che non esiste più
  const del = P.buildNotifyPayload({ ev: "cancel", booking: bk as never, structure: structure as never, origin: "https://xenora.it", deleted: true });
  assert.equal(del.ctaUrl, "https://xenora.it/prenotazioni");
  // senza commissione esatta il netto è una stima
  const est = P.buildNotifyPayload({ ev: "newBooking", booking: { ...bk, commissionAmount: undefined } as never, structure: structure as never, origin: "https://xenora.it" });
  assert.equal((est.booking as Record<string, unknown>).commissionEstimate, true);
});

test("payload: diretta senza commissione; nessun importo se manca il prezzo", () => {
  const d = P.buildNotifyPayload({ ev: "newBooking", booking: { ...bk, channel: "direct", commissionAmount: undefined } as never, structure: structure as never, origin: "https://xenora.it" });
  assert.equal((d.booking as Record<string, unknown>).commission, undefined);
  const free = P.buildNotifyPayload({ ev: "newBooking", booking: { ...bk, total: undefined } as never, structure: structure as never, origin: "https://xenora.it" });
  assert.equal((free.booking as Record<string, unknown>).total, undefined);
});
