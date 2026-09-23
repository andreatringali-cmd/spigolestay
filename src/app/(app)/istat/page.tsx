"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import Link from "next/link";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { apiPost } from "@/lib/invoicing/client";
import IstatSettingsModal from "./SettingsModal";
import EditBookingModal from "../alloggiati-web/EditBookingModal";

interface Row { id: string; arrival: string; departure: string; provenance: string; guests: number; stato: string; booking_id: string | null }
const STA = (k: string) => ({ pending: { l: "Da inviare", c: "var(--warn)" }, sent: { l: "Inviato", c: "var(--dim)" }, error: { l: "Errore", c: "var(--err)" } } as Record<string, { l: string; c: string }>)[k] ?? { l: k, c: "var(--dim)" };

export default function IstatPage() {
  const { structures, activeStructureId, bookings, roomTypes, units, guests } = useData();
  const [sid, setSid] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [filterDate, setFilterDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const [openG, setOpenG] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editBooking, setEditBooking] = useState<string | null>(null);
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

  // Movimento sempre allineato alle prenotazioni; gli arrivi futuri non sono "da inviare".
  const activeBookingIds = new Set(bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked").map((b) => b.id));
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const rowsVisible = rows.filter((r) => (r.stato === "sent" || !r.booking_id || activeBookingIds.has(r.booking_id)) && (r.stato === "sent" || (r.arrival || "") <= todayIso));
  const pending = rowsVisible.filter((r) => r.stato === "pending").length;
  const sent = rowsVisible.filter((r) => r.stato === "sent").length;
  const nightsBetween = (ci?: string, co?: string) => { if (!ci || !co) return 0; const a = new Date(ci + "T00:00"), b = new Date(co + "T00:00"); return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000)); };
  const presenze = rowsVisible.reduce((acc, r) => acc + nightsBetween(r.arrival, r.departure) * (r.guests || 1), 0);
  // Chiusura giornaliera (stile Turist@t): situazione del giorno selezionato (default oggi).
  const dayISO = filterDate || todayIso;
  const actB = bookings.filter((b) => b.structureId === sid && b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked");
  const paxOf = (b: typeof bookings[number]) => (b.adults ?? 1) + (b.children ?? 0);
  const arrivati = actB.filter((b) => b.checkIn === dayISO).reduce((a, b) => a + paxOf(b), 0);
  const partiti = actB.filter((b) => b.checkOut === dayISO).reduce((a, b) => a + paxOf(b), 0);
  const presenti = actB.filter((b) => b.checkIn <= dayISO && dayISO < b.checkOut).reduce((a, b) => a + paxOf(b), 0);
  const camereOcc = actB.filter((b) => b.checkIn <= dayISO && dayISO < b.checkOut).length;
  const totCamere = units.filter((u) => u.structureId === sid).length;

  const bookingById = new Map(bookings.map((b) => [b.id, b]));
  const guestById = new Map(guests.map((g) => [g.id, g]));
  const roomName = (rtId?: string) => roomTypes.find((rt) => rt.id === rtId)?.name ?? "";
  const unitName = (uid?: string | null) => units.find((u) => u.id === uid)?.name ?? "";
  const CH: Record<string, string> = { direct: "Diretta", booking: "Booking", airbnb: "Airbnb", expedia: "Expedia", ical: "iCal", other: "Altro/OTA", blocked: "Bloccata" };
  const ageOn = (birth?: string, on?: string) => { if (!birth) return ""; const d = new Date(birth); const t = new Date((on || todayIso) + "T00:00"); let a = t.getFullYear() - d.getFullYear(); if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--; return a >= 0 && a < 130 ? String(a) : ""; };

  // Navigazione "Data corrente soggiorni" (come Turist@t): giorno per giorno.
  const shiftDay = (n: number) => { const d = new Date((filterDate || todayIso) + "T00:00"); d.setDate(d.getDate() + n); setFilterDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); };
  const dayPending = rowsVisible.filter((r) => r.stato === "pending" && (!filterDate || r.arrival === filterDate)).length;

  // Chiudi giornata: invia il movimento del giorno selezionato, poi avanza al giorno dopo (come il portale).
  const chiudiGiornata = async () => {
    setBusy("close"); setMsg("");
    try { const r = await apiPost<{ message?: string; sent?: number }>("istat/close", { structureId: sid, day: filterDate || todayIso }); setMsg(r.message || "Giornata chiusa."); await load(); if (r.sent) shiftDay(1); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };

  // CSV per-ospite (stile check-in Turist@t): permanenza, camera, età, sesso, cittadinanza, nascita, residenza.
  const exportCsv = () => {
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ["Data arrivo", "Tipo", "Permanenza (notti)", "Camera", "Età", "Sesso", "Cittadinanza", "Luogo di nascita", "Luogo di residenza"];
    const src = filterDate ? rowsVisible.filter((r) => (r.arrival || "") === filterDate) : rowsVisible;
    const out: string[][] = [];
    for (const r of src) {
      const b = r.booking_id ? bookingById.get(r.booking_id) : undefined;
      const nn = nightsBetween(r.arrival, r.departure);
      const cam = b ? unitName(b.unitId) || roomName(b.roomTypeId) : "";
      const g = b ? guestById.get(b.guestId) : undefined; const pg = b?.primaryGuest ?? {};
      out.push([r.arrival, "Principale", String(nn), cam, ageOn(g?.birthDate ?? pg.birthDate, r.arrival), (g?.sex ?? pg.sex) ?? "", g?.citizenship ?? pg.citizenship ?? r.provenance, g?.birthPlace ?? pg.birthPlace ?? "", g?.province ?? g?.country ?? ""]);
      for (const c of b?.extraGuests ?? []) out.push([r.arrival, "Ospite", String(nn), cam, ageOn(c.birthDate, r.arrival), c.sex ?? "", c.citizenship ?? "", c.birthPlace ?? "", ""]);
    }
    const lines = [head.join(";"), ...out.map((row) => row.map(esc).join(";"))];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const st = structures.find((x) => x.id === sid);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `movimento-istat-${(st?.name || "struttura").replace(/[^A-Za-z0-9_-]/g, "_")}-${filterDate || "tutto"}.csv`;
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

      {/* Chiusura giornaliera: situazione del giorno selezionato (come Turist@t) */}
      <div className="mb-1 flex items-center gap-2 text-xs text-faint">
        <span>Situazione del <b className="text-dim">{new Date(dayISO).toLocaleDateString("it-IT")}</b></span>
        <span>· presenze totali periodo: <b className="text-dim">{presenze}</b> notti · {pending > 0 ? <span className="text-[color:var(--warn)]">{pending} da inviare</span> : <span>{sent} inviati</span>}</span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Ospiti arrivati", String(arrivati), "var(--ok)"],
          ["Ospiti partiti", String(partiti), "var(--dim)"],
          ["Ospiti presenti", String(presenti), "var(--focus)"],
          ["Camere occupate", `${camereOcc}/${totCamere}`, camereOcc > 0 ? "var(--warn)" : "var(--dim)"],
        ].map(([lab, val, col]) => (
          <div key={lab} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{lab}</div>
            <div className="mt-1 font-mono text-2xl font-bold" style={{ color: col }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Barra "Data corrente soggiorni" (come Turist@t): navigazione giornata + azioni */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        <span className="text-[11px] font-medium text-dim">Data corrente soggiorni:</span>
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-line">
          <button onClick={() => shiftDay(-1)} className="px-2 py-1.5 text-dim hover:bg-wash" title="Giorno precedente">‹</button>
          <input type="date" value={filterDate || todayIso} onChange={(e) => setFilterDate(e.target.value)} className="border-x border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none" />
          <button onClick={() => shiftDay(1)} className="px-2 py-1.5 text-dim hover:bg-wash" title="Giorno successivo">›</button>
        </div>
        <button onClick={() => setFilterDate(todayIso)} className={`${fieldCls} font-semibold hover:bg-wash`}>Oggi</button>
        <button onClick={() => setFilterDate("")} className={`${fieldCls} hover:bg-wash ${filterDate ? "" : "opacity-40"}`} title="Mostra tutto il movimento">Tutte</button>
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <Link href="/istat/archivio" className={`${fieldCls} font-semibold hover:bg-wash`} title="Archivio invii: storico delle chiusure giornaliere">📁 Archivio</Link>
        <button onClick={exportCsv} disabled={rowsVisible.length === 0} className={`${fieldCls} font-semibold hover:bg-wash disabled:opacity-50`} title="Scarica il movimento in CSV (dettaglio per ospite)">⬇ Scarica CSV</button>
        <button onClick={chiudiGiornata} disabled={!!busy || dayPending === 0} className="ml-auto rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" title="Chiudi e invia il movimento del giorno al portale regionale">{busy === "close" ? "Invio…" : `Chiudi giornata (${dayPending})`}</button>
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
              // Vista giornaliera (come Turist@t): mostra arrivi, partenze e presenti del giorno.
              const listShown = filterDate ? rowsVisible.filter((r) => r.arrival === filterDate || r.departure === filterDate || ((r.arrival || "") < filterDate && filterDate < (r.departure || ""))) : rowsVisible;
              if (!listShown.length && filterDate) return (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <p className="text-sm text-faint">Nessun movimento in questa giornata.</p>
                  <button onClick={() => setFilterDate("")} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash">Mostra tutto il movimento</button>
                </div>
              );
              const structName = structures.find((z) => z.id === sid)?.name ?? "";
              const ROLE = (r: Row): { l: string; c: string } | null => !filterDate ? null : r.arrival === filterDate ? { l: "Arrivo", c: "var(--ok)" } : r.departure === filterDate ? { l: "Partenza", c: "var(--dim)" } : { l: "Presente", c: "var(--focus)" };
              return listShown.map((r) => {
                const st = STA(r.stato);
                const role = ROLE(r);
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
                          {role && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${role.c} 16%, transparent)`, color: role.c }}>{role.l}</span>}
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
                        <div className="mt-2 flex justify-end"><button type="button" onClick={() => bk && setEditBooking(bk.id)} disabled={!bk} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg> Modifica dati</button></div>
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
      {editBooking && <EditBookingModal bookingId={editBooking} onClose={() => { setEditBooking(null); setTimeout(() => void runAuto(), 6500); }} />}
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
