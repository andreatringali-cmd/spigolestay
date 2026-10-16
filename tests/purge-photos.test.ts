import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeFakeDb } from "./helpers/fake-supabase.ts";

register("./helpers/alias-loader.mjs", import.meta.url);
const P = await import("../src/lib/alloggiati/purge.ts");
const M = await import("../src/lib/media.ts");

const T = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const ref = (scope: "u" | "o", id: string, n: number) => M.mediaRef(M.PRIVATE_BUCKET, M.scopedPath(scope, id, "jpg", `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`));
const DATA_KEY = "spigolestay:data:v1";
const DATA_URI = "data:image/jpeg;base64,/9j/AAAA";

function sample() {
  const f1 = ref("u", T, 1), b1 = ref("u", T, 2), e1 = ref("u", T, 3), shared = ref("u", T, 4);
  return {
    refs: { f1, b1, e1, shared },
    data: {
      bookings: [
        // prenotazione con schedina inviata: foto proprie + un'ospite aggiuntiva + foto condivisa con l'anagrafica
        { id: "B1", guestId: "G1", docPhotoFront: f1, docPhotoBack: b1, signature: "firma", extraGuests: [{ firstName: "A", docPhotoFront: e1 }, { firstName: "B", docPhotoFront: DATA_URI }] },
        // altra prenotazione NON inviata dello stesso ospite: usa la stessa foto dell'anagrafica
        { id: "B2", guestId: "G1", docPhotoFront: shared },
        { id: "B3", guestId: "G9", docPhotoFront: DATA_URI },
      ],
      guests: [{ id: "G1", docPhotoFront: shared, docPhotoBack: b1, docNumber: "AB123" }, { id: "G9", docPhotoFront: "x" }],
    } as Record<string, unknown>,
  };
}

test("purgeDataPhotos: azzera le foto di prenotazione, ospiti aggiuntivi e anagrafica; tiene firma e numero documento", () => {
  const { data, refs } = sample();
  const r = P.purgeDataPhotos(data, new Set(["B1"]), 123);
  assert.equal(r.changed, true);
  const [b1, b2, b3] = data.bookings as Record<string, unknown>[];
  assert.equal(b1.docPhotoFront, undefined); assert.equal(b1.docPhotoBack, undefined);
  assert.equal(b1.signature, "firma");
  assert.equal(b1.updatedAt, 123);
  for (const e of b1.extraGuests as Record<string, unknown>[]) assert.equal(e.docPhotoFront, undefined);
  const g1 = (data.guests as Record<string, unknown>[])[0];
  assert.equal(g1.docPhotoFront, undefined); assert.equal(g1.docPhotoBack, undefined);
  assert.equal(g1.docNumber, "AB123");
  assert.equal(b2.docPhotoFront, refs.shared); // B2 non è stata inviata: la sua foto resta
  assert.equal(b3.docPhotoFront, DATA_URI);
  // Orfani: i file non più usati da nessuna parte. `shared` è ancora su B2, quindi NON va cancellato; la data URI non è un file.
  assert.deepEqual(r.orphans.sort(), [refs.f1, refs.b1, refs.e1].sort());
});

test("purgeDataPhotos: idempotente e senza modifiche se non c'è nulla da togliere", () => {
  const { data } = sample();
  P.purgeDataPhotos(data, new Set(["B1"]));
  const again = P.purgeDataPhotos(data, new Set(["B1"]));
  assert.deepEqual(again, { changed: false, orphans: [] });
  assert.deepEqual(P.purgeDataPhotos(data, new Set(["NESSUNA"])), { changed: false, orphans: [] });
});

test("purgeDataPhotos: vecchi dati con sole data URI -> campi azzerati, nessun file da cancellare", () => {
  const data = { bookings: [{ id: "B3", guestId: "G9", docPhotoFront: DATA_URI, docPhotoBack: DATA_URI }], guests: [{ id: "G9", docPhotoFront: DATA_URI }] } as Record<string, unknown>;
  const r = P.purgeDataPhotos(data, new Set(["B3"]));
  assert.equal(r.changed, true);
  assert.deepEqual(r.orphans, []);
  assert.equal((data.bookings as Record<string, unknown>[])[0].docPhotoFront, undefined);
});

function fakeWithStorage(tables: Record<string, Record<string, unknown>[]>) {
  const { db, client } = makeFakeDb(tables);
  const removed: { bucket: string; paths: string[] }[] = [];
  const admin = Object.assign(client as object, { storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => { removed.push({ bucket, paths }); return { error: null }; } }) } });
  return { db, admin: admin as never, removed };
}

test("purgeDocPhotos: salva senza foto e POI cancella dallo Storage solo i file non più usati (stato personale)", async () => {
  const { data, refs } = sample();
  const { db, admin, removed } = fakeWithStorage({ app_state: [{ user_id: T, rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }] });
  const n = await P.purgeDocPhotos(admin, T, ["B1"]);
  assert.equal(n, 1);
  const saved = JSON.parse((db.tables.app_state[0].data as Record<string, string>)[DATA_KEY]);
  assert.equal(saved.bookings[0].docPhotoFront, undefined);
  assert.equal(saved.bookings[1].docPhotoFront, refs.shared);
  const paths = removed.flatMap((r) => r.paths).sort();
  const want = [refs.f1, refs.b1, refs.e1].map((r) => M.parseMediaRef(r)!.path).sort();
  assert.deepEqual(paths, want);
  assert.ok(removed.every((r) => r.bucket === M.PRIVATE_BUCKET));
});

test("purgeDocPhotos: org condivisa (org_state di cui l'utente è socio)", async () => {
  const o1 = ref("o", ORG, 7);
  const data = { bookings: [{ id: "B1", guestId: "G1", docPhotoFront: o1 }], guests: [{ id: "G1", docPhotoFront: o1 }] };
  const { db, admin, removed } = fakeWithStorage({
    app_state: [{ user_id: T, rev: 1, data: { [DATA_KEY]: "{}" } }],
    memberships: [{ user_id: T, org_id: ORG }],
    org_state: [{ org_id: ORG, rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }],
  });
  const n = await P.purgeDocPhotos(admin, T, ["B1"]);
  assert.equal(n, 1);
  const saved = JSON.parse((db.tables.org_state[0].data as Record<string, string>)[DATA_KEY]);
  assert.equal(saved.bookings[0].docPhotoFront, undefined);
  assert.equal(saved.guests[0].docPhotoFront, undefined);
  assert.deepEqual(removed.flatMap((r) => r.paths), [M.parseMediaRef(o1)!.path]); // una sola volta
});

test("purgeDocPhotos: se il salvataggio fallisce NON si cancella nessun file", async () => {
  const { data } = sample();
  const { db, admin, removed } = fakeWithStorage({ app_state: [{ user_id: T, rev: 1, data: { [DATA_KEY]: JSON.stringify(data) } }] });
  db.failUpdate = { app_state: "boom" };
  const n = await P.purgeDocPhotos(admin, T, ["B1"]);
  assert.equal(n, 0);
  assert.equal(removed.length, 0);
});
