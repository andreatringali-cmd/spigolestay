import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// google-business.ts importa "@/lib/...": li risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const { normalizeGbpReview, starsToScore, reviewBelongsTo, gbpErrorMessage, isAccountName, isLocationName, gbpAuthorizeUrl } = await import("../src/lib/google-business.ts");

test("stelle Google → voto 0..10", () => {
  assert.equal(starsToScore("FIVE_STAR"), 10);
  assert.equal(starsToScore("FOUR_STAR"), 8);
  assert.equal(starsToScore("ONE_STAR"), 2);
  assert.equal(starsToScore("STAR_RATING_UNSPECIFIED"), 0);
  assert.equal(starsToScore(undefined), 0);
});

test("recensione con risposta: testo, data, voto e risposta già pubblicata", () => {
  const r = normalizeGbpReview({
    name: "accounts/1/locations/2/reviews/abc", reviewId: "abc", reviewer: { displayName: "Mario" }, starRating: "FIVE_STAR",
    comment: " Ottimo ", createTime: "2026-10-01T10:00:00Z", reviewReply: { comment: "Grazie!" },
  });
  assert.deepEqual(r, { id: "gbp-abc", reviewName: "accounts/1/locations/2/reviews/abc", guest: "Mario", date: "2026-10-01", rating: 10, text: "Ottimo", source: "google", bucket: "pos", isReplied: true, reply: "Grazie!" });
});

test("recensione anonima, solo stelle, senza risposta", () => {
  const r = normalizeGbpReview({ name: "accounts/1/locations/2/reviews/x", starRating: "THREE_STAR", reviewer: { isAnonymous: true, displayName: "Nome nascosto" }, createTime: "2026-09-30T00:00:00Z" });
  assert.equal(r?.guest, "Utente Google");
  assert.equal(r?.text, "");
  assert.equal(r?.isReplied, false);
  assert.equal(r?.reply, null);
  assert.equal(r?.bucket, "neu");
});

test("senza nome della recensione non si può rispondere: scartata", () => {
  assert.equal(normalizeGbpReview({ reviewId: "solo-id" }), null);
  assert.equal(normalizeGbpReview({}), null);
});

test("la recensione deve appartenere alla sede collegata", () => {
  const loc = { account: "accounts/1", location: "locations/2" };
  assert.equal(reviewBelongsTo("accounts/1/locations/2/reviews/abc", loc), true);
  assert.equal(reviewBelongsTo("accounts/1/locations/3/reviews/abc", loc), false);
  assert.equal(reviewBelongsTo("accounts/9/locations/2/reviews/abc", loc), false);
  assert.equal(reviewBelongsTo("accounts/1/locations/2/reviews/../../x", loc), false);
  assert.equal(reviewBelongsTo("accounts/1/locations/2/reviews/a/b", loc), false);
});

test("nomi di account e sede validati", () => {
  assert.equal(isAccountName("accounts/123"), true);
  assert.equal(isAccountName("accounts/12a"), false);
  assert.equal(isAccountName("locations/1"), false);
  assert.equal(isLocationName("locations/456"), true);
  assert.equal(isLocationName("locations/456/x"), false);
  assert.equal(isLocationName(undefined), false);
});

test("messaggi d'errore chiari: quota zero = accesso non approvato, API non abilitata, consenso scaduto", () => {
  assert.match(gbpErrorMessage(429, "RESOURCE_EXHAUSTED: Quota exceeded for quota metric"), /approvat/);
  assert.match(gbpErrorMessage(403, "PERMISSION_DENIED: My Business Account Management API has not been used in project 123 before or it is disabled"), /abilitare/);
  assert.match(gbpErrorMessage(401), /ricollega/);
  assert.match(gbpErrorMessage(403, "PERMISSION_DENIED"), /gestisce questa sede/);
  assert.match(gbpErrorMessage(0), /non risponde/);
});

test("URL di consenso: refresh token richiesto, scope di gestione, state passato", () => {
  process.env.GBP_CLIENT_ID = "client-test";
  const u = new URL(gbpAuthorizeUrl("https://xenora.it/api/google-business/callback", "STATO"));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/business.manage");
  assert.equal(u.searchParams.get("state"), "STATO");
  assert.equal(u.searchParams.get("redirect_uri"), "https://xenora.it/api/google-business/callback");
  delete process.env.GBP_CLIENT_ID;
});
