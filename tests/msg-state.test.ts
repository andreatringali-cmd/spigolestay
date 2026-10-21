import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const Core = await import("../src/lib/sync-core.ts");
const W = await import("../src/lib/sync-window.ts");
const D = await import("../src/lib/sync-delta.ts");
const Split = await import("../src/lib/org-split.ts");
const OrgCfg = await import("../src/lib/org-cassa-config.ts");
const Combine = await import("../src/lib/org-combine.ts");
const Canon = await import("../src/lib/sync-canon.ts");
const Sim = await import("./helpers/sync-sim.ts");
const M = await import("../src/lib/msg-state.ts");
const L = { Core, W, D, Split, OrgCfg, Combine, Canon };
const { KEY } = Sim;
const K = M.MSG_STATE_KEY;

type State = Record<string, any>;
const st = (raw: string | undefined): State => M.parseMsgState(raw);
const ALL = ["u-andrea", "u-greta", "u-stefano"].map((u) => "app:" + u).concat(["org:o1"]);
const writesNow = (srv: InstanceType<typeof Sim.Srv>): number => ALL.reduce((n, id) => n + srv.totalWrites(id), 0);
// Una persona tocca lo stato dal proprio dispositivo (come la pagina Messaggi: scrive la chiave locale).
const act = (d: InstanceType<typeof Sim.Dev>, fn: (s: State) => State) => { d.local = { ...d.local, [K]: M.serializeMsgState(fn(st(d.local[K]))) }; };

// ── convergenza a 3 dispositivi (titolare in modalita' veloce, due soci in normale) ──────────────────────────────────────────────────────────
test("messaggi OTA: 3 dispositivi segnano letto / non serve rispondere in contemporanea: tutti convergono e poi NESSUNO riscrive", () => {
  const { srv, titolare, greta, stefano } = Sim.scenario(L);
  const devs = [titolare, greta, stefano];
  for (let r = 0; r < 4; r++) for (const d of devs) d.cycle(srv);          // assestamento della configurazione di Cassa
  const T0 = 1_000_000;
  // stesso momento, tre persone diverse, conversazioni diverse + una in comune
  act(titolare, (s) => M.markSeen(s, "t-uno", 500, "Andrea", T0 + 1, "sh"));
  act(greta, (s) => M.setNoReply(M.markSeen(s, "t-due", 700, "Greta", T0 + 2, "sr"), "t-due", true, 700, "Greta", T0 + 3, "sr"));
  act(stefano, (s) => M.markSeen(s, "t-tre", 900, "Stefano", T0 + 4)); // richiesta di informazioni: nessuna struttura
  act(greta, (s) => M.markSeen(s, "t-uno", 650, "Greta", T0 + 5, "sh"));  // la stessa conversazione vista da due persone: vince il piu' recente
  for (let r = 0; r < 6; r++) for (const d of devs) d.cycle(srv);
  const expected = M.serializeMsgState(M.mergeMsgStates(st(titolare.local[K]), st(greta.local[K]), st(stefano.local[K])));
  for (const d of devs) assert.equal(M.serializeMsgState(st(d.local[K])), expected, d.name + " ha lo stesso stato");
  const final = st(expected);
  assert.equal(final["t-uno"].seenAt, 650, "letto = il piu' avanti");
  assert.equal(final["t-due"].noReply, true);
  assert.equal(final["t-tre"].seenAt, 900);
  // stato di regime: nessuna scrittura e nessuna versione che sale
  const before = writesNow(srv);
  const orgRev = srv.rows.get("org:o1")!.rev;
  for (let r = 0; r < 10; r++) for (const d of devs) d.cycle(srv);
  assert.equal(writesNow(srv), before, "nessuna scrittura a regime");
  assert.equal(srv.rows.get("org:o1")!.rev, orgRev);
  // la parte condivisa e' nell'org (strutture sh/sr + richieste senza struttura)
  assert.deepEqual(Object.keys(st(srv.flat("org:o1", K))).sort(), ["t-due", "t-tre", "t-uno"]);
});

test("messaggi OTA: «non serve rispondere» attivato da uno e tolto da un altro: vince l'ultimo, uguale per tutti; poi una nuova modifica passa", () => {
  const { srv, titolare, greta, stefano } = Sim.scenario(L);
  const devs = [titolare, greta, stefano];
  for (let r = 0; r < 4; r++) for (const d of devs) d.cycle(srv);
  act(greta, (s) => M.setNoReply(s, "t-x", true, 800, "Greta", 2_000_000, "sh"));
  act(stefano, (s) => M.setNoReply(s, "t-x", false, 800, "Stefano", 2_000_500, "sh"));
  for (let r = 0; r < 6; r++) for (const d of devs) d.cycle(srv);
  for (const d of devs) assert.equal(st(d.local[K])["t-x"].noReply, false, d.name);
  // ora Andrea lo riattiva (piu' recente di tutto): arriva a tutti
  act(titolare, (s) => M.setNoReply(s, "t-x", true, 800, "Andrea", 2_001_000, "sh"));
  for (let r = 0; r < 6; r++) for (const d of devs) d.cycle(srv);
  for (const d of devs) assert.equal(st(d.local[K])["t-x"].noReply, true, d.name);
  assert.equal(st(greta.local[K])["t-x"].nrBy, "Andrea");
});

test("messaggi OTA: una conversazione di una struttura che NON e' dell'org resta personale (non sale sull'org)", () => {
  const { srv, titolare, greta, stefano } = Sim.scenario(L);
  const devs = [titolare, greta, stefano];
  for (let r = 0; r < 4; r++) for (const d of devs) d.cycle(srv);
  act(greta, (s) => M.markSeen(s, "t-privata", 300, "Greta", 3_000_000, "struttura-personale"));
  for (let r = 0; r < 6; r++) for (const d of devs) d.cycle(srv);
  assert.ok(!("t-privata" in st(srv.flat("org:o1", K))), "non nell'org");
  assert.ok(!("t-privata" in st(titolare.local[K])), "non arriva agli altri soci");
  assert.ok("t-privata" in st(greta.local[K]), "resta a chi l'ha fatta");
});

// ── fusione (proprieta' di un CRDT) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const rnd = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const randEntry = (r: () => number): any => ({ seenAt: Math.floor(r() * 5) * 100, noReply: r() > 0.5, nrAt: Math.floor(r() * 4), nrFor: Math.floor(r() * 3) * 100, nrBy: ["a", "b", ""][Math.floor(r() * 3)], by: ["a", "b", ""][Math.floor(r() * 3)], at: Math.floor(r() * 4), ...(r() > 0.5 ? { sid: ["s1", "s2"][Math.floor(r() * 2)] } : {}) });

test("mergeEntry: commutativa, associativa e idempotente (qualunque ordine di incontro dei dispositivi dà lo stesso risultato)", () => {
  const r = rnd(7);
  for (let i = 0; i < 300; i++) {
    const a = randEntry(r), b = randEntry(r), c = randEntry(r);
    assert.deepEqual(M.mergeEntry(a, b), M.mergeEntry(b, a));
    assert.deepEqual(M.mergeEntry(M.mergeEntry(a, b), c), M.mergeEntry(a, M.mergeEntry(b, c)));
    assert.deepEqual(M.mergeEntry(a, a), a);
  }
});

test("mergeMsgStateRaw: testo canonico (ordine delle chiavi irrilevante), valori rovinati ignorati, assente+assente = null", () => {
  const e = (seenAt: number) => ({ seenAt, noReply: false, nrAt: 0, nrFor: 0, nrBy: "", by: "x", at: 1 });
  const a = JSON.stringify({ b: e(2), a: e(1) }), b = JSON.stringify({ a: e(1), b: e(2) });
  assert.equal(M.mergeMsgStateRaw(a, b), M.mergeMsgStateRaw(b, a));
  assert.equal(M.mergeMsgStateRaw(a, a), M.serializeMsgState(st(a)));
  assert.equal(M.mergeMsgStateRaw(undefined, undefined), null);
  assert.equal(M.mergeMsgStateRaw("{rotto", a), M.serializeMsgState(st(a)));
  assert.deepEqual(M.parseMsgState(JSON.stringify({ x: 5, y: null, z: { seenAt: -4, noReply: "si" } })), { z: { seenAt: 0, noReply: false, nrAt: 0, nrFor: 0, nrBy: "", by: "", at: 0 } });
});

test("mergeSnapshots: il segno condiviso NON viene sostituito in blocco dal server ne' dal locale (unione), e non e' una chiave a 3 vie", () => {
  const mine = M.serializeMsgState(M.markSeen({}, "t1", 100, "A", 10));
  const theirs = M.serializeMsgState(M.markSeen({}, "t2", 200, "B", 20));
  const merged = Core.mergeSnapshots({ [K]: mine }, { [K]: theirs }, { [K]: theirs }, {});
  assert.deepEqual(Object.keys(st(merged[K])).sort(), ["t1", "t2"]);
  assert.equal(Core.isFlatMergeSkip(K), true);
});

// ── estrazione / applicazione sull'org ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("extract/applyOrgMsgState: solo le voci dell'org (o senza struttura), parte vuota non tocca il server, applicare due volte non cambia nulla", () => {
  const sids = new Set(["sh", "sr"]);
  let s: State = {};
  s = M.markSeen(s, "t-sh", 10, "A", 1, "sh");
  s = M.markSeen(s, "t-altra", 10, "A", 1, "altra");
  s = M.markSeen(s, "t-info", 10, "A", 1);
  const out = OrgCfg.extractOrgMsgState({ [K]: M.serializeMsgState(s) }, sids);
  assert.deepEqual(Object.keys(st(out[K])).sort(), ["t-info", "t-sh"]);
  assert.deepEqual(OrgCfg.extractOrgMsgState({}, sids), {});
  assert.deepEqual(OrgCfg.extractOrgMsgState({ [K]: M.serializeMsgState(M.markSeen({}, "x", 5, "A", 1, "altra")) }, sids), {});
  const local = { [K]: M.serializeMsgState(M.markSeen({}, "t-mia", 5, "A", 1, "sh")) };
  const applied = OrgCfg.applyOrgMsgState(local, out, sids);
  assert.deepEqual(Object.keys(st(applied[K])).sort(), ["t-info", "t-mia", "t-sh"]);
  assert.deepEqual(OrgCfg.applyOrgMsgState({ [K]: applied[K] }, out, sids), {}, "idempotente");
  assert.deepEqual(OrgCfg.applyOrgMsgState(local, {}, sids), {});
});

// ── logica usata dalla pagina ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("letto: soglia iniziale, markSeen idempotente (stesso oggetto = nessuna scrittura), migrazione del vecchio segno locale", () => {
  let s = M.initIfEmpty({}, "A", 1000);
  assert.equal(M.seenAtOf(s, "qualsiasi"), 1000, "storico gia' presente = letto");
  assert.equal(M.initIfEmpty(s, "B", 5000), s, "non si reinizializza");
  const same = M.markSeen(s, "t1", 900, "A", 1100);
  assert.equal(same, s, "sotto la soglia: nessuna voce");
  const s2 = M.markSeen(s, "t1", 2000, "A", 2100, "sh");
  assert.equal(M.seenAtOf(s2, "t1"), 2000);
  assert.equal(M.markSeen(s2, "t1", 2000, "A", 2200, "sh"), s2, "gia' visto: stesso oggetto");
  assert.equal(M.markSeen(s2, "t1", 1500, "A", 2200), s2, "mai all'indietro");
  const mig = M.migrateOldSeen({}, { a: 10, b: 20, c: "x" }, "migrazione", 50);
  assert.deepEqual(Object.keys(mig).sort(), ["a", "b"]);
  assert.equal(M.migrateOldSeen(mig, null, "m", 60), mig);
});

test("«non serve rispondere»: cade da solo se l'ospite scrive ancora dopo il segno, e si può togliere", () => {
  let s = M.setNoReply({}, "t1", true, 800, "Greta", 5000, "sh");
  assert.equal(M.noReplyActive(s, "t1", 800), true);
  assert.equal(M.noReplyActive(s, "t1", 801), false, "nuovo messaggio dell'ospite: torna in attesa");
  s = M.setNoReply(s, "t1", false, 800, "Andrea", 5001, "sh");
  assert.equal(M.noReplyActive(s, "t1", 800), false);
  assert.equal(M.noReplyActive(s, "sconosciuta", 1), false);
  // il rilevamento successivo vince anche con orologi quasi uguali: nrAt sempre crescente per lo stesso dispositivo
  const quick = M.setNoReply(M.setNoReply({}, "t", true, 1, "A", 100), "t", false, 1, "A", 100);
  assert.equal(quick["t"].noReply, false);
  assert.ok(quick["t"].nrAt > 100);
});

// ── elenco: filtri, ordine, attesa ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const Inbox = await import("../src/lib/msg-inbox.ts");
const th = (id: string, o: Record<string, unknown> = {}) => ({ id, title: id, provider: "BookingCom", closed: false, count: 3, lastMessage: "ciao", lastAt: 1_000, lastSender: "guest", bookingId: "", propertyId: "p", ...o }) as any;

test("elenco: «in attesa» = ultimo messaggio dell'ospite, aperta, non segnata; segnata/risposta/chiusa NO; «letto» e «aperta ora» valgono per i non letti", () => {
  const NOW = 10 * 3600_000;
  const base = M.initIfEmpty({}, "A", 500); // storico < 500 gia' letto
  const f = (t: any, s = base, open: string | null = null) => Inbox.threadFlags(t, s, NOW, open);
  assert.equal(f(th("a", { lastAt: 2000 })).waiting, true);
  assert.equal(f(th("a", { lastAt: 2000 })).unread, true);
  assert.equal(f(th("a", { lastAt: 400 })).unread, false, "prima della soglia iniziale");
  assert.equal(f(th("a", { lastAt: 2000, lastSender: "property" })).waiting, false, "ha risposto la struttura");
  assert.equal(f(th("a", { lastAt: 2000, lastSender: "system" })).waiting, false);
  assert.equal(f(th("a", { lastAt: 2000, closed: true })).waiting, false);
  assert.equal(f(th("a", { lastAt: 2000 }), base, "a").unread, false, "aperta ora");
  const seen = M.markSeen(base, "a", 2000, "Greta", 3000);
  assert.equal(f(th("a", { lastAt: 2000 }), seen).unread, false, "vista da Greta = letta anche per gli altri");
  assert.equal(f(th("a", { lastAt: 2001 }), seen).unread, true, "nuovo messaggio dopo");
  const nr = M.setNoReply(seen, "a", true, 2000, "Greta", 3100);
  assert.deepEqual([f(th("a", { lastAt: 2000 }), nr).waiting, f(th("a", { lastAt: 2000 }), nr).noReply], [false, true]);
  assert.deepEqual([f(th("a", { lastAt: 2500 }), nr).waiting, f(th("a", { lastAt: 2500 }), nr).noReply], [true, false], "l'ospite ha riscritto: torna in attesa");
  const c = Inbox.countByFilter([f(th("a", { lastAt: 2000 })), f(th("b", { lastAt: 2000 }), nr), f(th("c", { lastSender: "property", lastAt: 2000 }))]);
  assert.deepEqual(c, { waiting: 2, unread: 2, all: 3, noreply: 0 }); // "a" e "b" aspettano; il segno e' su "a" ma qui le righe sono "a" senza segno e "b" (id diverso)
});

test("attesa: etichetta e soglia delle 24 ore (rosso solo oltre)", () => {
  assert.equal(Inbox.waitLabel(20_000), "meno di 1 min");
  assert.equal(Inbox.waitLabel(45 * 60_000), "45 min");
  assert.equal(Inbox.waitLabel(3 * 3600_000), "3 h");
  assert.equal(Inbox.waitLabel(47 * 3600_000), "47 h");
  assert.equal(Inbox.waitLabel(72 * 3600_000), "3 g");
  const s = M.initIfEmpty({}, "A", 1);
  const NOW = 100 * 3600_000;
  assert.equal(Inbox.threadFlags(th("x", { lastAt: NOW - 3 * 3600_000 }), s, NOW).overdue, false);
  assert.equal(Inbox.threadFlags(th("x", { lastAt: NOW - 24 * 3600_000 }), s, NOW).overdue, false, "esattamente 24 h non e' ancora in ritardo");
  assert.equal(Inbox.threadFlags(th("x", { lastAt: NOW - 25 * 3600_000 }), s, NOW).overdue, true);
  assert.equal(Inbox.threadFlags(th("x", { lastAt: NOW - 25 * 3600_000, lastSender: "property" }), s, NOW).waitMs, 0);
});

test("ordine: «arrivo più vicino» (futuri dal più vicino, poi già arrivati, annullate, senza prenotazione) e «più recenti»", () => {
  const T = "2026-10-19";
  const rk = (ci: string | null, status = "confirmed") => Inbox.arrivalRank(ci ? { checkIn: ci, status } : undefined, T);
  assert.ok(rk("2026-10-19") < rk("2026-10-25"));
  assert.ok(rk("2026-10-25") < rk("2026-11-30"));
  assert.ok(rk("2026-11-30") < rk("2026-10-18"), "il passato viene dopo ogni arrivo futuro");
  assert.ok(rk("2026-10-18") < rk("2026-10-01"), "tra i già arrivati prima il più recente");
  assert.ok(rk("2026-10-01") < rk("2026-10-25", "cancelled"));
  assert.ok(rk("2026-10-25", "cancelled") < rk(null));
  const rows = [{ t: th("old", { lastAt: 1 }), rank: rk("2026-10-20") }, { t: th("new", { lastAt: 9 }), rank: rk("2026-12-01") }, { t: th("none", { lastAt: 5 }), rank: rk(null) }];
  assert.deepEqual(Inbox.sortRows(rows, "recent").map((r) => r.t.id), ["new", "none", "old"]);
  assert.deepEqual(Inbox.sortRows(rows, "arrival").map((r) => r.t.id), ["old", "new", "none"]);
  assert.deepEqual(rows.map((r) => r.t.id), ["old", "new", "none"], "non modifica l'elenco di partenza");
});
