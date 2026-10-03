"use client";

// Caricamento dei dati "di percorso" per la vista Calendario · Dettagliato: schedine Questura, ISTAT, documenti,
// conversazioni e solleciti. Stessa logica di "Prenotazioni · Dettagliata" (duplicata qui perché quel file non si tocca).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { readReminders } from "@/lib/guest-messages";

type StatoRow = { booking_id: string | null; stato: string };
export type Threads = Record<string, { dir: string; text: string }[]>;
export type Reminders = Record<string, Record<string, number>>;

export const GUIDE_RE = /guest-guide|\/guida|guida ospiti/i;

export function useDatiPercorso() {
  const [sched, setSched] = useState<StatoRow[]>([]);
  const [istat, setIstat] = useState<StatoRow[]>([]);
  const [docs, setDocs] = useState<StatoRow[]>([]);
  const [threads, setThreads] = useState<Threads>({});
  const [rems, setRems] = useState<Reminders>({});

  const load = useCallback(async () => {
    try { setThreads(JSON.parse(localStorage.getItem("spigolestay:threads:v1") || "{}")); } catch { setThreads({}); }
    setRems(readReminders());
    if (!supabase) return;
    try {
      const [a, i, d] = await Promise.all([
        supabase.from("alloggiati_schedine").select("booking_id, stato"),
        supabase.from("istat_rows").select("booking_id, stato"),
        supabase.from("documents").select("booking_id, stato").not("booking_id", "is", null),
      ]);
      setSched((a.data ?? []) as StatoRow[]); setIstat((i.data ?? []) as StatoRow[]); setDocs((d.data ?? []) as StatoRow[]);
    } catch { /* offline: restano i dati già caricati */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const h = () => { void load(); };
    window.addEventListener("focus", h);
    window.addEventListener("spigolestay:datasync", h);
    window.addEventListener("spigolestay:reminders", h);
    window.addEventListener("spigolestay:threads", h);
    return () => { window.removeEventListener("focus", h); window.removeEventListener("spigolestay:datasync", h); window.removeEventListener("spigolestay:reminders", h); window.removeEventListener("spigolestay:threads", h); };
  }, [load]);

  const schedBy = useMemo(() => {
    const m = new Map<string, "da_validare" | "pronta" | "inviata">();
    const rank = { da_validare: 3, pronta: 2, inviata: 1 } as const;
    for (const s of sched) {
      if (!s.booking_id || !(s.stato in rank)) continue;
      const st = s.stato as keyof typeof rank;
      const cur = m.get(s.booking_id);
      if (!cur || rank[st] > rank[cur]) m.set(s.booking_id, st);
    }
    return m;
  }, [sched]);
  const istatBy = useMemo(() => {
    const m = new Map<string, "pending" | "sent">();
    for (const r of istat) {
      if (!r.booking_id || (r.stato !== "pending" && r.stato !== "sent")) continue;
      if (m.get(r.booking_id) !== "pending") m.set(r.booking_id, r.stato);
    }
    return m;
  }, [istat]);
  const docBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) if (d.booking_id && d.stato !== "scartata") { const cur = m.get(d.booking_id); if (!cur || cur === "bozza") m.set(d.booking_id, d.stato); } /* un documento emesso batte la bozza */
    return m;
  }, [docs]);

  return { schedBy, istatBy, docBy, threads, rems, reload: load };
}

// Pulizie già segnate come fatte nella pagina Pulizie (sola lettura): chiave "unitId:YYYY-MM-DD".
export function readCleanDone(): Record<string, boolean> {
  try { const r = localStorage.getItem("spigolestay:pulizie:done"); return r ? (JSON.parse(r) as Record<string, boolean>) : {}; } catch { return {}; }
}
