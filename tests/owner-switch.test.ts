import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const Core = await import("../src/lib/sync-core.ts");

const OWNER = "spigolestay:localowner";
const USERS = "spigolestay:users";
const j = (v: unknown) => JSON.stringify(v);

// ── decideEntry ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("proprietario locale di un altro account → wipe (anche se la scheda dice di essere già reidratata: caso due schede)", () => {
  assert.equal(Core.decideEntry({ localOwner: "A", uid: "B", sessionFlag: null, localHasData: true }), "wipe");
  assert.equal(Core.decideEntry({ localOwner: "A", uid: "B", sessionFlag: "B", localHasData: true }), "wipe");
});

test("proprietario ignoto e scheda non ancora reidratata (dispositivo precedente al marcatore) → wipe", () => {
  assert.equal(Core.decideEntry({ localOwner: null, uid: "B", sessionFlag: null, localHasData: true }), "wipe");
  assert.equal(Core.decideEntry({ localOwner: null, uid: "B", sessionFlag: null, localHasData: false }), "wipe");
});

test("proprietario ignoto ma scheda già reidratata per questo utente con dati locali → scorciatoia (il marcatore non viaggia più col server)", () => {
  assert.equal(Core.decideEntry({ localOwner: null, uid: "B", sessionFlag: "B", localHasData: true }), "shortcut");
  assert.equal(Core.decideEntry({ localOwner: null, uid: "B", sessionFlag: "B", localHasData: false }), "wipe"); // locale vuoto: percorso completo
  assert.equal(Core.decideEntry({ localOwner: null, uid: "B", sessionFlag: "A", localHasData: true }), "wipe");
});

test("proprietario = utente: scorciatoia solo con flag di scheda e dati; altrimenti percorso completo senza svuotare", () => {
  assert.equal(Core.decideEntry({ localOwner: "B", uid: "B", sessionFlag: "B", localHasData: true }), "shortcut");
  assert.equal(Core.decideEntry({ localOwner: "B", uid: "B", sessionFlag: "B", localHasData: false }), "keep");
  assert.equal(Core.decideEntry({ localOwner: "B", uid: "B", sessionFlag: null, localHasData: true }), "keep");
  assert.equal(Core.decideEntry({ localOwner: "B", uid: "B", sessionFlag: "A", localHasData: true }), "keep");
});

// ── il marcatore non è dato d'account ─────────────────────────────────────────────────────────────────────────────────────────────────
test("localowner non è una chiave sincronizzabile: non entra nella firma di contenuto né viene riscritta dal server", () => {
  assert.equal(Core.isSyncKey(OWNER), false);
  assert.equal(Core.LOCAL_OWNER_KEY, OWNER);
  const a = { [USERS]: "[]", [OWNER]: "A" }, b = { [USERS]: "[]", [OWNER]: "B" };
  assert.equal(Core.contentSig(a), Core.contentSig(b));
});

test("un server già contaminato dal marcatore: la fusione non lo rimanda indietro né lo adotta", () => {
  const m = Core.mergeSnapshots({ [USERS]: "[]" }, { [USERS]: "[]", [OWNER]: "A" }, {});
  assert.equal(OWNER in m, false);
  const m2 = Core.mergeSnapshots({ [USERS]: "[]", [OWNER]: "B" }, { [USERS]: "[]", [OWNER]: "A" }, {}, {});
  assert.equal(OWNER in m2, false);
});

test("regressione: senza wipe il locale di A 'vincerebbe' sugli utenti di B; con il locale vuoto (dopo il wipe) no", () => {
  const usersA = j([{ id: "u-a", firstName: "Andrea", templateKey: "owner" }]);
  const usersB = j([{ id: "u-b", firstName: "Giulia", templateKey: "owner" }]);
  // locale di A (non svuotato) fuso col server di B, legacy (senza 4° argomento): ci sarebbe la scheda di A nell'account di B → per questo il wipe è obbligatorio
  const bad = Core.mergeSnapshots({ [USERS]: usersA }, { [USERS]: usersB }, {});
  assert.ok((JSON.parse(bad[USERS]) as { id: string }[]).some((x) => x.id === "u-a"));
  // dopo il wipe il locale è vuoto: restano solo gli utenti di B
  const ok = Core.mergeSnapshots({}, { [USERS]: usersB }, {}, {});
  assert.deepEqual((JSON.parse(ok[USERS]) as { id: string }[]).map((x) => x.id), ["u-b"]);
});
