import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanScore, normalizeCategoryKey, normalizeReviewScores, normalizeScoreSummary,
  parseDetailedScores, mergeSummaries, summarizeFromReviews, channelOfOta,
} from "../src/lib/channex-review-scores.ts";

test("normalizeReviewScores: array documentato [{category, score}] (esempio Booking.com)", () => {
  const r = normalizeReviewScores([
    { category: "value", score: 9 }, { category: "clean", score: 10 }, { category: "location", score: 8.5 },
    { category: "staff", score: 10 }, { category: "comfort", score: 9 }, { category: "facilities", score: 7 },
  ]);
  assert.deepEqual(r.map((x) => x.key), ["clean", "location", "staff", "facilities", "comfort", "value"]);
  assert.equal(r[0].label, "Pulizia");
  assert.equal(r[1].score, 8.5);
});

test("normalizeReviewScores: Airbnb (cleanliness→clean, checkin, communication, accuracy)", () => {
  const r = normalizeReviewScores([
    { category: "cleanliness", score: 10 }, { category: "accuracy", score: 9 },
    { category: "check-in", score: 10 }, { category: "communication", score: 10 }, { category: "value", score: 8 },
  ]);
  assert.deepEqual(r.map((x) => x.key), ["clean", "value", "accuracy", "communication", "checkin"]);
});

test("normalizeReviewScores: niente dati inventati (null, stringhe vuote, NaN scartati; Expedia senza categorie → [])", () => {
  assert.deepEqual(normalizeReviewScores(undefined), []);
  assert.deepEqual(normalizeReviewScores(null), []);
  assert.deepEqual(normalizeReviewScores([]), []);
  assert.deepEqual(normalizeReviewScores([{ category: "clean", score: null }, { category: "staff", score: "abc" }, { category: "", score: 5 }, "x", null]), []);
});

test("normalizeReviewScores: stringhe numeriche, clamp 0..10, duplicati (vale l'ultimo), categoria sconosciuta in coda", () => {
  const r = normalizeReviewScores([{ category: "clean", score: "9,5" }, { category: "clean", score: 12 }, { category: "pool_view", score: -3 }]);
  assert.deepEqual(r.map((x) => [x.key, x.score]), [["clean", 10], ["pool_view", 0]]);
  assert.equal(r[1].label, "Pool view");
});

test("normalizeReviewScores: tollera anche la forma a mappa", () => {
  const r = normalizeReviewScores({ clean: 9, staff: { score: 8, count: 3 } });
  assert.deepEqual(r.map((x) => [x.key, x.score]), [["clean", 9], ["staff", 8]]);
});

test("cleanScore", () => {
  assert.equal(cleanScore(8.76), 8.8);
  assert.equal(cleanScore("7,25"), 7.3);
  assert.equal(cleanScore(null), null);
  assert.equal(cleanScore(""), null);
  assert.equal(cleanScore(true), null);
  assert.equal(cleanScore(Infinity), null);
});

test("normalizeCategoryKey", () => {
  assert.equal(normalizeCategoryKey(" Cleanliness "), "clean");
  assert.equal(normalizeCategoryKey("Value for money"), "value");
  assert.equal(normalizeCategoryKey("check_in"), "checkin");
  assert.equal(normalizeCategoryKey("Staff"), "staff");
});

test("normalizeScoreSummary: attributes di GET /scores/:property_id", () => {
  const s = normalizeScoreSummary({
    count: 12, overall_score: 9.04, id: "x",
    scores: { clean: { count: 12, score: 9.5 }, staff: { count: 10, score: 9.8 }, accuracy: { count: 2, score: 9 } },
  });
  assert.equal(s?.overall, 9);
  assert.equal(s?.count, 12);
  assert.deepEqual(s?.categories.map((c) => [c.key, c.score, c.count]), [["clean", 9.5, 12], ["staff", 9.8, 10], ["accuracy", 9, 2]]);
});

test("normalizeScoreSummary: vuoto/assente → null (mai zeri)", () => {
  assert.equal(normalizeScoreSummary(undefined), null);
  assert.equal(normalizeScoreSummary({ count: 0, scores: {} }), null);
  assert.equal(normalizeScoreSummary({ overall_score: null, scores: { clean: { count: 0, score: null } } }), null);
});

test("parseDetailedScores: property + ota_scores (BookingCom / AirBNB), Expedia assente", () => {
  const d = parseDetailedScores({
    id: "p1", type: "score",
    attributes: { count: 30, overall_score: 9.1, scores: { clean: { count: 30, score: 9.3 } } },
    relationships: {
      property: { data: { id: "p1" } },
      ota_scores: [
        { data: { id: "o1", type: "ota_score", attributes: { ota: "BookingCom", channel_id: "c1", count: 20, overall_score: 9.0, scores: { clean: { count: 20, score: 9.2 }, value: { count: 20, score: 8.6 } } } } },
        { data: { id: "o2", type: "ota_score", attributes: { ota: "AirBNB", channel_id: "c2", count: 10, overall_score: 9.4, scores: {} } } },
      ],
    },
  });
  assert.equal(d.property?.overall, 9.1);
  assert.equal(d.byChannel.booking?.categories.length, 2);
  assert.equal(d.byChannel.airbnb?.overall, 9.4);
  assert.equal(d.byChannel.airbnb?.categories.length, 0);
  assert.equal(d.byChannel.expedia, undefined);
});

test("parseDetailedScores: dati assenti o malformati → vuoto, senza eccezioni", () => {
  assert.deepEqual(parseDetailedScores(undefined), { property: null, byChannel: {} });
  assert.deepEqual(parseDetailedScores({ relationships: { ota_scores: "boh" } }), { property: null, byChannel: {} });
});

test("channelOfOta", () => {
  assert.equal(channelOfOta("BookingCom"), "booking");
  assert.equal(channelOfOta("AirBNB"), "airbnb");
  assert.equal(channelOfOta("Expedia"), "expedia");
  assert.equal(channelOfOta("Tripadvisor"), null);
  assert.equal(channelOfOta(undefined), null);
});

test("mergeSummaries: media pesata sui count (più property Channex per struttura)", () => {
  const a = { overall: 9, count: 10, categories: [{ key: "clean", label: "Pulizia", score: 10, count: 10 }] };
  const b = { overall: 8, count: 30, categories: [{ key: "clean", label: "Pulizia", score: 8, count: 30 }, { key: "staff", label: "Personale", score: 9, count: 30 }] };
  const m = mergeSummaries([a, null, b])!;
  assert.equal(m.count, 40);
  assert.equal(m.overall, 8.3);
  assert.deepEqual(m.categories.map((c) => [c.key, c.score]), [["clean", 8.5], ["staff", 9]]);
  assert.equal(mergeSummaries([null, undefined]), null);
});

test("summarizeFromReviews: media per categoria dalle recensioni (ripiego), nessun dato → null", () => {
  const s = summarizeFromReviews([
    { scores: [{ key: "clean", label: "Pulizia", score: 10 }, { key: "staff", label: "Personale", score: 8 }] },
    { scores: [{ key: "clean", label: "Pulizia", score: 9 }] },
    { scores: [] },
    {},
  ])!;
  assert.deepEqual(s.categories.map((c) => [c.key, c.score, c.count]), [["clean", 9.5, 2], ["staff", 8, 1]]);
  assert.equal(s.overall, null);
  assert.equal(summarizeFromReviews([{ scores: [] }, {}]), null);
});
