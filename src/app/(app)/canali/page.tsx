"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { effectiveBase } from "@/lib/pricing";
import { addDays, isWeekend, toISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import Icon from "@/components/Icon";
import IcalSyncPanel from "@/components/IcalSyncPanel";

// Portali gestiti dal Channel Manager.
const OTAS = [
  { key: "booking", label: "Booking.com", color: "#003580", commission: 15 },
  { key: "airbnb", label: "Airbnb", color: "#FF5A5F", commission: 15 },
  { key: "expedia", label: "Expedia", color: "#FFC72C", commission: 18 },
  { key: "vrbo", label: "Vrbo", color: "#1668E3", commission: 8 },
  { key: "agoda", label: "Agoda", color: "#5A2D8C", commission: 17 },
] as const;
type OtaKey = typeof OTAS[number]["key"];

interface Conn {
  connected: boolean; auto: boolean; lastSync?: string;
  // Configurazione connessione (pannello per canale, stile Octorate)
  hotelId?: string; connType?: string; url?: string;
  priceRound?: boolean; priceAdjMode?: "percent" | "amount"; priceAdj?: number;
  availPct?: number; commissionPct?: number; importFilter?: string;
  otaRooms?: { id: string; name: string }[]; // camere importate dal portale (per la mappatura)
}
const CONN_TYPES = ["iCal (sola lettura)", "XML", "API"];
interface MapEntry { on: boolean; listingId: string; adjMode: "amount" | "percent"; adj: number }
interface LogEntry { id: string; ts: number; text: string; color: string }

const CONN_KEY = "spigolestay:canali:conn";
const MAP_KEY = "spigolestay:canali:map";
const LOG_KEY = "spigolestay:canali:log";
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `x-${Math.floor(performance.now() * 1000)}`);

function Toggle({ on, onClick, color = "var(--focus)" }: { on: boolean; onClick?: () => void; color?: string }) {
  return <button type="button" onClick={onClick} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? color : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>;
}

export default function CanaliPage() {
  const { structures, roomTypes, units, bookings, rateOverrides, activeStructureId } = useData();
  const ask = useConfirm();
  const { t } = useLang();
  const relTime = (ts: number) => {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return t("adesso");
    if (d < 3600) return `${Math.floor(d / 60)} ${t("min fa")}`;
    if (d < 86400) return `${Math.floor(d / 3600)} ${t("h fa")}`;
    return `${Math.floor(d / 86400)} ${t("g fa")}`;
  };
  const [localStructure, setLocalStructure] = useState("all");
  const effStructure = activeStructureId !== "all" ? activeStructureId : localStructure;

  const [conn, setConn] = useState<Record<string, Conn>>({});
  const [map, setMap] = useState<Record<string, MapEntry>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  useEffect(() => {
    try {
      const c = localStorage.getItem(CONN_KEY); if (c) setConn(JSON.parse(c)); else setConn({ booking: { connected: true, auto: true, lastSync: undefined }, airbnb: { connected: true, auto: true } });
      const m = localStorage.getItem(MAP_KEY); if (m) setMap(JSON.parse(m));
      const l = localStorage.getItem(LOG_KEY); if (l) setLog(JSON.parse(l));
    } catch {}
  }, []);
  const saveConn = (next: Record<string, Conn>) => { setConn(next); try { localStorage.setItem(CONN_KEY, JSON.stringify(next)); } catch {} };
  const saveMap = (next: Record<string, MapEntry>) => { setMap(next); try { localStorage.setItem(MAP_KEY, JSON.stringify(next)); } catch {} };
  const saveLog = (next: LogEntry[]) => { setLog(next); try { localStorage.setItem(LOG_KEY, JSON.stringify(next.slice(0, 40))); } catch {} };

  const [configuring, setConfiguring] = useState<OtaKey | null>(null);
  const [view, setView] = useState<"card" | "list">("list");
  // Sincronizzazione reale verso Channex (staging): crea property + camere + tariffe da Xenora.
  const [chxMap, setChxMap] = useState<Record<string, { propertyId: string; rooms?: Record<string, { roomTypeId: string; ratePlanId?: string }>; at: string }>>({});
  const [chxSync, setChxSync] = useState<{ running: boolean; msg?: string; ok?: boolean }>({ running: false });
  const [ariSync, setAriSync] = useState<{ running: boolean; msg?: string; ok?: boolean }>({ running: false });
  useEffect(() => { try { const m = localStorage.getItem("spigolestay:channexmap"); if (m) setChxMap(JSON.parse(m)); } catch {} }, []);
  const unlinkChannex = () => {
    const sid = effStructure;
    const next = { ...chxMap }; delete next[sid];
    setChxMap(next); try { localStorage.setItem("spigolestay:channexmap", JSON.stringify(next)); } catch {}
    setChxSync({ running: false, msg: "Struttura scollegata. Puoi ricrearla su Channex." }); setAriSync({ running: false });
  };
  const syncToChannex = async () => {
    const sid = effStructure;
    const st = structures.find((s) => s.id === sid);
    if (!st) { setChxSync({ running: false, ok: false, msg: "Seleziona una struttura specifica (non 'Tutte')." }); return; }
    // Idempotente: se già collegata, NON creare un doppione. Per aggiornare si usa "Prezzi & disponibilità".
    if (chxMap[sid]) { setChxSync({ running: false, ok: false, msg: "Struttura già collegata a Channex: per aggiornare usa «Prezzi & disponibilità». Per ricrearla, prima «Scollega»." }); return; }
    const rts = roomTypes.filter((rt) => rt.structureId === sid);
    if (rts.length === 0) { setChxSync({ running: false, ok: false, msg: "Nessuna tipologia in questa struttura." }); return; }
    const rooms = rts.map((rt) => ({
      xid: rt.id,
      title: rt.name,
      count: Math.max(1, units.filter((u) => u.roomTypeId === rt.id && !u.outOfService).length),
      occAdults: rt.maxOccupancy ?? rt.beds ?? 2,
      defaultOccupancy: rt.beds ?? 2,
      rate: rt.basePrice ?? 0,
    }));
    const structure = {
      title: st.name, currency: "EUR", country: "IT",
      city: st.city || undefined, address: [st.address, st.streetNumber].filter(Boolean).join(" ") || undefined,
      email: st.email || undefined, phone: st.phone || undefined,
      latitude: st.lat ? String(st.lat) : undefined, longitude: st.lng ? String(st.lng) : undefined,
      logo_url: st.logo || undefined, website: st.website || undefined,
    };
    setChxSync({ running: true, msg: "Creazione su Channex in corso…" });
    try {
      const res = await fetch("/api/channex/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ structure, rooms }) });
      const j = await res.json();
      if (!j.ok) { setChxSync({ running: false, ok: false, msg: `Errore: ${j.error || j.step || "sync fallita"}` }); return; }
      const okRooms = (j.rooms || []).filter((r: { ok: boolean }) => r.ok).length;
      const roomMap: Record<string, { roomTypeId: string; ratePlanId?: string }> = {};
      (j.rooms || []).forEach((r: { xid?: string; roomTypeId?: string; ratePlanId?: string; ok: boolean }) => { if (r.ok && r.xid && r.roomTypeId) roomMap[r.xid] = { roomTypeId: r.roomTypeId, ratePlanId: r.ratePlanId }; });
      const next = { ...chxMap, [sid]: { propertyId: j.propertyId, rooms: roomMap, at: new Date().toISOString() } };
      setChxMap(next); try { localStorage.setItem("spigolestay:channexmap", JSON.stringify(next)); } catch {}
      setChxSync({ running: false, ok: true, msg: `Struttura creata su Channex ✓ · ${okRooms}/${rooms.length} camere` });
      saveLog([{ id: uid(), ts: Date.now(), text: `${t("Struttura sincronizzata su Channex")} — ${st.name}`, color: "var(--ok)" }, ...log]);
    } catch (e) {
      setChxSync({ running: false, ok: false, msg: e instanceof Error ? e.message : "errore di rete" });
    }
  };

  // Invia disponibilità e prezzi dei prossimi 60 giorni a Channex (che li spinge alle OTA).
  const pushAri = async () => {
    const sid = effStructure;
    const map = chxMap[sid];
    if (!map?.rooms) { setAriSync({ running: false, ok: false, msg: "Prima sincronizza la struttura su Channex." }); return; }
    const rts = roomTypes.filter((rt) => rt.structureId === sid && map.rooms![rt.id]);
    if (rts.length === 0) { setAriSync({ running: false, ok: false, msg: "Nessuna camera mappata." }); return; }
    let weekendPct = 25; try { weekendPct = JSON.parse(localStorage.getItem("spigolestay:pricerules") || "{}").weekendPct ?? 25; } catch {}
    const DAYS = 60;
    const base0 = new Date();
    const availability: { property_id: string; room_type_id: string; date: string; availability: number }[] = [];
    const rates: { property_id: string; rate_plan_id: string; date: string; rate: string }[] = [];
    for (const rt of rts) {
      const mp = map.rooms![rt.id];
      const totalUnits = Math.max(1, units.filter((u) => u.roomTypeId === rt.id && !u.outOfService).length);
      for (let d = 0; d < DAYS; d++) {
        const dt = addDays(base0, d);
        const iso = toISO(dt);
        const occupied = bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.roomTypeId === rt.id && b.checkIn <= iso && iso < b.checkOut).length;
        availability.push({ property_id: map.propertyId, room_type_id: mp.roomTypeId, date: iso, availability: Math.max(0, totalUnits - occupied) });
        if (mp.ratePlanId) {
          const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(effectiveBase(rt, roomTypes) * (isWeekend(dt) ? 1 + weekendPct / 100 : 1));
          rates.push({ property_id: map.propertyId, rate_plan_id: mp.ratePlanId, date: iso, rate: Math.max(0, raw).toFixed(2) });
        }
      }
    }
    setAriSync({ running: true, msg: "Invio disponibilità e prezzi…" });
    try {
      const res = await fetch("/api/channex/ari", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ availability, rates }) });
      const j = await res.json();
      if (!j.ok) { setAriSync({ running: false, ok: false, msg: `Errore: ${j.availability?.error || j.rates?.error || j.error || "invio fallito"}` }); return; }
      setAriSync({ running: false, ok: true, msg: `Inviati ✓ · ${j.availability.sent} disponibilità · ${j.rates.sent} prezzi (60 giorni)` });
      saveLog([{ id: uid(), ts: Date.now(), text: `${t("Disponibilità e prezzi inviati a Channex")} — ${structures.find((s) => s.id === sid)?.name ?? ""}`, color: "var(--ok)" }, ...log]);
    } catch (e) {
      setAriSync({ running: false, ok: false, msg: e instanceof Error ? e.message : "errore di rete" });
    }
  };

  const getConn = (k: string): Conn => conn[k] ?? { connected: false, auto: false };
  const patchConn = (k: OtaKey, patch: Partial<Conn>) => saveConn({ ...conn, [k]: { ...getConn(k), ...patch } });
  // Prezzo inviato all'OTA = prezzo base con l'UNICA correzione del canale (uguale per tutte le tipologie).
  const chPrice = (base: number, ota: string) => { const c = getConn(ota); const mode = c.priceAdjMode ?? "percent"; const adj = c.priceAdj ?? 0; const p = mode === "percent" ? base * (1 + adj / 100) : base + adj; return Math.max(0, Math.round(p)); };
  const corrLabel = (ota: string) => { const c = getConn(ota); const adj = c.priceAdj ?? 0; if (!adj) return t("nessuna"); return `${adj > 0 ? "+" : ""}${adj}${(c.priceAdjMode ?? "percent") === "percent" ? "%" : "€"}`; };
  const mappedCount = (ota: string) => types.filter((rt) => getMap(rt.id, ota).on && getMap(rt.id, ota).listingId).length;
  // "Importa camere": popola la lista di camere del portale (demo: usa i nomi delle nostre tipologie).
  const importRooms = (ota: OtaKey) => {
    const rooms = types.map((rt) => ({ id: `${ota}-${rt.id.slice(0, 6)}`, name: rt.name }));
    patchConn(ota, { otaRooms: rooms });
    const o = OTAS.find((x) => x.key === ota)!;
    saveLog([{ id: uid(), ts: Date.now(), text: `${rooms.length} ${t("camere importate da")} ${o.label}`, color: o.color }, ...log]);
  };
  const getMap = (rt: string, ota: string): MapEntry => map[`${rt}:${ota}`] ?? { on: getConn(ota).connected, listingId: "", adjMode: "amount", adj: 0 };
  const setMapEntry = (rt: string, ota: string, patch: Partial<MapEntry>) => saveMap({ ...map, [`${rt}:${ota}`]: { ...getMap(rt, ota), ...patch } });

  const toggleConn = (k: OtaKey) => { const cur = getConn(k); const next = { ...conn, [k]: { ...cur, connected: !cur.connected, lastSync: !cur.connected ? new Date().toISOString() : cur.lastSync } }; saveConn(next); const ota = OTAS.find((o) => o.key === k)!; saveLog([{ id: uid(), ts: Date.now(), text: `${!cur.connected ? t("Collegato") : t("Scollegato")} ${ota.label}`, color: ota.color }, ...log]); };
  const toggleAuto = (k: OtaKey) => { const cur = getConn(k); saveConn({ ...conn, [k]: { ...cur, auto: !cur.auto } }); };

  const connectedOtas = OTAS.filter((o) => getConn(o.key).connected);
  const types = roomTypes.filter((rt) => effStructure === "all" || rt.structureId === effStructure);
  const mappedTypes = types.filter((rt) => OTAS.some((o) => getConn(o.key).connected && getMap(rt.id, o.key).on)).length;
  const lastSyncTs = useMemo(() => { const ts = OTAS.map((o) => getConn(o.key).lastSync).filter(Boolean).map((s) => new Date(s!).getTime()); return ts.length ? Math.max(...ts) : null; }, [conn]);
  const otaBookings = bookings.filter((b) => b.channel !== "direct" && b.channel !== "blocked" && (effStructure === "all" || b.structureId === effStructure)).length;

  return (
    <div>
      <PageHeader
        title="Channel Manager"
        subtitle={t("Connessioni ai portali, mappatura camere e sincronizzazione prezzi/disponibilità")}
        actions={
          activeStructureId === "all" ? (
            <select value={localStructure} onChange={(e) => setLocalStructure(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus">
              <option value="all">{t("Tutte le strutture")}</option>
              {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : null
        }
      />

      {/* Sincronizzazione REALE verso Channex (staging) */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: chxMap[effStructure] ? "var(--ok)" : "var(--focus)" }}><Icon name="share" size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-txt">{t("Connessione Channex")} <span className="rounded-full bg-wash px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-dim">staging</span></div>
            <div className="text-xs text-dim">
              {effStructure === "all"
                ? t("Seleziona una struttura in alto per sincronizzarla con Channex.")
                : chxMap[effStructure]
                  ? <>{t("Struttura collegata a Channex")} · <span className="font-mono text-[11px]">{chxMap[effStructure].propertyId.slice(0, 8)}…</span></>
                  : t("Crea la struttura su Channex (property + camere + tariffe) partendo dai dati già inseriti in Xenora.")}
            </div>
            {chxSync.msg && <div className="mt-1 text-[11px] font-semibold" style={{ color: chxSync.ok === false ? "var(--err)" : chxSync.ok ? "var(--ok)" : "var(--dim)" }}>{chxSync.msg}</div>}
            {ariSync.msg && <div className="mt-0.5 text-[11px] font-semibold" style={{ color: ariSync.ok === false ? "var(--err)" : ariSync.ok ? "var(--ok)" : "var(--dim)" }}>{ariSync.msg}</div>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {chxMap[effStructure] ? (
              <>
                <button onClick={pushAri} disabled={ariSync.running} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{ariSync.running ? t("Invio…") : "↑ " + t("Prezzi & disponibilità")}</button>
                <button onClick={unlinkChannex} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash">{t("Scollega")}</button>
              </>
            ) : (
              <button onClick={syncToChannex} disabled={chxSync.running || effStructure === "all"} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{chxSync.running ? t("Sincronizzo…") : t("Sincronizza con Channex")}</button>
            )}
          </div>
        </div>
      </Card>

      {/* Sincronizzazione iCal reale (sola lettura) */}
      <IcalSyncPanel />

      {/* ── Da qui in giù: simulazione dimostrativa del channel manager ── */}
      <div className="mb-3 mt-1 text-xs font-semibold uppercase tracking-wide text-faint">{t("Demo channel manager (connessione live in produzione)")}</div>

      {/* KPI */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="!p-4"><div className="text-xs text-dim">{t("Canali connessi")}</div><div className="mt-1 font-mono text-2xl font-bold text-txt">{connectedOtas.length}<span className="text-sm font-normal text-faint">/{OTAS.length}</span></div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Tipologie mappate")}</div><div className="mt-1 font-mono text-2xl font-bold text-txt">{mappedTypes}<span className="text-sm font-normal text-faint">/{types.length}</span></div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Ultima sincronizzazione")}</div><div className="mt-1 text-lg font-bold text-txt">{lastSyncTs ? relTime(lastSyncTs) : "—"}</div></Card>
        <Card className="!p-4"><div className="text-xs text-dim">{t("Prenotazioni via OTA")}</div><div className="mt-1 font-mono text-2xl font-bold text-txt">{otaBookings}</div></Card>
      </div>

      {/* Connessioni — doppia vista card/lista, clic per aprire la scheda */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionTitle>{t("Connessioni")}</SectionTitle>
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            <button onClick={() => setView("list")} title={t("Vista lista")} className={`rounded-md p-1.5 transition ${view === "list" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}><Icon name="menu" size={16} /></button>
            <button onClick={() => setView("card")} title={t("Vista card")} className={`rounded-md p-1.5 transition ${view === "card" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}><Icon name="grid" size={16} /></button>
          </div>
        </div>

        {view === "card" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {OTAS.map((o) => {
              const c = getConn(o.key);
              const mc = mappedCount(o.key);
              return (
                <button key={o.key} onClick={() => setConfiguring(o.key)} className="group rounded-2xl border bg-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: c.connected ? o.color : "var(--line)" }}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-bold text-txt"><span className="grid h-9 w-9 place-items-center rounded-xl text-sm font-bold text-white" style={{ backgroundColor: o.color }}>{o.label[0]}</span>{o.label}</span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={c.connected ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" } : { backgroundColor: "var(--wash)", color: "var(--dim)" }}>{c.connected ? t("Connesso") : t("Da collegare")}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-[10px] uppercase tracking-wide text-faint">{t("Camere")}</div><div className="font-mono text-sm font-bold" style={{ color: mc > 0 && mc === types.length ? "var(--ok)" : "var(--txt)" }}>{mc}/{types.length}</div></div>
                    <div><div className="text-[10px] uppercase tracking-wide text-faint">{t("Correzione")}</div><div className="font-mono text-sm font-bold text-txt">{corrLabel(o.key)}</div></div>
                    <div><div className="text-[10px] uppercase tracking-wide text-faint">{t("Commiss.")}</div><div className="font-mono text-sm font-bold text-txt">{c.commissionPct ?? o.commission}%</div></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                    <span className="text-[11px] text-faint">{c.lastSync ? `sync ${relTime(new Date(c.lastSync).getTime())}` : t("mai sincronizzato")}</span>
                    <span className="text-xs font-semibold transition group-hover:translate-x-0.5" style={{ color: o.color }}>{t("Apri")} →</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <Card className="!p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="px-3 py-2 font-semibold">{t("Portale")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("Camere")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("Correzione")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("Commissione")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Ultima sync")}</th>
                  <th className="px-3 py-2 text-right font-semibold"></th>
                </tr></thead>
                <tbody>
                  {OTAS.map((o) => { const c = getConn(o.key); return (
                    <tr key={o.key} onClick={() => setConfiguring(o.key)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                      <td className="px-3 py-2.5"><span className="flex items-center gap-2 font-semibold text-txt"><span className="grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold text-white" style={{ backgroundColor: o.color }}>{o.label[0]}</span>{o.label}</span></td>
                      <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={c.connected ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" } : { backgroundColor: "var(--wash)", color: "var(--dim)" }}>{c.connected ? t("Connesso") : t("Da collegare")}</span></td>
                      <td className="px-3 py-2.5 text-center font-mono text-dim">{mappedCount(o.key)}/{types.length}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-dim">{corrLabel(o.key)}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-dim">{c.commissionPct ?? o.commission}%</td>
                      <td className="px-3 py-2.5 text-[11px] text-faint">{c.lastSync ? relTime(new Date(c.lastSync).getTime()) : t("mai")}</td>
                      <td className="px-3 py-2.5 text-right"><span className="text-xs font-semibold" style={{ color: o.color }}>{t("Apri")} →</span></td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Registro sincronizzazioni */}
      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>{t("Registro sincronizzazioni")}</SectionTitle>
          {log.length > 0 && <button onClick={async () => { if (await ask({ message: t("Svuotare il registro sincronizzazioni?"), danger: true, confirmLabel: t("Svuota") })) saveLog([]); }} className="text-xs font-medium text-dim hover:text-txt">{t("Pulisci")}</button>}
        </div>
        {log.length === 0 ? <p className="text-sm text-faint">{t("Nessuna sincronizzazione ancora.")}</p> : (
          <div className="flex flex-col divide-y divide-[color:var(--line)]">
            {log.slice(0, 15).map((l) => (
              <div key={l.id} className="flex items-center gap-2.5 py-2 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                <span className="flex-1 text-txt">{l.text}</span>
                <span className="text-[11px] text-faint">{relTime(l.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="mt-3 text-xs text-faint">{t("In produzione la connessione è reale (via Channex/Nuitée): push bidirezionale di tariffe, disponibilità e prenotazioni. Qui i dati sono dimostrativi e salvati nel browser.")}</p>

      {/* Pannello di connessione per canale */}
      {configuring && (() => {
        const o = OTAS.find((x) => x.key === configuring)!;
        const c = getConn(o.key);
        const mode = c.priceAdjMode ?? "percent";
        const adj = c.priceAdj ?? 0;
        const sample = mode === "percent" ? Math.round(100 * (1 + adj / 100)) : Math.max(0, 100 + adj);
        const lbl = "block text-xs font-medium text-dim";
        const fld = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[5vh]">
            <button aria-label={t("Chiudi")} onClick={() => setConfiguring(null)} className="absolute inset-0 bg-black/40" />
            <div className="relative w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-lg font-bold text-txt"><span className="grid h-8 w-8 place-items-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: o.color }}>{o.label[0]}</span>{o.label}</span>
                <button onClick={() => setConfiguring(null)} className="rounded-lg p-1 text-faint hover:text-txt">✕</button>
              </div>

              {/* Connessione */}
              <div className="mb-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Connessione")}</div>
                  <div className="flex items-center gap-2">
                    {c.connected && <label className="flex items-center gap-1.5 text-[11px] text-dim">{t("Auto-sync")}<Toggle on={c.auto} onClick={() => toggleAuto(o.key)} color="var(--ok)" /></label>}
                    <button onClick={() => toggleConn(o.key)} className={`rounded-lg px-3 py-1 text-xs font-semibold ${c.connected ? "border border-line text-[color:var(--err)] hover:bg-wash" : "text-white"}`} style={!c.connected ? { backgroundColor: o.color } : undefined}>{c.connected ? t("Scollega") : t("Collega")}</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className={lbl}>{t("Tipo di connessione")}
                    <select value={c.connType ?? CONN_TYPES[0]} onChange={(e) => patchConn(o.key, { connType: e.target.value })} className={fld}>{CONN_TYPES.map((ct) => <option key={ct} value={ct}>{ct}</option>)}</select>
                  </label>
                  <label className={lbl}>{t("Hotel / Property ID")}
                    <input value={c.hotelId ?? ""} onChange={(e) => patchConn(o.key, { hotelId: e.target.value })} placeholder="es. 38629909" className={fld} />
                  </label>
                  <label className={`${lbl} sm:col-span-2`}>URL / Endpoint
                    <input value={c.url ?? ""} onChange={(e) => patchConn(o.key, { url: e.target.value })} placeholder="es. ycs.agoda.com" className={fld} />
                  </label>
                </div>
              </div>

              {/* Correzione prezzo */}
              <div className="mb-4 rounded-xl border border-line bg-paper p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Correzione prezzo")}</div>
                  <label className="flex items-center gap-1.5 text-[11px] text-dim">{t("Arrotonda")}<Toggle on={c.priceRound !== false} onClick={() => patchConn(o.key, { priceRound: !(c.priceRound !== false) })} color="var(--ok)" /></label>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <select value={mode} onChange={(e) => patchConn(o.key, { priceAdjMode: e.target.value as "percent" | "amount" })} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus"><option value="percent">{t("Percentuale")}</option><option value="amount">{t("Importo €")}</option></select>
                  <input type="number" value={adj} onChange={(e) => patchConn(o.key, { priceAdj: Number(e.target.value) })} className="w-24 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
                  <span className="text-dim">{mode === "percent" ? "%" : "€"}</span>
                  <span className="ml-auto text-[11px] text-faint">{t("es.")} {eur(100)} → <b className="text-txt">{eur(sample)}</b></span>
                </div>
                <p className="mt-1.5 text-[11px] text-faint">{t("Applicata al prezzo inviato a questo canale (per compensare la commissione).")}</p>
              </div>

              {/* Disponibilità + Commissione */}
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-paper p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{t("Disponibilità")}</div>
                  <div className="flex items-center gap-2"><input type="number" min={0} max={100} value={c.availPct ?? 100} onChange={(e) => patchConn(o.key, { availPct: Math.max(0, Math.min(100, Number(e.target.value))) })} className="w-20 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /><span className="text-dim">%</span></div>
                  <p className="mt-1.5 text-[11px] text-faint">{t("Quota del pool camere venduta su questo canale (protezione overbooking).")}</p>
                </div>
                <div className="rounded-xl border border-line bg-paper p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{t("Commissione")}</div>
                  <div className="flex items-center gap-2"><input type="number" min={0} value={c.commissionPct ?? o.commission} onChange={(e) => patchConn(o.key, { commissionPct: Math.max(0, Number(e.target.value)) })} className="w-20 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /><span className="text-dim">%</span></div>
                  <p className="mt-1.5 text-[11px] text-faint">{t("Usata per calcolare il netto e la correzione prezzo suggerita.")}</p>
                </div>
              </div>

              {/* Filtro importazione */}
              <label className={`${lbl} mb-4 block`}>{t("Filtro di importazione")} <span className="font-normal text-faint">({t("facoltativo")})</span>
                <input value={c.importFilter ?? ""} onChange={(e) => patchConn(o.key, { importFilter: e.target.value })} placeholder={t("es. solo camere con prefisso…")} className={fld} />
              </label>

              {/* Mappatura camere: le tue camere ↔ camere del portale, collegate da una freccia */}
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Mappatura camere")}</div>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={types.length && mappedCount(o.key) === types.length ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" } : { backgroundColor: "var(--wash)", color: "var(--dim)" }}>{mappedCount(o.key)}/{types.length} {t("mappate")}</span>
                </div>
                {types.length === 0 ? (
                  <p className="text-xs text-faint">{t("Nessuna tipologia per questa struttura.")}</p>
                ) : !(c.otaRooms && c.otaRooms.length) ? (
                  <div className="rounded-xl border border-dashed border-line p-4 text-center">
                    <p className="text-xs text-dim">{t("Prima importa le camere dal portale, poi collega ciascuna alla tua tipologia con una freccia.")}</p>
                    <button onClick={() => importRooms(o.key)} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: o.color }}>⬇ {t("Importa camere da")} {o.label}</button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-line bg-paper p-3">
                    <div className="mb-2 grid grid-cols-[1fr_26px_1fr] items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-faint">
                      <div>{t("Le tue camere")}</div><div></div><div>{o.label}</div>
                    </div>
                    <div className="flex flex-col gap-2">
                      {types.map((rt) => {
                        const e = getMap(rt.id, o.key);
                        const linked = !!e.listingId && e.on;
                        return (
                          <div key={rt.id} className="grid grid-cols-[1fr_26px_1fr] items-center gap-2">
                            <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: linked ? "var(--focus)" : "var(--line)", backgroundColor: linked ? "color-mix(in srgb, var(--focus) 6%, transparent)" : "var(--surface)" }}>
                              <div className="truncate text-sm font-semibold text-txt">{rt.name}</div>
                              <div className="text-[10px] text-faint">{eur(chPrice(rt.basePrice, o.key))} {t("su")} {o.label}</div>
                            </div>
                            <div className="flex justify-center">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={linked ? o.color : "var(--faint)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                            </div>
                            <div className="rounded-lg border px-1 py-0.5" style={{ borderColor: linked ? o.color : "var(--line)" }}>
                              <select value={e.listingId} onChange={(ev) => setMapEntry(rt.id, o.key, { listingId: ev.target.value, on: !!ev.target.value })} className="w-full bg-transparent px-1 py-1 text-sm text-txt outline-none">
                                <option value="">{t("— non collegata —")}</option>
                                {c.otaRooms!.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2">
                      <button onClick={() => importRooms(o.key)} className="text-[11px] font-semibold text-dim hover:text-txt">↻ {t("Reimporta camere")}</button>
                      <button onClick={() => { const next = { ...map }; types.forEach((rt) => { const m = c.otaRooms!.find((r) => r.name.toLowerCase().trim() === rt.name.toLowerCase().trim()); if (m) next[`${rt.id}:${o.key}`] = { ...getMap(rt.id, o.key), listingId: m.id, on: true }; }); saveMap(next); }} className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: o.color }}>✨ {t("Abbina automaticamente")}</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Azioni */}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button onClick={() => importRooms(o.key)} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">⬇ {t("Importa camere")}</button>
                <button disabled={!c.connected} onClick={() => { patchConn(o.key, { lastSync: new Date().toISOString() }); saveLog([{ id: uid(), ts: Date.now(), text: `${t("Tariffe e disponibilità inviate a")} ${o.label}`, color: o.color }, ...log]); }} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">↻ {t("Sincronizza ora")}</button>
                <button onClick={() => setConfiguring(null)} className="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: o.color }}>💾 {t("Salva e chiudi")}</button>
              </div>
              <p className="mt-2 text-[11px] text-faint">{t("Le modifiche si salvano automaticamente. Impostazioni dimostrative salvate nel browser.")}</p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
