"use client";

// Dati "esterni" della Dashboard: schedine Questura, ISTAT, errori di invio, conversazioni, invii non consegnati, collegamenti dei canali.
// Query mirate e leggere (solo ciò che serve agli adempimenti). Ogni errore di rete lascia i dati già caricati.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/invoicing/client";
import { spiegaErroreWa } from "@/lib/invii-log";
import { addDaysISO } from "@/lib/dashboard";

type SchedRow = { booking_id: string | null; stato: string };
export type Threads = Record<string, { dir: string; text: string }[]>;
type InviiRow = { at: string; job: string; ref?: string; channel: string; ok: boolean; detail?: string };

export function useDashboard2Dati(structureIds: string[], scope: string, today: string) {
  const [sched, setSched] = useState<SchedRow[]>([]);
  const [istat, setIstat] = useState<SchedRow[]>([]);
  const [questuraErrors, setQuesturaErrors] = useState(0);
  const [threads, setThreads] = useState<Threads>({});
  const [ready, setReady] = useState(false);
  const idsKey = structureIds.join("|");

  const load = useCallback(async () => {
    try { setThreads(JSON.parse(localStorage.getItem("spigolestay:threads:v1") || "{}")); } catch { setThreads({}); }
    if (!supabase) { setReady(true); return; }
    const cutoff = addDaysISO(today, -120);
    const ids = idsKey ? idsKey.split("|") : [];
    try {
      const [recent, open, ist, err] = await Promise.all([
        supabase.from("alloggiati_schedine").select("booking_id, stato").gte("arrival", cutoff).lte("arrival", today),
        supabase.from("alloggiati_schedine").select("booking_id, stato").neq("stato", "inviata").lte("arrival", today), // ancora aperte, di qualsiasi data
        supabase.from("istat_rows").select("booking_id, stato").eq("stato", "pending").lte("arrival", today),
        ids.length
          ? supabase.from("alloggiati_submissions").select("id", { count: "exact", head: true }).eq("stato", "error").gte("created_at", addDaysISO(today, -30)).in("structure_id", ids)
          : Promise.resolve({ count: 0 }),
      ]);
      const seen = new Set<string>();
      const merged: SchedRow[] = [];
      for (const r of [...((recent.data ?? []) as SchedRow[]), ...((open.data ?? []) as SchedRow[])]) {
        const k = `${r.booking_id}|${r.stato}`;
        if (!seen.has(k)) { seen.add(k); merged.push(r); }
      }
      setSched(merged);
      setIstat((ist.data ?? []) as SchedRow[]);
      setQuesturaErrors((err as { count: number | null }).count ?? 0);
    } catch { /* offline: restano i dati già caricati */ }
    setReady(true);
  }, [today, idsKey]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const h = () => { void load(); };
    const ev = ["focus", "spigolestay:datasync", "spigolestay:reminders", "spigolestay:threads"];
    ev.forEach((e) => window.addEventListener(e, h));
    return () => ev.forEach((e) => window.removeEventListener(e, h));
  }, [load]);

  // Per prenotazione: lo stato peggiore tra le schedine (da correggere > pronta > inviata).
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
  const istatPendingIds = useMemo(() => new Set(istat.map((r) => r.booking_id).filter((x): x is string => !!x)), [istat]);

  // Invii automatici non consegnati (ultime 48 ore, senza un invio riuscito dopo), con il motivo.
  const [inviiKo, setInviiKo] = useState<{ label: string; href: string }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/invii-log").then((r) => r.json()).then((j) => {
      if (!alive) return;
      const rows = ((j?.rows ?? []) as InviiRow[]).filter((x) => Date.now() - Date.parse(x.at) < 48 * 3600000);
      const latest = new Map<string, InviiRow>();
      for (const r of rows) { const k = `${r.job}|${r.channel}|${r.job === "pulizie" ? r.ref ?? "" : ""}`; const cur = latest.get(k); if (!cur || r.at > cur.at) latest.set(k, r); }
      const bad = [...latest.values()].filter((x) => !x.ok);
      const out: { label: string; href: string }[] = [];
      for (const x of bad.filter((y) => y.job === "pulizie")) {
        const why = spiegaErroreWa(x.detail) || x.detail;
        out.push({ label: `Planning pulizie non consegnato su ${x.channel === "whatsapp" ? "WhatsApp" : "email"}${why ? `: ${why}` : ""}`, href: "/pulizie" });
      }
      const msg = bad.filter((y) => y.job === "messaggi");
      if (msg.length) out.push({ label: `${msg.length} ${msg.length === 1 ? "messaggio automatico agli ospiti non consegnato" : "messaggi automatici agli ospiti non consegnati"}${spiegaErroreWa(msg[0].detail) ? `: ${spiegaErroreWa(msg[0].detail)}` : ""}`, href: "/messaggi" });
      setInviiKo(out);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Collegamento reale dei canali (Channex) per la struttura attiva.
  const [chConn, setChConn] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiPost<{ ok: boolean; byStructure?: Record<string, { channel: string; active: boolean }[]> }>("channex/status", {});
        if (!alive || !res?.ok || !res.byStructure) return;
        const lists = scope === "all" ? Object.values(res.byStructure) : [res.byStructure[scope] ?? []];
        const byCh: Record<string, boolean> = {};
        lists.flat().forEach((c) => { byCh[c.channel] = !!byCh[c.channel] || c.active; });
        setChConn(byCh);
      } catch { /* nessun dato: la salute dei canali si calcola comunque dal flusso di prenotazioni */ }
    })();
    return () => { alive = false; };
  }, [scope]);

  return { ready, schedBy, istatPendingIds, questuraErrors, threads, inviiKo, chConn };
}
