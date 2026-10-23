// Due schede dello stesso browser, due account, UN SOLO localStorage condiviso: nessuna chiave piatta (impostazioni, registro invii, cassa, guida…) deve passare dal server di un
// account all'altro. Si usano i moduli veri (sync-core: decideEntry, mergeSnapshots, basi; sync-owner: guardie), con una piccola "scheda" finta che ripete i passi di authsync.tsx
// (idratazione → ciclo di sincronizzazione → ripristino del locale). Tre modalità di difesa per mostrare che il test SA rilevare il problema:
//   "none"  = come prima della correzione,   "start" = solo il controllo all'inizio del ciclo (commit 5e7d746b),   "full" = difese attuali (controlli a ogni passo + scritture bloccate).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const Core = await import("../src/lib/sync-core.ts");
const Owner = await import("../src/lib/sync-owner.ts");

type Snap = Record<string, string>;
type Mode = "none" | "start" | "full";
const DK = "spigolestay:data:v1";
const j = (v: unknown) => JSON.stringify(v);

// ── Server finto: una riga per account ─────────────────────────────────────────────────────────────────────────────────────────────────
class Server {
  rows = new Map<string, Snap>();
  row(uid: string): Snap { return this.rows.get(uid) ?? {}; }
  write(uid: string, data: Snap) { this.rows.set(uid, { ...data }); }
}
// ── Browser: localStorage CONDIVISO ────────────────────────────────────────────────────────────────────────────────────────────────────
class Browser { ls = new Map<string, string>(); }

// ── Scheda ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
class Tab {
  activeUid: string | null = null;     // account per cui questa scheda ha finito di idratare (setActiveAccount)
  sessionFlag: string | null = null;   // sessionStorage "hydrated-for" (per scheda)
  base: Snap = {};
  name: string; uid: string; br: Browser; server: Server; mode: Mode;
  constructor(name: string, uid: string, br: Browser, server: Server, mode: Mode) { this.name = name; this.uid = uid; this.br = br; this.server = server; this.mode = mode; }

  private owner(): string | null { return this.br.ls.get(Core.LOCAL_OWNER_KEY) ?? null; }
  private foreign(): boolean { return Owner.isLocalForeign({ getItem: (k) => this.br.ls.get(k) ?? null }, this.uid); }

  // scritture di una PAGINA di questa scheda (impostazioni, guida, cassa…): passano dalla guardia come in local-guard.ts
  uiWrite(k: string, v: string) {
    if (this.mode === "full" && Owner.shouldBlockLocalWrite(k, this.owner(), this.activeUid)) return false;
    this.br.ls.set(k, v); return true;
  }
  uiRemove(k: string) {
    if (this.mode === "full" && Owner.shouldBlockLocalWrite(k, this.owner(), this.activeUid)) return false;
    this.br.ls.delete(k); return true;
  }
  read(k: string): string | undefined { return this.br.ls.get(k); }

  snapshot(): Snap { const o: Snap = {}; for (const [k, v] of this.br.ls) if (Core.isSyncKey(k)) o[k] = v; return o; }
  restore(data: Snap) {
    for (const [k, v] of Object.entries(data)) if (Core.isSyncKey(k)) this.br.ls.set(k, v);
    for (const k of [...this.br.ls.keys()]) if (Core.isSyncKey(k) && !(k in data)) this.br.ls.delete(k);
  }
  wipe() { for (const k of Owner.wipeOrder([...this.br.ls.keys()])) this.br.ls.delete(k); }

  /** Idratazione all'ingresso (come l'effetto principale di authsync.tsx). `afterWipe` serve a provare cosa succede nella finestra in cui il locale è mezzo ricostruito. */
  async enter(afterWipe?: () => void | Promise<void>) {
    this.activeUid = null;
    const entry = Core.decideEntry({ localOwner: this.owner(), uid: this.uid, sessionFlag: this.sessionFlag, localHasData: this.br.ls.has(DK) });
    if (entry === "wipe") this.wipe();
    if (afterWipe) await afterWipe();
    const serverRow = this.server.row(this.uid);
    const snap = this.snapshot();
    const merged = DK in snap ? Core.mergeSnapshots(snap, serverRow, {}, Core.readSyncBase(this.br.ls.get(Core.SYNCBASE_KEY), this.uid) ?? {}) : serverRow;
    this.restore(merged);
    this.server.write(this.uid, merged);
    this.base = merged;
    this.br.ls.set(Core.SYNCBASE_KEY, Core.syncBaseText(this.uid, merged));
    this.sessionFlag = this.uid;
    this.br.ls.set(Core.LOCAL_OWNER_KEY, this.uid);   // markLocalOwner
    this.activeUid = this.uid;                         // startPush → setActiveAccount
  }

  /** Un ciclo di sincronizzazione (runSync → syncOnce → restore). `mid` = cosa succede in un'altra scheda mentre questa aspetta la rete (dopo la fotografia / dopo la scrittura). */
  async cycle(mid: { afterGuard?: () => void | Promise<void>; afterSnapshot?: () => void | Promise<void>; afterPush?: () => void | Promise<void> } = {}): Promise<string> {
    if (this.mode !== "none" && this.foreign()) return "in-pausa";
    if (mid.afterGuard) await mid.afterGuard();                    // in authsync: await remoteSyncSig(...) tra il controllo e la fotografia
    if (this.mode === "full" && this.foreign()) return "in-pausa";   // syncOnce ricontrolla nello stesso istante della fotografia
    const snap = this.snapshot();
    if (!(DK in snap)) return "locale-vuoto";
    if (mid.afterSnapshot) await mid.afterSnapshot();              // await fetchOrgIds(...)
    if (this.mode === "full" && this.foreign()) return "in-pausa-prima-di-scrivere";
    const merged = Core.mergeSnapshots(snap, this.server.row(this.uid), this.base, Core.readSyncBase(this.br.ls.get(Core.SYNCBASE_KEY), this.uid) ?? {});
    this.server.write(this.uid, merged);                            // scrittura sul server di QUESTO account
    if (mid.afterPush) await mid.afterPush();                      // rete: l'altra scheda può entrare adesso
    if (this.mode === "full" && this.foreign()) return "in-pausa-prima-di-ripristinare";
    this.restore(merged);                                           // restore(newBlob)
    this.base = merged;
    return "ok";
  }
}

// ── Dati di prova ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const dataFor = (tag: string) => j({ structures: [{ id: "s" + tag, name: "Casa " + tag }], units: [], bookings: [{ id: "b" + tag, structureId: "s" + tag, guestId: "g" + tag }], guests: [{ id: "g" + tag, name: "Ospite " + tag }], roomTypes: [], events: [], directReviews: [], _deleted: {} });
// Impostazioni piatte dell'account `tag`: tutte contengono il segno MARK_<tag>.
const flatFor = (tag: string): Snap => ({
  [DK]: dataFor(tag),
  ["spigolestay:pulizie:autoshare:s" + tag]: j({ enabled: true, email: `MARK_${tag}@x.it` }),
  "spigolestay:msgsent": j([{ key: `MARK_${tag}_k1`, at: 1 }]),
  "spigolestay:cassa:cats": j([{ key: `MARK_${tag}_c1`, label: "Cat " + tag }]),
  "spigolestay:cassa:v1": j([{ id: "m" + tag, desc: `MARK_${tag}_mov` }]),
  "spigolestay:guides": j({ ["s" + tag]: { id: "s" + tag, wifiPassword: `MARK_${tag}_wifi`, content: { home: { welcomeTitle: `MARK_${tag}_titolo`, welcome: [] }, sections: [] } } }),
  "spigolestay:msgtemplates": j({ t1: `MARK_${tag}_tpl` }),
});
const has = (row: Snap, tag: string) => JSON.stringify(row).includes(`MARK_${tag}`) || JSON.stringify(row).includes(`Casa ${tag}`);
const localHas = (br: Browser, tag: string) => JSON.stringify([...br.ls.entries()].filter(([k]) => Core.isSyncKey(k))).includes(`MARK_${tag}`) || JSON.stringify([...br.ls.entries()].filter(([k]) => Core.isSyncKey(k))).includes(`Casa ${tag}`);

function world(mode: Mode) {
  const br = new Browser(), server = new Server();
  server.write("A", flatFor("A")); server.write("B", flatFor("B"));
  const tabA = new Tab("A", "A", br, server, mode), tabB = new Tab("B", "B", br, server, mode);
  return { br, server, tabA, tabB };
}

// ── Prove ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("accesso in un'altra scheda: la scheda vecchia (account A) NON ripristina i dati di A sopra quelli di B, e B non li spinge sul suo server", async () => {
  for (const mode of ["start", "full"] as Mode[]) {
    const { br, server, tabA, tabB } = world(mode);
    await tabA.enter();
    assert.equal(br.ls.get(Core.LOCAL_OWNER_KEY), "A");
    await tabB.enter();                                   // B entra in un'altra scheda: il locale (di A) si svuota e si ricostruisce con i dati di B
    assert.equal(br.ls.get(Core.LOCAL_OWNER_KEY), "B");
    assert.equal(localHas(br, "A"), false, "il locale ora è di B, senza nulla di A");
    // la scheda A, rimasta in secondo piano, "si sveglia" e fa il suo ciclo
    assert.equal(await tabA.cycle(), "in-pausa");
    assert.equal(localHas(br, "A"), false, `modo ${mode}: A non ha riscritto i suoi dati nel locale di B`);
    assert.equal(await tabB.cycle(), "ok");
    assert.equal(has(server.row("B"), "A"), false, `modo ${mode}: il server di B non contiene nulla di A`);
    assert.equal(has(server.row("A"), "B"), false, `modo ${mode}: il server di A non contiene nulla di B`);
  }
});

test("CONTROLLO del test: senza difese la stessa sequenza fa passare le impostazioni di A sul server di B", async () => {
  const { br, server, tabA, tabB } = world("none");
  await tabA.enter();
  await tabB.enter();
  await tabA.cycle();                                     // vecchio comportamento: A ripristina i propri dati (anche le chiavi piatte) nel locale di B…
  assert.equal(localHas(br, "A"), true);
  await tabB.cycle();                                     // …e B li porta sul proprio server
  assert.equal(has(server.row("B"), "A"), true, "senza difese il problema si riproduce: il test lo rileva");
});

test("le pagine della scheda vecchia continuano a scrivere impostazioni di A: con le difese vengono ignorate e non arrivano al server di B", async () => {
  const { br, server, tabA, tabB } = world("full");
  await tabA.enter(); await tabB.enter();
  // pagine di A ancora aperte: pulizie (autoshare), registro invii, cassa, guida…
  const w = [
    tabA.uiWrite("spigolestay:pulizie:autoshare:sA", j({ enabled: true, email: "MARK_A_ui@x.it" })),
    tabA.uiWrite("spigolestay:msgsent", j([{ key: "MARK_A_ui_k", at: 2 }])),
    tabA.uiWrite("spigolestay:cassa:v1", j([{ id: "x", desc: "MARK_A_ui_mov" }])),
    tabA.uiWrite("spigolestay:guides", j({ sA: { id: "sA", wifiPassword: "MARK_A_ui_wifi" } })),
    tabA.uiRemove("spigolestay:msgtemplates"),
  ];
  assert.deepEqual(w, [false, false, false, false, false]);
  assert.equal(localHas(br, "A"), false);
  assert.notEqual(br.ls.get("spigolestay:msgtemplates"), undefined, "nemmeno le cancellazioni della scheda vecchia passano");
  await tabB.cycle();
  assert.equal(has(server.row("B"), "A"), false);
  // senza difese: le stesse scritture sporcano il locale di B
  const nd = world("none");
  await nd.tabA.enter(); await nd.tabB.enter();
  nd.tabA.uiWrite("spigolestay:msgsent", j([{ key: "MARK_A_ui_k", at: 2 }]));
  await nd.tabB.cycle();
  assert.equal(has(nd.server.row("B"), "A"), true);
});

test("gara: B entra mentre il ciclo di A aspetta la rete → il controllo iniziale da solo NON basta, quelli a ogni passo sì", async () => {
  // A ha un lavoro non ancora sincronizzato (chiave nuova); B entra tra il controllo iniziale e la fotografia.
  for (const [mode, expectLeak] of [["start", true], ["full", false]] as [Mode, boolean][]) {
    const { br, server, tabA, tabB } = world(mode);
    await tabA.enter();
    assert.equal(tabA.uiWrite("spigolestay:msgsent", j([{ key: "MARK_A_nuovo", at: 3 }])), true); // scritta quando il locale è ancora di A
    const res = await tabA.cycle({ afterGuard: () => tabB.enter() });                              // B entra durante l'attesa di rete
    assert.equal(has(server.row("B"), "A"), false, `modo ${mode}: il server di B resta pulito`);
    const polluted = localHas(br, "A") || has(server.row("A"), "B");
    if (expectLeak) assert.equal(has(server.row("A"), "B"), true, "il solo controllo iniziale lascia passare la gara: A fotografa il locale ormai di B e lo scrive sul proprio server");
    else { assert.match(res, /in-pausa/); assert.equal(polluted, false, "con i controlli a ogni passo non passa nulla in nessuna direzione"); }
  }
  // B entra dopo la fotografia ma prima della scrittura, e di nuovo prima del ripristino
  for (const where of ["afterSnapshot", "afterPush"] as const) {
    const { br, server, tabA, tabB } = world("full");
    await tabA.enter();
    const res = await tabA.cycle({ [where]: () => tabB.enter() });
    assert.match(res, /in-pausa/);
    assert.equal(localHas(br, "A"), false, `entrata di B ${where}: il locale di B resta di B`);
    await tabB.cycle();
    assert.equal(has(server.row("B"), "A"), false);
    assert.equal(has(server.row("A"), "B"), false);
  }
});

test("finestra di ricostruzione: mentre B svuota e ricostruisce il locale (marcatore assente) A non scrive e non sincronizza", async () => {
  const { br, server, tabA, tabB } = world("full");
  await tabA.enter();
  let uiOk = true, cyc = "";
  await tabB.enter(async () => {                          // locale appena svuotato da B, dati di B non ancora scritti
    assert.equal(br.ls.get(Core.LOCAL_OWNER_KEY), undefined);
    uiOk = tabA.uiWrite("spigolestay:msgsent", j([{ key: "MARK_A_finestra", at: 4 }]));
    cyc = await tabA.cycle();
  });
  assert.equal(uiOk, false);
  assert.equal(cyc, "in-pausa");
  await tabB.cycle();
  assert.equal(has(server.row("B"), "A"), false);
});

test("ordine di svuotamento: il marcatore e la base vanno via PRIMA delle chiavi (nessuna finestra in cui il locale sembra ancora di A ma è già a metà)", () => {
  const order = Owner.wipeOrder(["spigolestay:data:v1", "spigolestay:guides", "xn-collab", Core.LOCAL_OWNER_KEY, Core.SYNCBASE_KEY, "xenora:x"]);
  assert.equal(order[0], Core.LOCAL_OWNER_KEY);
  assert.equal(order[1], Core.SYNCBASE_KEY);
  assert.deepEqual(order.slice(2).sort(), ["spigolestay:data:v1", "spigolestay:guides", "xenora:x"].sort());
  assert.equal(order.includes("xn-collab"), false, "le chiavi per-dispositivo non si toccano");
});

test("decideEntry: scheda con flag di A ma locale di B → si svuota (non scorciatoia); marcatore assente + flag → scorciatoia; senza flag → svuota", () => {
  assert.equal(Core.decideEntry({ localOwner: "B", uid: "A", sessionFlag: "A", localHasData: true }), "wipe");
  assert.equal(Core.decideEntry({ localOwner: null, uid: "A", sessionFlag: "A", localHasData: true }), "shortcut");
  assert.equal(Core.decideEntry({ localOwner: null, uid: "A", sessionFlag: null, localHasData: true }), "wipe");
  assert.equal(Core.decideEntry({ localOwner: "A", uid: "A", sessionFlag: "A", localHasData: true }), "shortcut");
});

test("regole della guardia di scrittura: solo chiavi sincronizzate, solo con account attivo, solo se il marcatore non è dell'account attivo", () => {
  const b = Owner.shouldBlockLocalWrite;
  assert.equal(b("spigolestay:guides", "B", "A"), true);
  assert.equal(b("spigolestay:guides", null, "A"), true, "marcatore assente = non sicuro");
  assert.equal(b("spigolestay:guides", "A", "A"), false);
  assert.equal(b("spigolestay:guides", "B", null), false, "scheda senza account attivo (login/idratazione): scrive liberamente");
  assert.equal(b("xn-collab", "B", "A"), false, "chiavi per-dispositivo: mai bloccate");
  assert.equal(b(Core.LOCAL_OWNER_KEY, "B", "A"), false);
  assert.equal(b("xenora:something", "B", "A"), true);
  assert.equal(Owner.isLocalForeign({ getItem: () => { throw new Error("storage non disponibile"); } }, "A"), false, "storage non disponibile: nulla da proteggere");
  assert.equal(Owner.isLocalForeign({ getItem: () => null }, "A"), true);
});

test("stesso account in due schede: nessuna pausa, i dati si scambiano normalmente", async () => {
  const br = new Browser(), server = new Server();
  server.write("A", flatFor("A"));
  const t1 = new Tab("1", "A", br, server, "full"), t2 = new Tab("2", "A", br, server, "full");
  await t1.enter(); await t2.enter();
  assert.equal(t1.uiWrite("spigolestay:msgsent", j([{ key: "MARK_A_due", at: 5 }])), true);
  assert.equal(await t1.cycle(), "ok");
  assert.equal(await t2.cycle(), "ok");
  assert.equal(JSON.stringify(server.row("A")).includes("MARK_A_due"), true);
});
