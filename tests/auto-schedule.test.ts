import { test } from "node:test";
import assert from "node:assert/strict";
import { autoLineFor, whenText, slotDateOf, stepOfTemplate, instantAt, type AutoCtx, type AutoTpl } from "../src/lib/auto-schedule.ts";

// 6 ottobre 2026, 07:00 ora italiana (CEST = UTC+2) → 05:00 UTC
const NOW = Date.UTC(2026, 9, 6, 5, 0, 0);
const TODAY = "2026-10-06";
const guideTpl: AutoTpl = { id: "g", trigger: "before_arrival", days: 1, active: true, texts: { it: "Ecco la guida {link_guida}" } };
const reviewTpl: AutoTpl = { id: "r", name: "Richiesta recensione", trigger: "after_checkout", days: 1, active: true, texts: { it: "Grazie, una recensione ci aiuta" } };
const ctx = (over: Partial<AutoCtx> = {}): AutoCtx => ({ now: NOW, templates: [guideTpl, reviewTpl], messagesLive: true, alloggiatiLive: true, alloggiatiAuto: { s1: true }, ...over });
const bk = (checkIn: string, checkOut: string) => ({ structureId: "s1", checkIn, checkOut });
const guest = { email: "a@b.it", phone: "" };

test("ora italiana: i cron UTC diventano ora locale (estate +2)", () => {
  assert.equal(whenText(instantAt("2026-10-06", 8), NOW), "previsto alle 10:00");
  assert.equal(whenText(instantAt("2026-10-07", 8), NOW), "previsto domani alle 10:00");
  assert.equal(whenText(instantAt("2026-10-09", 8), NOW), "previsto il 9/10 alle 10:00");
  // d'inverno (CET, +1) lo stesso cron è alle 09:00
  assert.equal(whenText(instantAt("2026-12-10", 8), Date.UTC(2026, 11, 1, 5)), "previsto il 10/12 alle 09:00");
});

test("minuti: entro un'ora e mezza si dice 'tra X minuti'; passato = niente", () => {
  assert.equal(whenText(NOW + 25 * 60000, NOW), "tra 25 minuti");
  assert.equal(whenText(NOW + 60000, NOW), "tra 1 minuto");
  assert.equal(whenText(NOW - 1, NOW), null);
});

test("check-in: promemoria automatico il giorno prima alle 09:00 (07:00 UTC), anche con invio automatico spento", () => {
  const l = autoLineFor("checkin", bk("2026-10-08", "2026-10-10"), guest, ctx({ messagesLive: false }), { today: TODAY });
  assert.equal(l?.text, "Non inviato · invio previsto domani alle 09:00");
});

test("check-in con arrivo domani e promemoria delle 09:00 ancora da partire", () => {
  const l = autoLineFor("checkin", bk("2026-10-07", "2026-10-09"), guest, ctx(), { today: TODAY });
  assert.equal(l?.text, "Non inviato · invio previsto alle 09:00");
});

test("check-in vicino all'invio: 'tra X minuti'", () => {
  const now = Date.UTC(2026, 9, 6, 6, 35, 0); // 08:35 italiane, invio alle 09:00
  const l = autoLineFor("checkin", bk("2026-10-07", "2026-10-09"), guest, ctx({ now }), { today: TODAY });
  assert.equal(l?.text, "Non inviato · invio tra 25 minuti");
});

test("check-in senza email: avviso chiaro se l'arrivo è vicino", () => {
  const l = autoLineFor("checkin", bk("2026-10-07", "2026-10-09"), { email: "" }, ctx(), { today: TODAY });
  assert.equal(l?.tone, "warn"); assert.match(l!.text, /Nessuna email/);
});

test("già sollecitato: niente 'Non inviato'", () => {
  const l = autoLineFor("checkin", bk("2026-10-08", "2026-10-10"), guest, ctx(), { today: TODAY, wasSent: true });
  assert.equal(l?.text, "invio previsto domani alle 09:00");
});

test("guida: modello automatico attivo → data e ora del cron dei messaggi", () => {
  const l = autoLineFor("guide", bk("2026-10-09", "2026-10-11"), guest, ctx(), { today: TODAY });
  assert.equal(l?.text, "Non inviato · invio previsto il 8/10 alle 10:00");
});

test("invio automatico spento: non promette nulla, avvisa solo se manca poco", () => {
  const near = autoLineFor("guide", bk("2026-10-08", "2026-10-10"), guest, ctx({ messagesLive: false }), { today: TODAY });
  assert.equal(near?.text, "Non inviato · invio automatico in pausa");
  const far = autoLineFor("guide", bk("2026-11-20", "2026-11-22"), guest, ctx({ messagesLive: false }), { today: TODAY });
  assert.equal(far, null);
});

test("modello disattivato, di un'altra struttura o senza contatti: nessuna riga", () => {
  assert.equal(autoLineFor("guide", bk("2026-10-09", "2026-10-11"), guest, ctx({ templates: [{ ...guideTpl, active: false }] }), { today: TODAY }), null);
  assert.equal(autoLineFor("guide", bk("2026-10-09", "2026-10-11"), guest, ctx({ templates: [{ ...guideTpl, structureIds: ["altra"] }] }), { today: TODAY }), null);
  assert.equal(autoLineFor("guide", bk("2026-10-09", "2026-10-11"), {}, ctx(), { today: TODAY }), null);
});

test("invio già passato: nessuna riga (non si può dire 'previsto')", () => {
  assert.equal(autoLineFor("guide", bk("2026-10-06", "2026-10-08"), guest, ctx(), { today: TODAY }), null);
});

test("recensione dopo la partenza", () => {
  const l = autoLineFor("review", bk("2026-10-04", "2026-10-06"), guest, ctx(), { today: TODAY });
  assert.equal(l?.text, "Non inviato · invio previsto domani alle 10:00");
});

test("schedina Questura: invio automatico alle 23:00 se pronta e attivo", () => {
  const l = autoLineFor("alloggiati", bk("2026-10-04", "2026-10-08"), guest, ctx(), { today: TODAY, schedina: "pronta" });
  assert.equal(l?.text, "Invio automatico alla Questura: alle 23:00");
  assert.equal(autoLineFor("alloggiati", bk("2026-10-04", "2026-10-08"), guest, ctx({ alloggiatiAuto: {} }), { today: TODAY, schedina: "pronta" }), null);
  assert.equal(autoLineFor("alloggiati", bk("2026-10-04", "2026-10-08"), guest, ctx({ alloggiatiLive: false }), { today: TODAY, schedina: "pronta" }), null);
  assert.equal(autoLineFor("alloggiati", bk("2026-10-04", "2026-10-08"), guest, ctx(), { today: TODAY, schedina: "inviata" }), null);
});

test("classificazione dei modelli e giorno di partenza", () => {
  assert.equal(stepOfTemplate({ id: "x", trigger: "before_arrival", days: 3, active: true, texts: { it: "compila {link_checkin}" } }), "checkin");
  assert.equal(stepOfTemplate({ id: "x", trigger: "before_arrival", days: 3, active: true, texts: { it: "ciao" } }), null);
  assert.equal(slotDateOf({ trigger: "before_arrival", days: 2 }, "2026-10-10", "2026-10-12"), "2026-10-08");
  assert.equal(slotDateOf({ trigger: "after_checkout", days: 1 }, "2026-10-10", "2026-10-12"), "2026-10-13");
  assert.equal(slotDateOf({ trigger: "manual", days: 1 }, "2026-10-10", "2026-10-12"), null);
});
