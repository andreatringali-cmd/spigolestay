import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TIERS, ROOM_OVERAGE, ANNUAL_OFF } from "../src/lib/plans.ts";
import { ROOM_OVERAGE as ROOM_OVERAGE_PLAN } from "../src/lib/plan.ts";

// Il listino ha una sola verità: gli importi di plans.ts (mostrati ai clienti) e di stripe-plans.ts (addebitati) devono coincidere.
test("listino: 39 / 69 / 119 e camera extra a 6 €", () => {
  assert.deepEqual(TIERS.map((t) => t.price), [39, 69, 119]);
  assert.equal(ROOM_OVERAGE, 6);
  assert.equal(ROOM_OVERAGE_PLAN, ROOM_OVERAGE);
});
test("listino: gli importi di Stripe coincidono con quelli mostrati", () => {
  const src = readFileSync(new URL("../src/lib/stripe-plans.ts", import.meta.url), "utf8");
  for (const t of TIERS) {
    const m = src.match(new RegExp(`key: "${t.key}", name: "[A-Za-z]+", amount: ([0-9]+)`));
    assert.ok(m, `piano ${t.key} non trovato in stripe-plans.ts`);
    assert.equal(Number(m![1]), t.price, t.key);
  }
});
test("listino: annuale = 12 mesi con sconto del 20%", () => {
  assert.equal(Math.round(39 * 12 * (1 - ANNUAL_OFF)), 374);
});
test("listino: il check-in online è dal Pro in su, non nel Basic", () => {
  const inc = (k: string) => TIERS.find((t) => t.key === k)!.includes;
  assert.ok(!inc("basic").includes("checkin"));
  assert.ok(inc("pro").includes("checkin"));
  assert.ok(inc("ultimate").includes("checkin"));
});

// Messaggi di Supabase Auth in inglese: all'utente arrivano sempre in italiano.
test("password debole: il messaggio inglese di Supabase diventa italiano", async () => {
  const { friendlyError } = await import("../src/lib/friendly-error.ts");
  const out = friendlyError({ message: "Password is known to be weak and easy to guess, please choose a different one." });
  assert.match(out, /troppo comune/);
  assert.ok(!/weak|guess/i.test(out));
});
