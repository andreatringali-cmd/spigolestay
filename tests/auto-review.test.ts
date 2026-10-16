import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReviewSettings, DEFAULT_REVIEW_SETTINGS, reviewLinksFor, reviewLinksBlock, reviewTokens, reviewDecision, usesReviewLinks, cleanUrl, oneLine, type ReviewSettings } from "../src/lib/auto-review.ts";
import { buildGuideUrl, roomCodes, structureWhatsapp, WHATSAPP_FALLBACK } from "../src/lib/auto-guide-link.ts";
import { stepsOfTemplate, stepOfTemplate, autoLineFor, type AutoCtx, type AutoTpl } from "../src/lib/auto-schedule.ts";
import { DEFAULT_TEMPLATES, mergeSeedTemplates } from "../src/lib/msg-templates.ts";

const S = (over: Partial<ReviewSettings> = {}): ReviewSettings => ({ ...DEFAULT_REVIEW_SETTINGS, ...over });
const ok = { status: "confirmed", channel: "direct" };

test("link: Google dal Place ID, poi dalla guida; il link scelto a mano vince; Tripadvisor solo se impostato", () => {
  const base = { structureId: "s1", settings: S() };
  assert.equal(reviewLinksFor({ ...base, placeId: "ChIJabc" }).google, "https://search.google.com/local/writereview?placeid=ChIJabc");
  assert.equal(reviewLinksFor({ ...base, guideReviewUrl: "https://g.page/r/xyz/review" }).google, "https://g.page/r/xyz/review");
  assert.equal(reviewLinksFor({ ...base, placeId: "ChIJabc", guideReviewUrl: "https://g.page/r/xyz/review" }).google.includes("writereview"), true);
  const own = S({ structures: { s1: { googleUrl: "https://g.page/mio", tripadvisorUrl: "https://www.tripadvisor.it/UserReviewEdit-g1" } } });
  const l = reviewLinksFor({ structureId: "s1", placeId: "ChIJabc", settings: own });
  assert.equal(l.google, "https://g.page/mio"); assert.equal(l.tripadvisor, "https://www.tripadvisor.it/UserReviewEdit-g1");
  assert.deepEqual(reviewLinksFor({ structureId: "altra", settings: own }), { google: "", tripadvisor: "" });
});

test("link: mai Booking, mai testo libero o schemi non http(s)", () => {
  const l = reviewLinksFor({ structureId: "s1", guideReviewUrl: "javascript:alert(1)", settings: S({ structures: { s1: { googleUrl: "not a link" } } }) });
  assert.deepEqual(l, { google: "", tripadvisor: "" });
  assert.equal(cleanUrl("  https://x.it/a  "), "https://x.it/a"); assert.equal(cleanUrl("https://x.it/a b"), "");
  const t = reviewTokens({ google: "https://g/1", tripadvisor: "https://t/2" });
  assert.equal(t.link_recensioni, "Google: https://g/1\nTripadvisor: https://t/2");
  assert.ok(!/booking/i.test(JSON.stringify(t)));
  assert.equal(reviewLinksBlock({ google: "", tripadvisor: "" }), "");
  assert.equal(oneLine(t.link_recensioni), "Google: https://g/1 · Tripadvisor: https://t/2"); // niente a capo nei valori dei modelli WhatsApp
});

test("regole di invio: solo prenotazioni confermate, non bloccate, non già sollecitate", () => {
  assert.equal(reviewDecision(ok, undefined, S()).send, true);
  for (const status of ["cancelled", "no_show", "tentative"]) assert.deepEqual(reviewDecision({ ...ok, status }, undefined, S()), { send: false, reason: "not_confirmed" });
  assert.deepEqual(reviewDecision({ ...ok, channel: "blocked" }, undefined, S()), { send: false, reason: "blocked" });
  assert.deepEqual(reviewDecision({ ...ok, reviewRequestedAt: 1760000000000 }, undefined, S()), { send: false, reason: "already_requested" });
});

test("ospiti «Da recuperare» esclusi sempre (anche con maiuscole diverse)", () => {
  assert.deepEqual(reviewDecision(ok, { tags: ["Famiglia", "da recuperare"] }, S()), { send: false, reason: "guest_tag" });
  assert.equal(reviewDecision(ok, { tags: ["Famiglia"] }, S()).send, true);
});

test("segnalazione di problemi: l'opzione è spenta di default, accesa salta chi ha reclami nelle note", () => {
  assert.equal(DEFAULT_REVIEW_SETTINGS.skipIfIssueNotes, false);
  const b = { ...ok, note: "L'ospite ha fatto un reclamo per il rumore" };
  assert.equal(reviewDecision(b, undefined, S()).send, true);
  assert.deepEqual(reviewDecision(b, undefined, S({ skipIfIssueNotes: true })), { send: false, reason: "issue_notes" });
  assert.deepEqual(reviewDecision(ok, { notes: "Camera sporca, chiesto rimborso" }, S({ skipIfIssueNotes: true })), { send: false, reason: "issue_notes" });
  assert.equal(reviewDecision({ ...ok, note: "Arrivo tardi, cena inclusa" }, undefined, S({ skipIfIssueNotes: true })).send, true);
});

test("canale Booking: nessun link Booking; saltato solo se l'host lo chiede", () => {
  const bk = { ...ok, channel: "booking" };
  assert.equal(reviewDecision(bk, undefined, S()).send, true);
  assert.deepEqual(reviewDecision(bk, undefined, S({ skipBookingChannel: true })), { send: false, reason: "booking_channel" });
  assert.equal(reviewDecision({ ...ok, channel: "airbnb" }, undefined, S({ skipBookingChannel: true })).send, true);
  // i link per un ospite Booking sono gli stessi di sempre (Google/Tripadvisor): il canale non aggiunge mai un link Booking
  assert.deepEqual(Object.keys(reviewLinksFor({ structureId: "s1", placeId: "x", settings: S() })).sort(), ["google", "tripadvisor"]);
});

test("impostazioni: lettura tollerante e valori di riserva", () => {
  assert.deepEqual(parseReviewSettings(null), DEFAULT_REVIEW_SETTINGS);
  assert.deepEqual(parseReviewSettings("{non json"), DEFAULT_REVIEW_SETTINGS);
  const p = parseReviewSettings(JSON.stringify({ skipIfIssueNotes: true, skipTags: [" VIP ", 3], structures: { a: { googleUrl: "https://g/1", tripadvisorUrl: "boh" }, b: "x" } }));
  assert.equal(p.skipIfIssueNotes, true); assert.deepEqual(p.skipTags, ["VIP"]); assert.deepEqual(p.structures, { a: { googleUrl: "https://g/1" } });
});

test("segnaposto dei link: riconosciuti come passaggio «recensione» e come bisognosi di un link", () => {
  assert.equal(usesReviewLinks("Grazie!\n{link_recensioni}"), true); assert.equal(usesReviewLinks("Grazie {ospite}"), false);
  const t: AutoTpl = { id: "r", trigger: "after_checkout", days: 1, active: true, texts: { it: "Grazie\n{link_recensioni}" } };
  assert.deepEqual(stepsOfTemplate(t), ["review"]); assert.equal(stepOfTemplate(t), "review");
});

test("i modelli d'esempio: recensione sincera con link, senza incentivi, in 5 lingue", () => {
  const rev = DEFAULT_TEMPLATES.find((d) => d.id === "seed-review")!;
  assert.equal(rev.trigger, "after_checkout"); assert.equal(rev.days, 1);
  for (const l of ["it", "en", "fr", "de", "es"] as const) {
    assert.match(rev.texts[l], /\{link_recensioni\}/);
    assert.doesNotMatch(rev.texts[l], /sconto|discount|gratis|free|offert|gift|rabais|rabatt|descuento|regalo|cadeau|geschenk|%|€/i);
  }
  for (const d of DEFAULT_TEMPLATES) for (const text of Object.values(d.texts)) assert.doesNotMatch(text, /channex/i);
});

test("pre-arrivo: check-in online + guida + come entrare (nessuna reception, WhatsApp) in tutte le lingue", () => {
  const pre = DEFAULT_TEMPLATES.find((d) => d.id === "seed-benvenuto-guida")!;
  assert.equal(pre.trigger, "before_arrival"); assert.equal(pre.days, 1); assert.equal(pre.active, true);
  for (const l of ["it", "en", "fr", "de", "es"] as const) {
    assert.match(pre.texts[l], /\{link_checkin\}/); assert.match(pre.texts[l], /\{link_guida\}/); assert.match(pre.texts[l], /WhatsApp \(\{whatsapp\}\)/);
  }
  // un solo messaggio copre sia il passaggio check-in sia la guida
  const t: AutoTpl = { id: pre.id, trigger: pre.trigger, days: pre.days, active: true, texts: pre.texts };
  assert.deepEqual(stepsOfTemplate(t), ["checkin", "guide"]);
  const NOW = Date.UTC(2026, 9, 6, 5, 0, 0);
  const ctx: AutoCtx = { now: NOW, templates: [t], messagesLive: true };
  const b = { structureId: "s1", checkIn: "2026-10-09", checkOut: "2026-10-11" };
  assert.equal(autoLineFor("guide", b, { email: "a@b.it" }, ctx, { today: "2026-10-06" })?.text, "Non inviato · invio previsto il 08.10 alle 10:00");
  assert.match(autoLineFor("checkin", b, { email: "a@b.it" }, ctx, { today: "2026-10-06" })?.text ?? "", /invio previsto/);
});

test("aggiornamento dei modelli d'esempio: solo se mai modificati, e si aggiungono quelli mancanti", () => {
  const legacy = { id: "seed-review", name: "Richiesta recensione", active: false, days: 5, texts: { it: "Grazie {ospite} per aver soggiornato a {struttura}! Se ti sei trovato bene, una recensione ci aiuterebbe tantissimo. A presto! 🙏", en: "Thank you {ospite} for staying at {struttura}! If you enjoyed it, a review would help us a lot. See you soon! 🙏", fr: "Merci {ospite} d'avoir séjourné à {struttura} ! Si vous avez apprécié, un avis nous aiderait beaucoup. À bientôt ! 🙏", de: "Danke {ospite} für Ihren Aufenthalt in {struttura}! Wenn es Ihnen gefallen hat, würde uns eine Bewertung sehr helfen. Bis bald! 🙏", es: "¡Gracias {ospite} por alojarte en {struttura}! Si te ha gustado, una reseña nos ayudaría mucho. ¡Hasta pronto! 🙏" } };
  const out = mergeSeedTemplates([legacy]);
  const r = out.find((x) => x.id === "seed-review")!;
  assert.match(r.texts.it, /\{link_recensioni\}/); assert.equal(r.active, false); assert.equal(r.days, 5); // cambiano solo i testi
  assert.equal(out.length, DEFAULT_TEMPLATES.length);                                                    // i mancanti si aggiungono
  const edited = { ...legacy, texts: { ...legacy.texts, it: "Il mio testo personale" } };
  assert.equal(mergeSeedTemplates([edited]).find((x) => x.id === "seed-review")!.texts.it, "Il mio testo personale");
  const crlf = { ...legacy, texts: { ...legacy.texts, it: legacy.texts.it.replace(/\n/g, "\r\n") + "\r\n" } };
  assert.match(mergeSeedTemplates([crlf]).find((x) => x.id === "seed-review")!.texts.it, /\{link_recensioni\}/);
});

test("link personale della guida costruito sul server (come guestlink.ts)", () => {
  const roomAccess = JSON.stringify({ u1: [{ label: "Portone", value: "1313" }, { label: "Porta", value: "11", cond: "noparking" }, { label: "Cancello", value: "99", cond: "parking" }] });
  const url = new URL(buildGuideUrl({ origin: "https://xenora.it/", structureId: "s1", guestName: "Mario Rossi", roomAccess, rooms: [{ unitId: "u1", unitCode: "4", parking: false }] }));
  assert.equal(url.origin + url.pathname, "https://xenora.it/guida/index.html");
  assert.equal(url.searchParams.get("p"), "s1"); assert.equal(url.searchParams.get("c"), "4"); assert.equal(url.searchParams.get("k"), "1313-11");
  assert.equal(url.searchParams.get("pk"), "0"); assert.equal(url.searchParams.get("g"), "Mario Rossi");
  const park = new URL(buildGuideUrl({ origin: "https://xenora.it", structureId: "s1", roomAccess, rooms: [{ unitId: "u1", unitCode: "4", parking: true }] }));
  assert.equal(park.searchParams.get("k"), "1313-99"); assert.equal(park.searchParams.get("pk"), "1"); assert.equal(park.searchParams.get("g"), null);
  const grp = new URL(buildGuideUrl({ origin: "https://xenora.it", structureId: "s1", roomAccess, rooms: [{ unitId: "u1", unitCode: "4" }, { unitId: "u2", unitCode: "5" }] }));
  assert.equal(grp.searchParams.get("c"), "4,5"); assert.deepEqual(JSON.parse(grp.searchParams.get("kr")!), [{ r: "4", c: [{ l: "Portone", v: "1313" }, { l: "Porta", v: "11" }] }, { r: "5", c: [] }]);
  assert.deepEqual(roomCodes("rotto", "u1", false), []);
});

test("numero WhatsApp della struttura con ripiego sensato", () => {
  assert.equal(structureWhatsapp({ whatsapp: " +39 333 1112233 ", phone: "0931" }), "+39 333 1112233");
  assert.equal(structureWhatsapp({ phone: "0931" }), "0931"); assert.equal(structureWhatsapp({}), "");
  assert.equal(WHATSAPP_FALLBACK.en, "this number");
});
