"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { toISO, shiftISO, parseISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { rateForDay, loadWeekendPct } from "@/lib/pricing";
import { inScope, newItemStructureId } from "@/lib/scope";
import { PageHeader, Card, SectionTitle, StatCard } from "@/components/ui";
import Icon from "@/components/Icon";

const isWeekend = (iso: string) => { const d = new Date(iso).getDay(); return d === 5 || d === 6 || d === 0; };
const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });

// Eventi locali: li aggiunge il gestore a mano (sagre, concerti, crociere…) — nessuna fonte
// esterna/automatica. Ogni evento appartiene alla struttura selezionata al momento della creazione
// (structureId assente = evento "per tutte", visibile ovunque), con la data vera invece di un offset da "oggi".
interface LocalEvent { id: string; name: string; date: string; impact: "alto" | "medio"; structureId?: string }
const EVENTS_KEY = "spigolestay:localevents";
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));

// Un colore diverso per tipo di motivo, così in colonna "Motivo" si distinguono a colpo d'occhio
// invece di essere tutti lo stesso pallino grigio.
const REASON_COLOR: Record<"weekend" | "event" | "demand" | "lastminute", string> = {
  weekend: "#C08A3A", event: "#8B5CF6", demand: "#4F8A5B", lastminute: "#B3453A",
};

export default function AssistenteRicaviPage() {
  const { roomTypes, units, bookings, rateOverrides, setDayRates, activeStructureId, structures } = useData();
  const today = toISO(new Date());
  const [horizon, setHorizon] = useState(30);
  // Regola weekend della struttura selezionata (se ha la propria), altrimenti quella di default.
  const weekendPct = useMemo(() => loadWeekendPct(activeStructureId === "all" ? undefined : activeStructureId), [activeStructureId]);

  const scopeUnits = units.filter((u) => !u.outOfService && (activeStructureId === "all" || u.structureId === activeStructureId));
  const scopeTypes = roomTypes.filter((rt) => activeStructureId === "all" || rt.structureId === activeStructureId);
  const baseRate = scopeTypes.length ? Math.round(scopeTypes.reduce((a, rt) => a + rt.basePrice, 0) / scopeTypes.length) : 100;

  const [allEvents, setMyEvents] = useState<LocalEvent[]>([]);
  useEffect(() => { try { const r = localStorage.getItem(EVENTS_KEY); if (r) setMyEvents(JSON.parse(r)); } catch {} }, []);
  // Si salva SEMPRE la lista completa (eventi di tutte le strutture); la vista è filtrata per struttura attiva.
  const myEvents = useMemo(() => allEvents.filter((e) => inScope(e.structureId, activeStructureId)), [allEvents, activeStructureId]);
  const persistEvents = (next: LocalEvent[]) => { setMyEvents(next); try { localStorage.setItem(EVENTS_KEY, JSON.stringify(next)); } catch {} };
  const [newEvName, setNewEvName] = useState("");
  const [newEvDate, setNewEvDate] = useState("");
  const [newEvImpact, setNewEvImpact] = useState<"alto" | "medio">("medio");
  const addEvent = () => {
    if (!newEvName.trim() || !newEvDate) return;
    const sid = newItemStructureId(activeStructureId);
    persistEvents([...allEvents, { id: uid(), name: newEvName.trim(), date: newEvDate, impact: newEvImpact, ...(sid ? { structureId: sid } : {}) }].sort((a, b) => a.date.localeCompare(b.date)));
    setNewEvName(""); setNewEvDate(""); setNewEvImpact("medio");
  };
  const removeEvent = (id: string) => persistEvents(allEvents.filter((e) => e.id !== id));

  const events = useMemo(() => myEvents.map((e) => ({ ...e, iso: e.date })), [myEvents]);
  const eventOf = (iso: string) => events.find((e) => e.iso === iso);

  const occOn = (iso: string) => bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (activeStructureId === "all" || b.structureId === activeStructureId) && b.checkIn <= iso && iso < b.checkOut).length;
  const daysFrom = (iso: string) => Math.round((new Date(iso).getTime() - new Date(today).getTime()) / 86400000);

  const suggest = (iso: string) => {
    const free = Math.max(0, scopeUnits.length - occOn(iso));
    const occPct = scopeUnits.length ? Math.round((occOn(iso) / scopeUnits.length) * 100) : 0;
    const ev = eventOf(iso);
    let factor = 1; const reasons: { text: string; kind: "weekend" | "event" | "demand" | "lastminute" }[] = [];
    if (isWeekend(iso)) { factor += weekendPct / 100 * 0.8; reasons.push({ text: "Weekend", kind: "weekend" }); }
    if (ev) { factor += ev.impact === "alto" ? 0.3 : 0.15; reasons.push({ text: ev.name, kind: "event" }); }
    if (occPct >= 80) { factor += 0.15; reasons.push({ text: "Alta domanda", kind: "demand" }); }
    else if (occPct <= 30 && daysFrom(iso) <= 5) { factor -= 0.12; reasons.push({ text: "Last-minute", kind: "lastminute" }); }
    // Tariffa attuale = media effettiva (override per tipologia, derivate, weekend) delle tipologie in scope.
    const current = scopeTypes.length ? Math.round(scopeTypes.reduce((a, rt) => a + rateForDay(rt.id, iso, roomTypes, rateOverrides, weekendPct), 0) / scopeTypes.length) : Math.round(baseRate * (isWeekend(iso) ? 1 + weekendPct / 100 : 1));
    const rate = Math.max(0, Math.round(baseRate * factor));
    return { iso, occPct, free, rate, current, reasons, delta: rate - current };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => Array.from({ length: horizon }, (_, i) => suggest(shiftISO(today, i + 1))), [horizon, rateOverrides, activeStructureId, bookings, roomTypes, units, myEvents, weekendPct]);
  const opportunities = days.filter((d) => Math.abs(d.delta) >= 1 && d.free > 0);
  const upside = opportunities.reduce((a, d) => a + Math.max(0, d.delta) * d.free, 0);

  // Scrive gli override per (tipologia|giorno) SOLO sulle tipologie della struttura selezionata (mai la chiave ISO
  // nuda, che varrebbe per tutte le strutture). Ogni tipologia mantiene la sua proporzione rispetto alla media.
  const mapFor = (d: { iso: string; rate: number; current: number }) => {
    const out: Record<string, number> = {};
    for (const rt of scopeTypes) {
      const cur = rateForDay(rt.id, d.iso, roomTypes, rateOverrides, weekendPct);
      out[`${rt.id}|${d.iso}`] = Math.max(0, Math.round(d.current > 0 ? cur * (d.rate / d.current) : d.rate));
    }
    return out;
  };
  const applyOne = (d: { iso: string; rate: number; current: number }) => setDayRates(mapFor(d));
  const applyAll = () => setDayRates(Object.assign({}, ...opportunities.map((d) => mapFor(d))));

  return (
    <div>
      <PageHeader title="Assistente ricavi" subtitle="Prezzi consigliati giorno per giorno in base a occupazione, weekend ed eventi locali" actions={<button onClick={applyAll} disabled={!opportunities.length} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">Applica tutti i consigli ({opportunities.length})</button>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Tariffa base media", eur(baseRate)], ["Camere in scope", String(scopeUnits.length)], ["Opportunità", String(opportunities.length)], ["Ricavo potenziale", `+${eur(upside)}`]] as [string, string][]).map(([lab, val]) => (
          <StatCard key={lab} label={lab} value={val} />
        ))}
      </div>

      {/* Eventi locali */}
      <Card className="mb-4">
        <SectionTitle>Eventi che spingono la domanda · {activeStructureId === "all" ? "tutte le strutture" : structures.find((s) => s.id === activeStructureId)?.name}</SectionTitle>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={newEvName}
            onChange={(e) => setNewEvName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addEvent(); }}
            placeholder="Nome evento (sagra, concerto…)"
            className="min-w-[180px] flex-1 rounded-lg border border-line bg-paper px-2 py-1 text-sm text-txt outline-none focus:border-focus"
          />
          <input
            type="date"
            value={newEvDate}
            onChange={(e) => setNewEvDate(e.target.value)}
            className="rounded-lg border border-line bg-paper px-2 py-1 text-sm text-txt outline-none focus:border-focus"
          />
          <select
            value={newEvImpact}
            onChange={(e) => setNewEvImpact(e.target.value as "alto" | "medio")}
            className="rounded-lg border border-line bg-paper px-2 py-1 text-sm text-txt outline-none focus:border-focus"
          >
            <option value="medio">Impatto medio</option>
            <option value="alto">Impatto alto</option>
          </select>
          <button
            onClick={addEvent}
            disabled={!newEvName.trim() || !newEvDate}
            className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            Aggiungi
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.impact === "alto" ? "var(--err)" : "var(--warn)" }} />
              <span className="text-sm font-medium text-txt">{e.name}</span>
              <span className="text-[11px] text-faint">{fmt(e.iso)}</span>
              <button onClick={() => removeEvent(e.id)} aria-label="Rimuovi evento" className="ml-1 text-xs text-faint hover:text-[color:var(--err)]">✕</button>
            </div>
          ))}
          {!events.length && (
            <p className="text-sm text-faint">Nessun evento aggiunto. Aggiungi sagre, concerti o eventi locali che possono alzare la domanda.</p>
          )}
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
            <th className="px-3 py-2 font-semibold">Giorno</th><th className="px-3 py-2 text-right font-semibold">Occup.</th><th className="px-3 py-2 text-right font-semibold">Libere</th><th className="px-3 py-2 text-right font-semibold">Attuale</th><th className="px-3 py-2 text-right font-semibold">Consigliato</th><th className="border-l border-line px-3 py-2 font-semibold">Motivo</th><th className="px-3 py-2"></th>
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
                  <td className="border-l border-line px-3 py-2"><div className="flex flex-wrap gap-1">{d.reasons.map((r, i) => { const col = REASON_COLOR[r.kind]; return <span key={i} className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `color-mix(in srgb, ${col} 16%, transparent)`, color: col }}>{r.text}</span>; })}{!d.reasons.length && <span className="text-[11px] text-faint">—</span>}</div></td>
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
