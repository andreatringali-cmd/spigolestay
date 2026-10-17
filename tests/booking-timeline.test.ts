import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { buildTimeline, atMs, eventDay, fmtEventAt, isDateOnly, snippet, documentServerEvents, creationTitle } = await import("../src/lib/booking-timeline.ts");

const BID = "11111111-1111-1111-1111-111111111111";
const T = (iso: string) => Date.parse(iso);
const base = { id: BID, guestId: "g1", structureId: "s1", channel: "booking", bookedOn: "2026-10-01" } as never;
const titles = (ev: { title: string }[]) => ev.map((e) => e.title);

test("date: fuso Roma, gg.mm.aaaa hh:mm, giorno senza ora", () => {
  // 2026-07-14 22:30 UTC = 15.07.2026 00:30 a Roma (ora legale)
  assert.equal(fmtEventAt(T("2026-07-14T22:30:00Z")), "15.07.2026 00:30");
  assert.equal(eventDay(T("2026-07-14T22:30:00Z")), "2026-07-15");
  assert.equal(fmtEventAt("2026-10-05"), "05.10.2026");
  assert.equal(fmtEventAt("2026-01-14T23:30:00Z"), "15.01.2026 00:30");
  assert.equal(isDateOnly("2026-10-05"), true);
  assert.equal(isDateOnly("2026-10-05T10:00:00Z"), false);
  assert.equal(atMs(""), null);
  assert.equal(atMs(undefined), null);
  assert.equal(atMs(0), null);
});

test("prenotazione vuota: solo la creazione; fonti assenti non producono righe", () => {
  const ev = buildTimeline({ booking: base });
  assert.deepEqual(titles(ev), ["Arrivata da Booking.com"]);
  assert.equal(ev[0].tone, "info");
  assert.equal(buildTimeline({ booking: { id: BID } as never }).length, 0);
});

test("origine: sito, a mano, OTA", () => {
  assert.equal(creationTitle({ channel: "direct", source: "sito" } as never, "Spigole House"), "Prenotazione dal sito Spigole House");
  assert.equal(creationTitle({ channel: "direct", source: "manuale" } as never), "Prenotazione inserita a mano");
  assert.equal(creationTitle({ channel: "direct", extId: "site:x:y" } as never), "Prenotazione dal sito ufficiale");
  assert.equal(creationTitle({ channel: "airbnb" } as never), "Arrivata da Airbnb");
});

test("creazione: l'ora della revisione Channex (stesso giorno) sostituisce la sola data, senza doppioni", () => {
  const ev = buildTimeline({
    booking: { ...base, extId: "channex:abc" } as never,
    server: [
      { src: "channex_bookings", at: "2026-10-01T08:15:00Z", status: "new", otaCode: "4455667788" },
      { src: "channex_bookings", at: "2026-10-03T09:00:00Z", status: "modified", otaCode: "4455667788" },
      { src: "channex_bookings", at: "2026-10-09T09:00:00Z", status: "cancelled" },
    ],
  });
  assert.deepEqual(titles(ev), ["Arrivata da Booking.com", "Modificata dal portale", "Cancellata dal portale"]);
  assert.equal(fmtEventAt(ev[0].at), "01.10.2026 10:15");
  assert.equal(ev[0].detail, "Codice 4455667788");
  assert.equal(ev[2].tone, "err");
});

test("creazione: se l'importazione è di un altro giorno resta la data di prenotazione", () => {
  const ev = buildTimeline({ booking: { ...base, bookedOn: "2026-09-20" } as never, server: [{ src: "channex_bookings", at: "2026-10-01T08:15:00Z", status: "new" }] });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].at, "2026-09-20");
});

test("revisioni ripetute entro due minuti contano una volta; la seconda 'new' non è una nuova creazione", () => {
  const ev = buildTimeline({
    booking: { id: BID } as never,
    server: [
      { src: "channex_bookings", at: "2026-10-01T08:15:00Z", status: "new" },
      { src: "channex_bookings", at: "2026-10-01T08:15:40Z", status: "new" },
      { src: "channex_bookings", at: "2026-10-04T08:00:00Z", status: "new" },
    ],
  });
  assert.equal(ev.filter((e) => e.kind === "created").length, 1);
  assert.equal(ev.filter((e) => e.kind === "ota_revision").length, 1);
});

test("annullamento: cancelledAt + rimborso; la stessa cancellazione da portale/attività nello stesso giorno non raddoppia", () => {
  const ev = buildTimeline({
    booking: { ...base, status: "cancelled", cancelledAt: "2026-10-10T07:00:00.000Z", cancelledBy: "guest", refundedAmount: 80, unrefundedAmount: 20 } as never,
    guest: { fullName: "Mario Rossi" },
    server: [{ src: "channex_bookings", at: "2026-10-10T07:05:00Z", status: "cancelled" }],
    client: { guestHasOtherBookings: false, activities: [{ ts: T("2026-10-10T07:00:01Z"), type: "cancel", text: "Prenotazione annullata — Mario Rossi" }] },
  });
  const c = ev.filter((e) => e.kind === "cancelled");
  assert.equal(c.length, 1);
  assert.equal(c[0].title, "Prenotazione annullata dall'ospite");
  assert.equal(c[0].detail, `Rimborsati € 80,00 · Da rimborsare a mano € 20,00`);
  assert.equal(c[0].tone, "err");
});

test("check-in online e consenso", () => {
  const g = buildTimeline({ booking: { ...base, webCheckin: true, privacyConsentAt: "2026-10-12T09:30:00Z", privacyConsentBy: "guest" } as never });
  const ci = g.find((e) => e.kind === "checkin")!;
  assert.equal(ci.title, "Check-in online completato");
  assert.equal(ci.tone, "ok");
  const op = buildTimeline({ booking: { ...base, webCheckin: true, privacyConsentAt: "2026-10-12T09:30:00Z", privacyConsentBy: "operator" } as never });
  assert.equal(op.find((e) => e.kind === "checkin")!.title, "Check-in compilato dall'operatore");
  // niente webCheckin e niente consenso: nessuna riga
  assert.equal(buildTimeline({ booking: base }).some((e) => e.kind === "checkin"), false);
});

test("pagamento online semplice: importo in euro italiano, alla data paidAt", () => {
  const ev = buildTimeline({ booking: { ...base, channel: "direct", source: "sito", paid: 120, paidOnline: 120, paidAt: "2026-10-02" } as never });
  const p = ev.find((e) => e.kind === "payment")!;
  assert.equal(p.title, "Pagamento online di € 120,00");
  assert.equal(p.at, "2026-10-02");
});

test("pagamenti online multipli: acconto, saldo; la notifica in chat con l'ora sostituisce la riga del giorno", () => {
  const booking = { ...base, channel: "direct", source: "sito", paid: 300, paidOnline: 300, paidAt: "2026-10-20", stripeExtraPayments: [{ pi: "pi_2", amount: 180 }], paidSessions: ["cs_9"] } as never;
  const noChat = buildTimeline({ booking });
  assert.deepEqual(noChat.filter((e) => e.kind === "payment").map((e) => e.title), ["Pagamento online di € 120,00 (acconto)", "Pagamento online di € 180,00 (saldo)"]);
  const withChat = buildTimeline({
    booking,
    client: { threads: { g1: [{ id: "pay:cs_9", dir: "out", sys: "payment", ts: T("2026-10-20T14:07:00Z"), text: "💳 Pagamento ricevuto € 180,00 (saldo)\nGrazie" }] } },
  });
  const pays = withChat.filter((e) => e.kind === "payment");
  assert.equal(pays.length, 2);
  const saldo = pays.find((e) => e.title.includes("saldo"))!;
  assert.equal(fmtEventAt(saldo.at), "20.10.2026 16:07");
});

test("messaggio automatico: chat + registro invii + registro msgsent + auto_message_log = UNA riga (la chat)", () => {
  const ts = T("2026-10-14T09:00:05Z");
  const ev = buildTimeline({
    booking: base,
    server: [
      { src: "invii_log", at: "2026-10-14T09:00:03Z", job: "messaggi", channel: "email", ok: true, detail: "Promemoria check-in → mario@example.com" },
      { src: "auto_message_log", at: "2026-10-14T09:00:01Z", templateId: "tpl-1", slotDate: "2026-10-14" },
    ],
    client: {
      threads: { g1: [{ id: `auto:tpl-1-${BID}-2026-10-14:Email`, dir: "out", text: "Buongiorno, completa il check-in: https://xenora.it/g/abc", ts, via: "Email", bid: BID, rem: "checkin" }] },
      msgsent: [{ key: `tpl-1-${BID}-2026-10-14`, guest: "Mario", tpl: "Promemoria check-in", via: "Email", ts }],
    },
  });
  const msgs = ev.filter((e) => e.msg);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].title, "Promemoria check-in inviato (email)");
  assert.match(msgs[0].detail!, /^Automatico · Buongiorno, completa il check-in: link$/);
});

test("senza chat restano registro invii (riuscito) e, se ha un nome, il modello", () => {
  const ev = buildTimeline({
    booking: base,
    server: [
      { src: "invii_log", at: "2026-10-14T09:00:03Z", job: "messaggi", channel: "whatsapp", ok: true, detail: "Benvenuto → +393331234567" },
      { src: "auto_message_log", at: "2026-10-14T09:00:01Z", templateId: "tpl-1", slotDate: "2026-10-14" },
    ],
    client: { templateNames: { "tpl-1": "Benvenuto" } },
  });
  const msgs = ev.filter((e) => e.msg);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].title, "Messaggio automatico «Benvenuto» inviato (WhatsApp)");
});

test("un messaggio di un'altra prenotazione dello stesso ospite non compare; uno dello stesso gruppo sì", () => {
  const ev = buildTimeline({
    booking: base,
    client: {
      bookingIds: [BID, "22222222-2222-2222-2222-222222222222"],
      threads: { g1: [
        { id: "a", dir: "out", text: "x", ts: 1_760_000_000_000, via: "Email", bid: "99999999-9999-9999-9999-999999999999", rem: "guide" },
        { id: "b", dir: "out", text: "guida", ts: 1_760_000_100_000, via: "WhatsApp", bid: "22222222-2222-2222-2222-222222222222", rem: "guide" },
        { id: "c", dir: "in", text: "ciao", ts: 1_760_000_200_000 },
        { id: "d", dir: "out", text: "libero senza prenotazione", ts: 1_760_000_300_000, via: "Email" },
      ] },
    },
  });
  const m = ev.filter((e) => e.kind === "msg");
  assert.equal(m.length, 1);
  assert.equal(m[0].title, "Guida agli ospiti inviata (WhatsApp)");
});

test("voucher registrato in chat con rem 'voucher'", () => {
  const ev = buildTimeline({ booking: base, client: { threads: { g1: [{ id: "v", dir: "out", text: "Voucher inviato a mario@example.com", ts: T("2026-10-02T09:00:00Z"), via: "Email", bid: BID, rem: "voucher" }] } } });
  const v = ev.find((e) => e.kind === "msg")!;
  assert.equal(v.title, "Voucher inviato (email)");
  assert.equal(v.detail, "Voucher inviato a mario@example.com");
});

test("due promemoria manuali ravvicinati restano distinti (nessun falso doppione tra pari grado)", () => {
  const t0 = T("2026-10-14T09:00:00Z");
  const ev = buildTimeline({
    booking: base,
    client: { threads: { g1: [
      { id: "1", dir: "out", text: "p1", ts: t0, via: "Email", bid: BID, rem: "checkin" },
      { id: "2", dir: "out", text: "p2", ts: t0 + 60_000, via: "Email", bid: BID, rem: "checkin" },
    ] } },
  });
  assert.equal(ev.filter((e) => e.kind === "msg").length, 2);
});

test("invio fallito non viene mai nascosto; tentativi ripetuti si accorpano; errore WhatsApp spiegato", () => {
  const fail = (at: string) => ({ src: "invii_log" as const, at, job: "messaggi", channel: "whatsapp", ok: false, detail: "Benvenuto → +39333: (#131047) Re-engagement message" });
  const ev = buildTimeline({
    booking: base,
    server: [fail("2026-10-14T09:00:00Z"), fail("2026-10-14T09:15:00Z"), fail("2026-10-14T09:30:00Z")],
    client: { threads: { g1: [{ id: "x", dir: "out", text: "t", ts: T("2026-10-14T09:00:10Z"), via: "WhatsApp", bid: BID, rem: "guide" }] } },
  });
  const errs = ev.filter((e) => e.tone === "err");
  assert.equal(errs.length, 1);
  assert.match(errs[0].title, /non inviato \(WhatsApp\)/);
  assert.match(errs[0].detail!, /24 ore/);
  assert.match(errs[0].detail!, /3 tentativi/);
});

test("promemoria check-in dal cron (job checkin)", () => {
  const ev = buildTimeline({
    booking: base,
    server: [
      { src: "invii_log", at: "2026-10-14T16:00:00Z", job: "checkin", channel: "email", ok: true, detail: "promemoria check-in → mario@example.com" },
      { src: "invii_log", at: "2026-10-13T16:00:00Z", job: "checkin", channel: "email", ok: false, detail: "promemoria check-in → mario@example.com: errore HTTP 500" },
      { src: "invii_log", at: "2026-10-13T16:00:00Z", job: "pulizie", channel: "whatsapp", ok: true, detail: "x" },
    ],
  });
  assert.deepEqual(ev.filter((e) => e.kind === "msg_checkin").map((e) => e.title), ["Promemoria check-in non inviato (email)", "Promemoria check-in inviato (email)"]);
  assert.equal(ev.some((e) => e.source === "invii_log"), false);
  assert.equal(ev.length, 3); // creazione + 2 promemoria (il job pulizie non c'entra)
});

test("richiesta recensione dal campo sulla prenotazione e dalla chat: una riga", () => {
  const ts = T("2026-10-20T08:00:00Z");
  const ev = buildTimeline({
    booking: { ...base, reviewRequestedAt: ts + 3000, reviewRequestChannel: "email" } as never,
    client: { threads: { g1: [{ id: "auto:k:Email", dir: "out", text: "Lasci una recensione https://g.page/x", ts, via: "Email", bid: BID, rem: "review" }] } },
  });
  const r = ev.filter((e) => /recensione/i.test(e.title));
  assert.equal(r.length, 1);
  assert.equal(r[0].title, "Richiesta di recensione inviata (email)");
});

test("Alloggiati e ISTAT: il registro eventi vince sulle tabelle di lavoro, ma queste riempiono se manca", () => {
  const full = buildTimeline({
    booking: base,
    server: [
      { src: "booking_events", at: "2026-10-16T08:00:00Z", kind: "schedina", message: "Schedina Alloggiati inviata alla Questura" },
      { src: "alloggiati_schedine", at: "2026-10-16T08:00:01Z", stato: "inviata" },
      { src: "booking_events", at: "2026-10-17T08:00:00Z", kind: "istat", message: "Movimento ISTAT inviato" },
      { src: "istat_rows", at: "2026-10-17T08:00:02Z", stato: "sent" },
    ],
  });
  assert.deepEqual(full.filter((e) => e.kind === "alloggiati" || e.kind === "istat").map((e) => e.title), ["Schedina Alloggiati inviata alla Questura", "Movimento ISTAT inviato"]);
  const onlyTables = buildTimeline({
    booking: base,
    server: [
      { src: "alloggiati_schedine", at: "2026-10-16T08:00:01Z", stato: "inviata" },
      { src: "alloggiati_schedine", at: "2026-10-16T08:00:20Z", stato: "inviata" },
      { src: "istat_rows", at: "2026-10-17T08:00:02Z", stato: "sent" },
      { src: "alloggiati_schedine", at: "2026-10-15T08:00:00Z", stato: "da_validare", errorCount: 2, firstError: "Luogo di nascita mancante" },
      { src: "alloggiati_schedine", at: "2026-10-15T09:00:00Z", stato: "pronta" },
    ],
  });
  const a = onlyTables.filter((e) => e.kind === "alloggiati");
  assert.equal(a.length, 1);
  assert.equal(a[0].detail, "2 schedine");
  assert.equal(onlyTables.filter((e) => e.kind === "istat").length, 1);
  const warn = onlyTables.find((e) => e.kind === "alloggiati_warn")!;
  assert.equal(warn.tone, "warn");
  assert.equal(warn.detail, "Luogo di nascita mancante (+1)");
});

test("documenti: righe della tabella documents vincono sul registro eventi", () => {
  const rows = documentServerEvents({ doc_kind: "fattura", number_label: "12/2026", stato: "consegnata", created_at: "2026-10-18T08:00:00Z", issued_at: "2026-10-18T08:05:00Z", sent_at: "2026-10-18T08:06:00Z", delivered_at: "2026-10-18T08:07:00Z" });
  assert.equal(rows.length, 3);
  const ev = buildTimeline({ booking: base, server: [...rows, { src: "booking_events", at: "2026-10-18T08:05:01Z", kind: "documento", message: "Documento emesso n. 12/2026" }] });
  assert.deepEqual(ev.filter((e) => e.kind === "documento").map((e) => e.title), ["Fattura n. 12/2026 emessa", "Fattura n. 12/2026 inviata allo SdI", "Fattura n. 12/2026 consegnata (SdI)"]);
  // senza righe documents si usa il registro eventi
  const only = buildTimeline({ booking: base, server: [{ src: "booking_events", at: "2026-10-18T08:05:01Z", kind: "documento", message: "Documento SCARTATO dallo SdI" }] });
  const d = only.find((e) => e.kind === "documento")!;
  assert.equal(d.tone, "err");
  // bozza e scartato
  assert.equal(documentServerEvents({ doc_kind: "fattura", stato: "bozza", created_at: "2026-10-18T08:00:00Z" })[0].step, "draft");
  const rej = documentServerEvents({ doc_kind: "nota_di_credito", number_label: "1/2026", stato: "scartata", issued_at: "2026-10-18T08:05:00Z", updated_at: "2026-10-18T09:00:00Z" });
  assert.equal(rej[rej.length - 1].step, "rejected");
  const ev2 = buildTimeline({ booking: base, server: rej });
  assert.ok(titles(ev2).includes("Nota di credito n. 1/2026 emessa"));
  assert.ok(titles(ev2).includes("Nota di credito n. 1/2026 scartata dallo SdI"));
});

test("registro attività: solo se l'ospite ha una sola prenotazione viva", () => {
  const acts = [
    { ts: T("2026-10-01T08:15:20Z"), type: "booking", text: "Nuova prenotazione — Mario Rossi · booking" },
    { ts: T("2026-10-05T10:00:00Z"), type: "booking", text: "Prenotazione modificata — Mario Rossi (date, camera)" },
    { ts: T("2026-10-06T10:00:00Z"), type: "booking", text: "Prenotazione modificata — Luigi Bianchi (date)" },
    { ts: T("2026-10-07T10:00:00Z"), type: "config", text: "Camera modificata — 101" },
  ];
  const one = buildTimeline({ booking: base, guest: { fullName: "Mario Rossi" }, client: { activities: acts, guestHasOtherBookings: false } });
  assert.deepEqual(titles(one), ["Arrivata da Booking.com", "Prenotazione modificata"]);
  assert.equal(one[0].at, T("2026-10-01T08:15:20Z")); // l'ora arriva dal registro
  assert.equal(one[1].detail, "Cambiato: date, camera");
  const many = buildTimeline({ booking: base, guest: { fullName: "Mario Rossi" }, client: { activities: acts, guestHasOtherBookings: true } });
  assert.deepEqual(titles(many), ["Arrivata da Booking.com"]);
  const unknown = buildTimeline({ booking: base, guest: { fullName: "Mario Rossi" }, client: { activities: acts } });
  assert.deepEqual(titles(unknown), ["Arrivata da Booking.com"]);
});

test("richieste dell'ospite, spostamenti e offerte di extra", () => {
  const ev = buildTimeline({
    booking: {
      ...base,
      changeRequest: { at: "2026-10-08T10:00:00Z", ci: "2026-11-01", co: "2026-11-04", adults: 2, message: "Possiamo arrivare un giorno dopo?" },
      movedFrom: { structureId: "s0", structureName: "Spigole Rooms", at: "2026-10-09T10:00:00Z" },
      upsellOffers: [
        { id: "o1", at: T("2026-10-10T10:00:00Z"), via: "whatsapp", items: [{ extraId: "b", name: "Bici", qty: 1, amount: 10 }], total: 10, status: "accepted", decidedAt: T("2026-10-10T12:00:00Z") },
        { id: "o2", at: T("2026-10-11T10:00:00Z"), via: "diretto", items: [{ extraId: "t", name: "Transfer", qty: 1, amount: 120 }], total: 120, status: "accepted" },
      ],
    } as never,
  });
  assert.deepEqual(titles(ev), [
    "Arrivata da Booking.com",
    "L'ospite ha chiesto una modifica",
    "Spostata da Spigole Rooms",
    "Offerta di extra inviata (WhatsApp)",
    "Offerta di extra accettata",
    "Extra venduti di persona",
  ]);
  assert.equal(ev[1].detail, "01.11.2026 → 04.11.2026 · 2 adulti · «Possiamo arrivare un giorno dopo?»");
  assert.equal(ev[3].detail, "Bici (€ 10,00)");
});

test("ordine cronologico crescente e invarianza rispetto all'ordine degli ingressi", () => {
  const server = [
    { src: "booking_events" as const, at: "2026-10-16T08:00:00Z", kind: "istat", message: "Movimento ISTAT inviato" },
    { src: "channex_bookings" as const, at: "2026-10-01T08:15:00Z", status: "new" },
  ];
  const a = buildTimeline({ booking: base, server });
  const b = buildTimeline({ booking: base, server: [...server].reverse() });
  assert.deepEqual(titles(a), titles(b));
  const ms = a.map((e) => atMs(e.at)!);
  assert.deepEqual(ms, [...ms].sort((x, y) => x - y));
});

test("dati sporchi non fanno cadere la funzione", () => {
  const ev = buildTimeline({
    booking: { id: BID, upsellOffers: [{ at: NaN, via: "email", items: null }], stripeExtraPayments: [null, { amount: "x" }], changeRequest: {} } as never,
    server: [{ src: "invii_log", at: "non-una-data", job: "messaggi", channel: "email", ok: true } as never, { src: "sconosciuta" } as never],
    client: { threads: { g1: [null, { dir: "out" }, { dir: "out", ts: "x" }] as never }, msgsent: [null, { key: 5 }] as never, activities: [null, { ts: 1 }] as never },
  });
  assert.ok(Array.isArray(ev));
  assert.equal(snippet(undefined), "");
  assert.equal(snippet("vedi https://xenora.it/g/abc ora", 50), "vedi link ora");
});
