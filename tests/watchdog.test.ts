import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";

// Watchdog con un database finto e un invio email finto: nessuna email reale, nessuna rete.
register("./helpers/stubs-loader.mjs", import.meta.url);
const W = await import("../src/lib/watchdog.ts");

const NOW = Date.parse("2026-10-22T10:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();

type Row = Record<string, unknown>;
interface Db { tables: Record<string, Row[]>; missing?: Set<string>; broken?: Set<string>; delayMs?: Record<string, number>; upserts: Row[][]; sentLog?: never }

function fake(db: Db): SupabaseClient {
  const from = (table: string) => {
    let ord: { col: string; asc: boolean } | null = null; let lim = Infinity; let head = false; let gte: [string, string] | null = null; let upsertRows: Row[] | null = null;
    const run = async (): Promise<{ data: unknown; error: { message: string; code?: string } | null; count?: number }> => {
      if (db.delayMs?.[table]) await new Promise((r) => setTimeout(r, db.delayMs![table]));
      if (db.missing?.has(table)) return { data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache`, code: "PGRST205" } };
      if (db.broken?.has(table)) return { data: null, error: { message: "connection terminated", code: "08006" } };
      if (upsertRows) { db.upserts.push(upsertRows); const t = (db.tables[table] ??= []); for (const r of upsertRows) { const i = t.findIndex((x) => x.key === r.key); if (i >= 0) t[i] = { ...t[i], ...r }; else t.push(r); } return { data: null, error: null }; }
      let rows = [...(db.tables[table] ?? [])];
      if (gte) rows = rows.filter((r) => String(r[gte![0]]) >= gte![1]);
      if (ord) { const { col, asc } = ord; rows.sort((a, z) => (String(a[col]) < String(z[col]) ? -1 : 1) * (asc ? 1 : -1)); }
      if (head) return { data: null, error: null, count: rows.length };
      return { data: rows.slice(0, lim), error: null };
    };
    const q = {
      select(_c?: string, o?: { head?: boolean }) { head = !!o?.head; return q; },
      order(c: string, o?: { ascending?: boolean }) { ord = { col: c, asc: o?.ascending !== false }; return q; },
      limit(n: number) { lim = n; return q; },
      gte(c: string, v: string) { gte = [c, v]; return q; },
      upsert(rows: Row[]) { upsertRows = rows; return q; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return run().then(res, rej); },
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const healthy = (): Db => ({
  tables: {
    app_state: [{ user_id: "u1" }],
    entities_verify_log: [{ at: ago(7), ok: true, summary: { bad: 0 } }],
    entities_sync_errors: [], entities_extra_errors: [],
    watchdog_state: [],
  },
  missing: new Set(["app_state_daily", "org_state_daily"]),
  upserts: [],
});

function sender() {
  const sent: { to: string; subject: string; html: string; text: string }[] = [];
  const send: import("../src/lib/watchdog.ts").SendFn = async (m) => { sent.push(m); return { ok: true }; };
  return { sent, send };
}
const ENV_ON = { WATCHDOG_ENABLED: "1", WATCHDOG_TO: "spigolehouse+collab1@gmail.com" };

test.beforeEach(() => W._resetMemoryThrottleForTests());

test("tutto a posto: nessun problema, nessuna email, copie giornaliere assenti non sono un errore", async () => {
  const s = sender();
  const r = await W.runWatchdog({ db: fake(healthy()), env: ENV_ON, send: s.send, now: () => NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
  assert.equal(s.sent.length, 0);
  assert.equal(r.checks.find((c) => c.id === "copie")!.status, "nd");
  assert.equal(r.checks.find((c) => c.id === "db")!.status, "ok");
});

test("senza interruttore WATCHDOG_ENABLED non invia nulla, anche con problemi: solo report", async () => {
  const d = healthy(); d.tables.entities_verify_log = [{ at: ago(60), ok: true, summary: {} }];
  const s = sender();
  const r = await W.runWatchdog({ db: fake(d), env: { WATCHDOG_TO: "x@y.test" }, send: s.send, now: () => NOW });
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].key, "verify_late");
  assert.equal(s.sent.length, 0);
  assert.equal(r.email.attempted, false);
  assert.match(r.email.skipped!, /WATCHDOG_ENABLED/);
  assert.equal(d.upserts.length, 0);
});

test("controllo notturno in ritardo: una email, poi niente per 6 ore, poi di nuovo", async () => {
  const d = healthy(); d.tables.entities_verify_log = [{ at: ago(40), ok: true, summary: {} }];
  const s = sender();
  const db = fake(d);
  const r1 = await W.runWatchdog({ db, env: ENV_ON, send: s.send, now: () => NOW });
  assert.equal(r1.email.sent, true);
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0].subject, /Attenzione/);
  assert.match(s.sent[0].text, /ritardo/);
  assert.equal(r1.email.to, "s***@gmail.com");
  // 5 ore dopo: ancora segnalato dal controllo ma niente email
  const r2 = await W.runWatchdog({ db, env: ENV_ON, send: s.send, now: () => NOW + 5 * 3600_000 });
  assert.equal(s.sent.length, 1);
  assert.deepEqual(r2.email.throttled, ["verify_late"]);
  assert.match(r2.email.skipped!, /6 ore/);
  // 6 ore e un minuto dopo: parte la seconda
  await W.runWatchdog({ db, env: ENV_ON, send: s.send, now: () => NOW + 6 * 3600_000 + 60_000 });
  assert.equal(s.sent.length, 2);
});

test("limite per TIPO di problema: un problema nuovo passa anche se un altro è già stato segnalato; una sola email con solo i nuovi", async () => {
  const d = healthy(); d.tables.entities_verify_log = [{ at: ago(40), ok: true, summary: {} }];
  const s = sender(); const db = fake(d);
  await W.runWatchdog({ db, env: ENV_ON, send: s.send, now: () => NOW });
  d.tables.entities_sync_errors = [{ at: ago(1) }, { at: ago(2) }];
  const r = await W.runWatchdog({ db, env: ENV_ON, send: s.send, now: () => NOW + 3600_000 });
  assert.equal(s.sent.length, 2);
  assert.deepEqual(r.email.due, ["sync_errors"]);
  assert.deepEqual(r.email.throttled, ["verify_late"]);
  assert.doesNotMatch(s.sent[1].text, /controllo notturno è in ritardo/);
  assert.match(s.sent[1].text, /2 errori di sincronizzazione/);
});

test("ultimo controllo notturno con differenze: urgente", async () => {
  const d = healthy(); d.tables.entities_verify_log = [{ at: ago(3), ok: false, summary: { bad: 4 } }];
  const s = sender();
  const r = await W.runWatchdog({ db: fake(d), env: ENV_ON, send: s.send, now: () => NOW });
  assert.equal(r.problems[0].key, "verify_bad");
  assert.equal(r.problems[0].severity, "crit");
  assert.match(s.sent[0].subject, /Problema da controllare/);
  assert.match(s.sent[0].text, /4 differenze/);
});

test("registro del controllo notturno vuoto: giallo; tabella assente: non è un problema", async () => {
  const d = healthy(); d.tables.entities_verify_log = [];
  assert.equal((await W.runWatchdog({ db: fake(d), env: {}, send: sender().send, now: () => NOW })).problems[0].key, "verify_never");
  const d2 = healthy(); d2.missing!.add("entities_verify_log");
  const r2 = await W.runWatchdog({ db: fake(d2), env: {}, send: sender().send, now: () => NOW });
  assert.deepEqual(r2.problems, []);
});

test("copie giornaliere: presenti e recenti = ok; ferme da 5 giorni = urgente; tabelle assenti = nessun controllo", async () => {
  const d = healthy(); d.missing = new Set();
  d.tables.app_state_daily = [{ day: "2026-10-21" }, { day: "2026-10-20" }];
  d.tables.org_state_daily = [{ day: "2026-10-21" }];
  const ok = await W.runWatchdog({ db: fake(d), env: {}, send: sender().send, now: () => NOW });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.checks.find((c) => c.id === "copie")!.status, "ok");

  d.tables.org_state_daily = [{ day: "2026-10-16" }];
  const late = await W.runWatchdog({ db: fake(d), env: {}, send: sender().send, now: () => NOW });
  assert.deepEqual(late.problems.map((p) => p.key), ["daily_org_late"]);
  assert.match(late.problems[0].text, /6 giorni/);

  d.tables.app_state_daily = [];
  const none = await W.runWatchdog({ db: fake(d), env: {}, send: sender().send, now: () => NOW });
  assert.ok(none.problems.some((p) => p.key === "daily_app_none"));
});

test("errori di sincronizzazione: solo quelli delle ultime 24 ore; 20 o più = urgente", async () => {
  const d = healthy();
  d.tables.entities_extra_errors = [{ at: ago(30) }, { at: ago(100) }];
  assert.deepEqual((await W.runWatchdog({ db: fake(d), env: {}, send: sender().send, now: () => NOW })).problems, []);
  d.tables.entities_extra_errors = Array.from({ length: 25 }, () => ({ at: ago(2) }));
  const r = await W.runWatchdog({ db: fake(d), env: {}, send: sender().send, now: () => NOW });
  assert.equal(r.problems[0].key, "extra_errors");
  assert.equal(r.problems[0].severity, "crit");
});

test("registri errori assenti: nessun problema", async () => {
  const d = healthy(); d.missing!.add("entities_sync_errors"); d.missing!.add("entities_extra_errors");
  const r = await W.runWatchdog({ db: fake(d), env: {}, send: sender().send, now: () => NOW });
  assert.deepEqual(r.problems, []);
  assert.equal(r.checks.find((c) => c.id === "errori")!.status, "nd");
});

test("database lento: avviso giallo; database che non risponde: urgente e gli altri controlli saltano", async () => {
  let t = NOW; const slowNow = () => (t += 3000); // ogni lettura del tempo avanza di 3 s: la lettura risulta lenta
  const rs = await W.runWatchdog({ db: fake(healthy()), env: {}, send: sender().send, now: slowNow });
  assert.equal(rs.problems.find((p) => p.key === "db_slow")?.severity, "warn");

  const d = healthy(); d.broken = new Set(["app_state"]);
  const s = sender();
  const r = await W.runWatchdog({ db: fake(d), env: ENV_ON, send: s.send, now: () => NOW });
  assert.equal(r.problems[0].key, "db_down");
  assert.equal(r.checks.find((c) => c.id === "altri")!.status, "nd");
  assert.equal(r.checks.some((c) => c.id === "verify"), false);
  // con il database giù lo stato non si può leggere: limite in memoria, un solo invio
  assert.equal(s.sent.length, 1);
  await W.runWatchdog({ db: fake(d), env: ENV_ON, send: s.send, now: () => NOW + 3600_000 });
  assert.equal(s.sent.length, 1);
});

test("database che non risponde entro il tempo massimo: urgente", async () => {
  const d = healthy(); d.delayMs = { app_state: 300 };
  const r = await W.runWatchdog({ db: fake(d), env: {}, send: sender().send, dbTimeoutMs: 50 });
  assert.equal(r.problems[0].key, "db_down");
  assert.match(r.problems[0].text, /nessuna risposta/);
});

test("tabella watchdog_state assente (0020 non applicata): non invia, lo dice", async () => {
  const d = healthy(); d.tables.entities_verify_log = [{ at: ago(60), ok: true, summary: {} }]; d.missing!.add("watchdog_state");
  const s = sender();
  const r = await W.runWatchdog({ db: fake(d), env: ENV_ON, send: s.send, now: () => NOW });
  assert.equal(s.sent.length, 0);
  assert.match(r.email.skipped!, /0020/);
});

test("invio fallito: nessun limite registrato, quindi si riprova al giro dopo", async () => {
  const d = healthy(); d.tables.entities_verify_log = [{ at: ago(60), ok: true, summary: {} }];
  let n = 0;
  const send: import("../src/lib/watchdog.ts").SendFn = async () => (++n === 1 ? { ok: false, error: "Resend 500" } : { ok: true });
  const db = fake(d);
  const r1 = await W.runWatchdog({ db, env: ENV_ON, send, now: () => NOW });
  assert.equal(r1.email.sent, false);
  assert.equal(r1.email.error, "Resend 500");
  assert.equal(d.upserts.length, 0);
  const r2 = await W.runWatchdog({ db, env: ENV_ON, send, now: () => NOW + 600_000 });
  assert.equal(r2.email.sent, true);
  assert.equal(d.upserts.length, 1);
  assert.equal(d.upserts[0][0].key, "verify_late");
});

test("destinatario: WATCHDOG_TO, altrimenti primo amministratore, altrimenti il titolare di ripiego", () => {
  assert.equal(W.ownerEmail({ WATCHDOG_TO: " a@b.test , c@d.test" }), "a@b.test");
  assert.equal(W.ownerEmail({ ADMIN_EMAILS: "x@y.test,z@y.test" }), "x@y.test");
  assert.equal(W.ownerEmail({}), "spigolehouse@gmail.com");
});

test("resendSender: senza chiave non chiama la rete; con chiave usa il fetch ricevuto (finto)", async () => {
  const calls: { url: string; body: string }[] = [];
  const fakeFetch = (async (url: string, init: { body: string }) => { calls.push({ url, body: init.body }); return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
  const noKey = await W.resendSender({}, fakeFetch)({ to: "a@b.test", subject: "s", html: "h", text: "t" });
  assert.equal(noKey.ok, false);
  assert.equal(calls.length, 0);
  const ok = await W.resendSender({ RESEND_API_KEY: "chiave-finta" }, fakeFetch)({ to: "a@b.test", subject: "s", html: "h", text: "t" });
  assert.equal(ok.ok, true);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(JSON.parse(calls[0].body).to[0], "a@b.test");
});

test("email: il testo del problema è scritto in HTML sicuro", () => {
  const m = W.buildEmail([{ key: "k", severity: "warn", text: "<script>x</script>" }], NOW);
  assert.doesNotMatch(m.html, /<script>/);
});

test("route: senza CRON_SECRET non fa nulla; senza intestazione giusta 401", async () => {
  delete process.env.CRON_SECRET;
  const route = await import("../src/app/api/cron/watchdog/route.ts");
  const a = await route.GET(new Request("https://x.test/api/cron/watchdog"));
  assert.equal((await a.json()).skipped, "no_secret");
  process.env.CRON_SECRET = "segreto-finto";
  const b = await route.GET(new Request("https://x.test/api/cron/watchdog"));
  assert.equal(b.status, 401);
  const c = await route.GET(new Request("https://x.test/api/cron/watchdog?secret=sbagliato"));
  assert.equal(c.status, 401);
  const d = await route.GET(new Request("https://x.test/api/cron/watchdog", { headers: { authorization: "Bearer sbagliato" } }));
  assert.equal(d.status, 401);
  // segreto giusto ma database non configurato: si ferma prima di toccare qualsiasi cosa
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const e = await route.GET(new Request("https://x.test/api/cron/watchdog", { headers: { authorization: "Bearer segreto-finto" } }));
  assert.equal((await e.json()).skipped, "supabase_not_configured");
  // Percorso completo con database finto: report JSON, nessuna email (interruttore spento), 503 solo con ?strict=1 e problema urgente.
  const dd = healthy(); dd.tables.entities_verify_log = [{ at: ago(1), ok: false, summary: { bad: 2 } }];
  const G = globalThis as unknown as { __stubs: { admin?: unknown } };
  G.__stubs.admin = fake(dd);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
  delete process.env.WATCHDOG_ENABLED;
  const f = await route.GET(new Request("https://x.test/api/cron/watchdog", { headers: { authorization: "Bearer segreto-finto" } }));
  assert.equal(f.status, 200);
  const rep = await f.json();
  assert.equal(rep.problems[0].key, "verify_bad");
  assert.equal(rep.email.attempted, false);
  const g = await route.GET(new Request("https://x.test/api/cron/watchdog?strict=1", { headers: { authorization: "Bearer segreto-finto" } }));
  assert.equal(g.status, 503);
  assert.equal(dd.upserts.length, 0);
  delete process.env.CRON_SECRET; delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
