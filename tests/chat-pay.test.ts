import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planChatPayment, maxChatPayCents, parseEurInput, applyChatPayment, appendPaymentNotice, paymentNoticeText,
  chatPayGuestMessage, fmtEur, MIN_CHARGE_CENTS, type ChatPayContext, type ThreadMsg,
} from "../src/lib/chat-pay-core.ts";
import { signPayToken, verifyPayToken } from "../src/lib/chat-pay-token.ts";

// Prenotazione tipo: totale 500 €, già pagati 200 € → residuo 300 €, di cui tassa 12 €.
const ctx = (o: Partial<ChatPayContext> = {}): ChatPayContext => ({
  totalCents: 50000, balanceCents: 30000, cityTaxCents: 1200, cityTaxExempt: false, cityTaxPaid: false,
  stripeAccount: "acct_123", stripeChargesEnabled: true, ...o,
});

// ── importo: precompilato = residuo, mai oltre ───────────────────────────────

test("senza importo richiesto il link è per tutto il residuo", () => {
  const p = planChatPayment(ctx(), "saldo");
  assert.deepEqual(p, { ok: true, cents: 30000, maxCents: 30000 });
});

test("importo parziale modificabile verso il basso", () => {
  const p = planChatPayment(ctx(), "saldo", 120.5);
  assert.equal(p.ok && p.cents, 12050);
});

test("MAI oltre il residuo: errore, non troncamento silenzioso", () => {
  const p = planChatPayment(ctx(), "saldo", 300.01);
  assert.equal(p.ok, false);
  assert.equal(!p.ok && p.error, "amount_exceeds_balance");
  assert.equal(!p.ok && p.maxCents, 30000);
});

test("importo non valido o sotto il minimo Stripe", () => {
  for (const bad of [0, -5, NaN, Infinity]) {
    const p = planChatPayment(ctx(), "saldo", bad);
    assert.equal(!p.ok && p.error, "invalid_amount", String(bad));
  }
  const low = planChatPayment(ctx(), "saldo", 0.3);
  assert.equal(!low.ok && low.error, "amount_too_low");
  assert.equal(planChatPayment(ctx(), "saldo", MIN_CHARGE_CENTS / 100).ok, true);
});

test("saldo già pagato", () => {
  const p = planChatPayment(ctx({ balanceCents: 0 }), "saldo", 10);
  assert.equal(!p.ok && p.error, "already_paid");
});

test("prenotazione senza importo", () => {
  const p = planChatPayment(ctx({ totalCents: 0, balanceCents: 0 }), "saldo");
  assert.equal(!p.ok && p.error, "no_total");
});

test("Stripe non collegato per la struttura (account mancante o pagamenti non abilitati)", () => {
  assert.equal((planChatPayment(ctx({ stripeAccount: undefined }), "saldo") as { error?: string }).error, "stripe_not_connected");
  assert.equal((planChatPayment(ctx({ stripeChargesEnabled: false }), "saldo") as { error?: string }).error, "stripe_not_connected");
});

test("tassa di soggiorno: tetto = min(residuo, tassa); esente/non prevista/già incassata → errore", () => {
  assert.deepEqual(planChatPayment(ctx(), "tassa"), { ok: true, cents: 1200, maxCents: 1200 });
  assert.equal(maxChatPayCents(ctx({ balanceCents: 500 }), "tassa"), 500); // residuo più basso della tassa
  assert.equal((planChatPayment(ctx(), "tassa", 12.01) as { error?: string }).error, "amount_exceeds_balance");
  assert.equal((planChatPayment(ctx({ cityTaxCents: 0 }), "tassa") as { error?: string }).error, "no_city_tax");
  assert.equal((planChatPayment(ctx({ cityTaxExempt: true }), "tassa") as { error?: string }).error, "no_city_tax");
  assert.equal((planChatPayment(ctx({ cityTaxPaid: true }), "tassa") as { error?: string }).error, "tax_already_paid");
});

test("al click dell'ospite (clamp) il residuo sceso riduce l'importo ma non lo alza mai", () => {
  const down = planChatPayment(ctx({ balanceCents: 10000 }), "saldo", 300, { clamp: true });
  assert.equal(down.ok && down.cents, 10000);
  const same = planChatPayment(ctx(), "saldo", 120, { clamp: true });
  assert.equal(same.ok && same.cents, 12000); // non sale a 300 anche se il residuo lo permette
  const gone = planChatPayment(ctx({ balanceCents: 0 }), "saldo", 300, { clamp: true });
  assert.equal(!gone.ok && gone.error, "already_paid");
});

test("parseEurInput: virgola, migliaia, simbolo", () => {
  assert.equal(parseEurInput("120"), 120);
  assert.equal(parseEurInput("120,50"), 120.5);
  assert.equal(parseEurInput("1.200,50"), 1200.5);
  assert.equal(parseEurInput("€ 99.5"), 99.5);
  assert.equal(parseEurInput(""), null);
  assert.equal(parseEurInput("abc"), null);
  assert.equal(parseEurInput("12,345"), null);
  assert.equal(parseEurInput("-5"), null);
});

// ── registrazione incasso: idempotente ───────────────────────────────────────

const bk = () => ({ id: "b1", guestId: "g1", total: 500, paid: 200, paidSessions: ["cs_old"] } as Record<string, unknown>);
const base = { sessionId: "cs_new", cents: 12050, kind: "saldo" as const, balanceBeforeCents: 30000, cityTaxCents: 1200, now: 1000 };

test("incasso: paid aumenta, la sessione entra in paidSessions", () => {
  const r = applyChatPayment(bk(), base);
  assert.equal(r.applied, true);
  assert.equal(r.booking.paid, 320.5);
  assert.deepEqual(r.booking.paidSessions, ["cs_old", "cs_new"]);
  assert.equal(r.booking.updatedAt, 1000);
  assert.equal(r.balanceAfterCents, 17950);
  assert.equal(r.overpaidCents, 0);
  assert.equal(r.booking.cityTaxPaid, undefined); // saldo parziale: la tassa non è (ancora) incassata
});

test("IDEMPOTENZA: la stessa sessione non si registra due volte", () => {
  const first = applyChatPayment(bk(), base);
  const second = applyChatPayment(first.booking, base);
  assert.equal(second.applied, false);
  assert.equal(second.booking.paid, 320.5);
  assert.deepEqual(second.booking.paidSessions, ["cs_old", "cs_new"]);
  // anche contro una sessione vecchia già registrata (es. dalla pagina di ritorno del check-in)
  assert.equal(applyChatPayment(bk(), { ...base, sessionId: "cs_old" }).applied, false);
});

test("non muta la prenotazione in ingresso", () => {
  const b = bk();
  applyChatPayment(b, base);
  assert.equal(b.paid, 200);
  assert.deepEqual(b.paidSessions, ["cs_old"]);
});

test("saldo che azzera il residuo → tassa incassata; link tassa → tassa incassata", () => {
  const full = applyChatPayment(bk(), { ...base, cents: 30000 });
  assert.equal(full.booking.paid, 500);
  assert.equal(full.balanceAfterCents, 0);
  assert.equal(full.booking.cityTaxPaid, true);
  const tax = applyChatPayment(bk(), { ...base, kind: "tassa", cents: 1200 });
  assert.equal(tax.booking.cityTaxPaid, true);
  const exempt = applyChatPayment(bk(), { ...base, cents: 30000, cityTaxExempt: true });
  assert.equal(exempt.booking.cityTaxPaid, undefined);
  const noTax = applyChatPayment(bk(), { ...base, cents: 30000, cityTaxCents: 0 });
  assert.equal(noTax.booking.cityTaxPaid, undefined);
});

test("doppio pagamento (due link aperti): registra il reale e segnala l'eccedenza", () => {
  const r = applyChatPayment({ ...bk(), paid: 500, paidSessions: ["cs_a"] }, { ...base, cents: 5000, balanceBeforeCents: 0 });
  assert.equal(r.applied, true);
  assert.equal(r.booking.paid, 550);
  assert.equal(r.overpaidCents, 5000);
  assert.match(paymentNoticeText({ cents: 5000, kind: "saldo", balanceAfterCents: 0, overpaidCents: 5000 }), /Eccedenza/);
});

test("nessuna deriva dei float su più incassi con centesimi", () => {
  let b = { ...bk(), paid: 0.1, paidSessions: [] as string[] };
  b = applyChatPayment(b, { ...base, sessionId: "a", cents: 20, balanceBeforeCents: 100000 }).booking as typeof b;
  assert.equal(b.paid, 0.3);
});

test("sessione vuota o importo 0: niente da registrare", () => {
  assert.equal(applyChatPayment(bk(), { ...base, sessionId: "" }).applied, false);
  assert.equal(applyChatPayment(bk(), { ...base, cents: 0 }).applied, false);
});

// ── messaggio di sistema in chat ─────────────────────────────────────────────

test("messaggio 'Pagamento ricevuto': testo, id deterministico, dir out, idempotente", () => {
  const text = paymentNoticeText({ cents: 12050, kind: "saldo", balanceAfterCents: 17950 });
  assert.match(text, /Pagamento ricevuto € 120,50/);
  assert.match(text, /Resta da pagare € 179,50/);
  assert.match(paymentNoticeText({ cents: 30000, kind: "saldo", balanceAfterCents: 0 }), /saldata/);
  assert.match(paymentNoticeText({ cents: 1200, kind: "tassa", balanceAfterCents: 100 }), /tassa di soggiorno/);

  const threads: Record<string, ThreadMsg[]> = { g1: [{ id: "m1", dir: "in", text: "ciao", ts: 1 }] };
  const a = appendPaymentNotice(threads, "g1", { sessionId: "cs_new", text, ts: 5 });
  assert.equal(a.added, true);
  const m = a.threads.g1[1];
  assert.equal(m.id, "pay:cs_new");
  assert.equal(m.dir, "out"); // non conta come "da rispondere"
  assert.equal(m.sys, "payment");
  assert.equal(threads.g1.length, 1); // input non mutato
  const b = appendPaymentNotice(a.threads, "g1", { sessionId: "cs_new", text, ts: 9 });
  assert.equal(b.added, false);
  assert.equal(b.threads.g1.length, 2);
  // thread inesistente: lo crea
  assert.equal(appendPaymentNotice({}, "wa:39333", { sessionId: "s", text, ts: 1 }).threads["wa:39333"].length, 1);
});

test("messaggio all'ospite: importo e link in tutte le lingue", () => {
  for (const lang of ["it", "en", "fr", "de", "es"] as const) {
    for (const kind of ["saldo", "tassa"] as const) {
      const t = chatPayGuestMessage(lang, kind, 12050, "https://x.test/p?t=1");
      assert.ok(t.includes("€ 120,50"), `${lang}/${kind}`);
      assert.ok(t.includes("https://x.test/p?t=1"), `${lang}/${kind}`);
    }
  }
  assert.equal(fmtEur(123456), "€ 1234,56"); // it-IT: niente separatore sotto le 5 cifre
  assert.equal(fmtEur(1234567), "€ 12.345,67");
});

// ── token firmato ────────────────────────────────────────────────────────────

const SECRET = "test-secret-123";
const payload = { u: "user-1", b: "booking-1", k: "saldo" as const, c: 12050, e: 2_000_000_000 };

test("token: firma e verifica round-trip", () => {
  const tok = signPayToken(payload, SECRET);
  const v = verifyPayToken(tok, SECRET, 1_900_000_000);
  assert.equal(v.ok, true);
  assert.deepEqual(v.ok && v.payload, payload);
});

test("token: manomissione dell'importo/prenotazione o segreto sbagliato → rifiutato", () => {
  const tok = signPayToken(payload, SECRET);
  const [body, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify(["user-1", "booking-2", "saldo", 12050, 2_000_000_000])).toString("base64url");
  assert.equal((verifyPayToken(`${forged}.${sig}`, SECRET, 1) as { error?: string }).error, "bad_signature");
  const bigger = Buffer.from(JSON.stringify(["user-1", "booking-1", "saldo", 999999, 2_000_000_000])).toString("base64url");
  assert.equal((verifyPayToken(`${bigger}.${sig}`, SECRET, 1) as { error?: string }).error, "bad_signature");
  assert.equal((verifyPayToken(tok, "altro-segreto", 1) as { error?: string }).error, "bad_signature");
  assert.equal((verifyPayToken(`${body}.${sig.slice(0, -2)}xx`, SECRET, 1) as { error?: string }).error, "bad_signature");
});

test("token: scaduto o malformato", () => {
  const tok = signPayToken(payload, SECRET);
  assert.equal((verifyPayToken(tok, SECRET, 2_000_000_001) as { error?: string }).error, "expired");
  for (const bad of ["", "abc", ".", "a.b", "nodot"]) {
    assert.equal(verifyPayToken(bad, SECRET, 1).ok, false, bad);
  }
  // firma valida ma contenuto non conforme
  const body = Buffer.from(JSON.stringify(["u", "b", "rimborso", 100, 2_000_000_000])).toString("base64url");
  const sigOk = signPayToken(payload, SECRET).split(".")[1];
  assert.equal(verifyPayToken(`${body}.${sigOk}`, SECRET, 1).ok, false);
});
