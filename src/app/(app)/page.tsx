"use client";

// Dashboard (ex "Dashboard 2", ora la principale) = la dashboard di sempre (stesse sezioni, stessi dati, stessa logica, stesso ordine),
// con la grafica di "Prenotazioni · Dettagliata": card rounded-2xl, intestazioni con contatore, tessere KPI con tinta,
// righe alte con anteprima camera, pill/pallini di stato, barre di avanzamento sottili.
// Le sezioni sono nello stesso ordine della vecchia dashboard, che è stata eliminata.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/invoicing/client";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { CHANNELS, type Channel } from "@/lib/types";
import { toISO, parseISO, nights, addDays } from "@/lib/dates";
import { eur } from "@/lib/format";
import { exportExcel, exportPdf } from "@/lib/export";
import { journeyOf, isLiveBooking, type JourneyStep } from "@/lib/booking-journey";
import { isGuideSent, readReminders, reminderNotes, useReminderLog } from "@/lib/guest-messages";
import { PageHeader } from "@/components/ui";
import ScrollStrip from "@/components/ScrollStrip";
import Donut from "@/components/Donut";
import LineChart from "@/components/LineChart";
import ColumnChart from "@/components/ColumnChart";
import Bars from "@/components/Bars";
import ChannelBars from "@/components/ChannelBars";
import ChannelLogo from "@/components/ChannelLogo";
import Gauge from "@/components/Gauge";
import DensityChart from "@/components/DensityChart";
import DateField from "@/components/DateField";
import Icon from "@/components/Icon";
import SearchInput from "@/components/SearchInput";
import ExportMenu from "@/components/ExportMenu";
import WeatherWidget from "@/components/WeatherWidget";
import DayNotes from "@/components/DayNotes";
import StepActions from "@/app/(app)/prenotazioni/_azioni";
import { flagColor, flagGradient } from "@/lib/flags";
import { Bar, EmptyLine, EYEBROW, IconTile, KpiTile, Panel, PanelHead, Pill, RoomThumb, SectionHead, StructureLabel, tint } from "./_ui";
import { MoveList, TodoGroup } from "./_liste";

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
const DEFAULT_CHART_KEYS = ["occ-gauge", "occ-str", "guests-str", "ch-mix", "occ-trend", "rev-day", "prov-day", "rooms"];

// Azioni pulizia del giorno (stessa semantica della pagina Pulizie).
const CLEAN_ACT: Record<string, { label: string; color: string }> = {
  turnover: { label: "Turnover", color: "var(--err)" },
  partenza: { label: "Partenza", color: "var(--warn)" },
  arrivo: { label: "Arrivo", color: "var(--focus)" },
  riassetto: { label: "Riassetto", color: "var(--ok)" },
};

const GUIDE_RE = /guest-guide|\/guida|guida ospiti/i;
type StatoRow = { booking_id: string | null; stato: string };

export default function Dashboard2() {
  const router = useRouter();
  const { bookings, guests, units, structures, getUnit, getStructure, openBooking, activeStructureId } = useData();
  const { t } = useLang();
  const today = new Date();
  const todayISO = toISO(today);
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? t("Ospite");

  // Personalizzazione grafici Dashboard: quali nascondere (persistito nel browser). Minimo 4 visibili.
  const [hiddenCharts, setHiddenCharts] = useState<Set<string> | null>(null); // null = non ancora inizializzato
  const persistHidden = (next: Set<string>) => { setHiddenCharts(next); try { localStorage.setItem("spigolestay:dashcharts:v6", JSON.stringify([...next])); } catch {} };
  // Ordine dei grafici (riordino via drag&drop), persistito.
  const [chartOrder, setChartOrder] = useState<string[]>([]);
  const persistChartOrder = (o: string[]) => { setChartOrder(o); try { localStorage.setItem("spigolestay:dashchartorder:v3", JSON.stringify(o)); } catch {} };
  const [, setChartWarn] = useState("");
  const [, setChartMenuOpen] = useState(false);
  const chartMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (chartMenuRef.current && !chartMenuRef.current.contains(e.target as Node)) setChartMenuOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);

  // Stato "schedina alloggiati": pronta quando l'ospite ha tutti i dati documento (stessa logica di /alloggiati-web).
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

  // Badge "Sei in regola" — controllo REALE (non un valore finto) degli adempimenti PA del
  // periodo corrente: schedine Alloggiati pronte ma non ancora inviate (arrivo già avvenuto),
  // invii Alloggiati falliti di recente, movimenti ISTAT ancora da chiudere/inviare.
  const [paCompliance, setPaCompliance] = useState<{ pending: number; loading: boolean }>({ pending: 0, loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) { if (alive) setPaCompliance({ pending: 0, loading: false }); return; }
      const ids = sFilter === "all" ? structures.map((s) => s.id) : [sFilter];
      if (!ids.length) { if (alive) setPaCompliance({ pending: 0, loading: false }); return; }
      const monthAgo = toISO(addDays(today, -30));
      try {
        const [schedQ, errQ, istatQ] = await Promise.all([
          supabase.from("alloggiati_schedine").select("id", { count: "exact", head: true }).eq("stato", "pronta").lte("arrival", todayISO).in("structure_id", ids),
          supabase.from("alloggiati_submissions").select("id", { count: "exact", head: true }).eq("stato", "error").gte("created_at", monthAgo).in("structure_id", ids),
          supabase.from("istat_rows").select("id", { count: "exact", head: true }).eq("stato", "pending").lte("arrival", todayISO).in("structure_id", ids),
        ]);
        if (!alive) return;
        setPaCompliance({ pending: (schedQ.count ?? 0) + (errQ.count ?? 0) + (istatQ.count ?? 0), loading: false });
      } catch { if (alive) setPaCompliance({ pending: 0, loading: false }); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sFilter, structures.length, todayISO]);

  // Check-in online non completato per gli arrivi di oggi: la query sopra conta solo le schedine
  // già "pronte" (cioè già compilate), quindi un arrivo che deve ancora fare il check-in online
  // risultava "tutto a posto" qui pur comparendo come "da fare" in /adempimenti (Passo 1). Stessa
  // condizione usata lì (primaryDoneOf), calcolata lato client sugli arrivi di oggi.
  const checkinPending = bookings.filter((b) =>
    b.checkIn === todayISO && b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" &&
    (sFilter === "all" || b.structureId === sFilter) &&
    !(b.webCheckin === true || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber))
  ).length;

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
  // "blocked" = camera fuori servizio, non una prenotazione: va escluso qui come lo è già ovunque
  // altrove nel gestionale (Prenotazioni, Calendario, Statistiche…), altrimenti un blocco con
  // inizio oggi viene contato come un arrivo/partenza/presenza reale nelle KPI sopra.
  const active = bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked");
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
  // Dati unici per canale: prenotazioni + ricavi insieme (un solo grafico a barre)
  const channelRows = channels.map((c) => ({ label: CHANNELS[c].label, color: chColor(c), count: daySet.filter((b) => b.channel === c).length, revenue: Math.round(daySet.filter((b) => b.channel === c).reduce((a, b) => a + nightly(b), 0)) })).filter((r) => r.count > 0 || r.revenue > 0);
  // Prezzo a notte (ADR) per canale → density plot
  const priceByChannel = channels.map((c) => ({ label: CHANNELS[c].label, color: chColor(c), values: scoped.filter((b) => b.channel === c && b.total && nights(b.checkIn, b.checkOut) > 0).map((b) => Math.round((b.total ?? 0) / nights(b.checkIn, b.checkOut))) })).filter((s) => s.values.length > 0);

  // Occupazione per struttura (giorno selezionato) — a torta
  const occByStructureDay = structuresToShow.map((s, i) => {
    const su = scopedUnits.filter((u) => u.structureId === s.id);
    const occ = scoped.filter((b) => b.unitId && su.some((u) => u.id === b.unitId) && b.checkIn <= date && date < b.checkOut).length;
    return { label: s.name, value: occ, color: s.photoColor ?? PALETTE[i % PALETTE.length] };
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
  const guestsByStruct = structuresToShow.map((s, i) => ({ label: s.name, value: bsOfStruct(s).reduce((a, b) => a + b.adults + b.children, 0), color: s.photoColor ?? PALETTE[i % PALETTE.length] })).filter((x) => x.value > 0);
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
    { key: "rev-day", title: t("Incassi attesi · prossimi 7 giorni"), node: <ColumnChart bars={revDaily} format={(n) => eur(n)} />, extra: <span className="shrink-0 rounded-full bg-wash px-2.5 py-0.5 font-mono text-xs font-bold text-txt" title={t("Totale atteso sui 7 giorni")}>{eur(revTotal7)}</span> },
  ];
  // Di default sono VISIBILI i grafici principali; restano nascosti solo gli opzionali.
  const defaultHidden = () => new Set(dashCharts.map((c) => c.key).filter((k) => !DEFAULT_CHART_KEYS.includes(k)));
  useEffect(() => {
    try { const r = localStorage.getItem("spigolestay:dashcharts:v6"); if (r) setHiddenCharts(new Set(JSON.parse(r))); else setHiddenCharts(defaultHidden()); } catch { setHiddenCharts(defaultHidden()); }
    try { const o = localStorage.getItem("spigolestay:dashchartorder:v3"); if (o) setChartOrder(JSON.parse(o)); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hidden = hiddenCharts ?? defaultHidden();
  // Con una sola struttura selezionata i grafici "per struttura" non hanno senso: si nascondono da soli.
  const singleStruct = sFilter !== "all" || !multi;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartAvailable = (c: any) => !(singleStruct && c.perStructure);
  // Ordine: prima i 4 di default, poi gli altri; sopra si applica l'ordine scelto dall'utente (drag&drop).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRank = (c: any) => { const i = DEFAULT_CHART_KEYS.indexOf(c.key); return i < 0 ? 100 + dashCharts.findIndex((x) => x.key === c.key) : i; };
  const availCharts = dashCharts.filter(chartAvailable).sort((a, b) => chartRank(a) - chartRank(b));
  const shownCharts = availCharts.filter((c) => !hidden.has(c.key)).sort((a, b) => {
    const ia = chartOrder.indexOf(a.key), ib = chartOrder.indexOf(b.key);
    if (ia < 0 && ib < 0) return 0;
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
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

  // ===== Aggiunta non invasiva: passaggi della prenotazione + finestra "Risolvi" (stessa logica di Prenotazioni · Dettagliata) =====
  const [sched, setSched] = useState<StatoRow[]>([]);
  const [istat, setIstat] = useState<StatoRow[]>([]);
  const [docs, setDocs] = useState<StatoRow[]>([]);
  const [threads, setThreads] = useState<Record<string, { dir: string; text: string }[]>>({});
  const [rems, setRems] = useState<Record<string, Record<string, number>>>({});
  const [modal, setModal] = useState<{ id: string; key: string } | null>(null);
  const loadJourney = useCallback(async () => {
    try { setThreads(JSON.parse(localStorage.getItem("spigolestay:threads:v1") || "{}")); } catch { setThreads({}); }
    setRems(readReminders());
    if (!supabase) return;
    const [a, i, d] = await Promise.all([
      supabase.from("alloggiati_schedine").select("booking_id, stato"),
      supabase.from("istat_rows").select("booking_id, stato"),
      supabase.from("documents").select("booking_id, stato").not("booking_id", "is", null),
    ]);
    setSched((a.data ?? []) as StatoRow[]); setIstat((i.data ?? []) as StatoRow[]); setDocs((d.data ?? []) as StatoRow[]);
  }, []);
  useEffect(() => { void loadJourney(); }, [loadJourney]);
  useEffect(() => {
    const h = () => { void loadJourney(); };
    window.addEventListener("focus", h);
    window.addEventListener("spigolestay:datasync", h);
    window.addEventListener("spigolestay:reminders", h);
    window.addEventListener("spigolestay:threads", h);
    return () => { window.removeEventListener("focus", h); window.removeEventListener("spigolestay:datasync", h); window.removeEventListener("spigolestay:reminders", h); window.removeEventListener("spigolestay:threads", h); };
  }, [loadJourney]);
  const schedBy = useMemo(() => {
    const m = new Map<string, "da_validare" | "pronta" | "inviata">();
    const rank = { da_validare: 3, pronta: 2, inviata: 1 } as const;
    for (const s of sched) {
      if (!s.booking_id || !(s.stato in rank)) continue;
      const st = s.stato as keyof typeof rank;
      const cur = m.get(s.booking_id);
      if (!cur || rank[st] > rank[cur]) m.set(s.booking_id, st);
    }
    return m;
  }, [sched]);
  const istatBy = useMemo(() => {
    const m = new Map<string, "pending" | "sent">();
    for (const r of istat) {
      if (!r.booking_id || (r.stato !== "pending" && r.stato !== "sent")) continue;
      if (m.get(r.booking_id) !== "pending") m.set(r.booking_id, r.stato);
    }
    return m;
  }, [istat]);
  const docBy = useMemo(() => { const m = new Map<string, string>(); for (const d of docs) if (d.booking_id && d.stato !== "scartata") { const cur = m.get(d.booking_id); if (!cur || cur === "bozza") m.set(d.booking_id, d.stato); } /* un documento emesso batte la bozza */ return m; }, [docs]);
  const remLog = useReminderLog(bookings); // cronologia dei solleciti (da chat)
  const journeyFor = (b: (typeof bookings)[number]) => isLiveBooking(b) ? journeyOf(b, {
    today: todayISO, guest: guests.find((g) => g.id === b.guestId), structure: getStructure(b.structureId),
    schedina: schedBy.get(b.id) ?? "none", istat: istatBy.get(b.id) ?? "none",
    guideSent: isGuideSent(b, threads[b.guestId], remLog[b.id]),
    invoiceStato: docBy.get(b.id),
    reminderNotes: reminderNotes(remLog[b.id]),
  }) : null;
  // Un passaggio da fare apre "Risolvi"; uno già fatto porta alla pagina di dettaglio.
  const onStep = (b: { id: string }, s: JourneyStep) => {
    if (s.state !== "done" && s.state !== "na") setModal({ id: b.id, key: s.key });
    else if (s.href) router.push(s.href);
  };

  const listProps = { guestName, getStructure, openBooking, structures: structuresToShow, groupByStructure, alloggiatiOk, payStatus, journeyFor, onStep, date, today: todayISO };

  // Centro di comando: stato cross-modulo (dati salvati dalle altre sezioni).
  const relTime = (ts: number) => { const d = Math.floor((Date.now() - ts) / 60000); if (d < 1) return t("adesso"); if (d < 60) return `${d} ${t("min fa")}`; if (d < 1440) return `${Math.floor(d / 60)} ${t("h fa")}`; return `${Math.floor(d / 1440)} ${t("g fa")}`; };
  const [cc, setCc] = useState<{ invii: number; canali: number; tot: number; sync: string }>({ invii: 0, canali: 0, tot: 0, sync: "—" });
  useEffect(() => {
    try {
      const addD = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
      const tpls: { active: boolean; trigger: string; days: number }[] = JSON.parse(localStorage.getItem("spigolestay:msgtemplates") || "[]");
      let invii = 0;
      for (const t of tpls.filter((x) => x.active && x.trigger !== "manual")) for (const b of bookings) {
        if (b.status === "cancelled") continue;
        if (sFilter !== "all" && b.structureId !== sFilter) continue;
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
      setCc({ invii, canali: connected, tot: Object.keys(conn).length, sync: syncs.length ? relTime(Math.max(...syncs)) : t("mai") });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMap, sFilter]);
  // Stato canali REALE (Channex) per la struttura attiva: sostituisce il conteggio locale globale.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiPost<{ ok: boolean; byStructure?: Record<string, { channel: string; active: boolean }[]> }>("channex/status", {});
        if (!alive || !res?.ok || !res.byStructure) return;
        const lists = sFilter === "all" ? Object.values(res.byStructure) : [res.byStructure[sFilter] ?? []];
        const byCh: Record<string, boolean> = {};
        lists.flat().forEach((c) => { byCh[c.channel] = !!byCh[c.channel] || c.active; });
        const tot = Object.keys(byCh).length;
        if (tot > 0 || sFilter !== "all") setCc((p) => ({ ...p, canali: Object.values(byCh).filter(Boolean).length, tot }));
      } catch {}
    })();
    return () => { alive = false; };
  }, [sFilter]);

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
  // NB: check-in/schedina, saldo aperto e tassa sono ora gestiti in "Adempimenti oggi" (niente doppione):
  // qui restano solo gli alert operativi NON coperti dagli adempimenti.
  const alerts = [
    { n: alUnassigned.length, label: "arrivi senza camera assegnata", color: "var(--err)", href: "/prenotazioni" },
    { n: alOos.length, label: "camere fuori servizio", color: "var(--dim)", href: "/camere" },
  ].filter((a) => a.n > 0);
  // Riepilogo adempimenti del giorno (rimanda alla pagina dedicata): proxy lato client.
  const adempimentiCount = alCheckin.length + alBalance.length + alTax.length;

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

  const alertCount = alerts.length + (adempimentiCount ? 1 : 0);
  const channelsColor = cc.tot > 0 && cc.canali >= cc.tot ? "var(--ok)" : cc.canali > 0 ? "var(--warn)" : "var(--err)";

  return (
    <div>
      <PageHeader title={t("Dashboard")} subtitle={`${t("Riferito a")} ${parseISO(date).toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`} actions={<WeatherWidget compact />} />

      {/* KPI stato attuale — cliccabili per filtrare i movimenti sotto */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label={t("Prenotazioni attive")} value={String(activeSel)} color="var(--focus)" icon="clipboard" onClick={() => toggleFocus("attive")} active={focus === "attive"} />
        <KpiTile label={t("In struttura")} value={String(inHouseSel)} color="var(--ok)" icon="bed" onClick={() => toggleFocus("inhouse")} active={focus === "inhouse"} />
        <KpiTile label={t("Arrivi")} value={String(arrivalsSel)} color="var(--ok)" valueColor="var(--txt)" icon="login" onClick={() => toggleFocus("arrivi")} active={focus === "arrivi"} />
        <KpiTile label={t("Partenze")} value={String(departuresSel)} color="var(--warn)" icon="logout" onClick={() => toggleFocus("partenze")} active={focus === "partenze"} />
      </div>

      {/* KPI del giorno selezionato */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile small label={t("Camere occupate")} value={`${occNight}/${scopedUnits.length}`} color="var(--ok)" valueColor="var(--txt)" icon="bed" bar={{ pct: scopedUnits.length ? (occNight / scopedUnits.length) * 100 : 0 }} />
        <KpiTile small label={t("ADR (prezzo medio/notte)")} value={eur(adrDay)} color="var(--focus)" valueColor="var(--txt)" icon="tag" />
        <KpiTile small label={t("RevPAR (giorno)")} value={eur(revparDay)} color="var(--focus)" valueColor="var(--txt)" icon="chart" />
        <KpiTile small label={t("Incassi del giorno")} value={eur(dayRevenue)} color="var(--ok)" valueColor="var(--txt)" icon="card" />
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
                <Panel className="flex h-full flex-col">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-faint">{c.title}</span>
                    {"extra" in c ? c.extra : null}
                  </div>
                  <div className="flex-1">{c.node}</div>
                </Panel>
              ),
            }))}
          />
        </div>
      )}

      {/* Sezione giorno — la ricerca sta nella STESSA griglia dei KPI: larga quanto una card e allineata */}
      <div className="mt-6 mb-4 grid grid-cols-2 items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm lg:grid-cols-4">
        <SearchInput value={search} onChange={setSearch} placeholder={t("Cerca ospite…")} className="no-print col-span-2 w-full lg:col-span-1" />
        <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-3">
          <div className="no-print flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <button onClick={() => setDate(toISO(addDays(parseISO(date), -1)))} title={t("Giorno precedente")} className="grid h-9 w-9 place-items-center rounded-xl border border-line text-base leading-none text-dim transition hover:border-focus hover:text-focus">‹</button>
              <DateField value={date} onChange={setDate} className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-semibold transition hover:border-focus" />
              <button onClick={() => setDate(toISO(addDays(parseISO(date), 1)))} title={t("Giorno successivo")} className="grid h-9 w-9 place-items-center rounded-xl border border-line text-base leading-none text-dim transition hover:border-focus hover:text-focus">›</button>
            </div>
            {focus && <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-focus" style={{ backgroundColor: tint("var(--focus)", 12) }}>{t("Filtro")}: {focus === "attive" ? t("attive") : focus === "inhouse" ? t("in struttura") : focus === "arrivi" ? t("arrivi") : t("partenze")}</span>}
            {hasFilters && <button onClick={() => { setSearch(""); setDate(todayISO); setFocus(null); }} className="rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:bg-wash" style={{ borderColor: "var(--err)", color: "var(--err)" }}>{t("Rimuovi filtri")}</button>}
          </div>
          <div className="no-print ml-auto flex items-center gap-2">
            {/* Toggle grafici: un click mostra tutti / nasconde tutti (neutro) */}
            <button onClick={() => (shownCharts.length > 0 ? hideAllCharts() : showAllCharts())} title={shownCharts.length > 0 ? t("Nascondi i grafici") : t("Mostra i grafici")} className={`grid h-9 w-9 place-items-center rounded-xl border border-line transition ${shownCharts.length > 0 ? "bg-wash text-txt" : "text-dim hover:border-focus hover:text-focus"}`}>
              <Icon name="chart" size={16} />
            </button>
            <ExportMenu onExcel={doExcel} onPdf={exportPdf} />
          </div>
        </div>
      </div>

      <ComplianceBanner pending={paCompliance.pending + checkinPending} checkinPending={checkinPending} loading={paCompliance.loading} />

      <div className={`grid gap-4 ${gridCols}`}>
        {showInhouse && (
          <Panel hover={false}>
            <PanelHead icon="bed" color="var(--focus)" title={t("In struttura")} count={inHouse.length} />
            <MoveList items={inHouse} kind="stay" empty={t("Nessun ospite presente")} {...listProps} />
          </Panel>
        )}
        {showPart && (
          <Panel hover={false}>
            <PanelHead icon="logout" color="var(--err)" title={t("Partenze")} count={departures.length} />
            <MoveList items={departures} kind="dep" empty={t("Nessuna partenza")} {...listProps} />
          </Panel>
        )}
        {showArr && (
          <Panel hover={false}>
            <PanelHead icon="login" color="var(--ok)" title={t("Arrivi")} count={arrivals.length} />
            <MoveList items={arrivals} kind="arr" empty={t("Nessun arrivo")} {...listProps} />
          </Panel>
        )}
      </div>

      {/* Checklist del giorno */}
      {(() => {
        const todoArr = arrivals;
        const todoDep = departures;
        const todoStay = inHouse;
        const planningKey = sFilter === "all" ? `planning:${date}` : `planning:${sFilter}:${date}`; // un'attività per struttura
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
            <SectionHead
              title={t("Da fare oggi")}
              right={<Link href="/messaggi?tab=modelli" className="flex items-center gap-1.5 rounded-xl border border-focus px-3 py-1.5 text-xs font-semibold text-focus transition hover:shadow-md" style={{ backgroundColor: tint("var(--focus)", 10) }}>{t("Gestisci automazioni")} →</Link>}
            >
              <span className="rounded-full bg-wash px-2.5 py-0.5 font-mono text-xs font-bold text-dim">{doneCount}/{keys.length} <span className="font-sans font-medium">{t("completate")}</span></span>
              <Bar pct={keys.length ? (doneCount / keys.length) * 100 : 0} color="var(--ok)" className="w-40" />
            </SectionHead>

            <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-sm shadow-sm transition hover:border-focus hover:shadow-md">
              <input type="checkbox" checked={planningDone} onChange={() => toggleTodo(planningKey)} className="h-4 w-4 shrink-0 cursor-pointer accent-[color:var(--ok)]" />
              <IconTile icon="sparkles" color="var(--warn)" size="sm" />
              <span className={planningDone ? "text-faint line-through" : "font-semibold text-txt"}>{t("Inviare il planning alla signora delle pulizie")}</span>
            </label>
            <div className="grid gap-4 lg:grid-cols-3">
              <TodoGroup title={t("In struttura")} icon="bed" color="var(--focus)" items={todoStay} tasks={INHOUSE_TASKS} done={todoDone} onToggle={toggleTodo} autoOf={autoOf} guestName={guestName} getUnit={getUnit} getStructure={getStructure} multi={multi} openBooking={openBooking} />
              <TodoGroup title={t("Partenze")} icon="logout" color="var(--err)" items={todoDep} tasks={DEPARTURE_TASKS} done={todoDone} onToggle={toggleTodo} autoOf={autoOf} guestName={guestName} getUnit={getUnit} getStructure={getStructure} multi={multi} openBooking={openBooking} />
              <TodoGroup title={t("Arrivi")} icon="login" color="var(--ok)" items={todoArr} tasks={ARRIVAL_TASKS} done={todoDone} onToggle={toggleTodo} autoOf={autoOf} guestName={guestName} getUnit={getUnit} getStructure={getStructure} multi={multi} openBooking={openBooking} />
            </div>
          </div>
        );
      })()}

      {/* Panoramica operativa */}
      <div className="mt-8">
        <SectionHead title={t("Panoramica operativa")} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Da controllare */}
          <OpsCard title={t("Da controllare")} icon="eye" color={(alerts.length || adempimentiCount) ? "var(--warn)" : "var(--ok)"} right={(alerts.length || adempimentiCount) ? <Pill color="var(--warn)">{alertCount} {t("avvisi")}</Pill> : <Pill color="var(--ok)">{t("ok")}</Pill>}>
            <div className="flex flex-col gap-2">
              {/* Riepilogo adempimenti PA/fiscali → pagina dedicata (evita doppioni sulla dashboard) */}
              <Link href="/adempimenti" className="flex items-center gap-3 rounded-xl border p-2.5 transition hover:border-focus hover:bg-wash" style={{ borderColor: adempimentiCount ? "color-mix(in srgb, var(--focus) 45%, var(--line))" : "var(--line)" }}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg font-mono text-sm font-bold" style={{ backgroundColor: tint(adempimentiCount ? "var(--focus)" : "var(--ok)", 16), color: adempimentiCount ? "var(--focus)" : "var(--ok)" }}>{adempimentiCount || "✓"}</span>
                <span className="min-w-0 flex-1 text-sm font-semibold text-txt">{t("Adempimenti oggi")}{adempimentiCount ? ` · ${t("da gestire")}` : ` · ${t("tutto in ordine")}`}</span>
                <span className="text-faint"><Icon name="chevron" size={14} /></span>
              </Link>
              {alerts.map((a, i) => (
                <Link key={i} href={a.href} className="flex items-center gap-3 rounded-xl border border-line p-2.5 transition hover:border-focus hover:bg-wash">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg font-mono text-sm font-bold" style={{ backgroundColor: tint(a.color, 16), color: a.color }}>{a.n}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-txt">{t(a.label)}</span>
                  <span className="text-faint"><Icon name="chevron" size={14} /></span>
                </Link>
              ))}
            </div>
          </OpsCard>

          {/* Pulizie di oggi */}
          <OpsCard title={t("Pulizie di oggi")} icon="sparkles" color="#0891B2" count={cleanRooms.length} right={<Link href="/pulizie" className="text-[11px] font-semibold text-focus hover:underline">{t("Apri")} →</Link>}>
            {cleanRooms.length === 0 ? (
              <EmptyLine icon="sparkles">{t("Nessuna camera da preparare oggi.")}</EmptyLine>
            ) : (
              <div className="flex flex-col gap-3">
                {turnoverCount > 0 && (
                  <div className="rounded-xl px-3 py-2 text-xs font-semibold text-[color:var(--err)]" style={{ backgroundColor: tint("var(--err)", 12) }}>⚡ {turnoverCount} {t("turnover · check-out e check-in nella stessa camera")}</div>
                )}
                {cleanByStruct.map((g) => (
                  <div key={g.s.id}>
                    <StructureLabel name={g.s.name} color={g.s.photoColor} count={g.list.length} />
                    <div className="flex flex-col gap-2">
                      {g.list.map((r) => {
                        const a = CLEAN_ACT[r.action];
                        return (
                          <div key={r.u.id} className="flex gap-2.5 rounded-xl border border-line p-2 transition hover:border-focus">
                            <RoomThumb unitId={r.u.id} structureId={r.u.structureId} compact className="h-12 w-12 rounded-lg" />
                            <div className="min-w-0 flex-1">
                              <div className="mb-0.5 flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium text-txt">{r.u.name}</span>
                                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: tint(a.color, 14), color: a.color }}>{t(a.label)}</span>
                              </div>
                              {r.dep && (
                                <button onClick={() => openBooking(r.dep!.id)} className="flex w-full items-center gap-1.5 text-left text-xs text-dim hover:text-focus">
                                  <Icon name="logout" size={12} /><span className="truncate font-medium">{guestName(r.dep.guestId)}</span>
                                  <span className="shrink-0 text-faint">· {np(r.dep)} {t("osp")} · out {fmt(r.dep.checkOut)}</span>
                                </button>
                              )}
                              {r.arr && (
                                <button onClick={() => openBooking(r.arr!.id)} className="flex w-full items-center gap-1.5 text-left text-xs text-dim hover:text-focus">
                                  <Icon name="login" size={12} /><span className="truncate font-medium">{guestName(r.arr.guestId)}</span>
                                  <span className="shrink-0 text-faint">· {np(r.arr)} {t("osp")} · in {r.arr.arrivalTime || fmt(r.arr.checkIn)}</span>
                                </button>
                              )}
                              {r.action === "riassetto" && r.stay && (
                                <button onClick={() => openBooking(r.stay!.id)} className="flex w-full items-center gap-1.5 text-left text-xs text-dim hover:text-focus">
                                  <Icon name="bed" size={12} /><span className="truncate font-medium">{guestName(r.stay.guestId)}</span>
                                  <span className="shrink-0 text-faint">· {np(r.stay)} {t("osp")} · {t("in casa fino al")} {fmt(r.stay.checkOut)}</span>
                                </button>
                              )}
                            </div>
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
          <OpsCard title={t("Ospiti speciali oggi")} icon="sparkles" color="#7C3AED" right={<span className={EYEBROW}>{t("arrivi")}</span>}>
            {(() => {
              const rows: { id: string; name: string; badge: string; col: string; icon?: string }[] = [];
              arrBirthday.forEach((b) => rows.push({ id: b.id, name: guestName(b.guestId), badge: t("compleanno"), col: "#DB2777", icon: "cake" }));
              arrReturning.forEach((b) => { if (!rows.some((r) => r.id === b.id)) rows.push({ id: b.id, name: guestName(b.guestId), badge: t("ospite di ritorno"), col: "var(--ok)" }); });
              arrToday.filter((b) => guestOf(b.guestId)?.vip).forEach((b) => { if (!rows.some((r) => r.id === b.id)) rows.push({ id: b.id, name: guestName(b.guestId), badge: "VIP", col: "#7C3AED" }); });
              arrToday.filter((b) => guestOf(b.guestId)?.tags?.includes("Animali")).forEach((b) => rows.push({ id: b.id + "-pet", name: guestName(b.guestId), badge: t("con animali"), col: "#0891B2", icon: "paw" }));
              return rows.length === 0 ? (
                <EmptyLine icon="sparkles">{t("Nessuna segnalazione tra gli arrivi di oggi.")}</EmptyLine>
              ) : (
                <div className="flex flex-col gap-2">
                  {rows.slice(0, 6).map((r, i) => (
                    <div key={r.id + i} className="flex items-center gap-2.5 rounded-xl border border-line p-2 text-sm">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold" style={{ backgroundColor: tint(r.col, 14), color: r.col }}>{r.icon ? <Icon name={r.icon} size={15} /> : (r.name.trim()[0] ?? "?").toUpperCase()}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-txt">{r.name}</span>
                      <Pill color={r.col} icon={r.icon}>{r.badge}</Pill>
                    </div>
                  ))}
                </div>
              );
            })()}
          </OpsCard>

          {/* Stato canali */}
          <OpsCard title={t("Stato canali OTA")} icon="share" color="#5B74E6" right={<Link href="/canali" className="text-[11px] font-semibold text-focus hover:underline">{t("Gestisci")} →</Link>}>
            <div className="flex items-center gap-4">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: channelsColor, boxShadow: `0 0 0 5px ${tint(channelsColor, 18)}` }} />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-2xl font-bold leading-none tabular-nums text-txt">{cc.canali}{cc.tot > 0 ? <span className="text-base text-faint">/{cc.tot}</span> : ""} <span className="font-sans text-sm font-medium text-dim">{t("connessi")}</span></div>
                {cc.tot > 0 && <Bar pct={(cc.canali / cc.tot) * 100} color={channelsColor} className="mt-2.5" />}
                <div className="mt-1.5 text-[11px] text-faint">{t("ultima sincronizzazione")} · {cc.sync}</div>
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
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <div>
                <div className="font-mono text-2xl font-bold leading-none tabular-nums text-txt">{eur(revMonth)}</div>
                <div className="mt-1.5 text-[11px] text-faint">{t("ricavi confermati")} · {bkOfMonth} {t("prenotazioni")}</div>
              </div>
              {revMonthDelta !== null && (
                <span className="mb-1 rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ backgroundColor: tint(revMonthDelta >= 0 ? "var(--ok)" : "var(--err)", 14), color: revMonthDelta >= 0 ? "var(--ok)" : "var(--err)" }}>{revMonthDelta >= 0 ? "+" : ""}{revMonthDelta}% {t("vs mese prec.")}</span>
              )}
            </div>
          </OpsCard>

          {/* Attività recente */}
          <OpsCard title={t("Attività recente")} icon="clipboard" color="var(--dim)" right={<span className={EYEBROW}>{t("ultime")}</span>}>
            {feed.length === 0 ? (
              <EmptyLine icon="clipboard">{t("Nessuna attività.")}</EmptyLine>
            ) : (
              <div className="flex flex-col gap-1">
                {feed.map((b) => {
                  const cancelled = b.status === "cancelled";
                  const col = cancelled ? "var(--err)" : "var(--ok)";
                  return (
                    <button key={b.id} onClick={() => openBooking(b.id)} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-wash">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold" style={{ backgroundColor: tint(col, 16), color: col }}>{cancelled ? "✕" : "+"}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-txt">{guestName(b.guestId)}</span>
                      <span className="grid w-[18px] shrink-0 place-items-center">{b.channel !== "blocked" && <ChannelLogo channel={b.channel} size={18} />}</span>
                      <span className="w-12 shrink-0 text-right text-[11px] text-faint">{b.bookedOn ? fmt(b.bookedOn) : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </OpsCard>

          {/* Promemoria (componente condiviso: qui ne adatto solo contenitore e raggio) */}
          <div className="[&>div]:rounded-2xl [&>div]:p-4 [&>div]:transition [&>div]:hover:border-focus [&>div]:hover:shadow-md sm:[&>div]:p-5"><DayNotes /></div>
        </div>
      </div>

      {/* Finestra "Risolvi" per i passaggi non completati (aggiunta non invasiva) */}
      {modal && (() => {
        const mb = bookings.find((x) => x.id === modal.id);
        const mj = mb ? journeyFor(mb) : null;
        const ms = mj?.steps.find((x) => x.key === modal.key);
        if (!mb || !mj || !ms) return null;
        return (
          <StepActions
            key={`${modal.id}:${modal.key}`}
            b={mb} step={ms}
            guest={guests.find((g) => g.id === mb.guestId)} structure={getStructure(mb.structureId)}
            checkinDone={mj.steps.find((x) => x.key === "checkin")?.state === "done"}
            schedina={schedBy.get(mb.id) ?? "none"} istat={istatBy.get(mb.id) ?? "none"}
            paySentInChat={(threads[mb.guestId] ?? []).some((m) => m.dir === "out" && m.text.includes("chat-pay/go"))}
            onClose={() => setModal(null)} onSwitch={(key) => setModal({ id: modal.id, key })} onChanged={() => { void loadJourney(); }}
          />
        );
      })()}
    </div>
  );
}

// Banner "Sei in regola" (verde) / avviso adempimenti PA in sospeso (ambra) — link a /adempimenti.
// `pending` arriva da un controllo reale su Supabase (schedine Alloggiati + ISTAT), non da un valore finto.
function ComplianceBanner({ pending, checkinPending, loading }: { pending: number; checkinPending: number; loading: boolean }) {
  const { t } = useLang();
  if (loading) return null;
  const ok = pending === 0;
  const color = ok ? "var(--ok)" : "var(--warn)";
  return (
    <Link
      href="/adempimenti"
      className="anim-in mb-4 flex items-center gap-3.5 rounded-2xl border p-4 shadow-sm transition hover:border-focus hover:shadow-md"
      style={{
        borderColor: `color-mix(in srgb, ${color} 30%, var(--line))`,
        backgroundColor: `color-mix(in srgb, ${color} 6%, var(--surface))`,
      }}
    >
      <IconTile icon={ok ? "id" : "alertTriangle"} color={color} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold" style={{ color }}>{ok ? t("Sei in regola con gli adempimenti") : t("Adempimenti PA in sospeso")}</div>
        <div className="truncate text-xs text-dim">
          {ok
            ? t("Nessuna schedina Alloggiati o movimento ISTAT in attesa.")
            : checkinPending
              ? `${checkinPending} ${t("check-in online da completare")}${pending - checkinPending > 0 ? ` · ${pending - checkinPending} ${t("tra schedine e ISTAT")}` : ""}`
              : `${pending} ${t("tra schedine Alloggiati e movimenti ISTAT da controllare")}`}
        </div>
      </div>
      {!ok && <span className="shrink-0 rounded-full px-2.5 py-0.5 font-mono text-sm font-bold" style={{ backgroundColor: tint(color, 16), color }}>{pending}</span>}
      <span className="shrink-0 text-faint"><Icon name="chevron" size={16} /></span>
    </Link>
  );
}

function OpsCard({ title, icon, color, right, count, children }: { title: string; icon: string; color: string; right?: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <Panel>
      <PanelHead icon={icon} color={color} title={title} count={count} right={right} />
      {children}
    </Panel>
  );
}

function MoneyRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: tint(color, 8) }}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="min-w-0 truncate text-sm text-dim">{label}</span>
      </span>
      <span className="shrink-0 font-mono text-sm font-bold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}
