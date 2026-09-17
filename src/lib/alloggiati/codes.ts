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

// Risolve un luogo (comune o stato) in codice. Se `value` è già un codice valido lo
// mantiene; altrimenti cerca per nome (eventualmente disambiguando per provincia).
export function resolveLuogo(maps: CodeMaps, value: string | undefined, provincia?: string): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (maps.codeSet.has(v)) return v;
  const hits = maps.byName.get(norm(v));
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
  if (!hits || !hits.length) return null;
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

export function resolveDocumento(maps: CodeMaps, value: string | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (maps.codeSet.has(v)) return v;
  return maps.docByName.get(norm(v)) ?? null;
}
