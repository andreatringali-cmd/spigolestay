"use client";

// Contesto degli invii automatici per le schede prenotazione: modelli attivi, interruttori del server, invio automatico delle schedine
// per struttura e "adesso" che avanza ogni 30 secondi (così "invio tra 25 minuti" si aggiorna da solo).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { MSG_TEMPLATES_KEY, DEFAULT_TEMPLATES } from "./msg-templates";
import type { AutoCtx, AutoTpl } from "./auto-schedule";

type Status = { messagesLive: boolean; alloggiatiLive: boolean };
let statusCache: { at: number; v: Status } | null = null;
let statusInflight: Promise<Status | null> | null = null;

async function fetchStatus(): Promise<Status | null> {
  if (statusCache && Date.now() - statusCache.at < 5 * 60000) return statusCache.v;
  if (statusInflight) return statusInflight;
  statusInflight = (async () => {
    try {
      const token = (await supabase?.auth.getSession())?.data.session?.access_token;
      if (!token) return null;
      const r = await fetch("/api/auto-status", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      const j = await r.json() as Partial<Status>;
      const v = { messagesLive: !!j.messagesLive, alloggiatiLive: !!j.alloggiatiLive };
      statusCache = { at: Date.now(), v };
      return v;
    } catch { return null; } finally { statusInflight = null; }
  })();
  return statusInflight;
}

function readTemplates(): AutoTpl[] {
  try {
    const raw = localStorage.getItem(MSG_TEMPLATES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const base = Array.isArray(parsed) ? parsed : [];
    const have = new Set(base.map((x: AutoTpl) => x.id));
    return [...base, ...DEFAULT_TEMPLATES.filter((d) => !have.has(d.id))] as AutoTpl[];
  } catch { return DEFAULT_TEMPLATES as AutoTpl[]; }
}

export function useAutoCtx(): AutoCtx {
  const [now, setNow] = useState(() => Date.now());
  const [templates, setTemplates] = useState<AutoTpl[]>([]);
  const [status, setStatus] = useState<Status | null>(statusCache?.v ?? null);
  const [alloggiatiAuto, setAlloggiatiAuto] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const tick = () => { setNow(Date.now()); setTemplates(readTemplates()); };
    tick();
    const id = setInterval(tick, 30000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(id); window.removeEventListener("focus", tick); };
  }, []);
  useEffect(() => { let alive = true; void fetchStatus().then((v) => { if (alive && v) setStatus(v); }); return () => { alive = false; }; }, [now > 0 ? Math.floor(now / 300000) : 0]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase!.from("alloggiati_settings").select("structure_id, auto_daily");
        if (alive) setAlloggiatiAuto(Object.fromEntries((data ?? []).map((r: { structure_id: string; auto_daily: boolean }) => [r.structure_id, !!r.auto_daily])));
      } catch { /* senza rete: nessuna riga sulla schedina */ }
    })();
    return () => { alive = false; };
  }, []);

  return useMemo(() => ({ now, templates, messagesLive: status ? status.messagesLive : null, alloggiatiLive: status ? status.alloggiatiLive : null, alloggiatiAuto }), [now, templates, status, alloggiatiAuto]);
}
