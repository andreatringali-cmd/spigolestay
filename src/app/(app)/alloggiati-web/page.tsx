"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { apiPost } from "@/lib/invoicing/client";
import AlloggiatiSettingsModal from "./SettingsModal";
import AlloggiatiArchiveModal from "./ArchiveModal";
import EditBookingModal from "./EditBookingModal";

interface SchedGuest { cognome?: string; nome?: string; sesso?: "M" | "F" | string; dataNascita?: string; comuneNascita?: string; provinciaNascita?: string; statoNascita?: string; cittadinanza?: string; tipoDoc?: string; numeroDoc?: string; luogoRilascio?: string; perm?: number }
interface Sched { id: string; booking_id: string; arrival: string; guest: SchedGuest; ruolo: string; stato: string; errors: string[] | null; ricevuta: string | null }
const RUOLO: Record<string, string> = { "16": "Singolo", "17": "Capofamiglia", "18": "Capogruppo", "19": "Familiare", "20": "Membro" };

export default function AlloggiatiWebPage() {
  const { structures, activeStructureId, bookings, roomTypes } = useData();
  const [sid, setSid] = useState("");
  const [sched, setSched] = useState<Sched[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [filterDate, setFilterDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }); // filtro lista schedine: default = oggi
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []); // countdown vivo (ogni minuto)
  const [openG, setOpenG] = useState<Record<string, boolean>>({}); // schedine a tendina per prenotazione
  const [settingsOpen, setSettingsOpen] = useState(false); // finestra centrale impostazioni
  const [archiveOpen, setArchiveOpen] = useState(false); // archivio invii/ricevute
  const [editBooking, setEditBooking] = useState<string | null>(null); // modale modifica/compilazione dati ospite

  useEffect(() => {
    const target = activeStructureId !== "all" && structures.some((x) => x.id === activeStructureId) ? activeStructureId : structures[0]?.id ?? "";
    if (target && target !== sid) setSid(target);
  }, [structures, activeStructureId, sid]);

  const load = useCallback(async () => {
    if (!supabase || !sid) return;
    const { data } = await supabase.from("alloggiati_schedine").select("id, booking_id, arrival, guest, ruolo, stato, errors, ricevuta").eq("structure_id", sid).order("arrival", { ascending: false });
    setSched((data ?? []) as Sched[]);
  }, [sid]);
  useEffect(() => { load(); }, [load]);

  // AUTO all'apertura: rigenera le schedine dagli arrivi e le verifica col portale, poi ricarica.
  const [autoBusy, setAutoBusy] = useState(false);
  const runAuto = useCallback(async () => {
    if (!sid) return;
    setAutoBusy(true); setMsg("");
    try { await apiPost("alloggiati/sync", { structureId: sid }); } catch {}
    try { const r = await apiPost<{ message?: string }>("alloggiati/check", { structureId: sid }); if (r?.message) setMsg(r.message); } catch {}
    try { await load(); } catch {}
    setAutoBusy(false);
  }, [sid, load]);
  const autoDone = useRef("");
  useEffect(() => { if (sid && autoDone.current !== sid) { autoDone.current = sid; void runAuto(); } }, [sid, runAuto]);

  const call = async (label: string, path: string, body: Record<string, unknown> = {}) => {
    setBusy(label); setMsg("");
    try { const r = await apiPost<{ message?: string; count?: number; sent?: number }>(`alloggiati/${path}`, { structureId: sid, ...body }); setMsg(r.message || `OK${r.count != null ? ` (${r.count})` : ""}${r.sent != null ? ` — inviate ${r.sent}` : ""}`); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Errore"); } finally { setBusy(""); }
  };

  // Registro sempre allineato alle prenotazioni: annullate/no-show/sparite non compaiono.
  const activeBookingIds = new Set(bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked").map((b) => b.id));
  const declaredOf = (b: typeof bookings[number]) => ((b.webCheckin || !!(b.primaryGuest?.docNumber && b.primaryGuest?.lastName)) ? 1 : 0) + (b.extraGuests?.length ?? 0);
  const expectedOf = (b: typeof bookings[number]) => Math.max(1, (b.adults ?? 1) + (b.children ?? 0));
  const completeBookingIds = new Set(bookings.filter((b) => activeBookingIds.has(b.id) && declaredOf(b) >= expectedOf(b)).map((b) => b.id));
  const bookingComplete = (id: string | null) => !id || completeBookingIds.has(id);
  const visibleSched = sched.filter((x) => x.stato === "inviata" || !x.booking_id || activeBookingIds.has(x.booking_id));
  const todayLocal = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const isFuture = (arrivalISO?: string) => (arrivalISO || "") > todayLocal;
  const readyCount = visibleSched.filter((x) => x.stato === "pronta" && !isFuture(x.arrival) && bookingComplete(x.booking_id)).length;
  const toValidate = visibleSched.filter((x) => !isFuture(x.arrival) && x.stato !== "inviata" && !(x.stato === "pronta" && bookingComplete(x.booking_id))).length;
  const effStato = (x: { stato: string; booking_id: string | null }) => (x.stato === "pronta" && !bookingComplete(x.booking_id) ? "da_validare" : x.stato);
  const sentCount = visibleSched.filter((x) => x.stato === "inviata").length;
  const listSched = visibleSched.filter((x) => x.stato === "inviata" || !isFuture(x.arrival));
  const errCount = listSched.filter((x) => x.stato !== "inviata" && ((x.errors?.length ?? 0) > 0 || (x.stato === "pronta" && !bookingComplete(x.booking_id)) || x.stato === "da_validare")).length;
  // Termine legale ≈ arrivo + 24h (assunto arrivo 14:00) → countdown vivo.
  const deadlineDT = (arrivalISO: string) => { const d = new Date(arrivalISO + "T14:00:00"); d.setDate(d.getDate() + 1); return d; };
  const cdText = (arrivalISO: string) => {
    const ms = deadlineDT(arrivalISO).getTime() - now; const over = ms < 0; const a = Math.abs(ms);
    const days = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000), m = Math.floor((a % 3600000) / 60000);
    const lbl = days >= 1 ? `${days}g ${h}h` : h >= 1 ? `${h}h ${m}m` : `${m}m`;
    return over ? `scaduta da ${lbl}` : `tra ${lbl}`;
  };
  const cdTone = (arrivalISO: string): "over" | "soon" | "ok" => { const ms = deadlineDT(arrivalISO).getTime() - now; return ms < 0 ? "over" : ms < 6 * 3600000 ? "soon" : "ok"; };
  const urgColor = (u: string) => (u === "over" ? "var(--err)" : u === "soon" ? "var(--warn)" : "var(--faint)");
  const inHouse = bookings
    .filter((b) => b.structureId === sid && b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" && b.checkIn <= todayLocal && todayLocal < b.checkOut)
    .reduce((a, b) => a + (b.adults ?? 1) + (b.children ?? 0), 0);
  const totSched = readyCount + toValidate + sentCount;
  const fieldCls = "rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus";

  // Dati aggiuntivi per arricchire l'anteprima della schedina (presi dalla prenotazione collegata).
  const bookingById = new Map(bookings.map((b) => [b.id, b]));
  const roomName = (rtId?: string) => roomTypes.find((rt) => rt.id === rtId)?.name ?? "";
  const CH: Record<string, string> = { direct: "Diretta", booking: "Booking", airbnb: "Airbnb", expedia: "Expedia", ical: "iCal", other: "Altro/OTA", blocked: "Bloccata" };
  const nightsBetween = (ci?: string, co?: string) => { if (!ci || !co) return 0; const a = new Date(ci + "T00:00"), b = new Date(co + "T00:00"); return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000)); };

  return (
    <div>
      <PageHeader title="Alloggiati Web" subtitle="Schedine ospiti alla Questura (Portale Alloggiati)"
        actions={structures.length > 1 && activeStructureId === "all" ? <select value={sid} onChange={(e) => setSid(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt">{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : undefined} />

      {/* Card riepilogo in alto */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Ospiti in struttura", String(inHouse), "var(--ok)"],
          ["Schedine pronte", `${readyCount}/${totSched}`, "var(--ok)"],
          ["Da validare", `${toValidate}/${totSched}`, "var(--warn)"],
          ["Inviate", `${sentCount}/${totSched}`, "var(--dim)"],
        ].map(([lab, val, col]) => (
          <div key={lab} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{lab}</div>
            <div className="mt-1 font-mono text-2xl font-bold" style={{ color: col }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Riga filtri (sotto le card): filtro arrivo, ricevuta, invio e ingranaggio → Impostazioni */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        <span className="text-[11px] font-medium text-dim">Filtra per arrivo:</span>
        <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className={fieldCls} />
        {filterDate && <button onClick={() => setFilterDate("")} className={`${fieldCls} text-dim hover:bg-wash`} title="Rimuovi filtro">✕</button>}
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <button onClick={() => setArchiveOpen(true)} className={`${fieldCls} font-semibold hover:bg-wash`} title="Archivio invii: riscarica o stampa le ricevute quando vuoi">📁 Archivio ricevute</button>
        <button onClick={() => call("send", "send")} disabled={!!busy || readyCount === 0} className="ml-auto rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" title="Invia subito alla Questura, senza aspettare l'orario automatico">{busy === "send" ? "Invio…" : `Invia le pronte (${readyCount})`}</button>
        <button type="button" onClick={() => setSettingsOpen(true)} title="Impostazioni account" aria-label="Impostazioni account" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-dim hover:bg-wash hover:text-txt">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
      </div>

      {/* Schedine a tutta larghezza */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Schedine</SectionTitle>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {autoBusy && sched.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-faint">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/xenora-mark.png" alt="" width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
              <span>Aggiorno e verifico le schedine…</span>
              <style>{`@keyframes xpulse{0%,100%{opacity:.5;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}`}</style>
            </div>
          ) : <>
          {autoBusy && sched.length > 0 && (
            <div className="mb-1 flex items-center gap-2 rounded-lg bg-wash px-2.5 py-1.5 text-[11px] text-dim">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/xenora-mark.png" alt="" width={16} height={16} style={{ width: 16, height: 16, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
              <span>Verifico le schedine…</span>
              <style>{`@keyframes xpulse{0%,100%{opacity:.5;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}`}</style>
            </div>
          )}
          {(() => {
            const map = new Map<string, Sched[]>();
            const listShown = filterDate ? listSched.filter((x) => (x.arrival || "") === filterDate) : listSched;
            for (const x of listShown) { const k = x.booking_id || x.id; const a = map.get(k); if (a) a.push(x); else map.set(k, [x]); }
            const structName = structures.find((z) => z.id === sid)?.name ?? "";
            const groups = [...map.entries()].sort((a, b) => ((a[1][0]?.arrival || "") < (b[1][0]?.arrival || "") ? -1 : 1));
            if (!groups.length && filterDate) return (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-sm text-faint">Nessuna schedina con arrivo in questa data.</p>
                <button onClick={() => setFilterDate("")} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash">Mostra tutte le schedine</button>
              </div>
            );
            return groups.map(([key, rows]) => {
              const capo = rows.find((r) => ["16", "17", "18"].includes(r.ruolo)) ?? rows[0];
              const name = `${capo?.guest?.cognome ?? ""} ${capo?.guest?.nome ?? ""}`.trim() || "Ospite";
              const arrival = rows[0]?.arrival;
              const allSent = rows.every((r) => r.stato === "inviata");
              const anyInvalid = rows.some((r) => effStato(r) === "da_validare");
              const gStato = allSent ? "inviata" : anyInvalid ? "da_validare" : "pronta";
              const gst = STA(gStato);
              const opened = openG[key] ?? false;
              const bk = bookingById.get(key);
              const nights = bk ? nightsBetween(bk.checkIn, bk.checkOut) : 0;
              const pax = bk ? (bk.adults ?? 1) + (bk.children ?? 0) : rows.length;
              const rNm = bk ? roomName(bk.roomTypeId) : "";
              const chLab = bk ? (CH[bk.channel] ?? bk.channel) : "";
              return (
                <div key={key} className="border-b border-line last:border-0">
                  <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setOpenG((m) => ({ ...m, [key]: !(m[key] ?? false) }))} className="flex flex-1 items-center gap-2 py-2 text-left">
                    <span className="shrink-0 text-faint">{opened ? "▾" : "▸"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-txt">{name}</span>
                        {bk?.code && <span className="shrink-0 rounded bg-wash px-1.5 py-0.5 font-mono text-[10px] text-dim">{bk.code}</span>}
                        {bk?.groupId && <span className="shrink-0 rounded-full bg-[color:color-mix(in_srgb,var(--focus)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--focus)]">Gruppo</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                        <span>🏠 {structName}</span>
                        {rNm && <span>· 🛏 {rNm}</span>}
                        <span>· 👤 {pax}{pax === 1 ? " ospite" : " ospiti"}{rows.length !== pax ? ` (${rows.length}/${pax} schedine)` : ""}</span>
                        {chLab && <span>· {chLab}</span>}
                      </div>
                      <div className="text-[11px] text-faint">📅 {arrival ? new Date(arrival).toLocaleDateString("it-IT") : "—"}{bk?.checkOut ? ` → ${new Date(bk.checkOut).toLocaleDateString("it-IT")}` : ""}{nights ? ` · ${nights} ${nights === 1 ? "notte" : "notti"}` : ""}{bk?.arrivalTime ? ` · arrivo h ${bk.arrivalTime}` : ""}{gStato !== "inviata" && arrival ? (isFuture(arrival) ? " · in preparazione" : <> · <span style={{ color: urgColor(cdTone(arrival)), fontWeight: 600 }}>{cdTone(arrival) === "over" ? "⚠ " : "⏱ "}{cdText(arrival)}</span></>) : ""}</div>
                    </div>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${gst.c} 16%, transparent)`, color: gst.c }}>{gst.l}</span>
                  </button>
                  {bk && <button type="button" onClick={() => setEditBooking(bk.id)} title="Completa / modifica dati ospite" aria-label="Modifica" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-dim hover:bg-wash hover:text-txt"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg></button>}
                  </div>
                  {opened && (
                    <div className="pb-2 pl-6">
                      {rows.map((x, ri) => { const g = x.guest ?? {};
                        const isCapo = ["16", "17", "18"].includes(x.ruolo);
                        const dob = g.dataNascita ? new Date(g.dataNascita).toLocaleDateString("it-IT") : "";
                        const luogoNascita = [g.comuneNascita, g.provinciaNascita && `(${g.provinciaNascita})`].filter(Boolean).join(" ") || g.statoNascita || "";
                        return (
                        <div key={x.id} className={`py-2 ${ri > 0 ? "border-t border-[color:color-mix(in_srgb,var(--line)_60%,transparent)]" : ""}`}>
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <div className="truncate text-[13px] font-semibold text-txt">{(x.guest?.cognome ?? "") + " " + (x.guest?.nome ?? "") || "—"} <span className="font-normal text-faint">· {RUOLO[x.ruolo] ?? x.ruolo}</span></div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                            <RF label="Sesso" v={g.sesso === "F" ? "F" : g.sesso === "M" ? "M" : ""} />
                            <RF label="Data di nascita" v={dob} />
                            <RF label="Luogo di nascita" v={luogoNascita} />
                            <RF label="Cittadinanza" v={g.cittadinanza ?? ""} />
                            {isCapo ? <>
                              <RF label="Tipo documento" v={g.tipoDoc ?? ""} />
                              <RF label="Numero documento" v={g.numeroDoc ?? ""} />
                              {g.luogoRilascio ? <RF label="Rilasciato a" v={g.luogoRilascio} /> : null}
                            </> : <RF label="Documento" v="non richiesto (familiare/membro)" />}
                          </div>
                          {x.errors?.length ? <div className="mt-1.5 text-[11px] font-medium" style={{ color: "var(--warn)" }}>⚠ {x.errors.join(" · ")}</div> : null}
                          {x.ricevuta ? <div className="mt-1 text-[11px] text-faint">ric. {x.ricevuta}</div> : null}
                        </div>
                      ); })}
                      <div className="mt-1 flex justify-end"><button type="button" onClick={() => bk && setEditBooking(bk.id)} disabled={!bk} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg> Modifica dati</button></div>
                    </div>
                  )}
                </div>
              );
            });
          })()}
          {listSched.length === 0 && <EmptyState title="Nessuna schedina" sub="Le schedine appaiono qui dopo il check-in." />}
          </>}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
          <span className="min-w-0 flex-1">
            {autoBusy
              ? <span className="text-faint">Verifica in corso…</span>
              : msg
                ? <span className="font-medium text-dim">{msg}</span>
                : errCount > 0
                  ? <span className="font-medium text-[color:var(--warn)]">⚠ {errCount} {errCount === 1 ? "schedina" : "schedine"} con errori — apri la prenotazione per correggere.</span>
                  : <span className="text-faint">Nessun errore rilevato.</span>}
          </span>
          <button onClick={runAuto} disabled={!!busy || autoBusy} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-dim hover:bg-wash disabled:opacity-50" title="Rigenera e ricontrolla adesso">↻ Ricontrolla</button>
        </div>
      </Card>

      {settingsOpen && <AlloggiatiSettingsModal sid={sid} onClose={() => { setSettingsOpen(false); void runAuto(); }} />}
      {archiveOpen && <AlloggiatiArchiveModal sid={sid} onClose={() => setArchiveOpen(false)} />}
      {editBooking && <EditBookingModal bookingId={editBooking} onClose={() => { setEditBooking(null); setTimeout(() => void runAuto(), 6500); }} />}
    </div>
  );
}

function STA(k: string) { return ({ da_validare: { l: "Da validare", c: "var(--warn)" }, pronta: { l: "Pronta", c: "var(--ok)" }, inviata: { l: "Inviata", c: "var(--dim)" }, errore: { l: "Errore", c: "var(--err)" } } as Record<string, { l: string; c: string }>)[k] ?? { l: k, c: "var(--dim)" }; }

// Campo in sola lettura (etichetta sopra, valore in riquadro) — dati ospite ben visibili, come nella vecchia pagina.
function RF({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] font-medium text-dim">{label}</div>
      <div className={`truncate rounded-md border border-line bg-paper px-2 py-1 text-sm ${v ? "text-txt" : "text-faint"}`} title={v || "—"}>{v || "—"}</div>
    </div>
  );
}
