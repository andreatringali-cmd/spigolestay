import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
// Invio REALE acceso (con SOAP finto via fetch): serve a provare ordine dei record, tabelle vuote, Test che lancia, race con syncSchedine, stato dell'archivio.
process.env.ALLOGGIATI_LIVE = "1";
const svc = await import("../src/lib/alloggiati/service.ts");
const { todayRome, addDaysYmd } = await import("../src/lib/dates-rome.ts");

type Row = Record<string, unknown>;
function makeClient(tables: Record<string, Row[]>) {
  const t = structuredClone(tables);
  const from = (name: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "delete" | "insert" | "update" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let sortBy: string[] = [];
    const q: Record<string, unknown> = {
      select: () => q,
      order: (c: string) => { sortBy.push(c); return q; },
      delete: () => { mode = "delete"; return q; },
      update: (p: Row) => { mode = "update"; patch = p; return q; },
      insert: (p: Row | Row[]) => { mode = "insert"; payload = (Array.isArray(p) ? p : [p]).map((r) => ({ id: `gen-${Math.random().toString(36).slice(2, 8)}`, ...r })); return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
      lte: (c: string, v: string) => { filters.push((r) => String(r[c]) <= v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      range: (a: number) => { if (a > 0) filters.push(() => false); return q; },
      single: async () => { if (mode === "insert") (t[name] ??= []).push(...structuredClone(payload)); return { data: payload[0] ?? null, error: null }; },
      maybeSingle: async () => ({ data: (t[name] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        const rs = (t[name] ??= []);
        if (mode === "insert") { rs.push(...structuredClone(payload)); return Promise.resolve({ data: payload, error: null }).then(res); }
        if (mode === "delete") { t[name] = rs.filter((r) => !filters.every((f) => f(r))); return Promise.resolve({ data: null, error: null }).then(res); }
        if (mode === "update") { for (const r of rs) if (filters.every((f) => f(r))) Object.assign(r, patch); return Promise.resolve({ data: null, error: null }).then(res); }
        let out = rs.filter((r) => filters.every((f) => f(r))).map((r) => structuredClone(r));
        for (const c of [...sortBy].reverse()) out = out.sort((a, b) => String(a[c]).localeCompare(String(b[c])));
        return Promise.resolve({ data: out, error: null }).then(res);
      },
    };
    return q;
  };
  return { client: { from }, tables: t };
}

const codeRows: Row[] = [
  { kind: "luoghi", code: "100000100", name_norm: "ITALIA", provincia: "ES", is_comune: true },
  { kind: "luoghi", code: "405058091", name_norm: "ROMA", provincia: "RM", is_comune: true },
  { kind: "luoghi", code: "405089017", name_norm: "SIRACUSA", provincia: "SR", is_comune: true },
  { kind: "documenti", code: "IDENT", name_norm: "CARTA IDENTITA", provincia: null, is_comune: false },
];
const arrival = addDaysYmd(todayRome(), -1);
const g = (n: string, over: Row = {}) => ({ cognome: "Rossi", nome: n, sesso: "M", dataNascita: "1980-01-01", comuneNascita: "Roma", cittadinanza: "Italiana", tipoDoc: "Carta d'identità", numeroDoc: "AA1", luogoRilascio: "Siracusa", perm: 2, ...over });
const row = (id: string, booking: string, ruolo: string, ref: string, over: Row = {}) => ({ id, tenant_id: "t1", structure_id: "s1", booking_id: booking, guest_ref: ref, stato: "pronta", arrival, ruolo, guest: g(id), ...over });
const settings = { tenant_id: "t1", structure_id: "s1", username: "u", password_enc: "p", ws_code_enc: "w" };

const okDett = (n: number) => `<result><SchedineValide>${n}</SchedineValide><Dettaglio>${Array.from({ length: n }, () => "<EsitoOperazioneServizio><esito>true</esito></EsitoOperazioneServizio>").join("")}</Dettaglio></result>`;
type Calls = { method: string; records: string[] }[];
function stubFetch(opts: { testThrows?: boolean; beforeSend?: () => void } = {}): Calls {
  const calls: Calls = [];
  (globalThis as { fetch: unknown }).fetch = async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    const method = /"AlloggiatiService\/(\w+)"/.exec(init.headers.SOAPAction)![1];
    const records = [...init.body.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    calls.push({ method, records });
    let xml = "";
    if (method === "GenerateToken") xml = "<GenerateTokenResult><issued>a</issued><expires>b</expires><token>TOK</token></GenerateTokenResult><result><esito>true</esito></result>";
    else if (method === "Test") { if (opts.testThrows) throw new Error("rete assente"); xml = `<TestResult><esito>true</esito></TestResult>${okDett(records.length)}`; }
    else if (method === "Send") { opts.beforeSend?.(); xml = `<SendResult><esito>true</esito></SendResult>${okDett(records.length)}`; }
    return { ok: true, text: async () => xml };
  };
  return calls;
}

test.beforeEach(() => svc.resetCodeMapsCache());

test("#13 tabelle dei codici vuote → nessun invio, messaggio chiaro", async () => {
  const env = makeClient({ alloggiati_schedine: [row("r1", "B1", "16", "primary")], alloggiati_settings: [settings], alloggiati_codes: [] });
  const calls = stubFetch();
  const r = await svc.sendReady(env.client as never, "t1", "s1");
  assert.equal(r.ok, false);
  assert.match(r.message, /Scarica prima le tabelle codici/);
  assert.equal(r.sent, 0);
  assert.equal(calls.filter((c) => c.method === "Send").length, 0);
  assert.equal(env.tables.alloggiati_schedine[0].stato, "pronta");
});

test("#13 se il Test del portale lancia, il Send NON parte e in archivio non resta una riga di errore", async () => {
  const env = makeClient({ alloggiati_schedine: [row("r1", "B1", "16", "primary")], alloggiati_settings: [settings], alloggiati_codes: codeRows, alloggiati_submissions: [] });
  const calls = stubFetch({ testThrows: true });
  const r = await svc.sendReady(env.client as never, "t1", "s1");
  assert.equal(r.ok, false);
  assert.match(r.message, /Controllo preliminare del portale non riuscito/);
  assert.equal(calls.filter((c) => c.method === "Send").length, 0);
  assert.equal(env.tables.alloggiati_schedine[0].stato, "pronta"); // si riprova al prossimo giro
  assert.equal(env.tables.alloggiati_submissions.length, 0); // niente righe "error" duplicate ogni sera
});

test("#10 #12 #14 invio: capofamiglia prima dei familiari; riga rigenerata da sync nel frattempo viene segnata inviata; archivio 'sent' anche con invio parziale", async () => {
  const env = makeClient({
    alloggiati_schedine: [
      row("fam19", "B1", "19", "extra:0", { guest: g("Figlio", { tipoDoc: "", numeroDoc: "", luogoRilascio: "" }) }),
      row("cap17", "B1", "17", "primary"),
      row("bad", "B2", "16", "primary", { stato: "da_validare", errors: ["Cognome mancante"] }),
      row("ok16", "B3", "16", "primary"),
    ],
    alloggiati_settings: [settings], alloggiati_codes: codeRows, alloggiati_submissions: [],
  });
  const calls = stubFetch({
    // race: mentre il portale risponde, syncSchedine rigenera la riga del capofamiglia (id nuovo, ancora "pronta")
    beforeSend: () => {
      env.tables.alloggiati_schedine = env.tables.alloggiati_schedine.filter((r) => r.id !== "cap17");
      env.tables.alloggiati_schedine.push(row("cap17-new", "B1", "17", "primary"));
    },
  });
  const r = await svc.sendReady(env.client as never, "t1", "s1");
  const send = calls.find((c) => c.method === "Send")!;
  assert.deepEqual(send.records.map((x) => x.slice(0, 2)), ["17", "19", "16"]); // B1: 17 poi 19 consecutivi; poi B3
  assert.equal(r.sent, 3);
  assert.equal(env.tables.alloggiati_schedine.find((x) => x.id === "cap17-new")!.stato, "inviata");
  assert.equal(env.tables.alloggiati_schedine.filter((x) => x.stato === "pronta").length, 0);
  assert.equal(env.tables.alloggiati_submissions.length, 1);
  assert.equal(env.tables.alloggiati_submissions[0].stato, "sent");
});

test("#14 niente da inviare (famiglie incomplete): nessuna riga in archivio", async () => {
  const env = makeClient({
    alloggiati_schedine: [row("a", "B1", "17", "primary"), row("b", "B1", "19", "extra:0", { stato: "da_validare" })],
    alloggiati_settings: [settings], alloggiati_codes: codeRows, alloggiati_submissions: [],
  });
  const calls = stubFetch();
  const r = await svc.sendReady(env.client as never, "t1", "s1");
  assert.equal(r.sent, 0);
  assert.equal(calls.filter((c) => c.method === "Send").length, 0);
  assert.equal(env.tables.alloggiati_submissions.length, 0);
});
