import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { roomKParam, buildGuideUrl, roomCodes } = await import("../src/lib/auto-guide-link.ts");
const { checkPhone, waDigits } = await import("../src/lib/contacts-check.ts");
const { reviewRequestMessage, reviewRequestSubject } = await import("../src/lib/reviews.ts");
const { spiegaErroreWa } = await import("../src/lib/invii-log.ts");
const { bookingGivesAccess, activeBookingOf } = await import("../src/lib/concierge-engine.ts");
const { notifyStructure } = await import("../src/lib/wa-notify.ts");
const { parseChannexInquiry, parseChannexMessage, inquiryEmailText } = await import("../src/lib/channex-messages.ts");
const { DEFAULT_TEMPLATES, mergeSeedTemplates } = await import("../src/lib/msg-templates.ts");
const { readReminderLog } = await import("../src/lib/guest-messages.ts");
const { messageBalance } = await import("../src/lib/msg-balance.ts");
const { emailBrandPayload } = await import("../src/lib/guest-messages.ts");

// ── Link guida: i codici mantengono la posizione (come il browser, guestlink.ts) ──
test("guida: cancello vuoto + portone 1234 + porta 5678 → k = «-1234-5678», non «1234-5678»", () => {
  const ra = { u1: [{ label: "Cancello", value: "" }, { label: "Portone", value: "1234" }, { label: "Porta", value: "5678" }] };
  assert.equal(roomKParam(ra, "u1", true), "-1234-5678");
  const url = new URL(buildGuideUrl({ origin: "https://x.it", structureId: "s1", rooms: [{ unitId: "u1", unitCode: "4" }], roomAccess: JSON.stringify(ra) }));
  assert.equal(url.searchParams.get("k"), "-1234-5678");
});

test("guida: il taglio a 3 voci vale prima di togliere i codici vuoti; i codici condizionati dal parcheggio restano filtrati", () => {
  const ra = { u1: [{ value: "" }, { value: "" }, { value: "" }, { value: "9999" }] };
  assert.equal(roomKParam(ra, "u1", false), ""); // la 4ª voce non entra nel link
  const cond = { u1: [{ value: "1", cond: "parking" }, { value: "2", cond: "noparking" }, { value: "3" }] };
  assert.equal(roomKParam(cond, "u1", true), "1-3");
  assert.equal(roomKParam(cond, "u1", false), "2-3");
  // l'elenco kr (gruppi) scarta le voci vuote, come il browser
  assert.deepEqual(roomCodes({ u: [{ label: "A", value: "" }, { label: "B", value: "7" }] }, "u", true), [{ l: "B", v: "7" }]);
});

// ── Telefoni ──
test("telefono: mobile italiano senza prefisso scritto da un ospite DE/US resta italiano", () => {
  assert.equal(checkPhone("3473824353", { country: "DE" }).e164, "+393473824353");
  // USA/Canada: 347… è un numero valido di New York e non si distingue da un italiano: vale il Paese dichiarato (un americano con (312) 555-0199 non deve finire in Italia).
  assert.equal(checkPhone("3473824353", { country: "US" }).e164, "+13473824353");
  assert.equal(waDigits("3473824353", "DE"), "393473824353");
  assert.equal(waDigits("347 382 4353", "GB"), "393473824353");
});

test("telefono: numeri veramente stranieri non vengono forzati su +39", () => {
  assert.equal(checkPhone("0651964616", { country: "NL" }).e164, "+31651964616");
  assert.equal(checkPhone("+49 1512 3456789", { country: "DE" }).e164, "+4915123456789");
  assert.equal(checkPhone("015123456789", { country: "DE" }).e164, "+4915123456789"); // mobile tedesco con lo 0 iniziale
  assert.equal(checkPhone("+1 305 555 1234", { country: "US" }).e164, "+13055551234");
});

// ── Recensione manuale ──
test("recensione: testo nella lingua dell'ospite con tutti i link configurati", () => {
  const block = "Google: https://g.example/r\nTripadvisor: https://t.example/r";
  const en = reviewRequestMessage({ guestName: "Anna Rossi", structureName: "Casa", linksBlock: block, lang: "en" });
  assert.ok(en.startsWith("Hi Anna,"));
  assert.ok(en.includes("Google: https://g.example/r") && en.includes("Tripadvisor: https://t.example/r"));
  assert.ok(!/grazie|Ciao/i.test(en));
  const de = reviewRequestMessage({ guestName: "Hans", structureName: "Casa", linksBlock: block, lang: "de" });
  assert.ok(de.includes("Bewertung"));
  // default italiano e compatibilità con il solo link Google
  const it = reviewRequestMessage({ guestName: "Anna", structureName: "Casa", reviewUrl: "https://g.example/r" });
  assert.ok(it.startsWith("Ciao Anna,") && it.includes("https://g.example/r"));
  assert.equal(reviewRequestSubject("fr", "Casa"), "Comment s'est passé votre séjour à Casa ?");
  assert.equal(reviewRequestSubject(undefined, ""), "Com'è andato il soggiorno?");
});

// ── Registro invii: «190» ──
test("invii: un numero che contiene 190 non è un token scaduto", () => {
  assert.equal(spiegaErroreWa("Nozze → +39 3401901234: Recipient phone number not in allowed list"), "Il numero non è tra quelli autorizzati.".length ? spiegaErroreWa("Nozze → +39 3401901234: Recipient phone number not in allowed list") : "");
  assert.ok(!/non è più valido/.test(spiegaErroreWa("modello → +393401901234: Number not reachable")));
  assert.ok(!/non è più valido/.test(spiegaErroreWa("rif 1190 fallito")));
  assert.match(spiegaErroreWa("Error validating access token (#190)"), /non è più valido/);
  assert.match(spiegaErroreWa("Invalid OAuth access token"), /non è più valido/);
});

// ── Concierge: i codici solo a chi arriva davvero ──
test("concierge: Wi-Fi e codici solo con prenotazione confermata e arrivo entro domani (data di Roma)", () => {
  const b = (over: Record<string, unknown>) => ({ status: "confirmed", checkIn: "2026-10-18", checkOut: "2026-10-20", ...over }) as Parameters<typeof bookingGivesAccess>[0];
  assert.equal(bookingGivesAccess(b({}), "2026-10-17"), true);                       // arriva domani
  assert.equal(bookingGivesAccess(b({}), "2026-10-18"), true);                       // arriva oggi
  assert.equal(bookingGivesAccess(b({}), "2026-10-19"), true);                       // in corso
  assert.equal(bookingGivesAccess(b({ checkIn: "2027-02-10", checkOut: "2027-02-12" }), "2026-10-17"), false); // prenotato per febbraio
  assert.equal(bookingGivesAccess(b({}), "2026-10-16"), false);                      // arriva fra 2 giorni
  assert.equal(bookingGivesAccess(b({ status: "tentative" }), "2026-10-17"), false); // provvisoria
  assert.equal(bookingGivesAccess(b({ status: "cancelled" }), "2026-10-17"), false);
  assert.equal(bookingGivesAccess(b({}), "2026-10-21"), false);                      // già partito
  assert.equal(bookingGivesAccess(undefined, "2026-10-17"), false);
});

test("concierge: tra più prenotazioni si sceglie quella che dà accesso", () => {
  const list = [
    { id: "feb", structureId: "s", unitId: null, roomTypeId: "r", guestId: "g", checkIn: "2027-02-10", checkOut: "2027-02-12", status: "confirmed" },
    { id: "ora", structureId: "s", unitId: null, roomTypeId: "r", guestId: "g", checkIn: "2026-10-18", checkOut: "2026-10-20", status: "confirmed" },
  ];
  assert.equal(activeBookingOf(list, "g", "2026-10-17")?.id, "ora");
});

// ── Notifica WhatsApp: struttura giusta ──
test("notifica: struttura della prenotazione dell'ospite, non la prima con email", () => {
  const st = [{ id: "a", name: "A", email: "a@x.it" }, { id: "b", name: "B", email: "b@x.it" }];
  const bk = [{ id: "1", guestId: "g", structureId: "b", checkIn: "2026-10-18", checkOut: "2026-10-20", status: "confirmed" }];
  assert.equal(notifyStructure(st, bk, "g", "2026-10-17")?.id, "b");
  assert.equal(notifyStructure(st, bk, "sconosciuto", "2026-10-17")?.id, "a");
  assert.equal(notifyStructure(st, [], undefined, "2026-10-17")?.id, "a");
  // la struttura dell'ospite senza email: si ripiega sulla prima con email (la notifica non si perde)
  assert.equal(notifyStructure([{ id: "a", name: "A" }, { id: "b", name: "B", email: "b@x.it" }], [{ ...bk[0], structureId: "a" }], "g", "2026-10-17")?.id, "b");
});

// ── Messaggi OTA senza prenotazione ──
test("OTA: richiesta di informazioni senza booking_id → avviso al titolare, non scartata", () => {
  const body = { event: "message", payload: { id: "m1", property_id: "p1", sender: "guest", message: "Avete posto a luglio?", booking_id: null, message_thread_id: "th-9", ota_name: "AirBNB" } };
  assert.equal(parseChannexMessage(body), null);
  const inq = parseChannexInquiry(body);
  assert.ok(inq);
  assert.equal(inq!.threadId, "th-9");
  assert.equal(inq!.channel, "Airbnb");
  assert.match(inquiryEmailText(inq!.channel, inq!.text, inq!.threadId), /th-9/);
  // con prenotazione: non è una richiesta
  assert.equal(parseChannexInquiry({ ...body, payload: { ...body.payload, booking_id: "b1" } }), null);
  // messaggi della struttura: non generano avvisi
  assert.equal(parseChannexInquiry({ ...body, payload: { ...body.payload, sender: "property" } }), null);
});

// ── Modelli d'esempio neutri e aggiornamento dei non modificati ──
test("modelli d'esempio: nessuna affermazione sulla reception; i testi vecchi non modificati si aggiornano", () => {
  for (const id of ["seed-benvenuto-guida", "seed-checkin"]) {
    const seed = DEFAULT_TEMPLATES.find((d) => d.id === id)!;
    for (const text of Object.values(seed.texts)) assert.ok(!/reception|rezeption|recepción|réception/i.test(text), `${id}: ${text.slice(0, 60)}`);
  }
  // un modello con i testi della versione precedente (con «reception») passa alla nuova
  const prevIt = "Buongiorno {ospite}, siamo lieti di accogliervi a {struttura}! 🌿\nLa struttura non ha una reception: l'arrivo è autonomo e vi accompagniamo noi.\n\n1) Check-in online (2 minuti, dati e documento):\n👉 {link_checkin}\n2) Guida con accesso, Wi-Fi e consigli utili:\n👉 {link_guida}\n\nQuando siete in arrivo scriveteci su WhatsApp ({whatsapp}) e vi guidiamo all'ingresso. Il check-in è {checkin}.\n— {struttura}";
  const seedNow = DEFAULT_TEMPLATES.find((d) => d.id === "seed-benvenuto-guida")!;
  // le altre lingue della vecchia versione sono nella tabella interna: qui si verifica solo che un modello MODIFICATO a mano non venga toccato
  const edited = { id: "seed-benvenuto-guida", texts: { ...seedNow.texts, it: prevIt + " (modificato)" } };
  const out = mergeSeedTemplates([edited], []);
  assert.equal(out.find((t) => t.id === "seed-benvenuto-guida")!.texts!.it, prevIt + " (modificato)");
});

// ── Cronologia solleciti: un messaggio può coprire più passaggi ──
test("solleciti: rems → un messaggio automatico conta per check-in e guida", () => {
  const store: Record<string, string> = {
    "spigolestay:threads:v1": JSON.stringify({ g1: [{ id: "auto:1", dir: "out", text: "Ciao", ts: 1000, via: "Email", bid: "b1", rem: "checkin", rems: ["checkin", "guide"] }] }),
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: () => {} };
  const log = readReminderLog([{ id: "b1", guestId: "g1" }]);
  assert.equal(log.b1.checkin.length, 1);
  assert.equal(log.b1.guide.length, 1);
  assert.equal(log.b1.guide[0].via, "Email");
});

// ── Carta intestata delle email manuali ──
test("email manuale: carta intestata e replyTo della struttura", () => {
  const p = emailBrandPayload({ name: "Casa", email: "info@casa.it", photoColor: "#123456", logo: "data:x", address: "Via Roma", streetNumber: "1", city: "Siracusa", phone: "+39 0931" });
  assert.equal(p.replyTo, "info@casa.it");
  assert.equal(p.booking.structureName, "Casa");
  assert.equal(p.booking.address, "Via Roma 1 Siracusa");
  assert.equal(p.booking.logo, "data:x");
  assert.equal(p.accent, "#123456");
  assert.equal(emailBrandPayload(undefined).replyTo, undefined);
});

// ── {saldo}: stessa definizione del voucher (include la tassa dovuta) ──
test("saldo: soggiorno + pulizia + extra + tassa − incassato, ai centesimi", () => {
  const st = { id: "s", cityTax: true, cityTaxMode: "fixed", cityTaxAmount: 2, cityTaxMaxNights: 7 } as never;
  const b = { id: "b", checkIn: "2026-10-20", checkOut: "2026-10-22", adults: 2, total: 200, cleaningFee: 30, extras: [{ price: 10 }], paid: 100 } as never;
  const withTax = messageBalance(b, st);
  const noTax = messageBalance(b, undefined);
  assert.equal(noTax, 140);
  assert.ok(withTax >= noTax);
  assert.equal(Math.round(withTax * 100) / 100, withTax);
  assert.equal(messageBalance({ ...(b as object), paid: 500 } as never, st), 0); // mai negativo
});
