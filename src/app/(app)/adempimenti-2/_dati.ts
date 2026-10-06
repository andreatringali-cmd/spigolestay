"use client";

// Dati "esterni" di Adempimenti 2: schedine Questura, movimenti ISTAT, documenti, fatture fornitori, ultimi invii alla Questura e
// conversazioni. Sono le STESSE tabelle e gli stessi filtri della pagina "Adempimenti oggi", con query mirate (finestre di date,
// solo ciò che serve) per non toccare il limite di righe di Supabase. Ogni errore di rete lascia i dati già caricati.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { computeResidui, type RecvDoc } from "@/lib/invoicing/receivables";
import { addDaysISO, type DocRow, type PassiveRow, type SchedRow, type SubmissionRow } from "@/lib/adempimenti2";

export type Threads = Record<string, { dir: string; text: string }[]>;
type DocRaw = RecvDoc & { structure_id: string | null; number_label: string | null; counterpart: { name?: string; lastName?: string } | null };

const VALID_DOC = ["emessa", "inviata_intermediario", "consegnata"];

export function useAdempimentiDati(today: string) {
  const [sched, setSched] = useState<SchedRow[]>([]);
  const [istat, setIstat] = useState<SchedRow[]>([]);
  const [docsRaw, setDocsRaw] = useState<DocRaw[]>([]);
  const [paid, setPaid] = useState<Record<string, number>>({});
  const [passive, setPassive] = useState<PassiveRow[]>([]);
  const [subs, setSubs] = useState<SubmissionRow[]>([]);
  const [threads, setThreads] = useState<Threads>({});
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false); // almeno una lettura non è riuscita: i numeri potrebbero essere incompleti

  const load = useCallback(async () => {
    try { setThreads(JSON.parse(localStorage.getItem("spigolestay:threads:v1") || "{}")); } catch { setThreads({}); }
    if (!supabase) { setReady(true); return; }
    const recent = addDaysISO(today, -45);
    try {
      const [aRecent, aOpen, iPend, iSent, d, p, pv, sb] = await Promise.all([
        supabase.from("alloggiati_schedine").select("id, arrival, stato, booking_id, structure_id").gte("arrival", recent).lte("arrival", today),
        supabase.from("alloggiati_schedine").select("id, arrival, stato, booking_id, structure_id").neq("stato", "inviata").lte("arrival", today), // ancora aperte, di qualsiasi data
        supabase.from("istat_rows").select("id, arrival, stato, booking_id, structure_id").eq("stato", "pending").lte("arrival", today),
        supabase.from("istat_rows").select("id, arrival, stato, booking_id, structure_id").eq("stato", "sent").gte("arrival", addDaysISO(today, -3)),
        supabase.from("documents").select("id, structure_id, number_label, stato, doc_kind, due_date, total_cents, counterpart, related_document_id").in("stato", ["scartata", ...VALID_DOC]),
        supabase.from("document_payments").select("document_id, amount_cents"),
        supabase.from("purchase_documents").select("id, structure_id, supplier_name, due_date, total_cents, paid").eq("paid", false),
        supabase.from("alloggiati_submissions").select("id, created_at, count, stato, structure_id").order("created_at", { ascending: false }).limit(12),
      ]);
      const seen = new Set<string>();
      const sMerged: SchedRow[] = [];
      for (const r of [...((aRecent.data ?? []) as SchedRow[]), ...((aOpen.data ?? []) as SchedRow[])]) if (!seen.has(r.id)) { seen.add(r.id); sMerged.push(r); }
      setSched(sMerged);
      const seenI = new Set<string>();
      const iMerged: SchedRow[] = [];
      for (const r of [...((iPend.data ?? []) as SchedRow[]), ...((iSent.data ?? []) as SchedRow[])]) if (!seenI.has(r.id)) { seenI.add(r.id); iMerged.push(r); }
      setIstat(iMerged);
      setDocsRaw((d.data ?? []) as DocRaw[]);
      const m: Record<string, number> = {};
      for (const x of (p.data ?? []) as { document_id: string; amount_cents: number }[]) m[x.document_id] = (m[x.document_id] ?? 0) + x.amount_cents;
      setPaid(m);
      setPassive((pv.data ?? []) as PassiveRow[]);
      setSubs((sb.data ?? []) as SubmissionRow[]);
      setFailed([aRecent, aOpen, iPend, iSent, d, p, pv].some((r) => !!r.error));
    } catch { setFailed(true); /* offline: restano i dati già caricati */ }
    setReady(true);
  }, [today]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  // Si aggiorna al rientro sulla pagina, dopo una sincronizzazione dati e dopo un invio/sollecito.
  useEffect(() => {
    const h = () => { void load(); };
    const ev = ["focus", "spigolestay:datasync", "spigolestay:reminders", "spigolestay:threads"];
    ev.forEach((e) => window.addEventListener(e, h));
    return () => ev.forEach((e) => window.removeEventListener(e, h));
  }, [load]);

  // Documenti pronti per la logica pura: il residuo tiene conto di incassi e note di credito (come lo scadenzario incassi).
  const docs: DocRow[] = useMemo(() => {
    const valid = docsRaw.filter((d) => VALID_DOC.includes(d.stato));
    const res = computeResidui(valid, paid);
    return docsRaw.map((d) => ({
      id: d.id, structure_id: d.structure_id, number_label: d.number_label, stato: d.stato, doc_kind: d.doc_kind, due_date: d.due_date,
      name: `${d.counterpart?.name ?? ""} ${d.counterpart?.lastName ?? ""}`.trim(), residuo_cents: d.stato === "scartata" ? 0 : res[d.id]?.residuo ?? 0,
    }));
  }, [docsRaw, paid]);

  // Per prenotazione: lo stato peggiore tra le schedine (da correggere > pronta > inviata) e se c'è un movimento ISTAT in attesa.
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

  return { ready, failed, sched, istat, docs, passive, subs, threads, schedBy, istatBy, reload: load };
}
