"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel } from "@/lib/types";
import { toISO, addDays, nights, parseISO } from "@/lib/dates";
import { eur, num } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/ui";
import Donut from "@/components/Donut";
import Bars from "@/components/Bars";
import ColumnChart from "@/components/ColumnChart";
import DensityChart from "@/components/DensityChart";
import Gauge from "@/components/Gauge";
import { flagColor, flagGradient } from "@/lib/flags";
import ScrollStrip from "@/components/ScrollStrip";
import Icon from "@/components/Icon";
import { useLang } from "@/lib/i18n";

const PALETTE = ["#BE5D38", "#7A8450", "#C08A3A", "#957A66", "#4F8A5B", "#5B74E6", "#B3453A"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const monthLabelOf = (mk: string) => { const [yy, mm] = mk.split("-").map(Number); return new Date(yy, mm - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" }); };
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });

export default function StatistichePage() {
  const { bookings, structures, units, guests, activeStructureId } = useData();
  const { t } = useLang();
  // Ordine dei grafici (riposizionabile col doppio clic), persistito.
  const [chartOrder, setChartOrder] = useState<string[]>([]);
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:statscharts"); if (r) setChartOrder(JSON.parse(r)); } catch {} }, []);
  const persistChartOrder = (keys: string[]) => { setChartOrder(keys); try { localStorage.setItem("spigolestay:statscharts", JSON.stringify(keys)); } catch {} };
  // Mostra/nascondi grafici (un click, tutti o nessuno)
  const [chartsOn, setChartsOn] = useState(true);
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:statscharts:on"); if (r !== null) setChartsOn(r === "1"); } catch {} }, []);
  const toggleCharts = () => setChartsOn((v) => { const n = !v; try { localStorage.setItem("spigolestay:statscharts:on", n ? "1" : "0"); } catch {} return n; });
  // Report attivo: i tanti report di Octorate condensati in 2 (Mensile, Annuale). Mensile e
  // Previsionale erano diventati sostanzialmente uguali (stessa tabella giorno per giorno, stesse
  // colonne) quindi sono stati uniti in un'unica scheda — KPI+grafici+tabella insieme.
  // La chiave interna resta "produzione" per non toccare la persistenza/tipizzazione esistente.
  const [report, setReport] = useState<"produzione" | "annuale">("produzione");

  const active = bookings.filter((b) => b.status !== "cancelled" && (activeStructureId === "all" || b.structureId === activeStructureId));
  const scopedStructures = activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId);
  const scopedUnits = units.filter((u) => !u.outOfService && (activeStructureId === "all" || u.structureId === activeStructureId));
  const channels = (Object.keys(CHANNELS) as Channel[]).filter((c) => c !== "blocked");
  const chColor = (c: Channel) => `var(${CHANNELS[c].cssVar})`;

  const totalNights = active.reduce((a, b) => a + nights(b.checkIn, b.checkOut), 0);
  const totalRevenue = active.reduce((a, b) => a + (b.total ?? 0), 0);
  const adr = totalNights ? totalRevenue / totalNights : 0;

  const today = new Date();
  const s = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayISO = toISO(s);

  // ---- Filtro unico: mese selezionato (guida KPI, grafici e report previsionale) ----
  const y = today.getFullYear(), mo = today.getMonth();
  const curMonthKey = `${y}-${pad2(mo + 1)}`;
  const bks = active.filter((b) => b.channel !== "blocked");
  const monthOptions = useMemo(() => {
    const keys = bks.map((b) => b.checkIn.slice(0, 7));
    let min = keys.length ? keys.reduce((a, k) => (k < a ? k : a)) : curMonthKey;
    let max = keys.length ? keys.reduce((a, k) => (k > a ? k : a)) : curMonthKey;
    if (curMonthKey < min) min = curMonthKey;
    if (curMonthKey > max) max = curMonthKey;
    const out: string[] = []; let [Y, M] = min.split("-").map(Number); const [maxY, maxM] = max.split("-").map(Number); let g = 0;
    while ((Y < maxY || (Y === maxY && M <= maxM)) && g++ < 240) { out.push(`${Y}-${pad2(M)}`); M++; if (M > 12) { M = 1; Y++; } }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, activeStructureId, curMonthKey]);
  const [repMonth, setRepMonth] = useState(curMonthKey);
  const [rY, rM] = repMonth.split("-").map(Number); // rM 1-based
  const R = { from: `${repMonth}-01`, to: toISO(new Date(rY, rM, 1)), pfrom: toISO(new Date(rY, rM - 2, 1)), pto: toISO(new Date(rY, rM - 1, 1)), label: monthLabelOf(repMonth), cmp: t("mese prec.") };
  const daysBetween = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
  // Base di attribuzione del ricavo: per notte (competenza), all'arrivo (tutto al check-in), all'incasso (importi versati).
  const [basis, setBasis] = useState<"notte" | "arrivo" | "incasso">("notte");
  const metrics = (from: string, to: string) => {
    if (!from || !to) return { revenue: 0, roomNights: 0, count: 0, occ: 0, adr: 0, revpar: 0 };
    const days = daysBetween(from, to);
    let roomNights = 0, revenue = 0;
    for (const b of active) {
      const s2 = b.checkIn > from ? b.checkIn : from;
      const e2 = b.checkOut < to ? b.checkOut : to;
      const nInP = Math.max(0, Math.round((new Date(e2).getTime() - new Date(s2).getTime()) / 86400000));
      if (nInP > 0 && b.unitId) roomNights += nInP; // occupazione: sempre per notte (misura fisica)
      if (basis === "notte") { if (nInP > 0) revenue += (b.total ?? 0) * (nInP / Math.max(1, nights(b.checkIn, b.checkOut))); }
      else if (b.checkIn >= from && b.checkIn < to) revenue += basis === "incasso" ? (b.paid ?? 0) : (b.total ?? 0);
    }
    const arrivals = active.filter((b) => b.checkIn >= from && b.checkIn < to).length;
    const occ = scopedUnits.length ? roomNights / (scopedUnits.length * days) : 0;
    return { revenue: Math.round(revenue), roomNights, count: arrivals, occ, adr: roomNights ? revenue / roomNights : 0, revpar: scopedUnits.length ? revenue / (scopedUnits.length * days) : 0 };
  };
  const cur = metrics(R.from, R.to);
  const prev = metrics(R.pfrom, R.pto);
  const delta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : a > 0 ? 100 : 0);

  // Prenotazioni con arrivo nel mese selezionato → base di tutti i grafici categoriali.
  const monthArr = active.filter((b) => b.channel !== "blocked" && b.checkIn >= R.from && b.checkIn < R.to);
  const monthRevenue = monthArr.reduce((a, b) => a + (b.total ?? 0), 0);

  // Ricavi per canale (mese)
  const revenueByChannel = channels.map((c) => ({ label: CHANNELS[c].label, value: monthArr.filter((b) => b.channel === c).reduce((a, b) => a + (b.total ?? 0), 0), color: chColor(c) })).filter((x) => x.value > 0);

  // Occupazione per giorno della settimana (media sui giorni del mese selezionato) → colonne verticali
  const wd = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  const wdAgg = Array.from({ length: 7 }, () => ({ sum: 0, cnt: 0 }));
  {
    const [wy, wm] = repMonth.split("-").map(Number);
    const dim = new Date(wy, wm, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      const iso = `${repMonth}-${pad2(d)}`;
      const occ = active.filter((b) => b.unitId && b.channel !== "blocked" && scopedUnits.some((u) => u.id === b.unitId) && b.checkIn <= iso && iso < b.checkOut).length;
      const pct = scopedUnits.length ? Math.round((occ / scopedUnits.length) * 100) : 0;
      const w = new Date(iso).getDay();
      wdAgg[w].sum += pct; wdAgg[w].cnt++;
    }
  }
  const weekday = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ label: t(wd[w]), value: wdAgg[w].cnt ? Math.round(wdAgg[w].sum / wdAgg[w].cnt) : 0 }));

  // Provenienza per paese (mese)
  const countryMap: Record<string, number> = {};
  monthArr.forEach((b) => { const c = guests.find((g) => g.id === b.guestId)?.country ?? "—"; countryMap[c] = (countryMap[c] || 0) + 1; });
  const byCountry = Object.entries(countryMap).map(([k, v]) => ({ label: k, value: v, color: flagColor(k), fill: flagGradient(k) }));

  // Durata soggiorno (mese)
  const buckets: Record<string, number> = { "1 notte": 0, "2 notti": 0, "3 notti": 0, "4+ notti": 0 };
  monthArr.forEach((b) => { const n = nights(b.checkIn, b.checkOut); if (n <= 1) buckets["1 notte"]++; else if (n === 2) buckets["2 notti"]++; else if (n === 3) buckets["3 notti"]++; else buckets["4+ notti"]++; });
  const stayDist = Object.entries(buckets).map(([k, v]) => ({ label: t(k), value: v, color: "var(--focus)" }));

  // Ricavi per struttura (mese)
  const revByStructure = scopedStructures.map((st) => ({ label: st.name, value: monthArr.filter((b) => b.structureId === st.id).reduce((a, b) => a + (b.total ?? 0), 0), color: "var(--ok)", fmt: eur }));

  // ---- Report previsionale (stile Octorate): giorno per giorno, storico + previsione (usa il mese selezionato in alto) ----
  const rep = useMemo(() => {
    const [Y, M] = repMonth.split("-").map(Number);
    const dim = new Date(Y, M, 0).getDate();
    const out: { iso: string; storico: boolean; camere: number; occ: number; arrivi: number; partenze: number; ospiti: number; adr: number; lordo: number; commissioni: number }[] = [];
    for (let d = 1; d <= dim; d++) {
      const iso = `${repMonth}-${pad2(d)}`;
      const occBks = bks.filter((b) => b.checkIn <= iso && iso < b.checkOut);
      const camere = occBks.filter((b) => b.unitId).length;
      const lordo = Math.round(occBks.reduce((a, b) => a + (b.total ? b.total / nights(b.checkIn, b.checkOut) : 0), 0));
      const commissioni = Math.round(occBks.reduce((a, b) => { const nightly = b.total ? b.total / nights(b.checkIn, b.checkOut) : 0; const pct = b.commissionPct ?? CHANNELS[b.channel].commission * 100; return a + (nightly * pct) / 100; }, 0));
      const ospiti = occBks.reduce((a, b) => a + b.adults + b.children, 0);
      const arrivi = bks.filter((b) => b.checkIn === iso).length;
      const partenze = bks.filter((b) => b.checkOut === iso).length;
      out.push({ iso, storico: iso < todayISO, camere, occ: scopedUnits.length ? camere / scopedUnits.length : 0, arrivi, partenze, ospiti, adr: camere ? lordo / camere : 0, lordo, commissioni });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repMonth, bookings, activeStructureId, scopedUnits.length]);

  const repSum = (pred: (r: (typeof rep)[number]) => boolean) => {
    const rows = rep.filter(pred);
    const camere = rows.reduce((a, r) => a + r.camere, 0);
    const lordo = rows.reduce((a, r) => a + r.lordo, 0);
    const commissioni = rows.reduce((a, r) => a + r.commissioni, 0);
    const days = rows.length;
    return { days, camere, arrivi: rows.reduce((a, r) => a + r.arrivi, 0), partenze: rows.reduce((a, r) => a + r.partenze, 0), ospiti: rows.reduce((a, r) => a + r.ospiti, 0), adr: camere ? lordo / camere : 0, lordo, commissioni, netto: lordo - commissioni, occ: scopedUnits.length && days ? camere / (scopedUnits.length * days) : 0 };
  };
  const totStorico = repSum((r) => r.storico);
  const totPrevis = repSum((r) => !r.storico);
  const totAll = repSum(() => true);
  const repDayLabel = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });

  // Prezzo a notte (ADR) per canale → density plot
  const priceByChannel = channels.map((c) => ({
    label: CHANNELS[c].label,
    color: chColor(c),
    values: active
      .filter((b) => b.channel === c && b.total && nights(b.checkIn, b.checkOut) > 0)
      .map((b) => Math.round((b.total ?? 0) / nights(b.checkIn, b.checkOut))),
  })).filter((s) => s.values.length > 0);

  // Galleria grafici (4 per pagina, frecce per scorrere)
  // Con una sola struttura selezionata i grafici "per struttura" non hanno senso: si nascondono.
  const singleStruct = activeStructureId !== "all" || structures.length <= 1;
  const charts = [
    { key: "occ-gauge", title: t("Occupazione del mese"), node: <Gauge value={Math.round(cur.occ * 100)} unit="%" color="var(--ok)" /> },
    { key: "price-ch", title: t("Prezzo a notte per canale"), wide: true, node: <DensityChart series={priceByChannel} xLabel={t("Prezzo a notte (€)")} unit="€" /> },
    { key: "rev-ch", title: t("Ricavi per canale (mese)"), wide: true, node: <Donut data={revenueByChannel} center={`€ ${num(monthRevenue)}`} format={(n) => eur(n)} /> },
    { key: "weekday", title: t("Occupazione per giorno settimana"), node: <ColumnChart bars={weekday} format={(n) => `${n}%`} /> },
    { key: "country", title: t("Provenienza ospiti per paese"), node: <ColumnChart bars={byCountry} labelColor="var(--txt)" allLabels /> },
    { key: "stay", title: t("Durata del soggiorno"), node: <Bars items={stayDist} /> },
    { key: "rev-str", title: t("Ricavi per struttura"), perStructure: true, node: <Bars items={revByStructure} /> },
  ].filter((c) => !(singleStruct && c.perStructure));
  // ---- Report annuale: 12 mesi dell'anno scelto + totali con confronto sull'anno precedente ----
  const yearOptions = useMemo(() => {
    const ys = new Set<number>([y]); bks.forEach((b) => ys.add(Number(b.checkIn.slice(0, 4))));
    return [...ys].filter((n) => n >= 2000).sort((a, b) => b - a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, activeStructureId]);
  const [annualYear, setAnnualYear] = useState(y);
  const daysInYear = (yr: number) => ((yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0 ? 366 : 365);
  const yearMetrics = (yr: number) => {
    let revenue = 0, roomNights = 0, arrivals = 0;
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = metrics(`${yr}-${pad2(i + 1)}-01`, toISO(new Date(yr, i + 1, 1)));
      revenue += m.revenue; roomNights += m.roomNights; arrivals += m.count;
      return { i, label: new Date(yr, i, 1).toLocaleDateString("it-IT", { month: "short" }), ...m };
    });
    const denom = scopedUnits.length * daysInYear(yr);
    return { months, revenue, roomNights, arrivals, occ: denom ? roomNights / denom : 0, adr: roomNights ? revenue / roomNights : 0, revpar: denom ? revenue / denom : 0 };
  };
  const annCur = yearMetrics(annualYear);
  const annPrev = yearMetrics(annualYear - 1);
  const annualBars = annCur.months.map((m) => ({ label: m.label, value: m.revenue, color: "var(--focus)" }));

  // Tabella Annuale con le STESSE colonne/regole del Previsionale (madre): accrual per notte,
  // indipendente dal selettore "Ricavi calcolati" — un mese al posto di un giorno, sommando lo
  // stesso calcolo giorno per giorno usato in `rep`, non i totali di `metrics()` (che seguono
  // `basis`). Così Mensile/Previsionale/Annuale mostrano davvero le stesse colonne allo stesso modo.
  const yearRep = useMemo(() => {
    const yr = annualYear;
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      i, label: new Date(yr, i, 1).toLocaleDateString("it-IT", { month: "short" }),
      camere: 0, arrivi: 0, partenze: 0, ospiti: 0, lordo: 0, commissioni: 0, days: 0,
      lastDayISO: toISO(new Date(yr, i + 1, 0)),
    }));
    const dim = daysInYear(yr);
    const start = new Date(yr, 0, 1);
    for (let d = 0; d < dim; d++) {
      const date = new Date(start); date.setDate(start.getDate() + d);
      const iso = toISO(date);
      const occBks = bks.filter((b) => b.checkIn <= iso && iso < b.checkOut);
      const camere = occBks.filter((b) => b.unitId).length;
      const lordo = occBks.reduce((a, b) => a + (b.total ? b.total / nights(b.checkIn, b.checkOut) : 0), 0);
      const commissioni = occBks.reduce((a, b) => { const nightly = b.total ? b.total / nights(b.checkIn, b.checkOut) : 0; const pct = b.commissionPct ?? CHANNELS[b.channel].commission * 100; return a + (nightly * pct) / 100; }, 0);
      const ospiti = occBks.reduce((a, b) => a + b.adults + b.children, 0);
      const arrivi = bks.filter((b) => b.checkIn === iso).length;
      const partenze = bks.filter((b) => b.checkOut === iso).length;
      const bucket = buckets[date.getMonth()];
      bucket.camere += camere; bucket.arrivi += arrivi; bucket.partenze += partenze; bucket.ospiti += ospiti;
      bucket.lordo += lordo; bucket.commissioni += commissioni; bucket.days += 1;
    }
    return buckets.map((b) => ({
      iso: String(b.i), label: b.label, storico: b.lastDayISO < todayISO, days: b.days,
      camere: Math.round(b.camere), occ: scopedUnits.length && b.days ? b.camere / (scopedUnits.length * b.days) : 0,
      arrivi: b.arrivi, partenze: b.partenze, ospiti: Math.round(b.ospiti),
      adr: b.camere ? b.lordo / b.camere : 0, lordo: Math.round(b.lordo), commissioni: Math.round(b.commissioni),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annualYear, bookings, activeStructureId, scopedUnits.length, todayISO]);
  const yearSum = (pred: (r: (typeof yearRep)[number]) => boolean) => {
    const rows = yearRep.filter(pred);
    const camere = rows.reduce((a, r) => a + r.camere, 0);
    const lordo = rows.reduce((a, r) => a + r.lordo, 0);
    const commissioni = rows.reduce((a, r) => a + r.commissioni, 0);
    const days = rows.reduce((a, r) => a + r.days, 0);
    return { camere, arrivi: rows.reduce((a, r) => a + r.arrivi, 0), partenze: rows.reduce((a, r) => a + r.partenze, 0), ospiti: rows.reduce((a, r) => a + r.ospiti, 0), adr: camere ? lordo / camere : 0, lordo, commissioni, netto: lordo - commissioni, occ: scopedUnits.length && days ? camere / (scopedUnits.length * days) : 0 };
  };
  const yearTotStorico = yearSum((r) => r.storico);
  const yearTotPrevis = yearSum((r) => !r.storico);
  const yearTotAll = yearSum(() => true);

  // Applica l'ordine scelto dall'utente (doppio clic per riposizionare).
  const orderedCharts = [...charts].sort((a, b) => {
    const ia = chartOrder.indexOf(a.key), ib = chartOrder.indexOf(b.key);
    if (ia < 0 && ib < 0) return 0;
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });

  // Riga filtro: mese (assente su Annuale, che ragiona per anno) + toggle grafici a sinistra,
  // badge "Ricavi calcolati" (influenza le KPI card, non la tabella giorno/mese che usa una
  // regola fissa — vedi nota sotto la tabella), selettore report Mensile/Annuale a destra.
  const FilterRow = ({ showMonth }: { showMonth: boolean }) => (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
      {showMonth ? (<>
        <span className="text-sm font-semibold text-txt">{t("Mese")}</span>
        <select value={repMonth} onChange={(e) => setRepMonth(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm capitalize text-txt outline-none focus:border-focus">
          {monthOptions.map((mk) => <option key={mk} value={mk} className="capitalize">{monthLabelOf(mk)}</option>)}
        </select>
        <button onClick={toggleCharts} title={chartsOn ? t("Nascondi i grafici") : t("Mostra i grafici")} className={`grid h-9 w-9 place-items-center rounded-lg border transition ${chartsOn ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] text-focus" : "border-line text-dim hover:bg-wash hover:text-txt"}`}><Icon name="chart" size={16} /></button>
      </>) : (<>
        <span className="text-sm font-semibold text-txt">{t("Anno")}</span>
        <select value={annualYear} onChange={(e) => setAnnualYear(Number(e.target.value))} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus">
          {yearOptions.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
        </select>
      </>)}
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-wash py-1 pl-3 pr-1 text-xs font-medium text-dim" title={t("Come viene attribuito il ricavo di una prenotazione al periodo scelto (solo le KPI card, non la tabella)")}>
        {t("Ricavi")}:
        <select value={basis} onChange={(e) => setBasis(e.target.value as "notte" | "arrivo" | "incasso")} className="rounded-full border-none bg-transparent py-0.5 pl-1 pr-5 text-xs font-semibold text-txt outline-none">
          <option value="notte">{t("Per notte (competenza)")}</option>
          <option value="arrivo">{t("Per data di arrivo")}</option>
          <option value="incasso">{t("All'incasso")}</option>
        </select>
      </span>
      <div className="ml-auto inline-flex rounded-lg bg-wash p-0.5 text-sm">
        {([["produzione", t("Mensile")], ["annuale", t("Annuale")]] as const).map(([k, lab]) => (
          <button key={k} onClick={() => setReport(k)} className={`rounded-md px-4 py-1.5 font-semibold transition ${report === k ? "bg-focus text-white shadow-sm" : "text-dim hover:text-txt"}`}>{lab}</button>
        ))}
      </div>
    </div>
  );

  // Vista tabella condivisa da Mensile (giorni del mese) e Annuale (mesi dell'anno): stesse
  // colonne, stesso ordine, "madre" = quella che prima era il Previsionale.
  type RepRow = { iso: string; label: string; storico: boolean; highlight?: boolean; camere: number; occ: number; arrivi: number; partenze: number; ospiti: number; adr: number; lordo: number; commissioni: number };
  type RepTotal = { camere: number; occ: number; arrivi: number; partenze: number; ospiti: number; adr: number; lordo: number; commissioni: number; netto: number };
  const RepTableView = ({ periodLabel, rows, totStorico, totPrevis, totAll }: { periodLabel: string; rows: RepRow[]; totStorico: RepTotal; totPrevis: RepTotal; totAll: RepTotal }) => (
    <div className="max-h-[60vh] overflow-auto rounded-xl border border-line bg-surface shadow-sm">
      <table className="w-full min-w-[1000px] table-fixed text-sm">
        <RepCols />
        <thead className="sticky top-0 z-20">
          <tr className="bg-wash text-left text-xs uppercase tracking-wide text-faint shadow-[0_1px_0_var(--line)]">
            <th className="px-3 py-2 font-semibold">{periodLabel}</th>
            <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("Camere")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("Occup.")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("Arrivi")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("Part.")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("Ospiti")}</th>
            <th className="px-3 py-2 text-right font-semibold">ADR</th>
            <th className="px-3 py-2 text-right font-semibold">Revenue</th>
            <th className="px-3 py-2 text-right font-semibold">{t("Commiss.")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("Netto")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.iso} className={`border-b border-line last:border-0 ${r.highlight ? "bg-[color:color-mix(in_srgb,var(--focus)_8%,transparent)]" : r.storico ? "" : "bg-[color:color-mix(in_srgb,var(--ok)_4%,transparent)]"}`}>
              <td className="truncate px-3 py-2 font-medium capitalize text-txt">{r.label}{r.highlight && <span className="ml-1.5 rounded-full bg-focus px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">{t("oggi")}</span>}</td>
              <td className="px-3 py-2"><span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={r.storico ? { backgroundColor: "color-mix(in srgb, var(--faint) 20%, transparent)", color: "var(--dim)" } : { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>{r.storico ? t("Storico") : t("Previsione")}</span></td>
              <td className="px-3 py-2 text-right font-mono text-dim">{r.camere}{scopedUnits.length ? `/${scopedUnits.length}` : ""}</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{Math.round(r.occ * 100)}%</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{r.arrivi || ""}</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{r.partenze || ""}</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{r.ospiti || ""}</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{r.camere ? eur(r.adr) : "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-txt">{eur(r.lordo)}</td>
              <td className="px-3 py-2 text-right font-mono" style={{ color: r.commissioni > 0 ? "var(--warn)" : "var(--faint)" }}>{r.commissioni ? `−${eur(r.commissioni)}` : "—"}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: "var(--ok)" }}>{eur(r.lordo - r.commissioni)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-20 bg-surface shadow-[0_-1px_0_var(--line)]">
          <tr><td colSpan={11} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: "var(--focus)" }}>{t("Totali")}</td></tr>
          {([["Somma storico", totStorico, "var(--dim)"], ["Somma previsione", totPrevis, "var(--ok)"], ["Totale", totAll, "var(--txt)"]] as const).map(([lab, tt, col], i) => (
            <tr key={lab} className={`border-t border-line ${i === 2 ? "bg-wash font-bold" : "bg-surface font-medium"}`}>
              <td className="truncate px-3 py-2" colSpan={2} style={{ color: col }}>{t(lab)}</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{tt.camere}</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{Math.round(tt.occ * 100)}%</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{tt.arrivi}</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{tt.partenze}</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{tt.ospiti}</td>
              <td className="px-3 py-2 text-right font-mono text-dim">{tt.camere ? eur(tt.adr) : "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-txt">{eur(tt.lordo)}</td>
              <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--warn)" }}>{tt.commissioni ? `−${eur(tt.commissioni)}` : "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-[color:var(--ok)]">{eur(tt.netto)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );

  return (
    <div>
      <PageHeader title={t("Statistiche")} subtitle={t("Due report: mensile (con previsionale) e annuale")} />

      {report === "produzione" && (<>
      {/* KPI del mese selezionato con confronto sul mese precedente */}
      <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiD label={t("Notti vendute")} value={String(cur.roomNights)} d={prev ? delta(cur.roomNights, prev.roomNights) : null} cmp={R.cmp} />
        <KpiD label={t("Occupazione")} value={`${Math.round(cur.occ * 100)}%`} d={prev ? delta(cur.occ, prev.occ) : null} cmp={R.cmp} />
        <KpiD label="ADR" value={eur(cur.adr)} d={prev ? delta(cur.adr, prev.adr) : null} cmp={R.cmp} />
        <KpiD label="RevPAR" value={eur(cur.revpar)} d={prev ? delta(cur.revpar, prev.revpar) : null} cmp={R.cmp} />
        <KpiD label={t("Ricavi")} value={eur(cur.revenue)} d={prev ? delta(cur.revenue, prev.revenue) : null} cmp={R.cmp} />
      </div>
      <p className="mt-2 text-xs text-faint">{t("Valori riferiti a")} <b className="text-dim">{R.label.toLowerCase()}</b>{prev ? ` · ${t("confronto con")} ${R.cmp}` : ""}. {t("Complessivo storico: ricavi")} {eur(totalRevenue)} · ADR {eur(adr)} · {totalNights} {t("notti")}.</p>

      <div className="mt-6">
        {chartsOn && (
        <ScrollStrip
          gap="gap-3"
          onReorder={(keys) => { const rest = charts.map((c) => c.key).filter((k) => !keys.includes(k)); persistChartOrder([...keys, ...rest]); }}
          items={orderedCharts.map((c) => { const wide = (c as { wide?: boolean }).wide; return {
            key: c.key,
            className: `flex flex-none snap-start flex-col ${wide ? "w-[520px] max-w-[92vw] lg:w-[calc((100%-3rem)*2/5+0.75rem)]" : "w-[260px] lg:w-[calc((100%-3rem)/5)]"}`,
            node: (
              <div className="flex h-full flex-col rounded-xl border border-line bg-surface p-4 shadow-sm">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">{c.title}</div>
                <div className="flex-1">{c.node}</div>
              </div>
            ),
          }; })}
        />
        )}
      </div>

      <FilterRow showMonth />

      {/* Registro giorno per giorno del mese — stesse colonne/ordine della tabella Annuale
          ("madre" ex-Previsionale, ora unita qui): storico + previsione, non un elenco prenotazioni. */}
      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <h2 className="font-display text-lg font-bold text-txt">{t("Registro del mese")}</h2>
          <span className="text-sm capitalize text-dim">· {monthLabelOf(repMonth)}</span>
        </div>
        <RepTableView
          periodLabel={t("Giorno")}
          rows={rep.map((r) => ({ ...r, highlight: r.iso === todayISO, label: repDayLabel(r.iso) }))}
          totStorico={totStorico}
          totPrevis={totPrevis}
          totAll={totAll}
        />
        <p className="mt-2 text-xs text-faint"><b className="text-dim">{t("Storico")}</b> {t("= giorni già passati")} · <b className="text-dim">{t("Previsione")}</b> {t("= giorni futuri")}. {t("Tutte le prenotazioni prese e confermate valgono come ricavo pieno (come se tutto fosse incassato), indipendentemente dal selettore \"Ricavi\" qui sopra che riguarda solo le KPI card. Gli incassi effettivi sono nella sezione")} <b className="text-dim">{t("Incassi")}</b>.</p>
      </div>
      </>)}

      {/* Report annuale: 12 mesi dell'anno scelto + totali con confronto sull'anno precedente */}
      {report === "annuale" && (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg font-bold text-txt">{t("Report annuale")}</h2>
          <span className="text-sm capitalize text-dim">· {annualYear}</span>
        </div>

        {/* KPI anno con confronto sull'anno precedente */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiD label={t("Notti vendute")} value={String(annCur.roomNights)} d={delta(annCur.roomNights, annPrev.roomNights)} cmp={String(annualYear - 1)} />
          <KpiD label={t("Occupazione")} value={`${Math.round(annCur.occ * 100)}%`} d={delta(annCur.occ, annPrev.occ)} cmp={String(annualYear - 1)} />
          <KpiD label="ADR" value={eur(annCur.adr)} d={delta(annCur.adr, annPrev.adr)} cmp={String(annualYear - 1)} />
          <KpiD label="RevPAR" value={eur(annCur.revpar)} d={delta(annCur.revpar, annPrev.revpar)} cmp={String(annualYear - 1)} />
          <KpiD label={t("Ricavi")} value={eur(annCur.revenue)} d={delta(annCur.revenue, annPrev.revenue)} cmp={String(annualYear - 1)} />
        </div>

        <div className="mt-6">
          <FilterRow showMonth={false} />
          <RepTableView
            periodLabel={t("Mese")}
            rows={yearRep}
            totStorico={yearTotStorico}
            totPrevis={yearTotPrevis}
            totAll={yearTotAll}
          />
          <div className="mt-4 rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">{t("Ricavi per mese")} · {annualYear}</div>
            <ColumnChart bars={annualBars} format={(n) => eur(n)} height={220} barWidth={36} allLabels />
          </div>
        </div>
        <p className="mt-3 text-xs text-faint"><b className="text-dim">{t("Storico")}</b> {t("= mesi già conclusi")} · <b className="text-dim">{t("Previsione")}</b> {t("= mesi futuri")}. {t("La tabella usa sempre il ricavo per notte (competenza), indipendentemente dal selettore \"Ricavi\" qui sopra che riguarda solo le KPI card:")} <b className="text-dim">{basis === "notte" ? t("per notte (competenza)") : basis === "arrivo" ? t("per data di arrivo") : t("all'incasso")}</b>. {t("Confronto sull'anno")} {annualYear - 1}.</p>
      </div>
      )}
    </div>
  );
}

function RepCols() {
  const w = [118, 100, 84, 84, 70, 70, 74, 84, 104, 106, 106];
  return <colgroup>{w.map((x, i) => <col key={i} style={{ width: x }} />)}</colgroup>;
}

function KpiD({ label, value, d, cmp }: { label: string; value: string; d: number | null; cmp: string }) {
  const up = (d ?? 0) >= 0;
  const color = d == null ? "var(--faint)" : up ? "var(--ok)" : "var(--err)";
  const hint = d != null ? (
    <span className="flex items-center gap-1" style={{ color }}>
      <span>{up ? "▲" : "▼"}</span><span className="font-semibold">{Math.abs(d)}%</span><span className="text-faint">vs {cmp}</span>
    </span>
  ) : undefined;
  return <StatCard label={label} value={value} hint={hint} />;
}

