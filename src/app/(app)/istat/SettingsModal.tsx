"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { apiPost } from "@/lib/invoicing/client";

interface Sett { region: string; partner: string; username: string; password_enc: string; auto_daily: boolean; start_from: string; status: string; status_msg: string }
const DEF: Sett = { region: "Sicilia", partner: "Turist@t", username: "", password_enc: "", auto_daily: false, start_from: "", status: "", status_msg: "" };
const REGIONS = ["Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna", "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardia", "Marche", "Molise", "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana", "Trentino-Alto Adige", "Umbria", "Valle d'Aosta", "Veneto"];

// Finestra centrale con le impostazioni ISTAT / portale regionale (si impostano una volta).
export default function IstatSettingsModal({ sid, onClose }: { sid: string; onClose: () => void }) {
  const { structures } = useData();
  const [msid, setMsid] = useState(sid);
  const [s, setS] = useState<Sett>(DEF);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [pw, setPw] = useState("");
  const [hasPw, setHasPw] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);

  const load = useCallback(async () => {
    if (!supabase || !msid) return;
    const { data } = await supabase.from("istat_settings").select("*").eq("structure_id", msid).maybeSingle();
    setS(data ? { ...DEF, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)) as Partial<Sett> } : DEF);
    setHasPw(!!data?.password_enc); setPw(""); setShown(false);
  }, [msid]);
  useEffect(() => { load(); }, [load]);

  const set = (p: Partial<Sett>) => setS((x) => ({ ...x, ...p }));
  const persist = async (over: Partial<Sett> = {}) => {
    await apiPost("istat/settings", { structureId: msid, region: s.region, partner: s.partner, username: s.username, password: pw, auto_daily: s.auto_daily, start_from: s.start_from || null, ...over });
  };
  const save = async () => {
    if (!msid) return;
    setBusy("save"); setMsg("");
    try { await persist(); await load(); setMsg("Impostazioni salvate ✓"); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };
  const setAuto = async (v: boolean) => {
    if (!msid) return;
    set({ auto_daily: v }); setBusy("auto"); setMsg("");
    try { await persist({ auto_daily: v }); setMsg(v ? "Invio automatico attivato ✓" : "Invio automatico disattivato."); await load(); }
    catch (e) { set({ auto_daily: !v }); setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };

  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-txt">Impostazioni ISTAT · Turist@t</h2>
            <p className="text-[11px] text-faint">Portale regionale del turismo e opzioni di invio — si impostano una volta.</p>
          </div>
          <button onClick={onClose} aria-label="Chiudi" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-dim hover:bg-wash hover:text-txt">✕</button>
        </div>

        {structures.length > 1 && (
          <label className="block"><span className={lbl}>Struttura</span><select value={msid} onChange={(e) => setMsid(e.target.value)} className={inp}>{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        )}
        <div className="mt-2 space-y-2">
          <label className="block"><span className={lbl}>Regione</span><select value={s.region} onChange={(e) => set({ region: e.target.value })} className={inp}>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label className="block"><span className={lbl}>Portale / partner</span><input value={s.partner} onChange={(e) => set({ partner: e.target.value })} placeholder="Turist@t / Ross1000…" className={inp} /></label>
          <label className="block"><span className={lbl}>Username</span><input value={s.username} onChange={(e) => set({ username: e.target.value })} className={inp} /></label>
          <label className="block"><span className={lbl}>Password {hasPw && <span className="ml-1 font-semibold" style={{ color: "var(--ok)" }}>✓ salvata</span>}</span>
            <div className="relative">
              <input type={shown ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={hasPw ? "•••••••• (lascia vuoto per non cambiarla)" : "Password"} className={`${inp} pr-10`} />
              <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? "Nascondi" : "Mostra"} className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-txt">
                {shown ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>}
              </button>
            </div>
          </label>
          <label className="block"><span className={lbl}>Elabora i dati a partire dal</span><input type="date" value={s.start_from?.slice(0, 10) ?? ""} onChange={(e) => set({ start_from: e.target.value })} className={inp} /></label>
          <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-faint">Opzioni</div>
          <label className="flex items-center justify-between"><span className="text-sm text-txt">Invio automatico giornaliero</span><input type="checkbox" checked={s.auto_daily} onChange={(e) => setAuto(e.target.checked)} disabled={!!busy} className="mr-2 h-4 w-4 accent-[color:var(--focus)]" /></label>
          <span className="block text-[11px] text-faint">{s.auto_daily ? "Attivo: il movimento viene chiuso e inviato ogni giorno in automatico." : "Spento: chiudi e invii tu con «Invia / chiudi»."}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={save} disabled={!!busy} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "save" ? "Salvataggio…" : "Salva"}</button>
        </div>
        {msg && <p className="mt-3 text-sm font-medium text-dim">{msg}</p>}
        <div className="mt-3 border-t border-line pt-3 text-sm">
          <span className="text-dim">Stato: </span>
          {s.status === "attivata" ? <span className="font-semibold text-[color:var(--ok)]">✔ Attivo</span> : s.status === "errore" ? <span className="font-semibold text-[color:var(--err)]">✕ Errore</span> : s.username ? <span className="font-semibold text-[color:var(--focus)]">Configurato</span> : <span className="text-faint">non configurato</span>}
        </div>
      </div>
    </div>
  );
}
