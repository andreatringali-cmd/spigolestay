import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const Core = await import("../src/lib/sync-core.ts");
const Flat = await import("../src/lib/sync-flat.ts");
const D = await import("../src/lib/sync-delta.ts");

const TPL = "spigolestay:msgtemplates";
const AUTO = "spigolestay:pulizie:autoshare:s1";
const USERS = "spigolestay:users";
const DK = "spigolestay:data:v1";
type Snap = Record<string, string>;
const j = (v: unknown) => JSON.stringify(v);

// Un dispositivo: localStorage (local), base in memoria (memBase, vuota dopo un ricaricamento) e base PERSISTENTE (persisted, testo della chiave syncbase).
// cycle() = una sincronizzazione come in authsync: fonde, scrive sul server se cambia, poi aggiorna locale e basi.
class Device {
  uid: string; local: Snap; memBase: Snap = {}; persisted: string | null = null;
  constructor(uid: string, local: Snap) { this.uid = uid; this.local = { ...local }; }
  reload() { this.memBase = {}; } // la pagina si ricarica: la base in memoria si perde, quella persistente resta
  cycle(server: { row: Snap }) {
    const bh = Core.readSyncBase(this.persisted, this.uid) ?? {};
    const merged = Core.mergeSnapshots(this.local, server.row, this.memBase, bh);
    const wrote = Core.contentSig(merged) !== Core.contentSig(server.row);
    if (wrote) server.row = { ...merged };
    this.memBase = merged; this.local = { ...merged };
    this.persisted = Core.syncBaseText(this.uid, merged);
    return { merged, wrote };
  }
  edit(k: string, v: string) { this.local = { ...this.local, [k]: v }; }
}

const OLD_TPL = j([{ id: "t1", name: "Benvenuto", body: "Ciao", via: "wa" }]);
const NEW_TPL = j([{ id: "t1", name: "Benvenuto", body: "Ciao", via: "email", subject: "Oggetto", intro: "Intro", outro: "Outro" }]);

test("locale invariato dall'ultima sync + server cambiato → vince il server", () => {
  const base = { [TPL]: OLD_TPL }, local = { [TPL]: OLD_TPL }, server = { [TPL]: NEW_TPL };
  assert.equal(Core.mergeSnapshots(local, server, base, {})[TPL], NEW_TPL);
});

test("locale cambiato + server invariato → vince il locale", () => {
  const base = { [TPL]: OLD_TPL }, local = { [TPL]: NEW_TPL }, server = { [TPL]: OLD_TPL };
  assert.equal(Core.mergeSnapshots(local, server, base, {})[TPL], NEW_TPL);
});

test("cambiati entrambi → vince il locale (come prima)", () => {
  const other = j([{ id: "t1", name: "Altro" }]);
  const base = { [TPL]: OLD_TPL }, local = { [TPL]: NEW_TPL }, server = { [TPL]: other };
  assert.equal(Core.mergeSnapshots(local, server, base, {})[TPL], NEW_TPL);
});

test("senza base: vince il server sulle chiavi che ha; le chiavi solo-locali restano; le solo-server si aggiungono", () => {
  const local = { [TPL]: OLD_TPL, [AUTO]: j({ a: 1 }) }, server = { [TPL]: NEW_TPL, "spigolestay:solo-server": "x" };
  const m = Core.mergeSnapshots(local, server, {}, {});
  assert.equal(m[TPL], NEW_TPL);
  assert.equal(m[AUTO], j({ a: 1 }));
  assert.equal(m["spigolestay:solo-server"], "x");
});

test("senza il 4° argomento resta il comportamento di prima (senza base vince il locale)", () => {
  const local = { [TPL]: OLD_TPL }, server = { [TPL]: NEW_TPL };
  assert.equal(Core.mergeSnapshots(local, server, {})[TPL], OLD_TPL);
});

test("la base persistente vale per le chiavi che la base in memoria non ha; la base in memoria ha la precedenza", () => {
  const bh = { [TPL]: Flat.flatHash(OLD_TPL)! };
  assert.equal(Core.mergeSnapshots({ [TPL]: OLD_TPL }, { [TPL]: NEW_TPL }, {}, bh)[TPL], NEW_TPL);          // locale = base persistente → server
  assert.equal(Core.mergeSnapshots({ [TPL]: NEW_TPL }, { [TPL]: OLD_TPL }, {}, bh)[TPL], NEW_TPL);          // locale cambiato, server = base → locale
  // la base in memoria dice che il locale è cambiato (base = NEW), l'impronta persistente è più vecchia: vince quella in memoria
  assert.equal(Core.mergeSnapshots({ [TPL]: OLD_TPL }, { [TPL]: NEW_TPL }, { [TPL]: NEW_TPL }, bh)[TPL], OLD_TPL);
});

test("uid diverso o base rovinata → la base si scarta", () => {
  const txt = Core.syncBaseText("uidA", { [TPL]: OLD_TPL });
  assert.ok(Core.readSyncBase(txt, "uidA"));
  assert.equal(Core.readSyncBase(txt, "uidB"), null);
  assert.equal(Core.readSyncBase("{non json", "uidA"), null);
  assert.equal(Core.readSyncBase(null, "uidA"), null);
  assert.equal(Core.readSyncBase(j({ v: 2, uid: "uidA", hashes: {} }), "uidA"), null);
  // senza base valida un dispositivo con una copia vecchia NON sovrascrive il server
  const m = Core.mergeSnapshots({ [TPL]: OLD_TPL }, { [TPL]: NEW_TPL }, {}, Core.readSyncBase(txt, "uidB") ?? {});
  assert.equal(m[TPL], NEW_TPL);
});

test("la base contiene solo impronte (non i contenuti) ed esclude data:v1, chiavi con regola propria e marcatori", () => {
  const big = "x".repeat(50000);
  const txt = Core.syncBaseText("u1", { [TPL]: big, [DK]: "{}", "spigolestay:threads:v1": "{}", "spigolestay:localowner": "u1", "spigolestay:msgsent": "[]", "spigolestay:activestruct": "all" });
  assert.ok(txt.length < 300, "base compatta: " + txt.length);
  const hashes = JSON.parse(txt).hashes as Record<string, string>;
  assert.deepEqual(Object.keys(hashes), [TPL]);
  assert.ok(!txt.includes("xxxx"));
});

test("chiavi escluse invariate: data:v1, chat, registro invii restano alle loro regole; il marcatore proprietario non viaggia", () => {
  const threads = "spigolestay:threads:v1";
  const local = { [threads]: j({ g1: [{ id: "m1", ts: 1 }] }), "spigolestay:localowner": "A" };
  const server = { [threads]: j({ g1: [{ id: "m2", ts: 2 }] }), "spigolestay:localowner": "B" };
  const m = Core.mergeSnapshots(local, server, {}, {});
  assert.deepEqual(JSON.parse(m[threads]).g1.map((x: { id: string }) => x.id), ["m1", "m2"]); // unione, non "vince il server"
  assert.equal("spigolestay:localowner" in m, false);
  assert.equal(Core.isSyncKey("spigolestay:localowner"), false);
  assert.equal(Core.isSyncKey("spigolestay:syncbase:v1"), false);
});

test("stesso contenuto con chiavi in ordine diverso = uguale: nessuna riscrittura", () => {
  const a = j({ x: 1, y: 2 }), b = j({ y: 2, x: 1 });
  assert.equal(Flat.flatHash(a), Flat.flatHash(b));
  const base = { [AUTO]: a };
  const m = Core.mergeSnapshots({ [AUTO]: a }, { [AUTO]: b }, base, {});
  assert.equal(Core.contentSig(m), Core.contentSig({ [AUTO]: b }));
});

test("DUE SCHEDE: una copia vecchia (ricaricata, base in memoria persa) non sovrascrive il valore nuovo scritto dall'altra", () => {
  const server = { row: { [TPL]: OLD_TPL, [AUTO]: j({ wa: true }) } as Snap };
  const A = new Device("u1", server.row), B = new Device("u1", server.row);
  A.cycle(server); B.cycle(server);                       // entrambe sincronizzate sul vecchio
  B.edit(TPL, NEW_TPL); B.edit(AUTO, j({ wa: false }));  // B modifica e sincronizza
  assert.equal(B.cycle(server).wrote, true);
  A.reload();                                              // A resta con la copia vecchia, poi si ricarica
  const r = A.cycle(server);
  assert.equal(r.wrote, false, "A non deve riscrivere nulla sul server");
  assert.equal(server.row[TPL], NEW_TPL);
  assert.equal(server.row[AUTO], j({ wa: false }));
  assert.equal(A.local[TPL], NEW_TPL);                    // …e adotta il nuovo
  // e viceversa: ora A modifica, B è quella vecchia
  A.edit(TPL, OLD_TPL); A.cycle(server);
  B.reload(); B.cycle(server);
  assert.equal(server.row[TPL], OLD_TPL);
  assert.equal(B.local[TPL], OLD_TPL);
});

test("modifica fatta qui e scheda chiusa prima del push: dopo il ricaricamento la modifica vince (la base persistente la riconosce come locale)", () => {
  const server = { row: { [TPL]: OLD_TPL } as Snap };
  const A = new Device("u1", server.row);
  A.cycle(server);
  A.edit(TPL, NEW_TPL);   // modifica locale, nessun ciclo: la scheda si chiude
  A.reload();
  A.cycle(server);
  assert.equal(server.row[TPL], NEW_TPL);
});

test("nessun ciclo infinito: sincronizzare di nuovo senza modifiche non cambia né server né locale", () => {
  const server = { row: { [TPL]: NEW_TPL, [USERS]: j([{ id: "u1", firstName: "A", photo: "data:x" }]) } as Snap };
  const A = new Device("u1", { [TPL]: OLD_TPL, [USERS]: j([{ id: "u1", firstName: "A" }]) });
  A.cycle(server);
  const sig1 = Core.contentSig(server.row), loc1 = Core.contentSig(A.local);
  for (let i = 0; i < 3; i++) { A.reload(); const r = A.cycle(server); assert.equal(r.wrote, false); }
  assert.equal(Core.contentSig(server.row), sig1);
  assert.equal(Core.contentSig(A.local), loc1);
});

test("modalità veloce: quando vince il server le chiavi piatte non finiscono nel delta", () => {
  const win = { [DK]: j({ bookings: [] }), [TPL]: NEW_TPL };
  const local = { [DK]: j({ bookings: [] }), [TPL]: OLD_TPL };
  const merged = Core.mergeSnapshots(local, win, {}, { [TPL]: Flat.flatHash(OLD_TPL)! });
  const d = D.buildDelta(win, {}, merged);
  assert.deepEqual(d.flat, {});
  // se invece è stato modificato qui, il delta porta la chiave
  const merged2 = Core.mergeSnapshots({ ...local, [TPL]: NEW_TPL + " " }, { ...win, [TPL]: OLD_TPL }, {}, { [TPL]: Flat.flatHash(OLD_TPL)! });
  assert.deepEqual(Object.keys(D.buildDelta({ ...win, [TPL]: OLD_TPL }, {}, merged2).flat), [TPL]);
});

// ── Utenti: fusione per utente ────────────────────────────────────────────────────────────────────────────────────────────────────────
const u = (id: string, extra: Record<string, unknown> = {}) => ({ id, firstName: "N" + id, lastName: "C" + id, templateKey: "reception", perms: { cassa: "view" }, allStructures: true, structureIds: [], status: "Attivo", ...extra });
const ids = (raw: string) => (JSON.parse(raw) as { id: string }[]).map((x) => x.id);
const byId = (raw: string, id: string) => (JSON.parse(raw) as Record<string, unknown>[]).find((x) => x.id === id)!;

test("utenti: foto presente sul server e assente nel locale vecchio → la foto resta", () => {
  const server = j([u("u1", { photo: "data:img/1" })]);
  const local = j([u("u1")]);
  // senza base
  assert.equal(byId(Flat.mergeUsers3(undefined, local, server)!, "u1").photo, "data:img/1");
  // con base vecchia (senza foto): il locale non l'ha toccata → server
  assert.equal(byId(Flat.mergeUsers3(local, local, server)!, "u1").photo, "data:img/1");
  // dentro mergeSnapshots, anche quando il locale è cambiato per altro (es. ultimo accesso) e quindi cambiati entrambi
  const loc2 = j([u("u1", { lastLogin: { at: "2026-10-20", ip: "1" } })]);
  const m = Core.mergeSnapshots({ [USERS]: loc2 }, { [USERS]: j([u("u1", { photo: "data:img/1", phone: "333" })]) }, { [USERS]: local }, {});
  assert.equal(byId(m[USERS], "u1").photo, "data:img/1");
  assert.equal(byId(m[USERS], "u1").phone, "333");
  assert.ok(byId(m[USERS], "u1").lastLogin); // il campo toccato qui resta
});

test("utenti: foto rimossa dall'utente (in base, assente in locale, server uguale alla base) → resta rimossa", () => {
  const base = j([u("u1", { photo: "data:img/1" })]);
  const local = j([u("u1")]);            // «Rimuovi foto» → campo assente
  const server = base;
  assert.equal("photo" in byId(Flat.mergeUsers3(base, local, server)!, "u1"), false);
  // anche attraverso mergeSnapshots con la base in memoria (percorso reale)
  const m = Core.mergeSnapshots({ [USERS]: local }, { [USERS]: server }, { [USERS]: base }, {});
  assert.equal("photo" in byId(m[USERS], "u1"), false);
  // il vuoto «""» si comporta come assente
  assert.equal(Flat.mergeUsers3(base, j([u("u1", { photo: "" })]), server) !== null, true);
  assert.equal(byId(Flat.mergeUsers3(base, j([u("u1", { photo: "" })]), server)!, "u1").photo, "");
});

test("utenti: rimozione qui e nuova foto altrove → vince la foto (il vuoto non cancella il pieno)", () => {
  const base = j([u("u1", { photo: "data:img/1" })]);
  const m = Flat.mergeUsers3(base, j([u("u1")]), j([u("u1", { photo: "data:img/2" })]))!;
  assert.equal(byId(m, "u1").photo, "data:img/2");
});

test("utenti: due utenti con foto diverse → ciascuna al suo id", () => {
  const server = j([u("u1", { photo: "data:img/A" }), u("u2")]);
  const local = j([u("u1"), u("u2", { photo: "data:img/B" })]);
  const m = Flat.mergeUsers3(undefined, local, server)!;
  assert.equal(byId(m, "u1").photo, "data:img/A");
  assert.equal(byId(m, "u2").photo, "data:img/B");
  assert.deepEqual(ids(m), ["u1", "u2"]);
});

test("utenti: permessi e strutture seguono la 3 vie (senza base vince il server); campi personali in conflitto senza base → server", () => {
  const base = j([u("u1", { perms: { cassa: "view" } })]);
  // il titolare ha alzato i permessi sul server, il locale non li ha toccati
  const m1 = Flat.mergeUsers3(base, j([u("u1", { lastLogin: { at: "x", ip: "1" } })]), j([u("u1", { perms: { cassa: "edit" } })]))!;
  assert.deepEqual(byId(m1, "u1").perms, { cassa: "edit" });
  // senza base: server
  const m2 = Flat.mergeUsers3(undefined, j([u("u1", { perms: { cassa: "none" } })]), j([u("u1", { perms: { cassa: "edit" } })]))!;
  assert.deepEqual(byId(m2, "u1").perms, { cassa: "edit" });
  // modificati solo qui → locale
  const m3 = Flat.mergeUsers3(base, j([u("u1", { perms: { cassa: "none" } })]), base)!;
  assert.deepEqual(byId(m3, "u1").perms, { cassa: "none" });
  // nome in conflitto, senza base → server
  const m4 = Flat.mergeUsers3(undefined, j([u("u1", { firstName: "Locale" })]), j([u("u1", { firstName: "Server" })]))!;
  assert.equal(byId(m4, "u1").firstName, "Server");
});

test("utenti: aggiunti/cancellati altrove e qui rispettati con la base; senza base nessuno sparisce", () => {
  const base = j([u("u1"), u("u2")]);
  // u2 cancellato sul server, qui non toccato → sparisce; u3 nuovo sul server → arriva; u4 nuovo qui → resta
  const m = Flat.mergeUsers3(base, j([u("u1"), u("u2", { lastLogin: { at: "x", ip: "1" } }), u("u4")]), j([u("u1"), u("u3")]))!;
  assert.deepEqual(ids(m).sort(), ["u1", "u3", "u4"]);
  // u2 cancellato qui, ancora sul server uguale alla base → non rientra
  const m2 = Flat.mergeUsers3(base, j([u("u1")]), base)!;
  assert.deepEqual(ids(m2), ["u1"]);
  // senza base: unione
  const m3 = Flat.mergeUsers3(undefined, j([u("u1")]), j([u("u2")]))!;
  assert.deepEqual(ids(m3).sort(), ["u1", "u2"]);
  // JSON non valido → null (decide il chiamante)
  assert.equal(Flat.mergeUsers3(undefined, "{", j([]) ), null);
});

test("utenti: due schede, la vecchia ricaricata non toglie la foto messa dall'altra", () => {
  const server = { row: { [USERS]: j([u("u1")]) } as Snap };
  const A = new Device("uid", server.row), B = new Device("uid", server.row);
  A.cycle(server); B.cycle(server);
  B.edit(USERS, j([u("u1", { photo: "data:img/1" })])); B.cycle(server);
  A.reload();
  A.edit(USERS, j([u("u1", { lastLogin: { at: "2026-10-20", ip: "1" } })])); // A fa un accesso (volatile) e basta
  A.cycle(server);
  assert.equal(byId(server.row[USERS], "u1").photo, "data:img/1");
  assert.equal(byId(A.local[USERS], "u1").photo, "data:img/1");
});
