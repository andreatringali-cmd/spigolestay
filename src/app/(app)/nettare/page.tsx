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

const WINDOW = 90;
const FUTURE = 30;
const STRAT_KEY = "spigolestay:nettare:strategy";

type Pulse = { n_structures: number; occupancy: number | null; adr: number | null };
type Goal = "fill" | "revenue" | "balanced";
type Risk = "prudente" | "bilanciato" | "aggressivo";
type Strategy = { goal: Goal; risk: Risk; lastMinute: boolean; followMarket: boolean; events: boolean; minStay: boolean; minPrice: number | null; maxPrice: number | null };
type Day = { date: string; factor: number; price: number; reason: string; minNights: number };

const dow = (iso: string) => new Date(iso + "T00:00:00").getDay();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const RISK_BAND: Record<Risk, [number, number]> = { prudente: [0.94, 1.12], bilanciato: [0.88, 1.30], aggressivo: [0.82, 1.55] };
const DEFAULT_STRAT: Strategy = { goal: "balanced", risk: "bilanciato", lastMinute: true, followMarket: true, events: true, minStay: false, minPrice: null, maxPrice: null };

export default function NettarePage() {
  const { t } = useLang();
  const ask = useConfirm();
  const { structures, roomTypes, units, bookings, activeStructureId, setDayRates } = useData();
  const { user } = useAuth();

  const struct = useMemo(() => {
    const active = structures.find((s) => s.id === activeStructureId && (s.city || "").trim());
    return active || structures.find((s) => (s.city || "").trim()) || structures[0];
  }, [structures, activeStructureId]);
  const city = (struct?.city || "").trim();

  const [strat, setStrat] = useState<Strategy>(DEFAULT_STRAT);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => { try { const r = localStorage.getItem(STRAT_KEY); if (r) setStrat({ ...DEFAULT_STRAT, ...JSON.parse(r) }); } catch {} }, []);
  const upd = (p: Partial<Strategy>) => setStrat((s) => { const n = { ...s, ...p }; try { localStorage.setItem(STRAT_KEY, JSON.stringify(n)); } catch {} return n; });

  const sUnits = useMemo(() => units.filter((u) => u.structureId === struct?.id && !u.outOfService), [units, struct?.id]);
  const sRooms = sUnits.length;
  const sTypes = useMemo(() => roomTypes.filter((rt) => rt.structureId === struct?.id), [roomTypes, struct?.id]);
  const mainType = useMemo(() => {
    if (!sTypes.length) return undefined;
    return [...sTypes].sort((a, b) => sUnits.filter((u) => u.roomTypeId === b.id).length - sUnits.filter((u) => u.roomTypeId === a.id).length)[0];
  }, [sTypes, sUnits]);

  const myDaily = useMemo(() => {
    if (!struct || sRooms === 0) return [] as { rooms_total: number; rooms_sold: number; revenue: number }[];
    const today = toISO(new Date());
    const mine = bookings.filter((b) => b.structureId === struct.id && b.status !== "cancelled" && b.channel !== "blocked");
    const rows = [];
    for (let i = 0; i < WINDOW; i++) { const D = shiftISO(today, -i); const a = mine.filter((b) => b.checkIn <= D && b.checkOut > D); rows.push({ rooms_total: sRooms, rooms_sold: a.length, revenue: Math.round(a.reduce((s, b) => s + (b.total || 0) / Math.max(1, nights(b.checkIn, b.checkOut)), 0)) }); }
    return rows;
  }, [struct, sRooms, bookings]);

  const my = useMemo(() => {
    const rt = myDaily.reduce((s, r) => s + r.rooms_total, 0), rs = myDaily.reduce((s, r) => s + r.rooms_sold, 0), rev = myDaily.reduce((s, r) => s + r.revenue, 0);
    return { occ: rt ? rs / rt : 0, adr: rs ? rev / rs : 0 };
  }, [myDaily]);

  const basePrice = useMemo(() => (my.adr > 0 ? Math.round(my.adr) : (mainType?.basePrice ?? 0) || 90), [my.adr, mainType]);
  const cityHot = pulse?.occupancy != null && pulse.occupancy > my.occ + 0.05;
  const adrGap = pulse?.adr != null && my.adr > 0 ? (pulse.adr - my.adr) / my.adr : 0;

  const refresh = useCallback(async () => {
    if (!supabase || !user?.id || !city) return;
    try {
      const { data } = await supabase.rpc("market_pulse", { p_city: city, p_from: shiftISO(toISO(new Date()), -WINDOW), p_to: toISO(new Date()) });
      setPulse((Array.isArray(data) ? data[0] : data) as Pulse ?? null);
    } catch {}
  }, [user?.id, city]);
  useEffect(() => { void refresh(); }, [refresh]);

  // ── motore con STRATEGIA ──
  const engine = useMemo<Day[]>(() => {
    if (!struct || sRooms === 0) return [];
    const today = toISO(new Date());
    const mine = bookings.filter((b) => b.structureId === struct.id && b.status !== "cancelled" && b.channel !== "blocked");
    const [lo, hi] = RISK_BAND[strat.risk];
    const out: Day[] = [];
    for (let i = 0; i < FUTURE; i++) {
      const D = shiftISO(today, i), wd = dow(D);
      const sold = mine.filter((b) => b.checkIn <= D && b.checkOut > D).length;
      const pickup = sRooms ? sold / sRooms : 0;
      let f = 1; let reason = t("in linea");
      if (strat.events && (wd === 5 || wd === 6)) { f *= 1.12; reason = t("weekend"); }
      else if (wd === 0) f *= 0.98;
      if (pickup >= 0.7) { f *= strat.goal === "revenue" ? 1.22 : 1.13; reason = t("quasi al completo"); }
      else if (pickup <= 0.2 && i <= 10 && strat.lastMinute) { f *= strat.goal === "fill" ? 0.86 : 0.93; reason = t("ancora vuoto: last-minute"); }
      if (strat.followMarket && cityHot) { f *= 1.08; reason = t("città molto piena"); }
      if (strat.followMarket && adrGap > 0.05) { f *= 1 + clamp(adrGap, 0, 0.15); reason = t("sotto la media città"); }
      else if (strat.followMarket && adrGap < -0.08) f *= 0.96;
      if (strat.events && strat.followMarket && cityHot && (wd === 5 || wd === 6)) { f *= 1.05; reason = t("picco: weekend + città piena"); }
      // obiettivo
      if (strat.goal === "fill") f *= 0.97; else if (strat.goal === "revenue") f *= 1.03;
      f = clamp(f, lo, hi);
      let price = Math.round(basePrice * f);
      if (strat.minPrice != null && strat.minPrice > 0) price = Math.max(price, strat.minPrice);
      if (strat.maxPrice != null && strat.maxPrice > 0) price = Math.min(price, strat.maxPrice);
      f = price / basePrice;
      const minNights = strat.minStay ? (f >= 1.18 ? 3 : f >= 1.08 ? 2 : 1) : 1;
      out.push({ date: D, factor: f, price, reason, minNights });
    }
    return out;
  }, [struct, sRooms, bookings, basePrice, cityHot, adrGap, strat, t]);

  const avgPrice = engine.length ? Math.round(engine.reduce((s, d) => s + d.price, 0) / engine.length) : basePrice;
  const potential = useMemo(() => Math.round(engine.reduce((s, d) => s + (d.price - basePrice) * Math.round((my.occ || 0.5) * sRooms), 0)), [engine, basePrice, my.occ, sRooms]);

  const applyPrices = async () => {
    if (!engine.length || !sTypes.length) return;
    const ok = await ask({ title: t("Applica prezzi Nèttare"), message: `${t("Imposto i prezzi consigliati per i prossimi")} ${FUTURE} ${t("giorni su tutte le tipologie di")} ${struct?.name}. ${t("Potrai modificarli a mano quando vuoi.")}`, confirmLabel: t("Applica") });
    if (!ok) return;
    const map: Record<string, number> = {};
    for (const rt of sTypes) { const base = rt.basePrice ?? basePrice; for (const d of engine) map[`${rt.id}|${d.date}`] = Math.max(0, Math.round(base * d.factor)); }
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
            <div><div className="text-[11px] font-semibold text-faint">{t("Ricavo in più stimato")} · {FUTURE}gg</div><div className="font-mono text-3xl font-extrabold tracking-tight" style={{ color: potential > 0 ? "var(--ok)" : "var(--txt)" }}>{potential > 0 ? "+" : ""}{eur(potential)}</div></div>
            <div><div className="text-[11px] text-faint">{t("Prezzo base")}</div><div className="font-mono text-lg font-bold text-txt">{eur(basePrice)}</div></div>
            <div><div className="text-[11px] text-faint">{t("Prezzo medio")}</div><div className="font-mono text-lg font-bold text-txt">{eur(avgPrice)}</div></div>
            <button onClick={applyPrices} className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95" style={{ background: "var(--focus)" }}>{applied ? `✓ ${t("Prezzi applicati")}` : `${t("Applica ai prossimi")} ${FUTURE} ${t("giorni")}`}</button>
          </div>
        </div>
        {city && <Link href="/mercato" className="mt-3 inline-block text-[12px] font-medium" style={{ color: "var(--focus)" }}>{t("Vedi i dati della Rete città")} →</Link>}
      </div>

      {/* Strategia */}
      <section className="mt-4 rounded-2xl border border-line p-5" style={{ background: "var(--surface)" }}>
        <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Strategia")}</h3>
        <p className="mt-0.5 text-xs text-dim">{t("Scegli come Nèttare deve muovere i prezzi.")}</p>

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
          <div className="border-t border-line sm:border-t"><Tgl on={strat.events} onC={() => upd({ events: !strat.events })} label={t("Eventi & alta stagione")} hint={t("cavalca weekend e picchi")} /></div>
          <div className="border-t border-line"><Tgl on={strat.lastMinute} onC={() => upd({ lastMinute: !strat.lastMinute })} label={t("Last-minute")} hint={t("sconti sugli ultimi giorni vuoti")} /></div>
          <div className="border-t border-line"><Tgl on={strat.minStay} onC={() => upd({ minStay: !strat.minStay })} label={t("Min-stay dinamico")} hint={t("notti minime nei picchi")} /></div>
        </div>
      </section>

      {/* Prezzi giorno per giorno */}
      <section className="mt-4">
        <h3 className="text-[15px] font-bold tracking-tight text-txt">{t("Prezzo consigliato, giorno per giorno")}</h3>
        <p className="mb-2 mt-0.5 text-xs text-dim">{t("Con la strategia scelta.")} <span style={{ color: "var(--ok)" }}>{t("verde = alza")}</span> · <span style={{ color: "var(--focus)" }}>{t("blu = abbassa")}</span></p>
        <div className="rounded-2xl border border-line p-3" style={{ background: "var(--surface)" }}>
          {engine.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1.5" style={{ scrollSnapType: "x mandatory" }}>
              {engine.map((d) => {
                const up = d.factor >= 1.03, down = d.factor <= 0.97, dt = new Date(d.date + "T00:00:00");
                return (
                  <div key={d.date} className="shrink-0 rounded-xl border p-2.5 text-center" style={{ width: 96, scrollSnapAlign: "start", borderColor: up ? "color-mix(in srgb,var(--ok) 45%,var(--line))" : down ? "color-mix(in srgb,var(--focus) 40%,var(--line))" : "var(--line)", background: up ? "color-mix(in srgb,var(--ok) 6%,var(--surface))" : down ? "color-mix(in srgb,var(--focus) 6%,var(--surface))" : "var(--surface)" }}>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-dim">{dt.toLocaleDateString("it-IT", { weekday: "short" })}</div>
                    <div className="text-[10px] text-faint">{dt.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</div>
                    <div className="mt-1.5 whitespace-nowrap font-mono text-lg font-bold text-txt">{eur(d.price)}</div>
                    <div className="text-[11px] font-semibold" style={{ color: up ? "var(--ok)" : down ? "var(--focus)" : "var(--faint)" }}>{d.factor === 1 ? t("stabile") : `${d.factor > 1 ? "+" : ""}${Math.round((d.factor - 1) * 100)}%`}</div>
                    {d.minNights > 1 && <div className="mt-1 rounded-md text-[9px] font-bold" style={{ background: "color-mix(in srgb,var(--focus) 12%,transparent)", color: "var(--focus)" }}>min {d.minNights} {t("notti")}</div>}
                    <div className="mt-1 text-[9px] leading-tight text-faint" style={{ minHeight: 22 }}>{d.reason}</div>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-xs text-faint">{t("Aggiungi camere e prezzi per vedere i consigli.")}</p>}
        </div>
      </section>
    </div>
  );
}
