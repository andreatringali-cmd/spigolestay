"use client";

// Gancio unico per «Adempimenti oggi»: legge dal server le righe che servono (schedine, ISTAT, documenti, incassi, fatture fornitori) UNA volta sola
// per tutta l'app (cache condivisa: barra laterale, Dashboard e pagina Adempimenti non fanno tre richieste diverse) e applica la regola
// di computeAdempimentiOggi alla struttura selezionata in alto a destra. Così i tre numeri non possono più divergere.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { useData } from "./store";
import { todayRome } from "./dates-rome";
import { computeAdempimentiOggi, type AdDocRow, type AdIstatRow, type AdPassiveRow, type AdPayRow, type AdSchedRow } from "./adempimenti-oggi";

interface Rows { sched: AdSchedRow[]; istat: AdIstatRow[]; docs: AdDocRow[]; pays: AdPayRow[]; passive: AdPassiveRow[] }
const EMPTY: Rows = { sched: [], istat: [], docs: [], pays: [], passive: [] };

// ---- cache condivisa (una per scheda del browser) ----
let cache: Rows | null = null;
let cacheAt = 0;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();
const FRESH_MS = 20000;      // eventi (focus, sincronizzazione): non si ricarica più di una volta ogni 20 s
const POLL_MS = 120000;      // controllo periodico a scheda visibile

async function fetchRows(force: boolean): Promise<void> {
  if (!supabase) { if (!cache) { cache = EMPTY; subs.forEach((f) => f()); } return; }
  if (!force && cache && Date.now() - cacheAt < FRESH_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [a, i, d, p, pv] = await Promise.all([
        supabase!.from("alloggiati_schedine").select("id, arrival, stato, booking_id, guest, structure_id"),
        supabase!.from("istat_rows").select("id, arrival, stato, booking_id, structure_id").in("stato", ["pending", "sent"]),
        supabase!.from("documents").select("id, structure_id, number_label, stato, total_cents, counterpart").in("stato", ["scartata", "emessa", "inviata_intermediario", "consegnata"]),
        supabase!.from("document_payments").select("document_id, amount_cents"),
        supabase!.from("purchase_documents").select("id, structure_id, supplier_name, due_date, total_cents, paid"),
      ]);
      // Se una richiesta è fallita si tengono i dati già caricati (meglio un numero vecchio che uno falso a zero).
      if (a.error || i.error || d.error || p.error || pv.error) { if (!cache) cache = EMPTY; return; }
      cache = {
        sched: (a.data ?? []) as AdSchedRow[], istat: (i.data ?? []) as AdIstatRow[], docs: (d.data ?? []) as AdDocRow[],
        pays: (p.data ?? []) as AdPayRow[], passive: (pv.data ?? []) as AdPassiveRow[],
      };
      cacheAt = Date.now();
    } catch { if (!cache) cache = EMPTY; }
    finally { inflight = null; subs.forEach((f) => f()); }
  })();
  return inflight;
}

export function useAdempimentiOggi() {
  const { bookings, getGuest, activeStructureId } = useData();
  const [, bump] = useState(0);
  const [today, setToday] = useState(() => todayRome());

  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    void fetchRows(false);
    const ev = ["focus", "spigolestay:datasync"];
    const h = () => { void fetchRows(false); };
    ev.forEach((e) => window.addEventListener(e, h));
    const id = setInterval(() => { setToday(todayRome()); if (document.visibilityState === "visible") void fetchRows(false); }, POLL_MS);
    return () => { subs.delete(f); ev.forEach((e) => window.removeEventListener(e, h)); clearInterval(id); };
  }, []);

  const rows = cache ?? EMPTY;
  const inScope = useCallback((sid: string | null | undefined) => activeStructureId === "all" || sid === activeStructureId, [activeStructureId]);
  const scoped = useMemo(() => ({
    bookings: activeStructureId === "all" ? bookings : bookings.filter((b) => b.structureId === activeStructureId),
    sched: rows.sched.filter((r) => inScope(r.structure_id)), istat: rows.istat.filter((r) => inScope(r.structure_id)),
    docs: rows.docs.filter((r) => inScope(r.structure_id)), pays: rows.pays, passive: rows.passive.filter((r) => inScope(r.structure_id)),
  }), [bookings, activeStructureId, rows, inScope]);
  const result = useMemo(() => computeAdempimentiOggi({ ...scoped, getGuest, today }), [scoped, getGuest, today]);
  /** Ricarica subito (dopo un'azione che cambia schedine, ISTAT o documenti). */
  const reload = useCallback(() => fetchRows(true), []);
  return { ready: cache !== null, today, result, reload, scoped };
}
