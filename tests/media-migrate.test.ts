import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const MG = await import("../src/lib/media-migrate.ts");
const PL = await import("../src/lib/media-migrate-plan.ts");
const M = await import("../src/lib/media.ts");

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const O1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAIN = "spigolestay:data:v1";

// ---- Byte e data URI di prova ---------------------------------------------------------------------------------------------
const jpegBytes = (n: number, seed: number): Uint8Array => { const b = new Uint8Array(n); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; for (let i = 4; i < n; i++) b[i] = (i * 31 + seed * 7) & 0xff; return b; };
const pngBytes = (n: number, seed: number): Uint8Array => { const b = jpegBytes(n, seed); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); return b; };
const uri = (mime: string, b: Uint8Array) => `data:${mime};base64,${Buffer.from(b).toString("base64")}`;
const jpg = (n: number, seed: number) => uri("image/jpeg", jpegBytes(n, seed));
const png = (n: number, seed: number) => uri("image/png", pngBytes(n, seed));

// ---- Finto client Supabase (tabelle + storage) ----------------------------------------------------------------------------
type Row = Record<string, unknown>;
interface Env {
  db: { tables: Record<string, Row[]>; log: { op: string; table: string; payload?: unknown }[]; storage: Map<string, { bytes: Uint8Array; type: string }>;
        beforeUpdate?: (table: string, db: Env["db"]) => void; failInsert?: Record<string, string>; noRevBump?: boolean; updates: number };
  client: unknown;
}
function makeEnv(tables: Record<string, Row[]>): Env {
  const db: Env["db"] = { tables: structuredClone(tables), log: [], storage: new Map(), updates: 0 };
  class Q {
    private filters: { col: string; val: unknown }[] = [];
    private mode: "select" | "insert" | "update" = "select";
    private payload: Row | undefined;
    private returning = false;
    private table: string;
    constructor(table: string) { this.table = table; }
    select(_c?: string) { if (this.mode === "update" || this.mode === "insert") this.returning = true; return this; }
    insert(p: Row) { this.mode = "insert"; this.payload = p; return this; }
    update(p: Row) { this.mode = "update"; this.payload = p; return this; }
    eq(col: string, val: unknown) { this.filters.push({ col, val }); return this; }
    async maybeSingle() { const r = this.run(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }; }
    then<T>(res: (v: { data: unknown; error: { message: string } | null }) => T, rej?: (e: unknown) => unknown) { try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
    private run(): { data: unknown; error: { message: string } | null } {
      const rows = (db.tables[this.table] ??= []);
      const hit = () => rows.filter((r) => this.filters.every((f) => r[f.col] === f.val));
      db.log.push({ op: this.mode, table: this.table, payload: this.payload });
      if (this.mode === "select") return { data: hit().map((r) => structuredClone(r)), error: null };
      if (this.mode === "insert") {
        const fail = db.failInsert?.[this.table];
        if (fail) return { data: null, error: { message: fail } };
        rows.push(structuredClone(this.payload!)); return { data: null, error: null };
      }
      db.updates++;
      db.beforeUpdate?.(this.table, db);
      const h = hit();
      for (const r of h) { Object.assign(r, structuredClone(this.payload)); if (!db.noRevBump && (this.table === "app_state" || this.table === "org_state")) r.rev = Number(r.rev ?? 0) + 1; }
      return { data: this.returning ? h.map((r) => ({ rev: r.rev })) : null, error: null };
    }
  }
  const client = {
    from: (t: string) => new Q(t),
    storage: {
      createBucket: async () => ({ data: null, error: null }),
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array, opts: { contentType: string }) => { db.storage.set(`${bucket}/${path}`, { bytes: new Uint8Array(body), type: opts.contentType }); return { data: { path }, error: null }; },
        download: async (path: string) => { const f = db.storage.get(`${bucket}/${path}`); return f ? { data: new Blob([f.bytes], { type: f.type }), error: null } : { data: null, error: { message: "not found" } }; },
      }),
    },
  };
  return { db, client };
}

const stateRow = (id: string, blob: Record<string, string>, rev = 1, col = "user_id"): Row => ({ [col]: id, data: blob, rev, updated_at: "2026-10-01T00:00:00Z" });
const main = (o: unknown) => JSON.stringify(o);
const rowOf = (env: Env, table: string, id: string, col = "user_id") => env.db.tables[table].find((r) => r[col] === id) as Row;
const dataOf = (env: Env, table: string, id: string, col = "user_id") => (rowOf(env, table, id, col).data as Record<string, string>);
const parsedMain = (env: Env, table: string, id: string, col = "user_id") => JSON.parse(dataOf(env, table, id, col)[MAIN]);
const fakeOpts = { now: () => 1_800_000_000_000 };
const run = (env: Env, o: Record<string, unknown> = {}) => MG.migrateMedia(env.client as never, { ...fakeOpts, ...o });

// Dati di prova: foto camera (pubbliche), documenti/firma (privati), logo struttura e guide (NON si toccano).
function sample() {
  const P1 = jpg(3000, 1), P2 = jpg(2500, 2), D1 = jpg(4000, 3), D2 = png(1800, 4), S1 = png(900, 5), SITE = jpg(2200, 6), LOGO = png(700, 7), GUIDE = jpg(600, 8);
  const blob = {
    [MAIN]: main({
      structures: [{ id: "s1", name: "Casa", logo: LOGO, updatedAt: 5 }],
      units: [{ id: "u1", name: "Allegra", photos: [P1, P2], updatedAt: 10 }, { id: "u2", name: "Ortigia", photos: [], updatedAt: 11 }],
      guests: [{ id: "g1", fullName: "Mario", docPhotoFront: D1, docPhotoBack: D2, updatedAt: 20 }, { id: "g2", fullName: "Anna", updatedAt: 21 }],
      bookings: [{ id: "b1", guestId: "g1", signature: S1, docPhotoFront: D1, extraGuests: [{ firstName: "A", lastName: "B", photoFront: D2 }], updatedAt: 30 }, { id: "b2", guestId: "g2", updatedAt: 31 }],
      roomTypes: [{ id: "rt1", cover: GUIDE }],
    }),
    "spigolestay:sito:s1": JSON.stringify({ hero: SITE, tagline: "Ciao" }),
    "spigolestay:guides": JSON.stringify({ s1: { sections: [{ photos: [GUIDE] }] } }),
    "spigolestay:other": "testo",
  };
  return { blob, P1, P2, D1, D2, S1, SITE, LOGO, GUIDE };
}

// ---- Classificazione ---------------------------------------------------------------------------------------------------------
test("classifyPath: foto camere/sito = pubblico; guests/bookings = privato; il resto non si migra", () => {
  assert.equal(PL.classifyPath(MAIN, ["units", 0, "photos", 2]), "public");
  assert.equal(PL.classifyPath(MAIN, ["units", 0, "logo"]), null);
  assert.equal(PL.classifyPath(MAIN, ["structures", 0, "logo"]), null);
  assert.equal(PL.classifyPath(MAIN, ["roomTypes", 0, "cover"]), null);
  assert.equal(PL.classifyPath(MAIN, ["guests", 0, "docPhotoFront"]), "private");
  assert.equal(PL.classifyPath(MAIN, ["bookings", 1, "extraGuests", 0, "photoFront"]), "private");
  assert.equal(PL.classifyPath(MAIN, ["bookings", 1, "signature"]), "private");
  assert.equal(PL.classifyPath("spigolestay:sito", ["hero"]), "public");
  assert.equal(PL.classifyPath("spigolestay:sito:abc", ["a", 0]), "public");
  assert.equal(PL.classifyPath("spigolestay:images", ["k", 0]), "public");
  assert.equal(PL.classifyPath("spigolestay:guides", ["s1"]), null);
});

// ---- dryRun -------------------------------------------------------------------------------------------------------------------
test("dryRun: nessun upload, nessuna scrittura, nessun backup; conteggi per riga e per classe", async () => {
  const { blob } = sample();
  const env = makeEnv({ app_state: [stateRow(U1, blob)], org_state: [] });
  const before = JSON.stringify(env.db.tables);
  const r = await run(env, { dryRun: true });
  assert.equal(JSON.stringify(env.db.tables), before);
  assert.equal(env.db.storage.size, 0);
  assert.ok(!env.db.log.some((l) => l.op === "insert" || l.op === "update"));
  assert.equal(r.dryRun, true);
  assert.equal(r.processed, 0);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].row, `app_state:${U1}`);
  assert.equal(r.rows[0].publicCount, 3);  // 2 foto camera + 1 foto sito
  assert.equal(r.rows[0].privateCount, 5); // D1, D2, firma, D1 (prenotazione), D2 (co-ospite)
  assert.equal(r.remainingImages, 8);
  assert.ok(r.remainingBytes > 0);
  assert.equal(r.done, false);
});

// ---- Migrazione completa ----------------------------------------------------------------------------------------------------
test("migrazione: classi pubblico/privato, scope utente, campi non migrabili invariati, updatedAt solo sulle entità toccate", async () => {
  const s = sample();
  const env = makeEnv({ app_state: [stateRow(U1, s.blob)] });
  const r = await run(env, { maxImages: 50 });
  assert.equal(r.done, true);
  assert.equal(r.ok, true);
  assert.equal(r.remainingImages, 0);
  assert.equal(r.rowsTouched, 1);
  const d = parsedMain(env, "app_state", U1);
  // pubblico
  for (const p of d.units[0].photos) { const pr = M.parseMediaRef(p); assert.ok(pr); assert.equal(pr!.bucket, M.PUBLIC_BUCKET); assert.equal(pr!.parsed.scope, "u"); assert.equal(pr!.parsed.id, U1); }
  const site = JSON.parse(dataOf(env, "app_state", U1)["spigolestay:sito:s1"]);
  assert.equal(M.parseMediaRef(site.hero)!.bucket, M.PUBLIC_BUCKET);
  assert.equal(site.tagline, "Ciao");
  // privato
  const refs = [d.guests[0].docPhotoFront, d.guests[0].docPhotoBack, d.bookings[0].signature, d.bookings[0].docPhotoFront, d.bookings[0].extraGuests[0].photoFront];
  for (const x of refs) { const pr = M.parseMediaRef(x); assert.ok(pr, String(x).slice(0, 30)); assert.equal(pr!.bucket, M.PRIVATE_BUCKET); assert.equal(pr!.parsed.id, U1); }
  // non migrabili invariati (logo struttura, roomTypes, guide, altra chiave)
  assert.equal(d.structures[0].logo, s.LOGO);
  assert.equal(d.roomTypes[0].cover, s.GUIDE);
  assert.equal(dataOf(env, "app_state", U1)["spigolestay:guides"], s.blob["spigolestay:guides"]);
  assert.equal(dataOf(env, "app_state", U1)["spigolestay:other"], "testo");
  // updatedAt: timbrato solo dove è cambiato qualcosa
  assert.equal(d.units[0].updatedAt, 1_800_000_000_000);
  assert.equal(d.units[1].updatedAt, 11);
  assert.equal(d.guests[0].updatedAt, 1_800_000_000_000);
  assert.equal(d.guests[1].updatedAt, 21);
  assert.equal(d.bookings[0].updatedAt, 1_800_000_000_000);
  assert.equal(d.bookings[1].updatedAt, 31);
  assert.equal(d.structures[0].updatedAt, 5);
  // i byte su Storage sono quelli originali
  const ref = M.parseMediaRef(d.units[0].photos[0])!;
  const stored = env.db.storage.get(`${ref.bucket}/${ref.path}`)!;
  assert.deepEqual([...stored.bytes], [...jpegBytes(3000, 1)]);
  assert.equal(stored.type, "image/jpeg");
  // il rev è salito (lucchetto + trigger)
  assert.ok((rowOf(env, "app_state", U1).rev as number) > 1);
});

test("timbro updatedAt: mai inferiore al vecchio + 1 (anche con orologio indietro)", async () => {
  const blob = { [MAIN]: main({ guests: [{ id: "g1", docPhotoFront: jpg(500, 1), updatedAt: 9_999_999_999_999 }] }) };
  const env = makeEnv({ app_state: [stateRow(U1, blob)] });
  await run(env, { now: () => 1000 });
  assert.equal(parsedMain(env, "app_state", U1).guests[0].updatedAt, 10_000_000_000_000);
});

// ---- Blocchi, idempotenza, dedup ---------------------------------------------------------------------------------------------
test("blocchi: rispetta maxImages, riprende da dove era, e alla fine è done; seconda esecuzione = nessuna modifica", async () => {
  const s = sample();
  const env = makeEnv({ app_state: [stateRow(U1, s.blob)] });
  const r1 = await run(env, { maxImages: 2 });
  assert.equal(r1.uploaded, 2);
  assert.equal(env.db.storage.size, 2);
  assert.equal(r1.done, false);
  assert.ok(r1.remainingImages > 0);
  let guard = 0, last = r1;
  while (!last.done && guard++ < 20) last = await run(env, { maxImages: 2 });
  assert.equal(last.done, true);
  assert.equal(last.remainingImages, 0);
  // D1 compare in guests e bookings, D2 in guests e co-ospite: file unici = P1,P2,SITE,D1,D2,S1 = 6
  assert.equal(env.db.storage.size, 6);
  // idempotenza: nessun update, nessun upload in più
  const updatesBefore = env.db.updates, filesBefore = env.db.storage.size;
  const again = await run(env, { maxImages: 50 });
  assert.equal(again.processed, 0);
  assert.equal(again.uploaded, 0);
  assert.equal(again.rowsTouched, 0);
  assert.equal(again.done, true);
  assert.equal(env.db.updates, updatesBefore);
  assert.equal(env.db.storage.size, filesBefore);
});

test("dedup: la stessa immagine presente più volte nella riga si carica una volta sola", async () => {
  const X = jpg(1500, 9);
  const blob = { [MAIN]: main({ guests: [{ id: "g1", docPhotoFront: X, updatedAt: 1 }], bookings: [{ id: "b1", docPhotoFront: X, signature: X, updatedAt: 1 }] }) };
  const env = makeEnv({ app_state: [stateRow(U1, blob)] });
  const r = await run(env);
  assert.equal(r.uploaded, 1);
  assert.equal(r.processed, 3);
  const d = parsedMain(env, "app_state", U1);
  assert.equal(d.guests[0].docPhotoFront, d.bookings[0].docPhotoFront);
  assert.equal(d.bookings[0].signature, d.bookings[0].docPhotoFront);
  assert.equal(env.db.storage.size, 1);
});

test("stessa immagine in classi diverse (camera e documento): due file, uno per bucket", async () => {
  const X = jpg(1500, 9);
  const blob = { [MAIN]: main({ units: [{ id: "u1", photos: [X], updatedAt: 1 }], guests: [{ id: "g1", docPhotoFront: X, updatedAt: 1 }] }) };
  const env = makeEnv({ app_state: [stateRow(U1, blob)] });
  const r = await run(env);
  assert.equal(r.uploaded, 2);
  const d = parsedMain(env, "app_state", U1);
  assert.equal(M.parseMediaRef(d.units[0].photos[0])!.bucket, M.PUBLIC_BUCKET);
  assert.equal(M.parseMediaRef(d.guests[0].docPhotoFront)!.bucket, M.PRIVATE_BUCKET);
});

// ---- Verifica -----------------------------------------------------------------------------------------------------------------
test("verifica fallita (byte diversi): nessuna sostituzione, errore segnalato, riga non scritta", async () => {
  const s = sample();
  const env = makeEnv({ app_state: [stateRow(U1, s.blob)] });
  const before = JSON.stringify(rowOf(env, "app_state", U1).data);
  const r = await run(env, {
    deps: { download: async (_a: unknown, ref: string) => { const p = M.parseMediaRef(ref)!; const f = env.db.storage.get(`${p.bucket}/${p.path}`)!; return { mime: f.type, bytes: f.bytes.slice(0, f.bytes.length - 1) }; } },
  });
  assert.equal(JSON.stringify(rowOf(env, "app_state", U1).data), before);
  assert.equal(env.db.updates, 0);
  assert.ok(r.errors.length > 0);
  assert.match(r.errors[0].message, /verifica fallita/);
  assert.equal(r.processed, 0);
  assert.equal(r.done, false);
  assert.ok(r.remainingImages > 0);
});

test("verifica fallita (contenuto diverso a parità di lunghezza): nessuna sostituzione", async () => {
  const blob = { [MAIN]: main({ guests: [{ id: "g1", docPhotoFront: jpg(800, 1), updatedAt: 1 }] }) };
  const env = makeEnv({ app_state: [stateRow(U1, blob)] });
  const r = await run(env, { deps: { download: async (_a: unknown, ref: string) => { const p = M.parseMediaRef(ref)!; const f = env.db.storage.get(`${p.bucket}/${p.path}`)!; const b = f.bytes.slice(); b[100] ^= 0xff; return { mime: f.type, bytes: b }; } } });
  assert.equal(env.db.updates, 0);
  assert.ok(r.errors.some((e: { message: string }) => /non coincide/.test(e.message)));
});

test("upload che fallisce: errore, riga intatta, le altre immagini proseguono", async () => {
  const s = sample();
  const env = makeEnv({ app_state: [stateRow(U1, s.blob)] });
  let n = 0;
  const realPut = (await import("../src/lib/media-server.ts")).putMedia;
  const r = await run(env, { maxImages: 50, deps: { put: async (a: unknown, o: unknown) => { if (n++ === 0) throw new Error("rete assente"); return realPut(a as never, o as never); } } });
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].message, "rete assente");
  assert.equal(r.done, false);
  assert.equal(r.remainingImages > 0, true);
  assert.ok(r.processed > 0);
  const r2 = await run(env, { maxImages: 50 }); // alla chiamata dopo riprova e finisce
  assert.equal(r2.done, true);
});

// ---- Backup -------------------------------------------------------------------------------------------------------------------
test("backup: una volta sola per riga, dell'ORIGINALE, con kind e key corretti; scritto prima della modifica", async () => {
  const s = sample();
  const env = makeEnv({ app_state: [stateRow(U1, s.blob)], org_state: [], _xn_backup_20261007: [] });
  const original = structuredClone(s.blob);
  await run(env, { maxImages: 1 });
  await run(env, { maxImages: 1 });
  await run(env, { maxImages: 50 });
  const bk = env.db.tables._xn_backup_20261007;
  assert.equal(bk.length, 1);
  assert.equal(bk[0].kind, "media_migrate_20261016");
  assert.equal(bk[0].key, `app_state:${U1}`);
  assert.ok(typeof bk[0].backed_up_at === "string");
  assert.deepEqual(bk[0].data, original);
  const firstInsert = env.db.log.findIndex((l) => l.op === "insert" && l.table === "_xn_backup_20261007");
  const firstUpdate = env.db.log.findIndex((l) => l.op === "update");
  assert.ok(firstInsert >= 0 && firstInsert < firstUpdate);
});

test("backup che non riesce: la riga non viene toccata", async () => {
  const s = sample();
  const env = makeEnv({ app_state: [stateRow(U1, s.blob)] });
  env.db.failInsert = { _xn_backup_20261007: "permission denied" };
  const before = JSON.stringify(env.db.tables.app_state);
  const r = await run(env);
  assert.equal(JSON.stringify(env.db.tables.app_state), before);
  assert.equal(env.db.storage.size, 0); // neppure un upload prima del backup
  assert.match(r.errors[0].message, /backup non riuscito/);
  assert.equal(r.done, false);
});

// ---- Lucchetto su rev -----------------------------------------------------------------------------------------------------------
test("conflitto di rev: rilegge e riapplica SOLO le sostituzioni il cui valore è ancora la stessa data URI", async () => {
  const A = jpg(1200, 1), B = jpg(1300, 2), C = jpg(1400, 3);
  const blob = { [MAIN]: main({ units: [{ id: "u1", photos: [A, B, C], updatedAt: 1 }], guests: [] }), "spigolestay:note": "v1" };
  const env = makeEnv({ app_state: [stateRow(U1, blob)] });
  let fired = false;
  env.db.beforeUpdate = (table, db) => {
    if (table !== "app_state" || fired) return;
    fired = true;
    // un client salva nel frattempo: cambia la foto B con un altro valore, aggiunge una chiave nuova e un'altra camera
    const row = db.tables.app_state[0];
    const data = row.data as Record<string, string>;
    const m = JSON.parse(data[MAIN]);
    m.units[0].photos[1] = "https://esempio.it/nuova.jpg";
    m.units.push({ id: "u9", name: "Nuova", photos: [], updatedAt: 99 });
    data[MAIN] = JSON.stringify(m);
    data["spigolestay:note"] = "v2";
    row.rev = (row.rev as number) + 1; // il rev cambia sotto i piedi
  };
  const r = await run(env, { maxImages: 50 });
  assert.equal(r.done, true);
  assert.equal(r.errors.length, 0);
  assert.equal(env.db.updates, 2); // primo tentativo respinto dal lucchetto, secondo riuscito
  const d = parsedMain(env, "app_state", U1);
  assert.equal(M.isMediaRef(d.units[0].photos[0]), true);
  assert.equal(d.units[0].photos[1], "https://esempio.it/nuova.jpg"); // la modifica del client NON è stata schiacciata
  assert.equal(M.isMediaRef(d.units[0].photos[2]), true);
  assert.equal(d.units[1].id, "u9");
  assert.equal(dataOf(env, "app_state", U1)["spigolestay:note"], "v2");
});

test("conflitti ripetuti: dopo 3 tentativi si ferma con errore e la riga resta quella dei client", async () => {
  const blob = { [MAIN]: main({ guests: [{ id: "g1", docPhotoFront: jpg(600, 1), updatedAt: 1 }] }) };
  const env = makeEnv({ app_state: [stateRow(U1, blob)] });
  env.db.beforeUpdate = (table, db) => { if (table === "app_state") (db.tables.app_state[0].rev as number) += 1; };
  const r = await run(env);
  assert.equal(env.db.updates, 3);
  assert.ok(r.errors.some((e: { message: string }) => /conflitto di versione/.test(e.message)));
  assert.equal(r.done, false);
  assert.equal(r.processed, 0);
  assert.ok(M.isInlineMedia(parsedMain(env, "app_state", U1).guests[0].docPhotoFront)); // niente perso
});

test("rev non incrementato dal database: avviso (warnings), nessun errore", async () => {
  const blob = { [MAIN]: main({ guests: [{ id: "g1", docPhotoFront: jpg(600, 1), updatedAt: 1 }] }) };
  const env = makeEnv({ app_state: [stateRow(U1, blob)] });
  env.db.noRevBump = true;
  const r = await run(env);
  assert.equal(r.processed, 1);
  assert.ok(r.warnings.some((w: string) => /rev non incrementato/.test(w)));
});

// ---- Scope e ordine delle righe ---------------------------------------------------------------------------------------------------
test("scope: org_state → o/<org_id>, app_state → u/<user_id>; righe vuote ignorate; le più pesanti per prime", async () => {
  const small = { [MAIN]: main({ guests: [{ id: "g1", docPhotoFront: jpg(500, 1), updatedAt: 1 }] }) };
  const big = { [MAIN]: main({ units: [{ id: "u1", photos: [jpg(9000, 2)], updatedAt: 1 }] }) };
  const empty = { [MAIN]: main({ guests: [], bookings: [] }) };
  const env = makeEnv({ app_state: [stateRow(U1, small), stateRow(U2, empty)], org_state: [stateRow(O1, big, 3, "org_id")] });
  const dry = await run(env, { dryRun: true });
  assert.deepEqual(dry.rows.map((x: { row: string }) => x.row), [`org_state:${O1}`, `app_state:${U1}`]);
  const r = await run(env, { maxImages: 1 }); // un solo file: tocca la riga più pesante (org)
  assert.equal(r.rowsTouched, 1);
  const od = parsedMain(env, "org_state", O1, "org_id");
  const pr = M.parseMediaRef(od.units[0].photos[0])!;
  assert.equal(pr.parsed.scope, "o");
  assert.equal(pr.parsed.id, O1);
  assert.ok(M.isInlineMedia(parsedMain(env, "app_state", U1).guests[0].docPhotoFront)); // la riga utente non ancora
  await run(env, { maxImages: 5 });
  const ud = parsedMain(env, "app_state", U1);
  const pu = M.parseMediaRef(ud.guests[0].docPhotoFront)!;
  assert.equal(pu.parsed.scope, "u");
  assert.equal(pu.parsed.id, U1);
  assert.equal(pu.bucket, M.PRIVATE_BUCKET);
  // il backup della riga org usa la tabella giusta nel nome
  assert.equal(JSON.stringify(rowOf(env, "app_state", U2).data), JSON.stringify(empty));
});

test("data URI non migrabili (byte non validi, foto pubblica in formato PDF): restano inline, finiscono in skipped e non bloccano done", async () => {
  const bad = "data:image/jpeg;base64,AAAAAAAAAAAA"; // non è un JPEG vero
  const pdf = uri("application/pdf", new TextEncoder().encode("%PDF-1.7\nciao"));
  const ok = jpg(700, 4);
  const blob = { [MAIN]: main({ units: [{ id: "u1", photos: [bad, pdf, ok], updatedAt: 1 }], guests: [{ id: "g1", docPhotoFront: pdf, updatedAt: 1 }] }) };
  const env = makeEnv({ app_state: [stateRow(U1, blob)] });
  const r = await run(env);
  assert.equal(r.done, true);
  assert.equal(r.skipped.length, 2); // bad e pdf pubblico (il pdf del documento ospite, privato, è ammesso e si migra)
  const d = parsedMain(env, "app_state", U1);
  assert.equal(d.units[0].photos[0], bad);
  assert.equal(d.units[0].photos[1], pdf);
  assert.ok(M.isMediaRef(d.units[0].photos[2]));
  assert.ok(M.isPrivateRef(d.guests[0].docPhotoFront));
});

test("chiave con JSON non valido o riga senza dati: ignorate senza errori", async () => {
  const env = makeEnv({ app_state: [stateRow(U1, { [MAIN]: "data:image/png;base64,AAAA{non json" }), { user_id: U2, data: null, rev: 1 }] });
  const r = await run(env);
  assert.equal(r.done, true);
  assert.equal(r.errors.length, 0);
  assert.equal(env.db.updates, 0);
});

test("maxMs esaurito: nessun nuovo upload, stato coerente", async () => {
  const s = sample();
  const env = makeEnv({ app_state: [stateRow(U1, s.blob)] });
  let t = 0;
  const r = await run(env, { now: () => (t += 5000), maxMs: 1000 });
  assert.equal(r.uploaded, 0);
  assert.equal(r.done, false);
  assert.equal(env.db.updates, 0);
});

// ---- Protezione lato client (fusione di authsync) -------------------------------------------------------------------------------
test("adoptMigratedMedia: copia vecchia identica tranne le foto → adotta il server; con altre modifiche → resta il locale", () => {
  const REF = M.mediaRef(M.PUBLIC_BUCKET, M.scopedPath("u", U1, "jpg", "33333333-3333-4333-8333-333333333333"));
  const IMG = jpg(400, 1);
  const server = JSON.stringify({ hero: REF, tagline: "Ciao", list: [REF, "x"] });
  const staleSame = JSON.stringify({ tagline: "Ciao", list: [IMG, "x"], hero: IMG }); // ordine delle chiavi diverso
  assert.equal(PL.adoptMigratedMedia(staleSame, server), server);
  const edited = JSON.stringify({ hero: IMG, tagline: "Nuovo slogan", list: [IMG, "x"] });
  assert.equal(PL.adoptMigratedMedia(edited, server), null);
  const replaced = JSON.stringify({ hero: IMG, tagline: "Ciao", list: [REF.replace("33333333", "44444444"), "x"] }); // il locale ha già un riferimento diverso
  assert.equal(PL.adoptMigratedMedia(replaced, server), null);
  const extra = JSON.stringify({ hero: IMG, tagline: "Ciao", list: [IMG, "x", IMG] });
  assert.equal(PL.adoptMigratedMedia(extra, server), null);
  assert.equal(PL.adoptMigratedMedia(server, server), null);
  assert.equal(PL.adoptMigratedMedia("{ rotto", server), null);
  assert.equal(PL.adoptMigratedMedia(JSON.stringify({ a: 1 }), server), null); // il locale non ha foto vecchie: niente da fare
  assert.equal(PL.adoptMigratedMedia(staleSame, undefined), null);
});

test("isMediaFlatKey: solo sito e immagini", () => {
  assert.ok(PL.isMediaFlatKey("spigolestay:sito"));
  assert.ok(PL.isMediaFlatKey("spigolestay:sito:abc"));
  assert.ok(PL.isMediaFlatKey("spigolestay:images"));
  assert.ok(!PL.isMediaFlatKey("spigolestay:guides"));
  assert.ok(!PL.isMediaFlatKey(MAIN));
});
