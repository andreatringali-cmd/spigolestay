import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/alias-loader.mjs", import.meta.url);
const codes = await import("../src/lib/alloggiati/codes.ts");
const svc = await import("../src/lib/alloggiati/service.ts");
const { norm } = codes;

// Tabella codici FINTA (stesso formato della cache alloggiati_codes): stati senza provincia, comuni con provincia.
type L = { code: string; name: string; prov?: string };
const LUOGHI: L[] = [
  { code: "100000100", name: "ITALIA" }, { code: "100000216", name: "GERMANIA" }, { code: "100000215", name: "FRANCIA" },
  { code: "100000204", name: "REGNO UNITO" }, { code: "100000536", name: "STATI UNITI D'AMERICA" }, { code: "100000245", name: "SPAGNA" },
  { code: "100000214", name: "SVIZZERA" }, { code: "100000246", name: "RUSSIA" }, { code: "100000243", name: "PAESI BASSI" },
  { code: "100000299", name: "REPUBBLICA CECA" },
  { code: "405089017", name: "SIRACUSA", prov: "SR" }, { code: "405058091", name: "ROMA", prov: "RM" },
  { code: "405015146", name: "MILANO", prov: "MI" }, { code: "405087015", name: "CASTRO", prov: "LE" }, { code: "405088001", name: "CASTRO", prov: "BG" },
  { code: "405082053", name: "PALERMO", prov: "PA" }, { code: "405066049", name: "L'AQUILA", prov: "AQ" }, { code: "405054039", name: "CITTA DI CASTELLO", prov: "PG" },
];
const DOCS = [{ code: "IDENT", name: "CARTA IDENTITA'" }, { code: "IDELE", name: "CARTA IDENTITA' ELETTRONICA" }, { code: "PASOR", name: "PASSAPORTO ORDINARIO" }, { code: "PATEN", name: "PATENTE DI GUIDA" }, { code: "PERSO", name: "PERMESSO DI SOGGIORNO" }];

function makeMaps() {
  const codeSet = new Set<string>(); const byName = new Map<string, { code: string; provincia: string | null; is_comune: boolean }[]>();
  const byCode = new Map<string, { provincia: string | null; is_comune: boolean }>(); const docByName = new Map<string, string>();
  for (const l of LUOGHI) {
    codeSet.add(l.code);
    const k = norm(l.name); const arr = byName.get(k) ?? []; arr.push({ code: l.code, provincia: l.prov ?? null, is_comune: !!l.prov }); byName.set(k, arr);
    byCode.set(l.code, { provincia: l.prov ?? null, is_comune: !!l.prov });
  }
  for (const d of DOCS) { codeSet.add(d.code); docByName.set(norm(d.name), d.code); }
  return { hasData: true, codeSet, byName, byCode, docByName };
}
const maps = makeMaps();

test("cittadinanza: nomi inglesi, ISO, demonimi e italiano si risolvono nello stesso Stato", () => {
  for (const v of ["Germany", "germany", "DEUTSCHLAND", "DE", "DEU", "German", "tedesca", "Germania"]) assert.equal(codes.resolveStato(maps, v), "100000216", v);
  for (const v of ["Italy", "Italia", "IT", "ITA", "Italian", "italiana", "Repubblica Italiana"]) assert.equal(codes.resolveStato(maps, v), "100000100", v);
  for (const v of ["USA", "U.S.A.", "United States", "United States of America", "American", "US", "Stati Uniti"]) assert.equal(codes.resolveStato(maps, v), "100000536", v);
  for (const v of ["UK", "United Kingdom", "British", "GB", "England", "Great Britain"]) assert.equal(codes.resolveStato(maps, v), "100000204", v);
  assert.equal(codes.resolveStato(maps, "Czech Republic"), "100000299");
  assert.equal(codes.resolveStato(maps, "Federazione Russa"), "100000246"); // nome alternativo: cerca "Russia"
  assert.equal(codes.resolveStato(maps, "100000216"), "100000216"); // già un codice
});

test("cittadinanza: un comune NON è uno Stato, e valori senza senso non si risolvono", () => {
  assert.equal(codes.resolveStato(maps, "Roma"), null);
  assert.equal(codes.resolveStato(maps, "Atlantide"), null);
  assert.equal(codes.resolveStato(maps, ""), null);
});

test("luogo di rilascio: Comune di / Questura di / (SR) / sigla", () => {
  for (const v of ["Siracusa", "Comune di Siracusa", "COMUNE DI SIRACUSA", "Questura di Siracusa", "Siracusa (SR)", "Siracusa SR", "Siracusa, SR", "SR", "Prefettura di Siracusa"]) {
    assert.equal(codes.resolveLuogo(maps, v), "405089017", v);
  }
  assert.equal(codes.resolveLuogo(maps, "Città di Castello"), "405054039"); // il nome esatto vince sul prefisso
  assert.equal(codes.resolveLuogo(maps, "L'Aquila"), "405066049");
  assert.equal(codes.resolveLuogo(maps, "Germany"), "100000216"); // documento estero: lo Stato
  assert.equal(codes.resolveLuogo(maps, "PA"), "405082053"); // PA = Palermo (non Panama) in contesto comune
});

test("omonimi: la provincia aiuta, senza provincia è ambiguo", () => {
  assert.equal(codes.resolvePlace(maps, "Castro (LE)", { mode: "comune" })?.code, "405087015");
  assert.equal(codes.resolvePlace(maps, "Castro BG", { mode: "comune" })?.code, "405088001");
  assert.equal(codes.resolvePlace(maps, "Castro", { provincia: "LE", mode: "comune" })?.code, "405087015");
  assert.equal(codes.resolvePlace(maps, "Castro", { mode: "comune" })?.ambiguous, true);
  assert.equal(codes.resolvePlace(maps, "Siracusa", { mode: "comune" })?.ambiguous, false);
});

test("tipo documento: alias inglesi e nome parziale", () => {
  assert.equal(codes.resolveDocumento(maps, "Carta d'identità"), "IDENT");
  assert.equal(codes.resolveDocumento(maps, "Passport"), "PASOR");
  assert.equal(codes.resolveDocumento(maps, "Passaporto"), "PASOR");
  assert.equal(codes.resolveDocumento(maps, "Permesso di soggiorno"), "PERSO");
  assert.equal(codes.resolveDocumento(maps, "Tessera del club"), null);
});

const base = { cognome: "Rossi", nome: "Mario", sesso: "M", dataNascita: "1980-05-17", comuneNascita: "Roma", citizenship: "", cittadinanza: "Italiana", tipoDoc: "Carta d'identità", numeroDoc: "CA123", luogoRilascio: "Comune di Siracusa" };

test("validateSchedina con la tabella: ogni campo non risolto è un errore", () => {
  assert.deepEqual(svc.validateSchedina(base, "16", maps, "2026-10-17"), []);
  const e1 = svc.validateSchedina({ ...base, cittadinanza: "Atlantis" }, "16", maps, "2026-10-17");
  assert.ok(e1.some((m) => /Cittadinanza «Atlantis» non riconosciuta/.test(m)), e1.join("|"));
  const e2 = svc.validateSchedina({ ...base, luogoRilascio: "Ministero dell'Interno" }, "16", maps, "2026-10-17");
  assert.ok(e2.some((m) => /Luogo di rilascio/.test(m)), e2.join("|"));
  const e3 = svc.validateSchedina({ ...base, comuneNascita: "Gotham" }, "16", maps, "2026-10-17");
  assert.ok(e3.some((m) => /Luogo di nascita «Gotham»/.test(m)), e3.join("|"));
  const e4 = svc.validateSchedina({ ...base, tipoDoc: "Tessera del club" }, "16", maps, "2026-10-17");
  assert.ok(e4.some((m) => /Tipo documento/.test(m)), e4.join("|"));
  // senza tabella (non ancora scaricata) il controllo dei codici si salta
  assert.deepEqual(svc.validateSchedina({ ...base, cittadinanza: "Atlantis" }, "16", null, "2026-10-17"), []);
});

test("familiari (ruolo 19): il documento non serve e non viene controllato", () => {
  assert.deepEqual(svc.validateSchedina({ ...base, tipoDoc: "", numeroDoc: "", luogoRilascio: "" }, "19", maps, "2026-10-17"), []);
  assert.ok(svc.validateSchedina({ ...base, tipoDoc: "", numeroDoc: "", luogoRilascio: "" }, "17", maps, "2026-10-17").length >= 3);
});

test("validateSchedina: sesso M/F, data valida e non futura, nomi troppo lunghi", () => {
  assert.ok(svc.validateSchedina({ ...base, sesso: "X" }, "16", maps, "2026-10-17").some((m) => /Sesso non valido/.test(m)));
  assert.ok(svc.validateSchedina({ ...base, dataNascita: "2030-01-01" }, "16", maps, "2026-10-17").some((m) => /futuro/.test(m)));
  assert.ok(svc.validateSchedina({ ...base, dataNascita: "31/12/1990" }, "16", maps, "2026-10-17").some((m) => /non valida/.test(m)));
  assert.ok(svc.validateSchedina({ ...base, dataNascita: "1990-02-31" }, "16", maps, "2026-10-17").some((m) => /non valida/.test(m)));
  // Nomi oltre 30/50 caratteri: NON bloccano più la schedina, si troncano nel tracciato.
  assert.deepEqual(svc.validateSchedina({ ...base, nome: "A".repeat(31) }, "16", maps, "2026-10-17"), []);
  assert.deepEqual(svc.validateSchedina({ ...base, cognome: "B".repeat(51) }, "16", maps, "2026-10-17"), []);
  const longRec = svc.buildRecordResolved({ ...base, nome: "A".repeat(40), cognome: "B".repeat(60) }, "16", "2026-10-17", 2, maps);
  assert.equal(longRec.length, 168);
  assert.equal(longRec.slice(14, 64), "B".repeat(50));
  assert.equal(longRec.slice(64, 94), "A".repeat(30));
  assert.ok(svc.validateSchedina({ ...base, nome: "1234" }, "16", maps, "2026-10-17").some((m) => /Nome non valido/.test(m)));
});

test("tracciato: 168 caratteri, codici al posto giusto, nomi senza accenti", () => {
  const rec = svc.buildRecordResolved({ ...base, cognome: "D'Ángelo-Müller", nome: "José  María" }, "16", "2026-10-17", 3, maps);
  assert.equal(rec.length, 168);
  assert.equal(rec.slice(0, 2), "16");
  assert.equal(rec.slice(2, 12), "17/10/2026");
  assert.equal(rec.slice(12, 14), "03");
  assert.equal(rec.slice(14, 64).trimEnd(), "D'ANGELO MULLER");
  assert.equal(rec.slice(64, 94).trimEnd(), "JOSE MARIA");
  assert.equal(rec.slice(94, 95), "1");
  assert.equal(rec.slice(95, 105), "17/05/1980");
  assert.equal(rec.slice(105, 114), "405058091"); // Roma
  assert.equal(rec.slice(114, 116), "RM");
  assert.equal(rec.slice(116, 125), "100000100"); // Italia
  assert.equal(rec.slice(125, 134), "100000100"); // cittadinanza "Italiana"
  assert.equal(rec.slice(134, 139), "IDENT");
  assert.equal(rec.slice(139, 159).trimEnd(), "CA123");
  assert.equal(rec.slice(159, 168), "405089017"); // Comune di Siracusa
});

test("tracciato: cittadino tedesco nato all'estero, passaporto con luogo non risolvibile", () => {
  const g = { cognome: "Schmidt", nome: "Anna", sesso: "F", dataNascita: "1990-01-02", comuneNascita: "Berlin, Germany", cittadinanza: "German", tipoDoc: "Passport", numeroDoc: "C01 234", luogoRilascio: "Berlin" };
  assert.deepEqual(svc.validateSchedina(g, "16", maps, "2026-10-17"), []);
  const rec = svc.buildRecordResolved(g, "16", "2026-10-17", 2, maps);
  assert.equal(rec.slice(105, 114).trim(), ""); // niente comune
  assert.equal(rec.slice(114, 116).trim(), "");
  assert.equal(rec.slice(116, 125), "100000216");
  assert.equal(rec.slice(125, 134), "100000216");
  assert.equal(rec.slice(134, 139), "PASOR");
  assert.equal(rec.slice(139, 159).trimEnd(), "C01234");
  assert.equal(rec.slice(159, 168), "100000216"); // passaporto: Stato di cittadinanza
});

test("data non valida nel tracciato: spazi, non un valore a caso", () => {
  const rec = svc.buildRecordResolved({ ...base, dataNascita: "boh" }, "16", "2026-10-17", 1, maps);
  assert.equal(rec.slice(95, 105), " ".repeat(10));
});

test("evalSend: serve l'esito generale E quello della riga", () => {
  assert.deepEqual(svc.evalSend(true, [{ esito: true }, { esito: false }], 2), [true, false]);
  assert.deepEqual(svc.evalSend(false, [{ esito: true }, { esito: true }], 2), [false, false]); // invio rifiutato: niente "inviata"
  assert.deepEqual(svc.evalSend(true, [], 2), [true, true]); // il portale non ha dato il dettaglio: vale l'esito generale
  assert.deepEqual(svc.evalSend(true, [{ esito: true }], 2), [true, false]); // dettaglio incompleto: la riga non confermata non è inviata
});

test("sendableRows: una famiglia parte intera o per niente", () => {
  const rows = [{ id: "a1", booking_id: "A" }, { id: "a2", booking_id: "A" }, { id: "b1", booking_id: "B" }, { id: "c1", booking_id: "C" }, { id: "x", booking_id: null }];
  // C ha altre righe da correggere; la riga a2 di A è da correggere → A e C restano fermi, partono B e la riga senza prenotazione
  const r = svc.sendableRows(rows, ["C"], ["a2"]);
  assert.deepEqual(r.send.map((x) => x.id), ["b1", "x"]);
  assert.deepEqual(r.held.map((x) => x.id), ["a1", "a2", "c1"]);
});

test("portalErrors: motivo del portale in errors, riconoscibile", () => {
  const e = svc.portalErrors({ errorDes: "Data di nascita errata", errorDettaglio: "Campo 95" });
  assert.equal(e[0], "Portale: Data di nascita errata");
  assert.equal(e[1], "Campo 95");
  assert.equal(svc.isPortalRejection(e), true);
  assert.equal(svc.isPortalRejection(["Cognome mancante"]), false);
  assert.equal(svc.portalErrors(undefined)[0], "Portale: schedina rifiutata");
});

test("stableJson ignora l'ordine delle chiavi (jsonb le riordina)", () => {
  assert.equal(svc.stableJson({ a: 1, b: { c: 2, d: 3 } }), svc.stableJson({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(svc.stableJson({ a: 1 }), svc.stableJson({ a: 2 }));
});

// ── syncSchedine end-to-end con un client Supabase in memoria ─────────────────────────────────────────
const { todayRome, addDaysYmd } = await import("../src/lib/dates-rome.ts");
type Row = Record<string, unknown>;
function makeClient(tables: Record<string, Row[]>) {
  const t = structuredClone(tables);
  const from = (name: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "delete" | "insert" = "select";
    let payload: Row[] = [];
    let slice: [number, number] | null = null;
    const q: Record<string, unknown> = {
      select: () => q,
      delete: () => { mode = "delete"; return q; },
      insert: (p: Row | Row[]) => { mode = "insert"; payload = Array.isArray(p) ? p : [p]; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      range: (a: number, b: number) => { slice = [a, b]; return q; },
      maybeSingle: async () => ({ data: (t[name] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        const rows = (t[name] ??= []);
        if (mode === "insert") { rows.push(...structuredClone(payload)); return Promise.resolve({ data: null, error: null }).then(res); }
        if (mode === "delete") { t[name] = rows.filter((r) => !filters.every((f) => f(r))); return Promise.resolve({ data: null, error: null }).then(res); }
        let out = rows.filter((r) => filters.every((f) => f(r))).map((r) => structuredClone(r));
        if (slice) out = out.slice(slice[0], slice[1] + 1);
        return Promise.resolve({ data: out, error: null }).then(res);
      },
    };
    return q;
  };
  return { client: { from }, tables: t };
}
const codeRows: Row[] = [
  ...LUOGHI.map((l) => ({ kind: "luoghi", code: l.code, name_norm: norm(l.name), provincia: l.prov ?? null, is_comune: !!l.prov })),
  ...DOCS.map((d) => ({ kind: "documenti", code: d.code, name_norm: norm(d.name), provincia: null, is_comune: false })),
];
const person = (n: string, over: Record<string, unknown> = {}) => ({ firstName: n, lastName: "Rossi", sex: "M", birthDate: "1980-01-01", birthPlace: "Roma", citizenship: "Italiana", docType: "Carta d'identità", docNumber: "AA1", docPlace: "Comune di Siracusa", ...over });
const blobOf = (bookings: unknown[]) => ({ app_state: [{ user_id: "t1", data: { "spigolestay:data:v1": JSON.stringify({ structures: [{ id: "s1" }], bookings, guests: [] }) } }] });
const ci = addDaysYmd(todayRome(), 1), co = addDaysYmd(todayRome(), 3);
const bk = (over: Record<string, unknown>) => ({ id: "b1", structureId: "s1", guestId: "g1", status: "confirmed", channel: "direct", checkIn: ci, checkOut: co, adults: 1, children: 0, webCheckin: true, ...over });

test.beforeEach(() => svc.resetCodeMapsCache());

test("syncSchedine: cittadinanza o luogo di rilascio non risolti → da_validare con il motivo", async () => {
  const { client, tables } = makeClient({ ...blobOf([bk({ primaryGuest: person("Mario", { citizenship: "Atlantis", docPlace: "Boh" }) })]), alloggiati_codes: codeRows, alloggiati_schedine: [] });
  await svc.syncSchedine(client as never, "t1", {});
  const r = tables.alloggiati_schedine[0];
  assert.equal(r.stato, "da_validare");
  assert.ok((r.errors as string[]).some((m) => /Cittadinanza «Atlantis»/.test(m)));
  assert.ok((r.errors as string[]).some((m) => /Luogo di rilascio «Boh»/.test(m)));
});

test("syncSchedine: 'Germany', 'Comune di Siracusa' si risolvono → pronta", async () => {
  const { client, tables } = makeClient({ ...blobOf([bk({ primaryGuest: person("Mario", { citizenship: "Germany", birthPlace: "Berlin, Germany", docPlace: "Questura di Siracusa" }) })]), alloggiati_codes: codeRows, alloggiati_schedine: [] });
  await svc.syncSchedine(client as never, "t1", {});
  assert.equal(tables.alloggiati_schedine[0].stato, "pronta");
});

test("syncSchedine: senza tabelle dei codici il controllo sui codici si salta (nessun blocco)", async () => {
  const { client, tables } = makeClient({ ...blobOf([bk({ primaryGuest: person("Mario", { citizenship: "Atlantis" }) })]), alloggiati_schedine: [] });
  await svc.syncSchedine(client as never, "t1", {});
  assert.equal(tables.alloggiati_schedine[0].stato, "pronta");
});

test("syncSchedine: senza check-in (anche se la scheda ospite ha dati vecchi) non nasce nessuna schedina", async () => {
  const blob = { structures: [{ id: "s1" }], bookings: [bk({ webCheckin: false, primaryGuest: undefined })], guests: [{ id: "g1", ...person("Vecchio") }] };
  const { client, tables } = makeClient({ app_state: [{ user_id: "t1", data: { "spigolestay:data:v1": JSON.stringify(blob) } }], alloggiati_codes: codeRows, alloggiati_schedine: [{ id: "old", tenant_id: "t1", structure_id: "s1", booking_id: "b1", guest_ref: "primary", stato: "pronta", arrival: ci }] });
  await svc.syncSchedine(client as never, "t1", {});
  assert.equal(tables.alloggiati_schedine.length, 0); // anche la vecchia riga "pronta" generata dal dato vecchio sparisce
});

test("syncSchedine: un rifiuto del portale sugli STESSI dati resta; se i dati cambiano si rigenera", async () => {
  const p = person("Mario");
  const guest = { cognome: "Rossi", nome: "Mario", sesso: "M", dataNascita: "1980-01-01", comuneNascita: "Roma", provinciaNascita: undefined, statoNascita: undefined, cittadinanza: "Italiana", tipoDoc: "Carta d'identità", numeroDoc: "AA1", luogoRilascio: "Comune di Siracusa", perm: 2 };
  const rej = { id: "r1", tenant_id: "t1", structure_id: "s1", booking_id: "b1", guest_ref: "primary", stato: "da_validare", arrival: ci, guest, errors: ["Portale: Data errata"] };
  let env = makeClient({ ...blobOf([bk({ primaryGuest: p })]), alloggiati_codes: codeRows, alloggiati_schedine: [rej] });
  await svc.syncSchedine(env.client as never, "t1", {});
  assert.equal(env.tables.alloggiati_schedine[0].stato, "da_validare");
  assert.equal((env.tables.alloggiati_schedine[0].errors as string[])[0], "Portale: Data errata");
  env = makeClient({ ...blobOf([bk({ primaryGuest: person("Mario", { birthDate: "1981-01-01" }) })]), alloggiati_codes: codeRows, alloggiati_schedine: [rej] });
  await svc.syncSchedine(env.client as never, "t1", {});
  assert.equal(env.tables.alloggiati_schedine[0].stato, "pronta"); // dati corretti dall'operatore: si riprova
});

test("tabella REALE: gli Stati hanno provincia 'ES', codice 100000xxx e is_comune=true nel DB → devono comunque risolversi come Stato", async () => {
  const rows = [
    { kind: "luoghi", code: "100000100", name_norm: "ITALIA", provincia: "ES", is_comune: true },
    { kind: "luoghi", code: "100000216", name_norm: "GERMANIA", provincia: "ES", is_comune: true },
    { kind: "luoghi", code: "100000536", name_norm: "STATI UNITI D AMERICA", provincia: "ES", is_comune: true },
    { kind: "luoghi", code: "405089017", name_norm: "SIRACUSA", provincia: "SR", is_comune: true },
  ];
  const admin = { from: () => ({ select: () => ({ range: async (a: number) => ({ data: a === 0 ? rows : [], error: null }) }) }) };
  const real = await codes.loadCodeMaps(admin as never);
  assert.equal(codes.resolveStato(real, "Germany"), "100000216");
  assert.equal(codes.resolveStato(real, "Italia"), "100000100");
  assert.equal(codes.resolveStato(real, "USA"), "100000536");
  assert.equal(codes.resolveStato(real, "Siracusa"), null, "un comune non è uno Stato");
  assert.equal(codes.isComuneProv("ES"), false);
  assert.equal(codes.isComuneProv("SR"), true);
});
