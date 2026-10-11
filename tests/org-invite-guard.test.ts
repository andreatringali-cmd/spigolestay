import test from "node:test";
import assert from "node:assert/strict";
import { decideOrgReuse } from "../src/lib/org-invite-guard.ts";

test("nessuna org contiene la struttura → crea", () => {
  assert.deepEqual(decideOrgReuse([], []), { action: "create" });
  assert.deepEqual(decideOrgReuse([], ["o1"]), { action: "create" });
});
test("il chiamante è già membro dell'org che la contiene → riusa", () => {
  assert.deepEqual(decideOrgReuse(["o1"], ["o1", "o2"]), { action: "use", orgId: "o1" });
});
test("la struttura sta solo in un'org altrui → 403 (nessuna auto-iscrizione come owner)", () => {
  assert.deepEqual(decideOrgReuse(["o9"], []), { action: "forbidden" });
  assert.deepEqual(decideOrgReuse(["o9"], ["o1", "o2"]), { action: "forbidden" });
});
test("struttura in più org: sceglie quella di cui il chiamante è membro, non la prima", () => {
  assert.deepEqual(decideOrgReuse(["o9", "o2"], ["o2"]), { action: "use", orgId: "o2" });
});
