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
  assert.ok(s.includes("if (saved && !(uid && localIsForeign(uid))) wipeLocalAccount();"), "signOut non svuota il locale di un altro account");
  assert.ok(s.includes("setActiveAccount(userId)") && s.includes("setActiveAccount(null)"), "la guardia di scrittura si accende in startPush e si spegne in stopPush");
  assert.ok(s.includes("setKvWriteGuard(isWriteBlocked)") && s.includes("installLocalWriteGuard()"), "guardia di scrittura installata");
  assert.ok(s.includes("wipeOrder(kvKeys())"), "lo svuotamento toglie prima il marcatore");
  const shortcut = s.slice(s.indexOf('if (!switching && entry === "shortcut")'), s.indexOf("return;", s.indexOf('if (!switching && entry === "shortcut")')));
  assert.ok(shortcut.indexOf("markLocalOwner(uid)") < shortcut.indexOf("syncOnce("), "scorciatoia: il marcatore mancante si ripristina prima di sincronizzare");
});

test("bigstore: le scritture del blocco grande passano dalla guardia (IndexedDB è condiviso tra le schede)", () => {
  const s = read("src/lib/bigstore.ts");
  assert.ok(s.includes("export function setKvWriteGuard"));
  assert.ok(count(s, "writeGuard && writeGuard(key)") === 2, "kvSet e kvRemove");
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
