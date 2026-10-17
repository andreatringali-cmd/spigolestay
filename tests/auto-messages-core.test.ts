import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// I moduli importano con percorsi senza estensione: li risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const core = await import("../src/lib/auto-messages-core.ts");
const { fillTokens, stayTimeText, autoSubject, decideSend, dedupeGroups, orgBlobFor, whatsappUsable, remKindsOf, guestFallback, structureFallback, checkinDoneText } = core;

const tpl = (over: Record<string, unknown> = {}) => ({ id: "t1", name: "Benvenuto", trigger: "before_arrival" as const, days: 1, active: true, texts: { it: "Ciao {ospite}" }, ...over });
const bk = (over: Record<string, unknown> = {}) => ({ status: "confirmed", checkIn: "2026-10-26", checkOut: "2026-10-28", ...over });

test("fillTokens: maiuscole indifferenti, segnaposto sconosciuti spariscono", () => {
  assert.equal(fillTokens("Ciao {OSPITE}, benvenuto a {Struttura}! {nome} {link_pagamento}", { ospite: "Anna", struttura: "Casa" }), "Ciao Anna, benvenuto a Casa!");
});

test("fillTokens: riga con la sola etichetta di un link vuoto omessa", () => {
  const text = "Lascia una recensione:\nGoogle: {link_google}\nTripadvisor: {link_tripadvisor}\nGrazie!";
  assert.equal(fillTokens(text, { link_google: "", link_tripadvisor: "https://t.example/x" }), "Lascia una recensione:\nTripadvisor: https://t.example/x\nGrazie!");
  // una frase lunga con un segnaposto vuoto (oltre 2 parole prima) viene omessa per intero: mai frasi tronche; le altre frasi restano
  assert.equal(fillTokens("Il check-in è {checkin}. Buon viaggio!", { checkin: "" }), "Buon viaggio!");
  // freccia + segnaposto vuoto: riga omessa
  assert.equal(fillTokens("1) Guida:\n👉 {link_guida}\nCiao", { link_guida: "" }), "1) Guida:\nCiao");
});

test("fillTokens: struttura senza nome → ripiego neutro, firma omessa, mai «a !»", () => {
  const ctx = { ospite: "Anna", struttura: structureFallback("it") };
  const out = fillTokens("Benvenuti a {struttura}!\n— {struttura}", ctx, { lang: "it", emptyStructure: true });
  assert.equal(out, "Benvenuti alla nostra struttura!");
  assert.ok(!/ a !/.test(out));
  const en = fillTokens("Welcome to {struttura}!\n— {struttura}", { struttura: structureFallback("en") }, { lang: "en", emptyStructure: true });
  assert.equal(en, "Welcome to our property!");
});

test("fallback ospite e struttura tradotti per le 5 lingue", () => {
  for (const l of ["it", "en", "fr", "de", "es"] as const) { assert.ok(guestFallback(l).length > 2, l); assert.ok(structureFallback(l).length > 2, l); }
  assert.equal(guestFallback("it"), "ospite");
});

test("stayTimeText: data gg.mm.aaaa + orario nella lingua dell'ospite", () => {
  assert.equal(stayTimeText("checkin", "it", "2026-10-26", "15:00"), "26.10.2026 dalle 15:00");
  assert.equal(stayTimeText("checkin", "en", "2026-10-26", "15:00"), "26.10.2026 from 15:00");
  assert.equal(stayTimeText("checkin", "fr", "2026-10-26", "15:00"), "26.10.2026 à partir de 15:00");
  assert.equal(stayTimeText("checkin", "de", "2026-10-26", "15:00"), "26.10.2026 ab 15:00 Uhr");
  assert.equal(stayTimeText("checkin", "es", "2026-10-26", "15:00"), "26.10.2026 desde las 15:00");
  assert.equal(stayTimeText("checkout", "it", "2026-10-28", "10:30"), "28.10.2026 entro le 10:30");
  assert.equal(stayTimeText("checkout", "en", "2026-10-28", "10:30"), "28.10.2026 by 10:30");
  assert.equal(stayTimeText("checkout", "de", "2026-10-28", "10:30"), "28.10.2026 bis 10:30 Uhr");
  assert.equal(stayTimeText("checkout", "fr", "2026-10-28", "10:30"), "28.10.2026 avant 10:30");
  assert.equal(stayTimeText("checkout", "es", "2026-10-28", "10:30"), "28.10.2026 antes de las 10:30");
  // senza orario (o orario non valido) resta la sola data
  assert.equal(stayTimeText("checkin", "it", "2026-10-26"), "26.10.2026");
  assert.equal(stayTimeText("checkout", "en", "2026-10-28", "boh"), "28.10.2026");
});

test("autoSubject: nella lingua dell'ospite, mai il nome del modello", () => {
  assert.equal(autoSubject("it", "Spigolehouse", "2026-10-26"), "Il tuo soggiorno a Spigolehouse · 26.10.2026");
  assert.equal(autoSubject("en", "Spigolehouse", "2026-10-26"), "Your stay at Spigolehouse · 26.10.2026");
  assert.equal(autoSubject("fr", "X", "2026-10-26"), "Votre séjour à X · 26.10.2026");
  assert.equal(autoSubject("de", "X", "2026-10-26"), "Ihr Aufenthalt in X · 26.10.2026");
  assert.equal(autoSubject("es", "X", "2026-10-26"), "Tu estancia en X · 26.10.2026");
  assert.equal(autoSubject("it", "", "2026-10-26"), "Il tuo soggiorno · 26.10.2026"); // struttura senza nome: niente «a »
});

test("decideSend: invio il giorno previsto, mai prima né dopo", () => {
  assert.deepEqual(decideSend({ tpl: tpl(), booking: bk(), today: "2026-10-25", balance: 0 }), { send: true, slot: "2026-10-25", recovery: false });
  assert.deepEqual(decideSend({ tpl: tpl(), booking: bk(), today: "2026-10-24", balance: 0 }), { send: false, reason: "not_due" });
  assert.deepEqual(decideSend({ tpl: tpl({ trigger: "manual" }), booking: bk(), today: "2026-10-25", balance: 0 }), { send: false, reason: "no_slot" });
});

test("decideSend: prenotazioni provvisorie (tentative) non ricevono nulla", () => {
  assert.deepEqual(decideSend({ tpl: tpl(), booking: bk({ status: "tentative" }), today: "2026-10-25", balance: 0 }), { send: false, reason: "tentative" });
});

test("decideSend: recupero last-minute solo per prenotazioni create dopo il giorno previsto e arrivo non passato", () => {
  // modello «1 giorno prima»: slot = 26.10; oggi 27.10, creata oggi, arrivo oggi → recupero
  assert.deepEqual(decideSend({ tpl: tpl(), booking: bk({ checkIn: "2026-10-27", checkOut: "2026-10-29", bookedOn: "2026-10-27T09:10:00Z" }), today: "2026-10-27", balance: 0 }), { send: true, slot: "2026-10-26", recovery: true });
  // creata PRIMA dello slot (la finestra l'ha già servita, o il modello è nuovo): niente recupero
  assert.deepEqual(decideSend({ tpl: tpl(), booking: bk({ checkIn: "2026-10-27", checkOut: "2026-10-29", bookedOn: "2026-10-01" }), today: "2026-10-27", balance: 0 }), { send: false, reason: "not_due" });
  // senza data di creazione: niente recupero
  assert.deepEqual(decideSend({ tpl: tpl(), booking: bk({ checkIn: "2026-10-27", checkOut: "2026-10-29" }), today: "2026-10-27", balance: 0 }), { send: false, reason: "not_due" });
  // arrivo già passato: niente recupero
  assert.deepEqual(decideSend({ tpl: tpl(), booking: bk({ checkIn: "2026-10-24", checkOut: "2026-10-26", bookedOn: "2026-10-24" }), today: "2026-10-26", balance: 0 }), { send: false, reason: "not_due" });
  // solo per i modelli «prima dell'arrivo»
  assert.deepEqual(decideSend({ tpl: tpl({ trigger: "after_checkout" }), booking: bk({ bookedOn: "2026-10-30" }), today: "2026-10-26", balance: 0 }), { send: false, reason: "not_due" });
});

test("decideSend: {link_checkin} non si manda a chi ha già fatto il check-in online, {saldo} non a saldo zero", () => {
  const onlyCheckin = tpl({ texts: { it: "Compila: {link_checkin}" } });
  assert.deepEqual(decideSend({ tpl: onlyCheckin, booking: bk({ webCheckin: true }), today: "2026-10-25", balance: 0 }), { send: false, reason: "web_checkin_done" });
  assert.equal(decideSend({ tpl: onlyCheckin, booking: bk({ webCheckin: false }), today: "2026-10-25", balance: 0 }).send, true);
  // modello che porta anche la guida: parte comunque (con la nota «già completato» al posto del link)
  const both = tpl({ texts: { it: "Check-in: {link_checkin}\nGuida: {link_guida}" } });
  assert.equal(decideSend({ tpl: both, booking: bk({ webCheckin: true }), today: "2026-10-25", balance: 0 }).send, true);
  const onlySaldo = tpl({ texts: { it: "Saldo {saldo}" } });
  assert.deepEqual(decideSend({ tpl: onlySaldo, booking: bk(), today: "2026-10-25", balance: 0 }), { send: false, reason: "no_balance" });
  assert.equal(decideSend({ tpl: onlySaldo, booking: bk(), today: "2026-10-25", balance: 120.5 }).send, true);
  assert.ok(checkinDoneText("de").length > 3);
});

test("dedupeGroups: un solo messaggio per gruppo di camere (e, a richiesta, per ospite+giorno)", () => {
  const rows = [
    { id: "b2", groupId: "G", guestId: "g1", checkIn: "2026-10-26" },
    { id: "b1", groupId: "G", guestId: "g1", checkIn: "2026-10-26" },
    { id: "b3", guestId: "g2", checkIn: "2026-10-26" },
    { id: "b4", guestId: "g2", checkIn: "2026-10-26" },
    { id: "b5", guestId: "g2", checkIn: "2026-10-30" },
  ];
  const a = dedupeGroups(rows);
  assert.deepEqual(a.keep.map((r) => r.id), ["b1", "b3", "b4", "b5"]);
  assert.deepEqual(a.membersOf.get("b1"), ["b1", "b2"]);
  const b = dedupeGroups(rows, { byGuest: true });
  assert.deepEqual(b.keep.map((r) => r.id), ["b1", "b3", "b5"]);
  assert.deepEqual(b.membersOf.get("b3"), ["b3", "b4"]);
});

test("orgBlobFor: le righe delle strutture condivise leggono modelli/codici/guide/recensioni dal blob del titolare", () => {
  const org = { "spigolestay:data:v1": "{}" };
  const owner = { "spigolestay:msgtemplates": "[1]", "spigolestay:roomaccess": "{}", "spigolestay:guides": "{}", "spigolestay:reviewsettings": "{}", "spigolestay:data:v1": "{\"altro\":1}" };
  const merged = orgBlobFor(org, owner);
  assert.equal(merged["spigolestay:msgtemplates"], "[1]");
  assert.equal(merged["spigolestay:roomaccess"], "{}");
  assert.equal(merged["spigolestay:data:v1"], "{}"); // i dati restano quelli dell'organizzazione
  assert.deepEqual(orgBlobFor(org, null), org);
  // una chiave già presente nella riga org non si sovrascrive
  assert.equal(orgBlobFor({ "spigolestay:msgtemplates": "[2]" }, owner)["spigolestay:msgtemplates"], "[2]");
});

test("whatsappUsable: testo libero solo con la finestra di 24 ore aperta; col modello approvato sempre", () => {
  assert.equal(whatsappUsable({ hasTemplate: false, windowOpen: false }), false);
  assert.equal(whatsappUsable({ hasTemplate: false, windowOpen: true }), true);
  assert.equal(whatsappUsable({ hasTemplate: true, windowOpen: false }), true);
});

test("remKindsOf: i passaggi coperti dal modello diventano tipi di promemoria della chat", () => {
  assert.deepEqual(remKindsOf(tpl({ texts: { it: "{link_checkin} {link_guida} {saldo}" } })), ["checkin", "guide", "pay-saldo"]);
  assert.deepEqual(remKindsOf(tpl({ trigger: "after_checkout", texts: { it: "Lascia una recensione {link_recensioni}" } })), ["review"]);
});

test("fillTokens: «Il tuo codice d'accesso è {codice_accesso}.» senza codice non resta tronco", () => {
  assert.equal(fillTokens("Ciao {ospite}!\nIl tuo codice d'accesso è {codice_accesso}.\nA presto", { ospite: "Anna", codice_accesso: "" }), "Ciao Anna!\nA presto");
  // stessa riga, due frasi: salta solo quella col segnaposto vuoto
  assert.equal(fillTokens("Il tuo codice d'accesso è {codice_accesso}. Ti aspettiamo!", { codice_accesso: "" }), "Ti aspettiamo!");
  // con il valore presente nulla cambia
  assert.equal(fillTokens("Il tuo codice d'accesso è {codice_accesso}. Ti aspettiamo!", { codice_accesso: "1234" }), "Il tuo codice d'accesso è 1234. Ti aspettiamo!");
  // frase corta (max 2 parole prima) con segnaposto vuoto: comportamento di prima (etichetta/riga)
  assert.equal(fillTokens("Camera: {camera}\nCiao", { camera: "" }), "Ciao");
  assert.equal(fillTokens("Saldo da pagare all'arrivo: {saldo}", { saldo: "" }), "");
});

test("decideSend: il recupero last-minute solo per prenotazioni create negli ultimi 2 giorni e non da import in blocco", () => {
  const recov = (over: Record<string, unknown>, today = "2026-10-27") => decideSend({ tpl: tpl({ days: 7 }), booking: bk({ checkIn: "2026-10-29", checkOut: "2026-10-31", ...over }), today, balance: 0 });
  // slot = 22.10; creata il 26 (ieri): recupero
  assert.equal((recov({ bookedOn: "2026-10-26" }) as { recovery?: boolean }).recovery, true);
  // creata il 23 (4 giorni fa, dopo lo slot ma oltre i 2 giorni): niente recupero
  assert.deepEqual(recov({ bookedOn: "2026-10-23" }), { send: false, reason: "not_due" });
  // import in blocco: bookedOn = giorno dell'import, niente recupero
  assert.deepEqual(recov({ bookedOn: "2026-10-27", bulkImport: true }), { send: false, reason: "not_due" });
});

test("dropRedundantRecovery: il recupero con gli stessi passaggi di un modello già dovuto oggi non parte", () => {
  const before = tpl({ id: "before", days: 1, texts: { it: "Check-in: {link_checkin}" } });
  const onArr = tpl({ id: "onarr", trigger: "on_arrival", days: 0, texts: { it: "Benvenuto! {link_checkin}" } });
  const guide = tpl({ id: "guide", days: 1, texts: { it: "Guida {link_guida}" } });
  const b = bk({ checkIn: "2026-10-27", checkOut: "2026-10-29", bookedOn: "2026-10-27" });
  const items = [before, onArr, guide].map((t) => ({ tpl: t, dec: decideSend({ tpl: t, booking: b, today: "2026-10-27", balance: 0 }) }));
  assert.equal((items[0].dec as { recovery?: boolean }).recovery, true);
  assert.equal((items[1].dec as { recovery?: boolean }).recovery, false);
  const drop = core.dropRedundantRecovery(items);
  assert.deepEqual([...drop], ["before"]); // check-in già coperto da on_arrival; la guida (altro passaggio) resta
});

test("bulkImportDays: molte prenotazioni Channex con la stessa data nella stessa struttura = import in blocco", () => {
  const mk = (i: number, over: Record<string, unknown> = {}) => ({ id: `b${i}`, structureId: "S1", source: "channex", bookedOn: "2026-10-27", ...over });
  const many = Array.from({ length: 6 }, (_, i) => mk(i));
  assert.deepEqual([...core.bulkImportDays(many)], ["S1|2026-10-27"]);
  assert.equal(core.bulkImportDays(many.slice(0, 5)).size, 0);
  assert.equal(core.bulkImportDays(many.map((b) => ({ ...b, source: undefined }))).size, 0); // non Channex
  assert.equal(core.bulkImportDays(many.map((b) => ({ ...b, groupId: "G" }))).size, 0); // un solo gruppo = una prenotazione
});

test("dedupeGroups byGuest: stesso ospite lo stesso giorno ma in strutture diverse = due messaggi", () => {
  const rows = [
    { id: "a", guestId: "g1", structureId: "S1", checkIn: "2026-10-26" },
    { id: "b", guestId: "g1", structureId: "S2", checkIn: "2026-10-26" },
    { id: "c", guestId: "g1", structureId: "S1", checkIn: "2026-10-26" },
  ];
  const r = dedupeGroups(rows, { byGuest: true });
  assert.deepEqual(r.keep.map((x) => x.id), ["a", "b"]);
  assert.deepEqual(r.membersOf.get("a"), ["a", "c"]);
});

test("sentKeysFor: la voce del cron (prenotazione rappresentante) copre ogni camera del gruppo", () => {
  // il cron scrive con la rappresentante b1; la riga della coda per la camera b2 deve risultare inviata
  const cronKey = "t1-b1-2026-10-26";
  const keysForB2 = core.sentKeysFor("t1", "b2", "2026-10-26", ["b1", "b2"]);
  assert.ok(keysForB2.includes(cronKey));
  assert.deepEqual(core.sentKeysFor("t1", "b9", "2026-10-26"), ["t1-b9-2026-10-26"]);
});

test("autoMessageCoversToday: il promemoria check-in salta solo se il messaggio automatico parte (o è partito) oggi", () => {
  assert.equal(core.autoMessageCoversToday([], "2026-10-26"), true);                                   // il cron dei messaggi lo manderà dopo
  assert.equal(core.autoMessageCoversToday([{ slot_date: "2026-10-26" }], "2026-10-26"), true);        // già partito oggi
  assert.equal(core.autoMessageCoversToday([{ slot_date: "2026-10-20" }], "2026-10-26"), false);       // già inviato in passato: oggi non si rimanda
  assert.equal(core.autoMessageCoversToday([{ slot_date: "2026-10-20" }, { slot_date: "2026-10-26" }], "2026-10-26"), true);
});
