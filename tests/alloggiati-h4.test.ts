import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const codes = await import("../src/lib/alloggiati/codes.ts");
const svc = await import("../src/lib/alloggiati/service.ts");
const san = await import("../src/lib/checkin-sanitize.ts");
const { todayRome, addDaysYmd } = await import("../src/lib/dates-rome.ts");

// Tabella nella FORMA REALE del DB: gli Stati hanno provincia "ES", codice 100000xxx e is_comune=true; loadCodeMaps li riclassifica come Stati.
const rows = [
  ["100000100", "ITALIA"], ["100000216", "GERMANIA"], ["100000215", "FRANCIA"], ["100000243", "PAESI BASSI"], ["100000508", "BRASILE"], ["100000536", "STATI UNITI D AMERICA"],
  ["100000330", "GIORDANIA"], ["100000331", "SIRIA"], ["100000332", "CAMBOGIA"], ["100000333", "COREA DEL NORD"], ["100000334", "COREA DEL SUD"], ["100000335", "IRAN"], ["100000336", "REPUBBLICA SLOVACCA"],
  ["100000337", "MALAYSIA"], ["100000338", "STATO DELLA CITTA DEL VATICANO"], ["100000339", "CANADA"],
].map(([code, n]) => ({ kind: "luoghi", code, name_norm: n, provincia: "ES", is_comune: true }));
const comuni = [
  { code: "405099001", n: "SANTA MARIA", p: "RN" }, { code: "405034027", n: "PARMA", p: "PR" }, { code: "405058091", n: "ROMA", p: "RM" },
  { code: "405089017", n: "SIRACUSA", p: "SR" }, { code: "405092009", n: "CAGLIARI", p: "CA" },
].map((c) => ({ kind: "luoghi", code: c.code, name_norm: c.n, provincia: c.p, is_comune: true }));
const docs = [["IDENT", "CARTA IDENTITA"], ["IDELE", "CARTA IDENTITA ELETTRONICA"], ["PASOR", "PASSAPORTO ORDINARIO"], ["PATEN", "PATENTE DI GUIDA"]].map(([code, n]) => ({ kind: "documenti", code, name_norm: n, provincia: null, is_comune: false }));
const all = [...rows, ...comuni, ...docs];
const admin = { from: () => ({ select: () => ({ range: async (a: number) => ({ data: a === 0 ? all : [], error: null }) }) }) };
const maps = await codes.loadCodeMaps(admin as never);

const G = { comuneNascita: "Roma", cittadinanza: "Italiana", tipoDoc: "Carta d'identità", luogoRilascio: "Comune di Siracusa" };

test("#2 nati all'estero: 'Santa Maria, Brazil' NON diventa il comune italiano Santa Maria", () => {
  const r = codes.resolveSchedinaCodes({ ...G, comuneNascita: "Santa Maria, Brazil", cittadinanza: "Brazil" }, false, maps);
  assert.equal(r.comune, "");
  assert.equal(r.prov, "");
  assert.equal(r.statoNascita, "100000508");
  assert.equal(r.cittadinanza, "100000508");
  assert.deepEqual(r.issues.filter((m) => /nascita/i.test(m)), []);
  // senza il paese resta un comune italiano
  assert.equal(codes.resolveSchedinaCodes({ ...G, comuneNascita: "Santa Maria" }, false, maps).comune, "405099001");
  // lo Stato indicato a parte conta quanto il testo
  assert.equal(codes.resolveSchedinaCodes({ ...G, comuneNascita: "Santa Maria", statoNascita: "Brazil" }, false, maps).comune, "");
});

test("#2 'Parma, Ohio' (Stato federato estero) non è Parma (PR)", () => {
  const r = codes.resolveSchedinaCodes({ ...G, comuneNascita: "Parma, Ohio" }, false, maps);
  assert.equal(r.comune, "");
  assert.ok(r.issues.some((m) => /Luogo di nascita «Parma, Ohio» non riconosciuto/.test(m)));
  assert.equal(codes.resolveSchedinaCodes({ ...G, comuneNascita: "Parma" }, false, maps).comune, "405034027");
});

test("#2 sigle di provincia e 'Italia' dopo la virgola restano comuni italiani (anche se la sigla è un codice ISO)", () => {
  for (const v of ["Siracusa, SR", "Siracusa (SR)", "Roma, Italia", "Roma, Italy", "Cagliari, CA", "Cagliari (CA)"]) {
    const r = codes.resolveSchedinaCodes({ ...G, comuneNascita: v }, false, maps);
    assert.ok(r.comune, v);
    assert.equal(r.statoNascita, "100000100", v);
  }
});

test("#3 'Rome, Italy': Stato Italia ma comune non riconosciuto → errore, non passa", () => {
  const r = codes.resolveSchedinaCodes({ ...G, comuneNascita: "Rome, Italy" }, false, maps);
  assert.equal(r.comune, "");
  assert.ok(r.issues.some((m) => /Nato in Italia: indica il Comune/.test(m)));
  assert.ok(codes.resolveSchedinaCodes({ ...G, comuneNascita: "Italia" }, false, maps).issues.some((m) => /Nato in Italia/.test(m)));
  // estero vero: nessun errore
  assert.deepEqual(codes.resolveSchedinaCodes({ ...G, comuneNascita: "Berlin, Germany", cittadinanza: "Germany", luogoRilascio: "Germany" }, false, maps).issues, []);
});

test("#4 luogo di rilascio estero: carta d'identità / patente di un cittadino UE usa lo Stato della cittadinanza", () => {
  for (const lr of ["Stadt Berlin", "Gemeente Amsterdam", "Prefecture de Paris"]) {
    const cit = lr.includes("Berlin") ? "German" : lr.includes("Amsterdam") ? "Dutch" : "French";
    const code = lr.includes("Berlin") ? "100000216" : lr.includes("Amsterdam") ? "100000243" : "100000215";
    for (const tipoDoc of ["Carta d'identità", "Patente", "CIE"]) {
      const r = codes.resolveSchedinaCodes({ ...G, cittadinanza: cit, tipoDoc, luogoRilascio: lr }, false, maps);
      assert.equal(r.luogoRilascio, code, `${lr} / ${tipoDoc}`);
      assert.deepEqual(r.issues, [], `${lr} / ${tipoDoc}`);
    }
  }
  // un italiano con luogo sconosciuto resta da correggere
  assert.ok(codes.resolveSchedinaCodes({ ...G, luogoRilascio: "Boh" }, false, maps).issues.some((m) => /Luogo di rilascio «Boh»/.test(m)));
  // il passaporto continua a funzionare
  assert.equal(codes.resolveSchedinaCodes({ ...G, cittadinanza: "German", tipoDoc: "Passport", luogoRilascio: "Stadt Berlin" }, false, maps).luogoRilascio, "100000216");
});

test("#20 cittadinanze mancanti nella tabella reale", () => {
  const exp: [string, string][] = [["Jordan", "100000330"], ["Syria", "100000331"], ["Cambodia", "100000332"], ["North Korea", "100000333"], ["Corea del Nord", "100000333"], ["South Korea", "100000334"], ["Iran", "100000335"], ["Slovakia", "100000336"], ["Malaysia", "100000337"], ["Vatican City", "100000338"], ["Canadian", "100000339"]];
  for (const [v, c] of exp) assert.equal(codes.resolveStato(maps, v), c, v);
  // niente collisioni: "Corea" resta la Corea del Sud come prima? ("Korea" = Sud)
  assert.equal(codes.resolveStato(maps, "Korea"), "100000334");
});

// ── Merge co-ospiti / ospite principale ─────────────────────────────────────────────────────────────────────
const P = (firstName: string, lastName: string, extra: Record<string, unknown> = {}) => ({ firstName, lastName, ...extra });

test("#5 co-ospiti: Anna+Bruno poi solo Bruno → Anna resta e Bruno non si duplica", () => {
  const prev = [P("Anna", "Verdi", { docPhotoFront: "media:A" }), P("Bruno", "Neri", { docNumber: "B1", docPhotoFront: "media:B" })];
  const out = san.mergeExtraGuests(prev, [P("Bruno", "Neri", { birthDate: "1990-01-01" })]);
  assert.equal(out.length, 2);
  assert.equal(out[0].firstName, "Anna");
  assert.equal(out[0].docPhotoFront, "media:A");
  assert.equal(out[1].firstName, "Bruno");
  assert.equal(out[1].docNumber, "B1");
  assert.equal(out[1].birthDate, "1990-01-01");
  assert.equal(out[1].docPhotoFront, "media:B");
});

test("#5 co-ospiti: ordine scambiato → ognuno tiene le sue foto; refuso nel nome nella stessa posizione → stessa persona", () => {
  const prev = [P("Anna", "Verdi", { docPhotoFront: "media:A" }), P("Bruno", "Neri", { docPhotoFront: "media:B" })];
  const sw = san.mergeExtraGuests(prev, [P("Bruno", "Neri"), P("Anna", "Verdi")]);
  assert.equal(sw.length, 2);
  assert.deepEqual(sw.map((x) => [x.firstName, x.docPhotoFront]).sort(), [["Anna", "media:A"], ["Bruno", "media:B"]]);
  const typo = san.mergeExtraGuests(prev, [P("Anna", "Verdy"), P("Bruno", "Neri")]);
  assert.equal(typo[0].docPhotoFront, "media:A");
  assert.equal(typo[0].lastName, "Verdy");
});

test("#5 co-ospiti: una persona diversa nella stessa posizione sostituisce chi non è più abbinato; un nuovo in più si aggiunge", () => {
  const prev = [P("Anna", "Verdi", { docNumber: "A1" }), P("Bruno", "Neri", { docNumber: "B1" })];
  const rep = san.mergeExtraGuests(prev, [P("Carla", "Gialli"), P("Bruno", "Neri")]);
  assert.deepEqual(rep.map((x) => x.firstName), ["Carla", "Bruno"]);
  assert.equal(rep[0].docNumber, undefined); // niente dati ereditati da Anna
  const more = san.mergeExtraGuests(prev, [P("Anna", "Verdi"), P("Bruno", "Neri"), P("Dario", "Blu")]);
  assert.deepEqual(more.map((x) => x.firstName), ["Anna", "Bruno", "Dario"]);
});

test("#5 le foto di chi non è rimpiazzato restano referenziate (orphanedRefs non le cancella)", async () => {
  const { orphanedRefs, privateRefsIn } = await import("../src/lib/media-orphans.ts");
  const ref = (n: string) => `media:xenora-private:t1/${n}`;
  const prev = [P("Anna", "Verdi", { docPhotoFront: ref("a") }), P("Bruno", "Neri", { docPhotoFront: ref("b") })];
  const merged = san.mergeExtraGuests(prev, [P("Bruno", "Neri")]);
  assert.deepEqual(orphanedRefs(privateRefsIn(prev), { bookings: [{ extraGuests: merged }] }), []);
});

test("#16 principale: i campi vuoti ereditano solo se è la stessa persona", () => {
  const prev = { firstName: "Mario", lastName: "Rossi", docNumber: "AA1", birthDate: "1980-01-01", docPhotoFront: "media:X" };
  const same = san.mergePrimaryGuest(prev, { firstName: "Mario", lastName: "Rossi", docNumber: "", birthDate: undefined });
  assert.equal(same.docNumber, "AA1");
  assert.equal(same.birthDate, "1980-01-01");
  const other = san.mergePrimaryGuest(prev, { firstName: "Luca", lastName: "Bianchi", docNumber: "", birthDate: undefined });
  assert.equal(other.docNumber, "");
  assert.equal(other.birthDate, undefined);
  assert.equal((other as Record<string, unknown>).docPhotoFront, undefined);
});

test("#8 keepsCheckinFiles: check-in fatto e non annullata → i file restano", () => {
  assert.equal(san.keepsCheckinFiles({ webCheckin: true, status: "confirmed" }), true);
  assert.equal(san.keepsCheckinFiles({ webCheckin: true, status: "cancelled" }), false);
  assert.equal(san.keepsCheckinFiles({ webCheckin: false, status: "confirmed" }), false);
  assert.equal(san.keepsCheckinFiles({}), false);
});

// ── Servizio ─────────────────────────────────────────────────────────────────────────────────────────────
const base = { cognome: "Rossi", nome: "Mario", sesso: "M", dataNascita: "1980-05-17", comuneNascita: "Roma", cittadinanza: "Italiana", tipoDoc: "Carta d'identità", numeroDoc: "CA123", luogoRilascio: "Siracusa" };

test("#15 giorni di permanenza almeno 1 e data di arrivo validata", () => {
  const rec = svc.buildRecordResolved(base, "16", "2026-10-17", 0, maps);
  assert.equal(rec.slice(12, 14), "01");
  assert.equal(svc.buildRecord(base, "16", "2026-10-17", 0).slice(12, 14), "01");
  assert.deepEqual(svc.validateSchedina(base, "16", maps, "2026-10-17", "2026-10-17"), []);
  assert.ok(svc.validateSchedina(base, "16", maps, "2026-10-17", "17/10/2026").some((m) => /arrivo non valida/.test(m)));
  assert.ok(svc.validateSchedina(base, "16", maps, "2026-10-17", "2026-02-31").some((m) => /arrivo non valida/.test(m)));
});

test("#10 ordine di invio: capofamiglia (17) prima dei familiari (19) della stessa prenotazione", () => {
  const r = [
    { id: "1", arrival: "2026-10-17", booking_id: "B", ruolo: "19", guest_ref: "extra:1" },
    { id: "2", arrival: "2026-10-17", booking_id: "A", ruolo: "19", guest_ref: "extra:0" },
    { id: "3", arrival: "2026-10-17", booking_id: "B", ruolo: "17", guest_ref: "primary" },
    { id: "4", arrival: "2026-10-16", booking_id: "Z", ruolo: "16", guest_ref: "primary" },
    { id: "5", arrival: "2026-10-17", booking_id: "A", ruolo: "17", guest_ref: "primary" },
    { id: "6", arrival: "2026-10-17", booking_id: "B", ruolo: "19", guest_ref: "extra:0" },
  ];
  assert.deepEqual([...r].sort(svc.sendOrder).map((x) => x.id), ["4", "5", "2", "3", "6", "1"]);
});

// ── syncSchedine con client in memoria ──────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
function makeClient(tables: Record<string, Row[]>) {
  const t = structuredClone(tables);
  const from = (name: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "delete" | "insert" = "select";
    let payload: Row[] = [];
    const q: Record<string, unknown> = {
      select: () => q, order: () => q,
      delete: () => { mode = "delete"; return q; },
      insert: (p: Row | Row[]) => { mode = "insert"; payload = Array.isArray(p) ? p : [p]; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      range: (a: number, b: number) => { void a; void b; return q; },
      maybeSingle: async () => ({ data: (t[name] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        const rs = (t[name] ??= []);
        if (mode === "insert") { rs.push(...structuredClone(payload)); return Promise.resolve({ data: null, error: null }).then(res); }
        if (mode === "delete") { t[name] = rs.filter((r) => !filters.every((f) => f(r))); return Promise.resolve({ data: null, error: null }).then(res); }
        return Promise.resolve({ data: rs.filter((r) => filters.every((f) => f(r))).map((r) => structuredClone(r)), error: null }).then(res);
      },
    };
    return q;
  };
  return { client: { from }, tables: t };
}
const ci = addDaysYmd(todayRome(), 1), co = addDaysYmd(todayRome(), 3);
const person = (n: string, over: Record<string, unknown> = {}) => ({ firstName: n, lastName: "Rossi", sex: "M", birthDate: "1980-01-01", birthPlace: "Roma", citizenship: "Italiana", docType: "Carta d'identità", docNumber: "AA1", docPlace: "Siracusa", ...over });
const bk = (id: string, over: Record<string, unknown> = {}) => ({ id, structureId: "s1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: ci, checkOut: co, adults: 1, children: 0, webCheckin: true, primaryGuest: person("Mario"), ...over });
const blobOf = (bookings: unknown[]) => ({ app_state: [{ user_id: "t1", data: { "spigolestay:data:v1": JSON.stringify({ structures: [{ id: "s1" }], bookings, guests: [] }) } }], alloggiati_codes: all });
const sched = (id: string, booking: string, over: Row = {}) => ({ id, tenant_id: "t1", structure_id: "s1", booking_id: booking, guest_ref: "primary", stato: "pronta", arrival: ci, ...over });

test.beforeEach(() => svc.resetCodeMapsCache());

test("#11 syncSchedine con bookingId tocca SOLO quella prenotazione", async () => {
  const env = makeClient({ ...blobOf([bk("b1"), bk("b2", { primaryGuest: person("Luca") })]), alloggiati_schedine: [sched("old2", "b2", { stato: "da_validare" })] });
  await svc.syncSchedine(env.client as never, "t1", { structureId: "s1", bookingId: "b1" });
  assert.equal(env.tables.alloggiati_schedine.filter((r) => r.booking_id === "b1").length, 1);
  assert.equal(env.tables.alloggiati_schedine.filter((r) => r.booking_id === "b2").length, 1);
  assert.equal(env.tables.alloggiati_schedine.find((r) => r.booking_id === "b2")!.id, "old2"); // b2 non rigenerata
});

test("#15 arrivo e partenza lo stesso giorno → permanenza 1; nomi lunghissimi non bloccano la schedina", async () => {
  const env = makeClient({ ...blobOf([bk("b1", { checkOut: ci, primaryGuest: person("M".repeat(45), { lastName: "R".repeat(70) }) })]), alloggiati_schedine: [] });
  await svc.syncSchedine(env.client as never, "t1", {});
  const r = env.tables.alloggiati_schedine[0];
  assert.equal((r.guest as { perm: number }).perm, 1);
  assert.equal(r.stato, "pronta");
});

test("#12 una riga marcata inviata nel frattempo non viene ricreata 'pronta' (si rilegge lo stato subito prima di rigenerare)", async () => {
  const env = makeClient({ ...blobOf([bk("b1")]), alloggiati_schedine: [sched("s-sent", "b1", { stato: "inviata" })] });
  await svc.syncSchedine(env.client as never, "t1", {});
  const rs = env.tables.alloggiati_schedine.filter((r) => r.booking_id === "b1");
  assert.equal(rs.length, 1);
  assert.equal(rs[0].stato, "inviata");
});
