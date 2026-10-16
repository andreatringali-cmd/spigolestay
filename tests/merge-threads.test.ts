import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeChatState } from "../src/lib/merge-threads.ts";

const base = { threads: {}, archived: [], pinned: [], manualUnread: [], seen: {} };

test("la chat della scheda eliminata passa a quella che resta, ordinata e senza doppioni", () => {
  const r = mergeChatState({
    ...base,
    threads: { A: [{ id: "1", ts: 10 }, { id: "3", ts: 30, wid: "w" }], B: [{ id: "2", ts: 20 }, { id: "9", ts: 30, wid: "w" }, { id: "1", ts: 10 }] },
  }, new Map([["B", "A"]]));
  assert.deepEqual(r.threads.A.map((m) => m.id), ["1", "2", "3"]);
  assert.equal("B" in r.threads, false);
});

test("se la scheda che resta non aveva chat, la eredita", () => {
  const r = mergeChatState({ ...base, threads: { B: [{ id: "1", ts: 5 }] } }, new Map([["B", "A"]]));
  assert.deepEqual(r.threads, { A: [{ id: "1", ts: 5 }] });
});

test("archiviata solo se lo erano tutte; fissata e da-leggere se basta una; visto = il più recente", () => {
  const t = { A: [{ id: "1", ts: 1 }], B: [{ id: "2", ts: 2 }] };
  let r = mergeChatState({ ...base, threads: t, archived: ["A"], pinned: ["B"], manualUnread: ["B"], seen: { A: 5, B: 9 } }, new Map([["B", "A"]]));
  assert.deepEqual(r.archived, []);
  assert.deepEqual(r.pinned, ["A"]);
  assert.deepEqual(r.manualUnread, ["A"]);
  assert.deepEqual(r.seen, { A: 9 });
  r = mergeChatState({ ...base, threads: t, archived: ["A", "B"] }, new Map([["B", "A"]]));
  assert.deepEqual(r.archived, ["A"]);
});

test("nessuna unione: stato invariato", () => {
  const s = { ...base, threads: { A: [{ id: "1", ts: 1 }] } };
  assert.deepEqual(mergeChatState(s, new Map()).threads, s.threads);
});

test("i modelli eliminati (tombstone) sono sincronizzati anche per i collaboratori", async () => {
  const { isWorkspaceKey } = await import("../src/lib/workspace-keys.ts");
  assert.equal(isWorkspaceKey("spigolestay:msgtemplates:deleted"), true);
});
