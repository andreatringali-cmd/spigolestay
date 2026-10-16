import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const C = await import("../src/lib/checkin-media.ts");
const M = await import("../src/lib/media.ts");
const O = await import("../src/lib/media-orphans.ts");

const OWNER = "11111111-1111-4111-8111-111111111111"; // proprietario (stato personale)
const ORG = "22222222-2222-4222-8222-222222222222"; // organizzazione condivisa
const OTHER = "99999999-9999-4999-8999-999999999999";
const F1 = "33333333-3333-4333-8333-333333333333";
const F2 = "44444444-4444-4444-8444-444444444444";
const BID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = "segreto-di-prova";
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);
const PDF = new TextEncoder().encode("%PDF-1.7\nabc");
const GIF = new TextEncoder().encode("GIF89a....");
const dataUri = (mime: string, b: Uint8Array) => `data:${mime};base64,${Buffer.from(b).toString("base64")}`;
const privRef = (scope: "u" | "o", id: string, f = F1, ext = "jpg") => M.mediaRef(M.PRIVATE_BUCKET, M.scopedPath(scope, id, ext, f));

// ---- Scope: org condivisa vs utente -----------------------------------------------------------------------------------
test("storeMediaTarget: struttura in org condivisa -> scope o con l'id dell'org; personale -> scope u col proprietario", () => {
  assert.deepEqual(C.storeMediaTarget({ table: "org_state", keyVal: ORG }), { scope: "o", id: ORG });
  assert.deepEqual(C.storeMediaTarget({ table: "app_state", keyVal: OWNER.toUpperCase() }), { scope: "u", id: OWNER });
});

test("storeMediaTarget + percorso: i file vanno dove /api/media li fa leggere ai soci (canAccessPath)", () => {
  const t = C.storeMediaTarget({ table: "org_state", keyVal: ORG });
  const path = M.scopedPath(t.scope, t.id, "jpg", F1);
  assert.ok(M.canAccessPath(path, { tenantId: OWNER, orgIds: [ORG] })); // socio dell'org
  assert.ok(!M.canAccessPath(path, { tenantId: OWNER, orgIds: [] })); // chi non è socio
  const u = C.storeMediaTarget({ table: "app_state", keyVal: OWNER });
  const pu = M.scopedPath(u.scope, u.id, "jpg", F1);
  assert.ok(M.canAccessPath(pu, { tenantId: OWNER }));
  assert.ok(!M.canAccessPath(pu, { tenantId: OTHER, orgIds: [ORG] }));
});

test("canViewStore: chi vede le foto nel GET del check-in", () => {
  assert.equal(C.canViewStore({ table: "app_state", keyVal: OWNER }, { tenantId: OWNER, userId: OTHER }), true); // titolare
  assert.equal(C.canViewStore({ table: "app_state", keyVal: OWNER }, { tenantId: OTHER, userId: OWNER }), true);
  assert.equal(C.canViewStore({ table: "app_state", keyVal: OWNER }, { tenantId: OTHER, userId: OTHER }), false);
  assert.equal(C.canViewStore({ table: "org_state", keyVal: ORG }, { tenantId: OWNER, orgIds: [ORG] }), true); // socio
  assert.equal(C.canViewStore({ table: "org_state", keyVal: ORG }, { tenantId: OWNER, orgIds: [OTHER] }), false);
  assert.equal(C.canViewStore({ table: "org_state", keyVal: ORG }, { tenantId: ORG }), false); // l'id utente non basta per un'org
  assert.equal(C.canViewStore({ table: "app_state", keyVal: OWNER }, {}), false); // anonimo
});

// ---- Token --------------------------------------------------------------------------------------------------------------
test("token di upload: valido solo per quella prenotazione e quel riferimento, scade, non si falsifica", () => {
  const ref = privRef("u", OWNER);
  const now = 1_800_000_000_000;
  const tok = C.signUploadToken(SECRET, BID, ref, now);
  assert.ok(C.verifyUploadToken(SECRET, BID, ref, tok, now + 1000));
  assert.ok(!C.verifyUploadToken(SECRET, "altra-prenotazione", ref, tok, now + 1000));
  assert.ok(!C.verifyUploadToken(SECRET, BID, privRef("u", OWNER, F2), tok, now + 1000));
  assert.ok(!C.verifyUploadToken("altro-segreto", BID, ref, tok, now + 1000));
  assert.ok(!C.verifyUploadToken(SECRET, BID, ref, tok, now + C.UPLOAD_TOKEN_TTL_MS + 1)); // scaduto
  assert.ok(!C.verifyUploadToken(SECRET, BID, ref, tok.slice(0, -1) + (tok.endsWith("0") ? "1" : "0"), now + 1000)); // alterato
  for (const bad of [undefined, null, "", "abc", 42, "1.2", `${now + 5}.${"0".repeat(64)}`]) assert.ok(!C.verifyUploadToken(SECRET, BID, ref, bad, now + 1000), String(bad));
  assert.ok(!C.verifyUploadToken("", BID, ref, tok, now + 1000)); // senza segreto non si accetta nulla
});

// ---- Validazione file -----------------------------------------------------------------------------------------------------
test("validateCheckinFile: foto jpeg/png/webp/pdf; firma solo immagine; il tipo reale deve coincidere", () => {
  assert.deepEqual(C.validateCheckinFile("photo", "image/jpeg", JPG), { ok: true, mime: "image/jpeg" });
  assert.deepEqual(C.validateCheckinFile("photo", "image/png", PNG), { ok: true, mime: "image/png" });
  assert.deepEqual(C.validateCheckinFile("photo", "application/pdf", PDF), { ok: true, mime: "application/pdf" });
  assert.equal(C.validateCheckinFile("signature", "image/png", PNG).ok, true);
  assert.equal(C.validateCheckinFile("signature", "application/pdf", PDF).ok, false);
  assert.equal(C.validateCheckinFile("photo", "image/gif", GIF).ok, false); // GIF non ammessa per i documenti
  assert.equal(C.validateCheckinFile("photo", "image/jpeg", PNG).ok, false); // dichiara jpeg ma è png
  assert.equal(C.validateCheckinFile("photo", "image/svg+xml", new TextEncoder().encode("<svg onload=alert(1)>")).ok, false);
  assert.equal(C.validateCheckinFile("photo", "text/html", new TextEncoder().encode("<html>")).ok, false);
  assert.equal(C.validateCheckinFile("photo", "image/jpeg", new Uint8Array(0)).ok, false);
  const big = new Uint8Array(M.MEDIA_MAX_BYTES + 1); big.set(JPG);
  assert.equal(C.validateCheckinFile("photo", "image/jpeg", big).ok, false);
  const max = new Uint8Array(M.MEDIA_MAX_BYTES); max.set(JPG);
  assert.equal(C.validateCheckinFile("photo", "image/jpeg", max).ok, true);
  assert.equal(C.validateCheckinFile("photo", "image/jpeg; charset=x", JPG).ok, true); // parametri del tipo ignorati
});

// ---- Risoluzione degli allegati ---------------------------------------------------------------------------------------------
function resolverFor(table: "app_state" | "org_state", over: Partial<Parameters<typeof C.createAttachmentResolver>[0]> = {}) {
  const keyVal = table === "org_state" ? ORG : OWNER;
  const target = C.storeMediaTarget({ table, keyVal });
  const puts: { mime: string; len: number }[] = [];
  let n = 0;
  const r = C.createAttachmentResolver({
    bookingId: BID, target, allowed: new Set(), tokens: {}, secret: SECRET,
    put: async (bytes, mime) => { puts.push({ mime, len: bytes.length }); n++; return M.mediaRef(M.PRIVATE_BUCKET, M.scopedPath(target.scope, target.id, M.PRIVATE_MIME_EXT[mime], `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`)); },
    ...over,
  });
  return { r, puts, target };
}
const rejects = async (p: Promise<unknown>, code?: string) => {
  await assert.rejects(p, (e: unknown) => e instanceof C.AttachmentError && (!code || e.code === code));
};

test("resolver: vuoto -> undefined (nessun cambio)", async () => {
  const { r } = resolverFor("app_state");
  assert.equal(await r.resolve(undefined, "photo"), undefined);
  assert.equal(await r.resolve("", "photo"), undefined);
  assert.equal(await r.resolve(null, "signature"), undefined);
});

test("resolver: data URI valida -> caricata nello scope giusto (utente) e sostituita dal riferimento privato", async () => {
  const { r, puts, target } = resolverFor("app_state");
  const ref = await r.resolve(dataUri("image/jpeg", JPG), "photo");
  assert.ok(ref && M.isPrivateRef(ref));
  assert.equal(M.parseMediaRef(ref)!.parsed.scope, "u");
  assert.equal(M.parseMediaRef(ref)!.parsed.id, target.id);
  assert.deepEqual(puts, [{ mime: "image/jpeg", len: JPG.length }]);
  assert.deepEqual(r.uploadedNow, [ref]);
});

test("resolver: org condivisa -> i file finiscono sotto o/<org> (visibili ai soci)", async () => {
  const { r } = resolverFor("org_state");
  const ref = await r.resolve(dataUri("image/png", PNG), "signature");
  assert.equal(M.parseMediaRef(ref)!.parsed.scope, "o");
  assert.equal(M.parseMediaRef(ref)!.parsed.id, ORG);
});

test("resolver: stessa data URI due volte = un solo upload", async () => {
  const { r, puts } = resolverFor("app_state");
  const d = dataUri("image/jpeg", JPG);
  const a = await r.resolve(d, "photo"); const b = await r.resolve(d, "photo");
  assert.equal(a, b); assert.equal(puts.length, 1);
});

test("resolver: data URI non valide (tipo falso, svg, firma pdf, troppo grande) rifiutate e NIENTE salvato", async () => {
  const { r, puts } = resolverFor("app_state");
  await rejects(r.resolve(dataUri("image/jpeg", PNG), "photo"), "invalid_attachment");
  await rejects(r.resolve("data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64"), "photo"), "invalid_attachment");
  await rejects(r.resolve(dataUri("application/pdf", PDF), "signature"), "invalid_attachment");
  await rejects(r.resolve("data:image/jpeg;base64,@@@non-base64@@@", "photo"), "invalid_attachment");
  const huge = new Uint8Array(M.MEDIA_MAX_BYTES + 10); huge.set(JPG);
  await rejects(r.resolve(dataUri("image/jpeg", huge), "photo"), "too_large");
  assert.equal(puts.length, 0);
});

test("resolver: oltre MAX_INLINE_UPLOADS data URI -> 'use_upload_endpoint' (le pagine nuove usano l'endpoint di upload)", async () => {
  const { r } = resolverFor("app_state");
  for (let i = 0; i < C.MAX_INLINE_UPLOADS; i++) await r.resolve(dataUri("image/jpeg", Uint8Array.from([...JPG, i + 10])), "photo");
  await rejects(r.resolve(dataUri("image/jpeg", Uint8Array.from([...JPG, 99])), "photo"), "use_upload_endpoint");
});

test("resolver: riferimento con token valido accettato; senza token o col token di un altro file rifiutato", async () => {
  const ref = privRef("u", OWNER, F1);
  const tok = C.signUploadToken(SECRET, BID, ref);
  const ok = resolverFor("app_state", { tokens: { [ref]: tok } });
  assert.equal(await ok.r.resolve(ref, "photo"), ref);
  assert.equal(ok.puts.length, 0); // nessun nuovo upload
  await rejects(resolverFor("app_state").r.resolve(ref, "photo"), "foreign_attachment");
  const wrong = resolverFor("app_state", { tokens: { [ref]: C.signUploadToken(SECRET, BID, privRef("u", OWNER, F2)) } });
  await rejects(wrong.r.resolve(ref, "photo"), "foreign_attachment");
  const otherBooking = resolverFor("app_state", { tokens: { [ref]: C.signUploadToken(SECRET, "altra", ref) } });
  await rejects(otherBooking.r.resolve(ref, "photo"), "foreign_attachment");
});

test("resolver: riferimento già presente nella prenotazione/anagrafica (operatore che riapre il check-in) accettato senza token", async () => {
  const ref = privRef("o", ORG, F1);
  const { r } = resolverFor("org_state", { allowed: new Set([ref]) });
  assert.equal(await r.resolve(ref, "photo"), ref);
});

test("resolver: riferimenti di altri proprietari/organizzazioni, pubblici o strani rifiutati anche con token valido", async () => {
  const foreignUser = privRef("u", OTHER, F1);
  const foreignOrg = privRef("o", OTHER, F1);
  const wrongScope = privRef("o", OWNER, F1);
  const publicRef = M.mediaRef(M.PUBLIC_BUCKET, M.scopedPath("u", OWNER, "jpg", F1));
  const tokens: Record<string, string> = {};
  for (const x of [foreignUser, foreignOrg, wrongScope, publicRef]) tokens[x] = C.signUploadToken(SECRET, BID, x);
  const { r } = resolverFor("app_state", { tokens, allowed: new Set([foreignUser, foreignOrg, wrongScope, publicRef]) });
  await rejects(r.resolve(foreignUser, "photo"), "foreign_attachment");
  await rejects(r.resolve(foreignOrg, "photo"), "foreign_attachment");
  await rejects(r.resolve(wrongScope, "photo"), "foreign_attachment");
  await rejects(r.resolve(publicRef, "photo"), "invalid_attachment");
  await rejects(r.resolve("https://evil.example/x.jpg", "photo"), "invalid_attachment");
  await rejects(r.resolve("media:xenora-private:../../etc/passwd", "photo"), "invalid_attachment");
  await rejects(r.resolve(42, "photo"), "invalid_attachment");
  await rejects(r.resolve({ a: 1 }, "photo"), "invalid_attachment");
});

test("resolver: tetto agli allegati per richiesta", async () => {
  const ref = privRef("u", OWNER, F1);
  const { r } = resolverFor("app_state", { allowed: new Set([ref]) });
  for (let i = 0; i < C.MAX_ATTACHMENTS_PER_REQUEST; i++) await r.resolve(ref, "photo");
  await rejects(r.resolve(ref, "photo"), "too_many_attachments");
});

// ---- Orfani ---------------------------------------------------------------------------------------------------------------
test("privateRefsIn / orphanedRefs: un file ancora usato altrove non è orfano", () => {
  const a = privRef("u", OWNER, F1), b = privRef("u", OWNER, F2), pub = M.mediaRef(M.PUBLIC_BUCKET, M.scopedPath("u", OWNER, "jpg", F1));
  const booking = { docPhotoFront: a, extraGuests: [{ docPhotoBack: b }], logo: pub, note: "testo" };
  assert.deepEqual([...O.privateRefsIn(booking)].sort(), [a, b].sort()); // il pubblico non conta
  const data = { bookings: [{ id: "x", docPhotoFront: a }], guests: [] };
  assert.deepEqual(O.orphanedRefs([a, b], data), [b]); // a è ancora su un'altra prenotazione
  assert.deepEqual(O.orphanedRefs([], data), []);
});
