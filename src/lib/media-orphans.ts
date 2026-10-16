// Utilità PURE per i riferimenti media privati dentro i dati (prenotazioni, ospiti…): quali sono, e quali restano "orfani"
// (non più usati da nessuna parte) dopo una modifica. Servono a togliere dallo Storage i file che nessuno referenzia più.
import { isPrivateRef } from "./media";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Tutti i riferimenti a file PRIVATI presenti nei valori (qualunque profondità). */
export function privateRefsIn(...values: unknown[]): Set<string> {
  const out = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (v: unknown) => {
    if (typeof v === "string") { if (isPrivateRef(v)) out.add(v); return; }
    if (!isObj(v) || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) v.forEach(walk); else for (const k of Object.keys(v)) walk(v[k]);
  };
  values.forEach(walk);
  return out;
}

/**
 * Dei riferimenti `refs` (che prima stavano in un oggetto), quelli che NON compaiono più da nessuna parte in `data`
 * (l'intero contenuto dello store: lo stesso file può essere usato da più prenotazioni e dall'anagrafica ospite).
 */
export function orphanedRefs(refs: Iterable<string>, data: unknown): string[] {
  const list = [...refs];
  if (!list.length) return [];
  const text = JSON.stringify(data) ?? "";
  return list.filter((r) => !text.includes(r));
}
