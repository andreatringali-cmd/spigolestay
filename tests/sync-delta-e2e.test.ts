import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const Core = await import("../src/lib/sync-core.ts");
const W = await import("../src/lib/sync-window.ts");
const D = await import("../src/lib/sync-delta.ts");

// Simulazione end-to-end della «modalità veloce» con la logica VERA di fusione (sync-core): un «server» con l'archivio completo, dispositivi a finestra (delta) e dispositivi
// in modalità normale (blocco intero, come prima).
const KEY = "spigolestay:data:v1";
type Row = Record<string, string>;
const parse = (r: Record<string, string> | null | undefined) => JSON.parse((r ?? {})[KEY] ?? "{}");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

class Server {
  row: Row; rev = 1; today: string;
  constructor(row: Row, today: string) { this.row = row; this.today = today; }
  readFull() { return { data: JSON.parse(JSON.stringify(this.row)) as Row, rev: this.rev }; }
  readWindow(past: number | null = 400) { const f = this.readFull(); return { data: past === null ? f.data : W.windowRowData(f.data, this.today, past).data!, rev: f.rev }; }
  writeFull(merged: Row, expected: number) { if (expected !== this.rev) return null; this.row = JSON.parse(JSON.stringify(merged)); return ++this.rev; }
  postDelta(delta: any, expected: number) { if (expected !== this.rev) return { conflict: true as const }; try { this.row = D.applyDelta(this.row, delta).row; } catch (e: any) { return { error: e.code as string }; } this.rev++; return { rev: this.rev }; }
}

// Un dispositivo in modalità veloce: legge la finestra, fonde con la fusione vera, invia il delta.
class DeltaDevice {
  local: Row; base: Row = {}; rev = -1; past: number | null = 400; blocked: string[] = [];
  constructor(local: Row = {}) { this.local = local; }
  cycle(srv: Server) {
    const { data: win, rev } = srv.readWindow(this.past);
    const merged = Core.mergeSnapshots(this.local, win, this.base);
    const delta = D.buildDelta(win, this.base, merged);
    let wrote = false;
    if (!D.isEmptyDelta(delta)) {
      const r = srv.postDelta(delta, rev);
      if ("conflict" in r) return { merged: this.local, wrote: false, delta, conflict: true };
      if ("error" in r) { this.blocked.push(r.error); return { merged: this.local, wrote: false, delta, error: r.error }; }
      wrote = true; this.rev = r.rev;
    } else this.rev = rev;
    this.base = merged; this.local = merged;
    return { merged, wrote, delta };
  }
  data() { return parse(this.local); }
  edit(fn: (d: any) => void) { const d = this.data(); fn(d); this.local = { ...this.local, [KEY]: JSON.stringify(d) }; }
}
// Un dispositivo in modalità normale: scarica tutto, fonde, riscrive il blocco intero.
class BlobDevice {
  local: Row = {}; base: Row = {};
  cycle(srv: Server) {
    const { data, rev } = srv.readFull();
    const merged = Core.mergeSnapshots(this.local, data, this.base);
    if (Core.contentSig(merged) !== Core.contentSig(data)) { const nr = srv.writeFull(merged, rev); if (nr === null) return { wrote: false }; }
    this.base = merged; this.local = merged; return { wrote: true };
  }
  data() { return parse(this.local); }
  edit(fn: (d: any) => void) { const d = this.data(); fn(d); this.local = { ...this.local, [KEY]: JSON.stringify(d) }; }
}

const TODAY = "2026-10-19";
const day = (offset: number) => new Date(Date.parse(TODAY + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
const bk = (id: string, ci: string, co: string, extra: Record<string, unknown> = {}) => ({ id, structureId: "s1", guestId: "g-" + id, checkIn: ci, checkOut: co, status: "confirmed", updatedAt: 1000, ...extra });

function makeServer(): Server {
  const bookings: any[] = [], guests: any[] = [];
  for (let i = 0; i < 300; i++) { const off = -1200 + i * 5; bookings.push(bk("b" + i, day(off), day(off + 3))); guests.push({ id: "g-b" + i, fullName: "Ospite " + i, updatedAt: 1000 }); }
  for (let i = 0; i < 100; i++) guests.push({ id: "g-free" + i, fullName: "Contatto " + i, updatedAt: 1000 });
  const data = {
    structures: [{ id: "s1", name: "Casa", updatedAt: 1 }], roomTypes: [{ id: "rt1", structureId: "s1", name: "Doppia", updatedAt: 1 }],
    units: [{ id: "u1", structureId: "s1", roomTypeId: "rt1", name: "1", updatedAt: 1 }], bookings, guests, events: [], directReviews: [],
    rateOverrides: { "rt1|2026-10-20": 120 }, activities: [], _deleted: {},
  };
  return new Server({ [KEY]: JSON.stringify(data), "spigolestay:promos": "[]", "spigolestay:users": "[]" }, TODAY);
}
const inWin = (srv: Server) => ids(parse(srv.readWindow().data).bookings);

test("avvio a freddo: il dispositivo riceve solo la finestra e poi non rimanda NULLA (nemmeno dopo giorni)", () => {
  const srv = makeServer(); const dev = new DeltaDevice();
  const total = parse(srv.row).bookings.length;
  const r1 = dev.cycle(srv);
  assert.equal(r1.wrote, false);
  const n = dev.data().bookings.length;
  assert.ok(n > 0 && n < total / 2, `finestra ${n} di ${total}`);
  for (let i = 0; i < 3; i++) assert.equal(dev.cycle(srv).wrote, false);
  srv.today = day(40); // la finestra scorre: alcune prenotazioni escono dal server, il dispositivo le tiene
  for (let i = 0; i < 3; i++) { const r = dev.cycle(srv); assert.equal(r.wrote, false, "nessun invio a vuoto"); assert.equal(D.isEmptyDelta(r.delta), true); }
  assert.equal(parse(srv.row).bookings.length, total);   // l'archivio completo non è mai cambiato
});

test("modifica e nuova prenotazione dal dispositivo veloce: il server le riceve, il resto dell'archivio resta intatto", () => {
  const srv = makeServer(); const dev = new DeltaDevice(); dev.cycle(srv);
  const before = parse(srv.row);
  const target = inWin(srv).slice(-1)[0];
  dev.edit((d) => { const b = d.bookings.find((x: any) => x.id === target); b.notes = "nota"; b.updatedAt = 5000; d.bookings.push(bk("nuova", day(10), day(12), { updatedAt: 5000 })); d.guests.push({ id: "g-nuova", fullName: "Nuova", updatedAt: 5000 }); });
  assert.equal(dev.cycle(srv).wrote, true);
  const after = parse(srv.row);
  assert.equal(after.bookings.length, before.bookings.length + 1);
  assert.equal(after.bookings.find((x: any) => x.id === target).notes, "nota");
  assert.deepEqual(ids(after.bookings.filter((b: any) => !["nuova", target].includes(b.id))), ids(before.bookings.filter((b: any) => b.id !== target)));
  assert.equal(after.guests.length, before.guests.length + 1);
  assert.equal(dev.cycle(srv).wrote, false);
});

test("cancellazione dal dispositivo veloce: sparisce dal server con la lapide; un dispositivo normale la vede e non la fa risorgere", () => {
  const srv = makeServer(); const dev = new DeltaDevice(); dev.cycle(srv);
  const blob = new BlobDevice(); blob.cycle(srv);
  const victim = inWin(srv).slice(-1)[0];
  dev.edit((d) => { d.bookings = d.bookings.filter((b: any) => b.id !== victim); d._deleted = { ...(d._deleted ?? {}), bookings: [...((d._deleted ?? {}).bookings ?? []), victim] }; });
  assert.equal(dev.cycle(srv).wrote, true);
  assert.ok(!parse(srv.row).bookings.some((b: any) => b.id === victim));
  blob.cycle(srv); blob.cycle(srv);
  assert.ok(!blob.data().bookings.some((b: any) => b.id === victim));
  assert.ok(!parse(srv.row).bookings.some((b: any) => b.id === victim)); // non è risorta
});

test("un dispositivo normale modifica una prenotazione VECCHIA (fuori finestra): il dispositivo veloce non cancella nulla e non perde la modifica", () => {
  const srv = makeServer(); const dev = new DeltaDevice(); dev.cycle(srv);
  const blob = new BlobDevice(); blob.cycle(srv);
  const oldId = "b3"; assert.ok(!inWin(srv).includes(oldId));
  blob.edit((d) => { const b = d.bookings.find((x: any) => x.id === oldId); b.notes = "vecchia"; b.updatedAt = 7000; });
  blob.cycle(srv);
  for (let i = 0; i < 3; i++) dev.cycle(srv);
  assert.equal(parse(srv.row).bookings.find((b: any) => b.id === oldId).notes, "vecchia");
  assert.equal(parse(srv.row).bookings.length, 300);
});

test("novità dal server (webhook): il dispositivo veloce le adotta senza rimandare niente", () => {
  const srv = makeServer(); const dev = new DeltaDevice(); dev.cycle(srv);
  const d = parse(srv.row); d.bookings.push(bk("webhook1", day(5), day(7), { updatedAt: 9000, channel: "booking" })); d.guests.push({ id: "g-webhook1", fullName: "Dal portale", updatedAt: 9000 });
  srv.row[KEY] = JSON.stringify(d); srv.rev++;
  const r = dev.cycle(srv);
  assert.equal(r.wrote, false);
  assert.ok(dev.data().bookings.some((b: any) => b.id === "webhook1"));
});

test("prenotazione uscita dalla finestra ma ancora nel dispositivo: se la modifichi, la modifica arriva al server", () => {
  const srv = makeServer(); const dev = new DeltaDevice(); dev.cycle(srv);
  const edge = inWin(srv)[0];
  srv.today = day(60); dev.cycle(srv);                                  // ora il server non la include più nella finestra
  assert.ok(!inWin(srv).includes(edge)); assert.ok(dev.data().bookings.some((b: any) => b.id === edge)); // il dispositivo la tiene
  dev.edit((d) => { const b = d.bookings.find((x: any) => x.id === edge); b.notes = "ritocco"; b.updatedAt = 8000; });
  assert.equal(dev.cycle(srv).wrote, true);
  assert.equal(parse(srv.row).bookings.find((b: any) => b.id === edge).notes, "ritocco");
});

test("«Carica storico»: la finestra si allarga, le prenotazioni vecchie arrivano e non si rimanda nulla; poi si torna alla finestra senza perdere niente", () => {
  const srv = makeServer(); const dev = new DeltaDevice(); dev.cycle(srv);
  const small = dev.data().bookings.length;
  dev.past = null;                                                      // storico completo
  const r = dev.cycle(srv);
  assert.equal(r.wrote, false);
  assert.equal(dev.data().bookings.length, 300); assert.ok(small < 300);
  dev.past = 400;
  const r2 = dev.cycle(srv);
  assert.equal(r2.wrote, false);
  assert.equal(parse(srv.row).bookings.length, 300);
});

test("passaggio da modalità veloce a normale: il dispositivo con la copia a finestra si fonde con l'archivio completo senza cancellare nulla", () => {
  const srv = makeServer(); const dev = new DeltaDevice(); dev.cycle(srv);
  const blob = new BlobDevice(); blob.local = dev.local;               // stessa copia locale (finestra), base vuota (nuovo avvio)
  blob.cycle(srv);
  assert.equal(parse(srv.row).bookings.length, 300);
  assert.equal(blob.data().bookings.length, 300);
  // e una modifica fatta dopo il ritorno alla normalità si salva senza perdere lo storico
  blob.edit((d) => { d.bookings[0].notes = "ok"; d.bookings[0].updatedAt = 9999; });
  blob.cycle(srv);
  assert.equal(parse(srv.row).bookings.length, 300);
});

test("protezione: se il dispositivo veloce si ritrova con l'elenco vuoto (errore, copia corrotta) il server RIFIUTA la cancellazione di massa", () => {
  const srv = makeServer(); const dev = new DeltaDevice(); dev.cycle(srv);
  const total = parse(srv.row).bookings.length;
  const winCount = dev.data().bookings.length; assert.ok(winCount > 40, "per il test servono più di 40 prenotazioni in finestra");
  dev.edit((d) => { d.bookings = []; });
  const r = dev.cycle(srv);
  assert.equal(r.wrote, false); assert.deepEqual(dev.blocked, ["mass_delete"]);
  assert.equal(parse(srv.row).bookings.length, total);
});

test("due dispositivi veloci che modificano cose diverse: nessuna perde le modifiche dell'altro", () => {
  const srv = makeServer(); const a = new DeltaDevice(); const b = new DeltaDevice(); a.cycle(srv); b.cycle(srv);
  const [x, y] = inWin(srv).slice(-2);
  a.edit((d) => { const t = d.bookings.find((q: any) => q.id === x); t.notes = "A"; t.updatedAt = 5000; });
  b.edit((d) => { const t = d.bookings.find((q: any) => q.id === y); t.notes = "B"; t.updatedAt = 5001; });
  assert.equal(a.cycle(srv).wrote, true);
  assert.equal(b.cycle(srv).wrote, true);                               // legge dopo la scrittura di A: fonde e invia la propria modifica
  const final = parse(srv.row);
  assert.equal(final.bookings.find((q: any) => q.id === x).notes, "A");
  assert.equal(final.bookings.find((q: any) => q.id === y).notes, "B");
});

test("conflitto di versione (due scritture quasi insieme): la seconda viene rifiutata, al ciclo dopo rilegge e riesce, senza perdere nulla", () => {
  const srv = makeServer(); const a = new DeltaDevice(); const b = new DeltaDevice(); a.cycle(srv); b.cycle(srv);
  const [x, y] = inWin(srv).slice(-2);
  a.edit((d) => { const t = d.bookings.find((q: any) => q.id === x); t.notes = "A"; t.updatedAt = 5000; });
  b.edit((d) => { const t = d.bookings.find((q: any) => q.id === y); t.notes = "B"; t.updatedAt = 5001; });
  // B ha già letto la finestra (rev corrente) quando A scrive: simulato leggendo prima e scrivendo dopo
  const staleWin = srv.readWindow(); const staleRev = staleWin.rev;
  assert.equal(a.cycle(srv).wrote, true);
  const merged = Core.mergeSnapshots(b.local, staleWin.data, b.base);
  const delta = D.buildDelta(staleWin.data, b.base, merged);
  assert.deepEqual(srv.postDelta(delta, staleRev), { conflict: true });
  assert.equal(b.cycle(srv).wrote, true);
  const final = parse(srv.row);
  assert.equal(final.bookings.find((q: any) => q.id === x).notes, "A");
  assert.equal(final.bookings.find((q: any) => q.id === y).notes, "B");
});

test("lapidi al tetto (3000): non si rimandano le stesse a ogni ciclo, converge entro due cicli", () => {
  const srv = makeServer();
  const d = parse(srv.row); d._deleted = { bookings: Array.from({ length: 3000 }, (_, i) => "t" + i), guests: Array.from({ length: 3000 }, (_, i) => "tg" + i) };
  srv.row[KEY] = JSON.stringify(d);
  const dev = new DeltaDevice(); dev.cycle(srv);
  // il dispositivo ha in locale alcune lapidi che il server non ha (es. cancellazioni fatte offline)
  dev.edit((x) => { x._deleted = { bookings: [...x._deleted.bookings, ...Array.from({ length: 17 }, (_, i) => "loc" + i)], guests: [...x._deleted.guests, "locg"] }; });
  dev.cycle(srv);
  let writes = 0;
  for (let i = 0; i < 4; i++) if (dev.cycle(srv).wrote) writes++;
  assert.equal(writes, 0, "dopo il primo invio non si rimanda più nulla");
  assert.ok(parse(srv.row)._deleted.bookings.length <= 3000);
  assert.ok(parse(srv.row)._deleted.bookings.includes("loc3"));          // le lapidi locali sono arrivate
  assert.equal(parse(srv.row).bookings.length, 300);
});
