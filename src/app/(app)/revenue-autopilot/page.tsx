"use client";

// Revenue Autopilot: il "pilota prezzi". Propone tariffe giorno per giorno
// (occupazione, last-minute, buchi) entro i limiti che imposti; applichi con un
// click o lasci fare all'autopilot. Scrive gli override del calendario (motore unico).
import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { toISO, shiftISO, nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { italianHolidays, italianBridges } from "@/lib/holidays";
import { computeSuggestions, loadAutopilot, saveAutopilot, toOverrideMap, highDemandMap, GUARDRAIL_LABEL, type AutopilotCfg, type Suggestion } from "@/lib/autopilot";
import { explainSuggestion, explainSuggestionCompact, summarizeAppliedSuggestions } from "@/lib/autopilot-explain";
import { fetchCityPulse, computeMarketSignal, pulseHasDemo, MARKET_WINDOW, type MarketPulse } from "@/lib/market";
import { forecastOccupancy, nextWeekendISOs, FORECAST_DEMO_NOTE } from "@/lib/forecast";
import { inScope } from "@/lib/scope";
import { rateForDay, loadWeekendPct, effectiveMinStay } from "@/lib/pricing";
import { simulateImpact } from "@/lib/revenue-impact";
import { buildChanges, recordBatches, type RevenueSource } from "@/lib/revenue-history";
import { scanGaps } from "@/lib/revenue-gaps";
import ImpactPreview from "@/components/ImpactPreview";
import PriceHistoryCard from "@/components/PriceHistoryCard";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });

export default function RevenueAutopilotPage() {
  const { bookings, roomTypes, units, events, rateOverrides, setDayRates, structures, activeStructureId, getStructure, addActivity } = useData();
  const { user } = useAuth();
  const toast = useToast();
  const todayISO = toISO(new Date());
  const scope = activeStructureId;
  const scopeSid = scope === "all" ? undefined : scope;
  // Config autopilot INDIPENDENTE per struttura: con una struttura selezionata si legge/scrive la sua voce,
  // con "Tutte" il default (valido per le strutture senza impostazioni proprie).
  const [cfg, setCfg] = useState<AutopilotCfg>(() => loadAutopilot(scopeSid));
  const [cfgVer, setCfgVer] = useState(0);
  const [preview, setPreview] = useState(false);
  useEffect(() => { setCfg(loadAutopilot(scopeSid)); }, [scopeSid]);

  // Struttura di riferimento per il benchmark di zona: con una struttura selezionata SOLO quella (senza città → nessun
  // segnale di zona), mai un'altra; con "Tutte" la prima con città.
  const struct = useMemo(() => {
    if (scope !== "all") return structures.find((s) => s.id === scope);
    return structures.find((s) => (s.city || "").trim()) || structures[0];
  }, [structures, scope]);
  const city = (struct?.city || "").trim();

  // I MIEI dati reali (occupazione + ADR ultimi 90 gg) dalle prenotazioni nel blob.
  const my = useMemo(() => {
    const sRooms = units.filter((u) => u.structureId === struct?.id && !u.outOfService).length;
    if (!struct || sRooms === 0) return { occ: 0, adr: 0 };
    const mine = bookings.filter((b) => b.structureId === struct.id && b.status !== "cancelled" && b.channel !== "blocked");
    let rt = 0, rs = 0, rev = 0;
    for (let i = 0; i < MARKET_WINDOW; i++) {
      const D = shiftISO(todayISO, -i);
      const a = mine.filter((b) => b.checkIn <= D && b.checkOut > D);
      rt += sRooms; rs += a.length; rev += a.reduce((s, b) => s + (b.total || 0) / Math.max(1, nights(b.checkIn, b.checkOut)), 0);
    }
    return { occ: rt ? rs / rt : 0, adr: rs ? rev / rs : 0 };
  }, [struct, units, bookings, todayISO]);

  // Benchmark di zona "Rete città" (onesto: usato solo se ci sono abbastanza strutture reali).
  const [pulse, setPulse] = useState<MarketPulse | null>(null);
  useEffect(() => { let off = false; (async () => { const p = await fetchCityPulse(supabase, city); if (!off) setPulse(p); })(); return () => { off = true; }; }, [user?.id, city]);
  const signal = useMemo(() => computeMarketSignal(my.occ, my.adr, pulse), [my.occ, my.adr, pulse]);

  // Giorni ad alta richiesta (festivi/ponti/eventi DELLA struttura) per prezzi consapevoli.
  const highDemandFor = (sid: string | undefined, horizon: number) => {
    const years = [new Date().getFullYear(), new Date().getFullYear() + 1];
    const city = (sid ? getStructure(sid)?.city : structures[0]?.city) ?? "";
    const h = italianHolidays(years, city);
    const evs = (events ?? []).filter((e) => !sid || inScope(e.structureId, sid));
    return highDemandMap(evs, h, italianBridges(h), todayISO, horizon);
  };

  // Suggerimenti: con una struttura, calcolati con la SUA config; con "Tutte", struttura per struttura
  // ciascuna con la propria config (default se non ne ha una).
  const suggestions = useMemo(() => {
    const sids: (string | undefined)[] = scopeSid ? [scopeSid] : (structures.length ? structures.map((s) => s.id) : [undefined]);
    const all = sids.flatMap((sid) => {
      const c = sid === scopeSid ? cfg : loadAutopilot(sid);
      return computeSuggestions(bookings, roomTypes, units, rateOverrides, c, todayISO, sid ?? "all", highDemandFor(sid, c.horizonDays), signal);
    });
    return all.sort((a, b) => Math.abs(b.suggested - b.current) - Math.abs(a.suggested - a.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, roomTypes, units, rateOverrides, cfg, cfgVer, todayISO, scopeSid, structures, events, signal]);

  // Previsione storica (lib/forecast.ts): segnale INFORMATIVO in più per il prossimo
  // weekend, separato dal motore prezzi vero e proprio (non altera suggestions/mult).
  // Mostrata solo se la confidenza supera la soglia minima: mai un numero inventato.
  const weekendForecast = useMemo(() => {
    const scopeUnits = units.filter((u) => !u.outOfService && (scope === "all" || u.structureId === scope));
    if (!scopeUnits.length) return [];
    const [sat, sun] = nextWeekendISOs(todayISO);
    return [sat, sun]
      .map((iso) => forecastOccupancy(bookings, scopeUnits.length, scope, iso, todayISO, pulse))
      .filter((f) => f.occPct != null && f.label);
  }, [bookings, units, scope, todayISO, pulse]);
  const weekendForecastHasDemo = weekendForecast.some((f) => f.networkHasDemo);

  const setCfgPersist = (patch: Partial<AutopilotCfg>) => { const next = { ...cfg, ...patch }; setCfg(next); saveAutopilot(patch, scopeSid); setCfgVer((v) => v + 1); };

  // Scrive le tariffe (override del calendario) registrando prima lo storico per "Annulla".
  // Difesa in profondità: con una struttura selezionata si scrive SOLO su quella struttura.
  const commit = (list: Suggestion[], source: RevenueSource, label: string) => {
    const safe = scopeSid ? list.filter((s) => s.structureId === scopeSid) : list;
    if (!safe.length) return 0;
    recordBatches(source, label, buildChanges(safe.map((s) => ({ key: s.key, typeName: s.typeName, iso: s.iso, structureId: s.structureId, effBefore: s.current, after: s.suggested })), rateOverrides));
    setDayRates(toOverrideMap(safe));
    return safe.length;
  };

  // Autopilot attivo: applica automaticamente i suggerimenti una volta appena pronti.
  // Il ref si riarma al cambio struttura: ogni struttura ha il suo autopilot.
  const auto = useRef(false);
  useEffect(() => { auto.current = false; }, [scopeSid]);
  useEffect(() => {
    if (!cfg.on || auto.current) return;
    if (!roomTypes.length) return; // attendi l'idratazione dello store
    // Con "Tutte" si applicano solo i suggerimenti delle strutture che hanno l'autopilot attivo.
    const toApply = scopeSid ? suggestions : suggestions.filter((s) => loadAutopilot(s.structureId).on);
    if (toApply.length) {
      commit(toApply, "autopilot-auto", "Autopilot");
      toast(`Autopilot: applicati ${toApply.length} aggiustamenti prezzo.`, "success");
      addActivity("rate", `Autopilot: ${toApply.length} tariffe aggiornate automaticamente. ${summarizeAppliedSuggestions(toApply)}`, scopeSid);
    }
    auto.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.on, roomTypes.length, suggestions.length, scopeSid]);

  // Simulazione dell'impatto sulle camere ancora libere (le prenotazioni già confermate non cambiano prezzo).
  const impact = useMemo(() => simulateImpact(suggestions.map((s) => ({ typeId: s.typeId, iso: s.iso, current: s.current, next: s.suggested })), bookings, units), [suggestions, bookings, units]);
  const limitedCount = suggestions.filter((s) => s.limitedBy).length;

  // Notti orfane e prenotazioni senza camera (dati reali dallo store).
  const gapScan = useMemo(() => scanGaps({ bookings, units, roomTypes, fromISO: todayISO, days: 60, structureId: scope, rateOf: (tid, iso) => rateForDay(tid, iso, roomTypes, rateOverrides, loadWeekendPct()), minStayOf: (rt) => effectiveMinStay(rt, roomTypes) }), [bookings, units, roomTypes, rateOverrides, todayISO, scope]);

  // Stato dati: perché eventualmente non ci sono suggerimenti.
  const scopedTypes = useMemo(() => roomTypes.filter((rt) => (scope === "all" || rt.structureId === scope) && units.some((u) => u.roomTypeId === rt.id && !u.outOfService)), [roomTypes, units, scope]);
  const zeroPriceTypes = useMemo(() => scopedTypes.filter((rt) => rateForDay(rt.id, todayISO, roomTypes, {}, 0) <= 0), [scopedTypes, roomTypes, todayISO]);
  // Esempio dei limiti attivi su una tariffa base di € 100.
  const guardExample = useMemo(() => {
    const lo = Math.max(100 - cfg.maxChangePct, cfg.floorPct), hi = Math.min(100 + cfg.maxChangePct, cfg.ceilPct);
    return { lo: Math.round(lo), hi: Math.round(hi) };
  }, [cfg.maxChangePct, cfg.floorPct, cfg.ceilPct]);

  const up = suggestions.filter((s) => s.suggested > s.current);
  const down = suggestions.filter((s) => s.suggested < s.current);

  const applyOne = (s: Suggestion) => { if (commit([s], "autopilot-manuale", "Autopilot · singola tariffa") === 0) return; toast(`${s.typeName} · ${fmtDay(s.iso)}: ${eur(s.suggested)}`, "success"); addActivity("rate", explainSuggestion(s), s.structureId); };
  const applyAll = () => {
    if (!suggestions.length) return;
    const n = commit(suggestions, "autopilot-manuale", "Autopilot · applica tutti");
    setPreview(false);
    toast(`Applicati ${n} aggiustamenti.`, "success");
    addActivity("rate", `Applicati manualmente ${n} aggiustamenti prezzo. ${summarizeAppliedSuggestions(suggestions)}`, scopeSid);
  };

  const inp = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
  const lbl = "block text-xs font-medium text-dim";

  return (
    <div>
      <PageHeader title="Revenue Autopilot" subtitle="Il pilota prezzi: suggerisce e applica tariffe ottimali giorno per giorno" />

      {/* Fonti dati: onesto su cosa è reale ora e cosa arriva */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-semibold text-txt" style={{ background: "color-mix(in srgb,var(--ok) 12%,var(--surface))" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ok)" }} />Dati tuoi · occupazione reale dalle prenotazioni</span>
        {signal.hasZoneData
          ? <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-semibold text-txt" style={{ background: "color-mix(in srgb,var(--focus) 12%,var(--surface))" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--focus)" }} />Media di zona attiva{city ? ` · ${city}` : ""}</span>
          : <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 font-medium text-faint">Media di zona (Rete città): in arrivo</span>}
        {signal.hasZoneData && pulseHasDemo(pulse) && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold" style={{ color: "#B45309", background: "color-mix(in srgb,#f59e0b 16%,transparent)" }} title="La media di zona include strutture demo dimostrative, non solo concorrenti reali.">Include dati dimostrativi</span>
        )}
      </div>

      {/* Previsione storica per il prossimo weekend: solo se la confidenza è sufficiente (mai un numero inventato). */}
      {weekendForecast.length > 0 && (
        <Card className="mb-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Previsione basata sullo storico · non è intelligenza artificiale, è una media pesata dei tuoi dati reali</div>
          <ul className="space-y-1 text-sm text-txt">
            {weekendForecast.map((f) => (
              <li key={f.iso}>
                {f.label}
              </li>
            ))}
          </ul>
          {weekendForecastHasDemo && <p className="mt-2 text-[11px] text-faint">{FORECAST_DEMO_NOTE}</p>}
        </Card>
      )}

      {/* Riepilogo + interruttore autopilot */}
      <div className="mb-4 grid gap-3 lg:grid-cols-4">
        <Card><div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Suggerimenti</div><div className="mt-1 font-mono text-2xl font-bold text-txt">{suggestions.length}</div></Card>
        <Card><div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Rialzi</div><div className="mt-1 font-mono text-2xl font-bold" style={{ color: "var(--ok)" }}>{up.length}</div></Card>
        <Card><div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Ribassi</div><div className="mt-1 font-mono text-2xl font-bold" style={{ color: "var(--warn)" }}>{down.length}</div></Card>
        <Card><div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Effetto se si vendono le camere libere</div><div className="mt-1 font-mono text-2xl font-bold" style={{ color: impact.net >= 0 ? "var(--ok)" : "var(--warn)" }}>{impact.net >= 0 ? "+" : "−"}{eur(Math.abs(impact.net))}</div><div className="mt-0.5 text-[10px] text-faint">su {impact.freeNightRooms} notti-camera libere · {impact.soldNightRooms} già vendute restano al loro prezzo</div></Card>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setCfgPersist({ on: !cfg.on })} className="relative h-7 w-12 rounded-full transition" style={{ backgroundColor: cfg.on ? "var(--ok)" : "var(--line)" }} title="Autopilot: applica i suggerimenti da solo">
              <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all" style={{ left: cfg.on ? "22px" : "2px" }} />
            </button>
            <div>
              <div className="text-sm font-semibold text-txt">Autopilot {cfg.on ? "attivo" : "spento"}</div>
              <div className="text-[11px] text-faint">{cfg.on ? "Applica automaticamente entro i limiti impostati, una volta al giorno quando apri l'app (non lavora sul server a app chiusa)." : "Suggerisce soltanto: applichi tu."} {scopeSid ? `Impostazioni valide solo per ${getStructure(scopeSid)?.name ?? "questa struttura"}.` : structures.length > 1 ? "Impostazioni predefinite: valgono per le strutture che non ne hanno di proprie (selezionane una in alto a destra per personalizzarle)." : ""}</div>
            </div>
          </div>
          <button onClick={() => setPreview(true)} disabled={!suggestions.length} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Applica tutti ({suggestions.length})</button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className={lbl}>Orizzonte (giorni)<input type="number" min={7} max={120} value={cfg.horizonDays} onChange={(e) => setCfgPersist({ horizonDays: Math.min(120, Math.max(1, Number(e.target.value) || 30)) })} className={inp} /></label>
          <label className={lbl}>Variazione max ±%<input type="number" min={5} max={80} value={cfg.maxChangePct} onChange={(e) => setCfgPersist({ maxChangePct: Math.min(80, Math.max(1, Number(e.target.value) || 25)) })} className={inp} /></label>
          <label className={lbl}>Pavimento (% base)<input type="number" min={30} max={100} value={cfg.floorPct} onChange={(e) => setCfgPersist({ floorPct: Math.min(100, Math.max(10, Number(e.target.value) || 70)) })} className={inp} /></label>
          <label className={lbl}>Tetto (% base)<input type="number" min={100} max={400} value={cfg.ceilPct} onChange={(e) => setCfgPersist({ ceilPct: Math.min(400, Math.max(100, Number(e.target.value) || 180)) })} className={inp} /></label>
        </div>
        <p className="mt-3 text-[11px] text-faint">Guardrail: su una tariffa base di € 100 il prezzo proposto resta sempre tra <b className="text-dim">€ {guardExample.lo}</b> e <b className="text-dim">€ {guardExample.hi}</b>. Rispetta anche il prezzo minimo della tipologia (se impostato in Camere). I giorni frenati da un limite sono segnati nella tabella.</p>
      </Card>

      {/* Avvisi sui dati: tipologie senza tariffa, prenotazioni senza camera */}
      {(zeroPriceTypes.length > 0 || gapScan.unassigned.length > 0) && (
        <div className="mb-4 space-y-2">
          {zeroPriceTypes.length > 0 && (
            <div className="rounded-xl border px-3 py-2 text-[12px]" style={{ borderColor: "color-mix(in srgb,#f59e0b 35%,var(--line))", background: "color-mix(in srgb,#f59e0b 8%,var(--surface))", color: "#B45309" }}>
              <b>Tariffa base mancante:</b> {zeroPriceTypes.map((r) => r.name).join(", ")}. Senza una tariffa base l&apos;autopilot non può proporre nulla per queste tipologie: impostala in Tariffe.
            </div>
          )}
          {gapScan.unassigned.length > 0 && (
            <div className="rounded-xl border px-3 py-2 text-[12px]" style={{ borderColor: "color-mix(in srgb,#f59e0b 35%,var(--line))", background: "color-mix(in srgb,#f59e0b 8%,var(--surface))", color: "#B45309" }}>
              <b>{gapScan.unassigned.length} {gapScan.unassigned.length === 1 ? "prenotazione senza camera assegnata" : "prenotazioni senza camera assegnata"}</b> nei prossimi 60 giorni: contano comunque sulla loro tipologia per calcolare l&apos;occupazione, ma assegnale dal Calendario per avere buchi e notti orfane precisi.
            </div>
          )}
        </div>
      )}

      {/* Notti orfane: buchi di 1-2 notti tra due prenotazioni della stessa camera */}
      <Card className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Notti orfane · prossimi 60 giorni</SectionTitle>
          <span className="text-[11px] text-faint">{gapScan.gaps.length ? `${gapScan.gaps.length} buchi` : "da prenotazioni reali"}</span>
        </div>
        {gapScan.gaps.length === 0 ? (
          <p className="py-3 text-center text-sm text-faint">Nessun buco di 1-2 notti tra due prenotazioni della stessa camera.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {gapScan.gaps.slice(0, 12).map((g) => (
              <li key={`${g.unitId}|${g.from}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0"><span className="font-medium text-txt">{g.unitName}</span> <span className="text-dim">· {g.typeName}</span>{structures.length > 1 && scope === "all" && <span className="text-faint"> · {getStructure(g.structureId)?.name ?? ""}</span>}
                  <div className="text-[11px] text-faint">{fmtDay(g.from)} → {fmtDay(g.to)} · {g.nights} {g.nights === 1 ? "notte" : "notti"} libere{g.value > 0 ? ` · valgono ${eur(g.value)} a tariffa attuale` : ""}</div></div>
                {g.unsellable
                  ? <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: "var(--err)", background: "color-mix(in srgb,var(--err) 12%,transparent)" }} title="La tipologia richiede più notti del buco: oggi non è vendibile così com'è.">non vendibile · minimo {g.minStay} notti</span>
                  : <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-dim">vendibile</span>}
              </li>
            ))}
          </ul>
        )}
        {gapScan.gaps.length > 12 && <p className="mt-2 text-[11px] text-faint">Mostrati i primi 12 di {gapScan.gaps.length}.</p>}
        {gapScan.gaps.length > 0 && <p className="mt-2 text-[11px] text-faint">Un buco di 1-2 notti è difficile da riempire: se è &quot;non vendibile&quot; valuta di ridurre il minimo notti per quelle date dal Calendario.</p>}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Suggerimenti prezzo</SectionTitle>
          <span className="text-[11px] text-faint">prossimi {cfg.horizonDays} giorni{structures.length > 1 && scope !== "all" ? ` · ${getStructure(scope)?.name ?? ""}` : ""}</span>
        </div>
        {suggestions.length === 0 ? (
          <p className="py-8 text-center text-sm text-faint">{scopedTypes.length === 0 ? "Nessuna tipologia con camere attive: aggiungi camere e tipologie per ricevere suggerimenti." : zeroPriceTypes.length === scopedTypes.length ? "Nessuna tipologia ha una tariffa base: impostala in Tariffe per ricevere suggerimenti." : "Nessun aggiustamento consigliato: le tariffe sono già in linea con l'occupazione attuale."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint"><th className="px-2 py-2 font-semibold">Giorno</th><th className="px-2 py-2 font-semibold">Tipologia</th><th className="px-2 py-2 text-center font-semibold">Occ.</th><th className="px-2 py-2 text-right font-semibold">Attuale</th><th className="px-2 py-2 text-right font-semibold">Suggerito</th><th className="px-2 py-2 font-semibold">Perché</th><th className="px-2 py-2"></th></tr></thead>
              <tbody>
                {suggestions.slice(0, 200).map((s) => (
                  <tr key={s.key} className="border-b border-line last:border-0 hover:bg-wash">
                    <td className="whitespace-nowrap px-2 py-2 text-dim">{fmtDay(s.iso)}</td>
                    <td className="px-2 py-2 font-medium text-txt">{s.typeName}</td>
                    <td className="px-2 py-2 text-center font-mono text-dim">{s.occ}%</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-dim">{eur(s.current)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-mono font-bold" style={{ color: s.suggested >= s.current ? "var(--ok)" : "var(--warn)" }}>{eur(s.suggested)} <span className="text-[10px]">({s.deltaPct > 0 ? "+" : ""}{s.deltaPct}%)</span></td>
                    <td className="px-2 py-2 text-[11px] text-faint">{explainSuggestionCompact(s)}{s.limitedBy && <span className="ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: "#B45309", background: "color-mix(in srgb,#f59e0b 16%,transparent)" }} title={`Frenato da: ${GUARDRAIL_LABEL[s.limitedBy]}. Senza limiti: ${eur(s.rawSuggested)}`}>limitato</span>}</td>
                    <td className="px-2 py-2 text-right"><button onClick={() => applyOne(s)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash">Applica</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {suggestions.length > 200 && <p className="mt-2 text-center text-[11px] text-faint">Mostrati i primi 200 di {suggestions.length}. Usa &quot;Applica tutti&quot; per il resto.</p>}
          </div>
        )}
      </Card>

      {limitedCount > 0 && <p className="mt-3 text-[11px] text-faint">{limitedCount} proposte sono state frenate dai tuoi limiti (badge &quot;limitato&quot;): allarga i guardrail se vuoi che il motore si muova di più.</p>}
      <p className="mt-3 text-[11px] text-faint">Le tariffe applicate diventano override nel calendario: puoi sempre modificarle o rimuoverle da Tariffe/Calendario, oppure annullare l&apos;applicazione dallo storico qui sotto.</p>

      <PriceHistoryCard structureId={scope} sources={["autopilot-manuale", "autopilot-auto"]} />

      <ImpactPreview
        open={preview}
        title={`Applica ${suggestions.length} aggiustamenti`}
        subtitle={scopeSid ? `Solo su ${getStructure(scopeSid)?.name ?? "questa struttura"}` : structures.length > 1 ? "Su tutte le strutture, ciascuna con i propri limiti" : undefined}
        impact={impact}
        examples={suggestions.slice(0, 5).map((s) => ({ label: `${s.typeName} · ${fmtDay(s.iso)}`, from: s.current, to: s.suggested, note: s.limitedBy ? `Frenato da: ${GUARDRAIL_LABEL[s.limitedBy]}` : undefined }))}
        notes={limitedCount ? [`${limitedCount} proposte sono limitate dai guardrail.`] : undefined}
        confirmLabel={`Applica ${suggestions.length}`}
        onConfirm={applyAll}
        onCancel={() => setPreview(false)}
      />
    </div>
  );
}
