import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const { exampleContentFrom } = await import("../src/lib/guide-example.ts");

// L'esempio vero della guida (quello del telefono «Esempio»): si esegue il file come fa il browser.
const win: { I18N?: { it?: any } } = {};
new Function("window", readFileSync(new URL("../public/guida/js/content/it.js", import.meta.url), "utf8"))(win);
const it = win.I18N!.it;
const out = exampleContentFrom(it, { home: { welcomeTitle: "", welcome: [] }, sections: [] }) as any;
const sec = (id: string) => out.sections.find((s: any) => s.id === id);

test("«Parti dall'esempio»: il benvenuto è identico all'esempio", () => {
  assert.equal(out.home.welcomeTitle, it.home.welcomeTitle);
  assert.deepEqual(out.home.welcome, it.home.welcome);
  assert.equal(out.home.welcomeSub, ""); // l'esempio non ha sottotitolo: non ne compare uno
});
test("«Parti dall'esempio»: stesso ordine di sezioni, stessi titoli, sottotitoli e introduzioni", () => {
  const order = it.groups.flatMap((g: any) => g.sections);
  assert.deepEqual(out.sections.map((s: any) => s.id), order);
  for (const s of it.sections) {
    const m = sec(s.id);
    assert.equal(m.title, s.title);
    assert.equal(m.sub, s.sub);
    if (!["wifi", "contacts", "review"].includes(s.id)) assert.equal(m.intro, s.intro ?? "");
  }
});
test("«Parti dall'esempio»: passaggi e blocchi con gli stessi testi (senza parcheggio riservato)", () => {
  const checkin = it.sections.find((s: any) => s.id === "checkin");
  const expected = checkin.steps.filter((st: any) => !st.parkOnly).map((st: any) => [st.h, st.p]);
  assert.deepEqual(sec("checkin").steps.map((st: any) => [st.h, st.p]), expected);
  assert.deepEqual(sec("checkin").items.map((i: any) => [i.h, i.p]), checkin.items.map((i: any) => [i.h, i.p]));
  assert.deepEqual(sec("checkin").amenities.map((a: any) => a.label), checkin.amenities.map((a: any) => a.label));
  assert.ok(sec("checkin").steps.some((st: any) => st.code === "door" && st.codeNote === "+ i 2 tasti laterali"));
});
