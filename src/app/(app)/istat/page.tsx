"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { apiPost } from "@/lib/invoicing/client";

interface Sett { region: string; partner: string; username: string; password_enc: string; auto_daily: boolean; start_from: string; status: string; status_msg: string }
const DEF: Sett = { region: "Sicilia", partner: "Turist@t", username: "", password_enc: "", auto_daily: false, start_from: "", status: "", status_msg: "" };
interface Row { id: string; arrival: string; departure: string; provenance: string; guests: number; stato: string }
const REGIONS = ["Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna", "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardia", "Marche", "Molise", "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana", "Trentino-Alto Adige", "Umbria", "Valle d'Aosta", "Veneto"];
const STA = (k: string) => ({ pending: { l: "Da inviare", c: "var(--warn)" }, sent: { l: "Inviato", c: "var(--ok)" }, error: { l: "Errore", c: "var(--err)" } } as Record<string, { l: string; c: string }>)[k] ?? { l: k, c: "var(--dim)" };

export default function IstatPage() {
  const { structures, activeStructureId } = useData();
  const [sid, setSid] = useState("");
  const [s, setS] = useState<Sett>(DEF);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  // Password mai pre-caricata nel client (cifrata sul server). Vuota = non cambiare.
  const [pw, setPw] = useState("");
  const [hasPw, setHasPw] = useState(false);

  useEffect(() => {
    const target = activeStructureId !== "all" && structures.some((x) => x.id === activeStructureId) ? activeStructureId : structures[0]?.id ?? "";
    if (target && target !== sid) setSid(target);
  }, [structures, activeStructureId, sid]);

  const load = useCallback(async () => {
    if (!supabase || !sid) return;
    const [st, rw] = await Promise.all([
      supabase.from("istat_settings").select("*").eq("structure_id", sid).maybeSingle(),
      supabase.from("istat_rows").select("id, arrival, departure, provenance, guests, stato").eq("structure_id", sid).order("arrival", { ascending: false }),
    ]);
    setS(st.data ? { ...DEF, ...Object.fromEntries(Object.entries(st.data).filter(([, v]) => v !== null)) as Partial<Sett> } : DEF);
    setHasPw(!!st.data?.password_enc); setPw("");
    setRows((rw.data ?? []) as Row[]);
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const set = (p: Partial<Sett>) => setS((x) => ({ ...x, ...p }));
  const save = async () => {
    if (!sid) return;
    setBusy("save"); setMsg("");
    try {
      // La cifratura della password avviene lato server nella route.
      await apiPost("istat/settings", { structureId: sid, region: s.region, partner: s.partner, username: s.username, password: pw, auto_daily: s.auto_daily, start_from: s.start_from || null });
      await load(); setMsg("Impostazioni salvate ✓");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };
  const call = async (label: string, path: string) => {
    setBusy(label); setMsg("");
    try { const r = await apiPost<{ message?: string; count?: number; sent?: number }>(`istat/${path}`, { structureId: sid }); setMsg(r.message || `OK${r.count != null ? ` (${r.count})` : ""}`); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };

  const pending = rows.filter((r) => r.stato === "pending").length;
  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  return (
    <div>
      <PageHeader title="ISTAT · Turist@t" subtitle="Movimento turistico verso il portale regionale"
        actions={structures.length > 1 ? <select value={sid} onChange={(e) => setSid(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt">{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : undefined} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Connessione ISTAT</SectionTitle>
          <details open={!s.username} className="mt-2">
            <summary className="mb-2 cursor-pointer text-xs font-semibold text-focus">Credenziali e opzioni</summary>
          <div className="space-y-2">
            <label className="block"><span className={lbl}>Regione</span><select value={s.region} onChange={(e) => set({ region: e.target.value })} className={inp}>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className="block"><span className={lbl}>Portale / partner</span><input value={s.partner} onChange={(e) => set({ partner: e.target.value })} placeholder="Turist@t / Ross1000…" className={inp} /></label>
            <label className="block"><span className={lbl}>Username</span><input value={s.username} onChange={(e) => set({ username: e.target.value })} className={inp} /></label>
            <label className="block"><span className={lbl}>Password</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={hasPw ? "•••••••• (salvata — lascia vuoto per non cambiarla)" : ""} className={inp} /></label>
            <label className="block"><span className={lbl}>Elabora i dati a partire dal</span><input type="date" value={s.start_from?.slice(0, 10) ?? ""} onChange={(e) => set({ start_from: e.target.value })} className={inp} /></label>
            <label className="flex items-center justify-between pt-1"><span className="text-sm text-txt">Invio automatico giornaliero</span><input type="checkbox" checked={s.auto_daily} onChange={(e) => set({ auto_daily: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>
          </div>
          </details>
          <button onClick={save} disabled={!!busy} className="mt-3 rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "save" ? "Salvataggio…" : "Salva"}</button>
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between"><SectionTitle>Movimento turistico</SectionTitle><span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-dim">Da inviare: {pending}</span></div>
          <div className="mb-2 flex flex-wrap gap-2">
            <button onClick={() => call("sync", "sync")} disabled={!!busy} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "sync" ? "Sincronizzo…" : "Sincronizza dagli arrivi"}</button>
            <button onClick={() => call("close", "close")} disabled={!!busy || pending === 0} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "close" ? "Invio…" : `Invia / chiudi (${pending})`}</button>
          </div>
          <div className="max-h-[52vh] overflow-y-auto">
            {rows.map((r) => { const st = STA(r.stato); return (
              <div key={r.id} className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <div className="min-w-0"><div className="truncate text-sm text-txt">{r.arrival ? new Date(r.arrival).toLocaleDateString("it-IT") : "—"} → {r.departure ? new Date(r.departure).toLocaleDateString("it-IT") : "—"}</div><div className="text-[11px] text-faint">{r.guests} ospiti · provenienza {r.provenance || "—"}</div></div>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.c} 16%, transparent)`, color: st.c }}>{st.l}</span>
              </div>); })}
            {rows.length === 0 && <EmptyState title="Nessun movimento" sub="Premi «Sincronizza dagli arrivi»." />}
          </div>
        </Card>
      </div>
      {msg && <p className="mt-3 text-sm font-medium text-dim">{msg}</p>}
    </div>
  );
}
