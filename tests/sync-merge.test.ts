import test from "node:test";
import assert from "node:assert/strict";
import { adoptServerFlatKeys, mergeRecord3, applyRaceChanges } from "../src/lib/sync-merge.ts";

const noSkip = () => false;
const PLAN = "spigolestay:plan";
const DK = "spigolestay:data:v1";

// ── #1 chiavi piatte a 3 vie ────────────────────────────────────────────────
test("chiave non toccata qui e cambiata sul server: si adotta il server", () => {
  const local = { [PLAN]: "vecchio" }, server = { [PLAN]: "nuovo" }, base = { [PLAN]: "vecchio" };
  const merged = { ...server, ...local };
  assert.equal(adoptServerFlatKeys(merged, local, server, base, noSkip)[PLAN], "nuovo");
});

test("chiave modificata qui: vince il locale (anche se il server e' cambiato)", () => {
  const local = { [PLAN]: "mio" }, server = { [PLAN]: "altrui" }, base = { [PLAN]: "vecchio" };
  assert.equal(adoptServerFlatKeys({ ...server, ...local }, local, server, base, noSkip)[PLAN], "mio");
});

test("base vuota (prima idratazione): comportamento invariato, vince il locale", () => {
  const local = { [PLAN]: "mio" }, server = { [PLAN]: "altrui" };
  assert.equal(adoptServerFlatKeys({ ...server, ...local }, local, server, {}, noSkip)[PLAN], "mio");
  assert.equal(adoptServerFlatKeys({ ...server, ...local }, local, server, undefined, noSkip)[PLAN], "mio");
});

test("server uguale alla base: nessun cambiamento; chiave assente dal server: resta quella locale", () => {
  const local = { [PLAN]: "a" }, base = { [PLAN]: "a" };
  assert.equal(adoptServerFlatKeys({ ...local }, local, { [PLAN]: "a" }, base, noSkip)[PLAN], "a");
  assert.equal(adoptServerFlatKeys({ ...local }, local, {}, base, noSkip)[PLAN], "a");
});

test("le chiavi escluse (data:v1 e quelle con regola propria) non vengono toccate", () => {
  const local = { [DK]: "L", "spigolestay:threads:v1": "L" }, server = { [DK]: "S", "spigolestay:threads:v1": "S" }, base = { ...local };
  const skip = (k: string) => k === DK || k === "spigolestay:threads:v1";
  const out = adoptServerFlatKeys({ ...server, ...local }, local, server, base, skip);
  assert.equal(out[DK], "L");
  assert.equal(out["spigolestay:threads:v1"], "L");
});

test("non modifica l'oggetto passato", () => {
  const local = { [PLAN]: "v" }, server = { [PLAN]: "n" }, base = { [PLAN]: "v" };
  const merged = { ...server, ...local };
  adoptServerFlatKeys(merged, local, server, base, noSkip);
  assert.equal(merged[PLAN], "v");
});

// ── #3 rateOverrides per chiave a 3 vie ─────────────────────────────────────
test("mappa locale vuota (socio appena invitato, base vuota): non cancella i prezzi del server", () => {
  assert.deepEqual(mergeRecord3({}, {}, { "rt1|2026-12-31": 180 }), { "rt1|2026-12-31": 180 });
  assert.deepEqual(mergeRecord3(undefined, {}, { "rt1|2026-12-31": 180 }), { "rt1|2026-12-31": 180 });
});

test("dispositivo con prezzi vecchi non toccati: adotta i prezzi nuovi del server (anche cambiati e rimossi)", () => {
  const base = { "rt1|a": 100, "rt1|b": 110, "rt1|c": 120 };
  const server = { "rt1|a": 150, "rt1|c": 120, "rt1|d": 90 }; // a cambiato, b tolto, d nuovo
  assert.deepEqual(mergeRecord3(base, { ...base }, server), server);
});

test("chiave toccata qui vince il locale; chiavi non toccate seguono il server", () => {
  const base = { "rt1|a": 100, "rt1|b": 110 };
  const local = { "rt1|a": 999, "rt1|b": 110, "rt1|n": 70 }; // a cambiato qui, n aggiunto qui
  const server = { "rt1|a": 150, "rt1|b": 115 };               // a cambiato anche altrove, b cambiato altrove
  assert.deepEqual(mergeRecord3(base, local, server), { "rt1|a": 999, "rt1|b": 115, "rt1|n": 70 });
});

test("chiave tolta qui (era nella base): resta tolta", () => {
  const base = { "rt1|a": 100, "rt1|b": 110 };
  assert.deepEqual(mergeRecord3(base, { "rt1|b": 110 }, base), { "rt1|b": 110 });
});

test("base vuota: sulle chiavi in comune vince il locale, quelle solo del server si tengono (come l'unione di prima)", () => {
  assert.deepEqual(mergeRecord3({}, { "rt1|a": 1 }, { "rt1|a": 2, "rt1|b": 3 }), { "rt1|a": 1, "rt1|b": 3 });
});

test("valori non oggetto: ignorati senza errori", () => {
  assert.deepEqual(mergeRecord3(null, "x", [1]), {});
});

// ── #2 anti-race ────────────────────────────────────────────────────────────
// fusione di prova del blocco dati: unione degli id (locale + server), cancellati rispettati rispetto alla base
const mergeData = (l: string, s: string, b: string) => {
  const L = JSON.parse(l) as { bookings: { id: string }[] }, S = JSON.parse(s) as { bookings: { id: string }[] }, B = b ? JSON.parse(b) as { bookings: { id: string }[] } : { bookings: [] };
  const baseIds = new Set(B.bookings.map((x) => x.id)), localIds = new Set(L.bookings.map((x) => x.id));
  const out = [...L.bookings, ...S.bookings.filter((x) => !localIds.has(x.id) && !baseIds.has(x.id))];
  return JSON.stringify({ bookings: out });
};
const data = (...ids: string[]) => JSON.stringify({ bookings: ids.map((id) => ({ id })) });
const ids = (raw: string) => (JSON.parse(raw) as { bookings: { id: string }[] }).bookings.map((x) => x.id).sort();

test("prenotazione aggiunta DURANTE la sincronizzazione: non viene cancellata dal ripristino e le novita' del server restano", () => {
  const snap = { [DK]: data("A") };                 // fotografia prima della rete
  const fresh = { [DK]: data("A", "NUOVA") };         // l'utente ha aggiunto NUOVA nel frattempo
  const result = { [DK]: data("A", "SERVER") };      // risultato fuso sulla vecchia fotografia (+ prenotazione arrivata dal server)
  const out = applyRaceChanges(snap, fresh, result, DK, mergeData);
  assert.deepEqual(ids(out[DK]), ["A", "NUOVA", "SERVER"]);
});

test("prenotazione cancellata durante la sincronizzazione: resta cancellata", () => {
  const snap = { [DK]: data("A", "B") };
  const fresh = { [DK]: data("A") };
  const result = { [DK]: data("A", "B", "SERVER") };
  assert.deepEqual(ids(applyRaceChanges(snap, fresh, result, DK, mergeData)[DK]), ["A", "SERVER"]);
});

test("blocco dati non cambiato durante il ciclo: si applica il risultato cosi' com'e'", () => {
  const snap = { [DK]: data("A") };
  const result = { [DK]: data("A", "SERVER") };
  const out = applyRaceChanges(snap, { [DK]: data("A") }, result, DK, () => { throw new Error("non deve essere chiamata"); });
  assert.equal(out[DK], data("A", "SERVER"));
});

test("chiavi piatte modificate o tolte durante il ciclo: si tiene la versione fresca", () => {
  const snap = { [DK]: data("A"), x: "1", y: "1" };
  const fresh = { [DK]: data("A"), x: "2", z: "nuova" };      // x cambiata, y tolta, z aggiunta
  const result = { [DK]: data("A"), x: "1", y: "1" };
  const out = applyRaceChanges(snap, fresh, result, DK, mergeData);
  assert.equal(out.x, "2"); assert.equal("y" in out, false); assert.equal(out.z, "nuova");
});

test("se la fusione del blocco dati fallisce non si perde il resto e non si lancia", () => {
  const snap = { [DK]: data("A") };
  const out = applyRaceChanges(snap, { [DK]: data("A", "N") }, { [DK]: data("A", "S") }, DK, () => { throw new Error("boom"); });
  assert.equal(out[DK], data("A", "S"));
});
