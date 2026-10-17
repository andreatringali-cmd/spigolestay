import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const flow = await import("../src/lib/checkin-flow.ts");
const san = await import("../src/lib/checkin-sanitize.ts");

// ── Gruppi: capocamera con documento ──────────────────────────────────────────────────────────────────────────
test("roomHeads: chi prenota guida la sua camera, nelle altre il più grande", () => {
  const heads = flow.roomHeads([
    { room: "A", birthDate: "1985-01-01" },          // prenotante
    { room: "B", birthDate: "2012-05-05" },           // minore, per primo nella camera B
    { room: "B", birthDate: "1980-03-03" },           // adulto nella camera B
    { room: "A", birthDate: "1950-01-01" },           // più grande ma nella camera del prenotante
  ], "A");
  assert.equal(heads.get("A"), 0);
  assert.equal(heads.get("B"), 2); // l'adulto, non il minore
});

test("roomHeads: senza date vale il primo; chi non ha la data perde contro chi ce l'ha", () => {
  assert.equal(flow.roomHeads([{ room: "A" }, { room: "B" }, { room: "B" }], "A").get("B"), 1);
  assert.equal(flow.roomHeads([{ room: "A" }, { room: "B" }, { room: "B", birthDate: "1990-01-01" }], "A").get("B"), 2);
});

const miss = (r: { blocking: { code: string; guest?: number }[] }) => r.blocking.map((m) => `${m.code}:${m.guest ?? 1}`);
const person = (o: Record<string, unknown> = {}) => ({ firstName: "Anna", lastName: "Verdi", sex: "F", birthDate: "1990-01-01", birthPlace: "Roma", citizenship: "Italia", ...o });
const input = (over: Record<string, unknown>) => ({
  doc: { ...person({ firstName: "Mario", lastName: "Rossi", sex: "M", docNumber: "AA1", docPlace: "Siracusa" }) },
  extras: [], consent: true, signature: "x", isOperator: false, expectedGuests: 2, isGroup: true, missingRooms: [], primaryRoom: "A", ...over,
}) as never;

test("gruppo: il capocamera di un'altra camera deve avere numero e luogo di rilascio del documento", () => {
  const r = flow.checkinStatus(input({ extras: [person({ room: "B" })] }));
  assert.deepEqual(miss(r).sort(), ["docNumber:2", "docPlace:2"]);
  const ok = flow.checkinStatus(input({ extras: [person({ room: "B", docNumber: "XY9", docPlace: "Roma" })] }));
  assert.equal(ok.valid, true);
});

test("gruppo: nella camera di chi prenota i co-ospiti non hanno bisogno del documento; in un'altra camera solo il capocamera", () => {
  const r = flow.checkinStatus(input({ extras: [person({ room: "A" }), person({ firstName: "Gigi", room: "B", docNumber: "Q1", docPlace: "Roma" }), person({ firstName: "Pia", room: "B", birthDate: "2015-01-01" })] }));
  assert.equal(r.valid, true); // il capo della B è Gigi (più grande, ha il documento); Pia (minore) non serve
});

test("gruppo: se il più grande della camera B non ha il documento lo chiede a lui, non al minore", () => {
  const r = flow.checkinStatus(input({ extras: [person({ firstName: "Pia", room: "B", birthDate: "2015-01-01", docNumber: "Z", docPlace: "Roma" }), person({ firstName: "Gigi", room: "B" })] }));
  assert.deepEqual(miss(r).sort(), ["docNumber:3", "docPlace:3"]);
});

test("prenotazione singola: i familiari non hanno bisogno del documento (come prima)", () => {
  const r = flow.checkinStatus(input({ isGroup: false, primaryRoom: undefined, extras: [person({})] }));
  assert.equal(r.valid, true);
});

test("docTypeFromText: il passaporto letto dall'AI sostituisce il default", () => {
  assert.equal(flow.docTypeFromText("Passaporto"), "Passaporto");
  assert.equal(flow.docTypeFromText("PASSPORT"), "Passaporto");
  assert.equal(flow.docTypeFromText("Permesso di soggiorno"), "Permesso di soggiorno");
  assert.equal(flow.docTypeFromText("Carta d'identità"), "Carta d'identità");
  assert.equal(flow.docTypeFromText("Patente di guida"), "Patente di guida");
  assert.equal(flow.docTypeFromText(""), undefined);
  assert.equal(flow.docTypeFromText("tessera sanitaria"), undefined);
});

// ── Pulizia dati ──────────────────────────────────────────────────────────────────────────────────────────────
test("sesso solo M/F, data di nascita ISO valida e non futura", () => {
  assert.equal(san.cleanSex("M"), "M"); assert.equal(san.cleanSex("F"), "F");
  assert.equal(san.cleanSex("X"), undefined); assert.equal(san.cleanSex("Herr"), undefined); assert.equal(san.cleanSex(1), undefined); assert.equal(san.cleanSex(""), undefined);
  assert.equal(san.cleanSex("FEMMINA"), "F"); assert.equal(san.cleanSex("male"), "M");
  assert.equal(san.cleanBirthDate("1980-05-17", "2026-10-17"), "1980-05-17");
  assert.equal(san.cleanBirthDate("2026-10-18", "2026-10-17"), undefined); // nel futuro
  assert.equal(san.cleanBirthDate("1990-02-30", "2026-10-17"), undefined); // inesistente
  assert.equal(san.cleanBirthDate("17/05/1980", "2026-10-17"), undefined);
  assert.equal(san.cleanBirthDate("1800-01-01", "2026-10-17"), undefined);
  assert.equal(san.birthDateInvalid("", "2026-10-17"), false);
  assert.equal(san.birthDateInvalid("boh", "2026-10-17"), true);
  const d = san.sanitizeDoc({ firstName: " A ", lastName: "B", sex: "Q", birthDate: "2999-01-01", docNumber: " 12 " });
  assert.equal(d.sex, undefined); assert.equal(d.birthDate, undefined); assert.equal(d.docNumber, "12"); assert.equal(d.firstName, "A");
  const e = san.sanitizeExtra({ firstName: "A", lastName: "B", sex: "F", birthDate: "1999-09-09", photoFront: "media:x" });
  assert.equal(e.sex, "F"); assert.equal(e.birthDate, "1999-09-09"); assert.equal(e.docPhotoFront, "media:x");
});

// ── Riapertura e reinvio: nessuna perdita di dati ───────────────────────────────────────────────────────────────
test("orario di arrivo: 'Non lo so' (default) non sovrascrive un orario già indicato", () => {
  assert.equal(san.mergeArrivalTime("16:00-18:00", "Non lo so"), "16:00-18:00");
  assert.equal(san.mergeArrivalTime("16:00-18:00", ""), "16:00-18:00");
  assert.equal(san.mergeArrivalTime("16:00-18:00", "18:00-20:00"), "18:00-20:00");
  assert.equal(san.mergeArrivalTime(undefined, "Non lo so"), "Non lo so");
  assert.equal(san.mergeArrivalTime(undefined, ""), undefined);
});

test("note: il testo vuoto non cancella quello salvato", () => {
  assert.equal(san.mergeText("allergia", ""), "allergia");
  assert.equal(san.mergeText("allergia", "culla"), "culla");
  assert.equal(san.mergeText(undefined, ""), undefined);
});

test("richiesta di fattura: {wants:false} non azzera i dati già salvati", () => {
  const saved = { wants: true, kind: "societa", name: "ACME", vat: "IT123" };
  assert.deepEqual(san.mergeInvoiceRequest(saved, { wants: false }), saved);
  assert.deepEqual(san.mergeInvoiceRequest(saved, undefined), saved);
  assert.deepEqual(san.mergeInvoiceRequest(saved, { wants: true, name: "ACME SRL" }), { wants: true, kind: "societa", name: "ACME SRL", vat: "IT123" });
  assert.deepEqual(san.mergeInvoiceRequest(undefined, { wants: false }), { wants: false });
  assert.deepEqual(san.mergeInvoiceRequest(undefined, { wants: true, name: "X" }), { wants: true, name: "X" });
});

test("co-ospiti: unione per posizione, il refuso nel nome non fa perdere documento e foto", () => {
  const prev = [{ firstName: "Luigi", lastName: "Bianchi", docNumber: "L1", docPhotoFront: "media:old", birthDate: "1970-01-01" }];
  const next = [{ firstName: "Luiggi", lastName: "Bianchi", docNumber: "", docPhotoFront: undefined, birthDate: "" }];
  const m = san.mergeExtraGuests(prev as never, next as never)[0] as Record<string, unknown>;
  assert.equal(m.firstName, "Luiggi"); // vince il nuovo
  assert.equal(m.docNumber, "L1"); assert.equal(m.docPhotoFront, "media:old"); assert.equal(m.birthDate, "1970-01-01");
});

test("co-ospiti: un'altra persona nella stessa posizione NON eredita i dati del precedente; le posizioni oltre il nuovo elenco restano", () => {
  const prev = [{ firstName: "Luigi", lastName: "Bianchi", docNumber: "L1" }, { firstName: "Gina", lastName: "Neri", docNumber: "G1" }];
  const next = [{ firstName: "Paolo", lastName: "Gialli", docNumber: "" }];
  const m = san.mergeExtraGuests(prev as never, next as never) as Record<string, unknown>[];
  assert.equal(m.length, 2);
  assert.equal(m[0].firstName, "Paolo"); assert.equal(m[0].docNumber, ""); // niente "L1" del precedente
  assert.equal(m[1].firstName, "Gina"); // non si perde l'ospite
});

test("ospite principale: i campi vuoti del nuovo invio non cancellano quelli salvati", () => {
  const prev = { firstName: "Mario", lastName: "Rossi", docNumber: "AA1", docPlace: "Siracusa", birthDate: "1980-01-01" };
  const out = san.mergePrimaryGuest(prev, { firstName: "Mario", lastName: "Rossi", docNumber: "", docPlace: undefined, birthDate: "1981-01-01" });
  assert.equal(out.docNumber, "AA1"); assert.equal(out.docPlace, "Siracusa"); assert.equal(out.birthDate, "1981-01-01");
});

// ── Tassa di soggiorno: età dei minori dalle date di nascita ──────────────────────────────────────────────────────
test("età alla data di arrivo e childAges dai documenti", () => {
  assert.equal(san.ageOn("2012-10-18", "2026-10-17"), 13);
  assert.equal(san.ageOn("2012-10-17", "2026-10-17"), 14);
  assert.equal(san.ageOn("", "2026-10-17"), undefined);
  // 1 bambino dichiarato; le date coprono 2 adulti e 1 minore di 10 anni
  assert.deepEqual(san.childAgesFromBirthDates(["1985-01-01", "1987-01-01", "2016-06-01"], "2026-10-17", 1), [10]);
  // date che non coprono i bambini dichiarati: non si toccano i dati esistenti
  assert.equal(san.childAgesFromBirthDates(["1985-01-01", "1987-01-01"], "2026-10-17", 1), undefined);
  assert.equal(san.childAgesFromBirthDates(["2016-06-01"], "2026-10-17", 0), undefined);
});

// ── Prenotazione non attiva e istruzioni di accesso ───────────────────────────────────────────────────────────────
test("checkinInactiveReason / accessInfoVisible", () => {
  assert.equal(san.checkinInactiveReason({ status: "cancelled", checkOut: "2030-01-01" }, "2026-10-17"), "cancelled");
  assert.equal(san.checkinInactiveReason({ status: "no_show", checkOut: "2030-01-01" }, "2026-10-17"), "cancelled");
  assert.equal(san.checkinInactiveReason({ status: "confirmed", checkOut: "2026-10-16" }, "2026-10-17"), "concluded");
  assert.equal(san.checkinInactiveReason({ status: "confirmed", checkOut: "2026-10-17" }, "2026-10-17"), null); // il giorno della partenza è ancora attivo
  assert.equal(san.accessInfoVisible({ status: "confirmed", checkOut: "2026-10-17" }, "2026-10-17"), true);
  assert.equal(san.accessInfoVisible({ status: "tentative", checkOut: "2026-10-20" }, "2026-10-17"), false);
  assert.equal(san.accessInfoVisible({ status: "cancelled", checkOut: "2026-10-20" }, "2026-10-17"), false);
  assert.equal(san.accessInfoVisible({ status: "confirmed", checkOut: "2026-10-10" }, "2026-10-17"), false);
});
