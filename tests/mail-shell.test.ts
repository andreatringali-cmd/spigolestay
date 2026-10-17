import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const S = await import("../src/lib/mail/shell.ts");

test("contrasto: testo bianco o scuro scelto in base all'accento", () => {
  assert.equal(S.readableOn("#003580"), "#ffffff"); // blu scuro → bianco
  assert.equal(S.readableOn("#FFCB05"), S.INK); // giallo → scuro
  assert.equal(S.readableOn("#fff"), S.INK);
  // un accento chiaro usato come TESTO viene scurito fino a un contrasto leggibile
  assert.ok(S.contrastRatio(S.accentText("#FFCB05"), "#ffffff") >= 4.5);
  assert.equal(S.accentText("non-un-colore"), "#285f92");
  assert.equal(S.normHex("#abc", "#000000"), "#aabbcc");
  assert.equal(S.normHex("rosso", "#123456"), "#123456");
});

test("date: gg.mm.aaaa anche da ISO con orario; con giorno della settimana; vuoto se non valida", () => {
  assert.equal(S.fmtIso("2027-01-01"), "01.01.2027");
  assert.equal(S.fmtIso("2027-01-01T15:30:00.000Z"), "01.01.2027");
  assert.equal(S.fmtIso("boh"), "");
  assert.equal(S.fmtIso(undefined), "");
  assert.equal(S.fmtDay("2027-01-01T10:00:00Z", "it"), "ven 01.01.2027");
  assert.match(S.fmtDay("2027-01-01", "en"), /^Fri 01\.01\.2027$/);
  assert.equal(S.fmtDay("", "it"), "");
});

test("importi sempre con 2 decimali, formato della lingua", () => {
  assert.equal(S.money(62, "€", "it"), "€ 62,00");
  assert.equal(S.money(1234.5, "€", "it"), "€ 1.234,50");
  assert.equal(S.money(1234.5, "€", "en"), "€ 1,234.50");
  assert.equal(S.money(undefined, "€", "it"), "€ 0,00");
});

test("plurali corretti nelle cinque lingue", () => {
  assert.equal(S.countLabel("it", "night", 1), "1 notte");
  assert.equal(S.countLabel("it", "night", 3), "3 notti");
  assert.equal(S.countLabel("en", "night", 1), "1 night");
  assert.equal(S.countLabel("de", "night", 2), "2 Nächte");
  assert.equal(S.peopleLabel("it", 1, 0), "1 adulto");
  assert.equal(S.peopleLabel("it", 2, 1), "2 adulti, 1 bambino");
  assert.equal(S.peopleLabel("en", 2, 2), "2 adults, 2 children");
  assert.equal(S.peopleLabel("fr", 0, 0), "");
});

test("saluto: nome di battesimo se noto; 'COGNOME NOME' in maiuscolo non si spezza a caso", () => {
  assert.equal(S.greetingName("Mario Rossi"), "Mario");
  assert.equal(S.greetingName("Mario Rossi", "Mario"), "Mario");
  assert.equal(S.greetingName("ROSSI MARIO"), "Rossi Mario");
  assert.equal(S.greetingName("", ""), "");
  assert.equal(S.greetingName(undefined), "");
  assert.equal(S.greetingName("  Anna   Maria  Verdi "), "Anna");
  assert.equal(S.greetingName("X", "MARIA"), "Maria");
});

test("chip del canale con i colori ufficiali", () => {
  assert.deepEqual(S.channelChipStyle("Booking.com"), { bg: "#003580", fg: "#ffffff", label: "Booking.com" });
  assert.equal(S.channelChipStyle("booking")?.bg, "#003580");
  assert.equal(S.channelChipStyle("Airbnb")?.bg, "#FF5A5F");
  assert.equal(S.channelChipStyle("Expedia / Vrbo")?.bg, "#FFCB05");
  assert.equal(S.channelChipStyle("Expedia / Vrbo")?.fg, "#00355F");
  assert.equal(S.channelChipStyle("Agoda")?.label, "Agoda");
  assert.equal(S.channelChipStyle("bed-and-breakfast.it")?.label, "bed-and-breakfast.it");
  assert.equal(S.channelChipStyle("Diretta")?.label, "Diretto");
  assert.equal(S.channelChipStyle(""), null);
  assert.match(S.channelChipHtml("Airbnb"), /background:#FF5A5F/);
  assert.equal(S.channelChipHtml(undefined), "");
});

test("badge evento: nuova verde, modificata ambra, cancellata rossa, pagamento blu, messaggio viola", () => {
  assert.match(S.eventBadgeHtml("newBooking"), /NUOVA PRENOTAZIONE|Nuova prenotazione/i);
  assert.equal(S.EVENT_STYLE.newBooking.dot, "#16A05D");
  assert.equal(S.EVENT_STYLE.modified.dot, "#E39A00");
  assert.equal(S.EVENT_STYLE.cancel.dot, "#D92D20");
  assert.equal(S.EVENT_STYLE.payment.dot, "#2563EB");
  assert.equal(S.EVENT_STYLE.message.dot, "#7C3AED");
  assert.equal(S.asMailEvent("cancel"), "cancel");
  assert.equal(S.asMailEvent("boh"), undefined);
  // il testo del badge è scuro su fondo tenue: contrasto leggibile
  for (const ev of S.MAIL_EVENTS) assert.ok(S.contrastRatio(S.EVENT_STYLE[ev].fg, S.EVENT_STYLE[ev].bg) >= 4.5, ev);
});

test("shell: tabelle, 600px, charset/viewport/title/preheader, lang dinamico, footer tradotto, niente flex", () => {
  const html = S.emailShell({
    lang: "de", title: "Titolo <test>", preheader: "Anteprima", accent: "#FFCB05",
    brand: { name: "Casa Rossi & Figli", address: "Via Roma 1", phone: "+39 0931 1", email: "info@casa.it", vat: "IT123" },
    bodyHtml: "<p>corpo</p>",
  });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="de"/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(html, /<title>Titolo &lt;test&gt;<\/title>/);
  assert.match(html, /width="600"/);
  assert.match(html, /max-width:600px/);
  assert.ok(html.includes("Anteprima"));
  assert.ok(html.includes("Gesendet mit Xenora"), "footer tradotto");
  assert.ok(html.includes("USt-IdNr. IT123"), "P.IVA tradotta");
  assert.ok(html.includes("Casa Rossi &amp; Figli"));
  assert.doesNotMatch(html, /display:\s*flex/);
  assert.doesNotMatch(html, /undefined|null/);
  // iniziali nel colore struttura con testo scuro (giallo = chiaro)
  assert.match(html, /bgcolor="#ffcb05"/i);
  assert.ok(html.includes("color:" + S.INK), "testo scuro sull'accento chiaro");
});

test("logo: attributi width/height + max-width; senza logo restano le iniziali", () => {
  const withLogo = S.logoBlockHtml({ name: "Casa", logo: "https://x.supabase.co/logo.png" }, "#285f92");
  assert.match(withLogo, /<img [^>]*width="52" height="52"/);
  assert.match(withLogo, /max-width:52px/);
  const noLogo = S.logoBlockHtml({ name: "Spigole House" }, "#285f92");
  assert.ok(noLogo.includes(">SH<"));
  // un data: URI NON viene mai mostrato (i client email lo bloccano)
  assert.doesNotMatch(S.logoBlockHtml({ name: "X", logo: "data:image/png;base64,AAAA" }, "#285f92"), /<img/);
});

test("pulsante: tabella con testo a contrasto e href escapato", () => {
  const b = S.ctaButtonHtml('https://xenora.it/prenotazioni?b=1&x="y"', "Apri →", "#003580");
  assert.match(b, /<table/);
  assert.match(b, /color:#ffffff/);
  assert.ok(b.includes("b=1&amp;x=&quot;y&quot;"));
});
