import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, compareWindows, monthlySeries, toImprove, whatTheyLove, bySource, reviewsCsv, type QReview } from "../src/lib/quality.ts";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const R = (id: string, date: string, rating: number, text = "", source = "booking"): QReview => ({ id, date, rating, text, source });

test("qualità: media, 5 stelle (voto 9 o più) e quota positive/negative", () => {
  const s = summarize([R("a", "2026-10-01", 10), R("b", "2026-10-02", 9), R("c", "2026-10-03", 8), R("d", "2026-10-04", 5)]);
  assert.equal(s.count, 4);
  assert.equal(s.avg10, 8);
  assert.equal(s.avg5, 4);
  assert.equal(s.fiveStarPct, 50);
  assert.equal(s.positivePct, 75);
  assert.equal(s.negativePct, 25);
  assert.equal(summarize([]).avg10, null);
});

test("qualità: ultimi 365 giorni contro i 365 precedenti", () => {
  const rs = [R("n1", "2026-09-01", 10), R("n2", "2026-05-01", 8), R("o1", "2025-08-01", 6), R("o2", "2025-03-01", 8), R("vecchia", "2023-01-01", 2)];
  const c = compareWindows(rs, 365, NOW);
  assert.equal(c.current.count, 2); assert.equal(c.current.avg10, 9);
  assert.equal(c.previous.count, 2); assert.equal(c.previous.avg10, 7);
  assert.equal(c.deltaAvg10, 2);
  assert.equal(c.deltaFiveStarPts, 50); // 50% contro 0%
  assert.equal(compareWindows([], 30, NOW).deltaAvg10, null);
});

test("qualità: serie mensile degli ultimi 12 mesi, mesi senza recensioni vuoti", () => {
  const s = monthlySeries([R("a", "2026-10-05", 10), R("b", "2026-10-20", 8), R("c", "2026-08-10", 6)], 12, NOW);
  assert.equal(s.length, 12);
  assert.equal(s[11].key, "2026-10"); assert.equal(s[11].count, 2); assert.equal(s[11].avg10, 9);
  assert.equal(s[9].key, "2026-08"); assert.equal(s[9].avg10, 6);
  assert.equal(s[10].count, 0); assert.equal(s[10].avg10, null);
  assert.equal(s[0].key, "2025-11");
});

test("qualità: temi da migliorare (voti sotto 8) e cosa piace (voti da 9), in italiano e inglese", () => {
  const rs = [
    R("1", "2026-10-01", 6, "Camera sporca e molto rumorosa la notte"),
    R("2", "2026-10-02", 5, "Noisy street, dirty bathroom"),
    R("3", "2026-10-03", 7, "Il letto era scomodo, il materasso troppo morbido"),
    R("4", "2026-10-04", 10, "Posizione perfetta e host gentilissimo, tutto pulito"),
    R("5", "2026-10-05", 9, "Great location, very clean"),
    R("6", "2026-10-06", 4, ""), // senza testo: non conta
  ];
  const bad = toImprove(rs, 3);
  assert.equal(bad[0].key, "pulizia"); assert.equal(bad[0].count, 2); // «sporca» e «dirty»
  assert.ok(bad.some((t) => t.key === "rumore" && t.count === 2));
  assert.ok(bad.length <= 3);
  const good = whatTheyLove(rs, 3);
  assert.ok(good.some((t) => t.key === "posizione" && t.count === 2));
  assert.ok(good.every((t) => t.count >= 1 && t.example.length > 0));
  assert.deepEqual(toImprove([R("x", "2026-10-01", 10, "bellissimo")]), []);
});

test("qualità: per fonte e CSV con intestazione, virgolette e a capo ripuliti", () => {
  const rs = [R("a", "2026-10-01", 10, "ok", "airbnb"), R("b", "2026-10-02", 8, "bene; ma \"rumore\"\nsu strada", "booking"), R("c", "2026-10-03", 6, "", "booking")];
  const b = bySource(rs);
  assert.equal(b[0].source, "booking"); assert.equal(b[0].count, 2); assert.equal(b[0].avg10, 7);
  const csv = reviewsCsv(rs);
  assert.ok(csv.startsWith("﻿Data;Fonte;Voto (su 10);Voto (su 5);Testo"));
  assert.ok(csv.includes('"bene; ma ""rumore"" su strada"'));
  assert.equal(csv.split("\r\n").length, 4);
});
