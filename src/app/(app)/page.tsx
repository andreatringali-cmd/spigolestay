"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { CHANNELS, type Channel } from "@/lib/types";
import { toISO, parseISO, nights, addDays } from "@/lib/dates";
import { eur, num } from "@/lib/format";
import { exportExcel, exportPdf } from "@/lib/export";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import ScrollStrip from "@/components/ScrollStrip";
import Donut from "@/components/Donut";
import LineChart from "@/components/LineChart";
import ColumnChart from "@/components/ColumnChart";
import Bars from "@/components/Bars";
import ChannelBars from "@/components/ChannelBars";
import Gauge from "@/components/Gauge";
import DensityChart from "@/components/DensityChart";
import DateField from "@/components/DateField";
import Icon from "@/components/Icon";
import ExportMenu from "@/components/ExportMenu";
import WeatherWidget from "@/components/WeatherWidget";
import DayNotes from "@/components/DayNotes";
import { flagColor, flagGradient, flagEmoji } from "@/lib/flags";

const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
const fmtFull = (iso: string) => parseISO(iso).toLocaleDateString("it-IT");

// Task tipici della checklist del giorno.
const ARRIVAL_TASKS = [
  { id: "selfcheckin", label: "Inviare self check-in" },
  { id: "guida", label: "Inviare guida ospiti" },
  { id: "info", label: "Info e codici d'ingresso" },
];
const DEPARTURE_TASKS = [
  { id: "checkout", label: "Inviare messaggio di check-out" },
  { id: "tassa", label: "Incassare la tassa di soggiorno" },
  { id: "controllo", label: "Controllo camera / eventuali danni" },
  { id: "cauzione", label: "Restituzione cauzione" },
  { id: "recensione", label: "Richiesta recensione" },
];
const INHOUSE_TASKS = [
  { id: "cortesia", label: "Messaggio di cortesia (tutto bene?)" },
  { id: "riassetto", label: "Riassetto / cambio biancheria" },
  { id: "upsell", label: "Proposta servizi extra / esperienze" },
];
// Grafici mostrati di default (in ordine). Gli altri sono opzionali (dal selettore).
const DEFAULT_CHART_KEYS = ["rooms", "ch-mix", "prov-day", "occ-gauge", "occ-trend", "rev-day"];

// Azioni pulizia del giorno (stessa semantica della pagina Pulizie).
const CLEAN_ACT: Record<string, { label: string; color: string }> = {
  turnover: { label: "Turnover", color: "var(--err)" },
  partenza: { label: "Partenza", color: "var(--warn)" },
  arrivo: { label: "Arrivo", color: "var(--focus)" },
  riassetto: { label: "Riassetto", color: "var(--ok)" },
};

export default function Dashboard() {
  const { bookings, guests, units, structures, getUnit, getStructure, openBooking, openNewBooking, activeStructureId } = useData();
  const { t } = useLang();
  const today = new Date();
  const todayISO = toISO(today);
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? t("Ospite");

  // Personalizzazione grafici Dashboard: quali nascondere (persistito nel browser). Minimo 4 visibili.
  const MIN_CHARTS = 4;
  const [hiddenCharts, setHiddenCharts] = useState<Set<string> | null>(null); // null = non ancora inizializzato
  const persistHidden = (next: Set<string>) => { setHiddenCharts(next); try { localStorage.setItem("spigolestay:dashcharts:v5", JSON.stringify([...next])); } catch {} };
  // Ordine dei grafici (riordino via drag&drop), persistito.
  const [chartOrder, setChartOrder] = useState<string[]>([]);
  const persistChartOrder = (o: string[]) => { setChartOrder(o); try { localStorage.setItem("spigolestay:dashchartorder:v2", JSON.stringify(o)); } catch {} };
  const [chartWarn, setChartWarn] = useState("");
  const [chartMenuOpen, setChartMenuOpen] = useState(false);
  const chartMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (chartMenuRef.current && !chartMenuRef.current.contains(e.target as Node)) setChartMenuOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);

  // Stato "schedina alloggiati": pronta quando l'ospite ha tutti i dati documento (stessa logica di /alloggiati).
  const alloggiatiOk = (b: { guestId: string }) => {
    const g = guests.find((x) => x.id === b.guestId);
    return !!(g && (g.lastName || g.fullName) && g.sex && g.birthDate && g.birthPlace && g.citizenship && g.docType && g.docNumber);
  };
  // Stato pagamento: confronto tra incassato e dovuto (soggiorno + pulizia).
  const payStatus = (b: { total?: number; cleaningFee?: number; paid?: number }): "paid" | "partial" | "unpaid" => {
    const due = (b.total ?? 0) + (b.cleaningFee ?? 0);
    const paid = b.paid ?? 0;
    if (due > 0 && paid >= due) return "paid";
    if (paid > 0) return "partial";
    return "unpaid";
  };

  const [date, setDate] = useState(todayISO);
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<null | "attive" | "inhouse" | "arrivi" | "partenze">(null);
  const toggleFocus = (f: "attive" | "inhouse" | "arrivi" | "partenze") => setFocus((cur) => (cur === f ? null : f));
  const sFilter = activeStructureId; // struttura attiva (globale, dalla barra in alto)

  // Checklist del giorno (spunte salvate nel browser).
  const [todoDone, setTodoDone] = useState<Set<string>>(new Set());
  useEffect(() => { try { const raw = localStorage.getItem("spigolestay:todo:v1"); if (raw) setTodoDone(new Set(JSON.parse(raw))); } catch {} }, []);
  const toggleTodo = (key: string) => setTodoDone((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { localStorage.setItem("spigolestay:todo:v1", JSON.stringify([...next])); } catch {}
    return next;
  });

  // Automazioni: la configurazione vive nei modelli del Centro messaggi (modello + automazione insieme).
  // Qui leggiamo quali attività sono automatiche (modello attivo, non manuale, collegato all'attività) per i badge.
  const [autoMap, setAutoMap] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const list: { active?: boolean; trigger?: string; srcId?: string; time?: string }[] = JSON.parse(localStorage.getItem("spigolestay:msgtemplates") || "[]");
      const m: Record<string, string> = {};
      list.forEach((t) => { if (t.active && t.trigger !== "manual" && t.srcId) m[t.srcId] = t.time ?? "10:00"; });
      setAutoMap(m);
    } catch {}
  }, []);
  const autoOf = (id: string): string | null => autoMap[id] ?? null;
  const isAutoKey = (k: string) => (k.startsWith("planning:") ? false : !!autoMap[k.split(":")[1] ?? ""]);

  const multi = structures.length > 1;
  const active = bookings.filter((b) => b.status !== "cancelled");
  const scoped = sFilter === "all" ? active : active.filter((b) => b.structureId === sFilter);
  const scopedUnits = (sFilter === "all" ? units : units.filter((u) => u.structureId === sFilter)).filter((u) => !u.outOfService);

  // KPI del giorno selezionato.
  // "Prenotazioni attive" = tutti i movimenti che toccano oggi: in struttura + arrivi + partenze.
  // "Camere occupate" = stanze occupate adesso = quelle in struttura.
  const arrivalsSel = scoped.filter((b) => b.checkIn === date).length;
  const departuresSel = scoped.filter((b) => b.checkOut === date).length;
  const inHouseSel = scoped.filter((b) => b.checkIn < date && date < b.checkOut).length; // arrivati prima, ancora presenti
  const activeSel = inHouseSel + arrivalsSel + departuresSel;

  // Metriche del giorno selezionato (accrual per notte)
  const inHouseDate = scoped.filter((b) => b.unitId && b.checkIn <= date && date < b.checkOut);
  const occRooms = inHouseDate.length;
  // Camere occupate la notte del giorno scelto = presenti + arrivi di oggi (esclude le partenze di oggi).
  const occNight = scoped.filter((b) => b.checkIn <= date && date < b.checkOut).length;
  const dayRevenue = inHouseDate.reduce((a, b) => a + (b.total ? b.total / nights(b.checkIn, b.checkOut) : 0), 0);
  const adrDay = occRooms ? dayRevenue / occRooms : 0;
  const revparDay = scopedUnits.length ? dayRevenue / scopedUnits.length : 0;

  // Grafici GIORNALIERI (seguono la data selezionata)
  const chColor = (c: Channel) => `var(${CHANNELS[c].cssVar})`;
  const structuresToShow = (sFilter === "all" ? structures : structures.filter((s) => s.id === sFilter))
    .slice().sort((a, b) => a.name.localeCompare(b.name, "it"));
  const PALETTE = ["#BE5D38", "#7A8450", "#C08A3A", "#957A66", "#4F8A5B", "#5B74E6", "#B3453A"];
  const channels = (Object.keys(CHANNELS) as Channel[]).filter((c) => c !== "blocked");
  const nightly = (b: { total?: number; checkIn: string; checkOut: string }) => (b.total ? b.total / nights(b.checkIn, b.checkOut) : 0);

  // Prenotazioni presenti nel giorno selezionato (in struttura + in arrivo)
  const daySet = scoped.filter((b) => b.checkIn <= date && date < b.checkOut);
  const bookingsDonut = channels.map((c) => ({ label: CHANNELS[c].label, value: daySet.filter((b) => b.channel === c).length, color: chColor(c) })).filter((x) => x.value > 0);
  const revenueDonut = channels.map((c) => ({ label: CHANNELS[c].label, value: Math.round(daySet.filter((b) => b.channel === c).reduce((a, b) => a + nightly(b), 0)), color: chColor(c) })).filter((x) => x.value > 0);
  // Dati unici per canale: prenotazioni + ricavi insieme (un solo grafico a barre)
  const channelRows = channels.map((c) => ({ label: CHANNELS[c].label, color: chColor(c), count: daySet.filter((b) => b.channel === c).length, revenue: Math.round(daySet.filter((b) => b.channel === c).reduce((a, b) => a + nightly(b), 0)) })).filter((r) => r.count > 0 || r.revenue > 0);
  // Prezzo a notte (ADR) per canale → density plot
  const priceByChannel = channels.map((c) => ({ label: CHANNELS[c].label, color: chColor(c), values: scoped.filter((b) => b.channel === c && b.total && nights(b.checkIn, b.checkOut) > 0).map((b) => Math.round((b.total ?? 0) / nights(b.checkIn, b.checkOut))) })).filter((s) => s.values.length > 0);
  const dayRevTotal = Math.round(daySet.reduce((a, b) => a + nightly(b), 0));

  // Occupazione per struttura (giorno selezionato) — a torta
  const occByStructureDay = structuresToShow.map((s, i) => {
    const su = scopedUnits.filter((u) => u.structureId === s.id);
    const occ = scoped.filter((b) => b.unitId && su.some((u) => u.id === b.unitId) && b.checkIn <= date && date < b.checkOut).length;
    return { label: s.name, value: occ, color: PALETTE[i % PALETTE.length] };
  }).filter((x) => x.value > 0);

  // Andamento 7 giorni a partire dalla data selezionata
  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(parseISO(date), i);
    const iso = toISO(d);
    const occ = scoped.filter((b) => b.unitId && scopedUnits.some((u) => u.id === b.unitId) && b.checkIn <= iso && iso < b.checkOut);
    return { d, occ: scopedUnits.length ? Math.round((occ.length / scopedUnits.length) * 100) : 0 };
  });
  const occTrend = trend.map((t) => ({ label: String(t.d.getDate()), value: t.occ }));

  // Incassi attesi (accrual per notte) · 7 giorni dalla data selezionata; evidenzia il giorno scelto.
  const revDaily = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(parseISO(date), i);
    const iso = toISO(d);
    const value = Math.round(scoped.filter((b) => b.checkIn <= iso && iso < b.checkOut).reduce((a, b) => a + nightly(b), 0));
    return { label: String(d.getDate()), value, highlight: iso === date };
  });
  const revTotal7 = revDaily.reduce((a, b) => a + b.value, 0);

  // --- Altri grafici giornalieri (dati del giorno selezionato) ---
  const roomsDonut = [
    { label: t("Occupate"), value: occRooms, color: "var(--ok)" },
    { label: t("Libere"), value: Math.max(0, scopedUnits.length - occRooms), color: "var(--line)" },
  ].filter((x) => x.value > 0);
  const bsOfStruct = (s: { id: string }) => { const su = scopedUnits.filter((u) => u.structureId === s.id); return daySet.filter((b) => b.unitId && su.some((u) => u.id === b.unitId)); };
  const guestsByStruct = structuresToShow.map((s, i) => ({ label: s.name, value: bsOfStruct(s).reduce((a, b) => a + b.adults + b.children, 0), color: PALETTE[i % PALETTE.length] })).filter((x) => x.value > 0);
  const revByStructDay = structuresToShow.map((s) => ({ label: s.name, value: Math.round(bsOfStruct(s).reduce((a, b) => a + nightly(b), 0)), color: "var(--ok)", fmt: eur })).filter((x) => x.value > 0);
  const countryDay: Record<string, number> = {};
  daySet.forEach((b) => { const c = guests.find((g) => g.id === b.guestId)?.country ?? "—"; countryDay[c] = (countryDay[c] || 0) + 1; });
  const provDay = Object.entries(countryDay).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, color: flagColor(k), fill: flagGradient(k) }));

  const dashCharts = [
    // Predefiniti (ordine da sinistra):
    { key: "occ-gauge", title: t("Occupazione del giorno"), node: <Gauge value={scopedUnits.length ? Math.round((occRooms / scopedUnits.length) * 100) : 0} unit="%" color="var(--ok)" /> },
    { key: "ch-mix", title: t("Prenotazioni e ricavi per canale (giorno)"), wide: true, node: <ChannelBars rows={channelRows} fmtEur={eur} /> },
    { key: "price-ch", title: t("Prezzo a notte per canale"), wide: true, extra: (<span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">{priceByChannel.map((s) => (<span key={s.label} className="flex items-center gap-1 text-[10px] text-dim"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}</span>))}</span>), node: <DensityChart series={priceByChannel} unit="€" legend={false} /> },
    { key: "rev-str", title: t("Ricavi per struttura (giorno)"), perStructure: true, node: <Bars items={revByStructDay} /> },
    { key: "occ-trend", title: t("Occupazione attesa · 7 giorni"), node: <LineChart points={occTrend} color="var(--focus)" format={(n) => `${n}%`} everyLabel={1} /> },
    // Opzionali (dal selettore):
    { key: "occ-str", title: t("Occupazione per struttura (giorno)"), perStructure: true, node: <Donut data={occByStructureDay} showPercent={false} /> },
    { key: "rooms", title: t("Camere occupate vs libere (giorno)"), node: <Donut data={roomsDonut} center={`${occRooms}/${scopedUnits.length}`} showPercent={false} /> },
    { key: "guests-str", title: t("Ospiti per struttura (giorno)"), perStructure: true, node: <Bars items={guestsByStruct} /> },
    { key: "prov-day", title: t("Provenienza ospiti (giorno)"), node: <ColumnChart bars={provDay} allLabels /> },
    { key: "rev-day", title: t("Incassi attesi · prossimi 7 giorni"), node: <ColumnChart bars={revDaily} format={(n) => eur(n)} />, extra: <span className="shrink-0 rounded-md bg-wash px-2 py-0.5 font-mono text-xs font-bold text-txt" title={t("Totale atteso sui 7 giorni")}>{eur(revTotal7)}</span> },
  ];
  // Di default sono VISIBILI i grafici principali; restano nascosti solo gli opzionali.
  const defaultHidden = () => new Set(dashCharts.map((c) => c.key).filter((k) => !DEFAULT_CHART_KEYS.includes(k)));
  useEffect(() => {
    try { const r = localStorage.getItem("spigolestay:dashcharts:v5"); if (r) setHiddenCharts(new Set(JSON.parse(r))); else setHiddenCharts(defaultHidden()); } catch { setHiddenCharts(defaultHidden()); }
    try { const o = localStorage.getItem("spigolestay:dashchartorder:v2"); if (o) setChartOrder(JSON.parse(o)); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hidden = hiddenCharts ?? defaultHidden();
  // Con una sola struttura selezionata i grafici "per struttura" non hanno senso: si nascondono da soli.
  const singleStruct = sFilter !== "all" || !multi;
  const chartAvailable = (c: any) => !(singleStruct && c.perStructure);
  // Ordine: prima i 4 di default, poi gli altri; sopra si applica l'ordine scelto dall'utente (drag&drop).
  const chartRank = (c: any) => { const i = DEFAULT_CHART_KEYS.indexOf(c.key); return i < 0 ? 100 + dashCharts.findIndex((x) => x.key === c.key) : i; };
  const availCharts = dashCharts.filter(chartAvailable).sort((a, b) => chartRank(a) - chartRank(b));
  const shownCharts = availCharts.filter((c) => !hidden.has(c.key)).sort((a, b) => {
    const ia = chartOrder.indexOf(a.key), ib = chartOrder.indexOf(b.key);
    if (ia < 0 && ib < 0) return 0;
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
  const toggleChart = (key: string) => { const n = new Set(hidden); if (n.has(key)) n.delete(key); else n.add(key); persistHidden(n); };
  const showAllCharts = () => { setChartWarn(""); persistHidden(new Set()); };
  const hideAllCharts = () => { setChartWarn(""); persistHidden(new Set(availCharts.map((c) => c.key))); };

  // Liste per la data selezionata
  const term = search.trim().toLowerCase();
  const match = (b: { guestId: string }) => !term || guestName(b.guestId).toLowerCase().includes(term);
  const arrivals = scoped.filter((b) => b.checkIn === date && match(b));
  const departures = scoped.filter((b) => b.checkOut === date && match(b));
  const inHouse = scoped.filter((b) => b.checkIn < date && date < b.checkOut && match(b));
  const groupByStructure = sFilter === "all" && multi;
  const hasFilters = !!(term || date !== todayISO || focus);

  // Quali pannelli mostrare in base alla card cliccata.
  const showInhouse = focus === null || focus === "inhouse" || focus === "attive";
  const showPart = focus === null || focus === "partenze" || focus === "attive";
  const showArr = focus === null || focus === "arrivi" || focus === "attive";
  const visibleCount = [showInhouse, showPart, showArr].filter(Boolean).length;
  const gridCols = visibleCount === 1 ? "lg:grid-cols-1" : visibleCount === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3";

  const doExcel = () => {
    exportExcel(
      "prenotazioni",
      [t("Codice"), t("Struttura"), t("Camera"), t("Canale"), t("Ospite"), t("Check-in"), t("Check-out"), t("Notti"), t("Totale €")],
      scoped.map((b) => [
        b.id.toUpperCase(), getStructure(b.structureId)?.name ?? "", getUnit(b.unitId)?.name ?? t("Da assegnare"),
        CHANNELS[b.channel].label, guestName(b.guestId), fmtFull(b.checkIn), fmtFull(b.checkOut), nights(b.checkIn, b.checkOut), b.total ?? 0,
      ])
    );
  };

  const listProps = { guestName, getStructure, getUnit, openBooking, structures: structuresToShow, groupByStructure, alloggiatiOk, payStatus };

  // Centro di comando: stato cross-modulo (dati salvati dalle altre sezioni).
  const relTime = (ts: number) => { const d = Math.floor((Date.now() - ts) / 60000); if (d < 1) return t("adesso"); if (d < 60) return `${d} ${t("min fa")}`; if (d < 1440) return `${Math.floor(d / 60)} ${t("h fa")}`; return `${Math.floor(d / 1440)} ${t("g fa")}`; };
  const daIncassare = scoped.filter((b) => b.checkOut >= todayISO).reduce((a, b) => a + Math.max(0, (b.total ?? 0) + (b.cleaningFee ?? 0) - (b.paid ?? 0)), 0);
  const [cc, setCc] = useState<{ invii: number; canali: number; sync: string }>({ invii: 0, canali: 0, sync: "—" });
  useEffect(() => {
    try {
      const addD = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
      const tpls: { active: boolean; trigger: string; days: number }[] = JSON.parse(localStorage.getItem("spigolestay:msgtemplates") || "[]");
      let invii = 0;
      for (const t of tpls.filter((x) => x.active && x.trigger !== "manual")) for (const b of bookings) {
        if (b.status === "cancelled") continue;
        const a = t.trigger === "before_arrival" ? addD(b.checkIn, -t.days)
          : t.trigger === "on_arrival" ? b.checkIn
          : t.trigger === "after_arrival" ? addD(b.checkIn, t.days)
          : t.trigger === "on_checkout" ? b.checkOut
          : addD(b.checkOut, t.days);
        if (a >= todayISO) invii++;
      }
      const conn: Record<string, { connected?: boolean; lastSync?: string }> = JSON.parse(localStorage.getItem("spigolestay:canali:conn") || "{}");
      const connected = Object.values(conn).filter((c) => c?.connected).length;
      const syncs = Object.values(conn).map((c) => c?.lastSync).filter(Boolean).map((s) => new Date(s as string).getTime());
      setCc({ invii, canali: connected, sync: syncs.length ? relTime(Math.max(...syncs)) : t("mai") });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMap]);

  // ===== Panoramica operativa (widget riferiti a OGGI) =====
  const guestOf = (id: string) => guests.find((g) => g.id === id);
  const balanceOf = (b: { total?: number; cleaningFee?: number; paid?: number }) => Math.max(0, (b.total ?? 0) + (b.cleaningFee ?? 0) - (b.paid ?? 0));
  const realToday = scoped.filter((b) => b.channel !== "blocked" && b.status !== "cancelled");
  const arrToday = realToday.filter((b) => b.checkIn === todayISO);
  const depToday = realToday.filter((b) => b.checkOut === todayISO);
  const inHouseToday = realToday.filter((b) => b.checkIn <= todayISO && todayISO < b.checkOut);
  const scopedUnitsAll = sFilter === "all" ? units : units.filter((u) => u.structureId === sFilter);

  // Alert "Da controllare"
  const alUnassigned = arrToday.filter((b) => !b.unitId);
  const alTax = depToday.filter((b) => !b.cityTaxExempt && !b.cityTaxPaid);
  const alCheckin = arrToday.filter((b) => !b.webCheckin && !b.signature);
  const alBalance = realToday.filter((b) => b.checkIn <= todayISO && b.checkOut >= todayISO && balanceOf(b) > 0);
  const alOos = scopedUnitsAll.filter((u) => u.outOfService);
  const alerts = [
    { n: alUnassigned.length, label: "arrivi senza camera assegnata", color: "var(--err)", href: "/prenotazioni" },
    { n: alBalance.length, label: "prenotazioni con saldo aperto", color: "var(--warn)", href: "/pagamenti" },
    { n: alTax.length, label: "partenze senza tassa di soggiorno registrata", color: "var(--warn)", href: "/tassa-soggiorno" },
    { n: alCheckin.length, label: "arrivi senza check-in online / schedina", color: "var(--focus)", href: "/alloggiati" },
    { n: alOos.length, label: "camere fuori servizio", color: "var(--dim)", href: "/camere" },
  ].filter((a) => a.n > 0);

  // Pulizie di oggi — stessa logica della pagina Pulizie: per camera, in base ai movimenti di oggi.
  const np = (b?: { adults: number; children: number }) => (b ? b.adults + b.children : 0);
  const cleanRooms = scopedUnitsAll.filter((u) => !u.outOfService).map((u) => {
    const dep = realToday.find((b) => b.unitId === u.id && b.checkOut === todayISO);
    const arr = realToday.find((b) => b.unitId === u.id && b.checkIn === todayISO);
    const stay = realToday.find((b) => b.unitId === u.id && b.checkIn < todayISO && todayISO < b.checkOut);
    const action: "turnover" | "partenza" | "arrivo" | "riassetto" | "niente" =
      dep && arr ? "turnover" : dep ? "partenza" : arr ? "arrivo" : stay ? "riassetto" : "niente";
    return { u, action, dep, arr, stay };
  }).filter((r) => r.action !== "niente");
  const cleanByStruct = structuresToShow.map((s) => ({ s, list: cleanRooms.filter((r) => r.u.structureId === s.id) })).filter((g) => g.list.length);
  const turnoverCount = cleanRooms.filter((r) => r.action === "turnover").length;

  // Compleanni oggi e ospiti di ritorno tra gli arrivi
  // Compleanni oggi: ospiti in arrivo o già in struttura che compiono gli anni oggi.
  const presentToday = [...arrToday, ...inHouseToday.filter((b) => !arrToday.some((a) => a.id === b.id))];
  const arrBirthday = presentToday.filter((b) => { const g = guestOf(b.guestId); return g?.birthDate && g.birthDate.slice(5) === todayISO.slice(5); });
  const arrReturning = arrToday.filter((b) => bookings.filter((x) => x.guestId === b.guestId && x.status !== "cancelled").length > 1);

  // Soldi di oggi
  const saldoPartenze = depToday.reduce((a, b) => a + balanceOf(b), 0);
  const accontiArrivi = arrToday.reduce((a, b) => a + (b.paid ?? 0), 0);
  const cauzioni = depToday.map((b) => ({ b, dep: getStructure(b.structureId)?.deposit ?? 0 })).filter((x) => x.dep > 0);
  const cauzioniTot = cauzioni.reduce((a, x) => a + x.dep, 0);

  // Riepilogo mese corrente vs precedente (ricavi confermati)
  const monthKey = todayISO.slice(0, 7);
  const prevMonthKey = toISO(addDays(parseISO(monthKey + "-01"), -1)).slice(0, 7);
  const realAll = bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && (sFilter === "all" || b.structureId === sFilter));
  const revOfMonth = (mk: string) => realAll.filter((b) => b.checkIn.slice(0, 7) === mk).reduce((a, b) => a + (b.total ?? 0), 0);
  const bkOfMonth = realAll.filter((b) => b.checkIn.slice(0, 7) === monthKey).length;
  const revMonth = revOfMonth(monthKey);
  const revPrevMonth = revOfMonth(prevMonthKey);
  const revMonthDelta = revPrevMonth ? Math.round(((revMonth - revPrevMonth) / revPrevMonth) * 100) : null;

  // Feed attività recente: ultime prenotazioni inserite + cancellazioni
  const feed = [...bookings]
    .filter((b) => (sFilter === "all" || b.structureId === sFilter) && b.channel !== "blocked" && b.bookedOn)
    .sort((a, b) => (b.bookedOn! > a.bookedOn! ? 1 : -1))
    .slice(0, 6);

  return (
    <div>
      <PageHeader title={t("Dashboard")} subtitle={`${t("Riferito a")} ${parseISO(date).toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`} actions={<WeatherWidget compact />} />

      {/* KPI stato attuale — cliccabili per filtrare i movimenti sotto */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("Prenotazioni attive")} value={String(activeSel)} color="var(--focus)" onClick={() => toggleFocus("attive")} active={focus === "attive"} />
        <Kpi label={t("In struttura")} value={String(inHouseSel)} color="var(--ok)" onClick={() => toggleFocus("inhouse")} active={focus === "inhouse"} />
        <Kpi label={t("Arrivi")} value={String(arrivalsSel)} color="var(--txt)" onClick={() => toggleFocus("arrivi")} active={focus === "arrivi"} />
        <Kpi label={t("Partenze")} value={String(departuresSel)} color="var(--warn)" onClick={() => toggleFocus("partenze")} active={focus === "partenze"} />
      </div>

      {/* KPI del giorno selezionato */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("Camere occupate")} value={`${occNight}/${scopedUnits.length}`} color="var(--txt)" small />
        <Kpi label={t("ADR (prezzo medio/notte)")} value={eur(adrDay)} color="var(--txt)" small />
        <Kpi label={t("RevPAR (giorno)")} value={eur(revparDay)} color="var(--txt)" small />
        <Kpi label={t("Incassi del giorno")} value={eur(dayRevenue)} color="var(--txt)" small />
      </div>


      {/* Grafici: una riga scorrevole con frecce ‹ › · mostra/nascondi dal selettore */}
      {shownCharts.length > 0 && (
        <div className="mt-5">
          <ScrollStrip
            gap="gap-3"
            onReorder={(keys) => { const rest = dashCharts.map((c) => c.key).filter((k) => !keys.includes(k)); persistChartOrder([...keys, ...rest]); }}
            items={shownCharts.map((c) => ({
              key: c.key,
              className: `flex-none snap-start ${(c as { wide?: boolean }).wide ? "w-[520px] max-w-[92vw] lg:w-[calc((100%-2.25rem)/2+0.75rem)]" : "w-[280px] lg:w-[calc((100%-2.25rem)/4)]"}`,
              node: (
                <Card className="flex h-full flex-col">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-faint">{c.title}</span>
                    {"extra" in c ? c.extra : null}
                  </div>
                  <div className="flex-1">{c.node}</div>
                </Card>
              ),
            }))}
          />
        </div>
      )}

      {/* Sezione giorno */}
      <div className="mt-6 mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
        <div className="no-print flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Cerca ospite…")} className="w-full max-w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt outline-none placeholder:text-faint focus:border-focus sm:w-72 lg:w-80 xl:w-[22rem] 2xl:w-96" />
          <div className="flex items-center gap-1">
            <button onClick={() => setDate(toISO(addDays(parseISO(date), -1)))} title={t("Giorno precedente")} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-base leading-none text-dim hover:bg-wash hover:text-txt">‹</button>
            <DateField value={date} onChange={setDate} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm transition hover:border-focus" />
            <button onClick={() => setDate(toISO(addDays(parseISO(date), 1)))} title={t("Giorno successivo")} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-base leading-none text-dim hover:bg-wash hover:text-txt">›</button>
          </div>
          {focus && <span className="rounded-full bg-wash px-2.5 py-0.5 text-[11px] font-semibold text-focus">{t("Filtro")}: {focus === "attive" ? t("attive") : focus === "inhouse" ? t("in struttura") : focus === "arrivi" ? t("arrivi") : t("partenze")}</span>}
          {hasFilters && <button onClick={() => { setSearch(""); setDate(todayISO); setFocus(null); }} className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-wash" style={{ borderColor: "var(--err)", color: "var(--err)" }}>{t("Rimuovi filtri")}</button>}
        </div>
        <div className="no-print ml-auto flex items-center gap-2">
          {/* Selettore grafici da mostrare */}
          {/* Toggle grafici: un click mostra tutti / nasconde tutti (neutro) */}
          <button onClick={() => (shownCharts.length > 0 ? hideAllCharts() : showAllCharts())} title={shownCharts.length > 0 ? t("Nascondi i grafici") : t("Mostra i grafici")} className={`grid h-9 w-9 place-items-center rounded-lg border border-line transition ${shownCharts.length > 0 ? "bg-wash text-txt" : "text-dim hover:bg-wash hover:text-txt"}`}>
            <Icon name="chart" size={16} />
          </button>
          <ExportMenu onExcel={doExcel} onPdf={exportPdf} />
        </div>
      </div>
      <div className={`grid gap-4 ${gridCols}`}>
        {showInhouse && (
          <Card>
            <ListHeader icon="bed" color="var(--ok)">{t("In struttura")} ({inHouse.length})</ListHeader>
            <MoveList items={inHouse} empty={t("Nessun ospite presente")} {...listProps} />
          </Card>
        )}
        {showPart && (
          <Card>
            <ListHeader icon="logout" color="var(--warn)">{t("Partenze")} ({departures.length})</ListHeader>
            <MoveList items={departures} empty={t("Nessuna partenza")} {...listProps} />
          </Card>
        )}
        {showArr && (
          <Card>
            <ListHeader icon="login" color="var(--focus)">{t("Arrivi")} ({arrivals.length})</ListHeader>
            <MoveList items={arrivals} empty={t("Nessun arrivo")} {...listProps} />
          </Card>
        )}
      </div>

      {/* Checklist del giorno */}
      {(() => {
        const todoArr = arrivals;
        const todoDep = departures;
        const todoStay = inHouse;
        const planningKey = `planning:${date}`;
        const keys = [
          planningKey,
          ...todoDep.flatMap((b) => DEPARTURE_TASKS.map((t) => `${b.id}:${t.id}`)),
          ...todoStay.flatMap((b) => INHOUSE_TASKS.map((t) => `${b.id}:${t.id}`)),
          ...todoArr.flatMap((b) => ARRIVAL_TASKS.map((t) => `${b.id}:${t.id}`)),
        ];
        const doneCount = keys.filter((k) => todoDone.has(k) || isAutoKey(k)).length;
        if (keys.length === 0) return null;
        const planningDone = todoDone.has(planningKey);
        return (
          <div className="mt-8">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h3 className="font-display text-lg font-bold text-txt">{t("Da fare oggi")}</h3>
              <span className="text-sm text-dim">{doneCount}/{keys.length} {t("completate")}</span>
              <div className="ml-1 h-1.5 w-40 overflow-hidden rounded-full bg-wash">
                <div className="h-full rounded-full transition-all" style={{ width: `${keys.length ? (doneCount / keys.length) * 100 : 0}%`, backgroundColor: "var(--ok)" }} />
              </div>
              <Link href="/messaggi?tab=modelli" className="ml-auto flex items-center gap-1.5 rounded-lg border border-focus bg-[color:color-mix(in_srgb,var(--focus)_10%,transparent)] px-3 py-1.5 text-xs font-semibold text-focus transition hover:bg-[color:color-mix(in_srgb,var(--focus)_18%,transparent)]">{t("Gestisci automazioni")} →</Link>
            </div>

            <label className="mb-4 flex items-center gap-2.5 rounded-xl border border-line bg-surface p-3 text-sm shadow-sm">
              <input type="checkbox" checked={planningDone} onChange={() => toggleTodo(planningKey)} className="h-4 w-4 cursor-pointer accent-[color:var(--ok)]" />
              <span className="text-[color:var(--warn)]"><Icon name="sparkles" size={16} /></span>
              <span className={planningDone ? "text-faint line-through" : "font-medium text-txt"}>{t("Inviare il planning alla signora delle pulizie")}</span>
            </label>
            <div className="grid gap-4 lg:grid-cols-3">
              <TodoGroup title={t("In struttura")} icon="bed" color="var(--ok)" items={todoStay} tasks={INHOUSE_TASKS} done={todoDone} onToggle={toggleTodo} autoOf={autoOf} guestName={guestName} getUnit={getUnit} getStructure={getStructure} multi={multi} openBooking={openBooking} />
              <TodoGroup title={t("Partenze")} icon="logout" color="var(--warn)" items={todoDep} tasks={DEPARTURE_TASKS} done={todoDone} onToggle={toggleTodo} autoOf={autoOf} guestName={guestName} getUnit={getUnit} getStructure={getStructure} multi={multi} openBooking={openBooking} />
              <TodoGroup title={t("Arrivi")} icon="login" color="var(--focus)" items={todoArr} tasks={ARRIVAL_TASKS} done={todoDone} onToggle={toggleTodo} autoOf={autoOf} guestName={guestName} getUnit={getUnit} getStructure={getStructure} multi={multi} openBooking={openBooking} />
            </div>
          </div>
        );
      })()}

      {/* Panoramica operativa */}
      <div className="mt-8">
        <SectionTitle>{t("Panoramica operativa")}</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Da controllare */}
          <OpsCard title={t("Da controllare")} icon="eye" color={alerts.length ? "var(--warn)" : "var(--ok)"} right={<span className="text-[11px] text-faint">{alerts.length ? `${alerts.length} ${t("avvisi")}` : t("ok")}</span>}>
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 py-1 text-sm text-dim"><span className="font-bold text-[color:var(--ok)]">✓</span> {t("Tutto in ordine per oggi.")}</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {alerts.map((a, i) => (
                  <Link key={i} href={a.href} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2 hover:bg-wash">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: a.color }}>{a.n}</span>
                    <span className="min-w-0 flex-1 text-sm text-txt">{t(a.label)}</span>
                    <Icon name="chevron" size={14} />
                  </Link>
                ))}
              </div>
            )}
          </OpsCard>

          {/* Pulizie di oggi */}
          <OpsCard title={t("Pulizie di oggi")} icon="sparkles" color="#0891B2" right={<Link href="/pulizie" className="text-[11px] font-semibold text-focus hover:underline">{t("Apri")} →</Link>}>
            {cleanRooms.length === 0 ? (
              <div className="py-2 text-sm text-faint">{t("Nessuna camera da preparare oggi.")}</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {turnoverCount > 0 && (
                  <div className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[color:var(--err)]" style={{ backgroundColor: "color-mix(in srgb, var(--err) 12%, transparent)" }}>⚡ {turnoverCount} {t("turnover · check-out e check-in nella stessa camera")}</div>
                )}
                {cleanByStruct.map((g) => (
                  <div key={g.s.id}>
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: g.s.photoColor ?? "var(--faint)" }} />
                      <span className="truncate text-[11px] font-semibold uppercase tracking-wide" style={{ color: g.s.photoColor ?? "var(--dim)" }}>{g.s.name}</span>
                      <span className="text-[11px] text-faint">· {g.list.length}</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {g.list.map((r) => {
                        const a = CLEAN_ACT[r.action];
                        return (
                          <div key={r.u.id} className="rounded-lg border border-line py-1.5 pl-2 pr-2" style={{ borderLeft: `3px solid ${a.color}` }}>
                            <div className="mb-0.5 flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-txt">{r.u.name}</span>
                              <span className="shrink-0 text-[10px] font-semibold uppercase" style={{ color: a.color }}>{t(a.label)}</span>
                            </div>
                            {r.dep && (
                              <button onClick={() => openBooking(r.dep!.id)} className="flex w-full items-center gap-1.5 text-left text-xs text-dim hover:text-focus">
                                <Icon name="logout" size={12} /><span className="truncate">{guestName(r.dep.guestId)}</span>
                                <span className="shrink-0 text-faint">· {np(r.dep)} {t("osp")} · out {fmt(r.dep.checkOut)}</span>
                              </button>
                            )}
                            {r.arr && (
                              <button onClick={() => openBooking(r.arr!.id)} className="flex w-full items-center gap-1.5 text-left text-xs text-dim hover:text-focus">
                                <Icon name="login" size={12} /><span className="truncate">{guestName(r.arr.guestId)}</span>
                                <span className="shrink-0 text-faint">· {np(r.arr)} {t("osp")} · in {r.arr.arrivalTime || fmt(r.arr.checkIn)}</span>
                              </button>
                            )}
                            {r.action === "riassetto" && r.stay && (
                              <button onClick={() => openBooking(r.stay!.id)} className="flex w-full items-center gap-1.5 text-left text-xs text-dim hover:text-focus">
                                <Icon name="bed" size={12} /><span className="truncate">{guestName(r.stay.guestId)}</span>
                                <span className="shrink-0 text-faint">· {np(r.stay)} {t("osp")} · {t("in casa fino al")} {fmt(r.stay.checkOut)}</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </OpsCard>

          {/* Ospiti speciali oggi */}
          <OpsCard title={t("Ospiti speciali oggi")} icon="sparkles" color="#7C3AED" right={<span className="text-[11px] text-faint">{t("arrivi")}</span>}>
            {(() => {
              const rows: { id: string; name: string; badge: string; col: string; icon?: string }[] = [];
              arrBirthday.forEach((b) => rows.push({ id: b.id, name: guestName(b.guestId), badge: t("compleanno"), col: "#DB2777", icon: "cake" }));
              arrReturning.forEach((b) => { if (!rows.some((r) => r.id === b.id)) rows.push({ id: b.id, name: guestName(b.guestId), badge: t("ospite di ritorno"), col: "var(--ok)" }); });
              arrToday.filter((b) => guestOf(b.guestId)?.vip).forEach((b) => { if (!rows.some((r) => r.id === b.id)) rows.push({ id: b.id, name: guestName(b.guestId), badge: "VIP", col: "#7C3AED" }); });
              arrToday.filter((b) => guestOf(b.guestId)?.tags?.includes("Animali")).forEach((b) => rows.push({ id: b.id + "-pet", name: guestName(b.guestId), badge: t("con animali"), col: "#0891B2", icon: "paw" }));
              return rows.length === 0 ? (
                <div className="py-2 text-sm text-faint">{t("Nessuna segnalazione tra gli arrivi di oggi.")}</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {rows.slice(0, 6).map((r, i) => (
                    <div key={r.id + i} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-txt">{r.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${r.col} 14%, transparent)`, color: r.col }}>{r.icon && <Icon name={r.icon} size={11} />}{r.badge}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </OpsCard>

          {/* Stato canali */}
          <OpsCard title={t("Stato canali OTA")} icon="share" color="#5B74E6" right={<Link href="/canali" className="text-[11px] font-semibold text-focus hover:underline">{t("Gestisci")} →</Link>}>
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: cc.canali >= 6 ? "var(--ok)" : cc.canali > 0 ? "var(--warn)" : "var(--err)" }} />
              <div>
                <div className="font-mono text-xl font-bold text-txt">{cc.canali}/6 <span className="text-sm font-medium text-dim">{t("connessi")}</span></div>
                <div className="text-[11px] text-faint">{t("ultima sincronizzazione")} · {cc.sync}</div>
              </div>
            </div>
          </OpsCard>

          {/* Soldi di oggi */}
          <OpsCard title={t("Soldi di oggi")} icon="receipt" color="var(--ok)" right={<Link href="/pagamenti" className="text-[11px] font-semibold text-focus hover:underline">{t("Incassi")} →</Link>}>
            <div className="flex flex-col gap-2">
              <MoneyRow label={t("Saldi da incassare alla partenza")} value={eur(saldoPartenze)} color="var(--warn)" />
              <MoneyRow label={t("Acconti già incassati (arrivi)")} value={eur(accontiArrivi)} color="var(--ok)" />
              <MoneyRow label={`${t("Cauzioni da gestire")} (${cauzioni.length})`} value={eur(cauzioniTot)} color="var(--focus)" />
            </div>
          </OpsCard>

          {/* Riepilogo mese */}
          <OpsCard title={t("Riepilogo del mese")} icon="chart" color="#2C8A8A" right={<Link href="/statistiche" className="text-[11px] font-semibold text-focus hover:underline">{t("Statistiche")} →</Link>}>
            <div className="flex items-end gap-4">
              <div>
                <div className="font-mono text-2xl font-bold text-txt">{eur(revMonth)}</div>
                <div className="text-[11px] text-faint">{t("ricavi confermati")} · {bkOfMonth} {t("prenotazioni")}</div>
              </div>
              {revMonthDelta !== null && (
                <span className="mb-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${revMonthDelta >= 0 ? "var(--ok)" : "var(--err)"} 14%, transparent)`, color: revMonthDelta >= 0 ? "var(--ok)" : "var(--err)" }}>{revMonthDelta >= 0 ? "+" : ""}{revMonthDelta}% {t("vs mese prec.")}</span>
              )}
            </div>
          </OpsCard>

          {/* Attività recente */}
          <OpsCard title={t("Attività recente")} icon="clipboard" color="var(--dim)" right={<span className="text-[11px] text-faint">{t("ultime")}</span>}>
            {feed.length === 0 ? (
              <div className="py-2 text-sm text-faint">{t("Nessuna attività.")}</div>
            ) : (
              <div className="flex flex-col gap-1">
                {feed.map((b) => {
                  const cancelled = b.status === "cancelled";
                  return (
                    <button key={b.id} onClick={() => openBooking(b.id)} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-wash">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: cancelled ? "var(--err)" : "var(--ok)" }}>{cancelled ? "✕" : "+"}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-txt">{guestName(b.guestId)} <span className="text-faint">· {CHANNELS[b.channel].label}</span></span>
                      <span className="shrink-0 text-[11px] text-faint">{b.bookedOn ? fmt(b.bookedOn) : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </OpsCard>

          {/* Promemoria */}
          <DayNotes />
        </div>
      </div>

    </div>
  );
}

function OpsCard({ title, icon, color, right, children }: { title: string; icon: string; color: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}><Icon name={icon} size={15} /></span>
          <span className="truncate text-sm font-bold text-txt">{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function MoneyRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-sm text-dim">{label}</span>
      <span className="shrink-0 font-mono text-sm font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function CmdAction({ href, icon, label, newTab }: { href: string; icon: string; label: string; newTab?: boolean }) {
  const cls = "flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-txt transition hover:border-focus hover:text-focus";
  const inner = <><Icon name={icon} size={16} />{label}{newTab && <span className="text-faint">↗</span>}</>;
  return newTab
    ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
    : <Link href={href} className={cls}>{inner}</Link>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function TodoGroup({ title, icon, color, items, tasks, done, onToggle, autoOf, guestName, getUnit, getStructure, openBooking, multi }: any) {
  const { t } = useLang();
  const renderItem = (b: any, showStruct: boolean) => {
    const st = getStructure?.(b.structureId);
    const stColor = st?.photoColor ?? "var(--faint)";
    return (
      <div key={b.id} className="rounded-lg border border-line py-2 pl-2.5 pr-2" style={{ borderLeft: `3px solid ${stColor}` }}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <button onClick={() => openBooking(b.id)} className="truncate text-sm font-semibold text-txt hover:text-focus hover:underline">{guestName(b.guestId)}</button>
          <span className="flex min-w-0 shrink items-center gap-1 text-xs text-dim">
            {showStruct && <span className="max-w-[90px] truncate font-medium" style={{ color: stColor }}>{st?.name}</span>}
            {showStruct && <span className="text-faint">·</span>}
            <span className="truncate">{getUnit(b.unitId)?.name ?? t("Da assegnare")}</span>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          {tasks.map((task: any) => {
            const key = `${b.id}:${task.id}`;
            const auto = autoOf?.(task.id) as string | null;
            if (auto) return (
              <div key={task.id} className="flex items-center gap-2 text-sm">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] text-white" style={{ backgroundColor: "var(--ok)" }}>✓</span>
                <span className="text-txt">{t(task.label)}</span>
                <span className="ml-auto rounded-full bg-[color:color-mix(in_srgb,var(--ok)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--ok)]">{t("auto")} · {auto}</span>
              </div>
            );
            const isDone = done.has(key);
            return (
              <label key={task.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={isDone} onChange={() => onToggle(key)} className="h-4 w-4 accent-[color:var(--ok)]" />
                <span className={isDone ? "text-faint line-through" : "text-txt"}>{t(task.label)}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  // Raggruppa per struttura (stesso stile delle liste movimenti) quando ci sono più strutture.
  const groups = multi ? (() => {
    const map = new Map<string, { s: any; list: any[] }>();
    for (const b of items) { if (!map.has(b.structureId)) map.set(b.structureId, { s: getStructure?.(b.structureId), list: [] }); map.get(b.structureId)!.list.push(b); }
    return [...map.values()].sort((a, b) => (a.s?.name ?? "").localeCompare(b.s?.name ?? "", "it"));
  })() : null;

  return (
    <Card>
      <ListHeader icon={icon} color={color}>{title} ({items.length})</ListHeader>
      {items.length === 0 ? (
        <div className="py-3 text-sm text-faint">{t("Niente in programma.")}</div>
      ) : groups && groups.length > 1 ? (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const col = g.s?.photoColor ?? "var(--faint)";
            return (
              <div key={g.s?.id ?? "x"} className="rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${col} 6%, transparent)` }}>
                <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1.5">
                  <span className="h-3.5 w-3.5 rounded-md" style={{ backgroundColor: col }} />
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color: col }}>{g.s?.name}</span>
                  <span className="text-[11px] text-faint">· {g.list.length}</span>
                </div>
                <div className="flex flex-col gap-2 px-1.5 pb-1.5">{g.list.map((b) => renderItem(b, false))}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">{items.map((b: any) => renderItem(b, multi))}</div>
      )}
    </Card>
  );
}

function StatusIcon({ icon, color, title }: { icon: string; color: string; title: string }) {
  return (
    <span title={title} className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
      <Icon name={icon} size={13} />
    </span>
  );
}

function ListHeader({ icon, color, children }: { icon: string; color: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
      <span style={{ color }}><Icon name={icon} size={15} /></span>
      {children}
    </div>
  );
}

function Kpi({ label, value, color, small, onClick, active }: { label: string; value: string; color: string; small?: boolean; onClick?: () => void; active?: boolean }) {
  const cls = `anim-in rounded-xl border bg-surface p-4 shadow-sm transition-transform hover:-translate-y-0.5 ${active ? "border-focus ring-2 ring-[color:var(--focus)]" : "border-line"} ${onClick ? "cursor-pointer text-left" : ""}`;
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-dim">{label}</div>
        {onClick && <Icon name={active ? "eye" : "chevron"} size={13} />}
      </div>
      <div className={`mt-1 font-mono font-bold tabular-nums ${small ? "text-lg" : "text-2xl"}`} style={{ color }}>{value}</div>
    </>
  );
  return onClick ? <button onClick={onClick} className={`${cls} w-full`}>{inner}</button> : <div className={cls}>{inner}</div>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function MoveList({ items, empty, groupByStructure, structures, guestName, getUnit, getStructure, openBooking, alloggiatiOk, payStatus }: any) {
  const { t } = useLang();
  if (!items.length) return <div className="py-4 text-sm text-faint">{empty}</div>;

  const PAY: Record<string, [string, string]> = {
    paid: ["var(--ok)", t("Pagato")],
    partial: ["var(--warn)", t("Acconto ricevuto · saldo da incassare")],
    unpaid: ["var(--err)", t("Da pagare")],
  };

  const rows = (list: any[]) => (
    <div className="flex flex-col gap-2">
      {list.map((b: any) => {
        const ch = CHANNELS[b.channel as keyof typeof CHANNELS];
        const alOk = alloggiatiOk?.(b) ?? false;
        const pay = (payStatus?.(b) ?? "unpaid") as "paid" | "partial" | "unpaid";
        const stColor = getStructure?.(b.structureId)?.photoColor ?? "var(--faint)";
        return (
          <button key={b.id} onClick={() => openBooking(b.id)} className="flex items-center justify-between gap-3 rounded-lg border border-line py-2 pl-2.5 pr-2 text-left transition hover:bg-wash" style={{ borderLeft: `3px solid ${stColor}` }}>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-txt">{guestName(b.guestId)}</div>
              <div className="flex items-center gap-1 truncate text-xs text-dim">{getUnit(b.unitId)?.name ?? t("Da assegnare")} · <span className="font-mono text-faint">{fmt(b.checkIn)} → {fmt(b.checkOut)}</span> · <span className="inline-flex items-center gap-0.5"><Icon name="users" size={12} />{b.adults + b.children}</span> · <span className="font-mono">{b.total ? eur(b.total) : "—"}</span></div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <StatusIcon icon="id" color={alOk ? "var(--ok)" : "var(--faint)"} title={alOk ? t("Schedina alloggiati pronta") : t("Schedina alloggiati da completare")} />
              <StatusIcon icon="card" color={PAY[pay][0]} title={PAY[pay][1]} />
              <span title={ch.label} className="inline-flex h-[22px] items-center rounded-md px-2 text-[10px] font-bold" style={{ backgroundColor: `var(${ch.cssVar})`, color: ch.text }}>{ch.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );

  if (groupByStructure) {
    const groups = structures.map((s: any) => ({ s, list: items.filter((i: any) => i.structureId === s.id) })).filter((g: any) => g.list.length);
    return (
      <div className="flex flex-col gap-3">
        {groups.map((g: any) => {
          const col = g.s.photoColor ?? "var(--faint)";
          return (
            <div key={g.s.id} className="rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${col} 6%, transparent)` }}>
              <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1.5">
                <span className="h-3.5 w-3.5 rounded-md" style={{ backgroundColor: col }} />
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: col }}>{g.s.name}</span>
                <span className="text-[11px] text-faint">· {g.list.length}</span>
              </div>
              <div className="px-1.5 pb-1.5">{rows(g.list)}</div>
            </div>
          );
        })}
      </div>
    );
  }
  return rows(items);
}
