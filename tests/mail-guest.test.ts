import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { PDFDocument, StandardFonts } from "pdf-lib";

register("./helpers/alias-loader.mjs", import.meta.url);
const G = await import("../src/lib/mail/guest-emails.ts");
const U = await import("../src/lib/mail/send-utils.ts");
const PT = await import("../src/lib/mail/pdf-text.ts");
const { buildVoucherPdf } = await import("../src/lib/voucher-pdf.ts");
const { buildQuotePdf } = await import("../src/lib/quote-pdf.ts");
const { cancelPolicyIn } = await import("../src/lib/email-i18n.ts");
const M = await import("../src/lib/mailer.ts");

const base = {
  code: "XEN-2027-0001", structureName: "Casa Rossi, Siracusa", guestName: "Mario Rossi", guestFirstName: "Mario", guestEmail: "mario@esempio.it",
  roomType: "Deluxe", unitName: "3", checkIn: "2027-01-01", checkOut: "2027-01-03", nights: 2, adults: 2, children: 1,
  total: 200, cleaningFee: 20, extras: [{ name: "Colazione", price: 10 }], cityTaxAmount: 8, paid: 50, currency: "€", color: "#285f92",
  checkInFrom: "15:00", checkOutBy: "10:00", cityTaxRuleText: "La tassa di soggiorno non è inclusa nel totale della prenotazione e sarà pagata in struttura.",
  cityTaxRule: { mode: "percent", percent: 4, cap: 5 },
};
const opts = { checkinUrl: "https://xenora.it/checkin?b=1", brand: { name: "Casa Rossi, Siracusa", accent: "#285f92" } };

test("voucher confermato: totali coerenti (camere + extra + pulizia, tassa a parte), 2 decimali, date con giorno", () => {
  const t = G.voucherTotals(base);
  assert.equal(t.bookingTotal, 230); // 200 + 10 + 20
  assert.equal(t.grandTotal, 238);
  assert.equal(t.due, 188);
  const html = G.voucherEmailHtml({ ...base, status: "Confermata" }, opts);
  assert.ok(html.includes("è confermata"));
  assert.ok(html.includes("€ 230,00") && html.includes("€ 238,00") && html.includes("€ 188,00") && html.includes("€ 50,00"));
  assert.ok(html.includes("Pulizia") && html.includes("Totale con tassa di soggiorno"));
  assert.ok(html.includes("ven 01.01.2027") && html.includes("dalle 15:00"));
  assert.ok(html.includes("2 notti · 2 adulti, 1 bambino"));
  assert.ok(html.includes("Ciao <b>Mario</b>"));
  assert.ok(html.includes("non è inclusa nel totale della prenotazione"), "frase coerente con la tabella (tassa separata dal totale prenotazione)");
  assert.ok(html.includes("Totale prenotazione"));
  assert.doesNotMatch(html, /undefined|NaN|null/);
  assert.match(html, /<meta charset="utf-8">/);
});

test("voucher in attesa (tentative) o annullato: NON dice 'è confermata'", () => {
  const pending = G.voucherEmailHtml({ ...base, status: "In attesa di conferma", statusKey: "tentative" }, opts);
  assert.doesNotMatch(pending, /è confermata/);
  assert.ok(pending.includes("in attesa di conferma"));
  assert.equal(G.voucherSubject({ ...base, statusKey: "tentative" }), "Riepilogo prenotazione XEN-2027-0001 · Casa Rossi, Siracusa");
  const cancelled = G.voucherEmailHtml({ ...base, statusKey: "cancelled" }, opts);
  assert.doesNotMatch(cancelled, /è confermata/);
  assert.ok(cancelled.includes("annullata"));
  assert.doesNotMatch(cancelled, /Totale da incassare/);
  assert.equal(G.voucherSubject({ ...base }), "Conferma prenotazione XEN-2027-0001 · Casa Rossi, Siracusa");
  assert.equal(G.statusKindOf({ status: "Annullata" }), "cancelled");
  assert.equal(G.statusKindOf({}), "confirmed");
});

test("voucher di gruppo: tutte le camere elencate, senza riga camera singola", () => {
  const html = G.voucherEmailHtml({ ...base, roomType: undefined, unitName: undefined, rooms: [{ roomType: "Deluxe", unitName: "3", adults: 2, total: 120 }, { roomType: "Standard", unitName: "5", adults: 1, children: 1, total: 80 }] }, opts);
  assert.ok(html.includes("Camere"));
  assert.ok(html.includes("Deluxe · 3") && html.includes("Standard · 5"));
  assert.ok(html.includes("1 adulto, 1 bambino"));
  assert.ok(html.includes("€ 120,00") && html.includes("€ 80,00"));
});

test("nome camera vuoto → riga omessa; nessuna richiesta → nessun riquadro", () => {
  const html = G.voucherEmailHtml({ ...base, roomType: "", unitName: "  " }, opts);
  assert.doesNotMatch(html, />Camera</);
  assert.doesNotMatch(html, /Richieste speciali/);
});

test("politica di cancellazione: refundable non definito → nessuna clausola (mai 'non rimborsabile' a caso)", () => {
  assert.equal(cancelPolicyIn("en", undefined), "");
  assert.match(cancelPolicyIn("en", false), /non-refundable/);
  assert.equal(M.cancelPolicyText(undefined), undefined);
  assert.match(M.cancelPolicyText(false) ?? "", /non è rimborsabile/);
  assert.match(M.cancelPolicyText(true, 7) ?? "", /fino a 7 giorni/);
  assert.match(M.cancelPolicyText(true, 1) ?? "", /fino a 1 giorno prima/); // singolare
  assert.doesNotMatch(M.cancelPolicyText(true, 1) ?? "", /1 giorni/);
  const it =G.voucherEmailHtml({ ...base, status: "Confermata" }, opts);
  assert.doesNotMatch(it, /rimborsabile/);
  const en = G.voucherEmailHtml({ ...base, lang: "en", cancelPolicy: "La prenotazione non è rimborsabile." }, opts);
  assert.doesNotMatch(en, /rimborsabile/, "niente italiano dentro un'email inglese");
  assert.doesNotMatch(en, /Termini|Conferma|Ciao/);
  assert.ok(en.includes("Booking code") && en.includes("Hello <b>Mario</b>"));
  assert.ok(en.includes('lang="en"'));
  assert.ok(en.includes("Sent with Xenora"));
  const refundable = G.voucherEmailHtml({ ...base, lang: "de", refundable: true, cancelDays: 7 }, opts);
  assert.ok(refundable.includes("7 Tage"));
});

test("annullamento all'ospite: lingua, rimborso, date con giorno", () => {
  const html = G.cancelEmailHtml({ ...base, lang: "fr", refunded: 80 }, { brand: opts.brand });
  assert.ok(html.includes("Remboursement émis : € 80,00"));
  assert.ok(html.includes("annulée"));
  assert.doesNotMatch(html, /Ciao|annullata/);
  const it = G.cancelEmailHtml({ ...base, refunded: 0 }, { brand: opts.brand });
  assert.ok(it.includes("Nessun rimborso previsto"));
});

test("check-in al titolare: solo nomi e numero di ospiti, MAI documenti o nascita", () => {
  const guests = [
    { firstName: "Anna", lastName: "Verdi", docNumber: "AB1234567", docType: "Passaporto", birthDate: "1980-05-06", birthPlace: "Napoli", docPlace: "Questura di Napoli" },
    { firstName: "Luca", lastName: "Bianchi", docNumber: "ZZ999", birthDate: "2001-02-03", birthPlace: "Roma" },
  ];
  const html = G.checkinOwnerEmailHtml(base, guests as never, { brand: opts.brand, ctaUrl: "https://xenora.it/prenotazioni?b=1", arrival: "18:30" });
  assert.ok(html.includes("Anna Verdi") && html.includes("Luca Bianchi"));
  assert.ok(html.includes("Ospiti registrati"));
  for (const secret of ["AB1234567", "ZZ999", "Passaporto", "06.05.1980", "1980-05-06", "Napoli", "Roma", "Questura di Napoli", "03.02.2001"]) assert.ok(!html.includes(secret), secret);
  assert.ok(html.includes("https://xenora.it/prenotazioni?b=1"));
});

test("messaggio/preventivo: pulsante e nota nella lingua del preventivo, nessun PDF qui", () => {
  const html = G.messageEmailHtml({ lang: "de", title: "Angebot Casa", text: "Guten Tag", accent: "#285f92", ctaUrl: "https://pay.example/x", ctaLabel: "Bestätigen und online bezahlen →", note: "Sichere Zahlung" });
  assert.ok(html.includes("Bestätigen und online bezahlen →") && html.includes("Sichere Zahlung") && html.includes('lang="de"'));
});

// ── invio ──
test("From: nome tra virgolette e escapato (RFC 5322)", () => {
  assert.equal(U.fromHeader("Casa Rossi, Siracusa", "info@xenora.it"), '"Casa Rossi, Siracusa" <info@xenora.it>');
  assert.equal(U.fromHeader('Casa "Bella" <x>', "a@b.it"), '"Casa \\"Bella\\" x" <a@b.it>');
  assert.equal(U.fromHeader("Riga\r\nBcc: x@y.it", "a@b.it"), '"Riga Bcc: x@y.it" <a@b.it>');
  assert.equal(U.fromHeader(undefined, "a@b.it"), '"Xenora" <a@b.it>');
  assert.equal(U.addressOnly("Xenora <info@xenora.it>"), "info@xenora.it");
  assert.equal(U.addressOnly("info@xenora.it"), "info@xenora.it");
});

test("indirizzi email: validazione semplice", () => {
  for (const ok of ["mario@esempio.it", "a.b+c@sub.dominio.com"]) assert.ok(U.validEmail(ok), ok);
  for (const bad of ["", "mario", "mario@", "@x.it", "a b@x.it", "a@b", "a@b.it, c@d.it", "Mario <m@x.it>", "a@b.it\r\nBcc: x@y.it", undefined, 42]) assert.ok(!U.validEmail(bad), String(bad));
  assert.equal(U.cleanWebsite("www.casa.it"), "www.casa.it");
  assert.equal(U.cleanWebsite('x" onmouseover="a'), undefined);
});

// ── PDF con nomi non Latin-1 ──
test("PDF: nomi fuori WinAnsi traslitterati senza errori", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const S = PT.pdfSafe(font);
  assert.equal(S("Łukasz"), "Lukasz");
  assert.equal(S("Nguyễn"), "Nguyen");
  assert.equal(S("李雷"), "?");
  assert.equal(S("José Müller – ñ € ·"), "José Müller – ñ € ·"); // tutto ciò che il font sa disegnare resta com'è
  assert.equal(S("a → b"), "a -> b");
  assert.equal(S("riga\ndue"), "riga due");
  // senza la ripulitura pdf-lib lancerebbe
  assert.throws(() => font.widthOfTextAtSize("Łukasz", 12));
  assert.doesNotThrow(() => font.widthOfTextAtSize(S("Łukasz"), 12));
});

test("PDF voucher e preventivo: generati anche con nomi non Latin-1, plurali e importi a 2 decimali", async () => {
  for (const name of ["Łukasz Kowalski", "Nguyễn Văn An", "李雷 Li Lei"]) {
    const v = await buildVoucherPdf({ ...base, guestName: name, statusKey: "tentative", lang: "en" });
    assert.ok(v.length > 1500, name);
    const q = await buildQuotePdf({ ref: "1/2027", guestName: name, structureName: "Casa Łódź", checkIn: "2027-01-01", checkOut: "2027-01-02", nights: 1, adults: 1, rooms: [{ name: "Camera Ł", amount: 100 }], total: 100, extras: [{ name: "Ćaj", price: 5, per: "stay" }] });
    assert.ok(q.length > 1500, name);
  }
  // voucher di gruppo con molte camere: va su più pagine senza errori
  const rooms = Array.from({ length: 30 }, (_, i) => ({ roomType: `Camera ${i + 1}`, unitName: String(i), adults: 2, total: 50 }));
  const big = await buildVoucherPdf({ ...base, rooms });
  const parsed = await PDFDocument.load(big);
  assert.ok(parsed.getPageCount() >= 2);
});

// ── mailer: voucher dal gestionale ──
const st = { id: "s1", name: "Casa", city: "Siracusa", cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2, cityTaxMaxNights: 3, currency: "€", photoColor: "#285f92" };
const deps = { getStructure: () => st, getGuest: () => ({ id: "g", fullName: "Mario Rossi", firstName: "Mario", email: "m@x.it" }), getRoomType: (id: string) => ({ id, name: id === "rt1" ? "Deluxe" : "Standard" }), getUnit: (id: string | null) => (id ? { id, name: id } : undefined) } as never;
const mkb = (id: string, over: Record<string, unknown> = {}) => ({ id, groupId: "grp", structureId: "s1", roomTypeId: id === "b1" ? "rt1" : "rt2", unitId: id, guestId: "g", channel: "direct", status: "confirmed", checkIn: "2027-01-01", checkOut: "2027-01-03", adults: 2, children: 0, total: 100, cleaningFee: 10, paid: 0, ...over });

test("mailer: totale = camere + extra + pulizia, tassa separata; il gruppo somma tutte le camere", () => {
  const single = M.voucherPayload(mkb("b1") as never, deps);
  assert.equal(single.cleaningFee, 10);
  assert.equal(single.bookingTotal, 110);
  assert.equal(single.cityTaxAmount, 8); // 2 adulti × 2 notti × 2 €
  assert.equal(single.grandTotal, 118);
  assert.equal(single.due, 118);
  assert.equal(single.rooms, undefined);
  const grp = M.voucherPayload(mkb("b1") as never, deps, [mkb("b1"), mkb("b2", { paid: 50 })] as never);
  assert.equal(grp.rooms?.length, 2);
  assert.equal(grp.total, 200);
  assert.equal(grp.cleaningFee, 20);
  assert.equal(grp.bookingTotal, 220);
  assert.equal(grp.cityTaxAmount, 16);
  assert.equal(grp.grandTotal, 236);
  assert.equal(grp.paid, 50);
  assert.equal(grp.due, 186);
  assert.equal(grp.adults, 4);
  assert.equal(grp.cancelPolicy, undefined, "refundable non definito → nessuna clausola");
  assert.equal(grp.statusKey, "confirmed");
});
