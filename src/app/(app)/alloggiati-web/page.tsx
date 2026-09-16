"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/authsync";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { apiPost } from "@/lib/invoicing/client";

interface Sett { username: string; password_enc: string; ws_code_enc: string; ws_code_expires_at: string; auto_daily: boolean; group_guests: boolean; group_by_room: boolean; status: string; status_msg: string }
const DEF: Sett = { username: "", password_enc: "", ws_code_enc: "", ws_code_expires_at: "", auto_daily: false, group_guests: true, group_by_room: false, status: "", status_msg: "" };
interface Sched { id: string; booking_id: string; arrival: string; guest: { cognome?: string; nome?: string }; ruolo: string; stato: string; errors: string[] | null; ricevuta: string | null }

const RUOLO: Record<string, string> = { "16": "Singolo", "17": "Capofamiglia", "18": "Capogruppo", "19": "Familiare", "20": "Membro" };

export default function AlloggiatiWebPage() {
  const { user } = useAuth();
  const { structures, activeStructureId } = useData();
  const [sid, setSid] = useState("");
  const [s, setS] = useState<Sett>(DEF);
  const [sched, setSched] = useState<Sched[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const target = activeStructureId !== "all" && structures.some((x) => x.id === activeStructureId) ? activeStructureId : structures[0]?.id ?? "";
    if (target && target !== sid) setSid(target);
  }, [structures, activeStructureId, sid]);

  const load = useCallback(async () => {
    if (!supabase || !sid) return;
    const [st, sc] = await Promise.all([
      supabase.from("alloggiati_settings").select("*").eq("structure_id", sid).maybeSingle(),
      supabase.from("alloggiati_schedine").select("id, booking_id, arrival, guest, ruolo, stato, errors, ricevuta").eq("structure_id", sid).order("arrival", { ascending: false }),
    ]);
    setS(st.data ? { ...DEF, ...Object.fromEntries(Object.entries(st.data).filter(([, v]) => v !== null)) as Partial<Sett> } : DEF);
    setSched((sc.data ?? []) as Sched[]);
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const set = (p: Partial<Sett>) => setS((x) => ({ ...x, ...p }));
  const save = async () => {
    if (!supabase || !user || !sid) return;
    setBusy("save"); setMsg("");
    const { error } = await supabase.from("alloggiati_settings").upsert({ tenant_id: user.id, structure_id: sid, username: s.username, password_enc: s.password_enc, ws_code_enc: s.ws_code_enc, ws_code_expires_at: s.ws_code_expires_at || null, auto_daily: s.auto_daily, group_guests: s.group_guests, group_by_room: s.group_by_room, updated_at: new Date().toISOString() });
    setBusy(""); setMsg(error ? "Errore: " + error.message : "Impostazioni salvate ✓");
  };
  const call = async (label: string, path: string, body: Record<string, unknown> = {}) => {
    setBusy(label); setMsg("");
    try { const r = await apiPost<{ message?: string; count?: number; sent?: number }>(`alloggiati/${path}`, { structureId: sid, ...body }); setMsg(r.message || `OK${r.count != null ? ` (${r.count})` : ""}${r.sent != null ? ` — inviate ${r.sent}` : ""}`); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };

  const readyCount = sched.filter((x) => x.stato === "pronta").length;
  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";
  const wsExpSoon = s.ws_code_expires_at && new Date(s.ws_code_expires_at) < new Date(Date.now() + 30 * 86400000);

  return (
    <div>
      <PageHeader title="Alloggiati Web" subtitle="Schedine ospiti alla Questura (Portale Alloggiati)"
        actions={structures.length > 1 ? <select value={sid} onChange={(e) => setSid(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt">{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : undefined} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Impostazioni account</SectionTitle>
          <div className="mt-2 space-y-2">
            <label className="flex items-center justify-between"><span className="text-sm text-txt">Raggruppa ospiti (capofamiglia + membri)</span><input type="checkbox" checked={s.group_guests} onChange={(e) => set({ group_guests: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>
            <label className="flex items-center justify-between"><span className="text-sm text-txt">Raggruppa per camera</span><input type="checkbox" checked={s.group_by_room} onChange={(e) => set({ group_by_room: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>
            <label className="block"><span className={lbl}>Username (es. SR001860)</span><input value={s.username} onChange={(e) => set({ username: e.target.value })} className={inp} /></label>
            <label className="block"><span className={lbl}>Password</span><input type="password" value={s.password_enc} onChange={(e) => set({ password_enc: e.target.value })} className={inp} /></label>
            <label className="block"><span className={lbl}>Webservice Code</span><input value={s.ws_code_enc} onChange={(e) => set({ ws_code_enc: e.target.value })} className={`${inp} font-mono text-[11px]`} /></label>
            <label className="block"><span className={lbl}>Scadenza Webservice Code</span><input type="date" value={s.ws_code_expires_at?.slice(0, 10) ?? ""} onChange={(e) => set({ ws_code_expires_at: e.target.value })} className={inp} />{wsExpSoon && <span className="mt-1 block text-[11px] font-semibold text-[color:var(--warn)]">⚠️ In scadenza: rigenera il codice sul portale Alloggiati.</span>}</label>
            <label className="flex items-center justify-between pt-1"><span className="text-sm text-txt">Invio automatico giornaliero</span><input type="checkbox" checked={s.auto_daily} onChange={(e) => set({ auto_daily: e.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></label>
          </div>
          <p className="mt-2 text-[11px] text-faint">L'invio automatico avviene dopo la mezzanotte. Per rientrare nelle 24h di legge puoi forzare l'invio manualmente in qualsiasi momento.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={save} disabled={!!busy} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "save" ? "Salvataggio…" : "Salva"}</button>
            <button onClick={() => call("test", "test")} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "test" ? "Test…" : "Test connessione"}</button>
          </div>
          <div className="mt-3 border-t border-line pt-3 text-sm">
            <span className="text-dim">Stato connessione: </span>
            {s.status === "attivata" ? <span className="font-semibold text-[color:var(--ok)]">✔ Attivata</span> : s.status === "errore" ? <span className="font-semibold text-[color:var(--err)]">✕ Errore</span> : <span className="text-faint">non verificata</span>}
            {s.status_msg && <div className="text-[11px] text-faint">{s.status_msg}</div>}
          </div>
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle>Schedine</SectionTitle>
            <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-dim">Pronte da inviare: {readyCount}</span>
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            <button onClick={() => call("sync", "sync")} disabled={!!busy} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "sync" ? "Sincronizzo…" : "Sincronizza dagli arrivi"}</button>
            <button onClick={() => call("send", "send")} disabled={!!busy || readyCount === 0} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "send" ? "Invio…" : `Invia le pronte (${readyCount})`}</button>
          </div>
          <div className="max-h-[52vh] overflow-y-auto">
            {sched.map((x) => {
              const st = STA(x.stato);
              return (
                <div key={x.id} className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-txt">{(x.guest?.cognome ?? "") + " " + (x.guest?.nome ?? "") || "—"} <span className="text-faint">· {RUOLO[x.ruolo] ?? x.ruolo}</span></div>
                    <div className="text-[11px] text-faint">Arrivo {x.arrival ? new Date(x.arrival).toLocaleDateString("it-IT") : "—"}{x.errors?.length ? ` · ${x.errors.join(", ")}` : ""}{x.ricevuta ? ` · ric. ${x.ricevuta}` : ""}</div>
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.c} 16%, transparent)`, color: st.c }}>{st.l}</span>
                </div>
              );
            })}
            {sched.length === 0 && <p className="py-6 text-center text-sm text-faint">Nessuna schedina. Premi «Sincronizza dagli arrivi».</p>}
          </div>
        </Card>
      </div>
      {msg && <p className="mt-3 text-sm font-medium text-dim">{msg}</p>}
    </div>
  );
}

function STA(k: string) { return ({ da_validare: { l: "Da validare", c: "var(--warn)" }, pronta: { l: "Pronta", c: "var(--focus)" }, inviata: { l: "Inviata", c: "var(--ok)" }, errore: { l: "Errore", c: "var(--err)" } } as Record<string, { l: string; c: string }>)[k] ?? { l: k, c: "var(--dim)" }; }
