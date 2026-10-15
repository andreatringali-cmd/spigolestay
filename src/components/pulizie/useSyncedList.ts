"use client";

// Dati salvati in una chiave piatta "spigolestay:pulizie:*" (lista di entità con id + updatedAt, cancellazioni = soft-delete).
// La chiave è sincronizzata sul server come le altre della pagina Pulizie (scorte, segnalazioni…): qui il browser
// fa solo da copia di lavoro. Ogni scrittura riparte SEMPRE dalla copia più recente (non da quella tenuta in stato),
// così un secondo dispositivo o una sincronizzazione appena arrivata non vengono sovrascritti da dati stantii.
import { useCallback, useEffect, useRef, useState } from "react";

export const LIST_EVENT = "spigolestay:pulizie-list"; // avvisa le altre parti della stessa scheda (es. il badge del menu)

function readJson<T>(key: string, empty: T, ok: (v: unknown) => boolean): T {
  try { const r = localStorage.getItem(key); const p = r ? JSON.parse(r) : empty; return ok(p) ? (p as T) : empty; } catch { return empty; }
}
const isArr = (v: unknown) => Array.isArray(v);
const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

export function readList<T>(key: string): T[] { return readJson<T[]>(key, [], isArr); }

function useSyncedJson<T>(key: string, empty: T, ok: (v: unknown) => boolean): [T, (fn: (prev: T) => T) => void] {
  const [value, setValue] = useState<T>(empty);
  const last = useRef<string | null | undefined>(undefined); // ultimo testo letto/scritto: se non cambia non si rilegge

  const load = useCallback(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { /* storage non disponibile */ }
    if (raw === last.current) return;
    last.current = raw;
    setValue(readJson<T>(key, empty, ok));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    const ev = ["spigolestay:datasync", "focus", "storage", LIST_EVENT];
    ev.forEach((e) => window.addEventListener(e, load));
    document.addEventListener("visibilitychange", onVis);
    return () => { ev.forEach((e) => window.removeEventListener(e, load)); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const update = useCallback((fn: (prev: T) => T) => {
    const next = fn(readJson<T>(key, empty, ok));
    try {
      const raw = JSON.stringify(next);
      localStorage.setItem(key, raw);
      last.current = raw;
    } catch { /* quota piena: lo stato a video resta, il salvataggio sarà ritentato alla prossima modifica */ }
    setValue(next);
    try { window.dispatchEvent(new Event(LIST_EVENT)); } catch { /* niente */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, update];
}

/** Lista di entità. */
export function useSyncedList<T>(key: string): [T[], (fn: (prev: T[]) => T[]) => void] {
  return useSyncedJson<T[]>(key, [], isArr);
}
/** Mappa chiave → valore (es. camere pulite `${camera}:${data}` → ora). */
export function useSyncedMap<T>(key: string): [Record<string, T>, (fn: (prev: Record<string, T>) => Record<string, T>) => void] {
  return useSyncedJson<Record<string, T>>(key, {}, isObj);
}
