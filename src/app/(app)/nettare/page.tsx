"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { toISO, shiftISO, nights } from "@/lib/dates";
import { eur } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { useConfirm } from "@/components/ConfirmProvider";
import { italianHolidays, italianBridges } from "@/lib/holidays";
import { DEFAULT_STRAT, RISK_PRESET, MONTHS, cellKey, runNettare, applyMod, hasMod, normalizeStrategy, type Cell, type Mod, type Period, type Risk, type Strategy, type Step } from "@/lib/nettare";
import { effBase } from "@/lib/pricing";

const WINDOW = 90;
const FUTURE = 30;
const GRID_DAYS = 30;
const PREVIEW = 90;
const STRAT_KEY = "spigolestay:nettare:strategy";
const MODS_KEY = "spigolestay:nettare:mods";

type Pulse = { n_structures: number; occupancy: number | null; adr: number | null };

const money2 = (n: number) => `${n >= 0 ? "+" : "−"} ${Math.abs(n).toFixed(2).replace(".", ",")} €`;

export default function NettarePage() {
  const { t } = useLang();
  const ask = useConfirm();
  const { structures, roomTypes, units, bookings, events, rateOverrides, activeStructureId, setDayRates } = useData();
  const { user } = useAuth();

  const struct = useMemo(() => {
    const active = structures.find((s) => s.id === activeStructureId && (s.city || "").trim());
    return active || structures.find((s) => s.id === activeStructureId) || structures.find((s) => (s.city || "").trim()) || structures[0];
  }, [structures, activeStructureId]);
  const city = (struct?.city || "").trim();
  const today = toISO(new Date());

  const [strat, setStrat] = useState<Strategy>(DEFAULT_STRAT);
  const [mods, setMods] = useState<Record<string, Mod>>({});
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [applied, setApplied] = useState(false);
  const [start, setStart] = useState(today);
  const [openStrat, setOpenStrat] = useState(true);
  const [openStart, setOpenStart] = useState(false);
  const [scope, setScope] = useState<string>("general");
  const [previewRt, setPreviewRt] = useState("");
  const [openKids, setOpenKids] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const [panel, setPanel] = useState<string | null>(null);

  useEffect(() => {
    try { const r = localStorage.getItem(STRAT_KEY); if (r) setStrat(normalizeStrategy(JSON.parse(r))); } catch {}
    try { const r = localStorage.getItem(MODS_KEY); if (r) setMods(JSON.parse(r)); } catch {}
  }, []);
  const upd = (p: Partial<Strategy>) => setStrat((s) => { const n = { ...s, ...p }; try { localStorage.setItem(STRAT_KEY, JSON.stringify(n)); } catch {} return n; });
  const saveMods = (next: Record<string, Mod>) => { setMods(next); try { localStorage.setItem(MODS_KEY, JSON.stringify(next)); } catch {} };

  const sUnits = useMemo(() => units.filter((u) => u.structureId === struct?.id && !u.outOfService), [units, struct?.id]);
  const sRooms = sUnits.length;
  const sTypes = useMemo(() => roomTypes.filter((rt) => rt.structureId === struct?.id), [roomTypes, struct?.id]);
  const mainType = useMemo(() => {
    if (!sTypes.length) return undefined;
    return [...sTypes].sort((a, b) => sUnits.filter((u) => u.roomTypeId === b.id).length - sUnits.filter((u) => u.roomTypeId === a.id).length)[0];
  }, [sTypes, sUnits]);
  const sBookings = useMemo(() => bookings.filter((b) => b.structureId === struct?.id && b.status !== "cancelled" && b.channel !== "blocked"), [bookings, struct?.id]);

  const my = useMemo(() => {
    let rt = 0, rs = 0, rev = 0;
    if (struct && sRooms > 0) for (let i = 0; i < WINDOW; i++) {
      const D = shiftISO(today, -i); const a = sBookings.filter((b) => b.checkIn <= D && b.checkOut > D);
      rt += sRooms; rs += a.length; rev += a.reduce((s, b) => s + (b.total || 0) / Math.max(1, nights(b.checkIn, b.checkOut)), 0);
    }
    return { occ: rt ? rs / rt : 0, adr: rs ? rev / rs : 0 };
  }, [struct, sRooms, sBookings, today]);

  const basePrice = useMemo(() => (my.adr > 0 ? Math.round(my.adr) : (mainType?.basePrice ?? 0) || 90), [my.adr, mainType]);
  const market = useMemo(() => ({
    cityHot: pulse?.occupancy != null && pulse.occupancy > my.occ + 0.05,
    adrGap: pulse?.adr != null && my.adr > 0 ? (pulse.adr - my.adr) / my.adr : 0,
  }), [pulse, my]);

  const refresh = useCallback(async () => {
    if (!supabase || !user?.id || !city) return;
    try {
      const { data } = await supabase.rpc("market_pulse", { p_city: city, p_from: shiftISO(toISO(new Date()), -WINDOW), p_to: toISO(new Date()) });
      setPulse((Array.isArray(data) ? data[0] : data) as Pulse ?? null);
    } catch {}
  }, [user?.id, city]);
  useEffect(() => { void refresh(); }, [refresh]);

  const holidays = useMemo(() => { const y = new Date().getFullYear(); return italianHolidays([y, y + 1, y + 2], city); }, [city]);
  const bridges = useMemo(() => italianBridges(holidays), [holidays]);

  // date calcolate: griglia visibile + prossimi 30 giorni (per "Applica" e ricavo stimato)
  const gridDates = useMemo(() => Array.from({ length: GRID_DAYS }, (_, i) => shiftISO(start, i)), [start]);
  const allDates = useMemo(() => {
    const s = new Set<string>(gridDates); for (let i = 0; i < PREVIEW; i++) s.add(shiftISO(today, i));
    return [...s].sort();
  }, [gridDates, today]);
  const previewDates = useMemo(() => Array.from({ length: PREVIEW }, (_, i) => shiftISO(today, i)), [today]);

  const res = useMemo(() => {
    if (!struct || sRooms === 0) return { days: [], cells: {} as Record<string, Cell> };
    return runNettare({ strat, dates: allDates, today, roomTypes: sTypes, allRoomTypes: roomTypes, units: sUnits, bookings: sBookings, events, holidays, bridges, market, structBase: basePrice, mods });
  }, [struct, sRooms, strat, allDates, today, sTypes, roomTypes, sUnits, sBookings, events, holidays, bridges, market, basePrice, mods]);
  const dayMap = useMemo(() => Object.fromEntries(res.days.map((d) => [d.date, d])), [res.days]);

  const next30 = useMemo(() => Array.from({ length: FUTURE }, (_, i) => shiftISO(today, i)), [today]);
  const published = (rtId: string, iso: string): number | undefined => rateOverrides[cellKey(rtId, iso)] ?? rateOverrides[iso];
  const stats = useMemo(() => {
    let sum = 0, n = 0, potential = 0, pending = 0;
    const occ = my.occ || 0.5;
    for (const rt of sTypes) {
      const rtUnits = sUnits.filter((u) => u.roomTypeId === rt.id).length;
      for (const d of next30) {
        const c = res.cells[cellKey(rt.id, d)]; if (!c) continue;
        sum += c.final; n++; potential += (c.final - c.base) * occ * rtUnits;
        if (published(rt.id, d) !== c.final) pending++;
      }
    }
    return { avg: n ? Math.round(sum / n) : basePrice, potential: Math.round(potential), pending };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.cells, sTypes, sUnits, next30, my.occ, basePrice, rateOverrides]);

  const applyPrices = async () => {
    if (!sTypes.length) return;
    const ok = await ask({ title: t("Applica prezzi Nèttare"), message: `${t("Imposto i prezzi consigliati (con i tuoi modificatori) per i prossimi")} ${FUTURE} ${t("giorni su tutte le tipologie di")} ${struct?.name}. ${t("Potrai modificarli a mano quando vuoi.")}`, confirmLabel: t("Applica") });
    if (!ok) return;
    const map: Record<string, number> = {};
    for (const rt of sTypes) for (const d of next30) { const c = res.cells[cellKey(rt.id, d)]; if (c) map[cellKey(rt.id, d)] = c.final; }
    setDayRates(map);
    setApplied(true); setTimeout(() => setApplied(false), 2400);
  };

  if (!struct) return (<div><PageHeader title="Nèttare" subtitle={t("Prezzi dinamici")} /><div className="rounded-2xl border border-line p-4 text-sm text-dim" style={{ background: "var(--surface)" }}>{t("Aggiungi prima una struttura.")}</div></div>);

  const COL = 74, LABEL = 188;
  // righe tipologie: madri, con le derivate raccolte in una tendina sotto la madre
  const typeIds = new Set(sTypes.map((r) => r.id));
  const kidsOf = (id: string) => sTypes.filter((r) => r.deriveFrom === id && r.id !== id);
  const gridRows: { rt: (typeof sTypes)[number]; depth: number; kids: number }[] = [];
  const pushRow = (rt: (typeof sTypes)[number], depth: number, seen: Set<string>) => {
    if (seen.has(rt.id)) return; seen.add(rt.id);
    const kids = kidsOf(rt.id);
    gridRows.push({ rt, depth, kids: kids.length });
    if (openKids[rt.id]) kids.forEach((k) => pushRow(k, depth + 1, seen));
  };
  sTypes.filter((r) => !r.deriveFrom || !typeIds.has(r.deriveFrom)).forEach((r) => pushRow(r, 0, new Set()));
  const hoverCell = hover ? res.cells[hover.key] : undefined;
  const panelCell = panel ? res.cells[panel] : undefined;

  // ── strategia: generale o periodo selezionato ──
  const period = scope === "general" ? undefined : strat.periods.find((p) => p.id === scope);
  const cur = period ?? strat;
  const updScope = (p: Partial<Period>) => { if (period) upd({ periods: strat.periods.map((x) => (x.id === period.id ? { ...x, ...p } : x)) }); else upd(p as Partial<Strategy>); };
  const presetOf = (down: number, up: number) => (Object.keys(RISK_PRESET) as Risk[]).find((k) => RISK_PRESET[k].down === down && RISK_PRESET[k].up === up);
  const addPeriod = () => {
    const d = new Date();
    const p: Period = { id: `p${Date.now()}`, name: t("Nuovo periodo"), from: toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1)), to: toISO(new Date(d.getFullYear(), d.getMonth() + 2, 0)), goal: strat.goal, down: strat.down, up: strat.up, startAdj: 0, eventImpact: strat.eventImpact };
    upd({ periods: [...strat.periods, p] }); setScope(p.id);
  };
  const delPeriod = async () => {
    if (!period) return;
    if (!(await ask({ title: t("Elimina periodo"), message: `${t("Elimino il periodo")} «${period.name}». ${t("In quelle date tornerà a valere la strategia generale.")}`, confirmLabel: t("Elimina"), danger: true }))) return;
    upd({ periods: strat.periods.filter((x) => x.id !== period.id) }); setScope("general");
  };

  // ── anteprima ──
  const pvRt = sTypes.find((r) => r.id === previewRt) ?? mainType;
  const pvSeries = pvRt ? [
    { key: "start", label: t("Prezzi di partenza"), color: "var(--faint)", dash: "5 4", values: previewDates.map((d) => res.cells[cellKey(pvRt.id, d)]?.base) },
    { key: "nettare", label: t("Strategia Nèttare"), color: "var(--chart-1)", values: previewDates.map((d) => res.cells[cellKey(pvRt.id, d)]?.final) },
    { key: "pub", label: t("Prezzi applicati"), color: "var(--chart-2)", values: previewDates.map((d) => published(pvRt.id, d)) },
  ] : [];

  return (
    <div>
      <style>{`:root{--chart-1:#2F6BB0;--chart-2:#C9751A}.dark{--chart-1:#6FA3DC;--chart-2:#D98A3A}`}</style>
      <PageHeader title="Nèttare" subtitle={`${t("Prezzi dinamici")}${city ? ` · ${city}` : ""}`} />

      {/* Riepilogo Nèttare */}
      <div className="mt-4 rounded-2xl border border-line p-5" style={{ background: "var(--surface)", boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 14px 34px -22px rgba(0,0,0,.16)" }}>
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-line text-xl" style={{ background: "color-mix(in srgb,var(--focus) 10%,transparent)" }}>🦋</span>
            <div><div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{t("Motore prezzi dinamici")}</div><div className="font-display text-xl font-bold tracking-tight text-txt">Nèttare</div></div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div><div className="text-[11px] font-semibold text-faint">{t("Ricavo in più stimato")} · {FUTURE}gg</div><div className="font-mono text-3xl font-extrabold tracking-tight" style={{ color: stats.potential > 0 ? "var(--ok)" : "var(--txt)" }}>{stats.potential > 0 ? "+" : ""}{eur(stats.potential)}</div></div>
            <div><div className="text-[11px] text-faint">{t("Prezzo medio")}</div><div className="font-mono text-lg font-bold text-txt">{eur(stats.avg)}</div></div>
            <div><div className="text-[11px] text-faint">{t("Periodi")}</div><div className="font-mono text-lg font-bold text-txt">{strat.periods.length}</div></div>
            <div><div className="text-[11px] text-faint">{t("Da applicare")}</div><div className="font-mono text-lg font-bold" style={{ color: stats.pending ? "var(--warn)" : "var(--ok)" }}>{stats.pending}</div></div>
            <button onClick={applyPrices} className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95" style={{ background: "var(--focus)" }}>{applied ? `✓ ${t("Prezzi applicati")}` : `${t("Applica ai prossimi")} ${FUTURE} ${t("giorni")}`}</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
          <span className="text-faint">{t("Nèttare consiglia, tu applichi. I prezzi applicati vanno nel calendario di Xenora.")}</span>
          {city && <Link href="/mercato" className="font-medium" style={{ color: "var(--focus)" }}>{t("Vedi i dati della Rete città")} →</Link>}
        </div>
      </div>

      {/* Prezzi di partenza */}
      <Card title={t("Prezzi di partenza")} desc={t("La base su cui Nèttare costruisce i prezzi: tariffa per tipologia e stagionalità per mese.")} open={openStart} onToggle={() => setOpenStart((v) => !v)}>
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Tariffa di partenza per tipologia")}</div>
            <div className="mt-1.5 divide-y divide-[var(--line)] rounded-xl border border-line">
              {sTypes.map((rt) => {
                const def = Math.max(0, effBase(rt, roomTypes)) || basePrice;
                const v = strat.starting[rt.id];
                return (
                  <div key={rt.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0"><div className="truncate text-sm font-medium text-txt">{rt.name}</div><div className="text-[11px] text-faint">{t("tariffa in Camere")}: {eur(def)}</div></div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {v != null && <button onClick={() => { const s = { ...strat.starting }; delete s[rt.id]; upd({ starting: s }); }} className="text-[11px] text-faint hover:underline">{t("ripristina")}</button>}
                      <input type="number" inputMode="numeric" min={0} value={v ?? ""} placeholder={String(def)} onChange={(e) => { const s = { ...strat.starting }; if (e.target.value === "") delete s[rt.id]; else s[rt.id] = Number(e.target.value); upd({ starting: s }); }} className="w-24 rounded-lg border border-line px-2 py-1.5 text-right font-mono text-sm" style={{ background: "var(--surface)", color: "var(--txt)" }} />
                      <span className="text-xs text-dim">€</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4"><Slider label={t("Regolazione generale prezzi di partenza")} value={strat.startAdj} min={-30} max={50} step={1} suffix="%" onChange={(v) => upd({ startAdj: v })} hint={t("Alza o abbassa tutte le tariffe di partenza in un colpo.")} /></div>
          </div>
          <div>
            <div className="flex items-end justify-between"><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Stagionalità")}</div><button onClick={() => upd({ season: Array(12).fill(0) })} className="text-[11px] text-faint hover:underline">{t("azzera")}</button></div>
            <div className="mt-1.5 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {MONTHS.map((m, i) => {
                const v = strat.season[i] || 0;
                return (
                  <label key={m} className="rounded-xl border border-line p-2 text-center" style={{ background: v > 0 ? "color-mix(in srgb,var(--ok) 8%,var(--surface))" : v < 0 ? "color-mix(in srgb,var(--focus) 8%,var(--surface))" : "var(--surface)" }}>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-dim">{t(m)}</div>
                    <div className="mx-auto my-1 flex h-8 w-2 flex-col justify-end overflow-hidden rounded-full" style={{ background: "var(--wash)" }}><div style={{ height: `${Math.min(100, Math.abs(v) * 2)}%`, background: v >= 0 ? "var(--ok)" : "var(--focus)", borderRadius: 4 }} /></div>
                    <div className="flex items-center justify-center"><input type="number" inputMode="numeric" value={v || ""} placeholder="0" onChange={(e) => { const s = [...strat.season]; s[i] = e.target.value === "" ? 0 : Number(e.target.value); upd({ season: s }); }} className="w-10 bg-transparent text-right font-mono text-xs outline-none" style={{ color: "var(--txt)" }} /><span className="text-[10px] text-dim">%</span></div>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-faint">{t("Esempio: agosto +40%, novembre −15%. Nèttare parte da qui e poi aggiunge weekend, festivi, eventi e occupazione.")}</p>
          </div>
        </div>
      </Card>

      {/* Strategia */}
      <Card title={t("Strategia")} desc={t("Una strategia generale e, se vuoi, periodi con regole diverse (es. agosto più aggressivo).")} open={openStrat} onToggle={() => setOpenStrat((v) => !v)}>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Chip on={scope === "general"} onClick={() => setScope("general")}>{t("Strategia generale")}</Chip>
          {strat.periods.map((p) => <Chip key={p.id} on={scope === p.id} onClick={() => setScope(p.id)}>{p.name}<span className="ml-1.5 font-normal opacity-70">{fmtShort(p.from)}–{fmtShort(p.to)}</span></Chip>)}
          <button onClick={addPeriod} className="rounded-full border border-dashed border-line px-3 py-1.5 text-xs font-semibold text-dim hover:text-txt">+ {t("Nuovo periodo")}</button>
        </div>

        {period && (
          <div className="mt-4 grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_auto_auto_auto]" style={{ background: "var(--wash)" }}>
            <input value={period.name} onChange={(e) => updScope({ name: e.target.value })} className="rounded-lg border border-line px-3 py-2 text-sm" style={{ background: "var(--surface)", color: "var(--txt)" }} aria-label={t("Nome periodo")} />
            <label className="flex items-center gap-1.5 text-xs text-dim">{t("dal")}<input type="date" value={period.from} onChange={(e) => updScope({ from: e.target.value })} className="rounded-lg border border-line px-2 py-1.5 text-sm" style={{ background: "var(--surface)", color: "var(--txt)" }} /></label>
            <label className="flex items-center gap-1.5 text-xs text-dim">{t("al")}<input type="date" value={period.to} min={period.from} onChange={(e) => updScope({ to: e.target.value })} className="rounded-lg border border-line px-2 py-1.5 text-sm" style={{ background: "var(--surface)", color: "var(--txt)" }} /></label>
            <button onClick={delPeriod} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ color: "var(--err)" }}>{t("Elimina")}</button>
          </div>
        )}

        <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Obiettivo")}</div>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          <GoalBtn on={cur.goal === "fill"} onClick={() => updScope({ goal: "fill" })} label={t("Riempi")} desc={t("più occupazione, prezzi più morbidi")} />
          <GoalBtn on={cur.goal === "balanced"} onClick={() => updScope({ goal: "balanced" })} label={t("Bilanciato")} desc={t("equilibrio prezzo/occupazione")} />
          <GoalBtn on={cur.goal === "revenue"} onClick={() => updScope({ goal: "revenue" })} label={t("Massimo ricavo")} desc={t("spingi il RevPAR quando c'è domanda")} />
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="flex items-end justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Aggressività")}</div>
              <span className="text-[11px] text-faint">{presetOf(cur.down, cur.up) ? "" : t("personalizzata")}</span>
            </div>
            <div className="mt-1.5 flex rounded-lg border border-line p-0.5" style={{ background: "var(--wash)" }}>
              {(["prudente", "bilanciato", "aggressivo"] as Risk[]).map((k) => <Seg key={k} on={presetOf(cur.down, cur.up) === k} onClick={() => updScope({ ...RISK_PRESET[k], ...(period ? {} : { risk: k }) } as Partial<Period>)}>{t(k[0].toUpperCase() + k.slice(1))}</Seg>)}
            </div>
            <div className="mt-3 space-y-3">
              <Slider label={t("Ribasso massimo")} value={cur.down} min={0} max={40} step={1} prefix="−" suffix="%" onChange={(v) => updScope({ down: v })} hint={t("Quanto può scendere sotto il prezzo di partenza.")} />
              <Slider label={t("Rialzo massimo")} value={cur.up} min={0} max={100} step={1} prefix="+" suffix="%" onChange={(v) => updScope({ up: v })} hint={t("Quanto può salire nei giorni di domanda alta.")} />
            </div>
          </div>
          <div className="space-y-3">
            {period && <Slider label={t("Prezzi di partenza in questo periodo")} value={period.startAdj} min={-30} max={80} step={1} suffix="%" onChange={(v) => updScope({ startAdj: v })} hint={t("Si aggiunge alla stagionalità del mese.")} />}
            <Slider label={t("Impatto eventi locali")} value={cur.eventImpact} min={0} max={60} step={1} prefix="+" suffix="%" onChange={(v) => updScope({ eventImpact: v })} hint={t("Di quanto alzare nei giorni con un evento in calendario.")} />
            {!period && <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Guardrail")} · {t("prezzo min / max")}</div>
              <div className="mt-1.5 flex gap-2">
                <input type="number" inputMode="numeric" placeholder={t("min €")} value={strat.minPrice ?? ""} onChange={(e) => upd({ minPrice: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-lg border border-line px-3 py-2 text-sm" style={{ background: "var(--surface)", color: "var(--txt)" }} />
                <input type="number" inputMode="numeric" placeholder={t("max €")} value={strat.maxPrice ?? ""} onChange={(e) => upd({ maxPrice: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-lg border border-line px-3 py-2 text-sm" style={{ background: "var(--surface)", color: "var(--txt)" }} />
              </div>
              <div className="mt-1.5 text-[11px] text-faint">{t("Nèttare non andrà mai oltre questi limiti.")}</div>
            </div>}
          </div>
        </div>

        {!period && <>
          <div className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Regole")}</div>
          <div className="mt-1 grid gap-x-8 sm:grid-cols-2">
            <div className="border-t border-line"><Tgl on={strat.followMarket} onClick={() => upd({ followMarket: !strat.followMarket })} label={t("Segui il mercato")} hint={t("usa i segnali della Rete città")} /></div>
            <div className="border-t border-line"><Tgl on={strat.events} onClick={() => upd({ events: !strat.events })} label={t("Eventi, festività & weekend")} hint={t("cavalca weekend, festivi, ponti ed eventi")} /></div>
            <div className="border-t border-line"><Tgl on={strat.lastMinute} onClick={() => upd({ lastMinute: !strat.lastMinute })} label={t("Last-minute")} hint={t("sconti sugli ultimi giorni vuoti")} /></div>
            <div className="border-t border-line"><Tgl on={strat.minStay} onClick={() => upd({ minStay: !strat.minStay })} label={t("Min-stay dinamico")} hint={t("notti minime nei picchi")} /></div>
          </div>
        </>}
        {period && <p className="mt-4 text-[11px] text-faint">{t("Regole, guardrail e stagionalità restano quelli della strategia generale.")}</p>}
      </Card>

      {/* Anteprima strategia */}
      <section className="mt-4 rounded-2xl border border-line p-5" style={{ background: "var(--surface)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Anteprima strategia")}</h3>
            <p className="mt-0.5 text-xs text-dim">{t("Prossimi")} {PREVIEW} {t("giorni. Si aggiorna mentre modifichi strategia e prezzi di partenza, prima di applicare.")}</p>
          </div>
          {sTypes.length > 1 && (
            <select value={pvRt?.id ?? ""} onChange={(e) => setPreviewRt(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm" style={{ background: "var(--surface)", color: "var(--txt)" }} aria-label={t("Tipologia")}>
              {sTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
            </select>
          )}
        </div>
        {pvRt ? <PriceChart dates={previewDates} series={pvSeries} periods={strat.periods} t={t} /> : <p className="mt-3 text-xs text-faint">{t("Aggiungi camere e prezzi per vedere i consigli.")}</p>}
      </section>

      {/* Calendario prezzi */}
      <section className="mt-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Calendario prezzi")}</h3>
            <p className="mt-0.5 text-xs text-dim">{t("Passa sopra una cella per vedere il perché del prezzo, cliccala per modificarla.")}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setStart((s) => (shiftISO(s, -GRID_DAYS) < today ? today : shiftISO(s, -GRID_DAYS)))} disabled={start <= today} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-dim disabled:opacity-40" style={{ background: "var(--surface)" }} aria-label={t("30 giorni prima")}>‹</button>
            <button onClick={() => setStart(today)} className="h-8 rounded-lg border border-line px-3 text-xs font-semibold text-txt" style={{ background: "var(--surface)" }}>{t("Oggi")}</button>
            <button onClick={() => setStart((s) => shiftISO(s, GRID_DAYS))} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-dim" style={{ background: "var(--surface)" }} aria-label={t("30 giorni dopo")}>›</button>
            <input type="date" value={start} min={today} onChange={(e) => e.target.value && setStart(e.target.value < today ? today : e.target.value)} className="h-8 rounded-lg border border-line px-2 text-xs" style={{ background: "var(--surface)", color: "var(--txt)" }} />
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line" style={{ background: "var(--surface)" }} onMouseLeave={() => setHover(null)}>
          {sTypes.length && sRooms ? (
            <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: LABEL + COL * GRID_DAYS }}>
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-line" style={{ width: LABEL, minWidth: LABEL, background: "var(--surface)" }} />
                  {gridDates.map((d) => {
                    const dt = new Date(d + "T00:00:00"), wd = dt.getDay(), we = wd === 5 || wd === 6, isToday = d === today;
                    return (
                      <th key={d} className="border-b border-line px-1 py-2 text-center" style={{ width: COL, minWidth: COL, background: isToday ? "var(--focus)" : we ? "color-mix(in srgb,var(--focus) 9%,var(--surface))" : "var(--surface)", color: isToday ? "#fff" : "var(--txt)" }}>
                        <div className="text-[10px] font-bold uppercase tracking-wide" style={{ opacity: isToday ? 1 : 0.7 }}>{dt.toLocaleDateString("it-IT", { weekday: "short" })}</div>
                        <div className="text-[12px] font-semibold">{dt.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Occupazione struttura */}
                <tr>
                  <td className="sticky left-0 z-10 border-b border-r border-line px-3 py-2 font-bold text-txt" style={{ background: "var(--surface)" }}>{struct.name}<div className="text-[10px] font-medium text-faint">{t("occupazione")}</div></td>
                  {gridDates.map((d) => { const di = dayMap[d]; const p = Math.round((di?.occ ?? 0) * 100); return (
                    <td key={d} className="relative border-b border-line text-center" style={{ height: 52 }}>
                      <div className="absolute inset-x-0 bottom-0" style={{ height: `${Math.max(3, p * 0.5)}%`, background: "color-mix(in srgb,var(--ok) 22%,transparent)" }} />
                      <span className="relative font-mono text-[13px] font-semibold text-txt">{p}%</span>
                    </td>
                  ); })}
                </tr>
                {/* Festività */}
                <tr>
                  <td className="sticky left-0 z-10 border-b border-r border-line px-3 py-1.5 text-[12px] font-semibold" style={{ background: "var(--surface)", color: "var(--focus)" }}>{t("Festività & ponti")}</td>
                  {gridDates.map((d) => { const h = dayMap[d]?.holiday, br = dayMap[d]?.bridge; return (
                    <td key={d} className="border-b border-line px-1 py-1.5">
                      {h && <div title={h} className="truncate rounded-md px-1.5 py-0.5 text-center text-[10px] font-semibold text-white" style={{ background: "var(--focus)" }}>{h}</div>}
                      {!h && br && <div title={`${t("Ponte")} · ${br}`} className="truncate rounded-md border px-1.5 py-0.5 text-center text-[10px] font-semibold" style={{ borderColor: "var(--focus)", color: "var(--focus)" }}>{t("Ponte")}</div>}
                    </td>
                  ); })}
                </tr>
                {/* Eventi locali */}
                <tr>
                  <td className="sticky left-0 z-10 border-b border-r border-line px-3 py-1.5 text-[12px] font-semibold" style={{ background: "var(--surface)", color: "var(--warn)" }}>{t("Eventi locali")}<Link href="/calendario" className="ml-1 text-[10px] font-medium text-faint hover:underline">+ {t("aggiungi")}</Link></td>
                  {gridDates.map((d) => { const evs = dayMap[d]?.events ?? []; return (
                    <td key={d} className="border-b border-line px-1 py-1.5">{evs.slice(0, 2).map((e) => <div key={e.id} title={e.name} className="mb-0.5 truncate rounded-md px-1.5 py-0.5 text-center text-[10px] font-semibold text-white" style={{ background: e.color }}>{e.name}</div>)}</td>
                  ); })}
                </tr>
                {/* Tipologie */}
                {gridRows.map(({ rt, depth, kids }) => (
                  <tr key={rt.id} style={depth ? { background: "color-mix(in srgb,var(--wash) 55%,transparent)" } : undefined}>
                    <td className="sticky left-0 z-10 border-b border-r border-line py-2 pr-2" style={{ background: depth ? "color-mix(in srgb,var(--wash) 55%,var(--surface))" : "var(--surface)", paddingLeft: 12 + depth * 14 }}>
                      <div className="flex items-center gap-1">
                        {kids > 0
                          ? <button onClick={() => setOpenKids((o) => ({ ...o, [rt.id]: !o[rt.id] }))} aria-expanded={!!openKids[rt.id]} aria-label={t("Mostra tariffe derivate")} className="grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] text-dim hover:bg-[var(--wash)]" style={{ transform: openKids[rt.id] ? "rotate(90deg)" : "none" }}>▸</button>
                          : <span className="w-5 shrink-0 text-center text-faint">{depth ? "└" : ""}</span>}
                        <div className="min-w-0">
                          <div className={`truncate text-[13px] text-txt ${depth ? "font-medium" : "font-semibold"}`} title={rt.name}>{rt.name}</div>
                          <div className="truncate text-[10px] text-faint">{depth ? `${t("derivata")}${rt.ratePlan ? ` · ${rt.ratePlan}` : ""}` : `${t("partenza")} ${eur(res.cells[cellKey(rt.id, gridDates[0])]?.base ?? rt.basePrice)}`}{kids > 0 && !openKids[rt.id] ? ` · ${kids} ${kids === 1 ? t("derivata") : t("derivate")}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    {gridDates.map((d) => {
                      const k = cellKey(rt.id, d), c = res.cells[k]; if (!c) return <td key={d} className="border-b border-line" />;
                      const pub = published(rt.id, d), pending = pub !== c.final;
                      const pct = c.base ? Math.round((c.final / c.base - 1) * 100) : 0;
                      const sel = panel === k || hover?.key === k;
                      return (
                        <td key={d} className="border-b border-line p-0">
                          <button
                            onClick={() => { setPanel(k); setHover(null); }}
                            onMouseEnter={(e) => { if (window.matchMedia("(hover: hover)").matches) { const r = e.currentTarget.getBoundingClientRect(); setHover({ key: k, x: r.right, y: r.top }); } }}
                            className="relative flex w-full flex-col items-center justify-center overflow-hidden text-center transition"
                            style={{ height: 62, outline: c.modActive ? "2px solid var(--warn)" : sel ? "2px solid var(--focus)" : "none", outlineOffset: -2, background: sel ? "color-mix(in srgb,var(--focus) 7%,transparent)" : "transparent" }}
                          >
                            <div className="absolute inset-x-0 bottom-0" style={{ height: 5, background: "var(--wash)" }}><div style={{ height: "100%", width: `${Math.round(c.occ * 100)}%`, background: "color-mix(in srgb,var(--ok) 55%,transparent)" }} /></div>
                            <span className="absolute left-1 top-1 flex gap-0.5 text-[9px] leading-none">
                              {c.mod?.locked != null && <span title={t("Prezzo bloccato")}>🔒</span>}
                              {c.modSet && c.mod?.locked == null && <span title={t("Modificatore impostato")} style={{ color: c.modActive ? "var(--warn)" : "var(--dim)" }}>◆</span>}
                            </span>
                            {pending && <span title={t("Da applicare")} className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full" style={{ background: "var(--warn)" }} />}
                            <span className="font-mono text-[13px] font-bold text-txt">€ {c.final}</span>
                            <span className="text-[10px] font-semibold" style={{ color: pct > 2 ? "var(--ok)" : pct < -2 ? "var(--focus)" : "var(--faint)" }}>{pct === 0 ? "=" : `${pct > 0 ? "+" : ""}${pct}%`}{c.minNights > 1 ? ` · ${c.minNights}n` : ""}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="p-4 text-xs text-faint">{t("Aggiungi camere e prezzi per vedere i consigli.")}</p>}
        </div>

        {/* Legenda */}
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-dim">
          <span className="font-semibold text-txt">{t("Legenda")}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-5 rounded" style={{ outline: "2px solid var(--warn)", outlineOffset: -2 }} />{t("Modificatore attivo")}</span>
          <span className="flex items-center gap-1.5"><span style={{ color: "var(--dim)" }}>◆</span>{t("Modificatore impostato")}</span>
          <span className="flex items-center gap-1.5">🔒 {t("Prezzo bloccato")}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--warn)" }} />{t("Da applicare")}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-5 rounded" style={{ background: "color-mix(in srgb,var(--ok) 55%,transparent)" }} />{t("Occupazione")}</span>
        </div>
      </section>

      {/* Tooltip "perché questo prezzo" */}
      {hoverCell && hover && !panel && (
        <div className="pointer-events-none fixed z-50 w-72 rounded-xl p-3.5 text-white shadow-2xl" style={{ left: Math.min(hover.x + 8, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300), top: Math.max(8, Math.min(hover.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 320)), background: "#1E1B4B" }}>
          <Breakdown c={hoverCell} dark t={t} />
        </div>
      )}

      {panelCell && <CellPanel key={panel!} c={panelCell} rtName={sTypes.find((r) => r.id === panelCell.rtId)?.name || ""} published={published(panelCell.rtId, panelCell.date)} floor={sTypes.find((r) => r.id === panelCell.rtId)?.minPrice} t={t}
        onClose={() => setPanel(null)}
        onSave={(m) => {
          const k = cellKey(panelCell.rtId, panelCell.date);
          const next = { ...mods }; if (hasMod(m)) next[k] = m; else delete next[k];
          saveMods(next);
          setDayRates({ [k]: applyMod(panelCell.recommended, m, sTypes.find((r) => r.id === panelCell.rtId)?.minPrice).final });
          setPanel(null);
        }}
        onReset={() => {
          const k = cellKey(panelCell.rtId, panelCell.date);
          const next = { ...mods }; delete next[k]; saveMods(next);
          setDayRates({ [k]: applyMod(panelCell.recommended, undefined, sTypes.find((r) => r.id === panelCell.rtId)?.minPrice).final });
          setPanel(null);
        }}
      />}
    </div>
  );
}

function Breakdown({ c, dark, t }: { c: Cell; dark?: boolean; t: (s: string) => string }) {
  const col = (s: Step) => s.kind === "limit" ? (dark ? "#FCD34D" : "var(--warn)") : s.amount >= 0 ? (dark ? "#6EE7B7" : "var(--ok)") : (dark ? "#FCA5A5" : "var(--err)");
  const rows = [...c.steps.filter((s) => Math.abs(s.amount) >= 0.005), ...c.modSteps];
  return (
    <div className="text-[12px]">
      {c.baseSteps.length > 1 && <div className="mb-1.5 space-y-0.5" style={{ opacity: 0.75 }}>
        <div className="flex justify-between"><span>{t("Tariffa di partenza")}</span><span className="font-mono">{eur(c.baseSteps[0].amount)}</span></div>
        {c.baseSteps.slice(1).map((s, i) => <div key={i} className="flex justify-between gap-3"><span className="truncate">{t(s.label)}</span><span className="shrink-0 font-mono">{money2(s.amount)}</span></div>)}
      </div>}
      <div className="flex justify-between font-semibold"><span>{t("Prezzo di partenza")}</span><span className="font-mono">{eur(c.base)}</span></div>
      <div className="my-2 space-y-1">
        {rows.length ? rows.map((s, i) => (
          <div key={i} className="flex justify-between gap-3" style={{ color: col(s) }}><span className="min-w-0 truncate">{t(s.label)}</span><span className="shrink-0 font-mono">{money2(s.amount)}</span></div>
        )) : <div style={{ opacity: 0.7 }}>{t("Nessun segnale: prezzo in linea con la base")}</div>}
      </div>
      <div className="flex justify-between border-t pt-2 text-[13px] font-bold" style={{ borderColor: dark ? "rgba(255,255,255,.2)" : "var(--line)" }}><span>{t("Prezzo Nèttare")}</span><span className="font-mono">{eur(c.final)}</span></div>
      {c.minNights > 1 && <div className="mt-1" style={{ opacity: 0.8 }}>{t("Soggiorno minimo consigliato")}: {c.minNights} {t("notti")}</div>}
    </div>
  );
}

function Field({ icon, label, tint, children }: { icon: string; label: string; tint: string; children: ReactNode }) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-line">
      <div className="flex w-[46%] items-center gap-2 px-3 py-2 text-[13px] font-medium text-txt" style={{ background: `color-mix(in srgb,${tint} 14%,var(--surface))` }}><span className="text-dim">{icon}</span>{label}</div>
      <div className="flex flex-1 items-center gap-1.5 px-2" style={{ background: "var(--surface)" }}>{children}</div>
    </div>
  );
}

function CellPanel({ c, rtName, published, floor, t, onClose, onSave, onReset }: { c: Cell; rtName: string; published?: number; floor?: number; t: (s: string) => string; onClose: () => void; onSave: (m: Mod) => void; onReset: () => void }) {
  const [m, setM] = useState<Mod>({ adjMode: "eur", ...(c.mod || {}) });
  const [sign, setSign] = useState<1 | -1>((c.mod?.adj ?? 0) < 0 ? -1 : 1);
  const [why, setWhy] = useState(true);
  const draft: Mod = { ...m, adj: m.adj != null ? Math.abs(m.adj) * sign : null };
  const preview = applyMod(c.recommended, draft, floor);
  const dt = new Date(c.date + "T00:00:00");
  const num = (v: string) => (v === "" ? null : Number(v));

  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);

  const inputCls = "w-full min-w-0 bg-transparent px-1 py-2 text-right font-mono text-sm outline-none";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(15,15,30,.28)" }} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[400px] flex-col overflow-y-auto shadow-2xl" style={{ background: "var(--paper)" }}>
        <div className="flex items-start justify-between border-b border-line px-5 py-4" style={{ background: "var(--surface)" }}>
          <div><div className="text-lg font-bold text-txt">{rtName}</div><div className="text-xs capitalize text-dim">{dt.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div></div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-[var(--wash)]" aria-label={t("Chiudi")}>✕</button>
        </div>

        <div className="space-y-3 p-5">
          <div className="overflow-hidden rounded-xl text-white" style={{ background: "var(--focus)" }}>
            <div className="flex items-end justify-between px-4 py-3">
              <div><div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{t("Prezzo Nèttare")}</div><div className="text-[11px] opacity-80">{published != null ? `${t("Applicato ora")}: ${eur(published)}` : t("Non ancora applicato")}</div></div>
              <div className="font-mono text-3xl font-extrabold">{eur(preview.final)}</div>
            </div>
            <button onClick={() => setWhy((v) => !v)} className="flex w-full items-center justify-between px-4 py-2 text-[12px] font-semibold" style={{ background: "rgba(0,0,0,.14)" }}>{t("Perché questo prezzo")}<span style={{ transform: why ? "rotate(180deg)" : "none" }}>⌄</span></button>
            {why && <div className="px-4 pb-3 pt-2" style={{ background: "rgba(0,0,0,.14)" }}><Breakdown c={{ ...c, final: preview.final, modSteps: preview.steps }} dark t={t} /></div>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: "color-mix(in srgb,var(--ok) 14%,var(--surface))" }}>
              <div className="text-[11px] font-semibold text-dim">{t("Occupazione")}</div>
              <div className="mt-1 flex items-end justify-between"><span className="font-mono text-xl font-bold text-txt">{Math.round(c.occ * 100)}%</span><span className="text-xs text-dim">{c.sold} / {c.total}</span></div>
            </div>
            <div className="rounded-xl p-3" style={{ background: "color-mix(in srgb,var(--ok) 14%,var(--surface))" }}>
              <div className="text-[11px] font-semibold text-dim">ADR</div>
              <div className="mt-1 font-mono text-xl font-bold text-txt">{eur(c.adr)}</div>
            </div>
          </div>

          <div className="rounded-xl border border-line" style={{ background: "var(--surface)" }}>
            <div className="border-b border-line px-4 py-2.5 text-[13px] font-bold text-txt">{t("Modificatori")}</div>
            <div className="space-y-2 p-3">
              <Field icon="🔒" label={t("Prezzo bloccato")} tint="var(--focus)"><input type="number" inputMode="numeric" placeholder="—" value={m.locked ?? ""} onChange={(e) => setM({ ...m, locked: num(e.target.value) })} className={inputCls} style={{ color: "var(--txt)" }} /><span className="text-xs text-dim">€</span></Field>
              <Field icon="↑" label={t("Prezzo massimo")} tint="var(--ok)"><input type="number" inputMode="numeric" placeholder="—" value={m.max ?? ""} onChange={(e) => setM({ ...m, max: num(e.target.value) })} className={inputCls} style={{ color: "var(--txt)" }} /><span className="text-xs text-dim">€</span></Field>
              <Field icon="↓" label={t("Prezzo minimo")} tint="var(--ok)"><input type="number" inputMode="numeric" placeholder="—" value={m.min ?? ""} onChange={(e) => setM({ ...m, min: num(e.target.value) })} className={inputCls} style={{ color: "var(--txt)" }} /><span className="text-xs text-dim">€</span></Field>
              <Field icon="⇅" label={t("Aumenta / diminuisci")} tint="var(--err)">
                <div className="flex shrink-0 overflow-hidden rounded-md border border-line text-xs font-bold">
                  <button onClick={() => setSign(1)} className="px-2 py-1" style={{ background: sign === 1 ? "var(--txt)" : "transparent", color: sign === 1 ? "var(--surface)" : "var(--dim)" }}>+</button>
                  <button onClick={() => setSign(-1)} className="px-2 py-1" style={{ background: sign === -1 ? "var(--txt)" : "transparent", color: sign === -1 ? "var(--surface)" : "var(--dim)" }}>−</button>
                </div>
                <input type="number" inputMode="numeric" min={0} placeholder="—" value={m.adj != null ? Math.abs(m.adj) : ""} onChange={(e) => setM({ ...m, adj: num(e.target.value) })} className={inputCls} style={{ color: "var(--txt)" }} />
                <div className="flex shrink-0 overflow-hidden rounded-md border border-line text-xs font-bold">
                  <button onClick={() => setM({ ...m, adjMode: "eur" })} className="px-2 py-1" style={{ background: m.adjMode !== "pct" ? "var(--txt)" : "transparent", color: m.adjMode !== "pct" ? "var(--surface)" : "var(--dim)" }}>€</button>
                  <button onClick={() => setM({ ...m, adjMode: "pct" })} className="px-2 py-1" style={{ background: m.adjMode === "pct" ? "var(--txt)" : "transparent", color: m.adjMode === "pct" ? "var(--surface)" : "var(--dim)" }}>%</button>
                </div>
              </Field>
              <p className="px-1 pt-1 text-[11px] text-faint">{t("I modificatori restano validi anche quando Nèttare ricalcola i prezzi.")}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-3 py-3">
              <button onClick={onReset} className="rounded-lg border px-4 py-2 text-sm font-semibold" style={{ borderColor: "var(--focus)", color: "var(--focus)" }}>{t("Reset")}</button>
              <button onClick={() => onSave(draft)} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--focus)" }}>{t("Salva e applica")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const fmtShort = (iso: string) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) : "…");

function Card({ title, desc, open, onToggle, children }: { title: string; desc: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-2xl border border-line p-5" style={{ background: "var(--surface)" }}>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open}>
        <div><h3 className="text-[15px] font-bold tracking-tight text-txt">{title}</h3><p className="mt-0.5 text-xs text-dim">{desc}</p></div>
        <span className="text-dim transition" style={{ transform: open ? "rotate(180deg)" : "none" }}>⌄</span>
      </button>
      {open && children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition" style={{ borderColor: on ? "var(--focus)" : "var(--line)", background: on ? "var(--focus)" : "var(--surface)", color: on ? "#fff" : "var(--txt)" }}>{children}</button>;
}

function GoalBtn({ on, onClick, label, desc }: { on: boolean; onClick: () => void; label: string; desc: string }) {
  return (
    <button onClick={onClick} className="flex-1 rounded-xl border p-3 text-left transition" style={{ borderColor: on ? "var(--focus)" : "var(--line)", background: on ? "color-mix(in srgb,var(--focus) 8%,var(--surface))" : "var(--surface)" }}>
      <div className="text-sm font-semibold text-txt">{label}</div><div className="mt-0.5 text-[11px] text-dim">{desc}</div>
    </button>
  );
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition" style={{ background: on ? "var(--focus)" : "transparent", color: on ? "#fff" : "var(--dim)" }}>{children}</button>;
}

function Tgl({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div><div className="text-sm font-medium text-txt">{label}</div><div className="text-[11px] text-faint">{hint}</div></div>
      <button onClick={onClick} aria-pressed={on} aria-label={label} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? "var(--ok)" : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all" style={{ left: on ? 22 : 2 }} /></button>
    </div>
  );
}

function Slider({ label, value, min, max, step, prefix = "", suffix = "", hint, onChange }: { label: string; value: number; min: number; max: number; step: number; prefix?: string; suffix?: string; hint?: string; onChange: (v: number) => void }) {
  const shown = prefix ? `${prefix}${Math.abs(value)}` : `${value > 0 ? "+" : ""}${value}`;
  return (
    <div>
      <div className="flex items-end justify-between gap-2"><span className="text-[12px] font-medium text-txt">{label}</span><span className="rounded-md px-1.5 py-0.5 font-mono text-[12px] font-bold text-white" style={{ background: "var(--focus)" }}>{shown}{suffix}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 w-full" style={{ accentColor: "var(--focus)" }} aria-label={label} />
      {hint && <div className="text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

type Series = { key: string; label: string; color: string; dash?: string; values: (number | undefined)[] };

function PriceChart({ dates, series, periods, t }: { dates: string[]; series: Series[]; periods: Period[]; t: (s: string) => string }) {
  const [w, setW] = useState(720);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hi, setHi] = useState<number | null>(null);
  useEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver((e) => setW(Math.max(280, Math.round(e[0].contentRect.width))));
    ro.observe(box); return () => ro.disconnect();
  }, [box]);

  const H = 260, P = { l: 48, r: 12, t: 22, b: 26 };
  const iw = w - P.l - P.r, ih = H - P.t - P.b;
  const vis = series.filter((s) => !hidden[s.key]);
  const all = vis.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!all.length) all.push(0, 100);
  const stepY = Math.max(5, Math.ceil((Math.max(...all) - Math.min(...all)) / 4 / 5) * 5 || 10);
  const yMin = Math.max(0, Math.floor(Math.min(...all) / stepY) * stepY - stepY), yMax = Math.ceil(Math.max(...all) / stepY) * stepY + stepY;
  const x = (i: number) => P.l + (dates.length > 1 ? (i / (dates.length - 1)) * iw : iw / 2);
  const y = (v: number) => P.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const ticks = Array.from({ length: Math.round((yMax - yMin) / stepY) + 1 }, (_, i) => yMin + i * stepY).filter((_, i, a) => a.length <= 7 || i % 2 === 0);
  const path = (vals: (number | undefined)[]) => { let d = "", pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; }); return d; };
  const colW = iw / Math.max(1, dates.length - 1);

  const onMove = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const i = Math.round(((cx - r.left) - P.l) / (iw / Math.max(1, dates.length - 1)));
    setHi(i >= 0 && i < dates.length ? i : null);
  };

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap gap-2">
        {series.map((s) => (
          <button key={s.key} onClick={() => setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))} aria-pressed={!hidden[s.key]} className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs font-medium text-txt transition" style={{ opacity: hidden[s.key] ? 0.45 : 1, background: "var(--surface)" }}>
            <svg width="18" height="6" aria-hidden><line x1="1" y1="3" x2="17" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinecap="round" /></svg>{s.label}
          </button>
        ))}
      </div>
      <div ref={setBox} className="relative w-full" onMouseLeave={() => setHi(null)}>
        <svg width={w} height={H} role="img" aria-label={t("Anteprima prezzi")} onMouseMove={onMove} onTouchStart={onMove} onTouchMove={onMove} style={{ display: "block", touchAction: "pan-y" }}>
          {/* periodi */}
          {periods.map((p) => {
            const a = dates.findIndex((d) => d >= p.from), bIdx = dates.findLastIndex((d) => d <= p.to);
            if (a < 0 || bIdx < 0 || bIdx < a) return null;
            return (<g key={p.id}><rect x={x(a) - colW / 2} y={P.t} width={Math.max(colW, x(bIdx) - x(a) + colW)} height={ih} fill="var(--focus)" opacity={0.07} /><text x={x(a) - colW / 2 + 4} y={P.t - 8} fontSize="10" fontWeight={600} fill="var(--dim)">{p.name}</text></g>);
          })}
          {/* weekend */}
          {dates.map((d, i) => { const wd = new Date(d + "T00:00:00").getDay(); return wd === 5 || wd === 6 ? <rect key={d} x={x(i) - colW / 2} y={P.t} width={colW} height={ih} fill="var(--txt)" opacity={0.035} /> : null; })}
          {/* griglia */}
          {ticks.map((v) => (<g key={v}><line x1={P.l} x2={w - P.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} /><text x={P.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--faint)" style={{ fontVariantNumeric: "tabular-nums" }}>{v} €</text></g>))}
          {dates.map((d, i) => (i % 14 === 0 ? <text key={d} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : "middle"} fontSize="10" fill="var(--faint)">{fmtShort(d)}</text> : null))}
          {/* linee */}
          {vis.map((s) => <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />)}
          {/* hover */}
          {hi != null && (<g>
            <line x1={x(hi)} x2={x(hi)} y1={P.t} y2={P.t + ih} stroke="var(--dim)" strokeWidth={1} strokeDasharray="3 3" />
            {vis.map((s) => s.values[hi] != null ? <circle key={s.key} cx={x(hi)} cy={y(s.values[hi]!)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null)}
          </g>)}
        </svg>
        {hi != null && (
          <div className="pointer-events-none absolute z-10 min-w-[170px] rounded-xl border border-line px-3 py-2 text-[12px] shadow-lg" style={{ background: "var(--surface)", top: 6, left: x(hi) > w * 0.6 ? x(hi) - 186 : x(hi) + 12 }}>
            <div className="mb-1 font-semibold capitalize text-txt">{new Date(dates[hi] + "T00:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}</div>
            {vis.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-dim"><svg width="12" height="6" aria-hidden><line x1="1" y1="3" x2="11" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash ? "3 2" : undefined} /></svg>{s.label}</span>
                <span className="font-mono font-semibold text-txt">{s.values[hi] != null ? eur(s.values[hi]!) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
