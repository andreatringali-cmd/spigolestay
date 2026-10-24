// Difese della Guida ospiti: una guida PIENA non diventa mai una più VUOTA per effetto di un salvataggio automatico, di una pagina con dati vecchi o della fusione tra dispositivi.
// (a) mai campi pieni → vuoti senza azione esplicita   (b) conferma in italiano chiaro prima di «Parti dall'esempio»   (c) copia di salvataggio «Annulla ultima sostituzione».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const G = await import("../src/lib/guide-protect.ts");
const Core = await import("../src/lib/sync-core.ts");
const Flat = await import("../src/lib/sync-flat.ts");

type Rec = Record<string, unknown>;
const j = (v: unknown) => JSON.stringify(v);
const KEY = "spigolestay:guides";
const SID = "7c476811-719a-48d2-a742-6eadb33ba9b8";

// Guida PIENA (come quella fatta partendo da «Parti dall'esempio» e rifinita).
const sec = (id: string, title: string, intro: string, items: { h: string; p: string }[]) => ({ id, icon: "info", title, sub: "", intro, photos: [], items });
const fullContent = () => ({
  home: { welcomeTitle: "Benvenuti a Siracusa,", welcomeSub: "siamo felici di ospitarvi", welcome: ["Questa guida vi aiuterà a scoprire la città.", "Buona permanenza!"] },
  sections: [
    sec("checkin", "Arrivo e Self Check-in", "Potete arrivare in piena libertà. Ecco come entrare.", [{ h: "Documenti", p: "Per la registrazione servono i documenti di tutti gli ospiti." }, { h: "Check-out", p: "Check-out entro le 10:30. La tassa di soggiorno è il 4%." }]),
    sec("breakfast", "La colazione", "Nei bar convenzionati qui vicino, con i voucher in camera.", [{ h: "Milk and Coffee", p: "Corso Gelone 22, tutti i giorni tranne il sabato." }]),
    sec("attractions", "Cosa vedere", "La storia è a portata di mano.", [{ h: "Ortigia", p: "Piazza Duomo, Fonte Aretusa, Tempio di Apollo." }, { h: "Neapolis", p: "Teatro Greco e Orecchio di Dionisio." }]),
    sec("wifi", "WiFi gratuito", "", []),
  ],
});
const scaffoldContent = () => ({
  home: { welcomeTitle: "", welcomeSub: "", welcome: [] },
  sections: [sec("checkin", "Arrivo e Self Check-in", "", [{ h: "", p: "" }]), sec("breakfast", "La vostra colazione", "", [{ h: "", p: "" }]), sec("wifi", "WiFi gratuito", "", [])],
});
const fullGuide = (): Rec => ({
  id: SID, guideName: "Spigolehouse", guideLogo: "data:image/png;base64,AAA", name: "Spigolehouse", city: "Siracusa", address: "Corso Gelone 93, 96100 Siracusa", phone: "+39 333 1111111", phoneGreta: "", whatsapp: "+39 333 1111111",
  email: "info@spigole.it", mapsUrl: "https://maps/x", wifiNetwork: "SpigoleWiFi", wifiPassword: "segreta123", wifiQr: "data:qr", wifiQrFor: '["SpigoleWiFi","segreta123"]', checkinTime: "15:00 – 20:00", checkoutTime: "entro le 10:30",
  reviewUrl: "https://g.page/r/x", bookingUrl: "", taxiPhone: "+39 333 2222222", social: { instagram: "spigolehouse", facebook: "", website: "https://spigole.it" }, roomTypes: {},
  tv: { enabled: true, bg: "assets/bg.jpg", welcome: "Benvenuti", sections: ["wifi"], showGuest: true },
  content: fullContent(), i18n: { en: { ...fullContent(), home: { welcomeTitle: "Welcome", welcomeSub: "", welcome: ["Enjoy"] } } },
});
// Quello che la pagina crea da sola quando non trova la guida: dati struttura + scaffold vuoto (nome, indirizzo, telefono, email, mappa, social, logo; niente wifi/orari/taxi).
const poorGuide = (): Rec => ({
  id: SID, guideName: "Spigolehouse", guideLogo: "data:image/png;base64,AAA", name: "Spigolehouse", city: "Siracusa", address: "Corso Gelone 93, 96100 Siracusa", phone: "+39 333 1111111", phoneGreta: "", whatsapp: "",
  email: "info@spigole.it", mapsUrl: "https://maps/x", wifiNetwork: "", wifiPassword: "", checkinTime: "", checkoutTime: "", reviewUrl: "", bookingUrl: "", taxiPhone: "",
  social: { instagram: "spigolehouse", facebook: "", website: "" }, roomTypes: {}, tv: { enabled: false, bg: "", welcome: "", sections: [], showGuest: true }, content: scaffoldContent(),
});
const structFields = (): Rec => ({ name: "Spigolehouse", city: "Siracusa", guideLogo: "data:image/png;base64,AAA", address: "Corso Gelone 93, 96100 Siracusa", mapsUrl: "https://maps/x", phone: "+39 333 1111111", email: "info@spigole.it", whatsapp: "+39 333 1111111", phoneGreta: "", social: { instagram: "spigolehouse", facebook: "", website: "https://spigole.it" } });

// ── (a) mai pieno → vuoto senza azione esplicita ─────────────────────────────────────────────────────────────────────────────────────────
test("protectGuideWrite: un campo pieno non diventa vuoto se non è tra quelli scelti dal titolare", () => {
  const prev = fullGuide();
  const { guide, restored } = G.protectGuideWrite(prev, poorGuide(), []);
  assert.equal(guide.wifiPassword, "segreta123");
  assert.equal(guide.taxiPhone, "+39 333 2222222");
  assert.equal(guide.checkinTime, "15:00 – 20:00");
  assert.equal((guide.social as Rec).website, "https://spigole.it", "anche dentro un oggetto");
  assert.equal(G.contentHasText(guide.content), true, "i testi restano");
  assert.deepEqual(guide.content, prev.content);
  assert.deepEqual(guide.i18n, prev.i18n, "le traduzioni restano");
  assert.ok(restored.includes("content") && restored.includes("wifiPassword") && restored.includes("i18n"), restored.join(","));
});

test("protectGuideWrite: svuotare un campo di proposito (azione esplicita) è ancora possibile", () => {
  const prev = fullGuide();
  const next = { ...prev, wifiPassword: "", social: { ...(prev.social as Rec), website: "" } };
  const r1 = G.protectGuideWrite(prev, next, ["wifiPassword", "social"]);
  assert.equal(r1.guide.wifiPassword, "");
  assert.equal((r1.guide.social as Rec).website, "");
  const r2 = G.protectGuideWrite(prev, next, ["wifiPassword"]);
  assert.equal(r2.guide.wifiPassword, "", "il campo scelto passa");
  assert.equal((r2.guide.social as Rec).website, "https://spigole.it", "quello non scelto resta");
  // «Parti dall'esempio» sostituisce testi e traduzioni: content e i18n sono espliciti
  const r3 = G.protectGuideWrite(prev, { ...prev, content: scaffoldContent(), i18n: {} }, ["content", "i18n"]);
  assert.equal(G.contentHasText(r3.guide.content), false);
  assert.deepEqual(r3.guide.i18n, {});
  // numeri e interruttori spenti non sono «vuoti»: si possono cambiare
  const r4 = G.protectGuideWrite(prev, { ...prev, tv: { ...(prev.tv as Rec), enabled: false } }, []);
  assert.equal((r4.guide.tv as Rec).enabled, false);
});

test("pagina con copia VECCHIA in memoria: il salvataggio parte dalla mappa letta ora e non cancella il lavoro altrui né le altre strutture", () => {
  const OTHER = "altra-struttura";
  const stored = { [SID]: fullGuide(), [OTHER]: { id: OTHER, name: "Altra", content: fullContent() } };      // in localStorage ora (aggiornato dalla sincronizzazione)
  const staleAll = { [SID]: poorGuide() };                                                                   // ciò che la pagina aveva caricato all'apertura
  // comportamento di PRIMA: persist({ ...all, [sid]: { ...guide, ...patch } }) → riscrive la mappa intera dalla copia vecchia
  const before = { ...staleAll, [SID]: { ...staleAll[SID], wifiQr: "data:qr2" } };
  assert.equal(G.contentHasText((before[SID] as Rec).content), false, "prima: la guida piena veniva persa");
  assert.equal(OTHER in before, false, "prima: spariva anche l'altra struttura");
  // ora
  const res = G.commitGuidePatch(stored, SID, { wifiQr: "data:qr2", wifiQrFor: "k" }, ["wifiQr", "wifiQrFor"], staleAll[SID]);
  const g = res.map[SID] as Rec;
  assert.equal(g.wifiQr, "data:qr2");
  assert.equal(g.wifiPassword, "segreta123");
  assert.equal(G.contentHasText(g.content), true);
  assert.deepEqual(res.map[OTHER], stored[OTHER], "le altre strutture restano identiche");
});

test("allineamento con i dati struttura: non crea scaffold vuoti sopra una guida piena e, senza struttura, non svuota nulla", () => {
  const stored = { [SID]: fullGuide() };
  // la struttura esiste: i suoi campi seguono le Impostazioni, ma wifi/orari/taxi/testi restano
  const merged = { ...poorGuide(), ...structFields(), content: (stored[SID] as Rec).content };
  const withStruct = G.commitGuidePatch(stored, SID, merged, Object.keys(structFields()), poorGuide());
  assert.equal((withStruct.guide as Rec).wifiPassword, "segreta123");
  assert.equal((withStruct.guide as Rec).taxiPhone, "+39 333 2222222");
  // la struttura non è (ancora) caricata: campi vuoti non cancellano quelli pieni
  const noStruct = G.commitGuidePatch(stored, SID, { ...poorGuide(), name: "", city: "", address: "", phone: "", email: "", mapsUrl: "", guideLogo: "", social: { instagram: "", facebook: "", website: "" } }, [], poorGuide());
  assert.equal((noStruct.guide as Rec).address, "Corso Gelone 93, 96100 Siracusa");
  assert.equal((noStruct.guide as Rec).phone, "+39 333 1111111");
  assert.equal(((noStruct.guide as Rec).social as Rec).website, "https://spigole.it");
  assert.equal(G.contentHasText((noStruct.guide as Rec).content), true);
  // tutta la guida era assente nella mappa letta: si crea (è una guida nuova), ma da lì in poi è protetta
  const created = G.commitGuidePatch({}, SID, { ...poorGuide() }, [], poorGuide());
  assert.equal((created.map[SID] as Rec).id, SID);
});

// ── fusione tra dispositivi (la pipeline vera: mergeSnapshots → mergeFlatKeys3 → mergeGuidesMap) ─────────────────────────────────────────
const DK = "spigolestay:data:v1";
const snapWith = (guides: Rec): Record<string, string> => ({ [DK]: j({ structures: [{ id: SID, name: "S" }], bookings: [], guests: [], units: [], roomTypes: [], events: [], directReviews: [], _deleted: {} }), [KEY]: j(guides) });
const guideOf = (merged: Record<string, string>) => JSON.parse(merged[KEY])[SID] as Rec;

test("fusione: la guida povera (locale o server) non cancella quella piena, in nessuna direzione", () => {
  const FULL = { [SID]: fullGuide() }, POOR = { [SID]: poorGuide() };
  // 1) primo avvio senza base: locale povero (scaffold creato dalla pagina), server pieno
  let m = Core.mergeSnapshots(snapWith(POOR), snapWith(FULL), {}, {});
  assert.equal(G.contentHasText(guideOf(m).content), true);
  assert.equal(guideOf(m).wifiPassword, "segreta123");
  // 2) locale pieno invariato rispetto alla base, il server è stato sovrascritto da uno scaffold: la fusione NON lo adotta e riporta la guida piena
  m = Core.mergeSnapshots(snapWith(FULL), snapWith(POOR), snapWith(FULL), Core.readSyncBase(Core.syncBaseText("u", snapWith(FULL)), "u") ?? {});
  assert.equal(G.contentHasText(guideOf(m).content), true);
  assert.equal(guideOf(m).taxiPhone, "+39 333 2222222");
  assert.deepEqual(guideOf(m).i18n, fullGuide().i18n);
  // 3) base persistente (solo impronte): locale invariato, server povero → idem
  const bh = Core.readSyncBase(Core.syncBaseText("u", snapWith(FULL)), "u") ?? {};
  m = Core.mergeSnapshots(snapWith(FULL), snapWith(POOR), {}, bh);
  assert.equal(G.contentHasText(guideOf(m).content), true);
  // 4) entrambi cambiati: il locale ha scritto testi nuovi, il server ha lo scaffold → restano i testi del locale
  const edited = { ...fullGuide(), content: { ...fullContent(), home: { welcomeTitle: "Ciao a tutti", welcomeSub: "", welcome: ["Testo nuovo"] } } };
  m = Core.mergeSnapshots(snapWith({ [SID]: edited }), snapWith(POOR), snapWith(FULL), {});
  assert.equal((guideOf(m).content as { home: { welcomeTitle: string } }).home.welcomeTitle, "Ciao a tutti");
  // 5) il vecchio comportamento, per confronto: chiave intera "vince il server" → perdita
  const old = Flat.mergeFlatKeys3({ ...snapWith(FULL) }, snapWith(FULL), snapWith(POOR), snapWith(FULL), null, () => false);
  assert.equal(typeof old[KEY], "string"); // (con la nuova regola il risultato non è mai lo scaffold: vedi i casi sopra)
  assert.equal(G.contentHasText(guideOf(old).content), true);
});

test("fusione: una modifica piccola e voluta fatta altrove (un solo campo svuotato) si accetta; un svuotamento di massa no", () => {
  const FULL = { [SID]: fullGuide() };
  const bh = Core.readSyncBase(Core.syncBaseText("u", snapWith(FULL)), "u") ?? {};
  // l'altro dispositivo ha tolto la password del Wi-Fi (e il QR derivato)
  const cleared = { ...fullGuide(), wifiPassword: "", wifiQr: "", wifiQrFor: "" };
  let m = Core.mergeSnapshots(snapWith(FULL), snapWith({ [SID]: cleared }), snapWith(FULL), bh);
  assert.equal(guideOf(m).wifiPassword, "", "cancellazione voluta di un campo: passa");
  // l'altro dispositivo ha perso testi e traduzioni (scaffold): non passa
  m = Core.mergeSnapshots(snapWith(FULL), snapWith({ [SID]: poorGuide() }), snapWith(FULL), bh);
  assert.equal(guideOf(m).wifiPassword, "segreta123");
  // l'altro dispositivo ha tolto solo i testi (resta il resto): non passa
  const noText = { ...fullGuide(), content: scaffoldContent() };
  m = Core.mergeSnapshots(snapWith(FULL), snapWith({ [SID]: noText }), snapWith(FULL), bh);
  assert.equal(G.contentHasText(guideOf(m).content), true);
});

test("fusione: senza base una guida presente solo da una parte resta, e l'esito è stabile (nessun ping-pong)", () => {
  const FULL = { [SID]: fullGuide() }, POOR = { [SID]: poorGuide() };
  const only = Core.mergeSnapshots(snapWith({}), snapWith(FULL), {}, {});
  assert.equal(guideOf(only).wifiPassword, "segreta123");
  const a = G.mergeGuidesMap(undefined, j(POOR), j(FULL))!;
  const b = G.mergeGuidesMap(undefined, a, j(FULL))!;
  assert.equal(JSON.stringify(JSON.parse(a)), JSON.stringify(JSON.parse(b)), "rifondere il risultato non cambia nulla");
  assert.equal(G.mergeGuidesMap(undefined, "non-json", j(FULL)), null);
});

// ── (b) conferma chiara prima di «Parti dall'esempio» ───────────────────────────────────────────────────────────────────────────────────
test("messaggio di conferma: dice COSA verrà sostituito (sezioni, parole, traduzioni) in italiano chiaro", () => {
  const sum = G.summarizeGuide(fullGuide());
  assert.deepEqual(sum.sections, ["Arrivo e Self Check-in", "La colazione", "Cosa vedere"]);
  assert.ok(sum.words > 40);
  assert.deepEqual(sum.languages, ["inglese"]);
  const msg = G.replaceConfirmMessage("Spigolehouse", sum, "esempio");
  for (const frag of ["«Spigolehouse»", "3 sezioni compilate", "Arrivo e Self Check-in", "parole di testo", "traduzioni già fatte: inglese", "SOSTITUITI", "esempio di Siracusa", "non vengono toccati", "Annulla ultima sostituzione"]) {
    assert.ok(msg.includes(frag), `manca «${frag}» in:\n${msg}`);
  }
  const copia = G.replaceConfirmMessage("Rooms", sum, "struttura", "Spigolehouse");
  assert.ok(copia.includes("quelli di «Spigolehouse»") && copia.includes("copiate insieme ai testi"));
  // una guida con più di 5 sezioni compilate le abbrevia
  const many = G.summarizeGuide({ content: { home: { welcome: [] }, sections: Array.from({ length: 8 }, (_, i) => sec("s" + i, "Sezione " + i, "testo " + i, [])) } });
  assert.ok(G.replaceConfirmMessage("X", many, "esempio").includes("e altre 3"));
  // scaffold vuoto: nessuna sezione compilata
  assert.equal(G.summarizeGuide(poorGuide()).sections.length, 0);
});

test("la pagina chiede conferma con il riepilogo (non più il confirm() generico) e non riscrive più la mappa intera dalla copia in memoria", () => {
  const src = fs.readFileSync(new URL("../src/app/(app)/guida-ospiti/page.tsx", import.meta.url), "utf8");
  const demo = src.slice(src.indexOf("const loadDemo = async"), src.indexOf("const undoSlot"));
  assert.ok(demo.includes("await confirmAsk({") && demo.includes("replaceConfirmMessage("), "loadDemo chiede conferma con il riepilogo");
  assert.ok(demo.includes("rememberGuideUndo("), "loadDemo salva la copia di salvataggio prima di sostituire");
  assert.ok(demo.indexOf("rememberGuideUndo(") < demo.indexOf("set({ ...guidePatch"), "la copia viene fatta PRIMA della sostituzione");
  assert.equal(/\bconfirm\(/.test(demo.replace(/confirmAsk\(/g, "")), false, "niente confirm() del browser");
  const copy = src.slice(src.indexOf("const copyFromOther = async"), src.indexOf("const otherStructs"));
  assert.ok(copy.includes("await confirmAsk({") && copy.includes("rememberGuideUndo("), "anche «Copia da un'altra struttura» chiede conferma e salva la copia");
  assert.equal(src.includes("persist({ ...all"), false, "nessun salvataggio riscrive la mappa intera dalla copia in memoria");
  assert.ok(src.includes("commitGuidePatch("), "i salvataggi passano da commitGuidePatch");
  assert.ok(src.includes("if (!cur && !struct) return;"), "senza guida né struttura non si crea uno scaffold");
  assert.ok(src.includes("Annulla ultima sostituzione"), "pulsante di annullamento presente");
  assert.ok(src.includes("isLocalForeign(localStorage, authUser.id)"), "niente pubblicazione della guida da una scheda con dati di un altro account");
});

// ── (c) copia di salvataggio «Annulla ultima sostituzione» ───────────────────────────────────────────────────────────────────────────────
class FakeSession { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

test("annulla ultima sostituzione: dopo «Parti dall'esempio» si torna ESATTAMENTE alla guida di prima (testi, traduzioni, campi)", () => {
  G.__resetGuideUndoForTests();
  const ss = new FakeSession();
  const stored = { [SID]: fullGuide(), altra: { id: "altra", name: "Altra" } };
  const before = stored[SID];
  // 1) il titolare conferma: copia di salvataggio, poi sostituzione esplicita di testi e traduzioni
  assert.equal(G.rememberGuideUndo(SID, before, "Parti dall'esempio", 1000, ss), true);
  const exampleContent = { home: { welcomeTitle: "Benvenuti a Siracusa,", welcomeSub: "", welcome: ["esempio"] }, sections: [sec("checkin", "Arrivo", "esempio", [{ h: "x", p: "y" }])] };
  const replaced = G.commitGuidePatch(stored, SID, { content: exampleContent, i18n: {} }, ["content", "i18n"], before);
  assert.equal(((replaced.guide.content as Rec).home as Rec).welcomeTitle, "Benvenuti a Siracusa,");
  assert.deepEqual(replaced.guide.i18n, {});
  assert.equal(replaced.guide.wifiPassword, "segreta123", "i dati reali non si toccano");
  // 2) annulla: la copia c'è (anche dopo un ricaricamento della pagina: sessionStorage) e rimette tutto
  G.__resetGuideUndoForTests();                                // simula il ricaricamento (memoria persa)
  const slot = G.peekGuideUndo(SID, ss)!;
  assert.equal(slot.label, "Parti dall'esempio");
  const undone = G.commitGuidePatch(replaced.map, SID, slot.guide, Object.keys(slot.guide), before);
  assert.deepEqual(undone.guide, before);
  assert.deepEqual(undone.map.altra, stored.altra);
  G.clearGuideUndo(SID, ss);
  assert.equal(G.peekGuideUndo(SID, ss), null, "dopo l'annullamento la copia non c'è più");
});

test("copia di salvataggio: è una COPIA (modifiche successive non la cambiano), una per struttura, e non esplode se sessionStorage è pieno", () => {
  G.__resetGuideUndoForTests();
  const g = fullGuide();
  const full = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
  assert.equal(G.rememberGuideUndo(SID, g, "A", 1, full), true);
  (g.content as Rec).home = { welcomeTitle: "cambiato", welcome: [] };
  assert.equal(((G.peekGuideUndo(SID, full)!.guide.content as Rec).home as Rec).welcomeTitle, "Benvenuti a Siracusa,");
  G.rememberGuideUndo("altra", { id: "altra" }, "B", 2, full);
  assert.equal(G.peekGuideUndo(SID, full)!.label, "A");
  G.rememberGuideUndo(SID, { id: SID, name: "nuova" }, "C", 3, full);
  assert.equal(G.peekGuideUndo(SID, full)!.label, "C", "una nuova sostituzione rimpiazza la copia precedente della stessa struttura");
  assert.equal(G.rememberGuideUndo("", g, "x", 1, full), false);
  assert.equal(G.rememberGuideUndo(SID, null, "x", 1, full), false);
  G.__resetGuideUndoForTests();
});

test("la chiave della copia di salvataggio NON è sincronizzata (resta sul dispositivo, non finisce sul server)", () => {
  assert.equal(Core.isSyncKey("xn-guide-undo:" + SID), false);
});

// ── D1: struttura esistente ma con campi vuoti ───────────────────────────────────────────────────────────────────────────────────────────
test("struttura esistente ma con campi vuoti: telefono, email, mappa, social pieni della guida NON diventano vuoti", () => {
  const emptyStruct: Rec = { name: "", city: "", guideLogo: "", address: "", mapsUrl: "", phone: "", email: "", whatsapp: "", phoneGreta: "", social: { instagram: "", facebook: "", website: "" } };
  assert.deepEqual(G.structExplicitKeys(emptyStruct), [], "nessun campo vuoto è una scelta del titolare");
  const stored = { [SID]: fullGuide() };
  const prev = fullGuide();
  const merged = { ...prev, ...emptyStruct, content: prev.content, id: SID, social: { ...(prev.social as Rec), ...(emptyStruct.social as Rec) } };
  const res = G.commitGuidePatch(stored, SID, merged, G.structExplicitKeys(emptyStruct), prev);
  for (const k of ["phone", "email", "mapsUrl", "address", "whatsapp", "guideLogo", "name", "city"]) assert.equal(res.guide[k], prev[k], k);
  assert.equal((res.guide.social as Rec).instagram, "spigolehouse");
  assert.equal((res.guide.social as Rec).website, "https://spigole.it");
  assert.ok(res.restored.includes("phone") && res.restored.includes("email") && res.restored.includes("mapsUrl"), res.restored.join(","));
  // Con il vecchio calcolo (tutte le chiavi) il danno c'era: lo si dimostra, così il test fallirebbe se si tornasse indietro.
  const old = G.commitGuidePatch(stored, SID, merged, Object.keys(emptyStruct), prev);
  assert.equal(old.guide.phone, "", "con tutte le chiavi «esplicite» il telefono si svuotava");
});

test("struttura con alcuni campi pieni: quelli pieni seguono la struttura (anche se cambiati), i vuoti non svuotano", () => {
  const fields: Rec = { name: "Nuovo nome", city: "", phone: "+39 333 9999999", email: "", social: { instagram: "nuovo_ig", facebook: "", website: "" } };
  assert.deepEqual(G.structExplicitKeys(fields).sort(), ["name", "phone", "social.instagram"]);
  const prev = fullGuide();
  const merged = { ...prev, ...fields, content: prev.content, id: SID, social: { ...(prev.social as Rec), ...(fields.social as Rec) } };
  const res = G.commitGuidePatch({ [SID]: prev }, SID, merged, G.structExplicitKeys(fields), prev);
  assert.equal(res.guide.name, "Nuovo nome");
  assert.equal(res.guide.phone, "+39 333 9999999");
  assert.equal((res.guide.social as Rec).instagram, "nuovo_ig");
  assert.equal(res.guide.email, "info@spigole.it", "email vuota in struttura: resta quella della guida");
  assert.equal(res.guide.city, "Siracusa");
  assert.equal((res.guide.social as Rec).website, "https://spigole.it");
});

test("la pagina usa structExplicitKeys (non tutte le chiavi) per l'allineamento con la struttura", () => {
  const src = fs.readFileSync(new URL("../src/app/(app)/guida-ospiti/page.tsx", import.meta.url), "latin1");
  assert.ok(src.includes("structExplicitKeys(structFields"), "la pagina passa solo le chiavi piene");
  assert.ok(!src.includes("Object.keys(structFields)"), "niente più Object.keys(structFields)");
});
