"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { apiPost } from "@/lib/invoicing/client";
import IstatSettingsModal from "./SettingsModal";

interface Row { id: string; arrival: string; departure: string; provenance: string; guests: number; stato: string; booking_id: string | null }
const STA = (k: string) => ({ pending: { l: "Da inviare", c: "var(--warn)" }, sent: { l: "Inviato", c: "var(--dim)" }, error: { l: "Errore", c: "var(--err)" } } as Record<string, { l: string; c: string }>)[k] ?? { l: k, c: "var(--dim)" };

export default function IstatPage() {
  const { structures, activeStructureId, bookings, roomTypes } = useData();
  const [sid, setSid] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [filterDate, setFilterDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const [openG, setOpenG] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conn, setConn] = useState<{ configured?: boolean; auto?: boolean; partner?: string }>({});

  useEffect(() => {
    const target = activeStructureId !== "all" && structures.some((x) => x.id === activeStructureId) ? activeStructureId : structures[0]?.id ?? "";
    if (target && target !== sid) setSid(target);
  }, [structures, activeStructureId, sid]);

  const load = useCallback(async () => {
    if (!supabase || !sid) return;
    const { data } = await supabase.from("istat_rows").select("id, arrival, departure, provenance, guests, stato, booking_id").eq("structure_id", sid).order("arrival", { ascending: false });
    setRows((data ?? []) as Row[]);
    try { const { data: st } = await supabase.from("istat_settings").select("username, auto_daily, partner").eq("structure_id", sid).maybeSingle(); setConn({ configured: !!st?.username, auto: !!st?.auto_daily, partner: st?.partner ?? "portale regionale" }); } catch { setConn({}); }
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  // AUTO all'apertura: rigenera il movimento dagli arrivi, poi ricarica.
  const [autoBusy, setAutoBusy] = useState(false);
  const runAuto = useCallback(async () => {
    if (!sid) return;
    setAutoBusy(true); setMsg("");
    try { await apiPost("istat/sync", { structureId: sid }); } catch {}
    try { await load(); } catch {}
    setAutoBusy(false);
  }, [sid, load]);
  const autoDone = useRef("");
  useEffect(() => { if (sid && autoDone.current !== sid) { autoDone.current = sid; void runAuto(); } }, [sid, runAuto]);

  const call = async (label: string, path: string) => {
    setBusy(label); setMsg("");
    try { const r = await apiPost<{ message?: string; count?: number; sent?: number }>(`istat/${path}`, { structureId: sid }); setMsg(r.message || `OK${r.count != null ? ` (${r.count})` : ""}${r.sent != null ? ` — inviati ${r.sent}` : ""}`); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };

  // Movimento sempre allineato alle prenotazioni; gli arrivi futuri non sono "da inviare".
  const activeBookingIds = new Set(bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked").map((b) => b.id));
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const rowsVisible = rows.filter((r) => (r.stato === "sent" || !r.booking_id || activeBookingIds.has(r.booking_id)) && (r.stato === "sent" || (r.arrival || "") <= todayIso));
  const pending = rowsVisible.filter((r) => r.stato === "pending").length;
  const sent = rowsVisible.filter((r) => r.stato === "sent").length;
  const nightsBetween = (ci?: string, co?: string) => { if (!ci || !co) return 0; const a = new Date(ci + "T00:00"), b = new Date(co + "T00:00"); return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000)); };
  const presenze = rowsVisible.reduce((acc, r) => acc + nightsBetween(r.arrival, r.departure) * (r.guests || 1), 0);
  const inHouse = bookings.filter((b) => b.structureId === sid && b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" && b.checkIn <= todayIso && todayIso < b.checkOut).reduce((a, b) => a + (b.adults ?? 1) + (b.children ?? 0), 0);

  const bookingById = new Map(bookings.map((b) => [b.id, b]));
  const roomName = (rtId?: string) => roomTypes.find((rt) => rt.id === rtId)?.name ?? "";
  const CH: Record<string, string> = { direct: "Diretta", booking: "Booking", airbnb: "Airbnb", expedia: "Expedia", ical: "iCal", other: "Altro/OTA", blocked: "Bloccata" };

  const exportCsv = () => {
    const head = ["Arrivo", "Partenza", "Notti", "Ospiti", "Provenienza", "Stato"];
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const src = filterDate ? rowsVisible.filter((r) => (r.arrival || "") === filterDate) : rowsVisible;
    const lines = [head.join(";"), ...src.map((r) => [r.arrival, r.departure, nightsBetween(r.arrival, r.departure), r.guests, r.provenance, STA(r.stato).l].map(esc).join(";"))];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const st = structures.find((x) => x.id === sid);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `movimento-istat-${(st?.name || "struttura").replace(/[^A-Za-z0-9_-]/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const fieldCls = "rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus";
  const tot = pending + sent;

  const statusPills = (
    <div className="flex flex-wrap items-center gap-2">
      {conn.configured ? (
        <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "color-mix(in srgb, var(--ok) 35%, transparent)", backgroundColor: "color-mix(in srgb, var(--ok) 12%, transparent)", color: "var(--ok)" }}>
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: "var(--ok)" }} /><span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--ok)" }} /></span>
          Collegato al portale regionale
        </span>
      ) : (
        <button onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold hover:opacity-90" style={{ borderColor: "color-mix(in srgb, var(--warn) 35%, transparent)", backgroundColor: "color-mix(in srgb, var(--warn) 12%, transparent)", color: "var(--warn)" }} title="Apri le impostazioni per configurare il portale regionale">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--warn)" }} />
          Portale non configurato · configura ⚙
        </button>
      )}
      {conn.auto ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "color-mix(in srgb, var(--focus) 35%, transparent)", backgroundColor: "color-mix(in srgb, var(--focus) 12%, transparent)", color: "var(--focus)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          Invio automatico giornaliero
        </span>
      ) : (
        <button onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-dim hover:bg-wash" title="Attiva l'invio automatico dalle impostazioni">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          Invio automatico spento · attiva
        </button>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title="ISTAT · Turist@t" subtitle="Movimento turistico verso il portale regionale"
        actions={structures.length > 1 && activeStructureId === "all" ? <select value={sid} onChange={(e) => setSid(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt">{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : undefined} />

      {/* Card riepilogo in alto */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Ospiti in struttura", String(inHouse), "var(--ok)"],
          ["Da inviare", `${pending}/${tot}`, "var(--warn)"],
          ["Inviati", `${sent}/${tot}`, "var(--dim)"],
          ["Presenze (notti)", String(presenze), "var(--focus)"],
        ].map(([lab, val, col]) => (
          <div key={lab} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{lab}</div>
            <div className="mt-1 font-mono text-2xl font-bold" style={{ color: col }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Riga filtri */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        <span className="text-[11px] font-medium text-dim">Filtra per arrivo:</span>
        <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className={fieldCls} />
        {filterDate && <button onClick={() => setFilterDate("")} className={`${fieldCls} text-dim hover:bg-wash`} title="Rimuovi filtro">✕</button>}
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <button onClick={exportCsv} disabled={rowsVisible.length === 0} className={`${fieldCls} font-semibold hover:bg-wash disabled:opacity-50`} title="Scarica il movimento in CSV">⬇ Scarica CSV</button>
        <button onClick={() => call("close", "close")} disabled={!!busy || pending === 0} className="ml-auto rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" title="Chiudi e invia il movimento al portale regionale">{busy === "close" ? "Invio…" : `Invia / chiudi (${pending})`}</button>
        <button type="button" onClick={() => setSettingsOpen(true)} title="Impostazioni ISTAT" aria-label="Impostazioni ISTAT" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-dim hover:bg-wash hover:text-txt">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
      </div>

      {/* Movimento turistico a tutta larghezza */}
      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Movimento turistico</SectionTitle>
          {statusPills}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {autoBusy && rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-faint">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/xenora-mark.png" alt="" width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
              <span>Aggiorno il movimento…</span>
              <style>{`@keyframes xpulse{0%,100%{opacity:.5;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}`}</style>
            </div>
          ) : <>
            {autoBusy && rows.length > 0 && (
              <div className="mb-1 flex items-center gap-2 rounded-lg bg-wash px-2.5 py-1.5 text-[11px] text-dim">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/xenora-mark.png" alt="" width={16} height={16} style={{ width: 16, height: 16, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
                <span>Aggiorno il movimento…</span>
                <style>{`@keyframes xpulse{0%,100%{opacity:.5;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}`}</style>
              </div>
            )}
            {(() => {
              const listShown = filterDate ? rowsVisible.filter((r) => (r.arrival || "") === filterDate) : rowsVisible;
              if (!listShown.length && filterDate) return (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <p className="text-sm text-faint">Nessun movimento con arrivo in questa data.</p>
                  <button onClick={() => setFilterDate("")} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash">Mostra tutto il movimento</button>
                </div>
              );
              const structName = structures.find((z) => z.id === sid)?.name ?? "";
              return listShown.map((r) => {
                const st = STA(r.stato);
                const bk = r.booking_id ? bookingById.get(r.booking_id) : undefined;
                const nn = nightsBetween(r.arrival, r.departure);
                const opened = openG[r.id] ?? false;
                const rNm = bk ? roomName(bk.roomTypeId) : "";
                const chLab = bk ? (CH[bk.channel] ?? bk.channel) : "";
                return (
                  <div key={r.id} className="border-b border-line last:border-0">
                    <button type="button" onClick={() => setOpenG((m) => ({ ...m, [r.id]: !(m[r.id] ?? false) }))} className="flex w-full items-center gap-2 py-2 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-txt">{r.arrival ? new Date(r.arrival).toLocaleDateString("it-IT") : "—"} → {r.departure ? new Date(r.departure).toLocaleDateString("it-IT") : "—"}</span>
                          {bk?.code && <span className="shrink-0 rounded bg-wash px-1.5 py-0.5 font-mono text-[10px] text-dim">{bk.code}</span>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                          <span>🏠 {structName}</span>
                          {rNm && <span>· 🛏 {rNm}</span>}
                          <span>· 👤 {r.guests}{r.guests === 1 ? " ospite" : " ospiti"}</span>
                          {nn ? <span>· 🌙 {nn} {nn === 1 ? "notte" : "notti"}</span> : null}
                          <span>· 📍 {r.provenance || "—"}</span>
                          {chLab && <span>· {chLab}</span>}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${st.c} 16%, transparent)`, color: st.c }}>{st.l}</span>
                      <span className="shrink-0 text-faint">{opened ? "▾" : "▸"}</span>
                    </button>
                    {opened && (
                      <div className="pb-2 pl-1">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                          <RF label="Arrivo" v={r.arrival ? new Date(r.arrival).toLocaleDateString("it-IT") : ""} />
                          <RF label="Partenza" v={r.departure ? new Date(r.departure).toLocaleDateString("it-IT") : ""} />
                          <RF label="Notti" v={nn ? String(nn) : ""} />
                          <RF label="Ospiti" v={String(r.guests)} />
                          <RF label="Provenienza" v={r.provenance ?? ""} />
                          {rNm ? <RF label="Camera" v={rNm} /> : null}
                          {chLab ? <RF label="Canale" v={chLab} /> : null}
                        </div>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
            {rowsVisible.length === 0 && <EmptyState title="Nessun movimento" sub="Il movimento si genera dagli arrivi delle prenotazioni." />}
          </>}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
          <span className="min-w-0 flex-1">
            {autoBusy ? <span className="text-faint">Aggiornamento in corso…</span>
              : msg ? <span className="font-medium text-dim">{msg}</span>
              : pending > 0 ? <span className="font-medium text-[color:var(--warn)]">{pending} {pending === 1 ? "movimento" : "movimenti"} da inviare.</span>
              : <span className="text-faint">Movimento in regola.</span>}
          </span>
          <button onClick={runAuto} disabled={!!busy || autoBusy} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-dim hover:bg-wash disabled:opacity-50" title="Rigenera il movimento adesso">↻ Aggiorna</button>
        </div>
      </Card>

      {settingsOpen && <IstatSettingsModal sid={sid} onClose={() => { setSettingsOpen(false); void runAuto(); }} />}
    </div>
  );
}

// Campo in sola lettura (etichetta sopra, valore in riquadro).
function RF({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] font-medium text-dim">{label}</div>
      <div className={`truncate rounded-md border border-line bg-paper px-2 py-1 text-sm ${v ? "text-txt" : "text-faint"}`} title={v || "—"}>{v || "—"}</div>
    </div>
  );
}
