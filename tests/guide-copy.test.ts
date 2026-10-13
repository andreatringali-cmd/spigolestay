import test from "node:test";
import assert from "node:assert/strict";
import { copyGuideContent, canCopyGuide } from "../src/lib/guide-copy.ts";

const src = {
  id: "A", name: "Casa A", city: "Siracusa", address: "Via Roma 1", phone: "+39 1", whatsapp: "+39 2", email: "a@a.it", mapsUrl: "http://m",
  wifiNetwork: "WifiA", wifiPassword: "pwA", wifiQr: "data:image/png;base64,AAA", wifiQrFor: "WifiA|pwA",
  checkinTime: "15:00", checkoutTime: "entro le 10", reviewUrl: "http://r", bookingUrl: "http://b",
  guideName: "Guida A", guideLogo: "data:logo", social: { instagram: "ig", facebook: "fb", website: "w" },
  roomTypes: { x: "Camera" }, accessCodes: { "1": "1234" },
  inviteMsg: "Benvenuto!", tv: { enabled: true, bg: "assets/bg.jpg", welcome: "Ciao", sections: ["wifi"], showGuest: true },
  content: { home: { welcome: ["Ciao"] }, sections: [{ id: "s", photos: ["assets/a.jpg"], items: [{ h: "H", p: "P" }] }] },
  i18n: { en: { home: { welcome: ["Hello"] }, sections: [] } },
};
const dst = { id: "B", name: "Casa B", wifiNetwork: "WifiB", content: undefined };

const FORBIDDEN = ["id", "name", "city", "address", "phone", "phoneGreta", "whatsapp", "email", "mapsUrl", "wifiNetwork", "wifiPassword", "wifiQr", "wifiQrFor",
  "checkinTime", "checkoutTime", "reviewUrl", "bookingUrl", "guideName", "guideLogo", "social", "roomTypes", "accessCodes", "roomaccess", "taxiPhone"];

test("il patch contiene solo content, i18n (e a richiesta tv/inviteMsg)", () => {
  const p = copyGuideContent(src, dst);
  assert.deepEqual(Object.keys(p).sort(), ["content", "i18n"]);
  const p2 = copyGuideContent(src, dst, { tv: true, inviteMsg: true });
  assert.deepEqual(Object.keys(p2).sort(), ["content", "i18n", "inviteMsg", "tv"]);
  for (const k of FORBIDDEN) assert.ok(!(k in p2), `campo non copiabile nel patch: ${k}`);
});

test("content, i18n e tv sono copie profonde, non riferimenti condivisi", () => {
  const p = copyGuideContent(src, dst, { tv: true }) as { content: typeof src.content; i18n: typeof src.i18n; tv: typeof src.tv };
  assert.deepEqual(p.content, src.content);
  assert.notEqual(p.content, src.content);
  assert.notEqual(p.content.sections, src.content.sections);
  assert.notEqual(p.content.sections[0].items, src.content.sections[0].items);
  assert.notEqual(p.i18n, src.i18n);
  assert.notEqual(p.i18n.en, src.i18n.en);
  assert.notEqual(p.tv, src.tv);
  assert.notEqual(p.tv.sections, src.tv.sections);
  p.content.sections[0].items[0].h = "MODIFICATO";
  p.tv.sections.push("x");
  assert.equal(src.content.sections[0].items[0].h, "H");
  assert.deepEqual(src.tv.sections, ["wifi"]);
});

test("senza opzioni tv e messaggio non vengono copiati; la sorgente non viene mutata", () => {
  const before = JSON.stringify(src);
  const p = copyGuideContent(src, dst);
  assert.ok(!("tv" in p));
  assert.ok(!("inviteMsg" in p));
  assert.equal(JSON.stringify(src), before);
});

test("messaggio vuoto o tv assente non finiscono nel patch; sorgente senza testi", () => {
  const p = copyGuideContent({ content: { a: 1 }, inviteMsg: "  " }, dst, { tv: true, inviteMsg: true });
  assert.deepEqual(Object.keys(p).sort(), ["content", "i18n"]);
  assert.equal(canCopyGuide({ inviteMsg: "x" }), false);
  assert.equal(canCopyGuide(src), true);
  assert.equal(canCopyGuide(undefined), false);
});

test("senza testi in sorgente le traduzioni non vengono copiate da sole", () => {
  const p = copyGuideContent({ i18n: { en: {} } }, dst);
  assert.deepEqual(p.i18n, {});
  assert.ok(!("content" in p));
});

import { guideHasText } from "../src/lib/guide-copy.ts";
test("guideHasText: scaffold vuoto = falso, testo reale = vero", () => {
  assert.equal(guideHasText({ home: { welcomeTitle: "", welcome: [""] }, sections: [{ items: [{ h: "", p: "" }] }] }), false);
  assert.equal(guideHasText(undefined), false);
  assert.equal(guideHasText(src.content), true);
  assert.equal(guideHasText({ home: { welcome: [] }, sections: [{ steps: [{ h: "x" }] }] }), true);
});
