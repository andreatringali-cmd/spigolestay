import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// puliziePlan.ts importa "@/lib/..." : li risolve l'hook di tests/helpers.
register("./helpers/alias-loader.mjs", import.meta.url);
const { buildPuliziePlanText, buildPuliziePlanSummary } = await import("../src/lib/puliziePlan.ts");

const S = { id: "s1", name: "Spigolehouse" };
const unit = (n: string) => ({ id: `u${n}`, name: n });
const bk = (id: string, guestId: string, ci: string, co: string, adults = 2) => ({ id, guestId, checkIn: ci, checkOut: co, adults, children: 0 });
const guests = [{ id: "g1", fullName: "SUN HE" }, { id: "g2", fullName: "Karl Josef" }, { id: "g3", fullName: "Thomas Pies" }];
const room = (n: string, action: string, extra: Record<string, unknown> = {}) => ({ unit: unit(n), structure: S, typeName: "Std", oos: false, oosFrom: false, action, ...extra });
const rooms = [
  room("10", "riassetto", { stay: bk("b3", "g3", "2026-10-10", "2026-10-13", 1) }),
  room("2", "niente"),
  room("1", "turnover", { dep: bk("b1", "g1", "2026-10-09", "2026-10-11"), arr: bk("b2", "g2", "2026-10-11", "2026-10-13") }),
  room("3", "partenza", { dep: bk("b4", "g1", "2026-10-09", "2026-10-11") }),
  room("5", "niente", { oos: true, oosNote: "perdita d'acqua" }),
];
const args = { date: "2026-10-11", scopedStructures: [S], rooms, guests } as never;

test("il testo è ordinato per lavoro, con le camere in ordine naturale e le vuote in una riga", () => {
  const t = buildPuliziePlanText({ ...args, style: "plain" } as never);
  assert.ok(t.indexOf("Partenza + Arrivo") < t.indexOf("\nPartenza\n"));
  assert.ok(t.indexOf("\nPartenza\n") < t.indexOf("\nRiassetto\n"));
  assert.match(t, /• 1: esce SUN HE · entra Karl Josef \(2 pers\., fino al 13\.10\)/);
  assert.match(t, /\nNiente\n• 2/);
  assert.match(t, /FUORI SERVIZIO\n• 5: perdita d'acqua/);
  assert.match(t, /3 camere da fare/);
});

test("stile email senza asterischi, stile WhatsApp con il grassetto", () => {
  assert.ok(!buildPuliziePlanText({ ...args, style: "plain" } as never).includes("*"));
  assert.ok(buildPuliziePlanText({ ...args, style: "whatsapp" } as never).includes("*Spigolehouse*"));
});

test("riepilogo di una riga per il modello WhatsApp: niente a capo, solo i numeri delle camere", () => {
  const s = buildPuliziePlanSummary(args as never);
  assert.ok(!s.includes("\n"));
  assert.match(s, /Spigolehouse: cambio completo: 1 \| partenza: 3 \| riassetto: 10 \| fuori servizio: 5 \| niente: 2/);
});

test("senza camere: messaggio chiaro", () => {
  assert.match(buildPuliziePlanSummary({ date: "2026-10-11", scopedStructures: [S], rooms: [] } as never), /Nessuna pulizia/);
  assert.match(buildPuliziePlanText({ date: "2026-10-11", scopedStructures: [S], rooms: [], guests: [] } as never), /Nessuna pulizia in programma/);
});

const { buildPuliziePlanFields } = await import("../src/lib/puliziePlan.ts");

test("campi per il modello WhatsApp a righe: una voce per lavoro, mai vuota, persone per cambi e arrivi", () => {
  const f = buildPuliziePlanFields(args as never);
  assert.equal(f.cambio, "1 (2 pers.)");
  assert.equal(f.arrivi, "nessuna");
  assert.equal(f.partenze, "3");
  assert.equal(f.riassetto, "10");
  assert.equal(f.fuori, "5");
  assert.equal(f.niente, "2");
  for (const v of Object.values(f)) assert.ok(v.length > 0 && !v.includes("\n"));
});

test("campi dettagliati: come il messaggio condiviso a mano (chi esce, chi entra, persone, fino a quando), una riga e mai vuoti", () => {
  const f = buildPuliziePlanFields({ ...(args as object), detailed: true } as never);
  assert.equal(f.cambio, "1: esce SUN HE · entra Karl Josef (2 pers., fino al 13.10)");
  assert.equal(f.partenze, "3: esce SUN HE");
  assert.equal(f.riassetto, "10: Thomas Pies (1 pers., fino al 13.10)");
  assert.equal(f.fuori, "5: perdita d'acqua");
  assert.equal(f.arrivi, "nessuna");
  for (const v of Object.values(f)) assert.ok(v.length > 0 && !/[\r\n\t]/.test(v) && !/ {5}/.test(v));
});

test("campi dettagliati: più camere dello stesso lavoro separate da punto e virgola", () => {
  const two = [...(rooms as unknown[]), room("4", "turnover", { dep: bk("b5", "g3", "2026-10-09", "2026-10-11"), arr: bk("b6", "g1", "2026-10-11", "2026-10-14") })];
  const f = buildPuliziePlanFields({ date: "2026-10-11", scopedStructures: [S], rooms: two, guests, detailed: true } as never);
  assert.equal(f.cambio.split("; ").length, 2);
  assert.match(f.cambio, /^1: .*; 4: esce Thomas Pies · entra SUN HE \(2 pers\., fino al 14\.10\)$/);
});

test("riga iniziale e finale scelte dal titolare: prima e dopo l'elenco; vuote = niente", () => {
  const base = buildPuliziePlanText({ ...(args as object), style: "plain" } as never);
  const custom = buildPuliziePlanText({ ...(args as object), style: "plain", intro: "Buongiorno, ecco il planning", outro: "Grazie!" } as never);
  assert.ok(custom.startsWith("Buongiorno, ecco il planning\n\nPulizie di oggi"));
  assert.ok(custom.endsWith("\n\nGrazie!"));
  assert.equal(buildPuliziePlanText({ ...(args as object), style: "plain", intro: "  ", outro: "" } as never), base);
});

test("email: i titoli di sezione (Partenza, Riassetto…) diventano grassetto, gli asterischi non si vedono", async () => {
  const { textBlockHtml } = await import("../src/lib/mail/shell.ts");
  const html = textBlockHtml("*Pulizie di oggi*: giovedì\n\n*Partenza*\n• 3: esce Michela Pianesi");
  assert.match(html, /<b>Pulizie di oggi<\/b>: giovedì/);
  assert.match(html, /<b>Partenza<\/b>/);
  assert.ok(!html.includes("*"));
});

test("email: gli a capo sono <br> (Outlook ignora white-space:pre-wrap e univa tutto il preventivo in un blocco)", async () => {
  const { textBlockHtml, nl2brHtml } = await import("../src/lib/mail/shell.ts");
  const html = textBlockHtml("Preventivo n. 4/2026\r\n\r\nPeriodo:\n• Check-in: 29.10.2026\n• Check-out: 30.10.2026\n\nTOTALE: € 93,60 <ok> & \"x\"");
  assert.ok(!/white-space/.test(html), "niente pre-wrap");
  assert.ok(html.includes("Preventivo n. 4/2026<br>\n<br>\nPeriodo:<br>\n• Check-in: 29.10.2026<br>\n• Check-out"));
  assert.ok(!html.includes("<ok>") && html.includes("&lt;ok&gt; &amp; &quot;x&quot;"), "il testo resta escapato");
  assert.equal(nl2brHtml("a    b"), "a &nbsp;&nbsp;&nbsp;b", "gli spazi multipli si conservano");
});

test("email planning: pulsante «Apri il gestionale», chiusura e piè di pagina della struttura", async () => {
  const { messageEmailHtml, brandFrom } = await import("../src/lib/mail/guest-emails.ts");
  const brand = brandFrom({ structureName: "Central Perk - Antioco", address: "Via Roma 1, Siracusa", phone: "+39 333 0000000", structureEmail: "info@example.com", color: "#285f92" } as never);
  const html = messageEmailHtml({ title: "Planning pulizie", text: "*Pulizie di oggi*: giovedì\n\nGrazie,\nla direzione", accent: "#285f92", brand, ctaUrl: "https://xenora.it/pulizie", ctaLabel: "Apri il gestionale →" });
  assert.match(html, /Apri il gestionale/);
  assert.match(html, /https:\/\/xenora\.it\/pulizie/);
  assert.match(html, /<b>Pulizie di oggi<\/b>/);
  assert.match(html, /Grazie,\s*la direzione/);
  assert.match(html, /Via Roma 1, Siracusa/);
  assert.match(html, /Central Perk - Antioco/);
});

test("email planning: «Buongiorno,» in apertura e «Grazie, la direzione» in chiusura se il titolare non sceglie le sue righe", () => {
  const src = readFileSync(new URL("../src/lib/pulizie-send.ts", import.meta.url), "utf8");
  assert.match(src, /intro: \(cfg\.intro \?\? ""\)\.trim\(\) \? cfg\.intro : "Buongiorno,"/);
  assert.ok(src.includes('cfg.outro : "Grazie,\\nla direzione"'));
});

test("profilo «solo Pulizie»: sidebar con la sola voce Pulizie in alto, apertura sul programma e non sulla Checklist", () => {
  const sb = readFileSync(new URL("../src/components/Sidebar.tsx", import.meta.url), "utf8");
  assert.match(sb, /isPulizieOnly\(accessUser\.perms\)/);
  assert.match(sb, /n\.href === "\/pulizie"\)\.map\(\(n\) => \(\{ \.\.\.n, group: "" \}\)\)/);
  const gate = readFileSync(new URL("../src/components/AccessGate.tsx", import.meta.url), "utf8");
  assert.ok(gate.includes('router.replace("/pulizie")') && !gate.includes("tab=checklist"));
  const pg = readFileSync(new URL("../src/app/(app)/pulizie/page.tsx", import.meta.url), "utf8");
  assert.ok(!/if \(want \|\| pulOnly\)/.test(pg));
});

test("profilo «solo Pulizie»: «Il mio profilo» (foto, password, esci) si apre dal nome in basso e non viene rimandata indietro", () => {
  const sb = readFileSync(new URL("../src/components/Sidebar.tsx", import.meta.url), "utf8");
  const us = readFileSync(new URL("../src/components/UserSwitcher.tsx", import.meta.url), "utf8");
  assert.ok(us.includes("isPulizieOnly(user.perms)") && us.includes('href="/profilo"') && us.includes("Il mio profilo"));
  assert.ok(!sb.includes('label: "Il mio profilo"')); // nella sidebar resta la sola voce Pulizie
  const gate = readFileSync(new URL("../src/components/AccessGate.tsx", import.meta.url), "utf8");
  assert.ok(gate.includes('!pathname.startsWith("/profilo")'));
  const pg = readFileSync(new URL("../src/app/(app)/profilo/page.tsx", import.meta.url), "utf8");
  assert.ok(pg.includes("Cambia password") && pg.includes("Carica foto") && pg.includes("signOut"));
});
