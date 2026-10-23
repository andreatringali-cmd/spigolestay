import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeEntitiesDb, entityRowsFromBlock, type FakeEntitiesDb } from "./helpers/fake-entities-db.ts";

// Fase 3, passo 3b: /api/checkin e purge delle foto documento compatibili con l'autorita' 'table' (src/lib/server-entities-write.ts, docs/FASE3-PASSO3B.md).
// Client Supabase finto in memoria (nessuna rete, nessun file vero sullo Storage). Si prova che:
//  (a) interruttore spento, o autorita' 'blob' (anche una sola delle due): il comportamento e' IDENTICO a oggi (si scrive il blocco, public.entities non si tocca);
//  (b) autorita' 'table' su prenotazioni E ospiti: il check-in scrive solo le righe cambiate (prenotazione + anagrafica), il blocco resta com'e';
//  (c) conflitto: errore chiaro (409 write_conflict + motivo) e la prima riga gia' scritta viene rimessa com'era;
//  (d) autorita' mista: si rifiuta senza scrivere da nessuna parte;
//  (e) purge: sulle righe, e un file ancora citato da un'altra prenotazione/ospite NON viene cancellato dallo Storage.
register("./helpers/checkin-route-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://progetto-finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
(globalThis as unknown as { window: unknown }).window = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as Storage;
/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as unknown as { __stubs: { calls: Record<string, any[]>; admin?: unknown; internal?: boolean; rateLimited?: boolean; operator?: boolean; operatorId?: string } };
G.__stubs = { calls: {} };
const route = await import("../src/app/api/checkin/route.ts");
const W = await import("../src/lib/server-entities-write.ts");
const P = await import("../src/lib/alloggiati/purge.ts");
const M = await import("../src/lib/media.ts");
const CM = await import("../src/lib/checkin-media.ts");
const { todayRome, addDaysYmd } = await import("../src/lib/dates-rome.ts");

type J = Record<string, any>;
const OWN = "11111111-1111-4111-8111-111111111111";
const DATA_KEY = "spigolestay:data:v1";
const ref = (n: number) => M.mediaRef(M.PRIVATE_BUCKET, M.scopedPath("u", OWN, "png", `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`));
const pathOf = (r: string) => M.parseMediaRef(r)!.path;
const SIGN = ref(1), OLDF = ref(2), OLDB = ref(3), NEWF = ref(4), NEWB = ref(5);
const ci = addDaysYmd(todayRome(), 1), co = addDaysYmd(todayRome(), 4);
const person = (o: J = {}): J => ({ firstName: "Mario", lastName: "Verdi", sex: "M", birthDate: "1980-01-01", birthPlace: "Roma", citizenship: "Italia", docType: "Passaporto", docNumber: "YA123", docPlace: "Roma", ...o });

// b-1 e b-2: due soggiorni dello stesso ospite g1; la foto OLDF e' su entrambe le prenotazioni e sull'anagrafica, OLDB solo su b-1 e sull'anagrafica.
// b-3: prenotazione di g2 la cui anagrafica coincide gia' con i dati che il check-in scrivera' (cosi' l'anagrafica NON va riscritta).
function dataset(): J {
  const bk = (id: string, guestId: string, extra: J = {}): J => ({ id, structureId: "st-1", roomTypeId: "rt-dbl", unitId: "u1", guestId, status: "confirmed", channel: "direct", checkIn: ci, checkOut: co, adults: 2, children: 0, total: 300, signature: SIGN, ...extra });
  const g2: J = { id: "g2", ...person(), fullName: "Mario Verdi", updatedAt: 800 };
  return {
    structures: [{ id: "st-1", name: "Casa Ortigia", email: "info@casa.example", currency: "€" }],
    roomTypes: [{ id: "rt-dbl", structureId: "st-1", name: "Doppia" }],
    units: [{ id: "u1", roomTypeId: "rt-dbl", structureId: "st-1", name: "Allegra" }],
    bookings: [
      bk("b-1", "g1", { docPhotoFront: OLDF, docPhotoBack: OLDB, updatedAt: 1000 }),
      bk("b-2", "g1", { docPhotoFront: OLDF, updatedAt: 2000 }),
      bk("b-3", "g2", { updatedAt: 3000 }),
    ],
    guests: [{ id: "g1", firstName: "Giulia", lastName: "Rossi", fullName: "Giulia Rossi", docPhotoFront: OLDF, docPhotoBack: OLDB, updatedAt: 500 }, g2],
  };
}

interface WorldOpts {
  auth?: { kind: string; authority: string }[];
  /** Eseguito prima di ogni UPDATE su public.entities (n = progressivo da 1): per simulare una scrittura concorrente. */
  beforeUpdate?: (db: FakeEntitiesDb, n: number) => void;
  edit?: (ds: J) => void;
  /** La lettura di entity_authority risponde con un errore (database che non risponde). */
  authError?: boolean;
  /** Le letture a pagine (range) di public.entities falliscono: serve per la ricerca dei riferimenti ai file. */
  failRange?: boolean;
}
function world(o: WorldOpts = {}) {
  W._resetWriteState();
  const ds = dataset(); o.edit?.(ds);
  const { db, client } = makeFakeEntitiesDb({
    public_sites: [{ slug: "casa-ortigia", user_id: OWN, structure_id: "st-1" }],
    app_state: [{ user_id: OWN, rev: 1, data: { [DATA_KEY]: JSON.stringify(ds) } }],
    org_state: [], memberships: [],
    entities: entityRowsFromBlock({ type: "u", id: OWN }, ds),
    entity_authority: (o.auth ?? []).map((a) => ({ owner_type: "u", owner_id: OWN, kind: a.kind, authority: a.authority })),
  });
  const base = client as { from: (t: string) => any };
  const removed: string[] = [];
  const log: string[] = [];
  let n = 0;
  const admin = {
    from(table: string) {
      log.push(table);
      if (table === "entity_authority" && o.authError) {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: { code: "XX000", message: "database non risponde" } }) };
        return chain;
      }
      const q = base.from(table);
      if (table === "entities" && o.failRange) q.range = () => ({ then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "lettura fallita" } }).then(res) });
      if (table === "entities" && o.beforeUpdate) { const orig = q.update.bind(q); q.update = (p: J) => { o.beforeUpdate!(db, ++n); return orig(p); }; }
      return q;
    },
    storage: { from: () => ({ remove: async (paths: string[]) => { removed.push(...paths); return { error: null }; } }) },
  };
  Object.assign(G.__stubs, { calls: {}, admin, internal: false, rateLimited: false, operator: false, operatorId: OWN });
  return { db, admin: admin as never, removed, log };
}
const BOTH_TABLE = [{ kind: "bookings", authority: "table" }, { kind: "guests", authority: "table" }];
const row = (db: FakeEntitiesDb, id: string, kind: string): J => db.tables.entities.find((r) => r.id === id && r.kind === kind) as J;
const entUpdates = (db: FakeEntitiesDb) => db.log.filter((l) => l.op === "update" && l.table === "entities").length;
const blobUpdates = (db: FakeEntitiesDb) => db.log.filter((l) => l.op === "update" && l.table === "app_state").length;
const blob = (db: FakeEntitiesDb): J => JSON.parse((db.tables.app_state[0].data as J)[DATA_KEY]);
async function withWrite<T>(v: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SERVER_WRITE_ENTITIES;
  if (v === undefined) delete process.env.SERVER_WRITE_ENTITIES; else process.env.SERVER_WRITE_ENTITIES = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.SERVER_WRITE_ENTITIES; else process.env.SERVER_WRITE_ENTITIES = prev; }
}
const on = <T,>(fn: () => Promise<T>) => withWrite("on", fn);

async function post(bid: string, body: J = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" };
  const req = new Request("https://xenora.test/api/checkin", { method: "POST", headers, body: JSON.stringify({ slug: "casa-ortigia", b: bid, consent: true, doc: person(), signature: SIGN, ...body }) });
  const res = (await route.POST(req)) as unknown as { status: number; json(): Promise<any> };
  return { status: res.status, json: await res.json() };
}
/** Check-in che sostituisce le due foto del documento con due file nuovi (con i token di caricamento validi). */
const replacePhotos = (bid = "b-1") => post(bid, {
  docPhotoFront: NEWF, docPhotoBack: NEWB,
  uploads: { [NEWF]: CM.signUploadToken(CM.uploadSecret(), bid, NEWF), [NEWB]: CM.signUploadToken(CM.uploadSecret(), bid, NEWB) },
});

// ───────────────────────── /api/checkin: percorso del blocco invariato ─────────────────────────
test("check-in, interruttore spento (anche con autorita' 'table' in tabella): scrive il blocco come sempre, public.entities intatta, nessuna richiesta sull'autorita'", async () => {
  const w = world({ auth: BOTH_TABLE });
  const r = await withWrite(undefined, () => replacePhotos());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const b = blob(w.db);
  assert.equal(b.bookings[0].docPhotoFront, NEWF);
  assert.equal(b.guests[0].docPhotoFront, NEWF);
  assert.equal(b.bookings[0].webCheckin, true);
  assert.equal(entUpdates(w.db), 0);
  assert.equal(row(w.db, "b-1", "bookings").data.docPhotoFront, OLDF);
  assert.ok(!w.log.includes("entity_authority"), "interruttore spento: l'autorita' non si legge nemmeno");
  // foto sostituite: OLDB non e' piu' di nessuno e va via dallo Storage; OLDF e' ancora su b-2 e resta
  assert.deepEqual(w.removed, [pathOf(OLDB)]);
});

test("check-in con autorita' 'blob' (o solo una delle due 'table' non basta per le tabelle): blocco scritto come sempre", async () => {
  for (const auth of [[], [{ kind: "bookings", authority: "blob" }, { kind: "guests", authority: "blob" }]]) {
    const w = world({ auth });
    const r = await on(() => replacePhotos());
    assert.equal(r.status, 200, JSON.stringify(auth));
    assert.equal(blob(w.db).bookings[0].docPhotoFront, NEWF);
    assert.equal(entUpdates(w.db), 0);
    assert.deepEqual(w.removed, [pathOf(OLDB)]);
  }
});

// ───────────────────────── /api/checkin: autorita' 'table' ─────────────────────────
test("check-in con autorita' 'table': scrive prenotazione e anagrafica (solo quelle), non tocca il blocco ne' le altre righe; cancella solo le foto che nessuno cita piu'", async () => {
  const w = world({ auth: BOTH_TABLE });
  const before = JSON.parse(JSON.stringify(w.db.tables.entities));
  const blobBefore = JSON.stringify(w.db.tables.app_state);
  const r = await on(() => replacePhotos());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const b1 = row(w.db, "b-1", "bookings"), g1 = row(w.db, "g1", "guests");
  assert.equal(b1.data.docPhotoFront, NEWF); assert.equal(b1.data.docPhotoBack, NEWB);
  assert.equal(b1.data.webCheckin, true);
  assert.equal(b1.data.primaryGuest.docNumber, "YA123");
  assert.ok(b1.updated_ms > 1000 && b1.updated_ms === b1.data.updatedAt, "timbro cresciuto, colonna e dato coincidono");
  assert.equal(b1.status, "confirmed"); assert.equal(b1.check_in, ci); assert.equal(b1.structure_id, "st-1");
  assert.equal(g1.data.docPhotoFront, NEWF); assert.equal(g1.data.lastName, "Verdi");
  assert.ok(g1.updated_ms > 500);
  // tutto il resto e' identico, il blocco non e' stato toccato
  for (const [i, x] of before.entries()) if (!(x.kind === "bookings" && x.id === "b-1") && !(x.kind === "guests" && x.id === "g1")) assert.deepEqual(w.db.tables.entities[i], x, x.kind + ":" + x.id);
  assert.equal(JSON.stringify(w.db.tables.app_state), blobBefore);
  assert.equal(blobUpdates(w.db), 0);
  assert.equal(entUpdates(w.db), 2);
  // OLDF e' ancora su b-2: non si cancella. OLDB non e' piu' citata da nessuna riga: si cancella.
  assert.deepEqual(w.removed, [pathOf(OLDB)]);
});

test("check-in con autorita' 'table': se l'anagrafica non cambia, si riscrive SOLO la prenotazione", async () => {
  const w = world({ auth: BOTH_TABLE });
  const g2Before = JSON.stringify(row(w.db, "g2", "guests"));
  const r = await on(() => post("b-3"));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(entUpdates(w.db), 1);
  assert.equal(row(w.db, "b-3", "bookings").data.webCheckin, true);
  assert.equal(JSON.stringify(row(w.db, "g2", "guests")), g2Before);
  assert.deepEqual(w.removed, []);
});

test("check-in 'table': conflitto sull'anagrafica => 409 write_conflict con motivo, la prenotazione gia' scritta torna com'era, nessun file cancellato", async () => {
  // update 1 = prenotazione (ok); update 2 = anagrafica (la riga e' stata toccata da un altro: conflitto) ; 3 = ripristino; poi il secondo tentativo va in conflitto di nuovo.
  const w = world({ auth: BOTH_TABLE, beforeUpdate: (db, n) => { if (n === 2 || n === 5) { const g = db.tables.entities.find((x) => x.kind === "guests" && x.id === "g1") as J; g.updated_ms = Number(g.updated_ms) + 1; } } });
  const r = await on(() => replacePhotos());
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "write_conflict");
  assert.equal(r.json.reason, "conflict");
  const b1 = row(w.db, "b-1", "bookings");
  assert.equal(b1.data.docPhotoFront, OLDF, "la prenotazione e' stata ripristinata");
  assert.equal(b1.data.webCheckin, undefined);
  assert.equal(blobUpdates(w.db), 0);
  assert.deepEqual(w.removed, [], "i file nuovi non erano ancora stati caricati (solo riferimenti con token) e i vecchi restano");
});

test("check-in 'table': un conflitto passeggero si risolve al secondo tentativo (dati riletti, scrittura dell'altro non persa)", async () => {
  const w = world({ auth: BOTH_TABLE, beforeUpdate: (db, n) => { if (n === 2) { const g = db.tables.entities.find((x) => x.kind === "guests" && x.id === "g1") as J; g.data = { ...g.data, email: "nuova@example.com", updatedAt: 900 }; g.updated_ms = 900; } } });
  const r = await on(() => replacePhotos());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(row(w.db, "g1", "guests").data.email, "nuova@example.com", "la modifica concorrente dell'anagrafica non e' persa");
  assert.equal(row(w.db, "g1", "guests").data.docPhotoFront, NEWF);
  assert.equal(row(w.db, "b-1", "bookings").data.docPhotoFront, NEWF);
});

test("check-in con autorita' mista (prenotazioni 'table', ospiti 'blob' e viceversa): 409 authority_mixed, non si scrive da nessuna parte", async () => {
  for (const auth of [[{ kind: "bookings", authority: "table" }], [{ kind: "guests", authority: "table" }]]) {
    const w = world({ auth });
    const r = await on(() => replacePhotos());
    assert.equal(r.status, 409, JSON.stringify(auth));
    assert.equal(r.json.reason, "authority_mixed");
    assert.equal(entUpdates(w.db), 0);
    assert.equal(blobUpdates(w.db), 0);
    assert.deepEqual(w.removed, []);
  }
});

test("check-in 'table': riga di prenotazione mancante in tabella => 409 con motivo not_found, blocco intatto", async () => {
  const w = world({ auth: BOTH_TABLE });
  w.db.tables.entities = w.db.tables.entities.filter((x) => !(x.kind === "bookings" && x.id === "b-1"));
  const r = await on(() => replacePhotos());
  assert.equal(r.status, 409);
  assert.equal(r.json.reason, "not_found");
  assert.equal(blobUpdates(w.db), 0);
});

// ───────────────────────── mutateBookingScope con anagrafica ospite ─────────────────────────
const scopeArgs = (mutate: (d: J) => boolean, extra: J = {}) => ({ ownerType: "u" as const, ownerId: OWN, bookingId: "b-1", supported: true, group: false, structure: false, guest: true, mutate, ...extra });

test("scope con ospite: interruttore spento = handled:false e nessuna chiamata al database; 'blob'/'blob' = handled:false", async () => {
  const w = world({ auth: BOTH_TABLE });
  assert.deepEqual(await withWrite(undefined, () => W.mutateBookingScope(w.admin, scopeArgs(() => true))), { handled: false, reason: "disabled" });
  assert.equal(w.log.length, 0);
  const w2 = world({ auth: [{ kind: "bookings", authority: "blob" }, { kind: "guests", authority: "blob" }] });
  assert.deepEqual(await on(() => W.mutateBookingScope(w2.admin, scopeArgs(() => true))), { handled: false, reason: "authority_blob" });
  assert.equal(entUpdates(w2.db), 0);
});

test("scope con ospite: data contiene solo prenotazione e anagrafica; il gruppo e la struttura non si leggono; forma diversa => unsupported_shape senza scrivere", async () => {
  const w = world({ auth: BOTH_TABLE });
  let seen: string[] = [];
  const r = await on(() => W.mutateBookingScope(w.admin, scopeArgs((d) => { seen = Object.keys(d).sort(); assert.equal(d.bookings.length, 1); assert.equal(d.guests[0].id, "g1"); d.guests[0].note = "x"; return true; })));
  assert.deepEqual(r, { handled: true, ok: true, wrote: true });
  assert.deepEqual(seen, ["bookings", "guests"]);
  assert.equal(row(w.db, "g1", "guests").data.note, "x");
  assert.equal(entUpdates(w.db), 1, "la prenotazione non e' cambiata: non si riscrive");
  for (const bad of [(d: J) => { d.guests.push({ id: "nuovo" }); return true; }, (d: J) => { d.guests[0].id = "altro"; return true; }, (d: J) => { d.units = []; return true; }]) {
    const w2 = world({ auth: BOTH_TABLE });
    const r2 = await on(() => W.mutateBookingScope(w2.admin, scopeArgs(bad)));
    assert.deepEqual(r2, { handled: true, ok: false, error: "unsupported_shape" });
    assert.equal(entUpdates(w2.db), 0);
  }
});

test("scope con ospite: autorita' mista => authority_mixed senza leggere ne' scrivere righe", async () => {
  for (const auth of [[{ kind: "bookings", authority: "table" }], [{ kind: "guests", authority: "table" }]]) {
    const w = world({ auth });
    const r = await on(() => W.mutateBookingScope(w.admin, scopeArgs(() => true)));
    assert.deepEqual(r, { handled: true, ok: false, error: "authority_mixed" });
    assert.ok(!w.log.includes("entities"));
  }
});

test("scope senza guest (passo 3a): comportamento invariato anche con ospiti 'blob' e prenotazioni 'table'", async () => {
  const w = world({ auth: [{ kind: "bookings", authority: "table" }] });
  const r = await on(() => W.mutateBookingScope(w.admin, { ownerType: "u", ownerId: OWN, bookingId: "b-1", supported: true, mutate: (d: J) => { assert.deepEqual(Object.keys(d).sort(), ["bookings", "structures"]); d.bookings[0].paid = 5; return true; } }));
  assert.deepEqual(r, { handled: true, ok: true, wrote: true });
  assert.equal(row(w.db, "b-1", "bookings").data.paid, 5);
});

test("mutateEntitySet con piu' kind: tutte 'table' = scrive; miste = authority_mixed; tutte 'blob' = handled:false; un solo kind come prima", async () => {
  const set = (w: { admin: never }) => W.mutateEntitySet(w.admin, {
    ownerType: "u", ownerId: OWN, kind: ["bookings", "guests"],
    load: async () => [...(await W.readRowsByIds(w.admin, "u", OWN, "bookings", ["b-1"])), ...(await W.readRowsByIds(w.admin, "u", OWN, "guests", ["g1"]))],
    compute: (cur) => ({ action: "changes", changes: cur.map((next, idx) => ({ idx, next: { ...next, tag: "ok" } })) }),
  });
  const w = world({ auth: BOTH_TABLE });
  assert.deepEqual(await on(() => set(w)), { handled: true, outcome: "ok", wrote: true });
  assert.equal(row(w.db, "b-1", "bookings").data.tag, "ok"); assert.equal(row(w.db, "g1", "guests").data.tag, "ok");
  const m = world({ auth: [{ kind: "guests", authority: "table" }] });
  assert.deepEqual(await on(() => set(m)), { handled: true, outcome: "error", message: "authority_mixed" });
  assert.equal(entUpdates(m.db), 0);
  const b = world({ auth: [] });
  assert.deepEqual(await on(() => set(b)), { handled: false, reason: "authority_blob" });
  assert.deepEqual(await withWrite(undefined, () => set(b)), { handled: false, reason: "disabled" });
  const one = world({ auth: [{ kind: "bookings", authority: "table" }] });
  const r1 = await on(() => W.mutateEntitySet(one.admin, { ownerType: "u", ownerId: OWN, kind: "bookings", load: () => W.readRowsByIds(one.admin, "u", OWN, "bookings", ["b-1"]), compute: () => ({ action: "noop" }) }));
  assert.deepEqual(r1, { handled: true, outcome: "ok", wrote: false });
});

// ───────────────────────── unreferencedRefs ─────────────────────────
test("unreferencedRefs: restituisce solo i file che nessuna prenotazione/ospite cita (qualunque campo, anche ospiti aggiuntivi), a pagine", async () => {
  const w = world({ edit: (ds) => {
    ds.bookings[2].extraGuests = [{ firstName: "A", docPhotoFront: ref(20) }];
    ds.guests.push(...Array.from({ length: 1100 }, (_, i) => ({ id: "gx" + String(i).padStart(4, "0"), docPhotoBack: i === 1099 ? ref(21) : undefined })));
  } });
  // OLDF su b-1/b-2/g1, ref(20) solo su un ospite aggiuntivo, ref(21) sull'ultima pagina degli ospiti, ref(22) mai usata
  assert.deepEqual(await W.unreferencedRefs(w.admin, "u", OWN, [OLDF, ref(20), ref(21), ref(22)]), [ref(22)]);
  assert.deepEqual(await W.unreferencedRefs(w.admin, "u", OWN, []), []);
  assert.deepEqual(await W.unreferencedRefs(w.admin, "u", "altro-proprietario", [OLDF]), [OLDF], "un altro proprietario non conta");
});

test("unreferencedRefs: a qualunque errore di lettura non cancella nulla (risposta vuota)", async () => {
  const w = world();
  w.db.failEntities = "rete caduta";
  assert.deepEqual(await W.unreferencedRefs(w.admin, "u", OWN, [ref(22)]), []);
  const boom = { from: () => { throw new Error("boom"); } } as never;
  assert.deepEqual(await W.unreferencedRefs(boom, "u", OWN, [ref(22)]), []);
});

// ───────────────────────── purge foto documento ─────────────────────────
test("purge, interruttore spento: percorso del blocco invariato, public.entities intatta, nessuna richiesta sull'autorita'", async () => {
  const w = world({ auth: BOTH_TABLE });
  const n = await withWrite(undefined, () => P.purgeDocPhotos(w.admin, OWN, ["b-1"]));
  assert.equal(n, 1);
  const b = blob(w.db);
  assert.equal(b.bookings[0].docPhotoFront, undefined); assert.equal(b.guests[0].docPhotoBack, undefined);
  assert.equal(b.bookings[1].docPhotoFront, OLDF, "b-2 non era tra le prenotazioni inviate");
  assert.equal(entUpdates(w.db), 0);
  assert.ok(!w.log.includes("entity_authority"));
  assert.deepEqual(w.removed, [pathOf(OLDB)]);
});

test("purge con autorita' 'blob' (interruttore acceso): blocco come sempre", async () => {
  const w = world({ auth: [{ kind: "bookings", authority: "blob" }, { kind: "guests", authority: "blob" }] });
  assert.equal(await on(() => P.purgeDocPhotos(w.admin, OWN, ["b-1"])), 1);
  assert.equal(blob(w.db).bookings[0].docPhotoFront, undefined);
  assert.equal(entUpdates(w.db), 0);
  assert.deepEqual(w.removed, [pathOf(OLDB)]);
});

test("purge con autorita' 'table': toglie le foto da prenotazione e anagrafica sulle righe, non tocca il blocco; non cancella OLDF (ancora su b-2) ma cancella OLDB", async () => {
  const w = world({ auth: BOTH_TABLE });
  const blobBefore = JSON.stringify(w.db.tables.app_state);
  const n = await on(() => P.purgeDocPhotos(w.admin, OWN, ["b-1"]));
  assert.equal(n, 1);
  const b1 = row(w.db, "b-1", "bookings"), g1 = row(w.db, "g1", "guests");
  assert.equal(b1.data.docPhotoFront, undefined); assert.equal(b1.data.docPhotoBack, undefined);
  assert.equal(b1.data.signature, SIGN, "la firma resta");
  assert.equal(g1.data.docPhotoFront, undefined); assert.equal(g1.data.docPhotoBack, undefined);
  assert.equal(g1.data.lastName, "Rossi");
  assert.ok(b1.updated_ms > 1000 && g1.updated_ms > 500);
  assert.equal(row(w.db, "b-2", "bookings").data.docPhotoFront, OLDF, "l'altra prenotazione conserva la sua foto");
  assert.equal(row(w.db, "b-2", "bookings").updated_ms, 2000);
  assert.equal(JSON.stringify(w.db.tables.app_state), blobBefore);
  assert.deepEqual(w.removed, [pathOf(OLDB)]);
  // idempotente: seconda volta niente da fare
  const upd = entUpdates(w.db);
  assert.equal(await on(() => P.purgeDocPhotos(w.admin, OWN, ["b-1"])), 0);
  assert.equal(entUpdates(w.db), upd);
});

test("purge 'table': un file ancora usato da un'altra anagrafica ospite (o da un ospite aggiuntivo) NON si cancella", async () => {
  const w = world({ auth: BOTH_TABLE, edit: (ds) => { ds.guests[1].docPhotoBack = OLDB; ds.bookings[2].extraGuests = [{ firstName: "A", docPhotoFront: OLDF }]; } });
  assert.equal(await on(() => P.purgeDocPhotos(w.admin, OWN, ["b-1"])), 1);
  assert.equal(row(w.db, "b-1", "bookings").data.docPhotoBack, undefined);
  assert.equal(row(w.db, "g2", "guests").data.docPhotoBack, OLDB);
  assert.deepEqual(w.removed, [], "OLDB e' su g2, OLDF su b-2 e su un ospite aggiuntivo di b-3: nessun file va via");
});

test("purge 'table': conflitto permanente => nessuna foto tolta (riga rimessa com'era), nessun file cancellato, il blocco non e' scritto", async () => {
  const w = world({ auth: BOTH_TABLE, beforeUpdate: (db, n) => { if (n === 2 || n === 5) { const g = db.tables.entities.find((x) => x.kind === "guests" && x.id === "g1") as J; g.updated_ms = Number(g.updated_ms) + 1; } } });
  assert.equal(await on(() => P.purgeDocPhotos(w.admin, OWN, ["b-1"])), 0);
  assert.equal(row(w.db, "b-1", "bookings").data.docPhotoFront, OLDF);
  assert.equal(blobUpdates(w.db), 0);
  assert.deepEqual(w.removed, []);
});

test("purge con autorita' mista: non fa nulla (ne' tabelle ne' blocco), nessun file cancellato", async () => {
  for (const auth of [[{ kind: "bookings", authority: "table" }], [{ kind: "guests", authority: "table" }]]) {
    const w = world({ auth });
    assert.equal(await on(() => P.purgeDocPhotos(w.admin, OWN, ["b-1"])), 0);
    assert.equal(entUpdates(w.db), 0); assert.equal(blobUpdates(w.db), 0);
    assert.deepEqual(w.removed, []);
  }
});

test("purge 'table': prenotazione inesistente o di un altro proprietario = niente da fare", async () => {
  const w = world({ auth: BOTH_TABLE });
  assert.equal(await on(() => P.purgeDocPhotos(w.admin, OWN, ["non-c-e"])), 0);
  assert.equal(entUpdates(w.db), 0);
  assert.deepEqual(w.removed, []);
});

// ───────────────────────── rischi segnalati dalla revisione: ripristino fallito, autorita' illeggibile, lettura fallita ─────────────────────────
test("ripristino fallito (qualcuno ha toccato la prima riga nel frattempo): errore distinto partial_group_write, NON ritentabile (nessun secondo tentativo)", async () => {
  // check-in: update 1 = prenotazione ok, 2 = anagrafica in conflitto, 3 = ripristino della prenotazione, che fallisce perche' la riga e' stata toccata
  const w = world({ auth: BOTH_TABLE, beforeUpdate: (db, n) => {
    if (n === 2) { const g = db.tables.entities.find((x) => x.kind === "guests" && x.id === "g1") as J; g.updated_ms = Number(g.updated_ms) + 1; }
    if (n === 3) { const b = db.tables.entities.find((x) => x.kind === "bookings" && x.id === "b-1") as J; b.updated_ms = Number(b.updated_ms) + 1; }
  } });
  const r = await on(() => replacePhotos());
  assert.equal(r.status, 409);
  assert.equal(r.json.reason, "partial_group_write");
  assert.equal(entUpdates(w.db), 3, "nessun nuovo tentativo dopo un ripristino fallito");
  assert.deepEqual(w.removed, []);
});

test("gruppo di camere: ripristino fallito => partial_group_write (non conflict), una sola passata", async () => {
  const w = world({ auth: BOTH_TABLE, edit: (ds) => { for (const id of ["g-1", "g-2"]) ds.bookings.push({ id, structureId: "st-1", groupId: "grp1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: ci, checkOut: co, paid: 0, total: 100, updatedAt: 4000 }); },
    beforeUpdate: (db, n) => {
      if (n === 2) { const x = db.tables.entities.find((r) => r.id === "g-2") as J; x.updated_ms = Number(x.updated_ms) + 1; }
      if (n === 3) { const x = db.tables.entities.find((r) => r.id === "g-1") as J; x.updated_ms = Number(x.updated_ms) + 1; }
    } });
  const r = await on(() => W.mutateBookingScope(w.admin, { ownerType: "u", ownerId: OWN, bookingId: "g-1", supported: true, mutate: (d: J) => { d.bookings.forEach((b: J) => { b.paid = 50; }); return true; } }));
  assert.equal(r.handled, true);
  assert.equal((r as J).error, "partial_group_write");
  assert.match(String((r as J).message), /partial_group_write/);
  assert.equal(entUpdates(w.db), 3);
});

test("autorita' illeggibile con interruttore acceso: i percorsi nuovi NON ricadono sul blocco (check-in 409 read_error, purge ferma)", async () => {
  const w = world({ authError: true });
  const r = await on(() => replacePhotos());
  assert.equal(r.status, 409);
  assert.equal(r.json.reason, "read_error");
  assert.equal(blobUpdates(w.db), 0); assert.equal(entUpdates(w.db), 0);
  assert.deepEqual(w.removed, []);
  const s = await on(() => W.mutateBookingScope(w.admin, scopeArgs(() => true)));
  assert.equal((s as J).error, "read_error");
  const p = world({ authError: true });
  assert.equal(await on(() => P.purgeDocPhotos(p.admin, OWN, ["b-1"])), 0);
  assert.equal(blobUpdates(p.db), 0, "la purge non scrive il blocco");
  assert.equal(blob(p.db).bookings[0].docPhotoFront, OLDF);
  assert.deepEqual(p.removed, []);
  // con l'interruttore spento non si legge nulla e si prosegue sul blocco, come sempre
  const off = world({ authError: true });
  assert.equal((await withWrite(undefined, () => replacePhotos())).status, 200);
  assert.equal(blob(off.db).bookings[0].docPhotoFront, NEWF);
});

test("purge 'table', fail-closed: se le righe non si leggono (o non si riesce a verificare chi cita ancora i file) non si cancella NESSUN file", async () => {
  // 1) lettura delle righe da purgare fallita
  const a = world({ auth: BOTH_TABLE });
  a.db.failEntities = "rete caduta";
  assert.equal(await on(() => P.purgeDocPhotos(a.admin, OWN, ["b-1"])), 0);
  assert.deepEqual(a.removed, []);
  assert.equal(blobUpdates(a.db), 0);
  // 2) righe purgate, ma la ricerca dei riferimenti ancora in uso fallisce: le foto sono tolte dai dati, i file restano nello Storage (meglio un file in piu')
  const b = world({ auth: BOTH_TABLE, failRange: true });
  assert.equal(await on(() => P.purgeDocPhotos(b.admin, OWN, ["b-1"])), 1);
  assert.equal(row(b.db, "b-1", "bookings").data.docPhotoFront, undefined);
  assert.deepEqual(b.removed, []);
  // 3) check-in: stessa cosa per le foto sostituite
  const c = world({ auth: BOTH_TABLE, failRange: true });
  assert.equal((await on(() => replacePhotos())).status, 200);
  assert.equal(row(c.db, "b-1", "bookings").data.docPhotoFront, NEWF);
  assert.deepEqual(c.removed, []);
});
