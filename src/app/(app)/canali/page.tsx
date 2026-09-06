"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import IcalSyncPanel from "@/components/IcalSyncPanel";

// Portali gestiti dal Channel Manager.
const OTAS = [
  { key: "booking", label: "Booking.com", color: "#003580", commission: 15 },
  { key: "airbnb", label: "Airbnb", color: "#FF5A5F", commission: 15 },
  { key: "expedia", label: "Expedia", color: "#FFC72C", commission: 18 },
  { key: "vrbo", label: "Vrbo", color: "#1668E3", commission: 8 },
  { key: "agoda", label: "Agoda", color: "#5A2D8C", commission: 17 },
  { key: "google", label: "Google Hotel Ads", color: "#4285F4", commission: 12 },
] as const;
type OtaKey = typeof OTAS[number]["key"];

interface Conn { connected: boolean; auto: boolean; lastSync?: string }
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
  const { structures, roomTypes, bookings, activeStructureId } = useData();
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

  const getConn = (k: string): Conn => conn[k] ?? { connected: false, auto: false };
  const getMap = (rt: string, ota: string): MapEntry => map[`${rt}:${ota}`] ?? { on: getConn(ota).connected, listingId: "", adjMode: "amount", adj: 0 };
  const setMapEntry = (rt: string, ota: string, patch: Partial<MapEntry>) => saveMap({ ...map, [`${rt}:${ota}`]: { ...getMap(rt, ota), ...patch } });

  const toggleConn = (k: OtaKey) => { const cur = getConn(k); const next = { ...conn, [k]: { ...cur, connected: !cur.connected, lastSync: !cur.connected ? new Date().toISOString() : cur.lastSync } }; saveConn(next); const ota = OTAS.find((o) => o.key === k)!; saveLog([{ id: uid(), ts: Date.now(), text: `${!cur.connected ? t("Collegato") : t("Scollegato")} ${ota.label}`, color: ota.color }, ...log]); };
  const toggleAuto = (k: OtaKey) => { const cur = getConn(k); saveConn({ ...conn, [k]: { ...cur, auto: !cur.auto } }); };

  const connectedOtas = OTAS.filter((o) => getConn(o.key).connected);
  const syncNow = () => {
    const now = new Date().toISOString();
    const next = { ...conn };
    connectedOtas.forEach((o) => { next[o.key] = { ...getConn(o.key), lastSync: now }; });
    saveConn(next);
    saveLog([...connectedOtas.map((o) => ({ id: uid(), ts: Date.now(), text: `${t("Tariffe e disponibilità inviate a")} ${o.label}`, color: o.color })), ...log]);
  };

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
          <div className="flex items-center gap-2">
            {activeStructureId === "all" && (
              <select value={localStructure} onChange={(e) => setLocalStructure(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus">
                <option value="all">{t("Tutte le strutture")}</option>
                {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <button onClick={syncNow} disabled={connectedOtas.length === 0} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">↻ {t("Sincronizza ora")}</button>
          </div>
        }
      />

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

      {/* Connessioni */}
      <Card className="mb-5">
        <SectionTitle>{t("Connessioni")}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {OTAS.map((o) => {
            const c = getConn(o.key);
            return (
              <div key={o.key} className="rounded-xl border p-3" style={{ borderColor: c.connected ? o.color : "var(--line)" }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-txt"><span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: o.color }}>{o.label[0]}</span>{o.label}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={c.connected ? { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" } : { backgroundColor: "var(--wash)", color: "var(--dim)" }}>{c.connected ? t("Connesso") : t("Da collegare")}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
                  <span>{t("Commissione")} {o.commission}%</span>
                  <span>{c.lastSync ? `sync ${relTime(new Date(c.lastSync).getTime())}` : t("mai sincronizzato")}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button onClick={() => toggleConn(o.key)} className={`rounded-lg px-3 py-1 text-xs font-semibold ${c.connected ? "border border-line text-[color:var(--err)] hover:bg-wash" : "text-white"}`} style={!c.connected ? { backgroundColor: o.color } : undefined}>{c.connected ? t("Scollega") : t("Collega")}</button>
                  {c.connected && <label className="flex items-center gap-1.5 text-[11px] text-dim">{t("Auto-sync")}<Toggle on={c.auto} onClick={() => toggleAuto(o.key)} color="var(--ok)" /></label>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Mappatura tipologie */}
      <SectionTitle>{t("Mappatura camere → portali")}</SectionTitle>
      <div className="mt-2 flex flex-col gap-4">
        {types.length === 0 && <Card><div className="py-6 text-center text-sm text-faint">{t("Nessuna tipologia per questa struttura.")}</div></Card>}
        {types.map((rt) => (
          <Card key={rt.id}>
            <div className="mb-3 flex items-baseline justify-between">
              <div className="font-display text-lg font-bold text-txt">{rt.name}</div>
              <div className="text-xs text-dim">{t("prezzo base")} <span className="font-mono font-semibold text-txt">{eur(rt.basePrice)}</span></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="py-1.5 font-semibold">{t("Portale")}</th>
                    <th className="py-1.5 font-semibold">{t("ID annuncio")}</th>
                    <th className="py-1.5 font-semibold">{t("Correzione")}</th>
                    <th className="py-1.5 text-right font-semibold">{t("Prezzo portale")}</th>
                    <th className="py-1.5 text-center font-semibold">{t("Attivo")}</th>
                  </tr>
                </thead>
                <tbody>
                  {OTAS.map((o) => {
                    const c = getConn(o.key);
                    const e = getMap(rt.id, o.key);
                    const price = e.adjMode === "percent" ? Math.round(rt.basePrice * (1 + e.adj / 100)) : Math.max(0, rt.basePrice + e.adj);
                    return (
                      <tr key={o.key} className={`border-t border-line ${!c.connected ? "opacity-40" : ""}`}>
                        <td className="py-2"><span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: o.color }} />{o.label}</span></td>
                        <td className="py-2"><input disabled={!c.connected} value={e.listingId} onChange={(ev) => setMapEntry(rt.id, o.key, { listingId: ev.target.value })} placeholder="—" className="w-28 rounded-md border border-line bg-paper px-2 py-1 text-xs outline-none focus:border-focus disabled:bg-transparent" /></td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            <input type="number" disabled={!c.connected} value={e.adj} onChange={(ev) => setMapEntry(rt.id, o.key, { adj: Number(ev.target.value) })} className="w-16 rounded-md border border-line bg-paper px-2 py-1 text-xs outline-none focus:border-focus disabled:bg-transparent" />
                            <button disabled={!c.connected} onClick={() => setMapEntry(rt.id, o.key, { adjMode: e.adjMode === "amount" ? "percent" : "amount" })} className="rounded-md border border-line px-1.5 py-1 text-xs text-dim hover:bg-wash disabled:opacity-40">{e.adjMode === "amount" ? "€" : "%"}</button>
                          </div>
                        </td>
                        <td className="py-2 text-right font-mono font-semibold text-txt">{c.connected && e.on ? eur(price) : "—"}</td>
                        <td className="py-2 text-center"><input type="checkbox" disabled={!c.connected} checked={c.connected && e.on} onChange={(ev) => setMapEntry(rt.id, o.key, { on: ev.target.checked })} className="h-4 w-4 accent-[color:var(--focus)]" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      {/* Registro sincronizzazioni */}
      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>{t("Registro sincronizzazioni")}</SectionTitle>
          {log.length > 0 && <button onClick={async () => { if (await ask({ message: t("Svuotare il registro sincronizzazioni?"), danger: true, confirmLabel: t("Svuota") })) saveLog([]); }} className="text-xs font-medium text-dim hover:text-txt">{t("Pulisci")}</button>}
        </div>
        {log.length === 0 ? <p className="text-sm text-faint">{t("Nessuna sincronizzazione ancora. Premi «Sincronizza ora».")}</p> : (
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
    </div>
  );
}
