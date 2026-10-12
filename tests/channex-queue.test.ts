import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { channexFetch } from "../src/lib/channex-queue.ts";

// Il modulo non permette di iniettare l'orologio: i test usano i timer finti di node:test (setTimeout + Date),
// cosi' i ritardi (500 ms, 8 s, 60 s...) si "avanzano" senza aspettare davvero. Lo stato della finestra 20/min e'
// a livello di modulo: ogni test parte da un istante piu' avanti di 10 minuti, cosi' la finestra e' sempre vuota.
let clock = Date.UTC(2099, 0, 1, 12, 0, 0);
const settle = () => new Promise<void>((r) => setImmediate(r)); // svuota tutte le microtask in sospeso (setImmediate non e' finto)

type Reply = Response | Error;
function setup(replies: Reply[], random = 0) {
  clock += 10 * 60_000;
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: clock });
  const realFetch = globalThis.fetch;
  const realRandom = Math.random;
  const calls: { url: string; at: number }[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push({ url: String(url), at: Date.now() - clock });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    return r.clone();
  }) as typeof fetch;
  Math.random = () => random; // 0 = nessun jitter: i ritardi sono esattamente quelli di base
  const tick = async (ms: number) => { await settle(); mock.timers.tick(ms); await settle(); };
  const done = () => { globalThis.fetch = realFetch; Math.random = realRandom; mock.timers.reset(); };
  return { calls, tick, done };
}
const res = (status: number, headers: Record<string, string> = {}) => new Response("{}", { status, headers });

test("risposta 200: una sola chiamata, nessuna attesa", async () => {
  const t = setup([res(200)]);
  try {
    const p = channexFetch("https://x/api");
    await settle();
    assert.equal(t.calls.length, 1);
    assert.equal((await p).status, 200);
    assert.equal(t.calls[0].at, 0);
  } finally { t.done(); }
});

test("errori 4xx (tranne 429) NON si ritentano: 400, 401, 404, 422", async () => {
  for (const status of [400, 401, 404, 422]) {
    const t = setup([res(status), res(200)]);
    try {
      const p = channexFetch("https://x/api");
      await settle();
      const r = await p;
      assert.equal(r.status, status);
      assert.equal(t.calls.length, 1, `status ${status}`);
    } finally { t.done(); }
  }
});

test("500 poi 200: ritenta dopo 500 ms (backoff base) e restituisce il successo", async () => {
  const t = setup([res(500), res(200)]);
  try {
    const p = channexFetch("https://x/api");
    await settle();
    assert.equal(t.calls.length, 1);
    await t.tick(499);
    assert.equal(t.calls.length, 1, "prima dei 500 ms non deve riprovare");
    await t.tick(1);
    assert.equal(t.calls.length, 2);
    assert.equal((await p).status, 200);
    assert.equal(t.calls[1].at, 500);
  } finally { t.done(); }
});

test("backoff esponenziale 500, 1000, 2000, 4000 ms; dopo 5 tentativi restituisce l'ultima risposta 503 (senza lanciare errori)", async () => {
  const t = setup([res(503)]);
  try {
    const p = channexFetch("https://x/api");
    await settle();
    for (const ms of [500, 1000, 2000, 4000]) await t.tick(ms);
    const r = await p;
    assert.equal(r.status, 503);
    assert.equal(t.calls.length, 5);
    assert.deepEqual(t.calls.map((c) => c.at), [0, 500, 1500, 3500, 7500]);
    await t.tick(60_000);
    assert.equal(t.calls.length, 5, "dopo l'ultimo tentativo non ne partono altri");
  } finally { t.done(); }
});

test("il jitter allunga il ritardo fino al doppio del valore base ma mai oltre", async () => {
  const t = setup([res(500), res(200)], 0.999);
  try {
    const p = channexFetch("https://x/api");
    await settle();
    await t.tick(999);
    assert.equal(t.calls.length, 1, "500 + 0,999*500 = 999,5 ms: non ancora");
    await t.tick(1);
    assert.equal(t.calls.length, 2);
    await p;
  } finally { t.done(); }
});

test("429 con Retry-After in secondi: aspetta quanto richiesto (non il backoff)", async () => {
  const t = setup([res(429, { "retry-after": "3" }), res(200)]);
  try {
    const p = channexFetch("https://x/api");
    await settle();
    await t.tick(2999);
    assert.equal(t.calls.length, 1);
    await t.tick(1);
    assert.equal(t.calls.length, 2);
    assert.equal((await p).status, 200);
  } finally { t.done(); }
});

test("Retry-After enorme viene limitato a 60 secondi", async () => {
  const t = setup([res(429, { "retry-after": "3600" }), res(200)]);
  try {
    const p = channexFetch("https://x/api");
    await settle();
    await t.tick(59_999);
    assert.equal(t.calls.length, 1);
    await t.tick(1);
    assert.equal(t.calls.length, 2);
    await p;
  } finally { t.done(); }
});

test("Retry-After come data HTTP: aspetta fino a quella data", async () => {
  const replies: Reply[] = [];
  const t = setup(replies);
  try {
    const when = new Date(clock + 5000).toUTCString(); // le date HTTP hanno la precisione del secondo
    replies.push(res(429, { "retry-after": when }), res(200));
    const p = channexFetch("https://x/api");
    await settle();
    const wait = Date.parse(when) - Date.now();
    assert.ok(wait > 0 && wait <= 5000);
    await t.tick(wait - 1);
    assert.equal(t.calls.length, 1);
    await t.tick(1);
    assert.equal(t.calls.length, 2);
    await p;
  } finally { t.done(); }
});

test("Retry-After illeggibile -> backoff normale; Retry-After 0 o negativo -> riprova subito", async () => {
  const a = setup([res(429, { "retry-after": "boh" }), res(200)]);
  try {
    const p = channexFetch("https://x/api");
    await settle();
    await a.tick(499); assert.equal(a.calls.length, 1);
    await a.tick(1); assert.equal(a.calls.length, 2);
    await p;
  } finally { a.done(); }
  for (const h of ["0", "-5"]) {
    const b = setup([res(429, { "retry-after": h }), res(200)]);
    try {
      const p = channexFetch("https://x/api");
      await settle();
      await b.tick(0);
      assert.equal(b.calls.length, 2, `Retry-After ${h}`);
      await p;
    } finally { b.done(); }
  }
});

test("errore di rete: ritenta con backoff e poi riesce", async () => {
  const t = setup([new Error("ECONNRESET"), new Error("ETIMEDOUT"), res(200)]);
  try {
    const p = channexFetch("https://x/api");
    await settle();
    await t.tick(500); await t.tick(1000);
    assert.equal((await p).status, 200);
    assert.equal(t.calls.length, 3);
  } finally { t.done(); }
});

test("errore di rete persistente: dopo 5 tentativi l'errore viene rilanciato", async () => {
  const t = setup([new Error("ENOTFOUND")]);
  try {
    const p = channexFetch("https://x/api");
    const outcome = p.then(() => "ok", (e: Error) => e.message);
    await settle();
    for (const ms of [500, 1000, 2000, 4000]) await t.tick(ms);
    assert.equal(await outcome, "ENOTFOUND");
    assert.equal(t.calls.length, 5);
  } finally { t.done(); }
});

test("limite 20 richieste al minuto: le prime 20 partono subito, le altre aspettano la scadenza della finestra", async () => {
  const t = setup([res(200)]);
  try {
    const ps = Array.from({ length: 25 }, (_, i) => channexFetch(`https://x/api/${i}`));
    await settle();
    assert.equal(t.calls.length, 20);
    await t.tick(59_999);
    assert.equal(t.calls.length, 20, "ancora dentro la finestra di 60 s");
    await t.tick(1);
    assert.equal(t.calls.length, 25);
    await Promise.all(ps);
    assert.ok(t.calls.slice(20).every((c) => c.at === 60_000));
  } finally { t.done(); }
});

test("le richieste in coda partono nell'ordine in cui sono arrivate (FIFO)", async () => {
  const t = setup([res(200)]);
  try {
    const ps = Array.from({ length: 23 }, (_, i) => channexFetch(`https://x/api/${i}`));
    await settle();
    await t.tick(60_000);
    await Promise.all(ps);
    assert.deepEqual(t.calls.map((c) => c.url), Array.from({ length: 23 }, (_, i) => `https://x/api/${i}`));
  } finally { t.done(); }
});

test("finestra SCORREVOLE: 10 richieste a 0 s e 10 a 30 s, la 21esima parte a 60 s (quando esce la prima), non a 90 s", async () => {
  const t = setup([res(200)]);
  try {
    await Promise.all(Array.from({ length: 10 }, (_, i) => channexFetch(`https://x/a/${i}`)));
    await t.tick(30_000);
    await Promise.all(Array.from({ length: 10 }, (_, i) => channexFetch(`https://x/b/${i}`)));
    assert.equal(t.calls.length, 20);
    const p = channexFetch("https://x/c");
    await t.tick(29_999);
    assert.equal(t.calls.length, 20);
    await t.tick(1);
    assert.equal(t.calls.length, 21);
    assert.equal(t.calls[20].at, 60_000);
    await p;
  } finally { t.done(); }
});

test("anche i tentativi ripetuti contano nel limite di 20 al minuto", async () => {
  const t = setup([...Array.from({ length: 20 }, () => res(500)), res(200)]);
  try {
    // 4 richieste che falliscono sempre = 4 x 5 = 20 chiamate: la richiesta successiva deve attendere la finestra
    const ps = Array.from({ length: 4 }, (_, i) => channexFetch(`https://x/f/${i}`));
    await settle();
    for (const ms of [500, 1000, 2000, 4000]) await t.tick(ms);
    await Promise.all(ps);
    assert.equal(t.calls.length, 20);
    const extra = channexFetch("https://x/extra");
    await settle();
    assert.equal(t.calls.length, 20, "finestra piena: la 21esima chiamata aspetta");
    await t.tick(60_000);
    assert.equal(t.calls.length, 21);
    await extra;
  } finally { t.done(); }
});
