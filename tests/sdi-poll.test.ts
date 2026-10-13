import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFicRef, selectDocsToPoll, emptyTally, addTally, tallyOutcome, shouldNotifyRejection, rejectionEmail, rejectionReason,
  SDI_POLL_LIMIT, SDI_POLL_MAX_AGE_DAYS, REJECTED_NOTIFIED_KIND, type PollCandidate,
} from "../src/lib/invoicing/sdi-status.ts";

const NOW = Date.parse("2026-10-13T07:30:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const cand = (id: string, o: Partial<PollCandidate> = {}): PollCandidate => ({ id, stato: "inviata_intermediario", provider: "fattureincloud", provider_ref: `fic:${id}`, sent_at: daysAgo(2), ...o });
const realSent = [{ kind: "sent", message: "Inviato", meta: { dry_run: false } }];
const trialSent = [{ kind: "sent", message: "Creata", meta: { dry_run: true } }];

test("isFicRef: solo riferimenti fic:", () => {
  assert.equal(isFicRef("fic:123"), true);
  assert.equal(isFicRef("fic:"), false);
  assert.equal(isFicRef("openapi:1"), false);
  assert.equal(isFicRef(null), false);
  assert.equal(isFicRef(""), false);
});

test("selezione: esclude prova, troppo vecchi, non-fic, altri stati e provider", () => {
  const list = [
    cand("ok", {}),
    cand("trial", {}),
    cand("old", { sent_at: daysAgo(SDI_POLL_MAX_AGE_DAYS + 1) }),
    cand("edge", { sent_at: daysAgo(SDI_POLL_MAX_AGE_DAYS - 1) }),
    cand("nofic", { provider_ref: "abc123" }),
    cand("openapi", { provider: "openapi" }),
    cand("deliv", { stato: "consegnata" }),
    cand("nosent", { sent_at: null }),
  ];
  const ev = { ok: realSent, trial: trialSent, old: realSent, edge: realSent, nofic: realSent, openapi: realSent, deliv: realSent, nosent: realSent };
  const r = selectDocsToPoll(list, ev, NOW);
  assert.deepEqual(r.selected.map((c) => c.id).sort(), ["edge", "ok"]);
  assert.equal(r.skippedTrial, 1);
  assert.equal(r.skippedOld, 1);
  assert.equal(r.skippedOther, 4);
});

test("selezione: vale l'ULTIMO invio (eventi dal più recente)", () => {
  const ev = { a: [{ kind: "sent", meta: { dry_run: false } }, { kind: "sent", meta: { dry_run: true } }], b: [{ kind: "sent", meta: { dry_run: true } }, { kind: "sent", meta: { dry_run: false } }] };
  const r = selectDocsToPoll([cand("a"), cand("b")], ev, NOW);
  assert.deepEqual(r.selected.map((c) => c.id), ["a"]);
});

test("selezione: limite 50, dai più recenti, il resto è conteggiato", () => {
  const list = Array.from({ length: 70 }, (_, i) => cand(`d${i}`, { sent_at: daysAgo(1 + i * 0.5) }));
  const r = selectDocsToPoll(list, {}, NOW);
  assert.equal(r.selected.length, SDI_POLL_LIMIT);
  assert.equal(r.skippedOverLimit, 20);
  assert.equal(r.selected[0].id, "d0");
  assert.equal(selectDocsToPoll(list, {}, NOW, { limit: 5 }).selected.length, 5);
});

test("conteggi: controllati, cambiati, scartati, consegnati, errori", () => {
  let t = emptyTally();
  t = tallyOutcome(t, { stato: "inviata_intermediario", changed: false });
  t = tallyOutcome(t, { stato: "consegnata", changed: true });
  t = tallyOutcome(t, { stato: "scartata", changed: true });
  t = tallyOutcome(t, null);
  assert.deepEqual(t, { checked: 4, changed: 2, rejected: 1, delivered: 1, errors: 1, notified: 0 });
  assert.equal(addTally(t, t).checked, 8);
  assert.equal(addTally(t, t).errors, 2);
});

test("avviso: una sola volta, solo se scartata e non già notificata", () => {
  assert.equal(shouldNotifyRejection([{ kind: "rejected", message: "Scartata dallo SdI: x" }]), true);
  assert.equal(shouldNotifyRejection([{ kind: REJECTED_NOTIFIED_KIND }, { kind: "rejected" }]), false);
  assert.equal(shouldNotifyRejection([{ kind: "sent" }]), false);
  assert.equal(shouldNotifyRejection([]), false);
});

test("email di scarto: testo in italiano con numero, data, cliente e motivo", () => {
  const reason = rejectionReason([{ kind: "rejected", message: "Scartata dallo SdI: 00305 Partita IVA non valida" }]);
  assert.equal(reason, "00305 Partita IVA non valida");
  const m = rejectionEmail({ numberLabel: "FT 12/2026", issueDate: "2026-10-05", customer: "Mario Rossi", reason });
  assert.equal(m.subject, "Fattura FT 12/2026 scartata dallo SdI");
  assert.match(m.text, /La fattura n\. FT 12\/2026 del 05\/10\/2026 a Mario Rossi è stata scartata dallo SdI: 00305 Partita IVA non valida\./);
  assert.match(m.text, /nota di credito \/ nuovo documento/);
  const bare = rejectionEmail({});
  assert.match(bare.text, /motivo non indicato/);
});
