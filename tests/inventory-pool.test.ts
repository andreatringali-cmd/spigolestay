import test from "node:test";
import assert from "node:assert/strict";
import { parsePool, poolRemaining, capByPool, inPool } from "../src/lib/inventory-pool.ts";

const cfg = parsePool(JSON.stringify({ enabled: true, structureIds: ["H", "R"], realRooms: 8 }));
const bk = (structureId: string, checkIn: string, checkOut: string, status = "confirmed") => ({ structureId, checkIn, checkOut, status });

test("parsePool: spenta o incompleta = non attiva", () => {
  assert.equal(parsePool(null).enabled, false);
  assert.equal(parsePool(JSON.stringify({ enabled: true, structureIds: ["H"], realRooms: 8 })).enabled, false); // serve più di una struttura
  assert.equal(parsePool(JSON.stringify({ enabled: true, structureIds: ["H", "R"], realRooms: 0 })).enabled, false);
  assert.equal(parsePool("non json").enabled, false);
  assert.equal(cfg.enabled, true);
});

test("poolRemaining: sottrae le prenotazioni di tutte le strutture del gruppo, non annullate", () => {
  const list = [bk("H", "2026-10-10", "2026-10-12"), bk("R", "2026-10-11", "2026-10-13"), bk("R", "2026-10-11", "2026-10-13", "cancelled"), bk("X", "2026-10-11", "2026-10-13")];
  assert.equal(poolRemaining(cfg, list, "2026-10-10"), 7); // solo H
  assert.equal(poolRemaining(cfg, list, "2026-10-11"), 6); // H + R (X è fuori dal gruppo, l'annullata non conta)
  assert.equal(poolRemaining(cfg, list, "2026-10-12"), 7); // H è partita il 12 (check-out escluso), resta R
  assert.equal(poolRemaining(cfg, list, "2026-10-13"), 8);
});

test("capByPool: una prenotazione su una struttura riduce l'altra", () => {
  // 8 camere reali: Spigolehouse ne mostra fino a 8, Spigolerooms fino a 4.
  const none: ReturnType<typeof bk>[] = [];
  assert.equal(capByPool(8, cfg, "H", none, "2026-10-10"), 8);
  assert.equal(capByPool(4, cfg, "R", none, "2026-10-10"), 4);
  const three = [bk("R", "2026-10-10", "2026-10-11"), bk("R", "2026-10-10", "2026-10-11"), bk("R", "2026-10-10", "2026-10-11")];
  assert.equal(capByPool(8 - 0, cfg, "H", three, "2026-10-10"), 5); // restano 5 nel gruppo → House 5
  assert.equal(capByPool(4 - 3, cfg, "R", three, "2026-10-10"), 1); // Rooms: 1 (il suo stesso conteggio è già più basso)
});

test("capByPool: gruppo pieno chiude entrambe; fuori dal gruppo non cambia nulla", () => {
  const full = Array.from({ length: 8 }, () => bk("H", "2026-10-10", "2026-10-11"));
  assert.equal(capByPool(3, cfg, "R", full, "2026-10-10"), 0);
  assert.equal(capByPool(3, cfg, "H", full, "2026-10-10"), 0);
  assert.equal(capByPool(3, cfg, "ALTRA", full, "2026-10-10"), 3);
  assert.equal(capByPool(3, undefined, "H", full, "2026-10-10"), 3);
  assert.equal(inPool(cfg, "H"), true);
  assert.equal(inPool(cfg, "ALTRA"), false);
});
