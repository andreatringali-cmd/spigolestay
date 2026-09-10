"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { toISO, shiftISO, parseISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import Icon from "@/components/Icon";

const isWeekend = (iso: string) => { const d = new Date(iso).getDay(); return d === 5 || d === 6 || d === 0; };
const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });

// Eventi locali di Siracusa che spingono la domanda (relativi a oggi per la demo).
const EVENTS: { off: number; name: string; impact: "alto" | "medio" }[] = [
  { off: 3, name: "Weekend a Ortigia", impact: "medio" },
  { off: 9, name: "Concerto al Teatro Greco", impact: "alto" },
  { off: 16, name: "Navi da crociera in porto", impact: "medio" },
  { off: 24, name: "Festa patronale", impact: "alto" },
  { off: 33, name: "Sagra enogastronomica", impact: "medio" },
  { off: 45, name: "Ponte / festività", impact: "alto" },
];

export default function AssistenteRicaviPage() {
  const { roomTypes, units, bookings, rateOverrides, setDayRates, activeStructureId, structures } = useData();
  const today = toISO(new Date());
  const [horizon, setHorizon] = useState(30);
  const weekendPct = useMemo(() => { try { const r = localStorage.getItem("spigolestay:pricerules"); if (r) return JSON.parse(r).weekendPct ?? 25; } catch {} return 25; }, []);

  const scopeUnits = units.filter((u) => !u.outOfService && (activeStructureId === "all" || u.structureId === activeStructureId));
  const scopeTypes = roomTypes.filter((rt) => activeStructureId === "all" || rt.structureId === activeStructureId);
  const baseRate = scopeTypes.length ? Math.round(scopeTypes.reduce((a, rt) => a + rt.basePrice, 0) / scopeTypes.length) : 100;

  const events = useMemo(() => EVENTS.map((e) => ({ ...e, iso: shiftISO(today, e.off) })), [today]);
  const eventOf = (iso: string) => events.find((e) => e.iso === iso);

  const occOn = (iso: string) => bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (activeStructureId === "all" || b.structureId === activeStructureId) && b.checkIn <= iso && iso < b.checkOut).length;
  const daysFrom = (iso: string) => Math.round((new Date(iso).getTime() - new Date(today).getTime()) / 86400000);

  const suggest = (iso: string) => {
    const free = Math.max(0, scopeUnits.length - occOn(iso));
    const occPct = scopeUnits.length ? Math.round((occOn(iso) / scopeUnits.length) * 100) : 0;
    const ev = eventOf(iso);
    let factor = 1; const reasons: string[] = [];
    if (isWeekend(iso)) { factor += weekendPct / 100 * 0.8; reasons.push("Weekend"); }
    if (ev) { factor += ev.impact === "alto" ? 0.3 : 0.15; reasons.push(ev.name); }
    if (occPct >= 80) { factor += 0.15; reasons.push("Alta domanda"); }
    else if (occPct <= 30 && daysFrom(iso) <= 5) { factor -= 0.12; reasons.push("Last-minute"); }
    const current = rateOverrides[iso] ?? Math.round(baseRate * (isWeekend(iso) ? 1 + weekendPct / 100 : 1));
    const rate = Math.max(0, Math.round(baseRate * factor));
    return { iso, occPct, free, rate, current, reasons, delta: rate - current };
  };

  const days = useMemo(() => Array.from({ length: horizon }, (_, i) => suggest(shiftISO(today, i + 1))), [horizon, rateOverrides, activeStructureId, bookings]);
  const opportunities = days.filter((d) => Math.abs(d.delta) >= 1 && d.free > 0);
  const upside = opportunities.reduce((a, d) => a + Math.max(0, d.delta) * d.free, 0);

  const applyOne = (d: { iso: string; rate: number }) => setDayRates({ [d.iso]: d.rate });
  const applyAll = () => setDayRates(Object.fromEntries(opportunities.map((d) => [d.iso, d.rate])));

  return (
    <div>
      <PageHeader title="Assistente ricavi" subtitle="Prezzi consigliati giorno per giorno in base a occupazione, weekend ed eventi locali" actions={<button onClick={applyAll} disabled={!opportunities.length} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">Applica tutti i consigli ({opportunities.length})</button>} />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {([["Tariffa base media", eur(baseRate)], ["Camere in scope", String(scopeUnits.length)], ["Opportunità", String(opportunities.length)], ["Ricavo potenziale", `+${eur(upside)}`]] as [string, string][]).map(([lab, val]) => (
          <div key={lab} className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm">
            <div className="text-[10px] font-medium uppercase tracking-wide text-faint">{lab}</div>
            <div className="font-mono text-lg font-bold leading-tight text-txt">{val}</div>
          </div>
        ))}
      </div>

      {/* Eventi locali */}
      <Card className="mb-4">
        <SectionTitle>Eventi che spingono la domanda · {activeStructureId === "all" ? "tutte le strutture" : structures.find((s) => s.id === activeStructureId)?.name}</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {events.map((e) => (
            <div key={e.iso} className="flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.impact === "alto" ? "var(--err)" : "var(--warn)" }} />
              <span className="text-sm font-medium text-txt">{e.name}</span>
              <span className="text-[11px] text-faint">{fmt(e.iso)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Consigli prezzo */}
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle>Prezzi consigliati</SectionTitle>
        <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
          {[14, 30, 60].map((h) => (<button key={h} onClick={() => setHorizon(h)} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${horizon === h ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{h} gg</button>))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line bg-wash text-left text-[11px] uppercase tracking-wide text-faint">
            <th className="px-3 py-2 font-semibold">Giorno</th><th className="px-3 py-2 text-right font-semibold">Occup.</th><th className="px-3 py-2 text-right font-semibold">Libere</th><th className="px-3 py-2 text-right font-semibold">Attuale</th><th className="px-3 py-2 text-right font-semibold">Consigliato</th><th className="px-3 py-2 font-semibold">Motivo</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {days.map((d) => {
              const up = d.delta > 0, down = d.delta < 0;
              return (
                <tr key={d.iso} className={`border-b border-line last:border-0 ${eventOf(d.iso) ? "bg-[color:color-mix(in_srgb,var(--focus)_4%,transparent)]" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-txt">{fmt(d.iso)}</td>
                  <td className="px-3 py-2 text-right font-mono text-txt">{d.occPct}%</td>
                  <td className="px-3 py-2 text-right font-mono text-dim">{d.free}</td>
                  <td className="px-3 py-2 text-right font-mono text-dim">{eur(d.current)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: up ? "var(--ok)" : down ? "var(--err)" : "var(--txt)" }}>{eur(d.rate)} {d.delta !== 0 && <span className="text-[10px]">({up ? "+" : ""}{d.delta})</span>}</td>
                  <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{d.reasons.map((r, i) => <span key={i} className="rounded-full bg-wash px-2 py-0.5 text-[10px] text-dim">{r}</span>)}{!d.reasons.length && <span className="text-[11px] text-faint">—</span>}</div></td>
                  <td className="px-3 py-2 text-right">{d.delta !== 0 ? <button onClick={() => applyOne(d)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-focus hover:bg-wash">Applica</button> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-faint">I prezzi consigliati aggiornano le tariffe del calendario. Basati su occupazione reale + weekend + eventi + last-minute; li affineremo con storico, pickup e tariffe competitor.</p>
    </div>
  );
}
