"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { apiPost } from "@/lib/invoicing/client";

interface Sett { username: string; password_enc: string; ws_code_enc: string; ws_code_expires_at: string; auto_daily: boolean; group_guests: boolean; group_by_room: boolean; status: string; status_msg: string }
const DEF: Sett = { username: "", password_enc: "", ws_code_enc: "", ws_code_expires_at: "", auto_daily: false, group_guests: true, group_by_room: false, status: "", status_msg: "" };
interface Sched { id: string; booking_id: string; arrival: string; guest: { cognome?: string; nome?: string }; ruolo: string; stato: string; errors: string[] | null; ricevuta: string | null }

const RUOLO: Record<string, string> = { "16": "Singolo", "17": "Capofamiglia", "18": "Capogruppo", "19": "Familiare", "20": "Membro" };

export default function AlloggiatiWebPage() {
  const { structures, activeStructureId, bookings } = useData();
  const [sid, setSid] = useState("");
  const [s, setS] = useState<Sett>(DEF);
  const [sched, setSched] = useState<Sched[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  // Credenziali: mai pre-caricate nel client (sono cifrate sul server). L'utente
  // digita solo per impostarle/cambiarle; campo vuoto = mantieni quella salvata.
  const [pw, setPw] = useState("");
  const [ws, setWs] = useState("");
  const [hasPw, setHasPw] = useState(false);
  const [hasWs, setHasWs] = useState(false);
  const [shown, setShown] = useState(false); // "Mostra credenziali": recupera i valori in chiaro (solo per il proprietario)
  const [ricDate, setRicDate] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []); // countdown vivo (ogni minuto)

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
    setHasPw(!!st.data?.password_enc); setHasWs(!!st.data?.ws_code_enc); setShown(false);
    // Credenziali salvate: le recupero decifrate (solo proprietario). La password resta
    // mascherata a pallini neri (type=password) finché non premi l'occhio; il WS è in chiaro.
    if (st.data?.password_enc || st.data?.ws_code_enc) {
      try { const r = await apiPost<{ password?: string; wsCode?: string }>("alloggiati/settings", { structureId: sid, action: "reveal" }); setPw(r.password ?? ""); setWs(r.wsCode ?? ""); }
      catch { setPw(""); setWs(""); }
    } else { setPw(""); setWs(""); }
    setSched((sc.data ?? []) as Sched[]);
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  const set = (p: Partial<Sett>) => setS((x) => ({ ...x, ...p }));
  const save = async () => {
    if (!sid) return;
    setBusy("save"); setMsg("");
    try {
      // La cifratura di password/WS code avviene lato server nella route.
      await apiPost("alloggiati/settings", { structureId: sid, username: s.username, password: pw, wsCode: ws, ws_code_expires_at: s.ws_code_expires_at || null, auto_daily: s.auto_daily, group_guests: s.group_guests, group_by_room: s.group_by_room });
      await load(); setMsg("Impostazioni salvate ✓");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };
  // Interruttore invio automatico: salva subito (senza premere "Salva").
  const setAuto = async (v: boolean) => {
    if (!sid) return;
    set({ auto_daily: v });
    setBusy("auto"); setMsg("");
    try {
      await apiPost("alloggiati/settings", { structureId: sid, username: s.username, password: pw, wsCode: ws, ws_code_expires_at: s.ws_code_expires_at || null, auto_daily: v, group_guests: s.group_guests, group_by_room: s.group_by_room });
      setMsg(v ? "Invio automatico attivato ✓" : "Invio automatico disattivato.");
      await load();
    } catch (e) { set({ auto_daily: !v }); setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };
  const call = async (label: string, path: string, body: Record<string, unknown> = {}) => {
    setBusy(label); setMsg("");
    try { const r = await apiPost<{ message?: string; count?: number; sent?: number }>(`alloggiati/${path}`, { structureId: sid, ...body }); setMsg(r.message || `OK${r.count != null ? ` (${r.count})` : ""}${r.sent != null ? ` — inviate ${r.sent}` : ""}`); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };
  // Mostra/nascondi le credenziali salvate (decifrate lato server, solo proprietario).
  const toggleShow = () => setShown((v) => !v); // la password è già caricata (mascherata): l'occhio mostra/nasconde

  // Scarica la ricevuta PDF di una data (integrazione reale attiva).
  const getRicevuta = async () => {
    if (!ricDate) { setMsg("Scegli una data per la ricevuta."); return; }
    setBusy("ricevuta"); setMsg("");
    try {
      const r = await apiPost<{ ok: boolean; message?: string; pdfBase64?: string }>("alloggiati/ricevuta", { structureId: sid, date: ricDate });
      if (r.pdfBase64) {
        const a = document.createElement("a");
        a.href = `data:application/pdf;base64,${r.pdfBase64}`;
        a.download = `ricevuta-alloggiati-${ricDate}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setMsg("Ricevuta scaricata ✓");
      } else setMsg(r.message || "Ricevuta non disponibile.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };

  // Registro sempre allineato alle prenotazioni: le schedine non ancora inviate di prenotazioni
  // annullate/no-show/sparite non compaiono (le inviate restano come storico). La pulizia DB
  // avviene alla prossima "Sincronizza dagli arrivi"; qui il filtro è immediato.
  const activeBookingIds = new Set(bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked").map((b) => b.id));
  const visibleSched = sched.filter((x) => x.stato === "inviata" || !x.booking_id || activeBookingIds.has(x.booking_id));
  const todayLocal = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const isFuture = (arrivalISO?: string) => (arrivalISO || "") > todayLocal;
  // "Pronte da inviare" = solo arrivi già avvenuti: la schedina si invia DOPO l'arrivo.
  const readyCount = visibleSched.filter((x) => x.stato === "pronta" && !isFuture(x.arrival)).length;
  const upcomingCount = visibleSched.filter((x) => x.stato !== "inviata" && isFuture(x.arrival)).length;
  const toValidate = visibleSched.filter((x) => x.stato === "da_validare" && !isFuture(x.arrival)).length;
  const sentCount = visibleSched.filter((x) => x.stato === "inviata").length;
  // Scadenza legale (art. 109 TULPS): la schedina va inviata alla Questura ENTRO 24h dall'arrivo
  // (entro 6h per soggiorni sotto le 24h). Non avendo l'orario esatto d'arrivo usiamo il giorno
  // successivo all'arrivo come termine mostrato.
  // Termine legale ≈ arrivo + 24h. Senza orario esatto assumiamo arrivo alle 14:00, quindi il
  // giorno successivo alle 14:00 — mostrato come COUNTDOWN vivo (tra Xh Ym / scaduta da …).
  const deadlineDT = (arrivalISO: string) => { const d = new Date(arrivalISO + "T14:00:00"); d.setDate(d.getDate() + 1); return d; };
  const cdText = (arrivalISO: string) => {
    const ms = deadlineDT(arrivalISO).getTime() - now; const over = ms < 0; const a = Math.abs(ms);
    const days = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000), m = Math.floor((a % 3600000) / 60000);
    const lbl = days >= 1 ? `${days}g ${h}h` : h >= 1 ? `${h}h ${m}m` : `${m}m`;
    return over ? `scaduta da ${lbl}` : `tra ${lbl}`;
  };
  const cdTone = (arrivalISO: string): "over" | "soon" | "ok" => { const ms = deadlineDT(arrivalISO).getTime() - now; return ms < 0 ? "over" : ms < 6 * 3600000 ? "soon" : "ok"; };
  const urgColor = (u: string) => (u === "over" ? "var(--err)" : u === "soon" ? "var(--warn)" : "var(--faint)");
  const toSend = visibleSched.filter((x) => x.stato !== "inviata" && x.arrival && !isFuture(x.arrival));
  const nextArrival = toSend.length ? toSend.map((x) => x.arrival).sort()[0] : null;
  const overdueCount = toSend.filter((x) => cdTone(x.arrival) === "over").length;
  // Ospiti attualmente in struttura (arrivati e non ancora ripartiti).
  const inHouse = bookings
    .filter((b) => b.structureId === sid && b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" && b.checkIn <= todayLocal && todayLocal < b.checkOut)
    .reduce((a, b) => a + (b.adults ?? 1) + (b.children ?? 0), 0);
  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";
  const wsExpSoon = s.ws_code_expires_at && new Date(s.ws_code_expires_at) < new Date(Date.now() + 30 * 86400000);

  return (
    <div>
      <PageHeader title="Alloggiati Web" subtitle="Schedine ospiti alla Questura (Portale Alloggiati)"
        actions={structures.length > 1 && activeStructureId === "all" ? <select value={sid} onChange={(e) => setSid(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt">{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : undefined} />

      {/* Card riepilogo in alto */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Ospiti in struttura", String(inHouse), "var(--ok)"],
          ["Schedine pronte", String(readyCount), "var(--focus)"],
          ["Da validare", String(toValidate), "var(--warn)"],
          ["Inviate", String(sentCount), "var(--dim)"],
        ].map(([lab, val, col]) => (
          <div key={lab} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{lab}</div>
            <div className="mt-1 font-mono text-2xl font-bold" style={{ color: col }}>{val}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Impostazioni account</SectionTitle>
          <div className="mt-2">
          <div className="space-y-2">
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
            <label className="flex items-center justify-between"><span className="text-sm text-txt">Invio automatico giornaliero</span><input type="checkbox" checked={s.auto_daily} onChange={(e) => set({ auto_daily: e.target.checked })} className="mr-2 h-4 w-4 accent-[color:var(--focus)]" /></label>
          </div>
          <p className="mt-2 text-[11px] text-faint">L'invio automatico avviene dopo la mezzanotte. Per rientrare nelle 24h di legge puoi forzare l'invio manualmente in qualsiasi momento.</p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={save} disabled={!!busy} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "save" ? "Salvataggio…" : "Salva"}</button>
            <button onClick={() => call("test", "test")} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "test" ? "Test…" : "Test connessione"}</button>
            <button onClick={() => call("tabelle", "tabelle")} disabled={!!busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50" title="Scarica dal portale i codici ufficiali di comuni, stati e documenti">{busy === "tabelle" ? "Aggiorno…" : "Aggiorna tabelle codici"}</button>
          </div>
          <div className="mt-3 border-t border-line pt-3 text-sm">
            <span className="text-dim">Stato connessione al portale Alloggiati: </span>
            {s.status === "attivata" ? <span className="font-semibold text-[color:var(--ok)]">✔ Attivata</span> : s.status === "errore" ? <span className="font-semibold text-[color:var(--err)]">✕ Errore</span> : <span className="text-faint">non verificata</span>}
          </div>
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle>Schedine</SectionTitle>
            <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-dim">Pronte da inviare: {readyCount}{upcomingCount ? ` · in preparazione: ${upcomingCount}` : ""}</span>
          </div>
          {/* Interruttore INVIO AUTOMATICO: quando attivo, il cron invia da solo le schedine
              degli ospiti già arrivati (entro 24h). Quando spento, invii tu con «Invia le pronte». */}
          <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: s.auto_daily ? "var(--ok)" : "var(--line)", background: s.auto_daily ? "color-mix(in srgb, var(--ok) 7%, transparent)" : "var(--paper)" }}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-txt">Invio automatico alla Questura</div>
              <div className="text-[11px] text-faint">{s.auto_daily ? "Attivo: le schedine partono da sole dopo l'arrivo (entro 24h di legge)." : "Spento: le invii tu manualmente con «Invia le pronte»."}</div>
            </div>
            <button type="button" role="switch" aria-checked={s.auto_daily} onClick={() => setAuto(!s.auto_daily)} disabled={!!busy}
              className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50"
              style={{ backgroundColor: s.auto_daily ? "var(--ok)" : "var(--line)" }} title={s.auto_daily ? "Disattiva" : "Attiva"}>
              <span className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition" style={{ transform: s.auto_daily ? "translateX(22px)" : "translateX(2px)" }} />
            </button>
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            <button onClick={() => call("sync", "sync")} disabled={!!busy} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "sync" ? "Sincronizzo…" : "Sincronizza dagli arrivi"}</button>
            <button onClick={() => call("check", "check")} disabled={!!busy || readyCount === 0} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50" title="Controllo preliminare presso il portale, senza inviare">{busy === "check" ? "Controllo…" : "Controlla"}</button>
            <button onClick={() => call("send", "send")} disabled={!!busy || readyCount === 0} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === "send" ? "Invio…" : `Invia le pronte (${readyCount})`}</button>
          </div>
          {nextArrival && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: overdueCount ? "var(--err)" : "var(--warn)", background: `color-mix(in srgb, ${overdueCount ? "var(--err)" : "var(--warn)"} 8%, transparent)` }}>
              <span aria-hidden>⏱</span>
              <span className="text-dim">Invio alla Questura <b className="text-txt">entro 24h dall&apos;arrivo</b> (art. 109 TULPS). Prossima scadenza: <b style={{ color: overdueCount ? "var(--err)" : "var(--warn)" }}>{cdText(nextArrival)}</b>{overdueCount ? ` · ${overdueCount} in ritardo` : ""}.</span>
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <span className="text-[11px] font-medium text-dim">Ricevuta:</span>
            <input type="date" value={ricDate} onChange={(e) => setRicDate(e.target.value)} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />
            <button onClick={getRicevuta} disabled={!!busy} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{busy === "ricevuta" ? "Scarico…" : "Scarica ricevuta"}</button>
          </div>
          <div className="max-h-[52vh] overflow-y-auto">
            {visibleSched.map((x) => {
              const st = STA(x.stato);
              return (
                <div key={x.id} className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-txt">{(x.guest?.cognome ?? "") + " " + (x.guest?.nome ?? "") || "—"} <span className="text-faint">· {RUOLO[x.ruolo] ?? x.ruolo}</span></div>
                    <div className="text-[11px] text-faint">Arrivo {x.arrival ? new Date(x.arrival).toLocaleDateString("it-IT") : "—"}{x.errors?.length ? ` · ${x.errors.join(", ")}` : ""}{x.ricevuta ? ` · ric. ${x.ricevuta}` : ""}{x.stato !== "inviata" && x.arrival ? (isFuture(x.arrival)
  ? <> · <span className="text-faint">in preparazione (si invia dopo l&apos;arrivo)</span></>
  : <> · <span style={{ color: urgColor(cdTone(x.arrival)), fontWeight: 600 }}>{cdTone(x.arrival) === "over" ? "⚠ " : "⏱ "}{cdText(x.arrival)}</span></>) : ""}</div>
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.c} 16%, transparent)`, color: st.c }}>{st.l}</span>
                </div>
              );
            })}
            {visibleSched.length === 0 && <EmptyState title="Nessuna schedina" sub="Premi «Sincronizza dagli arrivi»." />}
          </div>
        </Card>
      </div>
      {msg && <p className="mt-3 text-sm font-medium text-dim">{msg}</p>}
    </div>
  );
}

function STA(k: string) { return ({ da_validare: { l: "Da validare", c: "var(--warn)" }, pronta: { l: "Pronta", c: "var(--focus)" }, inviata: { l: "Inviata", c: "var(--ok)" }, errore: { l: "Errore", c: "var(--err)" } } as Record<string, { l: string; c: string }>)[k] ?? { l: k, c: "var(--dim)" }; }
