"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { apiPost } from "@/lib/invoicing/client";

interface Sett { username: string; password_enc: string; ws_code_enc: string; ws_code_expires_at: string; auto_daily: boolean; group_guests: boolean; group_by_room: boolean; status: string; status_msg: string }
const DEF: Sett = { username: "", password_enc: "", ws_code_enc: "", ws_code_expires_at: "", auto_daily: false, group_guests: true, group_by_room: false, status: "", status_msg: "" };

// Impostazioni account Alloggiati Web (pagina dedicata: una volta impostate non servono più).
export default function AlloggiatiImpostazioniPage() {
  const { structures, activeStructureId } = useData();
  const [sid, setSid] = useState("");
  const [s, setS] = useState<Sett>(DEF);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [pw, setPw] = useState("");
  const [ws, setWs] = useState("");
  const [hasPw, setHasPw] = useState(false);
  const [hasWs, setHasWs] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const target = activeStructureId !== "all" && structures.some((x) => x.id === activeStructureId) ? activeStructureId : structures[0]?.id ?? "";
    if (target && target !== sid) setSid(target);
  }, [structures, activeStructureId, sid]);

  const load = useCallback(async () => {
    if (!supabase || !sid) return;
    const { data } = await supabase.from("alloggiati_settings").select("*").eq("structure_id", sid).maybeSingle();
    setS(data ? { ...DEF, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)) as Partial<Sett> } : DEF);
    setHasPw(!!data?.password_enc); setHasWs(!!data?.ws_code_enc); setShown(false);
    if (data?.password_enc || data?.ws_code_enc) {
      try { const r = await apiPost<{ password?: string; wsCode?: string }>("alloggiati/settings", { structureId: sid, action: "reveal" }); setPw(r.password ?? ""); setWs(r.wsCode ?? ""); }
      catch { setPw(""); setWs(""); }
    } else { setPw(""); setWs(""); }
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const set = (p: Partial<Sett>) => setS((x) => ({ ...x, ...p }));
  const save = async () => {
    if (!sid) return;
    setBusy("save"); setMsg("");
    try {
      await apiPost("alloggiati/settings", { structureId: sid, username: s.username, password: pw, wsCode: ws, ws_code_expires_at: s.ws_code_expires_at || null, auto_daily: s.auto_daily, group_guests: s.group_guests, group_by_room: s.group_by_room });
      await load(); setMsg("Impostazioni salvate ✓");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };
  const setAuto = async (v: boolean) => {
    if (!sid) return;
    set({ auto_daily: v });
    setBusy("auto"); setMsg("");
    try {
      await apiPost("alloggiati/settings", { structureId: sid, username: s.username, password: pw, wsCode: ws, ws_code_expires_at: s.ws_code_expires_at || null, auto_daily: v, group_guests: s.group_guests, group_by_room: s.group_by_room });
      setMsg(v ? "Invio automatico attivato ✓" : "Invio automatico disattivato."); await load();
    } catch (e) { set({ auto_daily: !v }); setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };
  const call = async (label: string, path: string) => {
    setBusy(label); setMsg("");
    try { const r = await apiPost<{ message?: string }>(`alloggiati/${path}`, { structureId: sid }); setMsg(r.message || "OK"); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };
  const toggleShow = () => setShown((v) => !v);

  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";
  const wsExpSoon = s.ws_code_expires_at && new Date(s.ws_code_expires_at) < new Date(Date.now() + 30 * 86400000);

  return (
    <div>
      <PageHeader title="Impostazioni Alloggiati Web" subtitle="Credenziali del Portale Alloggiati e opzioni di invio"
        actions={<Link href="/alloggiati-web" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">← Torna alle schedine</Link>} />
      <div className="mx-auto max-w-2xl">
        <Card>
          <SectionTitle>Impostazioni account</SectionTitle>
          {structures.length > 1 && (
            <label className="mt-2 block"><span className={lbl}>Struttura</span><select value={sid} onChange={(e) => setSid(e.target.value)} className={inp}>{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          )}
          <div className="mt-2 space-y-2">
            <label className="block"><span className={lbl}>Username (es. SR001860)</span><input value={s.username} onChange={(e) => set({ username: e.target.value })} className={inp} /></label>
            <label className="block"><span className={lbl}>Password {hasPw && <span className="ml-1 font-semibold" style={{ color: "var(--ok)" }}>✓ salvata</span>}</span>
              <div className="relative">
                <input type={shown ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className={`${inp} pr-10`} />
                <button type="button" onClick={toggleShow} title={shown ? "Nascondi password" : "Mostra password"} aria-label={shown ? "Nascondi password" : "Mostra password"} className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-txt">
                  {shown ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </label>
            <label className="block"><span className={lbl}>Webservice Code {hasWs && <span className="ml-1 font-semibold" style={{ color: "var(--ok)" }}>✓ salvato</span>}</span><input value={ws} onChange={(e) => setWs(e.target.value)} placeholder="Incolla il Webservice Code" className={`${inp} font-mono text-[11px]`} /></label>
            <label className="block"><span className={lbl}>Scadenza Webservice Code</span><input type="date" value={s.ws_code_expires_at?.slice(0, 10) ?? ""} onChange={(e) => set({ ws_code_expires_at: e.target.value })} className={inp} />{wsExpSoon && <span className="mt-1 block text-[11px] font-semibold text-[color:var(--warn)]">⚠️ In scadenza: rigenera il codice sul portale Alloggiati.</span>}</label>
            <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-faint">Opzioni</div>
            <label className="flex items-center justify-between"><span className="text-sm text-txt">Raggruppa ospiti (capofamiglia + membri)</span><input type="checkbox" checked={s.group_guests} onChange={(e) => set({ group_guests: e.target.checked })} className="mr-2 h-4 w-4 accent-[color:var(--focus)]" /></label>
            <label className="flex items-center justify-between"><span className="text-sm text-txt">Raggruppa per camera</span><input type="checkbox" checked={s.group_by_room} onChange={(e) => set({ group_by_room: e.target.checked })} className="mr-2 h-4 w-4 accent-[color:var(--focus)]" /></label>
            <label className="flex items-center justify-between"><span className="text-sm text-txt">Invio automatico alla Questura</span><input type="checkbox" checked={s.auto_daily} onChange={(e) => setAuto(e.target.checked)} disabled={!!busy} className="mr-2 h-4 w-4 accent-[color:var(--focus)]" /></label>
            <span className="block text-[11px] text-faint">{s.auto_daily ? "Attivo: le schedine pronte partono da sole alle 23:00 (entro 24h di legge)." : "Spento: le invii tu con «Invia le pronte»."}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={save} disabled={!!busy} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "save" ? "Salvataggio…" : "Salva"}</button>
            <button onClick={() => call("test", "test")} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "test" ? "Test…" : "Test connessione"}</button>
            <button onClick={() => call("tabelle", "tabelle")} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50" title="Scarica dal portale i codici ufficiali di comuni, stati e documenti">{busy === "tabelle" ? "Aggiorno…" : "Aggiorna tabelle codici"}</button>
          </div>
          {msg && <p className="mt-3 text-sm font-medium text-dim">{msg}</p>}
          <div className="mt-3 border-t border-line pt-3 text-sm">
            <span className="text-dim">Stato connessione al portale Alloggiati: </span>
            {s.status === "attivata" ? <span className="font-semibold text-[color:var(--ok)]">✔ Attivata</span> : s.status === "errore" ? <span className="font-semibold text-[color:var(--err)]">✕ Errore</span> : <span className="text-faint">non verificata</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}
