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
const L = { Core, W, D, Split, OrgCfg, Combine, Canon };
const { KEY, CONTI, GUEST_G } = Sim;

// Produzione (21/10/2026): la riga condivisa dell'org veniva RISCRITTA ogni 20-60 s da piu' dispositivi, alternando varianti che differivano solo per
//  (1) l'ORDINE dei conti di Cassa (ogni dispositivo rimandava il proprio: la fusione tiene l'ordine locale e la firma di contenuto era sensibile all'ordine);
//  (2) un ospite (id ecedd175…) tolto da un dispositivo a finestra («modalita' veloce», che non ha la prenotazione che lo cita) e rimesso dagli altri.
const keysOf = (raw: string | undefined): string[] => (JSON.parse(raw ?? "[]") as { key: string }[]).map((c) => c.key);
const orgGuests = (srv: InstanceType<typeof Sim.Srv>): string[] => (srv.data("org:o1").guests as { id: string }[]).map((g) => g.id);
const ALL = ["u-andrea", "u-greta", "u-stefano"].map((u) => "app:" + u).concat(["org:o1"]);
const writesNow = (srv: InstanceType<typeof Sim.Srv>): number => ALL.reduce((n, id) => n + srv.totalWrites(id), 0);

test("3 dispositivi con ordini dei conti e viste diverse: dopo pochi cicli lo stato converge e NESSUNO riscrive piu'", () => {
  const { srv, titolare, greta, stefano } = Sim.scenario(L);
  const devs = [titolare, greta, stefano];
  for (let r = 0; r < 4; r++) for (const d of devs) d.cycle(srv);           // assestamento
  const before = writesNow(srv);
  const orgRev = srv.rows.get("org:o1")!.rev;
  for (let r = 0; r < 10; r++) for (const d of devs) d.cycle(srv);          // stato di regime
  assert.equal(writesNow(srv), before, "nessuna scrittura a regime");
  assert.equal(srv.rows.get("org:o1")!.rev, orgRev, "la versione della riga condivisa non sale piu'");
  // valore condiviso deterministico (per chiave) e identico per tutti
  assert.deepEqual(keysOf(srv.flat("org:o1", CONTI)), ["banca", "contanti", "conto-revolut"]);
  for (const d of devs) assert.deepEqual([...keysOf(d.local[CONTI])].sort(), ["banca", "contanti", "conto-revolut"]);
  // l'ospite non e' mai stato cancellato dal server e tutti lo hanno
  assert.ok(orgGuests(srv).includes(GUEST_G));
  for (const d of devs) assert.ok((d.data().guests as { id: string }[]).some((g) => g.id === GUEST_G), d.name + " ha l'ospite");
  // il dispositivo veloce non ha mai mandato una cancellazione di ospiti
  assert.equal(srv.deltas.filter((x) => x.id === "org:o1" && ((x.delta as any).colls?.guests?.del?.length ?? 0) > 0).length, 0);
});

test("l'ordine di VISUALIZZAZIONE dei conti resta nelle preferenze locali e non cambia il valore sincronizzato", () => {
  const { srv, titolare, greta, stefano } = Sim.scenario(L);
  for (let r = 0; r < 4; r++) for (const d of [titolare, greta, stefano]) d.cycle(srv);
  const shared = srv.flat("org:o1", CONTI);
  // il titolare riordina i conti (cambia solo conti-prefs.order, per dispositivo: non e' una chiave dell'org)
  const prefs = JSON.parse(titolare.local["spigolestay:cassa:conti-prefs"]);
  titolare.local = { ...titolare.local, "spigolestay:cassa:conti-prefs": JSON.stringify({ ...prefs, order: ["contanti", "conto-revolut", "banca"] }) };
  for (let r = 0; r < 3; r++) for (const d of [titolare, greta, stefano]) d.cycle(srv);
  assert.equal(srv.flat("org:o1", CONTI), shared);
  assert.equal(srv.totalWrites("org:o1"), 1);
});

test("guardiano: stesso contenuto con liste di oggetti con id in ordine diverso = NON si scrive", () => {
  const { srv, titolare, greta, stefano } = Sim.scenario(L);
  const devs = [titolare, greta, stefano];
  for (let r = 0; r < 4; r++) for (const d of devs) d.cycle(srv);
  const before = writesNow(srv);
  // il server riceve da fuori (altro client/script) lo STESSO contenuto in altro ordine: conti rovesciati, ospiti e prenotazioni rimescolati
  const row = srv.rows.get("org:o1")!;
  const data = JSON.parse(row.data[KEY]);
  data.guests.reverse(); data.bookings.reverse();
  row.data[KEY] = JSON.stringify(data);
  row.data[CONTI] = JSON.stringify(JSON.parse(row.data[CONTI]).reverse());
  for (let r = 0; r < 5; r++) for (const d of devs) d.cycle(srv);
  assert.equal(writesNow(srv), before, "nessuna riscrittura per il solo ordine");
});

test("una modifica VERA (nome di un conto) si scrive una volta e arriva a tutti", () => {
  const { srv, titolare, greta, stefano } = Sim.scenario(L);
  const devs = [titolare, greta, stefano];
  for (let r = 0; r < 4; r++) for (const d of devs) d.cycle(srv);
  const base = srv.totalWrites("org:o1");
  const conti = JSON.parse(greta.local[CONTI]) as { key: string; label: string }[];
  conti.find((c) => c.key === "banca")!.label = "Banca BAPS";
  greta.local = { ...greta.local, [CONTI]: JSON.stringify(conti) };
  for (let r = 0; r < 6; r++) for (const d of devs) d.cycle(srv);
  assert.equal(srv.totalWrites("org:o1"), base + 1);
  for (const d of devs) assert.equal((JSON.parse(d.local[CONTI]) as { key: string; label: string }[]).find((c) => c.key === "banca")!.label, "Banca BAPS", d.name);
});

test("una cancellazione VERA dell'ospite (con lapide) passa, non risorge e non viene trattenuta", () => {
  const { srv, titolare, greta, stefano } = Sim.scenario(L);
  const devs = [titolare, greta, stefano];
  for (let r = 0; r < 4; r++) for (const d of devs) d.cycle(srv);
  // Greta elimina l'ospite: via dall'elenco + lapide (come deleteGuest dello store)
  const d = greta.data() as any;
  d.guests = d.guests.filter((g: any) => g.id !== GUEST_G);
  d.bookings = d.bookings.filter((b: any) => b.id !== "b-G");
  d._deleted = { ...(d._deleted ?? {}), guests: [GUEST_G], bookings: ["b-G"] };
  greta.local = { ...greta.local, [KEY]: JSON.stringify(d) };
  for (let r = 0; r < 6; r++) for (const dev of devs) dev.cycle(srv);
  assert.ok(!orgGuests(srv).includes(GUEST_G), "tolto dal server");
  // la copia PERSONALE di chi non ha cancellato puo' restare (la lapide viaggia nell'org, come prima), ma nell'org nessuno lo rimette
  for (const dev of devs) assert.ok(!((Split.splitByOrg(dev.data()).orgs.get("o1")?.guests ?? []) as { id: string }[]).some((g) => g.id === GUEST_G), dev.name + " non lo propone piu' all'org");
  const w = writesNow(srv);
  for (let r = 0; r < 4; r++) for (const dev of devs) dev.cycle(srv);
  assert.equal(writesNow(srv), w, "e poi a regime non si scrive");
});

test("seconda difesa: anche SENZA retainOrgGuests il dispositivo a finestra non manda la cancellazione dell'ospite e il server lo tiene", () => {
  // stesso scenario ma senza trattenere gli ospiti della proiezione: nel fuso del dispositivo veloce l'ospite sparisce, ma buildDelta non lo cancella dal server senza lapide.
  const noRetain = { ...L, Canon: { ...Canon, retainOrgGuests: undefined } };
  const { srv, titolare, greta, stefano } = Sim.scenario(noRetain);
  for (let r = 0; r < 10; r++) for (const d of [titolare, greta, stefano]) d.cycle(srv);
  const delivered = srv.deltas.filter((x) => x.id === "org:o1" && ((x.delta as any).colls?.guests?.del ?? []).includes(GUEST_G)).length;
  assert.equal(delivered, 0);
  assert.ok(orgGuests(srv).includes(GUEST_G));
});

// ── unita': sync-canon ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("contentSig: ignora l'ordine di liste di oggetti con id e dei conti per chiave, ma NON l'ordine di liste annidate o di stringhe", () => {
  const a = { [KEY]: JSON.stringify({ guests: [{ id: "a", n: 1 }, { id: "b", n: 2 }], bookings: [{ id: "x", payments: [{ id: "p1" }, { id: "p2" }] }], _deleted: { guests: ["g1", "g2"] } }), [CONTI]: JSON.stringify([{ key: "b", label: "B" }, { key: "a", label: "A" }]), "spigolestay:tags": JSON.stringify([{ id: "t2" }, { id: "t1" }]) };
  const b = { [KEY]: JSON.stringify({ _deleted: { guests: ["g2", "g1"] }, bookings: [{ payments: [{ id: "p1" }, { id: "p2" }], id: "x" }], guests: [{ id: "b", n: 2 }, { id: "a", n: 1 }] }), [CONTI]: JSON.stringify([{ key: "a", label: "A" }, { key: "b", label: "B" }]), "spigolestay:tags": JSON.stringify([{ id: "t1" }, { id: "t2" }]) };
  assert.equal(Core.contentSig(a), Core.contentSig(b));
  const c = { ...b, [KEY]: JSON.stringify({ ...JSON.parse(b[KEY]), bookings: [{ id: "x", payments: [{ id: "p2" }, { id: "p1" }] }] }) };
  assert.notEqual(Core.contentSig(a), Core.contentSig(c), "l'ordine annidato resta un dato");
  const d = { ...b, [CONTI]: JSON.stringify([{ key: "a", label: "A" }, { key: "b", label: "Bx" }]) };
  assert.notEqual(Core.contentSig(a), Core.contentSig(d), "un'etichetta cambiata e' una modifica");
  const e = { ...b, "spigolestay:order": JSON.stringify(["x", "y"]) }, f = { ...b, "spigolestay:order": JSON.stringify(["y", "x"]) };
  assert.notEqual(Core.contentSig(e), Core.contentSig(f), "una lista di stringhe (es. ordine di vista) non e' toccata");
});

test("canonicalContiRaw: per chiave, idempotente, lascia stare ciò che non e' una lista di voci con chiave", () => {
  const raw = JSON.stringify([{ key: "z" }, { key: "a" }, { key: "m" }]);
  const once = Canon.canonicalContiRaw(raw);
  assert.deepEqual(keysOf(once), ["a", "m", "z"]);
  assert.equal(Canon.canonicalContiRaw(once), once);
  assert.equal(Canon.canonicalContiRaw("non json"), "non json");
  assert.equal(Canon.canonicalContiRaw(JSON.stringify({ a: 1 })), JSON.stringify({ a: 1 }));
  const mixed = JSON.stringify([{ key: "z" }, { label: "senza chiave" }]);
  assert.equal(Canon.canonicalContiRaw(mixed), mixed);
});

test("mergeSnapshots: i conti escono sempre in ordine canonico, qualunque sia l'ordine locale", () => {
  const mk = (order: string[]) => JSON.stringify(order.map((key) => ({ key, label: key })));
  const base = mk(["a", "b", "c"]);
  for (const order of [["c", "a", "b"], ["b", "c", "a"], ["a", "b", "c"]]) {
    const merged = Core.mergeSnapshots({ [CONTI]: mk(order) }, { [CONTI]: mk(["b", "a", "c"]) }, { [CONTI]: base });
    assert.deepEqual(keysOf(merged[CONTI]), ["a", "b", "c"]);
  }
  assert.deepEqual(keysOf(Core.mergeSnapshots({ [CONTI]: mk(["c", "a"]) }, {}, {})[CONTI]), ["a", "c"]);
});

test("extractOrgCassaConfig: la parte dell'org ha ordine canonico", () => {
  const sids = new Set(["sh"]);
  const conti = [{ key: "z", label: "Z", structureIds: ["sh"] }, { key: "a", label: "A", structureIds: ["sh"] }];
  assert.deepEqual(keysOf(OrgCfg.extractOrgCassaConfig({ [CONTI]: JSON.stringify(conti) }, sids)[CONTI]), ["a", "z"]);
  assert.deepEqual(keysOf(OrgCfg.extractOrgCassaConfig({ [CONTI]: JSON.stringify([...conti].reverse()) }, sids)[CONTI]), ["a", "z"]);
});

test("retainOrgGuests: trattiene solo chi e' nella base dell'org, c'e' ancora in locale e non ha lapide", () => {
  const g = (id: string) => ({ id, fullName: id, updatedAt: 1 });
  const baseRaw = JSON.stringify({ guests: [g("keep"), g("tomb"), g("gone"), g("already")] });
  const localOrg = { guests: [g("already"), g("own")], bookings: [] } as Record<string, unknown>;
  const all = [g("keep"), g("tomb"), g("already"), g("own"), g("new")];
  const out = Canon.retainOrgGuests(localOrg, baseRaw, all, ["tomb"]) as { guests: { id: string }[] };
  assert.deepEqual(out.guests.map((x) => x.id).sort(), ["already", "keep", "own"]);
  assert.equal(Canon.retainOrgGuests(localOrg, undefined, all, []), localOrg, "senza base non cambia nulla");
  assert.equal(Canon.retainOrgGuests(localOrg, "{rotto", all, []), localOrg);
});

// ── unita': buildDelta non cancella ospiti senza lapide ─────────────────────────────────────────────────────────────────────────────────────
test("buildDelta: un ospite assente dal fuso ma SENZA lapide non viene cancellato dal server; con lapide si", () => {
  const gu = (id: string, extra: Record<string, unknown> = {}) => ({ id, fullName: id, updatedAt: 1, ...extra });
  const server = { [KEY]: JSON.stringify({ guests: [gu("a"), gu("b")], _deleted: {} }) };
  const noTomb = { [KEY]: JSON.stringify({ guests: [gu("a")], _deleted: {} }) };
  assert.equal(D.buildDelta(server, server, noTomb).colls.guests, undefined);
  const withTomb = { [KEY]: JSON.stringify({ guests: [gu("a")], _deleted: { guests: ["b"] } }) };
  const dl = D.buildDelta(server, server, withTomb);
  assert.deepEqual(dl.colls.guests.del, ["b"]);
  assert.deepEqual(dl.tombs.guests, ["b"]);
  // contatto newsletter con contatto cancellato (stessa regola di mergeSnapshots): la rimozione resta esplicita
  const srvLead = { [KEY]: JSON.stringify({ guests: [gu("a"), gu("lead", { source: "sito", email: "X@Y.it" })], _deleted: {} }) };
  const leadGone = { [KEY]: JSON.stringify({ guests: [gu("a")], _deleted: {}, _deletedLeads: ["email:x@y.it"] }) };
  assert.deepEqual(D.buildDelta(srvLead, srvLead, leadGone).colls.guests.del, ["lead"]);
});

test("sync-delta: chiavi piatte uguali a meno dell'ordine non producono delta ne' modifiche sul server", () => {
  const a = JSON.stringify([{ key: "a" }, { key: "b" }]), b = JSON.stringify([{ key: "b" }, { key: "a" }]);
  const dl = D.buildDelta({ [CONTI]: a }, { [CONTI]: a }, { [CONTI]: b });
  assert.equal(D.isEmptyDelta(dl), true);
  const row = { [KEY]: JSON.stringify({}), [CONTI]: a };
  assert.equal(D.applyDelta(row, { ...D.emptyDelta(), flat: { [CONTI]: b } }).stats.changed, false);
});
