import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const Core = await import("../src/lib/sync-core.ts");
const W = await import("../src/lib/sync-window.ts");
const D = await import("../src/lib/sync-delta.ts");
const H = await import("../src/lib/home-struct.ts");
const SL = await import("../src/lib/struct-load.ts");
const A = await import("../src/lib/delta-allow.ts");
const { combineData } = await import("../src/lib/org-combine.ts");

// «Apertura per struttura»: all'avvio si scarica UNA struttura sola; le altre si caricano quando servono. Il titolare ha 3 strutture in 2 organizzazioni
// (X: Spigolehouse + Central Perk, Y: Spigolerooms). Qui il «server» ha 3 righe (personale P, org X, org Y) e un dispositivo in modalità veloce che usa la fusione VERA
// (sync-core), il delta VERO (sync-delta) e la finestra VERA (sync-window).
const KEY = "spigolestay:data:v1";
const TODAY = "2026-10-19";
const day = (offset: number) => new Date(Date.parse(TODAY + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
type Row = Record<string, string>;
const parse = (r: Row | null | undefined) => JSON.parse((r ?? {})[KEY] ?? "{}");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

const STRUCTS = [
  { id: "s1", name: "Spigolehouse", orgId: "X", order: 0, updatedAt: 1 },
  { id: "s2", name: "Spigolerooms", orgId: "Y", order: 1, updatedAt: 1 },
  { id: "s3", name: "Central Perk", orgId: "X", order: 2, updatedAt: 1 },
];
const N = { s1: 1, s2: 2, s3: 3 } as Record<string, number>;
const bk = (sid: string, i: number, ci: string, co: string, extra: Record<string, unknown> = {}) => ({ id: `${sid}-b${i}`, structureId: sid, roomTypeId: "rt" + N[sid], unitId: "u" + N[sid], guestId: `g-${sid}-b${i}`, checkIn: ci, checkOut: co, status: "confirmed", code: `XEN-2026-${String(N[sid] * 1000 + i).padStart(4, "0")}`, updatedAt: 1000, ...extra });

// Archivio «verità»: per struttura 30 prenotazioni vecchie (fuori finestra) e 60 recenti/future (dentro).
function makeWorld() {
  const per = (sid: string) => {
    const bookings: any[] = [];
    for (let i = 0; i < 30; i++) bookings.push(bk(sid, i, day(-900 + i * 5), day(-897 + i * 5)));
    for (let i = 30; i < 90; i++) bookings.push(bk(sid, i, day(-60 + (i - 30) * 4), day(-57 + (i - 30) * 4)));
    return bookings;
  };
  const all: Record<string, any[]> = { s1: per("s1"), s2: per("s2"), s3: per("s3") };
  const guestsOf = (list: any[]) => list.map((b) => ({ id: b.guestId, fullName: "Ospite " + b.id, updatedAt: 1000 }));
  const org = (oid: string, sids: string[]) => ({
    structures: STRUCTS.filter((s) => sids.includes(s.id)),
    roomTypes: sids.map((s) => ({ id: "rt" + N[s], structureId: s, name: "Doppia " + s, updatedAt: 1 })),
    units: sids.map((s) => ({ id: "u" + N[s], structureId: s, roomTypeId: "rt" + N[s], name: "1", updatedAt: 1 })),
    bookings: sids.flatMap((s) => all[s]), guests: sids.flatMap((s) => guestsOf(all[s])),
    rateOverrides: Object.fromEntries(sids.map((s) => [`rt${N[s]}|2026-10-20`, 100 + N[s]])), _deleted: {},
  });
  const personal = {
    structures: [], roomTypes: [], units: [], bookings: [], guests: [...guestsOf(all.s1), ...guestsOf(all.s2), ...guestsOf(all.s3), { id: "g-lead", fullName: "Contatto", updatedAt: 1000 }],
    events: [{ id: "e1", name: "Fiera", structureId: "s1", updatedAt: 1 }, { id: "e2", name: "Festa", structureId: "s2", updatedAt: 1 }],
    directReviews: [], rateOverrides: {}, activities: [], _deleted: {},
  };
  return { P: personal, X: org("X", ["s1", "s3"]), Y: org("Y", ["s2"]) };
}

class SrvRow {
  row: Row; rev = 1; today = TODAY; calls: string[] = [];
  constructor(d: unknown) { this.row = { [KEY]: JSON.stringify(d), "spigolestay:promos": "[]" }; }
  readWindow(structureIds: string[] | null, past: number | null = 400) {
    const w = W.windowRowData(JSON.parse(JSON.stringify(this.row)), this.today, past ?? 100000, structureIds);
    return { data: w.data as Row, rev: this.rev, codeMax: w.codeMax };
  }
  postDelta(delta: any, expected: number) {
    if (expected !== this.rev) return { conflict: true as const };
    try { const a = D.applyDelta(this.row, delta); if (!a.stats.changed) return { rev: this.rev }; this.row = a.row; } catch (e: any) { return { error: e.code as string }; }
    this.rev++; return { rev: this.rev };
  }
}
class World { rows: Record<"P" | "X" | "Y", SrvRow>; constructor() { const w = makeWorld(); this.rows = { P: new SrvRow(w.P), X: new SrvRow(w.X), Y: new SrvRow(w.Y) }; } }

// Divide il blocco locale per riga (come splitByOrg in authsync.tsx).
function splitLocal(d: any, which: "P" | "X" | "Y"): any {
  const orgOfS = new Map<string, string>(); for (const s of d.structures ?? []) if (s.orgId) orgOfS.set(s.id, s.orgId);
  const orgOfRt = new Map<string, string>(); for (const rt of d.roomTypes ?? []) if (orgOfS.get(rt.structureId)) orgOfRt.set(rt.id, orgOfS.get(rt.structureId)!);
  if (which === "P") {
    const ro: any = {}; for (const [k, v] of Object.entries(d.rateOverrides ?? {})) { const rt = k.split("|")[0]; if (!orgOfRt.has(rt)) ro[k] = v; }
    return { ...d, structures: [], roomTypes: [], units: [], bookings: [], rateOverrides: ro };
  }
  const mine = (sid: string) => orgOfS.get(sid) === which;
  const bookings = (d.bookings ?? []).filter((b: any) => mine(b.structureId));
  const cited = new Set(bookings.map((b: any) => b.guestId));
  const ro: any = {}; for (const [k, v] of Object.entries(d.rateOverrides ?? {})) { if (orgOfRt.get(k.split("|")[0]) === which) ro[k] = v; }
  return {
    structures: (d.structures ?? []).filter((s: any) => s.orgId === which), roomTypes: (d.roomTypes ?? []).filter((r: any) => mine(r.structureId)), units: (d.units ?? []).filter((u: any) => mine(u.structureId)),
    bookings, guests: (d.guests ?? []).filter((g: any) => cited.has(g.id)), rateOverrides: ro, _deleted: d._deleted ?? {},
  };
}

// Dispositivo in modalità veloce con apertura per struttura: `requested` = strutture richieste (null = tutte, senza filtro).
class ScopedDevice {
  local: Row = {}; base: Record<string, Row> = { P: {}, X: {}, Y: {} }; requested: string[] | null; blocked: string[] = []; lastDeltas: Record<string, any> = {};
  constructor(requested: string[] | null, local: Row = {}) { this.requested = requested; this.local = local; }
  data() { return parse(this.local); }
  edit(fn: (d: any) => void) { const d = this.data(); fn(d); this.local = { ...this.local, [KEY]: JSON.stringify(d) }; }
  cycle(w: World) {
    const scope = this.requested; const full = this.data(); const merged: Record<string, Row> = {}; let wrote = false;
    for (const r of ["P", "X", "Y"] as const) {
      const win = w.rows[r].readWindow(scope);
      const snap: Row = { [KEY]: JSON.stringify(splitLocal(full, r)) };
      const m = Core.mergeSnapshots(snap, win.data, this.base[r]);
      const delta = D.buildDelta(win.data, this.base[r], m, scope);
      this.lastDeltas[r] = delta;
      if (!D.isEmptyDelta(delta)) {
        const res = w.rows[r].postDelta(delta, win.rev);
        if ("conflict" in res) { merged[r] = m; continue; }
        if ("error" in res) { this.blocked.push(res.error); merged[r] = m; continue; }
        if (res.rev !== win.rev) wrote = true; // scrittura vera (un delta con contenuto già presente sul server non fa salire la versione)
      }
      this.base[r] = m; merged[r] = m;
    }
    const combined = combineData(parse(merged.P), [parse(merged.X), parse(merged.Y)]);
    this.local = { ...merged.P, [KEY]: JSON.stringify({ ...parse(merged.P), ...combined }) };
    return { wrote };
  }
}
const serverIds = (w: World, r: "P" | "X" | "Y", sid?: string) => ids(parse(w.rows[r].row).bookings.filter((b: any) => !sid || b.structureId === sid));
const snapRow = (w: World, r: "P" | "X" | "Y") => w.rows[r].row[KEY];

// ───────────────────────────── finestra per struttura (pura) ─────────────────────────────
test("finestra per struttura: della riga X con richiesta s1 arrivano solo le prenotazioni, gli ospiti e i prezzi di s1; strutture, tipologie e camere di tutte", () => {
  const w = new World();
  const win = parse(w.rows.X.readWindow(["s1"]).data);
  assert.deepEqual(ids(win.structures), ["s1", "s3"]);
  assert.deepEqual(ids(win.roomTypes), ["rt1", "rt3"]);
  assert.deepEqual(ids(win.units), ["u1", "u3"]);
  assert.ok(win.bookings.length > 0 && win.bookings.every((b: any) => b.structureId === "s1"));
  assert.ok(win.bookings.length < 90, "le vecchie restano fuori anche per la struttura richiesta");
  const cited = new Set(win.bookings.map((b: any) => b.guestId));
  assert.ok(win.guests.every((g: any) => cited.has(g.id)), "solo ospiti citati");
  assert.deepEqual(Object.keys(win.rateOverrides), ["rt1|2026-10-20"]);
});

test("finestra per struttura: più strutture, struttura ignota alla riga, nessuna struttura, nessun filtro", () => {
  const w = new World();
  const two = parse(w.rows.X.readWindow(["s1", "s3"]).data);
  assert.deepEqual([...new Set(two.bookings.map((b: any) => b.structureId))].sort(), ["s1", "s3"]);
  const foreign = parse(w.rows.X.readWindow(["s2"]).data);      // s2 è dell'org Y: la riga X non ha prenotazioni da dare
  assert.equal(foreign.bookings.length, 0); assert.equal(foreign.structures.length, 2);
  const none = parse(w.rows.X.readWindow([]).data);
  assert.equal(none.bookings.length, 0); assert.deepEqual(ids(none.units), ["u1", "u3"]); assert.deepEqual(none.rateOverrides, {});
  const noFilter = w.rows.X.readWindow(null).data; const old = W.windowRowData(JSON.parse(JSON.stringify(w.rows.X.row)), TODAY, 400).data;
  assert.deepEqual(noFilter, old, "senza filtro identico a prima");
});

test("finestra per struttura: nel dubbio si carica di più (senza struttura o di struttura sconosciuta alla riga si tiene); eventi della riga personale", () => {
  const w = new World();
  const d = parse(w.rows.X.row); d.bookings.push(bk("s1", 900, day(5), day(7), { structureId: undefined, id: "nostruct" }), bk("s1", 901, day(5), day(7), { structureId: "sX", id: "unknown-struct" }));
  w.rows.X.row[KEY] = JSON.stringify(d);
  const win = parse(w.rows.X.readWindow(["s3"]).data);
  assert.ok(win.bookings.some((b: any) => b.id === "nostruct") && win.bookings.some((b: any) => b.id === "unknown-struct"));
  // la riga personale non conosce le strutture (sono nelle org): niente di quello che ha viene nascosto
  const p = parse(w.rows.P.readWindow(["s1"]).data);
  assert.equal(p.events.length, 2);
});

test("finestra per struttura: l'archivio completo non cambia e il massimo dei codici XEN è calcolato sull'archivio intero della riga", () => {
  const w = new World(); const before = snapRow(w, "X");
  const r = w.rows.X.readWindow(["s1"]);
  assert.equal(snapRow(w, "X"), before);
  assert.equal(r.codeMax["2026"], 3089, "il massimo è di s3 (non richiesta)");
  assert.deepEqual(W.codeMaxOf([{ code: "XEN-2025-0007" }, { code: "XEN-2026-0002" }, { code: "SPG-1" }, { code: "XEN-2026-0010" }] as any), { "2025": 7, "2026": 10 });
});

test("parseStructureIds: assente/vuoto/illeggibile = nessun filtro; none = nessuna; elenco ripulito", () => {
  assert.equal(W.parseStructureIds(null), null); assert.equal(W.parseStructureIds(""), null); assert.equal(W.parseStructureIds("   "), null);
  assert.deepEqual(W.parseStructureIds("none"), []);
  assert.deepEqual(W.parseStructureIds("s1, s2,,bad id!,s3"), ["s1", "s2", "s3"]);
  assert.equal(W.parseStructureIds("!!!,???"), null);
});

// ───────────────────────────── scrittura a delta: i dati non caricati non si toccano ─────────────────────────────
test("apertura su s2: arriva solo s2 (con tutte le strutture e camere); a vuoto non si scrive nulla, ciclo dopo ciclo", () => {
  const w = new World(); const dev = new ScopedDevice(["s2"]);
  assert.equal(dev.cycle(w).wrote, false);
  const d = dev.data();
  assert.deepEqual(ids(d.structures), ["s1", "s2", "s3"]); assert.deepEqual(ids(d.units), ["u1", "u2", "u3"]);
  assert.ok(d.bookings.length > 0 && d.bookings.every((b: any) => b.structureId === "s2"));
  for (let i = 0; i < 3; i++) assert.equal(dev.cycle(w).wrote, false);
  assert.equal(w.rows.X.rev, 1); assert.equal(w.rows.Y.rev, 1); assert.equal(w.rows.P.rev, 1);
});

test("modifica, nuova prenotazione, cancellazione e prezzi in s2: le righe di s1/s3 non cambiano (salvo le lapidi) e nessun delta nomina dati non caricati", () => {
  const w = new World(); const dev = new ScopedDevice(["s2"]); dev.cycle(w);
  const xBefore = snapRow(w, "X"); const xIdsBefore = serverIds(w, "X"); const pBefore = parse(w.rows.P.row);
  const t = dev.data().bookings.find((b: any) => b.structureId === "s2" && b.id.endsWith("b60"));
  const victim = dev.data().bookings.find((b: any) => b.structureId === "s2" && b.id.endsWith("b70")).id;
  dev.edit((d) => {
    d.bookings.find((b: any) => b.id === t.id).notes = "nota"; d.bookings.find((b: any) => b.id === t.id).updatedAt = 5000;
    d.bookings.push(bk("s2", 500, day(10), day(12), { updatedAt: 5000 })); d.guests.push({ id: "g-s2-b500", fullName: "Nuova", updatedAt: 5000 });
    d.bookings = d.bookings.filter((b: any) => b.id !== victim); d._deleted = { ...(d._deleted ?? {}), bookings: [victim] };
    d.rateOverrides["rt2|2026-10-21"] = 77; delete d.rateOverrides["rt2|2026-10-20"];
  });
  assert.equal(dev.cycle(w).wrote, true);
  assert.deepEqual(dev.blocked, []);
  // la riga X cambia al massimo nelle lapidi (le lapidi di cancellazione viaggiano in OGNI organizzazione, per costruzione): niente altro
  const strip = (txt: string) => { const o = JSON.parse(txt); delete o._deleted; return JSON.stringify(o); };
  assert.equal(strip(snapRow(w, "X")), strip(xBefore), "la riga di s1/s3 è intatta (salvo le lapidi)");
  assert.deepEqual(serverIds(w, "X"), xIdsBefore);
  const y = parse(w.rows.Y.row);
  assert.equal(y.bookings.find((b: any) => b.id === t.id).notes, "nota");
  assert.ok(y.bookings.some((b: any) => b.id === "s2-b500")); assert.ok(!y.bookings.some((b: any) => b.id === victim));
  assert.equal(y.rateOverrides["rt2|2026-10-21"], 77); assert.ok(!("rt2|2026-10-20" in y.rateOverrides));
  assert.deepEqual(Object.keys(parse(w.rows.X.row).rateOverrides).sort(), ["rt1|2026-10-20", "rt3|2026-10-20"]);
  assert.equal(serverIds(w, "Y").filter((i) => i === "s2-b500").length, 1);
  assert.ok(parse(w.rows.P.row).guests.length >= pBefore.guests.length, "gli ospiti non caricati restano sul server");
  // il delta non cita mai entità di strutture non caricate
  for (const r of ["P", "X", "Y"]) for (const c of Object.values((dev.lastDeltas[r]?.colls ?? {}) as Record<string, any>)) for (const id of [...c.del, ...c.upsert.map((x: any) => x.id)]) assert.ok(!/^s[13]-/.test(String(id)), "mai " + id);
  assert.equal(dev.cycle(w).wrote, false);
});

test("«dato non caricato ≠ dato cancellato»: un dispositivo con l'elenco prenotazioni vuoto non cancella le strutture non caricate, e quelle caricate sono protette dalla soglia", () => {
  const w = new World(); const dev = new ScopedDevice(["s2"]); dev.cycle(w);
  const total = serverIds(w, "X").length, totalY = serverIds(w, "Y").length;
  assert.ok(dev.data().bookings.length > 40, "servono più di 40 prenotazioni caricate per provare la soglia");
  dev.edit((d) => { d.bookings = []; });
  assert.equal(dev.cycle(w).wrote, false);
  assert.deepEqual(dev.blocked, ["mass_delete"]);
  assert.equal(serverIds(w, "X").length, total); assert.equal(serverIds(w, "Y").length, totalY);
  // la guardia «spostamenti»: ciò che nessun'altra riga possiede non è mai uno spostamento
  const delta = D.emptyDelta(); delta.colls.bookings = { upsert: [], del: ["s2-b60", "s2-b61"] };
  assert.equal(D.deletesAreMoves(delta, [w.rows.X.row, w.rows.P.row]), false);
});

test("una copia locale stantia di una struttura non caricata non viene mai inviata (scope) e, se arrivasse, non sovrascrive una versione più recente (ultima modifica vince)", () => {
  const w = new World();
  // sessione precedente: il dispositivo aveva caricato anche s1
  const old = new ScopedDevice(["s1", "s2"]); old.cycle(w);
  // nel frattempo un portale cancella una prenotazione di s1 (aggiornamento sul server, timbro più recente)
  const x = parse(w.rows.X.row); const target = x.bookings.find((b: any) => b.id === "s1-b60"); target.status = "cancelled"; target.updatedAt = 9000;
  w.rows.X.row[KEY] = JSON.stringify(x); w.rows.X.rev++;
  // nuova sessione: stessa copia locale (con la s1 vecchia), base vuota, richiesta solo s2
  const dev = new ScopedDevice(["s2"], old.local);
  assert.ok(dev.data().bookings.some((b: any) => b.id === "s1-b60" && b.status === "confirmed"), "la copia stantia è nel locale");
  dev.cycle(w); dev.cycle(w);
  assert.equal(parse(w.rows.X.row).bookings.find((b: any) => b.id === "s1-b60").status, "cancelled", "il server non è tornato indietro");
  // anche senza scope (cautela in più lato server): l'upsert più vecchio non vince
  const stale = D.emptyDelta(); stale.colls.bookings = { upsert: [{ ...target, status: "confirmed", updatedAt: 1000 }], del: [] };
  assert.equal(parse(D.applyDelta(w.rows.X.row, stale).row as Row).bookings.find((b: any) => b.id === "s1-b60").status, "cancelled");
  const fresh = D.emptyDelta(); fresh.colls.bookings = { upsert: [{ ...target, notes: "nuova", updatedAt: 9500 }], del: [] };
  assert.equal(parse(D.applyDelta(w.rows.X.row, fresh).row as Row).bookings.find((b: any) => b.id === "s1-b60").notes, "nuova");
});

test("prezzi forzati per CHIAVE: un delta non sostituisce la mappa del server (le chiavi non caricate restano), le rimozioni e le modifiche valgono solo per le chiavi nominate", () => {
  const row: Row = { [KEY]: JSON.stringify({ bookings: [], rateOverrides: { "rt1|a": 1, "rt2|b": 2, "rt3|c": 3 } }) };
  const d = D.emptyDelta(); d.rates = { set: { "rt2|b": 20, "rt2|z": 5 }, del: ["rt3|c"] };
  const out = parse(D.applyDelta(row, d).row);
  assert.deepEqual(out.rateOverrides, { "rt1|a": 1, "rt2|b": 20, "rt2|z": 5 });
  assert.equal(D.isEmptyDelta(d), false);
  const empty = D.emptyDelta(); empty.rates = { set: {}, del: [] }; assert.equal(D.isEmptyDelta(empty), true);
  // buildDelta: dalla finestra del server (solo rt2) e dal fuso nasce solo ciò che è cambiato, mai la cancellazione di rt1/rt3
  const server: Row = { [KEY]: JSON.stringify({ rateOverrides: { "rt2|b": 2 }, structures: [], roomTypes: [] }) };
  const merged: Row = { [KEY]: JSON.stringify({ rateOverrides: { "rt2|b": 2, "rt2|n": 9 }, structures: [], roomTypes: [] }) };
  const bd = D.buildDelta(server, server, merged);
  assert.deepEqual(bd.rates, { set: { "rt2|n": 9 }, del: [] });
  assert.equal("rateOverrides" in bd.fields, false);
});

// ───────────────────────────── cambio struttura ─────────────────────────────
test("cambio struttura: la richiesta si allarga, le entità della nuova struttura si fondono nel locale senza cancellare né scrivere nulla; le modifiche dopo vanno al server", () => {
  const w = new World(); const dev = new ScopedDevice(["s2"]); dev.cycle(w);
  const nY = dev.data().bookings.length;
  dev.requested = ["s2", "s1"];                                          // l'utente passa a Spigolehouse
  const r = dev.cycle(w);
  assert.equal(r.wrote, false);
  const d = dev.data();
  assert.ok(d.bookings.some((b: any) => b.structureId === "s1")); assert.ok(!d.bookings.some((b: any) => b.structureId === "s3"));
  assert.ok(d.bookings.filter((b: any) => b.structureId === "s2").length === nY, "s2 invariata");
  assert.deepEqual(ids(d.bookings.filter((b: any) => b.structureId === "s1")), ids(parse(w.rows.X.readWindow(["s1"]).data).bookings));
  assert.equal(w.rows.X.rev, 1);
  dev.requested = null;                                                   // «Tutte»
  assert.equal(dev.cycle(w).wrote, false);
  const all = dev.data();
  assert.deepEqual([...new Set(all.bookings.map((b: any) => b.structureId))].sort(), ["s1", "s2", "s3"]);
  const t = all.bookings.find((b: any) => b.structureId === "s3" && b.id.endsWith("b65"));
  dev.edit((x) => { const b = x.bookings.find((q: any) => q.id === t.id); b.notes = "da Central Perk"; b.updatedAt = 7000; });
  assert.equal(dev.cycle(w).wrote, true);
  assert.equal(parse(w.rows.X.row).bookings.find((b: any) => b.id === t.id).notes, "da Central Perk");
  assert.equal(dev.blocked.length, 0);
});

test("3 strutture in 2 organizzazioni: s1+s3 vivono nella stessa riga, s2 in un'altra; aprire s1 non tocca la riga Y e viceversa", () => {
  const w = new World();
  const a = new ScopedDevice(["s1"]); a.cycle(w);
  assert.ok(a.data().bookings.every((b: any) => b.structureId === "s1"));
  const yBefore = snapRow(w, "Y");
  const t = a.data().bookings.find((b: any) => b.id === "s1-b61");
  a.edit((d) => { const b = d.bookings.find((q: any) => q.id === t.id); b.notes = "x"; b.updatedAt = 4000; });
  a.cycle(w);
  assert.equal(snapRow(w, "Y"), yBefore);
  assert.equal(parse(w.rows.X.row).bookings.find((b: any) => b.id === t.id).notes, "x");
  assert.deepEqual(serverIds(w, "X", "s3").length, 90);
  // un altro dispositivo aperto su s3 vede la modifica di s1 solo quando carica s1
  const b = new ScopedDevice(["s3"]); b.cycle(w);
  assert.ok(!b.data().bookings.some((q: any) => q.structureId === "s1"));
  b.requested = ["s3", "s1"]; b.cycle(w);
  assert.equal(b.data().bookings.find((q: any) => q.id === t.id).notes, "x");
});

test("una novità sul server in una struttura già caricata arriva; in una non caricata si vede appena la si carica", () => {
  const w = new World(); const dev = new ScopedDevice(["s2"]); dev.cycle(w);
  const y = parse(w.rows.Y.row); y.bookings.push(bk("s2", 801, day(3), day(5), { updatedAt: 9000 })); w.rows.Y.row[KEY] = JSON.stringify(y); w.rows.Y.rev++;
  const x = parse(w.rows.X.row); x.bookings.push(bk("s1", 802, day(3), day(5), { updatedAt: 9000 })); w.rows.X.row[KEY] = JSON.stringify(x); w.rows.X.rev++;
  dev.cycle(w);
  assert.ok(dev.data().bookings.some((b: any) => b.id === "s2-b801")); assert.ok(!dev.data().bookings.some((b: any) => b.id === "s1-b802"));
  dev.requested = ["s2", "s1"]; dev.cycle(w);
  assert.ok(dev.data().bookings.some((b: any) => b.id === "s1-b802"));
});

// ───────────────────────────── potatura della copia locale all'avvio ─────────────────────────────
test("potatura all'avvio: via le entità sincronizzate delle strutture non richieste; si tiene tutto ciò che potrebbe non essere ancora sincronizzato", () => {
  const w = new World(); const dev = new ScopedDevice(null); dev.cycle(w);
  const local = dev.data();
  // una prenotazione di s1 modificata di recente (non ancora inviata) e una senza timbro
  local.bookings.find((b: any) => b.id === "s1-b61").updatedAt = 50_000_000;
  delete local.bookings.find((b: any) => b.id === "s1-b62").updatedAt;
  local.guests.push({ id: "g-lead", fullName: "Contatto", updatedAt: 1000 });
  const syncedAt = 10_000_000;
  const pruned = W.pruneLocalToStructures(local, ["s2"], syncedAt, 120000, false) as any;
  const s1Left = pruned.bookings.filter((b: any) => b.structureId === "s1").map((b: any) => b.id).sort();
  assert.deepEqual(s1Left, ["s1-b61", "s1-b62"]);
  assert.equal(pruned.bookings.filter((b: any) => b.structureId === "s3").length, 0);
  assert.equal(pruned.bookings.filter((b: any) => b.structureId === "s2").length, local.bookings.filter((b: any) => b.structureId === "s2").length);
  assert.deepEqual(ids(pruned.structures), ["s1", "s2", "s3"]); assert.deepEqual(ids(pruned.units), ["u1", "u2", "u3"]);
  assert.ok(pruned.guests.some((g: any) => g.id === "g-s1-b61"), "l'ospite della prenotazione tenuta resta");
  assert.ok(!pruned.guests.some((g: any) => g.id === "g-s3-b50"), "ospite citato solo da prenotazioni tolte: via");
  assert.ok(pruned.guests.some((g: any) => g.id === "g-lead"), "contatto non citato da nessuna prenotazione: resta");
  // senza ultima sincronizzazione nota non si toglie nulla; richiesta «tutte» (null) nemmeno
  assert.equal(W.pruneLocalToStructures(local, ["s2"], 0), local); assert.equal(W.pruneLocalToStructures(local, null, syncedAt), local);
  // prezzi forzati: solo se garantiti invariati
  assert.ok("rt1|2026-10-20" in (W.pruneLocalToStructures(local, ["s2"], syncedAt, 120000, false) as any).rateOverrides);
  assert.ok(!("rt1|2026-10-20" in (W.pruneLocalToStructures(local, ["s2"], syncedAt, 120000, true) as any).rateOverrides));
  assert.ok("rt2|2026-10-20" in (W.pruneLocalToStructures(local, ["s2"], syncedAt, 120000, true) as any).rateOverrides);
});

test("riavvio con copia potata: il server resta identico e la copia si riallinea alla sola struttura richiesta", () => {
  const w = new World(); const first = new ScopedDevice(null); first.cycle(w);
  const pruned = W.pruneLocalToStructures(first.data(), ["s2"], Date.now() + 1e6) as any;
  const dev = new ScopedDevice(["s2"], { ...first.local, [KEY]: JSON.stringify(pruned) });
  const snaps = ["P", "X", "Y"].map((r) => snapRow(w, r as any));
  assert.equal(dev.cycle(w).wrote, false);
  assert.deepEqual(["P", "X", "Y"].map((r) => snapRow(w, r as any)), snaps);
  assert.ok(dev.data().bookings.every((b: any) => b.structureId === "s2"));
});

// ───────────────────────────── passaggio normale → veloce ─────────────────────────────
test("primo passaggio alla modalità veloce: le modifiche locali non ancora sincronizzate vengono salvate col sistema normale PRIMA di scartare la copia", () => {
  // simulazione: dispositivo normale con una modifica mai inviata → ciclo normale (blocco intero) → poi si riparte dalla finestra
  const srv = new SrvRow(makeWorld().Y);
  const local: any = parse(srv.row); local.bookings.find((b: any) => b.id === "s2-b61").notes = "offline"; local.bookings.find((b: any) => b.id === "s2-b61").updatedAt = 8000;
  const merged = Core.mergeSnapshots({ [KEY]: JSON.stringify(local) }, JSON.parse(JSON.stringify(srv.row)), {});
  assert.notEqual(Core.contentSig(merged), Core.contentSig(srv.row));
  srv.row = merged; srv.rev++;                                          // scrittura normale con il blocco intero
  const win = srv.readWindow(["s2"]);                                   // poi: copia locale scartata, finestra della sola struttura
  assert.equal(parse(win.data).bookings.find((b: any) => b.id === "s2-b61").notes, "offline");
  // e nel codice l'ordine è proprio questo: salvataggio normale (syncOnce) prima di kvRemove della copia
  const src = readFileSync(new URL("../src/lib/authsync.tsx", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function prepareDeltaMode"), src.indexOf("async function prepareDeltaMode") + 2500);
  assert.ok(fn.indexOf("await syncOnce(") > 0 && fn.indexOf("await syncOnce(") < fn.indexOf('kvRemove("spigolestay:data:v1")'), "syncOnce prima di scartare la copia locale");
  assert.ok(fn.indexOf("restore(r.newBlob)") > 0 && fn.indexOf("restore(r.newBlob)") < fn.indexOf('kvRemove("spigolestay:data:v1")'));
});

// ───────────────────────────── stato di caricamento (struct-load) ─────────────────────────────
test("struct-load: fuori dalla modalità veloce tutto è già caricato; ensureLoaded non chiama il caricatore per ciò che c'è, lo chiama una volta per ciò che manca", async () => {
  SL.__resetStructLoad();
  assert.equal(SL.structureLoaded("s1"), true); assert.equal(await SL.ensureLoaded(["s1"], "Spigolehouse"), true); assert.equal(SL.requestedParam(), null);
  SL.setDeltaScopeActive(true); SL.initRequested(["s2"]);
  assert.equal(SL.requestedParam(), "s2"); assert.deepEqual(SL.requestedIds(), ["s2"]);
  assert.equal(SL.structureLoaded("s2"), false, "richiesta ≠ caricata");
  SL.markLoaded(SL.requestedSnapshot());
  assert.equal(SL.structureLoaded("s2"), true); assert.equal(SL.structureLoaded("s1"), false);
  const calls: string[][] = [];
  SL.registerLoader(async (need: string[], all: boolean) => { calls.push(need); SL.addRequested(need, all); SL.markLoaded(SL.requestedSnapshot()); return true; });
  assert.equal(await SL.ensureLoaded(["s2"], "Spigolerooms"), true); assert.equal(calls.length, 0, "già caricata: non si riscarica");
  assert.equal(await SL.ensureLoaded(["s2", "s1"], "Spigolehouse"), true); assert.deepEqual(calls, [["s1"]]);
  assert.equal(await SL.ensureLoaded(["s1"], "Spigolehouse"), true); assert.equal(calls.length, 1);
  assert.equal(SL.getStructLoadSnapshot().error, ""); assert.deepEqual(SL.getStructLoadSnapshot().loading, []);
  SL.__resetStructLoad();
});

test("struct-load: errore di rete = false, messaggio chiaro, nulla risulta caricato; poi un nuovo tentativo riesce", async () => {
  SL.__resetStructLoad(); SL.setDeltaScopeActive(true); SL.initRequested(["s2"]); SL.markLoaded(SL.requestedSnapshot());
  let fail = true; let seen = "";
  SL.registerLoader(async (need: string[], all: boolean) => { seen = SL.getStructLoadSnapshot().loading.join("|"); if (fail) throw new Error("rete"); SL.addRequested(need, all); SL.markLoaded(SL.requestedSnapshot()); return true; });
  assert.equal(await SL.ensureLoaded(["s3"], "Central Perk"), false);
  assert.equal(seen, "Central Perk", "mentre carica c'è l'indicatore");
  const s = SL.getStructLoadSnapshot(); assert.deepEqual(s.loading, []); assert.match(s.error, /Central Perk/); assert.match(s.error, /Resti sulla vista di prima/);
  assert.equal(SL.structureLoaded("s3"), false); assert.equal(SL.structureLoaded("s2"), true);
  fail = false; assert.equal(await SL.ensureLoaded(["s3"], "Central Perk"), true); assert.equal(SL.getStructLoadSnapshot().error, ""); assert.equal(SL.structureLoaded("s3"), true);
  // «Tutte»: si chiede tutto senza filtro
  SL.__resetStructLoad(); SL.setDeltaScopeActive(true); SL.initRequested(["s2"]);
  SL.registerLoader(async (need: string[], all: boolean) => { SL.addRequested(need, all); SL.markLoaded(SL.requestedSnapshot()); return true; });
  assert.equal(await SL.ensureLoaded(["s1", "s2", "s3"], "tutte", true), true);
  assert.equal(SL.requestedParam(), null); assert.equal(SL.requestedIds(), null); assert.equal(SL.structureLoaded("s9"), true);
  SL.__resetStructLoad();
});

test("struct-load: struttura creata qui = già caricata e richiesta; progressivo dei codici dal massimo del server", () => {
  SL.__resetStructLoad(); SL.setDeltaScopeActive(true); SL.initRequested(["s2"]);
  SL.addLocalStructure("nuova"); assert.equal(SL.structureLoaded("nuova"), true); assert.ok(SL.requestedIds()!.includes("nuova"));
  SL.noteCodeMax("org_state:X", { "2026": 3089 }); SL.noteCodeMax("org_state:Y", { "2026": 2089, "2025": 5 });
  assert.equal(SL.codeMaxFor("2026"), 3089); assert.equal(SL.codeMaxFor("2025"), 5); assert.equal(SL.codeMaxFor("2024"), 0);
  SL.noteCodeMax("org_state:X", { "2026": 3100 }); assert.equal(SL.codeMaxFor("2026"), 3100);
  SL.__resetStructLoad();
});

// ───────────────────────────── struttura di apertura (UI/stato) ─────────────────────────────
const SORTED = ["s1", "s2", "s3"];
test("struttura di apertura: di default la PRINCIPALE (prima dell'elenco ordinato), non «Tutte» né l'ultima usata", () => {
  const sel = H.resolveSelection({ pref: null, sortedIds: SORTED, savedActive: "s3", savedSubset: null, sessionApplied: false });
  assert.deepEqual(sel, { active: "s1", subset: [] });
  assert.deepEqual(H.resolveSelection({ pref: "", sortedIds: SORTED, savedActive: "all", savedSubset: "", sessionApplied: false }), { active: "s1", subset: [] });
  assert.deepEqual(H.resolveSelection({ pref: "zzz", sortedIds: SORTED, savedActive: null, savedSubset: null, sessionApplied: false }), { active: "s1", subset: [] }, "preferenza non valida = principale");
  assert.deepEqual(H.resolveSelection({ pref: null, sortedIds: [], savedActive: "s3", savedSubset: null, sessionApplied: false }), { active: "all", subset: [] });
  // l'ordine è quello scelto dal titolare: le proprie prima, poi le condivise, poi «order», poi il nome
  const order = H.sortStructures([{ id: "c", name: "C", orgId: "o" }, { id: "b", name: "B", order: 1 }, { id: "a", name: "A", order: 0 }, { id: "d", name: "D" }]).map((s) => s.id);
  assert.deepEqual(order, ["a", "b", "d", "c"]);
});

test("struttura di apertura: preferenza = id | last | all; ricaricamento nella stessa sessione = si mantiene la scelta fatta", () => {
  assert.deepEqual(H.resolveSelection({ pref: "s3", sortedIds: SORTED, savedActive: "s2", savedSubset: null, sessionApplied: false }), { active: "s3", subset: [] });
  assert.deepEqual(H.resolveSelection({ pref: "all", sortedIds: SORTED, savedActive: "s2", savedSubset: null, sessionApplied: false }), { active: "all", subset: [] });
  assert.deepEqual(H.resolveSelection({ pref: "last", sortedIds: SORTED, savedActive: "s2", savedSubset: null, sessionApplied: false }), { active: "s2", subset: [] });
  assert.deepEqual(H.resolveSelection({ pref: "last", sortedIds: SORTED, savedActive: "gone", savedSubset: null, sessionApplied: false }), { active: "s1", subset: [] }, "l'ultima non esiste più: principale");
  assert.deepEqual(H.resolveSelection({ pref: "last", sortedIds: SORTED, savedActive: "all", savedSubset: "s1,s3", sessionApplied: false }), { active: "all", subset: ["s1", "s3"] });
  // dopo l'apertura la scelta dell'utente non viene scavalcata dai ricaricamenti
  assert.deepEqual(H.resolveSelection({ pref: "s1", sortedIds: SORTED, savedActive: "s3", savedSubset: null, sessionApplied: true }), { active: "s3", subset: [] });
  assert.deepEqual(H.resolveSelection({ pref: "s1", sortedIds: SORTED, savedActive: "all", savedSubset: null, sessionApplied: true }), { active: "all", subset: [] });
  assert.deepEqual(H.selectionIds({ active: "s2", subset: [] }, SORTED), ["s2"]); assert.equal(H.selectionIds({ active: "all", subset: [] }, SORTED), "all");
  assert.deepEqual(H.selectionIds({ active: "all", subset: ["s1", "s2"] }, SORTED), ["s1", "s2"]);
});

test("indicazione di avvio (hint): cosa scaricare PRIMA di conoscere l'elenco delle strutture", () => {
  assert.deepEqual(H.nextOpenHint(null, SORTED, "s3", null), ["s1"]);
  assert.deepEqual(H.nextOpenHint("last", SORTED, "s3", null), ["s3"]);
  assert.equal(H.nextOpenHint("all", SORTED, "s3", null), "all");
  assert.deepEqual(H.parseStartHint(H.serializeStartHint(["s1", "s2"])), ["s1", "s2"]); assert.equal(H.parseStartHint(H.serializeStartHint("all")), "all");
  assert.equal(H.parseStartHint("{rotto"), null); assert.equal(H.parseStartHint("[]"), null); assert.equal(H.parseStartHint(null), null);
  // primo avvio: nessuna indicazione → null (si scaricano solo strutture/camere, poi si completa); stessa sessione: vale l'ultima scelta
  assert.equal(H.startRequest({ sessionApplied: false, savedActive: "s3", savedSubset: null, hintRaw: null }), null);
  assert.deepEqual(H.startRequest({ sessionApplied: false, savedActive: "s3", savedSubset: null, hintRaw: '["s1"]' }), ["s1"]);
  assert.deepEqual(H.startRequest({ sessionApplied: true, savedActive: "s3", savedSubset: null, hintRaw: '["s1"]' }), ["s3"]);
  assert.equal(H.startRequest({ sessionApplied: true, savedActive: "all", savedSubset: null, hintRaw: '["s1"]' }), "all");
  assert.deepEqual(H.startRequest({ sessionApplied: true, savedActive: "all", savedSubset: "s1,s2", hintRaw: null }), ["s1", "s2"]);
  // senza indicazione la richiesta è «nessuna struttura»: la prima lettura è leggerissima e il completamento carica la principale
  const w = new World(); const dev = new ScopedDevice([]); dev.cycle(w);
  assert.equal(dev.data().bookings.length, 0); assert.deepEqual(ids(dev.data().structures), ["s1", "s2", "s3"]);
  dev.requested = ["s1"]; dev.cycle(w);
  assert.ok(dev.data().bookings.length > 0 && dev.data().bookings.every((b: any) => b.structureId === "s1"));
  assert.equal(w.rows.X.rev, 1);
});

// ───────────────────────────── semantica nuova della modalità veloce (default acceso) ─────────────────────────────
const OWNER = "285dccf2-726b-4120-9efa-88ab576a06f6";
test("modalità veloce di default: chiave assente o «1» = accesa solo per gli account in allowlist; «0» = spenta dall'utente", () => {
  assert.equal(A.deltaWantedFrom(OWNER, null, null), true, "assente = acceso");
  assert.equal(A.deltaWantedFrom(OWNER, undefined, undefined), true);
  assert.equal(A.deltaWantedFrom(OWNER, "1", null), true);
  assert.equal(A.deltaWantedFrom(OWNER, "0", null), false, "spenta di proposito");
  assert.equal(A.deltaWantedFrom("altro-account", null, null), false, "fuori allowlist: mai");
  assert.equal(A.deltaWantedFrom("altro-account", "1", null), false);
  assert.equal(A.deltaWantedFrom("", null, null), false); assert.equal(A.deltaWantedFrom(null, null, null), false); assert.equal(A.deltaWantedFrom(undefined, "1", null), false);
});

test("fallimento di sessione: la lettura veloce fallita spegne la modalità solo per quella sessione (nessun loop, scelta dell'utente intatta)", () => {
  assert.equal(A.deltaWantedFrom(OWNER, null, OWNER), false, "in questa sessione si resta in modalità normale");
  assert.equal(A.deltaWantedFrom(OWNER, "1", OWNER), false);
  assert.equal(A.deltaWantedFrom(OWNER, null, "un-altro-uid"), true, "il marcatore è per uid");
  assert.equal(A.deltaWantedFrom(OWNER, null, null), true, "nuova sessione: riprova da sola");
  // nel codice il fallimento scrive il marcatore di SESSIONE e non tocca più la scelta dell'utente
  const src = readFileSync(new URL("../src/lib/authsync.tsx", import.meta.url), "utf8");
  assert.ok(/sessionStorage\.setItem\(DELTA_FAILED_KEY, uid\)/.test(src));
  assert.ok(!/localStorage\.removeItem\(DELTA_FLAG_KEY\)/.test(src), "la scelta dell'utente non viene più cancellata");
  const card = readFileSync(new URL("../src/components/FastModeCard.tsx", import.meta.url), "utf8");
  assert.ok(/setItem\(DELTA_FLAG_KEY, next \? "1" : "0"\)/.test(card), "l'interruttore scrive 1/0");
});
