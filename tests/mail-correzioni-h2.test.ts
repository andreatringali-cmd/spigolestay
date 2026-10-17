import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { PDFDocument } from "pdf-lib";

register("./helpers/alias-loader.mjs", import.meta.url);
const G = await import("../src/lib/mail/guest-emails.ts");
const N = await import("../src/lib/mail/notify-email.ts");
const P = await import("../src/lib/mail/notify-payload.ts");
const S = await import("../src/lib/mail/shell.ts");
const U = await import("../src/lib/mail/send-utils.ts");
const M = await import("../src/lib/mailer.ts");
const { buildVoucherPdf } = await import("../src/lib/voucher-pdf.ts");
const { buildQuotePdf } = await import("../src/lib/quote-pdf.ts");

const brand = { name: "Spigole House", address: "Via Roma 1 Siracusa", accent: "#285f92" };
const cancelBase = { code: "XEN-1", structureName: "Casa", guestName: "Mario Rossi", guestFirstName: "Mario", checkIn: "2027-01-01", checkOut: "2027-01-03", currency: "€", lang: "it" };

// ── 1. annullamento: unrefunded ──
test("annullamento: rimborso dovuto ma non emesso → la struttura contatterà l'ospite, non 'Nessun rimborso previsto'", () => {
  const html = G.cancelEmailHtml({ ...cancelBase, refunded: 0, unrefunded: 80 }, { brand });
  assert.doesNotMatch(html, /Nessun rimborso previsto/);
  assert.doesNotMatch(html, /Secondo le condizioni della tariffa/);
  assert.match(html, /La struttura ti contatterà per il rimborso di € 80,00/);
});
test("annullamento: rimborso parziale → importo emesso + riga col residuo", () => {
  const html = G.cancelEmailHtml({ ...cancelBase, refunded: 30, unrefunded: 50 }, { brand });
  assert.match(html, /Rimborso emesso: € 30,00/);
  assert.match(html, /restituirti il residuo di € 50,00/);
  assert.doesNotMatch(html, /Nessun rimborso previsto/);
});
test("annullamento: senza unrefunded invariato (nessun rimborso / rimborso pieno)", () => {
  assert.match(G.cancelEmailHtml({ ...cancelBase }, { brand }), /Nessun rimborso previsto/);
  const full = G.cancelEmailHtml({ ...cancelBase, refunded: 80 }, { brand });
  assert.match(full, /Rimborso emesso: € 80,00/);
  assert.doesNotMatch(full, /contatterà/);
});
test("annullamento: unrefunded tradotto in en/fr/de/es", () => {
  const want: Record<string, RegExp> = { en: /The property will contact you about the refund of € 80\.00/, fr: /L'établissement vous contactera/, de: /Die Unterkunft wird sich wegen der Erstattung/, es: /El alojamiento se pondrá en contacto/ };
  for (const lang of Object.keys(want)) {
    const html = G.cancelEmailHtml({ ...cancelBase, lang, refunded: 0, unrefunded: 80 }, { brand });
    assert.match(html.replace(/&#39;/g, "'"), want[lang], lang);
    assert.doesNotMatch(html, /La struttura ti contatterà/, `${lang}: niente italiano`);
  }
});

// ── 3. mappa con apostrofo ──
test("mailer: link Google Maps con apostrofo nell'indirizzo resta un URL accettabile (niente ' nell'URL)", () => {
  const st = { id: "s1", name: "Casa", address: "Via dell'Arsenale 5", city: "Siracusa", currency: "€" };
  const deps = { getStructure: () => st, getGuest: () => ({ id: "g", fullName: "Mario Rossi" }), getRoomType: () => ({ id: "rt", name: "Std" }), getUnit: () => ({ id: "u", name: "1" }) };
  const b = { id: "b1", structureId: "s1", roomTypeId: "rt", unitId: "u", guestId: "g", channel: "direct", status: "confirmed", checkIn: "2027-01-01", checkOut: "2027-01-03", adults: 2, children: 0, total: 100, paid: 0, createdAt: 0 };
  const p = M.voucherPayload(b as never, deps as never);
  assert.ok(p.mapsUrl, "mapsUrl presente");
  assert.match(p.mapsUrl as string, /^https?:\/\/[^\s"'<>]+$/, "stessa regola di safeHttpUrl");
  assert.ok((p.mapsUrl as string).includes("Arsenale") && (p.mapsUrl as string).includes("%27"));
});

// ── 5. cancellazione: niente tassa/commissione/netto ──
const nb = {
  bookingId: "b-1", code: "555", guestName: "Alice Dettoni", roomLabel: "Deluxe", checkIn: "2027-01-01", checkOut: "2027-01-03", nights: 2, adults: 2,
  stay: 62, total: 62, cityTax: 4, paid: 10, due: 56, commission: 9.3, net: 52.7, currency: "€",
};
test("notifica cancellazione: omette tassa di soggiorno, commissione e netto; mantiene Totale (annullato) e Già incassato", () => {
  const { html } = N.notifyEmailHtml({ event: "cancel", brand, channelLabel: "Booking.com", booking: nb });
  assert.doesNotMatch(html, /Tassa di soggiorno/);
  assert.doesNotMatch(html, /Commissione OTA/);
  assert.doesNotMatch(html, /Netto per la struttura/);
  assert.match(html, /Totale \(annullato\)/);
  assert.match(html, /Già incassato/);
  const n = N.notifyEmailHtml({ event: "newBooking", brand, booking: nb });
  assert.match(n.html, /Tassa di soggiorno/);
  assert.match(n.html, /Commissione OTA/);
});

// ── 6. eliminazione prenotazione ──
test("eliminazione: l'avviso 'Cancellata' solo per prenotazioni vive e non concluse", () => {
  const today = "2026-10-17";
  assert.equal(P.deleteMeritsCancelEmail({ status: "confirmed", checkOut: "2026-10-20" }, today), true);
  assert.equal(P.deleteMeritsCancelEmail({ status: "confirmed", checkOut: "2026-10-17" }, today), true, "check-out oggi: ancora valida");
  assert.equal(P.deleteMeritsCancelEmail({ status: "cancelled", checkOut: "2026-10-20" }, today), false);
  assert.equal(P.deleteMeritsCancelEmail({ status: "confirmed", checkOut: "2026-10-16" }, today), false, "conclusa");
});

// ── 7. lingua dal dominio ──
test("lingua di ripiego dal dominio del destinatario", () => {
  assert.equal(U.langFromEmailDomain("hans@web.de"), "de");
  assert.equal(U.langFromEmailDomain("a@orange.fr"), "fr");
  assert.equal(U.langFromEmailDomain("a@foo.es"), "es");
  assert.equal(U.langFromEmailDomain("a@bbc.co.uk"), "en");
  assert.equal(U.langFromEmailDomain("a@gmail.com"), undefined);
  assert.equal(U.langFromEmailDomain("a@libero.it"), undefined);
  assert.equal(U.langFromEmailDomain(undefined), undefined);
});

// ── 8. oggetto ricevuta abbonamento ──
test("ricevuta abbonamento: piano grezzo capitalizzato nell'oggetto", () => {
  assert.equal(G.subReceiptSubject({ plan: "pro" }), "Ricevuta abbonamento Xenora · Pro");
  assert.equal(G.subReceiptSubject({ plan: "pro", planName: "Xenora Pro" }), "Ricevuta abbonamento Xenora · Xenora Pro");
  assert.equal(G.subReceiptSubject({}), "Ricevuta abbonamento Xenora");
});

// ── 9. a capo di richieste e note ──
test("notifica: gli a capo di richieste e note dell'ospite restano (pre-wrap)", () => {
  const { html } = N.notifyEmailHtml({ event: "newBooking", brand, booking: { ...nb, guestRequests: "Culla\r\nArrivo tardi\n\n\n\nGrazie", note: "riga1\nriga2" } });
  assert.ok(html.includes("Culla\nArrivo tardi\n\nGrazie"), "a capo preservati, righe vuote ripetute compattate");
  assert.ok(html.includes("riga1\nriga2"));
});

// ── 10. contrasto ──
test("colori grigi delle email con contrasto sufficiente (≥ 4,5)", () => {
  const { html } = N.notifyEmailHtml({ event: "newBooking", brand, booking: nb });
  const v = G.voucherEmailHtml({ ...cancelBase, status: "confirmed", total: 100, paid: 0 }, { brand, checkinUrl: "https://x.it/c" });
  for (const h of [html, v]) { assert.doesNotMatch(h, /#8a919c/i); assert.doesNotMatch(h, /#8f96a1/i); }
  assert.ok(S.contrastRatio("#6b7280", "#ffffff") >= 4.5);
  assert.ok(S.contrastRatio("#6b7280", "#f8f9fb") >= 4.5);
  assert.ok(S.contrastRatio("#5f6672", "#f4f5f7") >= 4.5);
  assert.equal(S.readableOn("#0E9F6E"), "#1f2430", "il verde resta con testo scuro");
});

// ── 11. preheader ──
test("preheader: 'Nuova prenotazione su Booking.com', 'Nuovo messaggio' per i messaggi", () => {
  const a = N.notifyEmailHtml({ event: "newBooking", brand, channelLabel: "Booking.com", booking: nb }).html;
  assert.match(a, /Nuova prenotazione su Booking\.com · Alice Dettoni/);
  assert.doesNotMatch(a, /Nuova su Booking/);
  const m = N.notifyEmailHtml({ event: "message", brand, channelLabel: "Airbnb", booking: nb }).html;
  assert.match(m, /Nuovo messaggio su Airbnb/);
  assert.doesNotMatch(m, /Nuova su Airbnb/);
});

// ── 12. voucher annullato ──
test("voucher annullato: niente pulsante di gestione, link gestisci e QR", () => {
  const o = { brand, checkinUrl: "https://x.it/checkin", manageUrl: "https://x.it/gestisci", qrUrl: "https://x.it/qr.png" };
  const c = G.voucherEmailHtml({ ...cancelBase, statusKey: "cancelled", total: 100 }, o);
  assert.doesNotMatch(c, /Gestisci la tua prenotazione/);
  assert.doesNotMatch(c, /Gestisci la prenotazione \(modifica o annulla\)/);
  assert.doesNotMatch(c, /qr\.png/);
  const ok = G.voucherEmailHtml({ ...cancelBase, statusKey: "confirmed", total: 100 }, o);
  assert.match(ok, /Gestisci la tua prenotazione/);
  assert.match(ok, /qr\.png/);
});

// ── 13. colori a 4 / 8 cifre nei PDF ──
test("normHex: 4 e 8 cifre → 6 cifre (alpha scartato); i PDF con questi colori si generano", async () => {
  assert.equal(S.normHex("#abcd", "#000000"), "#aabbcc");
  assert.equal(S.normHex("#11223344", "#000000"), "#112233");
  assert.equal(S.normHex("#abc", "#000000"), "#aabbcc");
  assert.equal(S.normHex("zzz", "#285f92"), "#285f92");
  for (const color of ["#abcd", "#11223344"]) {
    const v = await buildVoucherPdf({ code: "X", structureName: "Casa", checkIn: "2027-01-01", checkOut: "2027-01-02", total: 10, color } as never);
    assert.ok((await PDFDocument.load(v)).getPageCount() >= 1);
    const q = await buildQuotePdf({ structureName: "Casa", total: 10, color } as never);
    assert.ok((await PDFDocument.load(q)).getPageCount() >= 1);
  }
});
