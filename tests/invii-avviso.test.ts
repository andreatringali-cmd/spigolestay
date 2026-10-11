import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { decidiAvviso, puoRichiedere, chiaveAvviso, INTERVALLO_RICHIESTA_MS } = await import("../src/lib/invii-avviso.ts");

const NOW = Date.parse("2026-10-11T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();
const r = (job: string, channel: string, ok: boolean, h: number, detail = "") => ({ at: ago(h), job, channel, ok, detail });

test("nessun avviso se non ci sono righe o tutto è riuscito", () => {
  assert.equal(decidiAvviso([], NOW), null);
  assert.equal(decidiAvviso(null, NOW), null);
  assert.equal(decidiAvviso([r("pulizie", "email", true, 1), r("messaggi", "whatsapp", true, 2)], NOW), null);
});

test("avviso se l'ultimo invio di un job è fallito, con motivo spiegato e link", () => {
  const a = decidiAvviso([r("messaggi", "whatsapp", false, 1, "Benvenuto → 39347: (#131047) Re-engagement message")], NOW);
  assert.ok(a);
  assert.equal(a!.href, "/messaggi");
  assert.match(a!.motivo, /24 ore/);
  assert.equal(a!.titolo, "L'ultimo invio automatico non è arrivato");
  assert.equal(decidiAvviso([r("pulizie", "email", false, 1, "errore 500")], NOW)!.href, "/pulizie");
});

test("se dopo l'errore c'è un invio riuscito dello stesso job e canale, niente avviso", () => {
  const righe = [r("pulizie", "whatsapp", true, 1), r("pulizie", "whatsapp", false, 5, "x")];
  assert.equal(decidiAvviso(righe, NOW), null);
});

test("canali diversi dello stesso job sono separati: l'email riuscita non nasconde il WhatsApp fallito", () => {
  const a = decidiAvviso([r("messaggi", "email", true, 1), r("messaggi", "whatsapp", false, 2, "x: 131026 undeliverable")], NOW);
  assert.ok(a);
  assert.equal(a!.channel, "whatsapp");
});

test("errori più vecchi di 2 giorni o di job estranei vengono ignorati", () => {
  assert.equal(decidiAvviso([r("pulizie", "email", false, 49)], NOW), null);
  assert.ok(decidiAvviso([r("pulizie", "email", false, 47)], NOW));
  assert.equal(decidiAvviso([r("ota_msg", "email", false, 1)], NOW), null);
});

test("tra più errori si mostra il più recente; checkin porta a Messaggi", () => {
  const a = decidiAvviso([r("pulizie", "email", false, 10), r("checkin", "email", false, 2, "HTTP 500")], NOW);
  assert.equal(a!.job, "checkin");
  assert.equal(a!.href, "/messaggi");
});

test("chiusura ricordata fino a un errore diverso", () => {
  const e1 = r("pulizie", "email", false, 10, "a");
  const a1 = decidiAvviso([e1], NOW)!;
  assert.equal(decidiAvviso([e1], NOW, a1.key), null);
  const e2 = r("pulizie", "email", false, 1, "b");
  const a2 = decidiAvviso([e2, e1], NOW, a1.key);
  assert.ok(a2);
  assert.notEqual(a2!.key, a1.key);
  assert.equal(chiaveAvviso(e2), a2!.key);
});

test("motivo: per le email usa la parte dopo l'ultimo due punti; senza dettaglio lo dice", () => {
  assert.match(decidiAvviso([r("messaggi", "email", false, 1, "Modello → a@b.it: Resend: dominio non verificato")], NOW)!.motivo, /dominio non verificato$/);
  assert.match(decidiAvviso([r("pulizie", "email", false, 1, "")], NOW)!.motivo, /non è stato registrato/);
});

test("richieste al massimo una ogni 5 minuti", () => {
  assert.equal(puoRichiedere(null, NOW), true);
  assert.equal(puoRichiedere(NOW - 60_000, NOW), false);
  assert.equal(puoRichiedere(NOW - INTERVALLO_RICHIESTA_MS, NOW), true);
  assert.equal(puoRichiedere(NOW + 1000, NOW), true);
});
