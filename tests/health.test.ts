import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { classificaSalute, ultimiMessaggiWa, quantoFa, ENV_NAMES } = await import("../src/lib/health.ts");

const NOW = Date.parse("2026-10-12T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();
const r = (job: string, channel: string, ok: boolean, h: number, detail = "") => ({ at: ago(h), job, channel, ok, detail });
const envAll = ENV_NAMES.map((name) => ({ name, present: true, on: true }));
const base = () => ({
  invii: [] as ReturnType<typeof r>[],
  pulizieShareAt: null as string | null,
  channex: { enabled: true, maps: [] as { last_import_at?: string | null; name?: string }[], ping: "skipped" as const },
  whatsapp: { connected: true, lastInAt: null as number | null, lastOutAt: null as number | null },
  env: envAll,
});
const item = (rep: ReturnType<typeof classificaSalute>, id: string) => rep.sections.flatMap((s) => s.items).find((i) => i.id === id)!;

test("ultimo invio riuscito: verde", () => {
  const i = base(); i.invii = [r("messaggi", "whatsapp", true, 2)];
  const it = item(classificaSalute(i, NOW), "invii-messaggi-whatsapp");
  assert.equal(it.light, "ok");
  assert.match(it.text, /2 ore fa/);
});

test("ultimo invio fallito: rosso, con il motivo spiegato", () => {
  const i = base(); i.invii = [r("messaggi", "whatsapp", false, 1, "x (#131047) Re-engagement"), r("messaggi", "whatsapp", true, 30)];
  const it = item(classificaSalute(i, NOW), "invii-messaggi-whatsapp");
  assert.equal(it.light, "err");
  assert.match(it.text, /24 ore/);
});

test("errore molto vecchio (oltre 7 giorni): solo giallo", () => {
  const i = base(); i.invii = [r("checkin", "email", false, 24 * 10)];
  assert.equal(item(classificaSalute(i, NOW), "invii-checkin-email").light, "warn");
});

test("pulizie senza invii da più di 36 ore: giallo; entro 36 ore: verde", () => {
  const i = base(); i.invii = [r("pulizie", "email", true, 40)];
  assert.equal(item(classificaSalute(i, NOW), "invii-pulizie-email").light, "warn");
  i.invii = [r("pulizie", "email", true, 30)];
  assert.equal(item(classificaSalute(i, NOW), "invii-pulizie-email").light, "ok");
});

test("nessun invio registrato: grigio, non conta tra le cose da controllare", () => {
  const rep = classificaSalute(base(), NOW);
  assert.equal(item(rep, "invii-pulizie").light, "idle");
  assert.equal(item(rep, "cron-pulizie").light, "idle");
  assert.equal(rep.summary.attention, 0);
  assert.equal(rep.summary.headline, "Tutto a posto");
  assert.equal(rep.summary.light, "ok");
});

test("registro non leggibile: giallo", () => {
  const i = base(); (i as { invii: unknown }).invii = null;
  assert.equal(item(classificaSalute(i as never, NOW), "invii-registro").light, "warn");
});

test("cron pulizie: usa anche pulizie_share_log", () => {
  const i = base(); i.pulizieShareAt = ago(5);
  assert.equal(item(classificaSalute(i, NOW), "cron-pulizie").light, "ok");
  i.pulizieShareAt = ago(50);
  assert.equal(item(classificaSalute(i, NOW), "cron-pulizie").light, "warn");
});

test("Channex: import fresco verde, di 5 giorni giallo, di 20 giorni rosso, mai importato giallo", () => {
  const i = base();
  i.channex = { enabled: true, ping: "ok", maps: [{ last_import_at: ago(5), name: "A" }, { last_import_at: ago(24 * 5) }, { last_import_at: ago(24 * 20) }, { last_import_at: null }] };
  const rep = classificaSalute(i, NOW);
  assert.equal(item(rep, "channex-import-0").light, "ok");
  assert.equal(item(rep, "channex-import-1").light, "warn");
  assert.equal(item(rep, "channex-import-2").light, "err");
  assert.equal(item(rep, "channex-import-3").light, "warn");
  assert.match(item(rep, "channex-import-0").title, /A$/);
  assert.equal(item(rep, "channex-ping").light, "ok");
});

test("Channex: ping fallito o scaduto, chiave mancante con strutture collegate", () => {
  const i = base();
  i.channex = { enabled: true, ping: "timeout", maps: [{ last_import_at: ago(1) }] };
  assert.equal(item(classificaSalute(i, NOW), "channex-ping").light, "warn");
  i.channex = { enabled: true, ping: "fail", maps: [{ last_import_at: ago(1) }] };
  assert.equal(item(classificaSalute(i, NOW), "channex-ping").light, "err");
  i.channex = { enabled: false, ping: "skipped", maps: [{ last_import_at: ago(1) }] };
  assert.equal(item(classificaSalute(i, NOW), "channex-key").light, "err");
  i.channex = { enabled: false, ping: "skipped", maps: [] };
  assert.equal(item(classificaSalute(i, NOW), "channex-map").light, "idle");
});

test("WhatsApp: collegato, non collegato (con o senza invii WhatsApp), ultimi messaggi", () => {
  const i = base();
  i.whatsapp = { connected: true, lastInAt: NOW - 3 * 3600 * 1000, lastOutAt: null };
  let rep = classificaSalute(i, NOW);
  assert.equal(item(rep, "wa-link").light, "ok");
  assert.match(item(rep, "wa-in").text, /3 ore fa/);
  assert.equal(item(rep, "wa-out").light, "idle");
  i.whatsapp = { connected: false, lastInAt: null, lastOutAt: null };
  assert.equal(item(classificaSalute(i, NOW), "wa-link").light, "idle");
  i.invii = [r("messaggi", "whatsapp", true, 1)];
  rep = classificaSalute(i, NOW);
  assert.equal(item(rep, "wa-link").light, "warn");
});

test("variabili d'ambiente: presenti verdi, assenti secondo la gravità, mai i valori", () => {
  const i = base();
  i.env = envAll.map((e) => (["CRON_SECRET", "META_APP_SECRET", "ANTHROPIC_API_KEY", "AUTO_MESSAGES_LIVE"].includes(e.name) ? { name: e.name, present: false } : e));
  const rep = classificaSalute(i, NOW);
  assert.equal(item(rep, "env-CRON_SECRET").light, "err");
  assert.equal(item(rep, "env-META_APP_SECRET").light, "warn");
  assert.equal(item(rep, "env-ANTHROPIC_API_KEY").light, "idle");
  assert.equal(item(rep, "env-AUTO_MESSAGES_LIVE").light, "idle");
  assert.equal(item(rep, "env-RESEND_API_KEY").light, "ok");
  assert.equal(rep.summary.light, "err");
  assert.equal(rep.summary.attention, 2);
  assert.equal(rep.summary.headline, "2 cose da controllare");
  // interruttore impostato ma spento
  i.env = envAll.map((e) => (e.name === "ALLOGGIATI_LIVE" ? { name: e.name, present: true, on: false } : e));
  assert.match(item(classificaSalute(i, NOW), "env-ALLOGGIATI_LIVE").text, /spenta/);
});

test("riepilogo: una sola cosa da controllare", () => {
  const i = base(); i.invii = [r("checkin", "email", false, 1, "boom")];
  const rep = classificaSalute(i, NOW);
  assert.equal(rep.summary.headline, "1 cosa da controllare");
  assert.equal(rep.summary.light, "err");
});

test("ultimiMessaggiWa estrae solo gli istanti più recenti", () => {
  const json = JSON.stringify({ a: [{ id: "1", dir: "in", text: "ciao", ts: 100 }, { id: "2", dir: "out", text: "x", ts: 200 }], b: [{ id: "3", dir: "in", text: "y", ts: 300 }] });
  assert.deepEqual(ultimiMessaggiWa(json), { lastInAt: 300, lastOutAt: 200 });
  assert.deepEqual(ultimiMessaggiWa("non json"), { lastInAt: null, lastOutAt: null });
  assert.deepEqual(ultimiMessaggiWa(undefined), { lastInAt: null, lastOutAt: null });
});

test("quantoFa", () => {
  assert.equal(quantoFa(NOW - 30 * 1000, NOW), "pochi secondi fa");
  assert.equal(quantoFa(NOW - 5 * 60000, NOW), "5 minuti fa");
  assert.equal(quantoFa(NOW - 24 * 3600 * 1000, NOW), "1 giorno fa");
});
