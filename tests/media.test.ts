import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const M = await import("../src/lib/media.ts");

const T = "11111111-1111-4111-8111-111111111111"; // tenant
const O = "22222222-2222-4222-8222-222222222222"; // organizzazione
const F = "33333333-3333-4333-8333-333333333333"; // file
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const GIF = new TextEncoder().encode("GIF89a....");
const PDF = new TextEncoder().encode("%PDF-1.7\n....");

test("scopedPath: <scope>/<id>/<uuid>.<ext>, valida gli ingressi", () => {
  assert.equal(M.scopedPath("u", T, "jpg", F), `u/${T}/${F}.jpg`);
  assert.equal(M.scopedPath("o", O, ".PNG", F), `o/${O}/${F}.png`);
  assert.match(M.scopedPath("u", T, "webp"), new RegExp(`^u/${T}/[0-9a-f-]{36}[.]webp$`));
  assert.throws(() => M.scopedPath("x" as never, T, "jpg"));
  assert.throws(() => M.scopedPath("u", "non-un-uuid", "jpg"));
  assert.throws(() => M.scopedPath("u", T, "exe"));
  assert.throws(() => M.scopedPath("u", T, "jpg", "../etc"));
});

test("mediaRef / parseMediaRef: round trip e rifiuto di valori sbagliati", () => {
  const path = M.scopedPath("u", T, "jpg", F);
  const ref = M.mediaRef(M.PUBLIC_BUCKET, path);
  assert.equal(ref, `media:xenora-public:u/${T}/${F}.jpg`);
  const p = M.parseMediaRef(ref);
  assert.equal(p?.bucket, "xenora-public");
  assert.equal(p?.visibility, "public");
  assert.equal(p?.path, path);
  assert.equal(M.parseMediaRef(M.mediaRef(M.PRIVATE_BUCKET, path))?.visibility, "private");
  assert.ok(M.isMediaRef(ref) && M.isPublicRef(ref) && !M.isPrivateRef(ref));
  const bads = ["", "data:image/png;base64,AAAA", "https://x.y/z.jpg", "media:altro:" + path, "media:xenora-public:../../x.jpg", `media:xenora-public:u/${T}/../${F}.jpg`, `media:xenora-public:u/${T}/${F}.exe`, `media:xenora-public:x/${T}/${F}.jpg`, null, undefined, 42];
  for (const bad of bads) {
    assert.equal(M.parseMediaRef(bad as never), null, String(bad));
    assert.equal(M.isMediaRef(bad), false);
  }
  assert.throws(() => M.mediaRef("altro" as never, path));
  assert.throws(() => M.mediaRef(M.PUBLIC_BUCKET, "../x.jpg"));
});

test("isDataUri / isInlineMedia", () => {
  assert.ok(M.isDataUri("data:image/png;base64,AAA"));
  assert.ok(!M.isDataUri("https://x"));
  assert.ok(M.isInlineMedia("data:image/jpeg;base64,AAA"));
  assert.ok(M.isInlineMedia("data:application/pdf;base64,AAA"));
  assert.ok(!M.isInlineMedia("data:text/html;base64,AAA"));
  assert.ok(!M.isInlineMedia(undefined));
});

test("parseDataUri: base64 valida → mime + byte; altro → null", () => {
  const b64 = Buffer.from(JPG).toString("base64");
  const d = M.parseDataUri(`data:image/jpeg;base64,${b64}`);
  assert.equal(d?.mime, "image/jpeg");
  assert.deepEqual(Array.from(d!.bytes), Array.from(JPG));
  assert.equal(M.parseDataUri(`data:image/png;charset=utf-8;base64,${Buffer.from(PNG).toString("base64")}`)?.mime, "image/png");
  assert.equal(M.parseDataUri("data:image/svg+xml,<svg/>"), null); // non base64
  assert.equal(M.parseDataUri("data:;base64,AAAA"), null);
  assert.equal(M.parseDataUri("https://x/y.png"), null);
  assert.equal(M.parseDataUri(12), null);
});

test("publicUrlOf: URL pubblico assoluto, null per privati/invalidi/senza base", () => {
  const pub = M.mediaRef(M.PUBLIC_BUCKET, M.scopedPath("u", T, "jpg", F));
  const priv = M.mediaRef(M.PRIVATE_BUCKET, M.scopedPath("u", T, "jpg", F));
  assert.equal(M.publicUrlOf(pub, "https://abc.supabase.co"), `https://abc.supabase.co/storage/v1/object/public/xenora-public/u/${T}/${F}.jpg`);
  assert.equal(M.publicUrlOf(pub, "https://abc.supabase.co//"), `https://abc.supabase.co/storage/v1/object/public/xenora-public/u/${T}/${F}.jpg`);
  assert.equal(M.publicUrlOf(priv, "https://abc.supabase.co"), null);
  assert.equal(M.publicUrlOf("data:image/png;base64,AA", "https://abc.supabase.co"), null);
  assert.equal(M.publicUrlOf(pub, ""), null);
  // toExternalUrl: http invariato, riferimento pubblico → URL, data URI → null
  assert.equal(M.toExternalUrl("https://x.y/a.jpg", "https://abc.supabase.co"), "https://x.y/a.jpg");
  assert.equal(M.toExternalUrl(pub, "https://abc.supabase.co"), M.publicUrlOf(pub, "https://abc.supabase.co"));
  assert.equal(M.toExternalUrl("data:image/png;base64,AA", "https://abc.supabase.co"), null);
  assert.equal(M.toExternalUrl(priv, "https://abc.supabase.co"), null);
  assert.equal(M.toExternalUrl("", "https://abc.supabase.co"), null);
});

test("canAccessPath: scope u = proprio tenant, scope o = organizzazioni di cui si è membri", () => {
  const mine = `u/${T}/${F}.jpg`;
  const org = `o/${O}/${F}.pdf`;
  assert.equal(M.canAccessPath(mine, { tenantId: T, orgIds: [] }), true);
  assert.equal(M.canAccessPath(mine, { tenantId: T.toUpperCase(), orgIds: [] }), true);
  assert.equal(M.canAccessPath(mine, { tenantId: O, orgIds: [T] }), false); // un id di org non vale come tenant
  assert.equal(M.canAccessPath(mine, { tenantId: null, orgIds: [T] }), false);
  assert.equal(M.canAccessPath(org, { tenantId: T, orgIds: [O] }), true);
  assert.equal(M.canAccessPath(org, { tenantId: O, orgIds: [] }), false); // il tenant con lo stesso id non basta per lo scope o
  assert.equal(M.canAccessPath(org, { tenantId: T, orgIds: [T] }), false);
  assert.equal(M.canAccessPath(org, { tenantId: T }), false);
  const bads = [`u/${T}/../${F}.jpg`, `u/${T}/${F}.exe`, `${T}/${F}.jpg`, "", undefined, `u/${T}/${F}.jpg/extra`];
  for (const bad of bads) assert.equal(M.canAccessPath(bad, { tenantId: T, orgIds: [O] }), false, String(bad));
});

test("sniffMediaType / checkUpload: tipo reale, ammessi per visibilità, dimensione", () => {
  assert.equal(M.sniffMediaType(JPG), "image/jpeg");
  assert.equal(M.sniffMediaType(PNG), "image/png");
  assert.equal(M.sniffMediaType(GIF), "image/gif");
  assert.equal(M.sniffMediaType(PDF), "application/pdf");
  assert.equal(M.sniffMediaType(new TextEncoder().encode("<html>")), null);
  assert.deepEqual(M.checkUpload({ visibility: "public", declaredType: "image/jpeg", bytes: JPG }), { ok: true, mime: "image/jpeg", ext: "jpg" });
  assert.deepEqual(M.checkUpload({ visibility: "public", declaredType: "image/png; charset=x", bytes: PNG }), { ok: true, mime: "image/png", ext: "png" });
  assert.equal(M.checkUpload({ visibility: "public", declaredType: "application/pdf", bytes: PDF }).ok, false); // PDF solo privato
  assert.deepEqual(M.checkUpload({ visibility: "private", declaredType: "application/pdf", bytes: PDF }), { ok: true, mime: "application/pdf", ext: "pdf" });
  assert.equal(M.checkUpload({ visibility: "private", declaredType: "image/gif", bytes: GIF }).ok, true);
  assert.equal(M.checkUpload({ visibility: "public", declaredType: "image/jpeg", bytes: PNG }).ok, false); // dichiara jpeg ma sono byte png
  assert.equal(M.checkUpload({ visibility: "public", declaredType: "text/html", bytes: new TextEncoder().encode("<script>") }).ok, false);
  assert.equal(M.checkUpload({ visibility: "public", declaredType: "image/jpeg", bytes: new Uint8Array(0) }).ok, false);
  assert.equal(M.checkUpload({ visibility: "public", declaredType: undefined, bytes: JPG }).ok, false);
  const big = new Uint8Array(M.MEDIA_MAX_BYTES + 1); big.set(JPG);
  assert.equal(M.checkUpload({ visibility: "public", declaredType: "image/jpeg", bytes: big }).ok, false);
  const maxOk = new Uint8Array(M.MEDIA_MAX_BYTES); maxOk.set(JPG);
  assert.equal(M.checkUpload({ visibility: "public", declaredType: "image/jpeg", bytes: maxOk }).ok, true);
});

test("uploadTarget: scope u di default, scope o solo se membro", () => {
  assert.deepEqual(M.uploadTarget({ tenantId: T, orgIds: [O] }), { ok: true, scope: "u", id: T });
  assert.deepEqual(M.uploadTarget({ tenantId: T, orgIds: [O] }, O), { ok: true, scope: "o", id: O });
  assert.deepEqual(M.uploadTarget({ tenantId: T, orgIds: [O] }, ` ${O.toUpperCase()} `), { ok: true, scope: "o", id: O });
  assert.equal(M.uploadTarget({ tenantId: T, orgIds: [] }, O).ok, false); // non membro
  assert.equal(M.uploadTarget({ tenantId: T, orgIds: [O] }, "x").ok, false);
  assert.equal(M.uploadTarget({ tenantId: null, orgIds: [] }).ok, false);
  assert.equal(M.uploadTarget({ tenantId: "abc", orgIds: [] }).ok, false);
});

test("authorizeRef: pubblici leggibili da tutti, privati e cancellazioni solo se autorizzati", () => {
  const pubOther = M.mediaRef(M.PUBLIC_BUCKET, `u/${O}/${F}.jpg`);
  const privMine = M.mediaRef(M.PRIVATE_BUCKET, `u/${T}/${F}.jpg`);
  const privOrg = M.mediaRef(M.PRIVATE_BUCKET, `o/${O}/${F}.pdf`);
  const privOther = M.mediaRef(M.PRIVATE_BUCKET, `u/${O}/${F}.jpg`);
  const who = { tenantId: T, orgIds: [O] };
  assert.equal(M.authorizeRef(pubOther, who, "read").ok, true);
  assert.equal(M.authorizeRef(pubOther, who, "delete").ok, false); // un pubblico altrui non si cancella
  assert.equal(M.authorizeRef(privMine, who, "read").ok, true);
  assert.equal(M.authorizeRef(privMine, who, "delete").ok, true);
  assert.equal(M.authorizeRef(privOrg, who, "read").ok, true);
  assert.equal(M.authorizeRef(privOrg, { tenantId: T, orgIds: [] }, "read").ok, false); // ha lasciato l'org
  const denied = M.authorizeRef(privOther, who, "read");
  assert.equal(denied.ok, false);
  assert.equal(!denied.ok && denied.status, 403);
  const bad = M.authorizeRef("https://x/y.jpg", who, "read");
  assert.equal(!bad.ok && bad.status, 400);
});

test("fitWithin: riduce il lato lungo, non ingrandisce", () => {
  assert.deepEqual(M.fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(M.fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(M.fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(M.fitWithin(10000, 1, 1600), { width: 1600, height: 1 });
});

test("newUuid / isUuid", () => {
  const u = M.newUuid();
  assert.ok(M.isUuid(u));
  assert.notEqual(u, M.newUuid());
  assert.ok(!M.isUuid("123"));
});
