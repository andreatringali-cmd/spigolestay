// Tabelle di codifica Alloggiati Web (Luoghi = comuni + stati, Tipi_Documento).
// Scaricate dal web service (metodo Tabella, CSV separato da ';') e messe in cache
// nella tabella alloggiati_codes. Servono per tradurre i dati testuali dell'ospite
// (comune/stato di nascita, cittadinanza, tipo documento, luogo rilascio) nei
// CODICI ufficiali richiesti dal tracciato a 168 caratteri.
import type { SupabaseClient } from "@supabase/supabase-js";
import { tabella } from "./soap";

// Normalizza per il matching: maiuscolo, senza accenti, spazi compattati.
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
      return { kind: "luoghi", code, name, name_norm: norm(name), provincia: prov || null, is_comune: !!prov, synced_at: new Date().toISOString() };
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
  docByName: Map<string, string>;       // documenti per nome norm
}

// Carica in memoria le mappe per la risoluzione (una volta per operazione di invio).
export async function loadCodeMaps(admin: SupabaseClient): Promise<CodeMaps> {
  const codeSet = new Set<string>();
  const byName = new Map<string, { code: string; provincia: string | null; is_comune: boolean }[]>();
  const docByName = new Map<string, string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from("alloggiati_codes").select("kind, code, name_norm, provincia, is_comune").range(from, from + pageSize - 1);
    if (error || !data || !data.length) break;
    for (const r of data as { kind: string; code: string; name_norm: string; provincia: string | null; is_comune: boolean }[]) {
      codeSet.add(r.code);
      if (r.kind === "luoghi") {
        const arr = byName.get(r.name_norm) ?? [];
        arr.push({ code: r.code, provincia: r.provincia, is_comune: r.is_comune });
        byName.set(r.name_norm, arr);
      } else if (r.kind === "documenti") {
        if (!docByName.has(r.name_norm)) docByName.set(r.name_norm, r.code);
      }
    }
    if (data.length < pageSize) break;
  }
  return { hasData: codeSet.size > 0, codeSet, byName, docByName };
}

// Sinonimi cittadinanza (aggettivo) → nome Stato ufficiale della tabella Luoghi.
// La "Cittadinanza" del tracciato usa il codice Stato: gli ospiti spesso scrivono l'aggettivo.
const NAT_ALIAS: Record<string, string> = {
  ITALIANA: "ITALIA", ITALIANO: "ITALIA", "REPUBBLICA ITALIANA": "ITALIA", "ITALIA REPUBBLICA": "ITALIA",
  FRANCESE: "FRANCIA", TEDESCA: "GERMANIA", TEDESCO: "GERMANIA",
  SPAGNOLA: "SPAGNA", SPAGNOLO: "SPAGNA",
  INGLESE: "REGNO UNITO", BRITANNICA: "REGNO UNITO", BRITANNICO: "REGNO UNITO",
  SVIZZERA: "SVIZZERA", SVIZZERO: "SVIZZERA", AUSTRIACA: "AUSTRIA", AUSTRIACO: "AUSTRIA",
  OLANDESE: "PAESI BASSI", BELGA: "BELGIO", PORTOGHESE: "PORTOGALLO",
  POLACCA: "POLONIA", POLACCO: "POLONIA", RUMENA: "ROMANIA", RUMENO: "ROMANIA",
};

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

// Se il valore è una sigla di provincia (es. "SR"), ritorna il codice del comune capoluogo.
function fromSigla(maps: CodeMaps, nv: string): { code: string; provincia: string | null } | null {
  if (nv.length !== 2 || !PROVINCE_CAPITAL[nv]) return null;
  const cap = maps.byName.get(norm(PROVINCE_CAPITAL[nv]));
  if (!cap || !cap.length) return null;
  const c = cap.find((h) => h.is_comune && norm(h.provincia) === nv) ?? cap.find((h) => h.is_comune) ?? cap[0];
  return { code: c.code, provincia: c.provincia };
}

// Risolve un luogo (comune o stato) in codice. Se `value` è già un codice valido lo
// mantiene; altrimenti cerca per nome (eventualmente disambiguando per provincia),
// prova la sigla provincia → capoluogo (es. "SR" → SIRACUSA), e come ultima spiaggia
// un sinonimo di cittadinanza (es. "Italiana" → "Italia").
export function resolveLuogo(maps: CodeMaps, value: string | undefined, provincia?: string): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (maps.codeSet.has(v)) return v;
  const nv = norm(v);
  let hits = maps.byName.get(nv);
  if ((!hits || !hits.length)) { const s = fromSigla(maps, nv); if (s) return s.code; }
  if ((!hits || !hits.length) && NAT_ALIAS[nv]) hits = maps.byName.get(norm(NAT_ALIAS[nv]));
  if (!hits || !hits.length) return null;
  if (hits.length === 1) return hits[0].code;
  const p = norm(provincia);
  if (p) { const byProv = hits.find((h) => norm(h.provincia) === p); if (byProv) return byProv.code; }
  return hits[0].code; // ambiguo: primo match (il portale segnala eventuali incongruenze in Test)
}

// Come resolveLuogo ma privilegia i comuni e ritorna anche la sigla provincia.
export function resolveComuneFull(maps: CodeMaps, value: string | undefined, provincia?: string): { code: string; provincia: string | null } | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (maps.codeSet.has(v)) return { code: v, provincia: provincia?.trim() || null };
  const hits = maps.byName.get(norm(v));
  if (!hits || !hits.length) { const s = fromSigla(maps, norm(v)); if (s) return s; return null; }
  const comuni = hits.filter((h) => h.is_comune);
  const pool = comuni.length ? comuni : hits;
  if (pool.length === 1) return { code: pool[0].code, provincia: pool[0].provincia };
  const p = norm(provincia);
  if (p) { const byProv = pool.find((h) => norm(h.provincia) === p); if (byProv) return { code: byProv.code, provincia: byProv.provincia }; }
  return { code: pool[0].code, provincia: pool[0].provincia };
}

// Codice dello stato "Italia" (per la Stato Nascita degli ospiti nati in Italia).
export function italyCode(maps: CodeMaps): string | null {
  return resolveLuogo(maps, "ITALIA");
}

// Alias tipo documento: le diciture dell'app → codice ufficiale (la tabella scrive es.
// "CARTA DI IDENTITA", mentre l'app usa "Carta d'identità" → norm "CARTA D IDENTITA").
const DOC_ALIAS: Record<string, string> = {
  "CARTA D IDENTITA": "IDENT", "CARTA DI IDENTITA": "IDENT", "CARTA IDENTITA": "IDENT",
  CIE: "IDELE", "CARTA D IDENTITA ELETTRONICA": "IDELE", "CARTA IDENTITA ELETTRONICA": "IDELE",
  PASSAPORTO: "PASOR", "PASSAPORTO ORDINARIO": "PASOR",
  PATENTE: "PATEN", "PATENTE DI GUIDA": "PATEN",
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
  return null;
}
