import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// whatsapp.ts importa "@/lib/..." : li risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const { sendWhatsapp } = await import("../src/lib/whatsapp.ts");

// Finto client Supabase: restituisce sempre credenziali WhatsApp valide (token in chiaro = valore "legacy").
const fakeAdmin = {
  from() {
    const q: Record<string, unknown> = {};
    q.select = () => q; q.eq = () => q;
    q.maybeSingle = async () => ({ data: { config: { token_enc: "TOKEN", phone_id: "PHONE" } } });
    return q;
  },
} as never;

type Call = { url: string; body: Record<string, unknown> };
type Reply = { status: number; json: unknown };

// Sostituisce fetch con una sequenza di risposte e registra le chiamate.
async function withFetch(replies: Reply[], fn: (calls: Call[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json } as Response;
  }) as typeof fetch;
  try { await fn(calls); } finally { globalThis.fetch = original; }
}

const OK: Reply = { status: 200, json: { messages: [{ id: "wamid.123" }] } };
const err = (code: number, message: string, status = 400): Reply => ({ status, json: { error: { code, message } } });
const langOf = (c: Call) => (c.body.template as { language: { code: string } }).language.code;
const base = { to: "393473824353", templateName: "planning_pulizie", params: ["x"] };

test("modello: al primo tentativo usa la lingua richiesta", async () => {
  await withFetch([OK], async (calls) => {
    const r = await sendWhatsapp(fakeAdmin, "t1", { ...base, lang: "fr" });
    assert.equal(r.ok, true);
    assert.equal(r.id, "wamid.123");
    assert.equal(calls.length, 1);
    assert.equal(langOf(calls[0]), "fr");
  });
});

test("modello: dopo l'errore 132001 riprova con le altre lingue (it, poi en)", async () => {
  await withFetch([err(132001, "Template name does not exist in the translation"), err(132001, "x"), OK], async (calls) => {
    const r = await sendWhatsapp(fakeAdmin, "t1", { ...base, lang: "fr" });
    assert.equal(r.ok, true);
    assert.deepEqual(calls.map(langOf), ["fr", "it", "en"]);
  });
});

test("modello: con lingua it riprova con en e en_US senza ripetere it", async () => {
  await withFetch([err(132001, "no"), err(132001, "no"), err(132001, "no")], async (calls) => {
    const r = await sendWhatsapp(fakeAdmin, "t1", { ...base, lang: "it" });
    assert.equal(r.ok, false);
    assert.deepEqual(calls.map(langOf), ["it", "en", "en_US"]);
    assert.equal(r.message, "no"); // l'errore mostrato è quello del primo tentativo
  });
});

test("modello: un errore diverso da 132001 non fa nessuna riprova", async () => {
  await withFetch([err(131026, "Message undeliverable"), OK], async (calls) => {
    const r = await sendWhatsapp(fakeAdmin, "t1", { ...base, lang: "it" });
    assert.equal(r.ok, false);
    assert.equal(r.message, "Message undeliverable");
    assert.equal(calls.length, 1);
  });
});

test("testo libero: un solo tentativo, anche con errore 132001", async () => {
  await withFetch([err(132001, "Template name does not exist"), OK], async (calls) => {
    const r = await sendWhatsapp(fakeAdmin, "t1", { to: "393473824353", text: "ciao" });
    assert.equal(r.ok, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.type, "text");
  });
});

test("testo libero riuscito: un solo tentativo e id restituito", async () => {
  await withFetch([OK], async (calls) => {
    const r = await sendWhatsapp(fakeAdmin, "t1", { to: "393473824353", text: "ciao" });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
  });
});
