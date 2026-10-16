import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const W = await import("../src/lib/media-walk.ts");
const M = await import("../src/lib/media.ts");

const IMG = "data:image/jpeg;base64,/9j/AAAA";
const IMG2 = "data:image/png;base64,iVBORw0KGgo=";
const PDF = "data:application/pdf;base64,JVBERi0=";
const T = "11111111-1111-4111-8111-111111111111";
const F = "33333333-3333-4333-8333-333333333333";
const PUB = `media:xenora-public:u/${T}/${F}.jpg`;
const PRIV = `media:xenora-private:u/${T}/${F}.jpg`;

const sample = () => ({
  guests: [{ id: "g1", name: "Mario", docPhotoFront: IMG, docPhotoBack: IMG2 }, { id: "g2", docPhotoFront: "" }],
  bookings: [{ id: "b1", signature: IMG, extraGuests: [{ photoFront: PDF, photoBack: PUB }] }],
  note: "data:text/plain;base64,AAAA",
  n: 5, nul: null,
});

test("collectInlineImages: trova immagini e PDF con il percorso, ignora il resto", () => {
  const found = W.collectInlineImages(sample());
  assert.deepEqual(found.map((f: { path: unknown[] }) => f.path.join(".")), ["guests.0.docPhotoFront", "guests.0.docPhotoBack", "bookings.0.signature", "bookings.0.extraGuests.0.photoFront"]);
  assert.equal(found[3].uri, PDF);
  assert.deepEqual(W.collectInlineImages("data:image/gif;base64,R0lG"), [{ path: [], uri: "data:image/gif;base64,R0lG" }]);
  assert.deepEqual(W.collectInlineImages({ a: "https://x", b: [1, null, undefined] }), []);
  assert.deepEqual(W.collectInlineImages(null), []);
  const st = W.inlineImageStats(sample());
  assert.equal(st.count, 4);
  assert.equal(st.chars, IMG.length * 2 + IMG2.length + PDF.length);
});

test("collectInlineImages: tollera riferimenti circolari", () => {
  const a: Record<string, unknown> = { p: IMG };
  a.self = a;
  assert.equal(W.collectInlineImages(a).length, 1);
});

test("replaceInlineImages: sostituisce senza mutare l'input e conserva i rami non toccati", () => {
  const src = sample();
  const copy = JSON.stringify(src);
  const out = W.replaceInlineImages(src, (uri: string, path: unknown[]) => `REF(${path.join(".")}|${uri.slice(5, 14)})`);
  assert.equal(JSON.stringify(src), copy); // input intatto
  assert.equal(out.guests[0].docPhotoFront, "REF(guests.0.docPhotoFront|image/jpe)");
  assert.equal(out.bookings[0].extraGuests[0].photoBack, PUB); // un riferimento non viene toccato
  assert.equal(out.note, "data:text/plain;base64,AAAA");
  assert.equal(out.guests[1], src.guests[1]); // ramo senza modifiche = stesso oggetto
  assert.equal(W.collectInlineImages(out).length, 0);
});

test("replaceInlineImages: null/undefined lascia com'è; nessun cambiamento = stesso oggetto", () => {
  const src = sample();
  assert.equal(W.replaceInlineImages(src, () => null), src);
  assert.equal(W.replaceInlineImages(src, () => undefined), src);
  assert.equal(W.replaceInlineImages(IMG, () => "X"), "X");
  assert.deepEqual(W.replaceInlineImages([IMG, "a"], () => "X"), ["X", "a"]);
});

test("replaceInlineImagesAsync: una sola chiamata per data URI uguale, errori riportati e stringa lasciata", async () => {
  const calls: string[] = [];
  const src = { a: IMG, b: [IMG, IMG2], c: PDF };
  const r = await W.replaceInlineImagesAsync(src, async (uri: string) => {
    calls.push(uri);
    if (uri === IMG2) throw new Error("boom");
    return `ref:${uri.length}`;
  });
  assert.deepEqual(calls, [IMG, IMG2, PDF]); // IMG una volta sola
  assert.equal(r.value.a, `ref:${IMG.length}`);
  assert.equal(r.value.b[0], `ref:${IMG.length}`);
  assert.equal(r.value.b[1], IMG2); // fallita: resta la vecchia
  assert.equal(r.value.c, `ref:${PDF.length}`);
  assert.equal(r.replaced, 3); // occorrenze sostituite (a, b[0], c)
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].message, "boom");
  assert.deepEqual(src, { a: IMG, b: [IMG, IMG2], c: PDF });
});

test("replaceInlineImagesInJson: stringa JSON in, stringa JSON out; invariata se non cambia nulla", () => {
  const json = JSON.stringify({ heroBg: IMG, gallery: [IMG, "https://x/y.jpg"], tagline: "ciao" });
  const out = W.replaceInlineImagesInJson(json, () => "R");
  assert.deepEqual(JSON.parse(out), { heroBg: "R", gallery: ["R", "https://x/y.jpg"], tagline: "ciao" });
  const plain = JSON.stringify({ a: 1 });
  assert.equal(W.replaceInlineImagesInJson(plain, () => "R"), plain);
  assert.equal(W.replaceInlineImagesInJson("non json", () => "R"), "non json");
});

test("publicizeMediaRefs: riferimenti pubblici → URL assoluti, privati e data URI intatti", () => {
  const base = "https://abc.supabase.co";
  const v = { photos: [PUB, IMG, "https://x/y.jpg"], doc: PRIV, nested: { hero: PUB } };
  const out = W.publicizeMediaRefs(v, base);
  const url = M.publicUrlOf(PUB, base);
  assert.deepEqual(out, { photos: [url, IMG, "https://x/y.jpg"], doc: PRIV, nested: { hero: url } });
  assert.deepEqual(v.photos, [PUB, IMG, "https://x/y.jpg"]); // input intatto
  const json = JSON.stringify({ heroBg: PUB });
  assert.equal(W.publicizeMediaRefsInJson(json, base), JSON.stringify({ heroBg: url }));
  assert.equal(W.publicizeMediaRefsInJson("{}", base), "{}");
});
