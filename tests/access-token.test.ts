import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAccessUrl, verifyAccessToken, safeNext, decideAccess } from "../src/lib/access-token.ts";
import { buildInviteEmail } from "../src/lib/invite-notify.ts";

process.env.ALLOWLIST_APPROVE_SECRET = "segreto-di-prova";
const parse = (u: string) => { const q = new URL(u).searchParams; return { e: q.get("e")!, t: q.get("t")!, n: q.get("n")!, s: q.get("s")! }; };

test("link di accesso: valido, con l'email normalizzata", () => {
  const u = buildAccessUrl("https://xenora.it", "  Mario.Rossi@Example.COM ", "/pulizie")!;
  const p = parse(u);
  assert.equal(p.e, "mario.rossi@example.com");
  assert.equal(verifyAccessToken(p.e, p.t, p.n, p.s), "mario.rossi@example.com");
});
test("link di accesso: modificato (altra email, altro percorso, firma) non vale", () => {
  const p = parse(buildAccessUrl("https://xenora.it", "a@x.it", "/pulizie")!);
  assert.equal(verifyAccessToken("b@x.it", p.t, p.n, p.s), null);
  assert.equal(verifyAccessToken(p.e, p.t, "/prenotazioni", p.s), null);
  assert.equal(verifyAccessToken(p.e, p.t, p.n, p.s.slice(0, -1) + (p.s.endsWith("0") ? "1" : "0")), null); // cambia davvero l'ultimo carattere (prima 1 volta su 16 restava uguale)
  assert.equal(verifyAccessToken(p.e, p.t, p.n, "zz"), null);
});
test("link di accesso: scade dopo 7 giorni", () => {
  const now = Date.now();
  const p = parse(buildAccessUrl("https://xenora.it", "a@x.it", "/", now)!);
  assert.equal(verifyAccessToken(p.e, p.t, p.n, p.s, now + 6 * 86400000), "a@x.it");
  assert.equal(verifyAccessToken(p.e, p.t, p.n, p.s, now + 8 * 86400000), null);
});
test("link di accesso: senza segreto configurato resta spento", () => {
  const saved = process.env.ALLOWLIST_APPROVE_SECRET; delete process.env.ALLOWLIST_APPROVE_SECRET;
  assert.equal(buildAccessUrl("https://xenora.it", "a@x.it"), null);
  assert.equal(verifyAccessToken("a@x.it", "1", "/", "aa"), null);
  process.env.ALLOWLIST_APPROVE_SECRET = saved;
});
test("percorso dopo l'accesso: solo interno (mai un sito esterno)", () => {
  assert.equal(safeNext("/pulizie"), "/pulizie");
  assert.equal(safeNext("//evil.com"), "/");
  assert.equal(safeNext("https://evil.com"), "/");
  assert.equal(safeNext("/" + String.fromCharCode(92) + "evil"), "/");
  assert.equal(safeNext(undefined), "/");
});
test("scelta della password: crea, completa, imposta su un accesso esistente, rifiuta un link già consumato", () => {
  const ts = 1_800_000_000; // secondi
  assert.equal(decideAccess(null, ts), "create");
  assert.equal(decideAccess({ confirmed: false }, ts), "complete");
  // accesso già confermato (es. Google), mai entrato dopo la creazione del link: può impostare la password
  assert.equal(decideAccess({ confirmed: true, lastSignInAt: new Date((ts - 3600) * 1000).toISOString() }, ts), "reset");
  assert.equal(decideAccess({ confirmed: true, lastSignInAt: null }, ts), "reset");
  // è entrato dopo che il link è stato creato: il link si è «consumato»
  assert.equal(decideAccess({ confirmed: true, lastSignInAt: new Date((ts + 60) * 1000).toISOString() }, ts), "used");
});
test("email di invito: con il link personale il pulsante è uno solo e non parla di conferma", () => {
  const link = buildAccessUrl("https://xenora.it", "a@x.it", "/pulizie")!;
  const m = buildInviteEmail({ origin: "https://xenora.it", email: "a@x.it", inviter: "Andrea", accessLink: link });
  assert.match(m.html, /Scegli la password ed entra/);
  assert.ok(m.html.includes("/accesso?"));
  assert.ok(!m.html.includes("mode=signup"));
});
test("email di invito: senza link personale resta la vecchia registrazione", () => {
  const m = buildInviteEmail({ origin: "https://xenora.it", email: "a@x.it", inviter: "Andrea" });
  assert.match(m.html, /Crea il tuo accesso/);
});
test("email di nuovo link: oggetto e testo dedicati", () => {
  const m = buildInviteEmail({ origin: "https://xenora.it", email: "a@x.it", inviter: "Xenora", accessLink: "https://xenora.it/accesso?x=1", reissue: true });
  assert.equal(m.subject, "Il tuo link per entrare in Xenora");
  assert.match(m.html, /nuovo link/);
});

test("indirizzo già registrato (es. con Google): messaggio chiaro, non «operazione non riuscita»", async () => {
  const { friendlyError } = await import("../src/lib/friendly-error.ts");
  const out = friendlyError({ message: "A user with this email address has already been registered", code: "email_exists" });
  assert.match(out, /Esiste già un accesso/);
});
