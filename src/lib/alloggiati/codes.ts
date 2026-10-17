// Tabelle di codifica Alloggiati Web (Luoghi = comuni + stati, Tipi_Documento).
// Scaricate dal web service (metodo Tabella, CSV separato da ';') e messe in cache
// nella tabella alloggiati_codes. Servono per tradurre i dati testuali dell'ospite
// (comune/stato di nascita, cittadinanza, tipo documento, luogo rilascio) nei
// CODICI ufficiali richiesti dal tracciato a 168 caratteri.
import type { SupabaseClient } from "@supabase/supabase-js";
import { tabella } from "./soap";
import { countryNames } from "./countries";

// Normalizza per il matching: maiuscolo, senza accenti, spazi compattati.
/** Un luogo è un comune italiano se ha una sigla di provincia diversa da "ES" (estero). */
export const isComuneProv = (prov: string | null | undefined): boolean => !!prov && String(prov).trim().toUpperCase() !== "ES";

export function norm(s: string | undefined | null): string {
  return (s ?? "")
    .toString()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parser CSV minimale (una riga = un record; separatore ';'; nessun campo quotato
// nelle tabelle Alloggiati). Ritorna header + righe.
function parseCsv(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split(";").map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(";"));
  return { header, rows };
}

// Individua l'indice di colonna il cui header contiene una delle chiavi.
function colIdx(header: string[], keys: string[], fallback: number): number {
  const H = header.map((h) => norm(h));
  for (const k of keys) { const i = H.findIndex((h) => h.includes(norm(k))); if (i >= 0) return i; }
  return fallback;
}

export interface SyncResult { luoghi: number; documenti: number }

// Scarica e memorizza Luoghi e Tipi_Documento. Idempotente (upsert su kind+code).
export async function syncTables(admin: SupabaseClient, utente: string, token: string): Promise<SyncResult> {
  const out: SyncResult = { luoghi: 0, documenti: 0 };

  // --- Luoghi (comuni + stati) ---
  const luo = await tabella(utente, token, "Luoghi");
  if (luo.result.esito) {
    const { header, rows } = parseCsv(luo.csv);
    const ci = colIdx(header, ["codice", "cod"], 0);
    const ni = colIdx(header, ["descrizione", "denominazione", "comune", "nome"], 1);
    const pi = colIdx(header, ["provincia", "prov", "sigla"], 2);
    const recs = rows.map((r) => {
      const code = (r[ci] ?? "").trim();
      const name = (r[ni] ?? "").trim();
      const prov = (r[pi] ?? "").trim();
      return { kind: "luoghi", code, name, name_norm: norm(name), provincia: prov || null, is_comune: isComuneProv(prov), synced_at: new Date().toISOString() };
    }).filter((r) => r.code && r.name);
    for (let i = 0; i < recs.length; i += 500) {
      const { error } = await admin.from("alloggiati_codes").upsert(recs.slice(i, i + 500), { onConflict: "kind,code" });
      if (!error) out.luoghi += Math.min(500, recs.length - i);
    }
  }

  // --- Tipi_Documento ---
  const doc = await tabella(utente, token, "Tipi_Documento");
  if (doc.result.esito) {
    const { header, rows } = parseCsv(doc.csv);
    const ci = colIdx(header, ["codice", "cod"], 0);
    const ni = colIdx(header, ["descrizione", "denominazione", "nome"], 1);
    const recs = rows.map((r) => {
      const code = (r[ci] ?? "").trim();
      const name = (r[ni] ?? "").trim();
      return { kind: "documenti", code, name, name_norm: norm(name), provincia: null, is_comune: false, synced_at: new Date().toISOString() };
    }).filter((r) => r.code && r.name);
    for (let i = 0; i < recs.length; i += 500) {
      const { error } = await admin.from("alloggiati_codes").upsert(recs.slice(i, i + 500), { onConflict: "kind,code" });
      if (!error) out.documenti += Math.min(500, recs.length - i);
    }
  }

  return out;
}

export interface CodeMaps {
  hasData: boolean;
  codeSet: Set<string>;                 // tutti i codici validi (per riconoscere valori già in codice)
  byName: Map<string, { code: string; provincia: string | null; is_comune: boolean }[]>; // luoghi per nome norm
  byCode?: Map<string, { provincia: string | null; is_comune: boolean }>; // luoghi per codice
  docByName: Map<string, string>;       // documenti per nome norm
}

// Carica in memoria le mappe per la risoluzione (una volta per operazione di invio).
export async function loadCodeMaps(admin: SupabaseClient): Promise<CodeMaps> {
  const codeSet = new Set<string>();
  const byName = new Map<string, { code: string; provincia: string | null; is_comune: boolean }[]>();
  const docByName = new Map<string, string>();
  const byCode = new Map<string, { provincia: string | null; is_comune: boolean }>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from("alloggiati_codes").select("kind, code, name_norm, provincia, is_comune").range(from, from + pageSize - 1);
    if (error || !data || !data.length) break;
    for (const r of data as { kind: string; code: string; name_norm: string; provincia: string | null; is_comune: boolean }[]) {
      codeSet.add(r.code);
      if (r.kind === "luoghi") {
        // Nella tabella ufficiale gli STATI hanno provincia "ES" (estero) e codici 100000xxx: non sono comuni (le righe già salvate hanno is_comune=true).
        const isCom = isComuneProv(r.provincia) && !r.code.startsWith("100000");
        const arr = byName.get(r.name_norm) ?? [];
        arr.push({ code: r.code, provincia: r.provincia, is_comune: isCom });
        byName.set(r.name_norm, arr);
        byCode.set(r.code, { provincia: r.provincia, is_comune: isCom });
      } else if (r.kind === "documenti") {
        if (!docByName.has(r.name_norm)) docByName.set(r.name_norm, r.code);
      }
    }
    if (data.length < pageSize) break;
  }
  return { hasData: codeSet.size > 0, codeSet, byName, byCode, docByName };
}

// Sigla provincia → comune capoluogo. Gli utenti (o l'AI dal documento) scrivono spesso
// la SIGLA (es. "SR") nel "Luogo di rilascio", ma il tracciato vuole il COMUNE: qui la
// sigla viene tradotta nel capoluogo (es. SR → SIRACUSA) prima della ricerca per nome.
const PROVINCE_CAPITAL: Record<string, string> = {
  AG: "AGRIGENTO", AL: "ALESSANDRIA", AN: "ANCONA", AO: "AOSTA", AP: "ASCOLI PICENO", AQ: "L AQUILA", AR: "AREZZO", AT: "ASTI", AV: "AVELLINO",
  BA: "BARI", BG: "BERGAMO", BI: "BIELLA", BL: "BELLUNO", BN: "BENEVENTO", BO: "BOLOGNA", BR: "BRINDISI", BS: "BRESCIA", BT: "BARLETTA", BZ: "BOLZANO",
  CA: "CAGLIARI", CB: "CAMPOBASSO", CE: "CASERTA", CH: "CHIETI", CL: "CALTANISSETTA", CN: "CUNEO", CO: "COMO", CR: "CREMONA", CS: "COSENZA", CT: "CATANIA", CZ: "CATANZARO",
  EN: "ENNA", FC: "FORLI", FE: "FERRARA", FG: "FOGGIA", FI: "FIRENZE", FM: "FERMO", FR: "FROSINONE",
  GE: "GENOVA", GO: "GORIZIA", GR: "GROSSETO", IM: "IMPERIA", IS: "ISERNIA", KR: "CROTONE",
  LC: "LECCO", LE: "LECCE", LI: "LIVORNO", LO: "LODI", LT: "LATINA", LU: "LUCCA",
  MB: "MONZA", MC: "MACERATA", ME: "MESSINA", MI: "MILANO", MN: "MANTOVA", MO: "MODENA", MS: "MASSA", MT: "MATERA",
  NA: "NAPOLI", NO: "NOVARA", NU: "NUORO", OR: "ORISTANO", PA: "PALERMO", PC: "PIACENZA", PD: "PADOVA", PE: "PESCARA", PG: "PERUGIA", PI: "PISA",
  PN: "PORDENONE", PO: "PRATO", PR: "PARMA", PT: "PISTOIA", PU: "PESARO", PV: "PAVIA", PZ: "POTENZA",
  RA: "RAVENNA", RC: "REGGIO DI CALABRIA", RE: "REGGIO NELL EMILIA", RG: "RAGUSA", RI: "RIETI", RM: "ROMA", RN: "RIMINI", RO: "ROVIGO",
  SA: "SALERNO", SI: "SIENA", SO: "SONDRIO", SP: "LA SPEZIA", SR: "SIRACUSA", SS: "SASSARI", SU: "CARBONIA", SV: "SAVONA",
  TA: "TARANTO", TE: "TERAMO", TN: "TRENTO", TO: "TORINO", TP: "TRAPANI", TR: "TERNI", TS: "TRIESTE", TV: "TREVISO",
  UD: "UDINE", VA: "VARESE", VB: "VERBANIA", VC: "VERCELLI", VE: "VENEZIA", VI: "VICENZA", VR: "VERONA", VT: "VITERBO", VV: "VIBO VALENTIA",
};

export interface PlaceHit { code: string; provincia: string | null; isComune: boolean; /** più luoghi omonimi in province diverse e nessuna provincia per scegliere: il codice è un'ipotesi */ ambiguous: boolean }
type NameHit = { code: string; provincia: string | null; is_comune: boolean };

// Se il valore è una sigla di provincia (es. "SR"), ritorna il comune capoluogo.
function fromSigla(maps: CodeMaps, nv: string): PlaceHit | null {
  if (nv.length !== 2 || !PROVINCE_CAPITAL[nv]) return null;
  const cap = maps.byName.get(norm(PROVINCE_CAPITAL[nv]));
  if (!cap || !cap.length) return null;
  const c = cap.find((h) => h.is_comune && norm(h.provincia) === nv) ?? cap.find((h) => h.is_comune) ?? cap[0];
  return { code: c.code, provincia: c.provincia, isComune: c.is_comune, ambiguous: false };
}

// Prefissi "burocratici" che gli ospiti (o i documenti) aggiungono al luogo: "Comune di Siracusa", "Questura di Siracusa"…
const PLACE_PREFIX = /^(?:COMUNE|CITTA|MUNICIPIO|QUESTURA|PREFETTURA|MOTORIZZAZIONE CIVILE|MCTC|UFFICIO ANAGRAFE|ANAGRAFE|POLIZIA DI STATO|COMMISSARIATO|CITY|TOWN|MUNICIPALITY|COMMUNE|VILLE|STADT|GEMEINDE)(?: (?:DI|DEL|DELLA|DELLO|DEI|DEGLI|D|DE|DE LA|OF))? /;
export function stripPlacePrefix(n: string): string {
  let cur = n;
  for (let i = 0; i < 2; i++) { const m = cur.match(PLACE_PREFIX); if (!m) break; cur = cur.slice(m[0].length).trim(); }
  return cur;
}

/**
 * Forme in cui può essere scritto un luogo, dalla più precisa: toglie "Comune di/Questura di…", la sigla di provincia tra parentesi
 * o in coda ("Siracusa (SR)", "Siracusa SR", "Siracusa, SR") e separa "Berlin, Germany" nei suoi pezzi. La sigla serve da aiuto per gli omonimi.
 */
export function placeVariants(raw: string): { name: string; prov?: string }[] {
  const out: { name: string; prov?: string }[] = [];
  const push = (name: string, prov?: string) => { const n = name.trim(); if (n && !out.some((o) => o.name === n && o.prov === prov)) out.push({ name: n, prov }); };
  let prov: string | undefined;
  const par = raw.match(/\(([^)]*)\)/);
  if (par) { const inner = norm(par[1]); if (/^[A-Z]{2}$/.test(inner)) prov = inner; }
  const base = raw.replace(/\([^)]*\)/g, " ");
  const pieces = base.split(/[,;/]|\s[-–]\s/).map(norm).filter(Boolean);
  const cands = [norm(base), ...pieces];
  for (const c of cands) {
    push(c, prov);
    const st = stripPlacePrefix(c);
    if (st !== c) push(st, prov);
    for (const x of st !== c ? [c, st] : [c]) {
      const t = x.split(" ");
      const last = t[t.length - 1];
      if (t.length >= 2 && /^[A-Z]{2}$/.test(last) && PROVINCE_CAPITAL[last]) {
        const nm = t.slice(0, -1).join(" ");
        push(nm, prov ?? last);
        const st2 = stripPlacePrefix(nm);
        if (st2 !== nm) push(st2, prov ?? last);
      }
    }
  }
  push(norm(raw));
  return out;
}

function pick(pool0: NameHit[], prov: string | undefined, mode: "comune" | "stato" | "any"): PlaceHit | null {
  let pool = pool0;
  if (mode === "comune") { const c = pool.filter((h) => h.is_comune); if (c.length) pool = c; }
  else if (mode === "stato") { pool = pool.filter((h) => !h.is_comune); if (!pool.length) return null; }
  const mk = (h: NameHit, ambiguous: boolean): PlaceHit => ({ code: h.code, provincia: h.provincia, isComune: h.is_comune, ambiguous });
  if (pool.length === 1) return mk(pool[0], false);
  if (prov) { const f = pool.find((h) => norm(h.provincia) === prov); if (f) return mk(f, false); }
  const provs = new Set(pool.map((h) => norm(h.provincia)));
  return mk(pool[0], provs.size > 1); // omonimi nella stessa provincia: stesso luogo, vale il primo
}

/**
 * Risolve un luogo (comune o Stato) scritto liberamente in un codice della tabella.
 * mode "comune": preferisce i comuni (nascita); "stato": SOLO Stati, ammette sinonimi inglesi, demonimi e codici ISO (cittadinanza);
 * "any": comune o Stato (luogo di rilascio del documento).
 */
export function resolvePlace(maps: CodeMaps, value: string | undefined, opts: { provincia?: string; mode?: "comune" | "stato" | "any" } = {}): PlaceHit | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const mode = opts.mode ?? "any";
  const hint = norm(opts.provincia) || undefined;
  if (maps.codeSet.has(v)) { const bc = maps.byCode?.get(v); return { code: v, provincia: bc?.provincia ?? (opts.provincia?.trim() || null), isComune: bc ? bc.is_comune : !!opts.provincia?.trim(), ambiguous: false }; }
  for (const variant of placeVariants(v)) {
    const prov = variant.prov ?? hint;
    const hits = maps.byName.get(variant.name);
    if (hits && hits.length) { const r = pick(hits, prov, mode); if (r) return r; }
    if (mode !== "stato") { const s = fromSigla(maps, variant.name); if (s) return s; }
    if (mode !== "comune") {
      const names = countryNames(variant.name, mode === "stato");
      if (names) for (const nm of names) { const h = maps.byName.get(nm); if (h && h.length) { const r = pick(h, undefined, "stato"); if (r) return r; } }
    }
  }
  return null;
}

// Risolve un luogo (comune o stato) in codice. Se `value` è già un codice valido lo mantiene.
export function resolveLuogo(maps: CodeMaps, value: string | undefined, provincia?: string): string | null {
  return resolvePlace(maps, value, { provincia, mode: "any" })?.code ?? null;
}

// Cittadinanza / Stato di nascita: SOLO uno Stato ("Germany", "Deutschland", "DE", "tedesca" → GERMANIA).
export function resolveStato(maps: CodeMaps, value: string | undefined): string | null {
  return resolvePlace(maps, value, { mode: "stato" })?.code ?? null;
}

// Come resolveLuogo ma privilegia i comuni e ritorna anche la sigla provincia.
export function resolveComuneFull(maps: CodeMaps, value: string | undefined, provincia?: string): { code: string; provincia: string | null; ambiguous?: boolean } | null {
  const r = resolvePlace(maps, value, { provincia, mode: "comune" });
  return r ? { code: r.code, provincia: r.provincia, ambiguous: r.ambiguous } : null;
}

// Codice dello stato "Italia" (per la Stato Nascita degli ospiti nati in Italia).
export function italyCode(maps: CodeMaps): string | null {
  return resolveStato(maps, "ITALIA");
}

// Alias tipo documento: le diciture dell'app → codice ufficiale (la tabella scrive es.
// "CARTA DI IDENTITA", mentre l'app usa "Carta d'identità" → norm "CARTA D IDENTITA").
const DOC_ALIAS: Record<string, string> = {
  "CARTA D IDENTITA": "IDENT", "CARTA DI IDENTITA": "IDENT", "CARTA IDENTITA": "IDENT", "IDENTITY CARD": "IDENT", "ID CARD": "IDENT",
  CIE: "IDELE", "CARTA D IDENTITA ELETTRONICA": "IDELE", "CARTA IDENTITA ELETTRONICA": "IDELE",
  PASSAPORTO: "PASOR", "PASSAPORTO ORDINARIO": "PASOR", PASSPORT: "PASOR", PASSEPORT: "PASOR", REISEPASS: "PASOR", PASAPORTE: "PASOR",
  PATENTE: "PATEN", "PATENTE DI GUIDA": "PATEN", "DRIVING LICENSE": "PATEN", "DRIVING LICENCE": "PATEN", "DRIVERS LICENSE": "PATEN",
};

export function resolveDocumento(maps: CodeMaps, value: string | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (maps.codeSet.has(v)) return v;
  const n = norm(v);
  const byName = maps.docByName.get(n);
  if (byName) return byName;
  // Alias diretto → codice, ma solo se quel codice esiste davvero nelle tabelle scaricate.
  const alias = DOC_ALIAS[n];
  if (alias && maps.codeSet.has(alias)) return alias;
  // Nome contenuto in uno solo dei nomi della tabella (o viceversa), es. "Permesso di soggiorno".
  if (n.length >= 6) {
    const m = Array.from(maps.docByName.entries()).filter(([k]) => k.includes(n) || n.includes(k));
    if (m.length === 1) return m[0][1];
  }
  return null;
}

export interface GuestCodeInput {
  comuneNascita?: string; provinciaNascita?: string; statoNascita?: string; cittadinanza?: string;
  tipoDoc?: string; luogoRilascio?: string;
}
export interface ResolvedCodes {
  comune: string; prov: string; statoNascita: string; cittadinanza: string; tipoDoc: string; luogoRilascio: string;
  /** Campi compilati dall'ospite che NON si traducono in un codice valido (messaggi per l'operatore). */
  issues: string[];
}

/**
 * Il luogo di nascita scritto è in realtà ESTERO? Vero se lo Stato indicato a parte non è l'Italia, oppure se il testo ha più pezzi
 * ("Santa Maria, Brazil") e uno di essi è uno Stato diverso dall'Italia. I pezzi di 2 lettere si ignorano (sigle di provincia: "GE", "CA", "PA" sono anche codici ISO).
 */
function bornAbroad(maps: CodeMaps, comuneNascita: string | undefined, statoNascita: string | undefined, italy: string): boolean {
  if ((statoNascita ?? "").trim()) { const st = resolveStato(maps, statoNascita); if (st && st !== italy) return true; }
  const pieces = (comuneNascita ?? "").replace(/\([^)]*\)/g, " ").split(/[,;/]|\s[-–]\s/).map(norm).filter(Boolean);
  if (pieces.length < 2) return false;
  return pieces.some((p) => { if (/^[A-Z]{2}$/.test(p)) return false; if (FOREIGN_REGIONS.has(p)) return true; const st = resolveStato(maps, p); return !!st && st !== italy; });
}

// Stati federati / province estere che si scrivono dopo la città ("Parma, Ohio", "Windsor, Ontario"): non sono Stati nella tabella ma indicano una nascita estera.
const FOREIGN_REGIONS = new Set([
  "ALABAMA", "ALASKA", "ARIZONA", "ARKANSAS", "CALIFORNIA", "COLORADO", "CONNECTICUT", "DELAWARE", "FLORIDA", "HAWAII", "IDAHO", "ILLINOIS", "INDIANA", "IOWA", "KANSAS", "KENTUCKY",
  "LOUISIANA", "MAINE", "MARYLAND", "MASSACHUSETTS", "MICHIGAN", "MINNESOTA", "MISSISSIPPI", "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA", "NEW HAMPSHIRE", "NEW JERSEY", "NEW MEXICO", "NEW YORK",
  "NORTH CAROLINA", "NORTH DAKOTA", "OHIO", "OKLAHOMA", "OREGON", "PENNSYLVANIA", "RHODE ISLAND", "SOUTH CAROLINA", "SOUTH DAKOTA", "TENNESSEE", "TEXAS", "UTAH", "VERMONT", "VIRGINIA", "WASHINGTON",
  "WEST VIRGINIA", "WISCONSIN", "WYOMING", "ONTARIO", "QUEBEC", "ALBERTA", "BRITISH COLUMBIA", "MANITOBA", "SASKATCHEWAN", "NOVA SCOTIA", "NEW BRUNSWICK",
]);

/**
 * Traduce i dati liberi di una persona nei codici del tracciato e dice quali campi NON si risolvono.
 * Senza i codici corretti il tracciato avrebbe spazi al loro posto e il portale lo rifiuterebbe.
 * `member`: familiare/membro (ruolo 19/20): per loro non servono i dati del documento.
 */
export function resolveSchedinaCodes(g: GuestCodeInput, member: boolean, maps: CodeMaps): ResolvedCodes {
  const issues: string[] = [];
  const has = (s?: string) => !!(s ?? "").trim();
  let comune = "", prov = "", statoNascita = "";
  const it = italyCode(maps) ?? "";
  let place = resolvePlace(maps, g.comuneNascita, { provincia: g.provinciaNascita, mode: "comune" });
  // "Santa Maria, Brazil" / "Parma, Ohio": un pezzo si legge come comune italiano, ma un altro pezzo (o lo Stato indicato a parte) è uno Stato ESTERO → non è un comune italiano.
  if (place && place.isComune && bornAbroad(maps, g.comuneNascita, g.statoNascita, it)) place = null;
  if (place && place.isComune) {
    comune = place.code; prov = (place.provincia ?? "").toUpperCase();
    statoNascita = resolveStato(maps, g.statoNascita) || it;
    if (place.ambiguous) issues.push(`Luogo di nascita «${(g.comuneNascita ?? "").trim()}» ambiguo (più comuni con lo stesso nome): aggiungi la provincia, es. «${(g.comuneNascita ?? "").trim()} (SR)»`);
  } else {
    // Nato all'estero (o comune non riconosciuto): comune/provincia vuoti, stato = paese.
    statoNascita = resolveStato(maps, g.statoNascita) || resolveStato(maps, g.comuneNascita) || "";
    if (!statoNascita && (has(g.comuneNascita) || has(g.statoNascita))) issues.push(`Luogo di nascita «${(g.comuneNascita || g.statoNascita || "").trim()}» non riconosciuto: indica il Comune italiano o lo Stato estero`);
    // "Rome, Italy": lo Stato è l'Italia ma il Comune non si riconosce → senza Comune il portale rifiuta la schedina.
    else if (statoNascita && statoNascita === it) issues.push(`Nato in Italia: indica il Comune di nascita («${(g.comuneNascita || g.statoNascita || "").trim()}» non è un Comune riconosciuto)`);
  }
  const cittadinanza = resolveStato(maps, g.cittadinanza) || "";
  if (has(g.cittadinanza) && !cittadinanza) issues.push(`Cittadinanza «${(g.cittadinanza ?? "").trim()}» non riconosciuta: indica lo Stato (es. Italia, Germania)`);
  let tipoDoc = "", luogoRilascio = "";
  if (!member) {
    tipoDoc = resolveDocumento(maps, g.tipoDoc) || "";
    if (has(g.tipoDoc) && !tipoDoc) issues.push(`Tipo documento «${(g.tipoDoc ?? "").trim()}» non riconosciuto`);
    const lr = resolvePlace(maps, g.luogoRilascio, { mode: "any" });
    luogoRilascio = lr?.code ?? "";
    if (lr?.ambiguous) issues.push(`Luogo di rilascio «${(g.luogoRilascio ?? "").trim()}» ambiguo: aggiungi la provincia, es. «${(g.luogoRilascio ?? "").trim()} (SR)»`);
    // Documento estero: se il luogo di rilascio non è un comune/Stato noto, è lo Stato della cittadinanza.
    // Passaporto: sempre. Carta d'identità / patente di un cittadino NON italiano ("Stadt Berlin", "Gemeente Amsterdam", "Prefecture de Paris"): idem (per un italiano il luogo resta da correggere).
    if (!luogoRilascio && has(g.luogoRilascio) && cittadinanza) {
      const isPassport = tipoDoc === "PASOR" || /PASSAPORT|PASSPORT/.test(norm(g.tipoDoc));
      const isOtherId = ["IDENT", "IDELE", "PATEN"].includes(tipoDoc);
      if (isPassport || (isOtherId && cittadinanza !== italyCode(maps))) luogoRilascio = cittadinanza;
    }
    if (has(g.luogoRilascio) && !luogoRilascio) issues.push(`Luogo di rilascio «${(g.luogoRilascio ?? "").trim()}» non riconosciuto: indica il Comune (es. Siracusa) o lo Stato`);
  }
  return { comune, prov, statoNascita, cittadinanza, tipoDoc, luogoRilascio, issues };
}
