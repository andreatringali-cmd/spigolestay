import test from "node:test";
import assert from "node:assert/strict";

const cfg = (await import("../next.config.ts")).default as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
const rules = await cfg.headers();
const find = (re: RegExp) => rules.filter((r) => re.test(r.source));
const val = (r: { headers: { key: string; value: string }[] }, k: string) => r.headers.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value;

// Riproduce la corrispondenza di Next sul percorso: "/:path*" vale per tutto; "/((?!embed/).*)" per tutto tranne /embed/…
const applies = (source: string, path: string) => source === "/:path*" ? true : source === "/((?!embed/).*)" ? new RegExp("^/((?!embed/).*)$").test(path) : source === "/embed/:path*" ? path.startsWith("/embed/") : false;
const effective = (path: string) => {
  const out: Record<string, string[]> = {};
  for (const r of rules) if (applies(r.source, path)) for (const h of r.headers) (out[h.key.toLowerCase()] ||= []).push(h.value);
  return out;
};

test("tutte le pagine: HSTS, nosniff, referrer, permissions", () => {
  for (const p of ["/", "/login", "/prenota", "/api/health", "/embed/abc"]) {
    const h = effective(p);
    assert.match(h["strict-transport-security"][0], /max-age=\d{7,}/);
    assert.equal(h["x-content-type-options"][0], "nosniff");
    assert.ok(h["referrer-policy"]);
    assert.match(h["permissions-policy"][0], /microphone=\(\)/);
  }
});
test("pagine normali: niente incorporamento in siti terzi (X-Frame-Options + frame-ancestors)", () => {
  for (const p of ["/", "/login", "/prenota", "/g/abc123"]) {
    const h = effective(p);
    assert.deepEqual(h["x-frame-options"], ["SAMEORIGIN"]);
    assert.equal(h["content-security-policy"].length, 1);
    assert.match(h["content-security-policy"][0], /frame-ancestors 'self'/);
    assert.match(h["content-security-policy"][0], /object-src 'none'/);
    assert.match(h["content-security-policy"][0], /base-uri 'self'/);
  }
});
test("/embed: resta incorporabile (un solo CSP con frame-ancestors *, nessun X-Frame-Options)", () => {
  const h = effective("/embed/casa-mia");
  assert.equal(h["x-frame-options"], undefined);
  assert.deepEqual(h["content-security-policy"], ["frame-ancestors *"]);
});
test("esiste la regola /embed", () => {
  assert.equal(find(/embed\/:path/).length, 1);
});
