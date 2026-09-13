"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { bookingCode } from "@/lib/bookingCode";
import { CHANNELS, type Channel } from "@/lib/types";
import { nights, parseISO, toISO } from "@/lib/dates";
import { eur } from "@/lib/format";
import { exportExcel, exportPdf } from "@/lib/export";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import ScrollStrip from "@/components/ScrollStrip";
import Donut from "@/components/Donut";
import ChannelBars from "@/components/ChannelBars";
import Bars from "@/components/Bars";
import ColumnChart from "@/components/ColumnChart";
import LineChart from "@/components/LineChart";
import DateField from "@/components/DateField";
import { flagColor, flagGradient } from "@/lib/flags";
import Icon from "@/components/Icon";
import ExportMenu from "@/components/ExportMenu";
import ChannelLogo from "@/components/ChannelLogo";
import WeatherWidget from "@/components/WeatherWidget";
import { useLang } from "@/lib/i18n";

const fmt = (iso: string) => parseISO(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" });

export default function PrenotazioniPage() {
  const { t } = useLang();
  const { bookings, guests, units, roomTypes, structures, getUnit, getStructure, openBooking, openNewBooking, activeStructureId } = useData();
  // Nome ospite: dal collegamento se presente, altrimenti dallo snapshot salvato sulla prenotazione
  // (es. dopo l'eliminazione dell'anagrafica ospite il guestId resta vuoto ma primaryGuest conserva i dati).
  const guestName = (b: { guestId: string; primaryGuest?: { firstName?: string; lastName?: string } }) => {
    const g = guests.find((x) => x.id === b.guestId);
    if (g?.fullName?.trim()) return g.fullName.trim();
    if (g && (g.firstName || g.lastName)) return `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim();
    const p = b.primaryGuest;
    if (p && (p.firstName || p.lastName)) return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    return "";
  };
  // Etichetta camera: tipologia + numero, senza la parola "Camera" (es. "Tripla · 2").
  const unitLabel = (b: { unitId: string | null }): string | null => {
    const u = getUnit(b.unitId);
    if (!u) return null;
    const num = u.name.replace(/^camera\s*/i, "");
    const rt = roomTypes.find((r) => r.id === u.roomTypeId);
    return rt ? `${rt.name} · ${num}` : num;
  };

  // Stato schedina alloggiati (dati documento completi) e pagamento (incassato vs dovuto) — come in Dashboard.
  const alloggiatiOk = (b: { guestId: string }) => {
    const g = guests.find((x) => x.id === b.guestId);
    return !!(g && (g.lastName || g.fullName) && g.sex && g.birthDate && g.birthPlace && g.citizenship && g.docType && g.docNumber);
  };
  const payStatus = (b: { total?: number; cleaningFee?: number; paid?: number }): "paid" | "partial" | "unpaid" => {
    const due = (b.total ?? 0) + (b.cleaningFee ?? 0);
    const paid = b.paid ?? 0;
    if (due > 0 && paid >= due) return "paid";
    if (paid > 0) return "partial";
    return "unpaid";
  };
  const PAY_META: Record<string, [string, string]> = {
    paid: ["var(--ok)", "Pagato"],
    partial: ["var(--warn)", "Acconto ricevuto · saldo da incassare"],
    unpaid: ["var(--err)", "Da pagare"],
  };
  const PALETTE = ["#BE5D38", "#7A8450", "#C08A3A", "#957A66", "#4F8A5B", "#5B74E6", "#B3453A"];

  const [q, setQ] = useState("");
  const [channel, setChannel] = useState<string>("all");
  const [loc, setLoc] = useState<string>("all"); // "all" | "str:<id>" | "unit:<id>"
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dateField, setDateField] = useState<"arrivo" | "prenotazione">("arrivo");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "checkIn", dir: "asc" });
  const toggleSort = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  // Selettore grafici (icona prima di "Nuova")
  const [hiddenPren, setHiddenPren] = useState<Set<string> | null>(null);
  const persistPren = (n: Set<string>) => { setHiddenPren(n); try { localStorage.setItem("spigolestay:prenchart:v2", JSON.stringify([...n])); } catch {} };
  // Ordine dei grafici (riordino via drag&drop), persistito.
  const [chartOrder, setChartOrder] = useState<string[]>([]);
  const persistChartOrder = (o: string[]) => { setChartOrder(o); try { localStorage.setItem("spigolestay:prenchartorder", JSON.stringify(o)); } catch {} };
  const [chartMenu, setChartMenu] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (chartRef.current && !chartRef.current.contains(e.target as Node)) setChartMenu(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:prenchart:v2"); if (r) setHiddenPren(new Set(JSON.parse(r))); } catch {} try { const o = localStorage.getItem("spigolestay:prenchartorder"); if (o) setChartOrder(JSON.parse(o)); } catch {} }, []);

  const now = new Date();
  const todayISO = toISO(now);
  const pastActive = !!(from && from < todayISO); // stiamo guardando lo storico

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return bookings.filter((b) => {
      // Di default mostra solo le prenotazioni in corso o future; con un filtro data attivo si vede anche lo storico.
      if (!from && !to && b.checkOut < todayISO) return false;
      // Filtro globale struttura (selettore in alto a destra)
      if (activeStructureId !== "all" && b.structureId !== activeStructureId) return false;
      if (term && !guestName(b).toLowerCase().includes(term) && !b.id.toLowerCase().includes(term) && !bookingCode(b).toLowerCase().includes(term)) return false;
      if (channel !== "all" && b.channel !== channel) return false;
      if (loc.startsWith("str:") && b.structureId !== loc.slice(4)) return false;
      if (loc.startsWith("unit:") && b.unitId !== loc.slice(5)) return false;
      const df = dateField === "arrivo" ? b.checkIn : (b.bookedOn ?? "");
      if (from && (!df || df < from)) return false;
      if (to && (!df || df > to)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, q, channel, activeStructureId, loc, from, to, dateField, todayISO]);

  const structuresToShow = structures.filter((s) => activeStructureId === "all" || s.id === activeStructureId);
  const hasFilters = !!(q || channel !== "all" || loc !== "all" || from || to);
  const clearFilters = () => { setQ(""); setChannel("all"); setLoc("all"); setFrom(""); setTo(""); };

  // % commissione: quella specifica della prenotazione, altrimenti il default del canale.
  const commissionPctOf = (b: { channel: Channel; commissionPct?: number }) => b.commissionPct ?? CHANNELS[b.channel].commission * 100;
  const commissionOf = (b: { total?: number; channel: Channel; commissionPct?: number }) => Math.round((b.total ?? 0) * commissionPctOf(b) / 100);
  const nettoOf = (b: { total?: number; channel: Channel; commissionPct?: number }) => (b.total ?? 0) - commissionOf(b);

  // Ordinamento tabella
  const sortVal = (b: (typeof filtered)[number], key: string): string | number => {
    switch (key) {
      case "id": return b.id;
      case "bookedOn": return b.bookedOn ?? "";
      case "struttura": return getStructure(b.structureId)?.name ?? "";
      case "camera": return getUnit(b.unitId)?.name ?? "";
      case "canale": return CHANNELS[b.channel].label;
      case "ospite": return guestName(b).toLowerCase();
      case "pax": return b.adults + b.children;
      case "checkIn": return b.checkIn;
      case "checkOut": return b.checkOut;
      case "notti": return nights(b.checkIn, b.checkOut);
      case "totale": return b.total ?? 0;
      case "commissioni": return commissionOf(b);
      case "netto": return nettoOf(b);
      default: return "";
    }
  };
  const sorted = [...filtered].sort((a, b) => {
    const va = sortVal(a, sort.key), vb = sortVal(b, sort.key);
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sort.dir === "asc" ? c : -c;
  });

  // Raggruppa in un'unica riga le prenotazioni con lo stesso groupId (prenotazione di più camere).
  const [groupOpen, setGroupOpen] = useState<Set<string>>(() => new Set());
  const toggleGroup = (gid: string) => setGroupOpen((s) => { const n = new Set(s); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; });
  const displayList = (() => {
    const seen = new Set<string>();
    const out: ({ kind: "single"; b: typeof sorted[number] } | { kind: "group"; gid: string; members: typeof sorted })[] = [];
    for (const b of sorted) {
      if (b.groupId) {
        if (seen.has(b.groupId)) continue;
        seen.add(b.groupId);
        const members = sorted.filter((x) => x.groupId === b.groupId);
        if (members.length > 1) { out.push({ kind: "group", gid: b.groupId, members }); continue; }
      }
      out.push({ kind: "single", b });
    }
    return out;
  })();
  const gSum = (ms: typeof sorted, f: (b: typeof sorted[number]) => number) => ms.reduce((a, b) => a + f(b), 0);
  // Celle di una riga prenotazione (riusate per righe singole e per le camere di un gruppo).
  const renderCells = (b: typeof sorted[number], indent = false) => {
    const ch = CHANNELS[b.channel]; const alOk = alloggiatiOk(b); const pay = payStatus(b);
    return (<>
      <td className="px-3 py-2.5 font-mono text-xs text-dim">{bookingCode(b)}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-dim">{b.bookedOn ? fmt(b.bookedOn) : "—"}</td>
      {activeStructureId === "all" && <td className="px-3 py-2.5 text-dim"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: getStructure(b.structureId)?.photoColor ?? "var(--faint)" }} /><span className="truncate">{getStructure(b.structureId)?.name}</span></span></td>}
      <td className={`whitespace-nowrap px-3 py-2.5 text-dim ${indent ? "pl-8" : ""}`}>{indent && <span className="text-faint">↳ </span>}{unitLabel(b) ?? <span className="italic font-medium text-[color:var(--err)]">{t("Da assegnare")}</span>}</td>
      <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><ChannelLogo channel={b.channel} size={16} title={ch.label} /><span className="text-xs text-dim">{ch.label}</span></span></td>
      <td className="px-3 py-2.5 font-medium text-txt">{guestName(b)}</td>
      <td className="px-3 py-2.5 font-mono text-dim">{b.adults + b.children}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-dim">{fmt(b.checkIn)}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-dim">{fmt(b.checkOut)}</td>
      <td className="px-3 py-2.5 font-mono text-dim">{nights(b.checkIn, b.checkOut)}</td>
      <td className="px-3 py-2.5 font-mono font-semibold text-txt">{b.total ? eur(b.total) : "—"}</td>
      <td className="px-3 py-2.5 font-mono text-dim">{commissionOf(b) ? <>{eur(commissionOf(b))} <span className="text-faint">({commissionPctOf(b)}%)</span></> : "—"}</td>
      <td className="px-3 py-2.5 font-mono font-semibold text-[color:var(--ok)]">{b.total ? eur(nettoOf(b)) : "—"}</td>
      <td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><StatusIcon icon="id" color={alOk ? "var(--ok)" : "var(--faint)"} title={alOk ? t("Schedina alloggiati pronta") : t("Schedina alloggiati da completare")} /><StatusIcon icon="card" color={PAY_META[pay][0]} title={t(PAY_META[pay][1])} /></div></td>
    </>);
  };

  // Riepiloghi sui risultati filtrati (card + mini-grafico).
  const revenue = filtered.reduce((a, b) => a + (b.total ?? 0), 0);
  const commissionTot = filtered.reduce((a, b) => a + commissionOf(b), 0);
  const nettoTot = revenue - commissionTot;
  const nightsTot = filtered.reduce((a, b) => a + nights(b.checkIn, b.checkOut), 0);
  const guestsTot = filtered.reduce((a, b) => a + b.adults + b.children, 0);
  const avgPrice = nightsTot ? revenue / nightsTot : 0;

  // Dati grafici (sui risultati filtrati)
  const chColor = (c: Channel) => `var(${CHANNELS[c].cssVar})`;
  const byChannel = (Object.keys(CHANNELS) as Channel[]).filter((c) => c !== "blocked").map((c) => ({ label: CHANNELS[c].label, value: filtered.filter((b) => b.channel === c).length, color: chColor(c) })).filter((x) => x.value > 0);
  const byStructure = structures.map((s, i) => ({ label: s.name, value: filtered.filter((b) => b.structureId === s.id).length, color: PALETTE[i % PALETTE.length] })).filter((x) => x.value > 0);
  const revByChannel = (Object.keys(CHANNELS) as Channel[]).filter((c) => c !== "blocked").map((c) => ({ label: CHANNELS[c].label, value: filtered.filter((b) => b.channel === c).reduce((a, b) => a + (b.total ?? 0), 0), color: chColor(c) })).filter((x) => x.value > 0);
  // Dati unici per canale: prenotazioni + ricavi insieme (un solo grafico)
  const channelRows = (Object.keys(CHANNELS) as Channel[]).filter((c) => c !== "blocked").map((c) => ({ label: CHANNELS[c].label, color: chColor(c), count: filtered.filter((b) => b.channel === c).length, revenue: Math.round(filtered.filter((b) => b.channel === c).reduce((a, b) => a + (b.total ?? 0), 0)) })).filter((r) => r.count > 0 || r.revenue > 0);
  const revByStructure = structures.map((s) => ({ label: s.name, value: filtered.filter((b) => b.structureId === s.id).reduce((a, b) => a + (b.total ?? 0), 0), color: "var(--ok)", fmt: eur })).filter((x) => x.value > 0);
  // Dati unici per struttura: prenotazioni + ricavi insieme (un solo grafico)
  const structureRows = structures.map((s, i) => ({ label: s.name, color: PALETTE[i % PALETTE.length], count: filtered.filter((b) => b.structureId === s.id).length, revenue: Math.round(filtered.filter((b) => b.structureId === s.id).reduce((a, b) => a + (b.total ?? 0), 0)) })).filter((r) => r.count > 0 || r.revenue > 0);
  const stayBuckets: Record<string, number> = { "1 notte": 0, "2 notti": 0, "3 notti": 0, "4+ notti": 0 };
  filtered.forEach((b) => { const n = nights(b.checkIn, b.checkOut); if (n <= 1) stayBuckets["1 notte"]++; else if (n === 2) stayBuckets["2 notti"]++; else if (n === 3) stayBuckets["3 notti"]++; else stayBuckets["4+ notti"]++; });
  const STAY_GREENS = ["#2F9E6F", "#57B98A", "#8DD3B0", "#C3E8D6"];
  const stayDist = Object.entries(stayBuckets).map(([k, v], i) => ({ label: k, value: v, color: STAY_GREENS[i % STAY_GREENS.length] }));
  const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const monthAgg: Record<number, number> = {};
  const revMonthAgg: Record<number, number> = {};
  filtered.forEach((b) => { const mo = parseISO(b.checkIn).getMonth(); monthAgg[mo] = (monthAgg[mo] || 0) + 1; revMonthAgg[mo] = (revMonthAgg[mo] || 0) + (b.total ?? 0); });
  const byMonth = Object.keys(monthAgg).map(Number).sort((a, b) => a - b).map((mo) => ({ label: MONTHS[mo], value: monthAgg[mo], color: "#C2683C" }));
  const revByMonth = Object.keys(revMonthAgg).map(Number).sort((a, b) => a - b).map((mo) => ({ label: MONTHS[mo], value: Math.round(revMonthAgg[mo]), color: "var(--ok)", fmt: eur }));
  // Per tipologia (somma le camere con lo stesso nome tipologia) e per paese di provenienza.
  const rtAgg: Record<string, { n: number; rev: number }> = {};
  filtered.forEach((b) => { const u = getUnit(b.unitId); const name = u ? roomTypes.find((r) => r.id === u.roomTypeId)?.name : null; if (!name) return; if (!rtAgg[name]) rtAgg[name] = { n: 0, rev: 0 }; rtAgg[name].n++; rtAgg[name].rev += b.total ?? 0; });
  const byRoomType = Object.entries(rtAgg).map(([k, v], i) => ({ label: k, value: v.n, color: PALETTE[i % PALETTE.length] }));
  const revByRoomType = Object.entries(rtAgg).map(([k, v]) => ({ label: k, value: Math.round(v.rev), color: "var(--ok)", fmt: eur }));
  // Dati unici per tipologia: prenotazioni + ricavi insieme (un solo grafico)
  const roomTypeRows = Object.entries(rtAgg).map(([k, v], i) => ({ label: k, color: PALETTE[i % PALETTE.length], count: v.n, revenue: Math.round(v.rev) })).filter((r) => r.count > 0 || r.revenue > 0);
  const countryAgg: Record<string, number> = {};
  filtered.forEach((b) => { const c = guests.find((g) => g.id === b.guestId)?.country ?? "—"; countryAgg[c] = (countryAgg[c] || 0) + 1; });
  const byCountry = Object.entries(countryAgg).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, color: flagColor(k), fill: flagGradient(k) }));

  // Con una sola struttura selezionata i grafici "per struttura" non hanno senso: si nascondono.
  const singleStruct = activeStructureId !== "all" || structures.length <= 1;
  const charts = [
    { key: "ch-mix", title: "Prenotazioni e ricavi per canale", wide: true, node: <ChannelBars rows={channelRows} fmtEur={eur} /> },
    { key: "str-mix", title: "Prenotazioni e ricavi per struttura", perStructure: true, wide: true, node: <ChannelBars rows={structureRows} fmtEur={eur} /> },
    { key: "stay", title: "Durata soggiorno", node: <Donut data={stayDist} showPercent={false} /> },
    { key: "month", title: "Prenotazioni per mese", node: <ColumnChart bars={byMonth} barWidth={26} /> },
    { key: "rev-month", title: "Ricavi per mese", wide: true, node: <LineChart points={revByMonth} format={(n) => eur(n)} color="var(--ok)" everyLabel={1} /> },
    { key: "rt-mix", title: "Prenotazioni e ricavi per tipologia", wide: true, node: <ChannelBars rows={roomTypeRows} fmtEur={eur} /> },
    { key: "country", title: "Provenienza per paese", wide: true, node: <ColumnChart bars={byCountry} labelColor="var(--txt)" allLabels /> },
  ].filter((c) => !(singleStruct && c.perStructure));
  // I primi 4 (PREN_DEFAULTS) sono l'ordine e la vista iniziale; tutti restano nascondibili (mostra/nascondi tutti).
  const PREN_DEFAULTS = ["ch-mix", "month", "rev-month"];
  const defaultHidden = () => new Set(charts.map((c) => c.key)); // all'apertura tutti i grafici nascosti
  const hidden = hiddenPren ?? defaultHidden();
  const chartRank = (c: { key: string }) => { const i = PREN_DEFAULTS.indexOf(c.key); return i < 0 ? 100 + charts.findIndex((x) => x.key === c.key) : i; };
  const orderedCharts = [...charts].sort((a, b) => chartRank(a) - chartRank(b));
  const shownCharts = orderedCharts.filter((c) => !hidden.has(c.key)).sort((a, b) => {
    const ia = chartOrder.indexOf(a.key), ib = chartOrder.indexOf(b.key);
    if (ia < 0 && ib < 0) return 0;
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
  const toggleChart = (k: string) => { const n = new Set(hidden); if (n.has(k)) n.delete(k); else n.add(k); persistPren(n); };
  const showAllCharts = () => persistPren(new Set());
  const hideAllCharts = () => persistPren(new Set(charts.map((c) => c.key)));

  const doExcel = () => {
    exportExcel(
      "prenotazioni",
      [t("Codice"), t("Prenotata il"), t("Struttura"), t("Camera"), t("Canale"), t("Ospite"), t("N. ospiti"), t("Check-in"), t("Check-out"), t("Notti"), t("Totale €"), t("Commissioni €"), t("Netto €")],
      filtered.map((b) => [
        bookingCode(b), b.bookedOn ?? "", getStructure(b.structureId)?.name ?? "", getUnit(b.unitId)?.name ?? t("Da assegnare"),
        CHANNELS[b.channel].label, guestName(b), b.adults + b.children,
        b.checkIn, b.checkOut, nights(b.checkIn, b.checkOut), b.total ?? 0, commissionOf(b), nettoOf(b),
      ])
    );
  };

  return (
    <div>
      <PageHeader title={t("Prenotazioni")} subtitle={t("In anteprima le prenotazioni in corso e future · seleziona un intervallo di date per vedere lo storico")} actions={<WeatherWidget compact />} />

      {pastActive && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-focus bg-[color:color-mix(in_srgb,var(--focus)_8%,transparent)] px-3 py-2 text-xs text-dim">
          <span className="rounded-full bg-focus px-2 py-0.5 text-[10px] font-bold uppercase text-white">{t("Storico")}</span>
          {t("Stai consultando prenotazioni passate (dal")} {fmt(from)}{to ? ` ${t("al")} ${fmt(to)}` : ""}{t("). Card e grafici si riferiscono a questo periodo.")}
          <button onClick={clearFilters} className="ml-auto font-semibold text-focus hover:underline">{t("Torna a in corso e futuri")}</button>
        </div>
      )}

      {/* Card riepilogo */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard label={t("Prenotazioni")} value={String(filtered.length)} />
        <MiniCard label={t("Notti totali")} value={String(nightsTot)} />
        <MiniCard label={t("ADR (prezzo medio/notte)")} value={eur(avgPrice)} />
        <MiniCard label={t("Ricavi")} value={eur(revenue)} />
      </div>

      {/* Grafici: una riga scorrevole con frecce ‹ › · torte larghe 2 card, barre 1 card */}
      {shownCharts.length > 0 && (
        <div className="mb-4">
          <ScrollStrip
            gap="gap-3"
            onReorder={(keys) => { const rest = charts.map((c) => c.key).filter((k) => !keys.includes(k)); persistChartOrder([...keys, ...rest]); }}
            items={shownCharts.map((c) => ({
              key: c.key,
              className: `flex-none snap-start ${c.wide ? "w-[520px] max-w-[92vw] lg:w-[calc((100%-2.25rem)/2+0.75rem)]" : "w-[280px] lg:w-[calc((100%-2.25rem)/4)]"}`,
              node: (
                <Card className="flex h-full flex-col">
                  <SectionTitle>{t(c.title)}</SectionTitle>
                  <div className="flex-1">{c.node}</div>
                </Card>
              ),
            }))}
          />
        </div>
      )}

      {/* Filtri */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cerca nome o codice…")} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none placeholder:text-faint focus:border-focus sm:w-72 lg:w-80 xl:w-[22rem] 2xl:w-96" />
        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface px-1 py-1">
          <Select value={dateField} onChange={(v) => setDateField(v as "arrivo" | "prenotazione")} label={t("Tipo data")}>
            <option value="arrivo">{t("Arrivo / check-in")}</option>
            <option value="prenotazione">{t("Data prenotazione")}</option>
          </Select>
          <DateField value={from} onChange={setFrom} title={t("Dal")} placeholder={t("Dal")} className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs transition hover:border-focus" />
          <span className="text-xs text-faint">→</span>
          <DateField value={to} onChange={setTo} title={t("Al")} placeholder={t("Al")} className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs transition hover:border-focus" />
        </div>
        <StructureFilter value={loc} onChange={setLoc} structures={structuresToShow} units={units} roomTypes={roomTypes} single={activeStructureId !== "all"} />
        <Select value={channel} onChange={setChannel} label={t("Canale")}>
          <option value="all">{t("Tutti i canali")}</option>
          {(Object.keys(CHANNELS) as Channel[]).filter((c) => c !== "blocked").map((c) => (<option key={c} value={c}>{CHANNELS[c].label}</option>))}
        </Select>
        {hasFilters && (
          <button onClick={clearFilters} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-wash" style={{ borderColor: "var(--err)", color: "var(--err)" }}>{t("Rimuovi filtri")}</button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Toggle grafici: un click mostra tutti / nasconde tutti */}
          <button onClick={() => (shownCharts.length > 0 ? hideAllCharts() : showAllCharts())} title={shownCharts.length > 0 ? t("Nascondi i grafici") : t("Mostra i grafici")} className={`grid h-9 w-9 place-items-center rounded-lg border transition ${shownCharts.length > 0 ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] text-focus" : "border-line text-dim hover:bg-wash hover:text-txt"}`}><Icon name="chart" size={16} /></button>
          <Link href="/prenotazioni/nuova" className="rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>+ {t("Nuova")}</Link>
          <ExportMenu onExcel={doExcel} onPdf={exportPdf} />
        </div>
      </div>

      {/* Telefono: lista a schede (la tabella qui sotto è nascosta) */}
      <div className="flex flex-col gap-2 md:hidden">
        {displayList.map((item) => {
          if (item.kind === "group") {
            const { gid, members } = item; const b = members[0]; const ch = CHANNELS[b.channel]; const open = groupOpen.has(gid);
            return (
              <div key={gid} className="rounded-xl border border-line bg-surface shadow-sm">
                <button onClick={() => toggleGroup(gid)} className="block w-full p-3 text-left active:bg-wash">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 font-semibold text-txt"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-white" style={{ backgroundColor: "var(--focus)" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg></span><span className="truncate">{guestName(b) || "—"}</span></span>
                    <ChannelLogo channel={b.channel} size={18} title={ch.label} />
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-dim"><span className="font-mono">{fmt(b.checkIn)} → {fmt(b.checkOut)}</span><span className="text-faint">·</span><span>{nights(b.checkIn, b.checkOut)} {t("notti")}</span></div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-focus">{members.length} {t("camere")} {open ? "▾" : "▸"}</span>
                    <span className="shrink-0 font-mono font-semibold text-txt">{eur(gSum(members, (x) => x.total ?? 0))}</span>
                  </div>
                </button>
                {open && (
                  <div className="border-t border-line">
                    {members.map((m) => (
                      <button key={m.id} onClick={() => openBooking(m.id)} className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-left last:border-0 active:bg-wash">
                        <span className="truncate text-xs text-dim">{unitLabel(m) ?? <span className="font-medium italic text-[color:var(--err)]">{t("Da assegnare")}</span>} · {m.adults + m.children} {t("osp.")}</span>
                        <span className="shrink-0 font-mono text-xs text-txt">{m.total ? eur(m.total) : "—"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          const b = item.b;
          const ch = CHANNELS[b.channel]; const alOk = alloggiatiOk(b); const pay = payStatus(b);
          return (
            <button key={b.id} onClick={() => openBooking(b.id)} className="block w-full rounded-xl border border-line bg-surface p-3 text-left shadow-sm active:bg-wash">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-txt">{guestName(b) || "—"}</span>
                <ChannelLogo channel={b.channel} size={18} title={ch.label} />
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-dim">
                <span className="font-mono">{fmt(b.checkIn)} → {fmt(b.checkOut)}</span>
                <span className="text-faint">·</span>
                <span>{nights(b.checkIn, b.checkOut)} {t("notti")}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-dim">{unitLabel(b) ?? <span className="font-medium italic text-[color:var(--err)]">{t("Da assegnare")}</span>} · {b.adults + b.children} {t("osp.")}</span>
                <span className="shrink-0 font-mono font-semibold text-txt">{b.total ? eur(b.total) : "—"}</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <StatusIcon icon="id" color={alOk ? "var(--ok)" : "var(--faint)"} title={alOk ? t("Schedina alloggiati pronta") : t("Schedina alloggiati da completare")} />
                <StatusIcon icon="card" color={PAY_META[pay][0]} title={t(PAY_META[pay][1])} />
                {activeStructureId === "all" && <span className="ml-auto flex items-center gap-1 truncate text-[11px] text-faint"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: getStructure(b.structureId)?.photoColor ?? "var(--faint)" }} />{getStructure(b.structureId)?.name}</span>}
              </div>
            </button>
          );
        })}
        {!filtered.length && <div className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-faint">{t("Nessuna prenotazione con questi filtri")}</div>}
      </div>

      {/* Tabella (tablet/desktop) */}
      <div className="hidden max-h-[60vh] overflow-auto rounded-xl border border-line bg-surface shadow-sm md:block">
        <table className="w-max min-w-full whitespace-nowrap text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="text-left text-xs uppercase tracking-wide text-faint">
              <Th k="id" sort={sort} onSort={toggleSort}>{t("Codice")}</Th>
              <Th k="bookedOn" sort={sort} onSort={toggleSort}>{t("Prenotata il")}</Th>
              {activeStructureId === "all" && <Th k="struttura" sort={sort} onSort={toggleSort}>{t("Struttura")}</Th>}
              <Th k="camera" sort={sort} onSort={toggleSort}>{t("Camera")}</Th>
              <Th k="canale" sort={sort} onSort={toggleSort}>{t("Canale")}</Th>
              <Th k="ospite" sort={sort} onSort={toggleSort}>{t("Ospite")}</Th>
              <Th k="pax" sort={sort} onSort={toggleSort}>{t("N. ospiti")}</Th>
              <Th k="checkIn" sort={sort} onSort={toggleSort}>{t("Check-in")}</Th>
              <Th k="checkOut" sort={sort} onSort={toggleSort}>{t("Check-out")}</Th>
              <Th k="notti" sort={sort} onSort={toggleSort}>{t("Notti")}</Th>
              <Th k="totale" sort={sort} onSort={toggleSort}>{t("Totale")}</Th>
              <Th k="commissioni" sort={sort} onSort={toggleSort}>{t("Commissioni")}</Th>
              <Th k="netto" sort={sort} onSort={toggleSort}>{t("Netto")}</Th>
              <Th>{t("Stato")}</Th>
            </tr>
          </thead>
          <tbody>
            {displayList.map((item) => {
              if (item.kind === "single") {
                const b = item.b;
                return <tr key={b.id} onClick={() => openBooking(b.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">{renderCells(b)}</tr>;
              }
              const { gid, members } = item; const b = members[0]; const ch = CHANNELS[b.channel]; const open = groupOpen.has(gid);
              const colSpan = activeStructureId === "all" ? 14 : 13;
              return (
                <Fragment key={gid}>
                  <tr onClick={() => toggleGroup(gid)} className="cursor-pointer border-b border-line bg-[color:color-mix(in_srgb,var(--focus)_5%,transparent)] hover:bg-wash">
                    <td className="px-3 py-2.5 font-mono text-xs text-dim"><span className="inline-flex items-center gap-1.5">{bookingCode(b)}<span className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-white" style={{ backgroundColor: "var(--focus)" }} title={t("Prenotazione di gruppo")}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg></span></span></td>
                    <td className="px-3 py-2.5 font-mono text-xs text-dim">{b.bookedOn ? fmt(b.bookedOn) : "—"}</td>
                    {activeStructureId === "all" && <td className="px-3 py-2.5 text-dim"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: getStructure(b.structureId)?.photoColor ?? "var(--faint)" }} /><span className="truncate">{getStructure(b.structureId)?.name}</span></span></td>}
                    <td className="whitespace-nowrap px-3 py-2.5"><span className="rounded-full bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-focus">{members.length} {t("camere")} {open ? "▾" : "▸"}</span></td>
                    <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><ChannelLogo channel={b.channel} size={16} title={ch.label} /><span className="text-xs text-dim">{ch.label}</span></span></td>
                    <td className="px-3 py-2.5 font-medium text-txt">{guestName(b)}</td>
                    <td className="px-3 py-2.5 font-mono text-dim">{gSum(members, (x) => x.adults + x.children)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-dim">{fmt(b.checkIn)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-dim">{fmt(b.checkOut)}</td>
                    <td className="px-3 py-2.5 font-mono text-dim">{nights(b.checkIn, b.checkOut)}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-txt">{eur(gSum(members, (x) => x.total ?? 0))}</td>
                    <td className="px-3 py-2.5 font-mono text-dim">{eur(gSum(members, (x) => commissionOf(x)))}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-[color:var(--ok)]">{eur(gSum(members, (x) => nettoOf(x)))}</td>
                    <td className="px-3 py-2.5 text-[11px] text-faint">{t("gruppo")}</td>
                  </tr>
                  {open && members.map((m) => (
                    <tr key={m.id} onClick={() => openBooking(m.id)} className="cursor-pointer border-b border-line bg-wash/40 hover:bg-wash">{renderCells(m, true)}</tr>
                  ))}
                  {open && <tr className="border-b border-line"><td colSpan={colSpan} className="px-3 py-0.5" /></tr>}
                </Fragment>
              );
            })}
            {!filtered.length && (
              <tr><td colSpan={activeStructureId === "all" ? 14 : 13} className="px-3 py-8 text-center text-sm text-faint">{t("Nessuna prenotazione con questi filtri")}</td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="sticky bottom-0 z-20">
              <tr className="border-t-2 border-line bg-wash text-sm font-semibold text-txt">
                <td className="px-3 py-2.5" colSpan={activeStructureId === "all" ? 6 : 5}>{t("Totali")} · {filtered.length} {t("prenotazioni")}</td>
                <td className="px-3 py-2.5 font-mono">{guestsTot}</td>
                <td className="px-3 py-2.5" colSpan={2}></td>
                <td className="px-3 py-2.5 font-mono">{nightsTot}</td>
                <td className="px-3 py-2.5 font-mono">{eur(revenue)}</td>
                <td className="px-3 py-2.5 font-mono">{eur(commissionTot)}</td>
                <td className="px-3 py-2.5 font-mono text-[color:var(--ok)]">{eur(nettoTot)}</td>
                <td className="px-3 py-2.5"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function StatusIcon({ icon, color, title }: { icon: string; color: string; title: string }) {
  return (
    <span title={title} className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
      <Icon name={icon} size={13} />
    </span>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-txt">{value}</div>
    </div>
  );
}
function Th({ children, k, sort, onSort }: { children: React.ReactNode; k?: string; sort?: { key: string; dir: "asc" | "desc" }; onSort?: (k: string) => void }) {
  if (!k || !sort || !onSort) return <th className="sticky top-0 whitespace-nowrap border-b border-line bg-surface px-3 py-2 font-semibold">{children}</th>;
  const active = sort.key === k;
  return (
    <th onClick={() => onSort(k)} className="sticky top-0 cursor-pointer select-none whitespace-nowrap border-b border-line bg-surface px-3 py-2 font-semibold hover:text-txt">
      <span className="inline-flex items-center gap-1">
        {children}
        <span className="text-[9px] leading-none" style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}</span>
      </span>
    </th>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function StructureFilter({ value, onChange, structures, units, roomTypes, single }: { value: string; onChange: (v: string) => void; structures: any[]; units: any[]; roomTypes: any[]; single?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const allLabel = single ? t("Tutte le camere") : t("Tutte le strutture e camere");
  const label =
    value === "all" ? allLabel
    : value.startsWith("str:") ? (structures.find((s) => s.id === value.slice(4))?.name ?? t("Struttura"))
    : (units.find((u) => u.id === value.slice(5))?.name ?? t("Camera"));
  const pick = (v: string) => { onChange(v); setOpen(false); };
  // Raggruppa le camere di una struttura per tipologia (room type).
  const groupsFor = (sid: string) => {
    const us = units.filter((u) => u.structureId === sid);
    const map = new Map<string, { name: string; list: any[] }>();
    for (const u of us) {
      const rt = roomTypes.find((r) => r.id === u.roomTypeId);
      const k = u.roomTypeId ?? "—";
      if (!map.has(k)) map.set(k, { name: rt?.name ?? t("Camera"), list: [] });
      map.get(k)!.list.push(u);
    }
    return [...map.values()];
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt hover:bg-wash">
        <span className="max-w-[190px] truncate">{label}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-line bg-surface p-1 shadow-xl">
          <Opt active={value === "all"} onClick={() => pick("all")}>{allLabel}</Opt>
          {single ? (
            // Una sola struttura selezionata: solo camere, divise per tipologia.
            groupsFor(structures[0]?.id).map((g, i) => (
              <div key={i}>
                <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{g.name}</div>
                {g.list.map((u) => (
                  <Opt key={u.id} active={value === `unit:${u.id}`} onClick={() => pick(`unit:${u.id}`)}>{u.name}</Opt>
                ))}
              </div>
            ))
          ) : (
            structures.map((s) => (
              <div key={s.id}>
                <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{s.name}</div>
                <Opt active={value === `str:${s.id}`} onClick={() => pick(`str:${s.id}`)}>— {t("Tutta la struttura")}</Opt>
                {groupsFor(s.id).map((g, i) => (
                  <div key={i}>
                    <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">{g.name}</div>
                    {g.list.map((u) => (
                      <Opt key={u.id} active={value === `unit:${u.id}`} onClick={() => pick(`unit:${u.id}`)}>{u.name}</Opt>
                    ))}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
function Opt({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-focus text-white" : "text-txt hover:bg-wash"}`}>{children}</button>;
}
function Select({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-txt outline-none focus:border-focus">
      {children}
    </select>
  );
}
