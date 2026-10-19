import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const store: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } };
const M = await import("../src/lib/msg-overrides.ts");
const G = await import("../src/lib/guest-messages.ts");
const C = await import("../src/lib/chat-pay-core.ts");
const R = await import("../src/lib/reviews.ts");

test("fillTemplate: segnaposto, valori vuoti, righe vuote", () => {
  assert.equal(M.fillTemplate("Ciao {nome}, benvenuto", { nome: "Anna" }), "Ciao Anna, benvenuto");
  assert.equal(M.fillTemplate("Ciao {nome}, benvenuto", { nome: "" }), "Ciao, benvenuto");
  assert.equal(M.fillTemplate("Ciao\n— {firma}", { firma: "" }), "Ciao");
  assert.equal(M.fillTemplate("Ciao\n— {firma}", { firma: "Casa" }), "Ciao\n— Casa");
  assert.equal(M.fillTemplate("Qui:\n{x}\nFine", { x: "" }), "Fine"); // la riga che introduce il valore sparisce con lui
  assert.equal(M.fillTemplate("a {ignoto} b", {}), "a b");
  assert.equal(M.fillTemplate("{n} {altri}", { n: 2, altri: "ospiti" }), "2 ospiti");
});

test("messaggi predefiniti: stessi testi di prima", () => {
  assert.equal(G.CHECKIN_MSG.it("https://x/c"), "Per velocizzare il suo arrivo la invitiamo a completare il check-in online (dati e documento, bastano due minuti): https://x/c");
  assert.equal(G.GUIDE_MSG.en("U"), "Here is our guest guide with all the useful info: U");
  assert.ok(G.CHECKIN_MORE_MSG.it(1, "L").includes("ci mancano i dati di 1 altro ospite"));
  assert.ok(G.CHECKIN_MORE_MSG.it(3, "L").includes("di 3 altri ospiti"));
  assert.equal(G.checkoutMessage("it", { date: "19.10", time: "11:00", structure: "Casa" }), "Il check-out è previsto il 19.10 entro le 11:00. Per qualsiasi esigenza (ad esempio il deposito bagagli) ci scriva pure qui. Grazie per aver scelto Casa: è stato un piacere ospitarla!");
  assert.ok(G.checkoutMessage("it", { date: "19.10" }).includes("il 19.10. Per qualsiasi") && G.checkoutMessage("it", { date: "19.10" }).includes("la nostra struttura"));
  assert.equal(G.checkinRequestMsg("it", { name: "Anna", structure: "Casa", link: "L" }), "Gentile Anna, le scriviamo da Casa. Per velocizzare il suo arrivo la invitiamo a completare il check-in online (dati e documento, bastano 2 minuti): L . Grazie e a presto!\n— Casa");
  assert.ok(!G.checkinRequestMsg("it", { link: "L" }).includes("—"));
  assert.equal(G.reminderIntro("it"), "Un promemoria dalla struttura. ");
  assert.equal(C.chatPayGuestMessage("it", "saldo", 12000, "U"), "Può pagare il saldo del soggiorno (€ 120,00) online con carta, in modo sicuro: U".replace("€ 120,00", C.chatPayGuestMessage("it", "saldo", 12000, "U").match(/\(([^)]+)\)/)![1]));
  assert.ok(C.chatPayGuestMessage("it", "tassa", 500, "U").startsWith("Può pagare la tassa di soggiorno ("));
  const rv = R.reviewRequestMessage({ guestName: "Anna Rossi", structureName: "Casa", reviewUrl: "https://g/r" });
  assert.ok(rv.startsWith("Ciao Anna,\ngrazie di aver scelto Casa!") && rv.includes("Bastano 30 secondi da qui:\nhttps://g/r") && rv.endsWith("a presto! 🌊"));
  const noLink = R.reviewRequestMessage({ guestName: "Anna", structureName: "Casa" });
  assert.ok(!noLink.includes("Bastano 30 secondi")); // senza link la riga introduttiva sparisce
});

test("testo modificato dal gestore: vince sul predefinito, per lingua, e si può ripristinare", () => {
  M.saveOverride("checkin", "it", "Ciao! Fai il check-in qui: {link}");
  assert.equal(G.CHECKIN_MSG.it("U"), "Ciao! Fai il check-in qui: U");
  assert.ok(G.CHECKIN_MSG.en("U").startsWith("To speed up")); // altre lingue invariate
  M.saveOverride("paySaldo", "it", "Paga {importo} qui: {link}");
  assert.equal(C.chatPayGuestMessage("it", "saldo", 5000, "U").endsWith(": U"), true);
  assert.ok(C.chatPayGuestMessage("it", "saldo", 5000, "U").startsWith("Paga "));
  M.saveOverride("checkin", "it", null);
  assert.ok(G.CHECKIN_MSG.it("U").startsWith("Per velocizzare"));
  M.saveOverride("paySaldo", "it", "  ");
  assert.ok(C.chatPayGuestMessage("it", "saldo", 5000, "U").startsWith("Può pagare"));
  assert.deepEqual(M.loadOverrides(), {});
});

test("registro dei messaggi: ogni messaggio ha i testi in 5 lingue e i segnaposto dichiarati", () => {
  for (const m of M.SYSTEM_MESSAGES) {
    for (const l of M.MSG_LANGS) {
      assert.ok(m.texts[l].trim().length > 0, `${m.id}/${l}`);
      for (const k of [...m.texts[l].matchAll(/\{(\w+)\}/g)].map((x) => x[1])) assert.ok(m.vars.some((v) => v.key === k), `${m.id}/${l}: {${k}} non dichiarato`);
    }
  }
});

test("messaggi della scheda: contatto, invito check-in breve, recensione rapida", () => {
  assert.equal(M.renderSystemMessage("contact", "it", { nome: "Anna Rossi", struttura: "Casa", checkin: "12.10.2026" }), "Buongiorno Anna Rossi, le scriviamo da Casa riguardo al soggiorno del 12.10.2026.");
  assert.equal(M.renderSystemMessage("checkinShort", "it", { nome: "Anna", struttura: "Casa", link: "L" }), "Buongiorno Anna, per velocizzare l'arrivo a Casa completa il check-in online qui: L");
  assert.equal(M.renderSystemMessage("checkinShort", "it", { nome: "", struttura: "Casa", link: "L" }), "Buongiorno, per velocizzare l'arrivo a Casa completa il check-in online qui: L");
  assert.equal(M.renderSystemMessage("reviewQuick", "it", { nome: "Anna", struttura: "Casa", link: "https://g/r" }), "Grazie Anna per aver soggiornato da Casa! Se ti sei trovato bene, ci lasceresti una recensione su Google? Ci aiuta tantissimo. https://g/r");
});

test("link WhatsApp: Web sul computer (emoji giuste), wa.me sul telefono", async () => {
  const { waSendUrl } = await import("../src/lib/wa-link.ts");
  const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120";
  const phone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148";
  assert.equal(waSendUrl("39333", "Ciao 😊", desktop), "https://web.whatsapp.com/send?phone=39333&text=Ciao%20%F0%9F%98%8A");
  assert.equal(waSendUrl("39333", "Ciao 😊", phone), "https://wa.me/39333?text=Ciao%20%F0%9F%98%8A");
});
