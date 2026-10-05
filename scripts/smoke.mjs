// Controllo rapido del sito IN LINEA, da lanciare dopo ogni deploy:  npm run smoke   (oppure: node scripts/smoke.mjs https://altro-indirizzo)
// Verifica che le pagine si aprano, che le API riservate rifiutino chi non è loggato e che le API pubbliche non vadano in errore.
// Non scrive nulla e non invia email: usa solo richieste che il server deve rifiutare o che sono in sola lettura.
const BASE = (process.argv[2] || process.env.SMOKE_URL || "https://xenora.it").replace(/\/+$/, "");
const J = { "content-type": "application/json" };

const checks = [
  // pagine
  { name: "home", method: "GET", path: "/", ok: [200] },
  { name: "login", method: "GET", path: "/login", ok: [200] },
  { name: "privacy", method: "GET", path: "/privacy", ok: [200] },
  { name: "pagina inesistente non va in errore (200: sito pubblico a indirizzo libero, o 404)", method: "GET", path: "/questa-pagina-non-esiste-xyz", ok: [200, 404] },
  // API riservate: senza login devono rispondere 401
  { name: "email chiusa", method: "POST", path: "/api/email", body: { kind: "quote", to: "x@example.com", subject: "t", text: "t" }, ok: [401] },
  { name: "stripe/portal chiusa", method: "POST", path: "/api/stripe/portal", body: {}, ok: [401] },
  { name: "stripe/customer chiusa", method: "GET", path: "/api/stripe/customer?email=a@b.it", ok: [401] },
  { name: "stripe/invoices chiusa", method: "GET", path: "/api/stripe/invoices?email=a@b.it", ok: [401] },
  { name: "stripe/mode chiusa", method: "GET", path: "/api/stripe/mode", ok: [401] },
  { name: "stripe/connect chiusa", method: "POST", path: "/api/stripe/connect", body: {}, ok: [401] },
  { name: "stripe/checkout chiusa", method: "POST", path: "/api/stripe/checkout", body: { plan: "pro" }, ok: [401] },
  { name: "channex/ari chiusa", method: "POST", path: "/api/channex/ari", body: {}, ok: [401] },
  { name: "channex/ping chiusa", method: "GET", path: "/api/channex/ping", ok: [401] },
  { name: "ical chiusa", method: "GET", path: "/api/ical?url=http://169.254.169.254/", ok: [401] },
  { name: "email con token finto", method: "POST", path: "/api/email", headers: { authorization: "Bearer finto" }, body: { kind: "notify", to: "" }, ok: [401] },
  { name: "firma interna falsa", method: "POST", path: "/api/email", headers: { "x-xenora-internal": "00" }, body: { kind: "notify", to: "" }, ok: [401] },
  // API pubbliche: richieste incomplete devono dare 4xx pulito, mai 500
  { name: "public-booking incompleta", method: "POST", path: "/api/public-booking", body: {}, ok: [400, 404, 429] },
  { name: "public-lead incompleta", method: "POST", path: "/api/public-lead", body: {}, ok: [400, 404, 429] },
  { name: "checkin senza id", method: "GET", path: "/api/checkin", ok: [400, 404] },
  // Xenosite per assistenti AI e motori di ricerca (usa un sito pubblicato: SMOKE_SLUG, di default spigolehouse)
  { name: "robots.txt", method: "GET", path: "/robots.txt", ok: [200] },
  { name: "sitemap.xml", method: "GET", path: "/sitemap.xml", ok: [200] },
  { name: "scheda AI del sito", method: "GET", path: `/api/ai/${process.env.SMOKE_SLUG || "spigolehouse"}`, ok: [200] },
  { name: "llms.txt del sito", method: "GET", path: `/${process.env.SMOKE_SLUG || "spigolehouse"}/llms.txt`, ok: [200] },
  { name: "preventivo AI con date errate", method: "GET", path: `/api/ai/${process.env.SMOKE_SLUG || "spigolehouse"}/quote?checkin=2026-12-16&checkout=2026-12-14`, ok: [400] },
  { name: "scheda AI di un sito che non esiste", method: "GET", path: "/api/ai/non-esiste-xyz", ok: [404] },
];

let failed = 0;
for (const c of checks) {
  const t0 = Date.now();
  let status = 0, note = "";
  try {
    const r = await fetch(BASE + c.path, { method: c.method, headers: { ...(c.body ? J : {}), ...(c.headers || {}) }, body: c.body ? JSON.stringify(c.body) : undefined, redirect: "manual" });
    status = r.status;
  } catch (e) { note = " (" + (e?.message || "errore di rete") + ")"; }
  const ok = c.ok.includes(status);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${String(status).padStart(3)} ${String(Date.now() - t0).padStart(5)}ms  ${c.name}${ok ? "" : `  (atteso ${c.ok.join("/")})`}${note}`);
}
// /dashboard-2 deve rimandare alla home (il rimando è nella pagina stessa, non un codice HTTP 30x)
try {
  const r = await fetch(BASE + "/dashboard-2", { redirect: "manual" });
  const body = r.status === 200 ? await r.text() : "";
  const ok = [307, 308].includes(r.status) || body.includes("NEXT_REDIRECT") || /http-equiv="refresh"/i.test(body);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${String(r.status).padStart(3)}          /dashboard-2 rimanda alla home`);
} catch { failed++; console.log("FAIL  ---          /dashboard-2: errore di rete"); }

console.log(failed ? `\n${failed} controlli falliti su ${BASE}` : `\nTutto a posto su ${BASE} (${checks.length + 1} controlli)`);
process.exit(failed ? 1 : 0);
