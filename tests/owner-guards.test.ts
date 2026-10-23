// Rete di sicurezza: i punti che scrivono sul server dati letti dal localStorage (condiviso tra le schede) devono controllare di chi sono i dati locali PRIMA di agire.
// Sono controlli sul testo dei sorgenti: se qualcuno toglie la guardia da uno di questi punti il test lo segnala. La logica vera è provata in sync-two-tabs.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const count = (s: string, frag: string) => s.split(frag).length - 1;

test("authsync: il ciclo di sincronizzazione controlla il proprietario del locale all'inizio, dopo l'attesa di rete e prima di ripristinare; l'uscita non svuota dati altrui", () => {
  const s = read("src/lib/authsync.tsx");
  const syncOnce = s.slice(s.indexOf("async function syncOnce("), s.indexOf("async function prepareDeltaMode("));
  assert.ok(count(syncOnce, "localIsForeign(uid)") >= 2, "syncOnce: controllo prima della fotografia e dopo fetchOrgIds");
  assert.ok(syncOnce.indexOf("localIsForeign(uid)") < syncOnce.indexOf("const snap = snapshot()"), "il controllo precede la fotografia");
  const run = s.slice(s.indexOf("const runSync = async"), s.indexOf("pushTimer.current = setInterval"));
  assert.ok(run.indexOf("localIsForeign(userId)") < run.indexOf("remoteSyncSig"), "controllo iniziale prima di qualsiasi lavoro");
  assert.ok(run.indexOf("foreign || localIsForeign(userId)") > run.indexOf("await syncOnce(") && run.indexOf("foreign || localIsForeign(userId)") < run.indexOf("restore(newBlob)"), "ricontrollo dopo syncOnce e prima di restore");
  assert.ok(s.includes("if (saved && shouldWipeOnSignOut(ownerNow, uid)) wipeLocalAccount();"), "signOut non svuota il locale di un altro account (ma sì con marcatore assente)");
  assert.ok(s.includes("setActiveAccount(userId)") && s.includes("setActiveAccount(null)"), "la guardia di scrittura si accende in startPush e si spegne in stopPush");
  assert.ok(s.includes("setKvWriteGuard(isWriteBlocked)") && s.includes("installLocalWriteGuard()"), "guardia di scrittura installata");
  assert.ok(s.includes("wipeOrder(kvKeys())"), "lo svuotamento toglie prima il marcatore");
  const shortcut = s.slice(s.indexOf('if (!switching && entry === "shortcut")'), s.indexOf("return;", s.indexOf('if (!switching && entry === "shortcut")')));
  assert.ok(shortcut.indexOf("markLocalOwner(uid)") < shortcut.indexOf("syncOnce("), "scorciatoia: il marcatore mancante si ripristina prima di sincronizzare");
});

test("bigstore: le scritture del blocco grande passano dalla guardia (IndexedDB è condiviso tra le schede), anche quelle già in coda", () => {
  const s = read("src/lib/bigstore.ts");
  assert.ok(s.includes("export function setKvWriteGuard"));
  assert.ok(count(s, "writeGuard && writeGuard(key)") === 2, "kvSet e kvRemove");
  const flush = s.slice(s.indexOf("function runFlush()"), s.indexOf("const schedule"));
  assert.ok(count(flush, "dropBlocked()") === 2, "runFlush rivaluta la guardia prima di ogni scrittura su IndexedDB (primo tentativo e secondo)");
  assert.ok(flush.indexOf("dropBlocked()") < flush.indexOf("await idbWrite(batch)"));
  // la prova vera (con un IndexedDB finto) è in bigstore-guard.test.ts
});

test("authsync: dopo l'attesa di rete della sincronizzazione iniziale restore e base ricontrollano il proprietario del locale (la guardia di scrittura è spenta in idratazione)", () => {
  const s = read("src/lib/authsync.tsx");
  assert.ok(s.includes("function restore(data: Record<string, string>, uid?: string): boolean {") && s.includes("if (uid && localIsForeign(uid))"), "restore(data, uid) esce se il locale non è di uid");
  const prep = s.slice(s.indexOf("async function prepareDeltaMode("), s.indexOf("async function prepareDeltaMode(") + 2600);
  assert.ok(prep.includes("restore(r.newBlob, uid)") && prep.includes("commitSyncBaseIfMine(uid"), "prepareDeltaMode");
  const startup = s.slice(s.indexOf("async function deltaStartupSync("), s.indexOf("async function deltaStartupSync(") + 1800);
  assert.ok(startup.includes("restore(r.newBlob, uid)") && startup.includes("commitSyncBaseIfMine(uid") && !/[^f]commitSyncBase\(uid/.test(startup.replace(/commitSyncBaseIfMine/g, "")), "deltaStartupSync");
  assert.ok(startup.indexOf("r.foreign || localIsForeign(uid)") > startup.indexOf("await syncOnce(") && startup.indexOf("r.foreign || localIsForeign(uid)") < startup.indexOf("restore(r.newBlob, uid)"));
  const shortcut = s.slice(s.indexOf('if (!switching && entry === "shortcut")'), s.indexOf("return;", s.indexOf('if (!switching && entry === "shortcut")')));
  assert.ok(shortcut.includes("restore(res.newBlob, uid)") && shortcut.includes("notifyOtherAccount(") , "scorciatoia");
  assert.ok(s.includes("if (localOwnedByOtherNow(uid)) { notifyOtherAccount(\"other\"); return; }"), "dopo prepareDeltaMode l'idratazione si ferma se il locale è di un altro account");
});

test("scheda in pausa: avviso BLOCCANTE (finestra modale con «Ricarica»), anche prima dell'idratazione, con il motivo", () => {
  const s = read("src/lib/authsync.tsx");
  const ov = s.slice(s.indexOf("function OtherAccountOverlay("), s.indexOf("export function useAuth()"));
  assert.ok(ov.includes('role="alertdialog"') && ov.includes('aria-modal="true"') && ov.includes("inset: 0") && ov.includes("window.location.reload()") && ov.includes("Ricarica la pagina"));
  assert.ok(s.includes("{otherAccount && <OtherAccountOverlay reason={otherReason} />}") && s.includes("if (otherAccount && !hydrated) return <OtherAccountOverlay"));
  assert.ok(!s.includes('position: "fixed", top: 0, left: 0, right: 0, zIndex: 9998'), "il vecchio banner non bloccante non c'è più");
  const g = read("src/lib/local-guard.ts");
  assert.ok(g.includes("writeBlockReason(key, ownerNow(), activeUid)") && g.includes('new CustomEvent("xenora:other-account"'));
});

test("Cassa: la migrazione una-tantum dei dati locali verso il server non parte se il locale è di un altro account", () => {
  const s = read("src/lib/cassa.ts");
  const m = s.slice(s.indexOf("export async function migrateLocalCash"), s.indexOf("// Riga dell'elenco movimenti"));
  assert.ok(m.includes("userId: string"));
  assert.ok(m.indexOf("isLocalForeign(localStorage, userId)") > 0 && m.indexOf("isLocalForeign(localStorage, userId)") < m.indexOf('localStorage.getItem("spigolestay:cassa:v1")'));
  assert.ok(read("src/app/(app)/cassa/page.tsx").includes("migrateLocalCash(tenantId, user.id)"));
});

test("Pubblicazione sito, invio prezzi a Channex, impostazioni dei collaboratori e pubblicazione guida: controllano il proprietario del locale", () => {
  assert.ok(read("src/app/(app)/sito/page.tsx").includes("isLocalForeign(localStorage, user.id)"));
  const ch = read("src/components/ChannexAutoSync.tsx");
  assert.ok(count(ch, "isLocalForeign(localStorage, uidRef.current)") >= 2, "invio in uscita e lettura prenotazioni");
  const ws = read("src/components/WorkspaceSync.tsx");
  assert.ok(ws.includes("const foreign = ") && ws.includes("if (foreign()) return false;") && ws.includes("if (!ready || foreign()) return;"), "scarico e invio");
  assert.ok(count(read("src/app/(app)/guida-ospiti/page.tsx"), "isLocalForeign(localStorage, authUser.id)") === 2, "pubblicazione automatica e manuale");
});

test("la chiave del marcatore e della base non sono mai sincronizzate (altrimenti il server le riporterebbe sugli altri dispositivi)", async () => {
  const { register } = await import("node:module");
  register("./helpers/alias-loader.mjs", import.meta.url);
  const Core = await import("../src/lib/sync-core.ts");
  assert.equal(Core.isSyncKey(Core.LOCAL_OWNER_KEY), false);
  assert.equal(Core.isSyncKey(Core.SYNCBASE_KEY), false);
});
