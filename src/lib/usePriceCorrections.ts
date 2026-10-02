"use client";

// Stato client della "Correzione prezzo OTA": valori correnti letti da Channex + storico delle
// modifiche inviate (con esito) salvato in localStorage (chiave "spigolestay:…", quindi sincronizzata
// come le altre dall'authsync). Le chiamate passano dalla route /api/channex/price-correction.
//
// NB: non usiamo apiPost perché lancia un'eccezione quando la route risponde {ok:false,error}:
// qui servono anche i campi di contorno (previous, verified…) per lo storico.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  CORR_LOG_KEY, CORR_LOG_MAX, explainChannexError, parseCorrLog, parseCorrection,
  type Correction, type CorrLogEntry, type CorrLogKind,
} from "@/lib/priceCorrection";

interface ApiCorr { rule: string; value: string }
export interface CorrApiResult {
  ok: boolean; code?: string; error?: string;
  rule?: string | null; value?: string | null;
  previous?: ApiCorr | null; previousKnown?: boolean; applied?: ApiCorr | null;
  verified?: boolean; unchanged?: boolean; warning?: string;
}

async function call(body: Record<string, unknown>): Promise<CorrApiResult> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) return { ok: false, code: "auth", error: "Devi essere connesso per leggere o modificare la correzione prezzo." };
  try {
    const r = await fetch("/api/channex/price-correction", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as CorrApiResult & { error?: string };
    if (r.status === 401) return { ok: false, code: "auth", error: "Sessione scaduta: accedi di nuovo e riprova." };
    if (r.status === 503) return { ok: false, code: "unavailable", error: "Il server non è configurato per questa operazione." };
    if (!r.ok && !j.error) return { ok: false, code: "http", error: explainChannexError(r.status) };
    return j;
  } catch {
    return { ok: false, code: "network", error: "Connessione assente: la richiesta NON è stata inviata. Controlla la rete e riprova." };
  }
}

export interface CurState { loaded: boolean; correction: Correction | null; error?: string; loading?: boolean }

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `x-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

export interface ApplyParams {
  channelId: string; channelLabel: string; structureId: string;
  target: Correction | null; kind: CorrLogKind; bulkId?: string;
}
export interface ApplyOutcome { entry: CorrLogEntry | null; res: CorrApiResult }

export function usePriceCorrections() {
  const [current, setCurrent] = useState<Record<string, CurState>>({});
  const [log, setLog] = useState<CorrLogEntry[]>([]);
  const logRef = useRef<CorrLogEntry[]>([]);

  useEffect(() => {
    try { const l = parseCorrLog(localStorage.getItem(CORR_LOG_KEY)); logRef.current = l; setLog(l); } catch { /* storage non disponibile */ }
  }, []);

  const persist = useCallback((next: CorrLogEntry[]) => {
    const cut = next.slice(0, CORR_LOG_MAX);
    logRef.current = cut; setLog(cut);
    try { localStorage.setItem(CORR_LOG_KEY, JSON.stringify(cut)); } catch { /* storage pieno/negato */ }
  }, []);

  // Legge la correzione dal canale su Channex. Se fallisce NON azzera nulla: segna l'errore (così l'interfaccia
  // non propone di salvare "alla cieca" sopra una correzione esistente che non siamo riusciti a leggere).
  const load = useCallback(async (channelId: string, structureId: string) => {
    setCurrent((cur) => ({ ...cur, [channelId]: { loaded: false, correction: cur[channelId]?.correction ?? null, loading: true } }));
    const res = await call({ channelId, action: "get", structureId });
    if (res.ok) setCurrent((cur) => ({ ...cur, [channelId]: { loaded: true, correction: parseCorrection(res.rule, res.value) } }));
    else setCurrent((cur) => ({ ...cur, [channelId]: { loaded: false, correction: null, error: res.error || "Lettura non riuscita" } }));
    return res;
  }, []);

  const apply = useCallback(async (p: ApplyParams): Promise<ApplyOutcome> => {
    const api = p.target ? { rule: p.target.rule, value: p.target.value.toFixed(2) } : { rule: "", value: "" };
    const res = await call({ channelId: p.channelId, action: "set", structureId: p.structureId, rule: api.rule, value: api.value });
    if (res.ok && res.unchanged) {
      setCurrent((cur) => ({ ...cur, [p.channelId]: { loaded: true, correction: p.target } }));
      return { entry: null, res };
    }
    const from = res.previousKnown && res.previous ? parseCorrection(res.previous.rule, res.previous.value) : null;
    const entry: CorrLogEntry = {
      id: uid(), ts: Date.now(), structureId: p.structureId, channelId: p.channelId, channelLabel: p.channelLabel,
      kind: p.kind, from, fromKnown: !!res.previousKnown, to: p.target,
      status: res.ok ? "ok" : "error",
      ...(res.ok ? { verified: !!res.verified } : { error: res.error || "Errore sconosciuto" }),
      ...(p.bulkId ? { bulkId: p.bulkId } : {}),
    };
    persist([entry, ...logRef.current]);
    if (res.ok) {
      // Verificato = valore riletto da Channex uguale a quello richiesto. Altrimenti mostriamo quello riletto (se c'è).
      const shown = res.verified ? p.target : res.applied ? parseCorrection(res.applied.rule, res.applied.value) : p.target;
      setCurrent((cur) => ({ ...cur, [p.channelId]: { loaded: true, correction: shown } }));
    }
    return { entry, res };
  }, [persist]);

  // Svuota le voci della struttura indicata (con "all" tutto).
  const clearLog = useCallback((structureId: string) => {
    persist(!structureId || structureId === "all" ? [] : logRef.current.filter((e) => e.structureId !== structureId));
  }, [persist]);

  return { current, log, load, apply, clearLog };
}

export type PriceCorrectionsApi = ReturnType<typeof usePriceCorrections>;
