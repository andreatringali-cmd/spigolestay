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
import { DEFAULT_STRAT, RISK_BAND, cellKey, runNettare, applyMod, hasMod, type Cell, type Goal, type Mod, type Strategy, type Step } from "@/lib/nettare";

const WINDOW = 90;
const FUTURE = 30;
const GRID_DAYS = 14;
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
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const [panel, setPanel] = useState<string | null>(null);

  useEffect(() => {
    try { const r = localStorage.getItem(STRAT_KEY); if (r) setStrat({ ...DEFAULT_STRAT, ...JSON.parse(r) }); } catch {}
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
    const s = new Set<string>(gridDates); for (let i = 0; i < FUTURE; i++) s.add(shiftISO(today, i));
    return [...s].sort();
  }, [gridDates, today]);

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

  const GoalBtn = ({ v, label, desc }: { v: Goal; label: string; desc: string }) => (
    <button onClick={() => upd({ goal: v })} className="flex-1 rounded-xl border p-3 text-left transition" style={{ borderColor: strat.goal === v ? "var(--focus)" : "var(--line)", background: strat.goal === v ? "color-mix(in srgb,var(--focus) 8%,var(--surface))" : "var(--surface)" }}>
      <div className="text-sm font-semibold text-txt">{label}</div><div className="mt-0.5 text-[11px] text-dim">{desc}</div>
    </button>
  );
  const Seg = ({ v, cur, onC, children }: { v: string; cur: string; onC: () => void; children: ReactNode }) => (
    <button onClick={onC} className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition" style={{ background: cur === v ? "var(--focus)" : "transparent", color: cur === v ? "#fff" : "var(--dim)" }}>{children}</button>
  );
  const Tgl = ({ on, onC, label, hint }: { on: boolean; onC: () => void; label: string; hint: string }) => (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div><div className="text-sm font-medium text-txt">{label}</div><div className="text-[11px] text-faint">{hint}</div></div>
      <button onClick={onC} aria-pressed={on} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? "var(--ok)" : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all" style={{ left: on ? 22 : 2 }} /></button>
    </div>
  );

  const COL = 88, LABEL = 168;
  const hoverCell = hover ? res.cells[hover.key] : undefined;
  const panelCell = panel ? res.cells[panel] : undefined;

  return (
    <div>
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
            <div><div className="text-[11px] text-faint">{t("Prezzo base")}</div><div className="font-mono text-lg font-bold text-txt">{eur(basePrice)}</div></div>
            <div><div className="text-[11px] text-faint">{t("Prezzo medio")}</div><div className="font-mono text-lg font-bold text-txt">{eur(stats.avg)}</div></div>
            <div><div className="text-[11px] text-faint">{t("Da applicare")}</div><div className="font-mono text-lg font-bold" style={{ color: stats.pending ? "var(--warn)" : "var(--ok)" }}>{stats.pending}</div></div>
            <button onClick={applyPrices} className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95" style={{ background: "var(--focus)" }}>{applied ? `✓ ${t("Prezzi applicati")}` : `${t("Applica ai prossimi")} ${FUTURE} ${t("giorni")}`}</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
          <span className="text-faint">{t("Nèttare consiglia, tu applichi. I prezzi applicati vanno nel calendario di Xenora.")}</span>
          {city && <Link href="/mercato" className="font-medium" style={{ color: "var(--focus)" }}>{t("Vedi i dati della Rete città")} →</Link>}
        </div>
      </div>

      {/* Strategia */}
      <section className="mt-4 rounded-2xl border border-line p-5" style={{ background: "var(--surface)" }}>
        <button onClick={() => setOpenStrat((v) => !v)} className="flex w-full items-center justify-between text-left">
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Strategia")}</h3>
            <p className="mt-0.5 text-xs text-dim">{t("Scegli come Nèttare deve muovere i prezzi.")}</p>
          </div>
          <span className="text-dim transition" style={{ transform: openStrat ? "rotate(180deg)" : "none" }}>⌄</span>
        </button>

        {openStrat && <>
          <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Obiettivo")}</div>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
            <GoalBtn v="fill" label={t("Riempi")} desc={t("più occupazione, prezzi più morbidi")} />
            <GoalBtn v="balanced" label={t("Bilanciato")} desc={t("equilibrio prezzo/occupazione")} />
            <GoalBtn v="revenue" label={t("Massimo ricavo")} desc={t("spingi il RevPAR quando c'è domanda")} />
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Profilo di rischio")}</div>
              <div className="mt-1.5 flex rounded-lg border border-line p-0.5" style={{ background: "var(--wash)" }}>
                <Seg v="prudente" cur={strat.risk} onC={() => upd({ risk: "prudente" })}>{t("Prudente")}</Seg>
                <Seg v="bilanciato" cur={strat.risk} onC={() => upd({ risk: "bilanciato" })}>{t("Bilanciato")}</Seg>
                <Seg v="aggressivo" cur={strat.risk} onC={() => upd({ risk: "aggressivo" })}>{t("Aggressivo")}</Seg>
              </div>
              <div className="mt-1.5 text-[11px] text-faint">{t("Variazione massima dei prezzi")}: {Math.round((RISK_BAND[strat.risk][0] - 1) * 100)}% / +{Math.round((RISK_BAND[strat.risk][1] - 1) * 100)}%</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Guardrail")} · {t("prezzo min / max")}</div>
              <div className="mt-1.5 flex gap-2">
                <input type="number" inputMode="numeric" placeholder={t("min €")} value={strat.minPrice ?? ""} onChange={(e) => upd({ minPrice: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-lg border border-line px-3 py-2 text-sm" style={{ background: "var(--surface)", color: "var(--txt)" }} />
                <input type="number" inputMode="numeric" placeholder={t("max €")} value={strat.maxPrice ?? ""} onChange={(e) => upd({ maxPrice: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-lg border border-line px-3 py-2 text-sm" style={{ background: "var(--surface)", color: "var(--txt)" }} />
              </div>
              <div className="mt-1.5 text-[11px] text-faint">{t("Nèttare non andrà mai oltre questi limiti.")}</div>
            </div>
          </div>

          <div className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-faint">{t("Regole")}</div>
          <div className="mt-1 grid gap-x-8 sm:grid-cols-2">
            <div className="border-t border-line"><Tgl on={strat.followMarket} onC={() => upd({ followMarket: !strat.followMarket })} label={t("Segui il mercato")} hint={t("usa i segnali della Rete città")} /></div>
            <div className="border-t border-line"><Tgl on={strat.events} onC={() => upd({ events: !strat.events })} label={t("Eventi, festività & weekend")} hint={t("cavalca weekend, festivi ed eventi del calendario")} /></div>
            <div className="border-t border-line"><Tgl on={strat.lastMinute} onC={() => upd({ lastMinute: !strat.lastMinute })} label={t("Last-minute")} hint={t("sconti sugli ultimi giorni vuoti")} /></div>
            <div className="border-t border-line"><Tgl on={strat.minStay} onC={() => upd({ minStay: !strat.minStay })} label={t("Min-stay dinamico")} hint={t("notti minime nei picchi")} /></div>
          </div>
        </>}
      </section>

      {/* Calendario prezzi */}
      <section className="mt-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Calendario prezzi")}</h3>
            <p className="mt-0.5 text-xs text-dim">{t("Passa sopra una cella per vedere il perché del prezzo, cliccala per modificarla.")}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setStart((s) => (shiftISO(s, -7) < today ? today : shiftISO(s, -7)))} disabled={start <= today} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-dim disabled:opacity-40" style={{ background: "var(--surface)" }} aria-label={t("Settimana precedente")}>‹</button>
            <button onClick={() => setStart(today)} className="h-8 rounded-lg border border-line px-3 text-xs font-semibold text-txt" style={{ background: "var(--surface)" }}>{t("Oggi")}</button>
            <button onClick={() => setStart((s) => shiftISO(s, 7))} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-dim" style={{ background: "var(--surface)" }} aria-label={t("Settimana successiva")}>›</button>
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
                {sTypes.map((rt) => (
                  <tr key={rt.id}>
                    <td className="sticky left-0 z-10 border-b border-r border-line px-3 py-2" style={{ background: "var(--surface)" }}>
                      <div className="truncate text-[13px] font-semibold text-txt" title={rt.name}><span className="text-faint">└ </span>{rt.name}</div>
                      <div className="text-[10px] text-faint">{t("base")} {eur(res.cells[cellKey(rt.id, gridDates[0])]?.base ?? rt.basePrice)}</div>
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
                            <span className="font-mono text-[14px] font-bold text-txt">{eur(c.final)}</span>
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
      <div className="flex justify-between font-semibold"><span>{t("Prezzo base")}</span><span className="font-mono">{eur(c.base)}</span></div>
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
