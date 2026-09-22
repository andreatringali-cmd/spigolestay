"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent as RDragEvent, type MouseEvent as RMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { CHANNELS, EVENT_COLORS, type Unit } from "@/lib/types";
import {
  addDays,
  dayIndex,
  monthLabel,
  nights,
  parseISO,
  shiftISO,
  toISO,
  weekdayShort,
} from "@/lib/dates";
import { eur } from "@/lib/format";
import { bookingGrandTotal } from "@/lib/booking";
import { rateForDay, loadWeekendPct } from "@/lib/pricing";
import { sortUnitsByName } from "@/lib/sortUnits";
import Icon from "@/components/Icon";
import ChannelLogo from "@/components/ChannelLogo";
import DateField from "@/components/DateField";

// Scheda camera: opzioni frequenza servizio e giorni della settimana.
const FREQ_OPTS = ["Ogni partenza", "1 Giorno", "2 Giorni", "3 Giorni", "4 Giorni", "5 Giorni", "7 Giorni"];
const WEEK_DAYS = ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"];
const freqDays = (label?: string) => { const m = /^(\d+)/.exec(label ?? ""); return m ? parseInt(m[1], 10) : 0; }; // 0 = solo alla partenza

// Card "Insights" del calendario (selettore mostra/nascondi).
const INSIGHT_CARDS = [
  { key: "copilot", label: "Copilota revenue" },
  { key: "pickup", label: "Ritmo prenotazioni" },
  { key: "gaps", label: "Buchi da riempire" },
  { key: "sim", label: "Simulatore prezzi" },
  { key: "alerts", label: "Da controllare" },
  { key: "moves", label: "Prossimi movimenti" },
  { key: "channels", label: "Mix canali & commissioni" },
  { key: "kpi", label: "ADR & RevPAR" },
];

const MIN_CELL = 34;  // larghezza minima cella (sotto questa, scroll orizzontale)
const ROW_H = 26;

// Festivi nazionali (giorno fisso). Sabato = arancio, Domenica/festivo = rosso.
const HOLIDAYS = new Set(["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"]);
const SAT_COLOR = "#E08A3A";
const mmdd = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function dayHue(d: Date): { tint?: string; text?: string } {
  const dow = d.getDay();
  if (dow === 0 || HOLIDAYS.has(mmdd(d))) return { tint: "color-mix(in srgb, var(--err) 10%, transparent)", text: "var(--err)" };
  if (dow === 6) return { tint: `color-mix(in srgb, ${SAT_COLOR} 12%, transparent)`, text: SAT_COLOR };
  return {};
}

const rangesOverlap = (aIn: string, aOut: string, bIn: string, bOut: string) =>
  aIn < bOut && bIn < aOut;


// Iniziali della struttura (es. "Spigole House" → "SH").
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

interface DragView {
  id: string;
  dxDays: number;
  targetUnitId: string | null;
  valid: boolean;
  reason: string;
  x: number;
  y: number;
}

export default function CalendarGrid() {
  const { structures, units, roomTypes, bookings, guests, events, rateOverrides, moveBooking, openBooking, addBooking, updateBooking, deleteBooking, addEvent, updateEvent, deleteEvent, setDayRates, clearDayRates, activeStructureId, updateUnit, deleteUnit, addUnit } = useData();
  const router = useRouter();

  // Configurazione "Visualizza" (persistita): finestra giorni + righe mostrate + densità.
  type Span = 3 | 7 | 14 | 30 | "month";
  interface ViewCfg { span: Span; rate: boolean; avail: boolean; occ: boolean; emptyRow: boolean; dense: boolean; fromYesterday: boolean; group: "struct" | "type" }
  const [vw, setVw] = useState<ViewCfg>({ span: "month", rate: true, avail: true, occ: true, emptyRow: false, dense: true, fromYesterday: false, group: "struct" });
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:calview:v2"); if (r) { const p = JSON.parse(r); if (p.span !== 7 && p.span !== "month") p.span = "month"; setVw((v) => ({ ...v, ...p })); } } catch {} }, []);
  const patchView = (p: Partial<ViewCfg>) => setVw((v) => { const n = { ...v, ...p }; try { localStorage.setItem("spigolestay:calview:v2", JSON.stringify(n)); } catch {} return n; });
  const [vizOpen, setVizOpen] = useState(false);
  const vizRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (vizRef.current && !vizRef.current.contains(e.target as Node)) setVizOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  // Selettore mese (tendina)
  const [monthOpen, setMonthOpen] = useState(false);
  const monthRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (monthRef.current && !monthRef.current.contains(e.target as Node)) setMonthOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const monthList = useMemo(() => { const base = new Date(); const first = new Date(base.getFullYear(), base.getMonth() - 2, 1); return Array.from({ length: 18 }, (_, i) => { const d = new Date(first.getFullYear(), first.getMonth() + i, 1); return { y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString("it-IT", { month: "long", year: "numeric" }) }; }); }, []);
  const rowH = vw.dense ? 31 : 42;
  // Stato pulizie di oggi (dalla pagina Pulizie): chiave = `unitId:YYYY-MM-DD`.
  const [cleanDone, setCleanDone] = useState<Record<string, string>>({});
  const [linenDone, setLinenDone] = useState<Record<string, string>>({});
  useEffect(() => { try { const d = localStorage.getItem("spigolestay:pulizie:done"); if (d) setCleanDone(JSON.parse(d)); const l = localStorage.getItem("spigolestay:pulizie:linen"); if (l) setLinenDone(JSON.parse(l)); } catch {} }, []);
  const [roomInfoId, setRoomInfoId] = useState<string | null>(null); // scheda camera in pannello (senza cambiare pagina)
  // Aggiorna lo stato pulizia di OGGI (accende/spegne la scopa nel calendario) e lo persiste per Pulizie.
  const setCleanState = (unitId: string, cleaned: boolean) => {
    setCleanDone((prev) => {
      const next = { ...prev }; const key = `${unitId}:${toISO(new Date())}`;
      if (cleaned) next[key] = new Date().toISOString(); else delete next[key];
      try { localStorage.setItem("spigolestay:pulizie:done", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  // Stato cambio lenzuola di OGGI (icona lenzuola verde quando fatto).
  const setLinenState = (unitId: string, done: boolean) => {
    setLinenDone((prev) => {
      const next = { ...prev }; const key = `${unitId}:${toISO(new Date())}`;
      if (done) next[key] = new Date().toISOString(); else delete next[key];
      try { localStorage.setItem("spigolestay:pulizie:linen", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  // Su cellulare la colonna con i nomi camera è molto più stretta, così si vede più calendario.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { const f = () => setIsMobile(window.innerWidth < 640); f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  const LABEL_W = isMobile ? 104 : 212;
  // Stile etichetta barra: "dentro" (nome nella barra) o "sotto" (barra sottile + nome sotto).
  const [barStyle, setBarStyle] = useState<"dentro" | "sotto">("dentro");
  useEffect(() => { try { const s = localStorage.getItem("spigolestay:calbars"); if (s === "sotto" || s === "dentro") setBarStyle(s); } catch {} }, []);
  const setBars = (s: "dentro" | "sotto") => { setBarStyle(s); try { localStorage.setItem("spigolestay:calbars", s); } catch {} };

  // Icone di stato camera (arrivo/partenza, pulizia, lenzuola) nell'etichetta riga: nascoste di
  // default (si vede solo il nome/numero), mostrabili con un interruttore. Preferenza per-dispositivo.
  const [showRoomIcons, setShowRoomIcons] = useState(false);
  useEffect(() => { try { setShowRoomIcons(localStorage.getItem("spigolestay:cal:roomicons") === "1"); } catch {} }, []);
  const toggleRoomIcons = () => setShowRoomIcons((v) => { const n = !v; try { localStorage.setItem("spigolestay:cal:roomicons", n ? "1" : "0"); } catch {} return n; });
  // Ultimo aggiornamento + stato connessione dei canali OTA (per legenda e spunte).
  const [lastRun, setLastRun] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const [connMap, setConnMap] = useState<Record<string, boolean>>({ booking: true, airbnb: true });
  useEffect(() => {
    try {
      const raw = localStorage.getItem("spigolestay:canali:conn");
      const conn: Record<string, { connected?: boolean; lastSync?: string }> = raw ? JSON.parse(raw) : {};
      if (raw) { const m: Record<string, boolean> = {}; Object.entries(conn).forEach(([k, v]) => { m[k] = !!v?.connected; }); setConnMap(m); }
      const syncs = Object.values(conn).map((c) => c?.lastSync).filter(Boolean).map((s) => new Date(s as string).getTime());
      const ts = syncs.length ? Math.max(...syncs) : Date.now();
      setLastRun(new Date(ts).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }));
    } catch {}
  }, []);
  // Forza una sincronizzazione manuale del channel manager (prototipo: aggiorna l'orario dell'ultimo processo).
  const syncNow = () => {
    if (syncing) return;
    setSyncing(true);
    const now = Date.now();
    try {
      const raw = localStorage.getItem("spigolestay:canali:conn");
      const conn: Record<string, { connected?: boolean; lastSync?: string }> = raw ? JSON.parse(raw) : {};
      Object.keys(conn).forEach((k) => { if (conn[k]?.connected) conn[k].lastSync = new Date(now).toISOString(); });
      localStorage.setItem("spigolestay:canali:conn", JSON.stringify(conn));
    } catch {}
    setTimeout(() => { setLastRun(new Date(now).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })); setSyncing(false); }, 900);
  };
  // true = collegato, false = non collegato, null = non applicabile (Diretta/Bloccato).
  const chConnected = (c: string): boolean | null =>
    c === "direct" ? null : c === "blocked" ? null : c === "expedia" ? (!!connMap.expedia || !!connMap.vrbo) : !!connMap[c];
  // Insights: simulatore what-if (± prezzo).
  const [whatIf, setWhatIf] = useState(0);
  // Selettore card Insights (mostra/nascondi, persistito) — all'apertura tutte nascoste, come Dashboard/Prenotazioni.
  const [hiddenCards, setHiddenCards] = useState<Set<string>>(() => new Set(INSIGHT_CARDS.map((c) => c.key)));
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:calcards"); if (r) setHiddenCards(new Set(JSON.parse(r))); } catch {} }, []);
  const persistCards = (n: Set<string>) => { setHiddenCards(n); try { localStorage.setItem("spigolestay:calcards", JSON.stringify([...n])); } catch {} };
  const toggleCard = (k: string) => { const n = new Set(hiddenCards); if (n.has(k)) n.delete(k); else n.add(k); persistCards(n); };
  const showCard = (k: string) => !hiddenCards.has(k);
  const [cardsMenuOpen, setCardsMenuOpen] = useState(false);
  // Ordine delle card (persistito) — riordino via drag&drop diretto sulle card.
  const [cardOrder, setCardOrder] = useState<string[]>(INSIGHT_CARDS.map((c) => c.key));
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:calcardorder"); if (r) { const saved: string[] = JSON.parse(r); const valid = saved.filter((k) => INSIGHT_CARDS.some((c) => c.key === k)); const missing = INSIGHT_CARDS.map((c) => c.key).filter((k) => !valid.includes(k)); setCardOrder([...valid, ...missing]); } } catch {} }, []);
  const persistOrder = (o: string[]) => { setCardOrder(o); try { localStorage.setItem("spigolestay:calcardorder", JSON.stringify(o)); } catch {} };
  const orderOf = (k: string) => { const i = cardOrder.indexOf(k); return i < 0 ? 50 : i; };
  const [dragCard, setDragCard] = useState<string | null>(null);
  const onCardsDragStart = (e: RDragEvent) => { const el = e.target as HTMLElement; if (el.closest("input,button,a,select,textarea")) { e.preventDefault(); return; } const k = el.closest<HTMLElement>("[data-cardkey]")?.dataset.cardkey; if (k) { setDragCard(k); e.dataTransfer.effectAllowed = "move"; } };
  const onCardDrop = (targetKey: string) => { if (!dragCard || dragCard === targetKey) { setDragCard(null); return; } const o = cardOrder.filter((k) => k !== dragCard); const ti = o.indexOf(targetKey); o.splice(ti < 0 ? o.length : ti, 0, dragCard); persistOrder(o); setDragCard(null); };
  // Riposizionamento card: doppio clic per attivare, poi ◀ ▶ per spostare (come le altre sezioni). Niente manina: lo scroll è a rotella.
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const onCardsDblClick = (e: RMouseEvent) => { const k = (e.target as HTMLElement).closest<HTMLElement>("[data-cardkey]")?.dataset.cardkey; if (k) setActiveCard((p) => (p === k ? null : k)); };
  const moveActiveCard = (dir: -1 | 1) => { if (!activeCard) return; const order = INSIGHT_CARDS.map((c) => c.key).filter(showCard).sort((a, b) => orderOf(a) - orderOf(b)); const i = order.indexOf(activeCard), j = i + dir; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; const rest = cardOrder.filter((k) => !order.includes(k)); persistOrder([...order, ...rest]); };
  const cardsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (cardsRef.current && !cardsRef.current.contains(e.target as Node)) setCardsMenuOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const [start, setStart] = useState<Date>(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1); // vista mensile: parte dal 1° del mese
  });
  const [dragView, setDragView] = useState<DragView | null>(null);
  const [oos, setOos] = useState<null | { id?: string; unitId: string; structureId: string; roomTypeId: string; from: string; to: string; reason: string }>(null);
  // Conferma correzione prezzo (Copilota = prezzo singolo, Simulatore = variazione % massiva su un periodo scelto).
  const [priceConfirm, setPriceConfirm] = useState<null | { kind: "single"; subject: string; detail?: string; from: number; to: number; onOk: () => void } | { kind: "bulk"; pct: number; from: string; to: string }>(null);
  // Suggerimenti del Copilota revenue già applicati (spunta permanente, salvata nel browser).
  const [tipDone, setTipDone] = useState<Set<string>>(new Set());
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:caltips"); if (r) setTipDone(new Set(JSON.parse(r))); } catch {} }, []);
  const markTip = (k: string) => setTipDone((p) => { const n = new Set(p).add(k); try { localStorage.setItem("spigolestay:caltips", JSON.stringify([...n])); } catch {} return n; });
  const tipKey = (s: { dir?: string; subject?: string; detail?: string }) => `${s.dir ?? ""}|${s.subject ?? ""}|${s.detail ?? ""}`;
  // Conferma spostamento prenotazione (drag su un'altra camera/data).
  const [moveConfirm, setMoveConfirm] = useState<null | { id: string; targetUnitId: string; checkIn: string; checkOut: string; prev: { unitId: string | null; checkIn: string; checkOut: string } }>(null);
  // Selettore che compare cliccando su una cella libera: prenotazione o fuori servizio.
  // Selezione unificata: 1° click = inizio, 2° click = apre la scheda. Vale per eventi, tariffe e prenotazioni.
  type Sel =
    | { kind: "event"; anchor: string }
    | { kind: "rate"; typeId: string; anchor: string }
    | { kind: "avail"; typeId: string; anchor: string }
    | { kind: "booking"; unitId: string; structureId: string; roomTypeId: string; anchor: string };
  const [sel, setSel] = useState<Sel | null>(null);
  const [selHover, setSelHover] = useState<string | null>(null);
  const [pick, setPick] = useState<null | { unitId: string; structureId: string; roomTypeId: string; from: string; to: string }>(null);
  const [evDraft, setEvDraft] = useState<null | { id?: string; name: string; from: string; to: string; color: string }>(null);
  const [rateEdit, setRateEdit] = useState<null | { typeId: string; typeIds?: string[]; from: string; to: string; mode: "fixed" | "percent"; value: number }>(null);
  const [availEdit, setAvailEdit] = useState<null | { typeId: string; from: string; to: string; closed: number }>(null);
  const [availStr, setAvailStr] = useState<string | null>(null); // valore digitato manualmente nel campo camere (null = usa il derivato)
  // Chiusure vendita manuali per (tipologia, giorno): quante camere chiudere. Persistite.
  const [closes, setCloses] = useState<Record<string, number>>({});
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:calcloses"); if (r) setCloses(JSON.parse(r)); } catch {} }, []);
  const persistCloses = (next: Record<string, number>) => { setCloses(next); try { localStorage.setItem("spigolestay:calcloses", JSON.stringify(next)); } catch {} };
  const closeKey = (typeId: string, iso: string) => `${typeId}|${iso}`;

  const selAnchor = sel?.anchor ?? null;
  const selLo = selAnchor ? (selAnchor <= (selHover ?? selAnchor) ? selAnchor : (selHover ?? selAnchor)) : null;
  const selHi = selAnchor ? (selAnchor <= (selHover ?? selAnchor) ? (selHover ?? selAnchor) : selAnchor) : null;
  const selDays = selLo && selHi ? nights(selLo, selHi) + 1 : 0;
  const cancelSel = () => { setSel(null); setSelHover(null); };

  const clickHeader = (iso: string) => {
    if (sel?.kind === "event" && selLo && selHi) { setSel(null); setSelHover(null); setEvDraft({ name: "", from: selLo, to: shiftISO(selHi, 1), color: EVENT_COLORS[0] }); return; }
    if (!sel) {
      const ev = events.find((e) => e.from <= iso && iso < e.to);
      if (ev) { setEvDraft({ id: ev.id, name: ev.name, from: ev.from, to: ev.to, color: ev.color }); return; }
    }
    setSel({ kind: "event", anchor: iso }); setSelHover(iso);
  };
  const clickRate = (typeId: string, iso: string, typeIds?: string[]) => {
    if (sel?.kind === "rate" && sel.typeId === typeId && selLo && selHi) { const members = typeIds ?? [typeId]; setSel(null); setSelHover(null); setRateEdit({ typeId: members[0], typeIds: members, from: selLo, to: selHi, mode: "fixed", value: rateFor(members[0], selLo) }); return; }
    setSel({ kind: "rate", typeId, anchor: iso }); setSelHover(iso);
  };
  const clickAvail = (typeId: string, iso: string) => {
    if (sel?.kind === "avail" && sel.typeId === typeId && selLo && selHi) { const tp = sel.typeId; setSel(null); setSelHover(null); setAvailEdit({ typeId: tp, from: selLo, to: selHi, closed: closes[closeKey(tp, selLo)] ?? 0 }); return; }
    setSel({ kind: "avail", typeId, anchor: iso }); setSelHover(iso);
  };
  const clickCell = (unit: { id: string; roomTypeId: string }, structureId: string, iso: string) => {
    if (sel?.kind === "booking" && sel.unitId === unit.id && selLo && selHi) { setSel(null); setSelHover(null); setPick({ unitId: unit.id, structureId, roomTypeId: unit.roomTypeId, from: selLo, to: selHi }); return; }
    setSel({ kind: "booking", unitId: unit.id, structureId, roomTypeId: unit.roomTypeId, anchor: iso }); setSelHover(iso);
  };

  const rangeIsos = (from: string, to: string) => {
    const a = from <= to ? from : to, b = from <= to ? to : from;
    const out: string[] = []; let d = a; while (d <= b) { out.push(d); d = shiftISO(d, 1); }
    return out;
  };
  const saveRate = () => {
    if (!rateEdit) return;
    const targets = rateEdit.typeIds ?? [rateEdit.typeId];
    const map: Record<string, number> = {};
    for (const tid of targets) for (const iso of rangeIsos(rateEdit.from, rateEdit.to)) {
      map[rateKey(tid, iso)] = rateEdit.mode === "fixed" ? Math.max(0, Math.round(rateEdit.value)) : Math.max(0, Math.round(rateFor(tid, iso) * (1 + rateEdit.value / 100)));
    }
    setDayRates(map);
    setRateEdit(null);
  };
  const resetRate = () => { if (rateEdit) { clearDayRates(rangeIsos(rateEdit.from, rateEdit.to).map((iso) => rateKey(rateEdit.typeId, iso))); setRateEdit(null); } };
  const saveAvail = () => {
    if (!availEdit) return;
    const next = { ...closes };
    for (const iso of rangeIsos(availEdit.from, availEdit.to)) { const k = closeKey(availEdit.typeId, iso); if (availEdit.closed !== 0) next[k] = Math.round(availEdit.closed); else delete next[k]; }
    persistCloses(next); setAvailEdit(null);
  };
  const saveEvent = () => {
    if (!evDraft || !evDraft.name.trim()) return;
    if (evDraft.id) updateEvent(evDraft.id, { name: evDraft.name.trim(), from: evDraft.from, to: evDraft.to, color: evDraft.color });
    else addEvent({ name: evDraft.name.trim(), from: evDraft.from, to: evDraft.to, color: evDraft.color });
    setEvDraft(null);
  };
  const saveOos = () => {
    if (!oos || !oos.from || !oos.to || oos.to <= oos.from) return;
    if (oos.id) updateBooking(oos.id, { unitId: oos.unitId, checkIn: oos.from, checkOut: oos.to, note: oos.reason.trim() || undefined });
    else addBooking({ structureId: oos.structureId, roomTypeId: oos.roomTypeId, unitId: oos.unitId, guestId: "", channel: "blocked", status: "confirmed", checkIn: oos.from, checkOut: oos.to, adults: 0, children: 0, note: oos.reason.trim() || undefined });
    setOos(null);
  };
  // Apri il fuori servizio (barra "blocked") in modifica.
  const openOosEdit = (b: (typeof bookings)[number]) => setOos({ id: b.id, unitId: b.unitId ?? "", structureId: b.structureId, roomTypeId: b.roomTypeId, from: b.checkIn, to: b.checkOut, reason: b.note ?? "" });

  const dayCount = vw.span === "month" ? new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate() : vw.span;

  // Larghezza cella dinamica: il calendario riempie tutta la larghezza disponibile
  // e si ricalcola quando cambia il contenitore (es. sidebar aperta/chiusa).
  const wrapRef = useRef<HTMLDivElement>(null);
  // Sincronizza lo scroll orizzontale tra pannello occupazione e griglia (le date sono solo nella griglia).
  const occScrollRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const syncScroll = (from: HTMLDivElement | null, to: HTMLDivElement | null) => { if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft; };
  const [cellW, setCellW] = useState(MIN_CELL);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const compute = () => {
      const avail = el.clientWidth - LABEL_W;
      if (avail > 0) setCellW(Math.max(MIN_CELL, Math.floor(avail / dayCount)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dayCount]);
  const step = vw.span === "month" ? 30 : vw.span;
  const goPrev = () => setStart((d) => (vw.span === "month" ? new Date(d.getFullYear(), d.getMonth() - 1, 1) : addDays(d, -step)));
  const goNext = () => setStart((d) => (vw.span === "month" ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : addDays(d, step)));
  const anchorToday = () => { const t = new Date(); const base = new Date(t.getFullYear(), t.getMonth(), t.getDate()); return vw.fromYesterday ? addDays(base, -1) : base; };
  const showToday = () => setStart(vw.span === "month" ? (() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); })() : anchorToday());

  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDays(start, i)), [start, dayCount]);
  // Segmenti per mese (per l'intestazione "agosto | settembre" nella vista a cavallo di due mesi).
  const monthSegments = useMemo(() => {
    const segs: { key: string; count: number; label: string }[] = [];
    days.forEach((d) => {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const last = segs[segs.length - 1];
      if (last && last.key === key) last.count++;
      else segs.push({ key, count: 1, label: d.toLocaleDateString("it-IT", { month: "long", year: "numeric" }) });
    });
    return segs;
  }, [days]);
  // Indici di giorno dove cambia il mese (per il separatore verticale evidenziato).
  const monthBoundaries = useMemo(() => {
    const out: number[] = []; let cum = 0;
    monthSegments.forEach((seg, i) => { cum += seg.count; if (i < monthSegments.length - 1) out.push(cum); });
    return out;
  }, [monthSegments]);
  const todayISO = useMemo(() => toISO(new Date()), []);
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "Ospite";
  // Stato prenotazione per le icone sulle barre.
  const payStatusOf = (b: { total?: number; cleaningFee?: number; paid?: number }): "paid" | "partial" | "unpaid" => {
    const due = (b.total ?? 0) + (b.cleaningFee ?? 0); const paid = b.paid ?? 0;
    if (due > 0 && paid >= due) return "paid"; if (paid > 0) return "partial"; return "unpaid";
  };
  const PAY_DOT: Record<string, string> = { paid: "var(--ok)", partial: "var(--warn)", unpaid: "var(--err)" };
  const schedinaOk = (guestId: string) => { const g = guests.find((x) => x.id === guestId); return !!(g && (g.lastName || g.fullName) && g.sex && g.birthDate && g.birthPlace && g.citizenship && g.docType && g.docNumber); };
  const bdayInStay = (guestId: string, ci: string, co: string) => { const g = guests.find((x) => x.id === guestId); if (!g?.birthDate) return false; const md = g.birthDate.slice(5); for (const y of new Set([ci.slice(0, 4), co.slice(0, 4)])) { const iso = `${y}-${md}`; if (iso >= ci && iso < co) return true; } return false; };
  const isTurnover = (b: { id: string; unitId: string | null; checkIn: string }) => !!b.unitId && bookings.some((x) => x.id !== b.id && x.unitId === b.unitId && x.status !== "cancelled" && x.channel !== "blocked" && x.checkOut === b.checkIn);

  const visibleStructures = activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId);
  const visibleUnits = useMemo(
    () => units.filter((u) => visibleStructures.some((s) => s.id === u.structureId)),
    [units, visibleStructures]
  );

  // ─── Refs per i listener di drag (leggono sempre i dati aggiornati) ───
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const dragViewRef = useRef<DragView | null>(null);
  const bookingsRef = useRef(bookings);
  const unitsRef = useRef(units);
  const typesRef = useRef(roomTypes);
  const startRef = useRef(start);
  useEffect(() => { dragViewRef.current = dragView; }, [dragView]);
  useEffect(() => { bookingsRef.current = bookings; }, [bookings]);
  useEffect(() => { unitsRef.current = units; }, [units]);
  useEffect(() => { typesRef.current = roomTypes; }, [roomTypes]);
  useEffect(() => { startRef.current = start; }, [start]);

  function validate(bId: string, targetUnitId: string | null, dxDays: number): { valid: boolean; reason: string } {
    const b = bookingsRef.current.find((x) => x.id === bId);
    if (!b) return { valid: false, reason: "—" };
    if (!targetUnitId) return { valid: false, reason: "Fuori griglia" };
    const unit = unitsRef.current.find((u) => u.id === targetUnitId);
    if (!unit) return { valid: false, reason: "Fuori griglia" };
    if (unit.outOfService) return { valid: false, reason: "Fuori servizio" };
    const rt = typesRef.current.find((r) => r.id === unit.roomTypeId);
    const pax = b.adults + b.children;
    if (rt && pax > rt.beds) return { valid: false, reason: `Max ${rt.beds} posti` };
    const newIn = shiftISO(b.checkIn, dxDays);
    const newOut = shiftISO(b.checkOut, dxDays);
    const conflict = bookingsRef.current.some(
      (x) => x.id !== b.id && x.unitId === targetUnitId && x.status !== "cancelled" && rangesOverlap(newIn, newOut, x.checkIn, x.checkOut)
    );
    if (conflict) return { valid: false, reason: "Occupata" };
    return { valid: true, reason: "" };
  }

  function onPointerMove(e: PointerEvent) {
    const s = dragRef.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.hypot(dx, dy) < 5) return;
    s.moved = true;
    const dxDays = 0; // spostamento solo verticale: le date non cambiano mai
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const rowEl = el?.closest("[data-unit-id]") as HTMLElement | null;
    const targetUnitId = rowEl?.getAttribute("data-unit-id") || null;
    const res = validate(s.id, targetUnitId, dxDays);
    setDragView({ id: s.id, dxDays, targetUnitId, x: e.clientX, y: e.clientY, ...res });
  }

  function onPointerUp() {
    const s = dragRef.current;
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    const view = dragViewRef.current;
    setDragView(null);
    if (!s) return;
    if (!s.moved) { const b = bookingsRef.current.find((x) => x.id === s.id); if (b && b.channel === "blocked") openOosEdit(b); else openBooking(s.id); return; } // click semplice → scheda (o editor fuori servizio)
    if (view && view.valid && view.targetUnitId) {
      const b = bookingsRef.current.find((x) => x.id === s.id);
      if (!b) return;
      const prev = { unitId: b.unitId, checkIn: b.checkIn, checkOut: b.checkOut };
      // Chiede conferma prima di applicare lo spostamento.
      setMoveConfirm({ id: s.id, targetUnitId: view.targetUnitId, checkIn: shiftISO(b.checkIn, view.dxDays), checkOut: shiftISO(b.checkOut, view.dxDays), prev });
    }
  }
  const applyMove = () => {
    if (!moveConfirm) return;
    const mc = moveConfirm;
    moveBooking(mc.id, { unitId: mc.targetUnitId, checkIn: mc.checkIn, checkOut: mc.checkOut });
    setMoveConfirm(null);
  };

  function onBarPointerDown(e: React.PointerEvent, bId: string) {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
    dragRef.current = { id: bId, startX: e.clientX, startY: e.clientY, moved: false };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }


  // Geometria barra (cella piena: occupa per intero i giorni pernottati).
  function geom(checkIn: string, checkOut: string) {
    const li = dayIndex(start, checkIn);
    const ri = dayIndex(start, checkOut);
    const cl = Math.max(li, 0);
    const cr = Math.min(ri, dayCount);
    if (cr <= cl) return null;
    return { left: cl * cellW, width: (cr - cl) * cellW };
  }

  // Tariffe: logica UNICA condivisa (override calendario + base derivata + weekend).
  const activeUnits = visibleUnits.filter((u) => !u.outOfService);
  const rateKey = (typeId: string, iso: string) => `${typeId}|${iso}`;
  const weekendPct = loadWeekendPct();
  const rateFor = (typeId: string, iso: string) => rateForDay(typeId, iso, roomTypes, rateOverrides, weekendPct);
  // Striscia tariffa+disponibilità per una singola tipologia.
  const typeStrip = (typeId: string, typeUnits: typeof units) => {
    const act = typeUnits.filter((u) => !u.outOfService);
    return days.map((d) => {
      const iso = toISO(d);
      const occupied = bookings.filter((b) => b.unitId && act.some((u) => u.id === b.unitId) && b.checkIn <= iso && iso < b.checkOut).length;
      const closed = closes[closeKey(typeId, iso)] ?? 0;
      return { iso, rate: rateFor(typeId, iso), overridden: rateOverrides[rateKey(typeId, iso)] != null, avail: Math.max(0, act.length - occupied - closed), closed };
    });
  };
  // Striscia aggregata su più tipologie (vista compatta): disponibilità sommata, tariffa rappresentativa (1ª tipologia).
  const groupStrip = (typeIds: string[], sectionUnits: typeof units) => {
    return days.map((d) => {
      const iso = toISO(d);
      let avail = 0, closed = 0;
      for (const tid of typeIds) {
        const act = sectionUnits.filter((u) => u.roomTypeId === tid && !u.outOfService);
        const occupied = bookings.filter((b) => b.unitId && act.some((u) => u.id === b.unitId) && b.checkIn <= iso && iso < b.checkOut).length;
        const cl = closes[closeKey(tid, iso)] ?? 0;
        avail += Math.max(0, act.length - occupied - cl);
        closed += cl;
      }
      const t0 = typeIds[0];
      return { iso, rate: rateFor(t0, iso), overridden: rateOverrides[rateKey(t0, iso)] != null, avail, closed };
    });
  };
  // Occupazione complessiva (per il grafico in alto).
  const occStrip = days.map((d) => {
    const iso = toISO(d);
    const occupied = bookings.filter((b) => b.unitId && activeUnits.some((u) => u.id === b.unitId) && b.checkIn <= iso && iso < b.checkOut).length;
    return { iso, pct: activeUnits.length ? Math.round((occupied / activeUnits.length) * 100) : 0 };
  });

  const gridW = dayCount * cellW;

  // Grafico occupazione ad area (allineato alle colonne dei giorni).
  const OCC_H = 58;
  const occPad = 8;
  const occX = (i: number) => (i + 0.5) * cellW;
  const occY = (p: number) => OCC_H - occPad - (p / 100) * (OCC_H - occPad * 2);
  // Linea liscia (curva di Catmull-Rom → Bézier) per un tratto morbido.
  const occLine = (() => {
    const pts = occStrip.map((c, i) => [occX(i), occY(c.pct)] as const);
    if (pts.length < 2) return pts.length ? `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}` : "";
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  })();
  const occArea = occStrip.length ? `${occLine} L ${occX(occStrip.length - 1).toFixed(1)} ${OCC_H} L ${occX(0).toFixed(1)} ${OCC_H} Z` : "";
  const avgOcc = occStrip.length ? Math.round(occStrip.reduce((a, c) => a + c.pct, 0) / occStrip.length) : 0;
  const occGridY = [100, 50].map((p) => ({ p, y: occY(p) }));

  // ===== INSIGHTS sul periodo visibile =====
  const periodFrom = days.length ? toISO(days[0]) : todayISO;
  const periodTo = days.length ? toISO(addDays(days[days.length - 1], 1)) : todayISO;
  const daysBetween = (a: string, b: string) => Math.max(0, Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000));
  // Occupazione per giorno (per i suggerimenti del Copilota).
  const occByDay = days.map((d, i) => ({ iso: toISO(d), d, occ: occStrip[i]?.pct ?? 0 }));
  // Buchi da riempire: vuoti di 1-2 notti tra due prenotazioni consecutive nella stessa camera.
  const gaps: { unit: (typeof units)[number]; from: string; to: string; nights: number }[] = [];
  activeUnits.forEach((u) => {
    const ubk = bookings.filter((b) => b.unitId === u.id && b.channel !== "blocked" && b.status !== "cancelled" && b.checkOut > periodFrom && b.checkIn < periodTo).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    for (let k = 0; k < ubk.length - 1; k++) { const end = ubk[k].checkOut, next = ubk[k + 1].checkIn; if (next > end) { const n = daysBetween(end, next); if (n >= 1 && n <= 2) gaps.push({ unit: u, from: end, to: next, nights: n }); } }
  });
  const gapNights = gaps.reduce((a, g) => a + g.nights, 0);
  const gapValue = gaps.reduce((a, g) => { let dd = parseISO(g.from); const end = parseISO(g.to); let sum = 0; while (dd < end) { sum += rateFor(g.unit.roomTypeId, toISO(dd)); dd = addDays(dd, 1); } return a + sum; }, 0);
  // Formattatori data con mese (es. "sab 12 ago") per rendere i testi inequivocabili.
  const monthShort = (d: Date) => d.toLocaleDateString("it-IT", { month: "short" }).replace(".", "");
  const fmtDM = (d: Date) => `${weekdayShort(d)} ${d.getDate()} ${monthShort(d)}`;
  const fmtRange = (aIso: string, bIso: string) => { const a = parseISO(aIso), b = parseISO(bIso); const am = monthShort(a), bm = monthShort(b); return am === bm ? `${a.getDate()}–${b.getDate()} ${bm}` : `${a.getDate()} ${am} – ${b.getDate()} ${bm}`; };
  // Applica una variazione percentuale ai prezzi di una tipologia su un intervallo di date [fromIso, toIso).
  const applyPctRange = (typeId: string, fromIso: string, toIso: string, pct: number) => { const map: Record<string, number> = {}; let dd = parseISO(fromIso); const end = parseISO(toIso); while (dd < end) { const iso = toISO(dd); map[`${typeId}|${iso}`] = Math.round(rateFor(typeId, iso) * (1 + pct / 100)); dd = addDays(dd, 1); } setDayRates(map); };
  // Suggerimenti Copilota (priorità: alta occupazione → alza; buchi → riempi; bassa → apri).
  const futureDemand = occByDay.filter((x) => x.iso >= todayISO);
  // Alta occupazione MA non piena: a camere esaurite (100%) non ha senso alzare il prezzo (niente da vendere).
  const hotDay = futureDemand.filter((x) => x.occ >= 80 && x.occ < 100).sort((a, b) => b.occ - a.occ)[0];
  const coldDay = futureDemand.filter((x) => x.occ <= 25).sort((a, b) => a.occ - b.occ)[0];
  const firstType = roomTypes.find((rt) => visibleStructures.some((s) => s.id === rt.structureId) && units.some((u) => u.roomTypeId === rt.id));
  type Sugg = { icon: string; color: string; text: string; apply?: () => void; cta: string; dir?: "up" | "down"; subject?: string; detail?: string; from?: number; to?: number };
  const suggestions: Sugg[] = [];
  if (hotDay && firstType) { const cur = rateFor(firstType.id, hotDay.iso); const nw = Math.round(cur * 1.15); suggestions.push({ icon: "▲", color: "var(--ok)", text: `${fmtDM(hotDay.d)} quasi pieno (${hotDay.occ}%): alza ${firstType.name} a €${nw} (+15%).`, cta: "Applica +15%", dir: "up", subject: firstType.name, detail: fmtDM(hotDay.d), from: cur, to: nw, apply: () => setDayRates({ [`${firstType.id}|${hotDay.iso}`]: nw }) }); }
  if (gaps[0]) { const g = gaps[0]; const rt = g.unit.roomTypeId; const cur = rateFor(rt, g.from); const nw = Math.round(cur * 0.85); suggestions.push({ icon: "🕳️", color: "var(--warn)", text: `Buco di ${g.nights} ${g.nights === 1 ? "notte" : "notti"} in ${g.unit.name} (${fmtRange(g.from, g.to)}): abbassa il prezzo del 15% per riempire.`, cta: "Applica −15%", dir: "down", subject: g.unit.name, detail: fmtRange(g.from, g.to), from: cur, to: nw, apply: () => applyPctRange(rt, g.from, g.to, -15) }); }
  if (coldDay && firstType) { const cur = rateFor(firstType.id, coldDay.iso); const nw = Math.round(cur * 0.9); suggestions.push({ icon: "▼", color: "var(--err)", text: `${fmtDM(coldDay.d)} scarica (${coldDay.occ}%): abbassa ${firstType.name} a €${nw} (−10%) per riempire.`, cta: "Applica −10%", dir: "down", subject: firstType.name, detail: fmtDM(coldDay.d), from: cur, to: nw, apply: () => setDayRates({ [`${firstType.id}|${coldDay.iso}`]: nw }) }); }
  if (!suggestions.length) suggestions.push({ icon: "✓", color: "var(--ok)", text: "Nel periodo visibile è tutto in equilibrio: nessuna azione urgente.", cta: "" });
  // What-if: ricavi previsti del periodo + impatto stimato dello slider prezzo.
  const periodRevenue = Math.round(bookings.filter((b) => b.channel !== "blocked" && b.status !== "cancelled" && b.checkOut > periodFrom && b.checkIn < periodTo && visibleStructures.some((s) => s.id === b.structureId)).reduce((a, b) => { const s = b.checkIn > periodFrom ? b.checkIn : periodFrom; const e = b.checkOut < periodTo ? b.checkOut : periodTo; const n = daysBetween(s, e); return a + (b.total ?? 0) * (n / Math.max(1, nights(b.checkIn, b.checkOut))); }, 0));
  // Elasticità: ogni -1% di prezzo riempie ~0,8 punti di occupazione (e viceversa), con tetto 0-100.
  const newOcc = Math.max(0, Math.min(100, avgOcc - whatIf * 0.8));
  const simOcc = Math.round(newOcc);
  const occRatio = avgOcc > 0 ? newOcc / avgOcc : 1;
  const simRevenue = Math.round(periodRevenue * (1 + whatIf / 100) * occRatio);
  // Applica la variazione dello slider a TUTTI i prezzi delle tipologie visibili, sull'intera finestra.
  // Applica la variazione % del simulatore a tutte le tipologie visibili, sul periodo scelto [fromIso, toIso].
  const applyWhatIfRange = (fromIso: string, toIso: string, pct: number) => { if (!pct) return; const scope = roomTypes.filter((rt) => visibleStructures.some((s) => s.id === rt.structureId) && units.some((u) => u.roomTypeId === rt.id)); const map: Record<string, number> = {}; for (const rt of scope) for (const iso of rangeIsos(fromIso, toIso)) { map[`${rt.id}|${iso}`] = Math.round(rateFor(rt.id, iso) * (1 + pct / 100)); } setDayRates(map); setWhatIf(0); };
  // Prenotazioni che coprono il periodo (per pickup e alert).
  const bkPeriod = bookings.filter((b) => b.channel !== "blocked" && b.status !== "cancelled" && b.checkOut > periodFrom && b.checkIn < periodTo && visibleStructures.some((s) => s.id === b.structureId));
  // Pickup: nuove prenotazioni (per data prenotazione) negli ultimi 14 giorni.
  const pickupDays = Array.from({ length: 14 }, (_, k) => { const d = addDays(parseISO(todayISO), -13 + k); const iso = toISO(d); return { iso, d, n: bkPeriod.filter((b) => b.bookedOn === iso).length }; });
  const pickupMax = Math.max(1, ...pickupDays.map((x) => x.n));
  const pickLast7 = pickupDays.slice(7).reduce((a, x) => a + x.n, 0);
  const pickPrev7 = pickupDays.slice(0, 7).reduce((a, x) => a + x.n, 0);
  const pickVerdict = pickLast7 > pickPrev7 ? { t: "più veloce del solito", c: "var(--ok)" } : pickLast7 < pickPrev7 ? { t: "più lento del solito", c: "var(--err)" } : { t: "in linea col solito", c: "var(--dim)" };
  const pickDelta = pickLast7 - pickPrev7;
  // Alert "Da controllare" sul periodo.
  const calAlerts: { n: number; label: string; color: string; icon: string; sev: "err" | "warn"; href: string }[] = [];
  const unassignedN = bkPeriod.filter((b) => !b.unitId).length;
  if (unassignedN) calAlerts.push({ n: unassignedN, label: "senza camera assegnata", color: "var(--err)", icon: "🛏️", sev: "err", href: "/prenotazioni" });
  let overbookN = 0;
  activeUnits.forEach((u) => { const bk = bookings.filter((b) => b.unitId === u.id && b.status !== "cancelled" && b.checkOut > periodFrom && b.checkIn < periodTo).sort((a, b) => a.checkIn.localeCompare(b.checkIn)); for (let k = 0; k < bk.length - 1; k++) if (bk[k + 1].checkIn < bk[k].checkOut) overbookN++; });
  if (overbookN) calAlerts.push({ n: overbookN, label: "sovrapposizioni (overbooking)", color: "var(--err)", icon: "⛔", sev: "err", href: "/prenotazioni" });
  const noPriceN = bkPeriod.filter((b) => !(b.total && b.total > 0)).length;
  if (noPriceN) calAlerts.push({ n: noPriceN, label: "prenotazioni senza prezzo", color: "var(--warn)", icon: "💶", sev: "warn", href: "/prenotazioni" });
  let zeroRateN = 0;
  roomTypes.filter((rt) => visibleStructures.some((s) => s.id === rt.structureId) && units.some((u) => u.roomTypeId === rt.id)).forEach((rt) => days.forEach((d) => { if (rateFor(rt.id, toISO(d)) <= 0) zeroRateN++; }));
  if (zeroRateN) calAlerts.push({ n: zeroRateN, label: "giorni con tariffa a €0", color: "var(--warn)", icon: "🏷️", sev: "warn", href: "/calendario" });
  const alertTotal = calAlerts.reduce((a, x) => a + x.n, 0);
  const alertWorst = calAlerts.some((a) => a.sev === "err") ? "var(--err)" : "var(--warn)";

  // Prossimi movimenti: arrivi / partenze / turnover nei prossimi 7 giorni.
  const moveTo = toISO(addDays(parseISO(todayISO), 7));
  const moveBk = bookings.filter((b) => b.channel !== "blocked" && b.status !== "cancelled" && visibleStructures.some((s) => s.id === b.structureId));
  type Mv = { iso: string; d: Date; kind: "in" | "out"; b: (typeof moveBk)[number]; turn: boolean };
  const moves: Mv[] = [];
  moveBk.forEach((b) => { if (b.checkIn >= todayISO && b.checkIn < moveTo) moves.push({ iso: b.checkIn, d: parseISO(b.checkIn), kind: "in", b, turn: isTurnover(b) }); if (b.checkOut >= todayISO && b.checkOut < moveTo) moves.push({ iso: b.checkOut, d: parseISO(b.checkOut), kind: "out", b, turn: false }); });
  moves.sort((a, b) => a.iso.localeCompare(b.iso) || (a.kind === b.kind ? 0 : a.kind === "out" ? -1 : 1));
  const arrivalsN = moves.filter((m) => m.kind === "in").length;
  const departuresN = moves.filter((m) => m.kind === "out").length;
  const turnoverN = moves.filter((m) => m.kind === "in" && m.turn).length;
  const relDay = (iso: string) => (iso === todayISO ? "oggi" : iso === toISO(addDays(parseISO(todayISO), 1)) ? "domani" : fmtDM(parseISO(iso)));
  const unitNameOf = (id: string | null) => (id ? units.find((u) => u.id === id)?.name ?? "—" : "da assegnare");

  // Mix canali & commissioni sul periodo.
  const chAgg = (["booking", "airbnb", "expedia", "other", "direct"] as const).map((ch) => { const list = bkPeriod.filter((b) => b.channel === ch); const revenue = list.reduce((a, b) => a + (b.total ?? 0), 0); const commission = list.reduce((a, b) => { const pct = b.commissionPct ?? CHANNELS[ch].commission * 100; return a + (b.total ?? 0) * pct / 100; }, 0); return { ch, meta: CHANNELS[ch], n: list.length, revenue, commission }; }).filter((x) => x.n > 0);
  const chTotalN = chAgg.reduce((a, x) => a + x.n, 0);
  const chCommission = Math.round(chAgg.reduce((a, x) => a + x.commission, 0));
  const directShare = chTotalN ? Math.round(((chAgg.find((x) => x.ch === "direct")?.n ?? 0) / chTotalN) * 100) : 0;

  // ADR (tariffa media venduta) e RevPAR (ricavo per camera disponibile), con confronto vs periodo precedente.
  const periodLen = Math.max(1, daysBetween(periodFrom, periodTo));
  const soldNights = bkPeriod.reduce((a, b) => { const s = b.checkIn > periodFrom ? b.checkIn : periodFrom; const e = b.checkOut < periodTo ? b.checkOut : periodTo; return a + Math.max(0, daysBetween(s, e)); }, 0);
  const availNights = Math.max(1, activeUnits.length * periodLen);
  const adr = soldNights ? Math.round(periodRevenue / soldNights) : 0;
  const revpar = Math.round(periodRevenue / availNights);
  const prevFrom = toISO(addDays(parseISO(periodFrom), -periodLen));
  const prevBk = bookings.filter((b) => b.channel !== "blocked" && b.status !== "cancelled" && b.checkOut > prevFrom && b.checkIn < periodFrom && visibleStructures.some((s) => s.id === b.structureId));
  const prevRevenue = Math.round(prevBk.reduce((a, b) => { const s = b.checkIn > prevFrom ? b.checkIn : prevFrom; const e = b.checkOut < periodFrom ? b.checkOut : periodFrom; const n = daysBetween(s, e); return a + (b.total ?? 0) * (n / Math.max(1, nights(b.checkIn, b.checkOut))); }, 0));
  const prevSold = prevBk.reduce((a, b) => { const s = b.checkIn > prevFrom ? b.checkIn : prevFrom; const e = b.checkOut < periodFrom ? b.checkOut : periodFrom; return a + Math.max(0, daysBetween(s, e)); }, 0);
  const prevAdr = prevSold ? Math.round(prevRevenue / prevSold) : 0;
  const prevRevpar = Math.round(prevRevenue / availNights);
  const adrDelta = prevAdr ? Math.round(((adr - prevAdr) / prevAdr) * 100) : 0;
  const revparDelta = prevRevpar ? Math.round(((revpar - prevRevpar) / prevRevpar) * 100) : 0;

  // Riga di una singola camera (usata dentro il raggruppamento per tipologia).
  const unitRow = (unit: (typeof units)[number], s: (typeof structures)[number]) => {
    const uBookings = bookings.filter((b) => b.unitId === unit.id);
    const ghost = dragView && dragView.targetUnitId === unit.id ? dragView : null;
    // Movimenti di OGGI (monocromatico): arrivo, partenza, turnover, occupata, libera, fuori servizio.
    const todayIso = toISO(new Date());
    const nc = (b: (typeof uBookings)[number]) => b.status !== "cancelled";
    const arrToday = uBookings.some((b) => nc(b) && b.checkIn === todayIso);
    const depToday = uBookings.some((b) => nc(b) && b.checkOut === todayIso);
    const stayNow = uBookings.find((b) => nc(b) && b.checkIn <= todayIso && todayIso < b.checkOut);
    const arrowP = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    // Sempre entrambe le icone: entrata verde se arrivo oggi, uscita rossa se partenza oggi; grigie se assenti.
    const inArrow = <span className="shrink-0" style={{ color: arrToday ? "var(--ok)" : "var(--faint)" }} title={arrToday ? "Arrivo oggi" : "Nessun arrivo oggi"}><svg {...arrowP}><path d="M20 4v16" /><path d="M4 12h12" /><path d="M12 8l4 4-4 4" /></svg></span>;
    const outArrow = <span className="shrink-0" style={{ color: depToday ? "var(--err)" : "var(--faint)" }} title={depToday ? "Partenza oggi" : "Nessuna partenza oggi"}><svg {...arrowP}><path d="M4 4v16" /><path d="M8 12h12" /><path d="M16 8l4 4-4 4" /></svg></span>;
    const statusEl = unit.outOfService
      ? <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] font-bold leading-none text-dim" style={{ borderColor: "var(--dim)" }} title="Fuori servizio">!</span>
      : <span className="flex shrink-0 items-center gap-0.5">{inArrow}{outArrow}</span>;
    // Pulizia: ALLINEATA alla pagina Pulizie (fonte di verità) → serve se c'è arrivo, partenza
    // o un soggiorno in corso (riassetto). Niente più logica separata su giorni-di-servizio,
    // che creava incongruenze tra Calendario e Pulizie.
    const daysIn = stayNow ? Math.round((Date.parse(todayIso) - Date.parse(stayNow.checkIn)) / 86400000) : 0;
    const needsClean = !unit.outOfService && (arrToday || depToday || !!stayNow);
    const cleanedToday = !!cleanDone[`${unit.id}:${todayIso}`];
    const broom = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 4L9.5 14.5" /><path d="M13 8l3 3" /><path d="M9.5 14.5l-4.5 1 -1 4.5 4.5 -1 4.5 -1 -3.5 -3.5z" /><path d="M6 16l2 2" /></svg>;
    const cleanColor = !needsClean ? "var(--faint)" : cleanedToday ? "var(--ok)" : "var(--warn)";
    const cleanTitle = !needsClean ? "Nessuna pulizia oggi" : cleanedToday ? "Camera pulita oggi" : "Camera da pulire";
    const cleanEl = <span className="shrink-0" style={{ color: cleanColor }} title={cleanTitle}>{broom}</span>;
    // Icona cambio lenzuola: dovuto ad arrivo/partenza o ogni N giorni (Frequenza cambio lenzuola).
    const linenN = freqDays(unit.linenFreq);
    const linenDue = !unit.outOfService && (arrToday || depToday || (!!stayNow && linenN > 0 && daysIn > 0 && daysIn % linenN === 0));
    const linenDoneToday = !!linenDone[`${unit.id}:${todayIso}`];
    const linenColor = !linenDue ? "var(--faint)" : linenDoneToday ? "var(--ok)" : "var(--focus)";
    const linenTitle = !linenDue ? "Nessun cambio lenzuola oggi" : linenDoneToday ? "Lenzuola cambiate oggi" : "Lenzuola da cambiare";
    const linenEl = <span className="shrink-0" style={{ color: linenColor }} title={linenTitle}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8v10" /><path d="M3 14h18" /><path d="M21 18v-5a3 3 0 0 0-3-3H9v4" /><path d="M6 11.5h.01" /></svg></span>;
    return (
      <div key={unit.id} className="flex border-b border-line">
        <div className="sticky left-0 z-10 flex min-w-0 shrink-0 items-center gap-1.5 border-r border-line bg-surface px-3" style={{ width: LABEL_W, height: rowH }}>
          {showRoomIcons && <>{statusEl}{cleanEl}{linenEl}</>}
          <button onClick={() => setRoomInfoId(unit.id)} title="Apri scheda camera" className={`min-w-0 flex-1 truncate whitespace-nowrap text-left text-[13px] font-medium hover:text-focus hover:underline ${unit.outOfService ? "text-faint line-through" : "text-txt"}`}>{unit.name}</button>
          {vw.group === "type" && <span className="shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: `color-mix(in srgb, ${s.photoColor ?? "var(--faint)"} 20%, transparent)`, color: s.photoColor ?? "var(--dim)" }} title={s.name}>{initials(s.name)}</span>}
        </div>
        <div className="relative" data-unit-id={unit.id} style={{ width: gridW, height: rowH }}>
          {days.map((d, i) => {
            const iso = toISO(d);
            const inSel = sel?.kind === "booking" && sel.unitId === unit.id && !!(selLo && selHi && iso >= selLo && iso <= selHi);
            return (
              <div
                key={i}
                onClick={unit.outOfService ? undefined : () => clickCell(unit, s.id, iso)}
                onMouseEnter={() => { if (sel?.kind === "booking" && sel.unitId === unit.id) setSelHover(iso); }}
                title={unit.outOfService ? undefined : sel?.kind === "booking" && sel.unitId === unit.id ? "Clicca il giorno di partenza" : "Clicca per iniziare (poi clicca il giorno finale)"}
                className={`group absolute top-0 border-r border-line ${unit.outOfService ? "" : "cursor-pointer"}`}
                style={{ left: i * cellW, width: cellW, height: rowH, ...(inSel ? { backgroundColor: "color-mix(in srgb, var(--focus) 20%, transparent)" } : {}), ...(iso === todayISO ? { boxShadow: "inset 1px 0 0 var(--focus)" } : {}) }}
              >
                {!unit.outOfService && !inSel && (
                  <span className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100" style={{ background: "color-mix(in srgb, var(--focus) 10%, transparent)" }} />
                )}
              </div>
            );
          })}
          {unit.outOfService && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "#242424", boxShadow: "inset 3px 0 0 #f5c000" }}>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: "#f5c000" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a2 2 0 1 0 2.8 2.8l6-6a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.1-2.1z" /></svg>
                Fuori servizio
              </span>
            </div>
          )}
          {!unit.outOfService && uBookings.map((b) => {
            const g = geom(b.checkIn, b.checkOut);
            if (!g) return null;
            const meta = CHANNELS[b.channel];
            const dragging = dragView?.id === b.id;
            const blocked = b.channel === "blocked";
            const pax = b.adults + b.children;
            const wide = g.width > 88;
            const xwide = g.width > 148;
            const gtot = b.total ? bookingGrandTotal(b, structures.find((s) => s.id === b.structureId)) : 0; // totale unico (soggiorno+pulizia+extra+tassa)
            const extra = blocked ? "" : [wide && `${pax}p`, xwide && gtot ? `€${Math.round(gtot)}` : ""].filter(Boolean).join(" · ");
            const tentative = !blocked && b.status === "tentative";
            const sotto = barStyle === "sotto";
            const barColor = blocked
              ? { backgroundColor: "#242424", color: "#f5c000", boxShadow: "inset 3px 0 0 #f5c000, 0 1px 1px rgba(0,0,0,.2)" }
              : { backgroundColor: `var(${meta.cssVar})`, color: meta.text, boxShadow: "inset 3px 0 0 rgba(0,0,0,.28), 0 1px 1px rgba(0,0,0,.14)" };
            const label = blocked ? "Fuori servizio" : guestName(b.guestId);
            const pay = payStatusOf(b);
            const bday = !blocked && bdayInStay(b.guestId, b.checkIn, b.checkOut);
            const noSched = !blocked && !schedinaOk(b.guestId);
            const turn = !blocked && isTurnover(b);
            const grp = !blocked && !!b.groupId;
            const chLetter = ({ booking: "B", airbnb: "A", expedia: "E", other: "O", direct: "D", blocked: "" } as Record<string, string>)[b.channel] ?? "";
            const chChip = !blocked && chLetter ? (
              <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] bg-white text-[8px] font-extrabold leading-none" style={{ color: `var(${meta.cssVar})` }} title={meta.label}>{chLetter}</span>
            ) : null;
            const chChipSotto = !blocked && chLetter ? (
              <span className="grid h-3 w-3 shrink-0 place-items-center rounded-[2px] text-[7px] font-extrabold leading-none text-white" style={{ backgroundColor: `var(${meta.cssVar})` }} title={meta.label}>{chLetter}</span>
            ) : null;
            const icons = !blocked && wide ? (
              <span className="flex shrink-0 items-center gap-1 pr-1.5" style={{ color: meta.text }}>
                {b.movedFrom && <span title={`Spostata da ${b.movedFrom.structureName || "un'altra struttura"}`} className="grid h-3.5 min-w-3.5 place-items-center rounded-full px-0.5 text-[9px] font-bold leading-none" style={{ backgroundColor: "#fff", color: "var(--warn)" }}>⇄</span>}
                {grp && <span title="Prenotazione di gruppo · camere collegate" className="text-[11px] leading-none">⛓</span>}
                {turn && <span title="Turnover · check-out e check-in stesso giorno" className="text-[10px] leading-none">⚡</span>}
                {bday && <span title="Compleanno durante il soggiorno"><Icon name="cake" size={11} /></span>}
                {noSched && <span title="Schedina alloggiati da completare" className="grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] font-bold leading-none" style={{ backgroundColor: "rgba(255,255,255,.28)" }}>!</span>}
                <span title={`Pagamento: ${pay === "paid" ? "saldato" : pay === "partial" ? "acconto" : "da incassare"}`} className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PAY_DOT[pay], boxShadow: "0 0 0 1.5px rgba(255,255,255,.75)" }} />
              </span>
            ) : null;
            return (
              <div
                key={b.id}
                onPointerDown={(e) => onBarPointerDown(e, b.id)}
                title={`${blocked ? `Fuori servizio${b.note ? ` · ${b.note}` : ""}` : `${guestName(b.guestId)} · ${pax} ospiti${gtot ? ` · €${Math.round(gtot)}` : ""}`} · ${b.checkIn} → ${b.checkOut}${tentative ? " · opzione" : ""}`}
                className={`absolute overflow-hidden ${sotto ? "flex cursor-grab flex-col justify-end active:cursor-grabbing" : "cursor-grab active:cursor-grabbing"}`}
                style={{ left: g.left + 1, width: g.width - 2, top: 1, height: rowH - 2, opacity: dragging ? 0.35 : tentative ? 0.72 : 1, pointerEvents: dragView ? "none" : "auto", touchAction: "none" }}
              >
                {sotto ? (
                  <>
                    <span className="flex items-center gap-1 truncate pl-0.5 text-[9px] font-medium leading-none text-txt">
                      {chChipSotto}
                      <span className="truncate">{label}{extra && <span className="text-faint"> · {extra}</span>}</span>
                      {!blocked && (
                        <span className="ml-1 flex shrink-0 items-center gap-0.5">
                          {b.movedFrom && <span title={`Spostata da ${b.movedFrom.structureName || "un'altra struttura"}`} className="font-bold" style={{ color: "var(--warn)" }}>⇄</span>}
                          {bday && <span title="Compleanno" style={{ color: "#DB2777" }}><Icon name="cake" size={10} /></span>}
                          {noSched && <span title="Schedina da completare" className="font-bold text-[color:var(--warn)]">!</span>}
                          <span title="Pagamento" className="h-2 w-2 rounded-full" style={{ backgroundColor: PAY_DOT[pay] }} />
                        </span>
                      )}
                    </span>
                    <div className="mt-px w-full" style={{ height: 11, borderRadius: 3, ...barColor, ...(tentative ? { outline: "1px dashed rgba(255,255,255,.75)", outlineOffset: -2 } : {}) }} />
                  </>
                ) : (
                  <div className="flex h-full items-center overflow-hidden text-[11px] font-medium" style={{ borderRadius: 3, ...barColor, ...(tentative ? { outline: "1px dashed rgba(255,255,255,.75)", outlineOffset: -3 } : {}) }}>
                    {chChip && <span className="pl-1.5">{chChip}</span>}
                    <span className={`min-w-0 flex-1 truncate ${chChip ? "pl-1" : "pl-2.5"} pr-1 ${blocked ? "italic" : ""}`}>
                      {blocked ? (
                        <span className="inline-flex items-center gap-1 font-semibold not-italic">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a2 2 0 1 0 2.8 2.8l6-6a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.1-2.1z" /></svg>
                          {b.note ?? "Fuori servizio"}
                        </span>
                      ) : guestName(b.guestId)}
                      {extra && <span className="opacity-80"> · {extra}</span>}
                    </span>
                    {icons}
                  </div>
                )}
              </div>
            );
          })}
          {ghost && (() => {
            const b = bookings.find((x) => x.id === ghost.id);
            if (!b) return null;
            const g = geom(b.checkIn, b.checkOut);
            if (!g) return null;
            return (
              <div className="pointer-events-none absolute border-2 border-dashed" style={{ left: g.left, width: g.width, top: 0, height: rowH, borderColor: ghost.valid ? "var(--focus)" : "var(--err)", background: ghost.valid ? "color-mix(in srgb, var(--focus) 15%, transparent)" : "color-mix(in srgb, var(--err) 15%, transparent)" }} />
            );
          })()}
        </div>
      </div>
    );
  };

  // Sezione tipologia (riutilizzata da vista Esplosa e Compatta). keyId = chiave per selezione/click; typeIds = tipologie reali coinvolte.
  const renderTypeSection = (opts: { keyId: string; name: string; beds: number; typeIds: string[]; sectionUnits: typeof units; editableAvail: boolean }) => {
    const { keyId, name, beds, typeIds, sectionUnits, editableAvail } = opts;
    const gStrip = groupStrip(typeIds, sectionUnits);
    const cap = sectionUnits.filter((u) => typeIds.includes(u.roomTypeId) && !u.outOfService).length;
    const secUnits = sortUnitsByName(sectionUnits.filter((u) => typeIds.includes(u.roomTypeId)));
    return (
      <div key={keyId} className="border-t-2 border-line">
        {vw.rate && (
        <div className="flex border-b border-line bg-surface">
          <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface px-3 uppercase tracking-wide" style={{ width: LABEL_W, height: 26 }}>
            <span className="truncate text-[11px] font-bold text-dim">{name}</span>
            <span className="shrink-0 text-[9px] font-normal text-faint">{beds}p · Tariffa</span>
          </div>
          <div className="flex" style={{ width: gridW, height: 26 }}>
            {gStrip.map((c, i) => {
              const inSel = sel?.kind === "rate" && sel.typeId === keyId && !!(selLo && selHi && c.iso >= selLo && c.iso <= selHi);
              const prevRate = i > 0 ? gStrip[i - 1].rate : c.rate;
              const trend = c.rate > prevRate ? "up" : c.rate < prevRate ? "down" : null;
              const trendCol = trend === "up" ? "var(--ok)" : trend === "down" ? "var(--err)" : null;
              const diff = Math.abs(c.rate - prevRate);
              const zero = c.rate <= 0; // prezzo mancante: la camera non è vendibile
              return (
                <div key={c.iso} onClick={() => clickRate(keyId, c.iso, typeIds)} onMouseEnter={() => { if (sel?.kind === "rate" && sel.typeId === keyId) setSelHover(c.iso); }}
                  title={sel?.kind === "rate" ? "Clicca il giorno finale" : zero ? "Tariffa a €0 — imposta un prezzo, la camera non è vendibile. Clicca per modificare." : `Tariffa €${c.rate}${trend ? ` · ${trend === "up" ? "+" : "−"}€${diff} vs giorno prima` : ""}. Clicca per modificare (poi clicca il giorno finale).`}
                  className={`flex cursor-pointer items-center justify-center gap-0.5 border-r border-line font-mono text-[11px] tabular-nums hover:bg-wash ${zero ? "font-bold" : "font-semibold"}`}
                  style={{ width: cellW, color: zero ? "var(--err)" : c.overridden ? "var(--focus)" : "var(--dim)", ...(inSel ? { backgroundColor: "color-mix(in srgb, var(--focus) 20%, transparent)" } : zero ? { backgroundColor: "color-mix(in srgb, var(--err) 16%, transparent)" } : trendCol ? { backgroundColor: `color-mix(in srgb, ${trendCol} 12%, transparent)` } : {}) }}>
                  {zero ? <span className="text-[8px] leading-none">⚠</span> : trendCol && <span className="text-[8px] leading-none" style={{ color: trendCol }}>{trend === "up" ? "▲" : "▼"}</span>}
                  <span style={{ opacity: 0.65 }}>€</span>{c.rate}
                </div>
              );
            })}
          </div>
        </div>
        )}
        {vw.avail && (
        <div className="flex border-b border-line bg-surface">
          <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface px-3 uppercase tracking-wide" style={{ width: LABEL_W, height: 26 }}>
            {!vw.rate && <span className="truncate text-[11px] font-bold text-dim">{name}</span>}
            <span className="text-[10px] font-semibold text-faint">Disponibilità</span>
          </div>
          <div className="flex" style={{ width: gridW, height: 26 }}>
            {gStrip.map((c) => {
              const inSel = editableAvail && sel?.kind === "avail" && sel.typeId === keyId && !!(selLo && selHi && c.iso >= selLo && c.iso <= selHi);
              const noRate = c.rate <= 0; // tariffa mancante → chiusa alla vendita (automatico)
              // Riga disponibilità a colore pieno: verde = disponibile, arancione = 1 camera, rosso = pieno.
              const full = c.avail <= 0;
              const scarce = c.avail === 1 && cap > 1;
              const availBg = full ? "var(--err)" : scarce ? "var(--warn)" : "var(--ok)";
              const availText = scarce ? "#3a2600" : "#ffffff";
              return (
                <div key={c.iso}
                  onClick={editableAvail ? () => clickAvail(keyId, c.iso) : undefined}
                  onMouseEnter={() => { if (editableAvail && sel?.kind === "avail" && sel.typeId === keyId) setSelHover(c.iso); }}
                  title={noRate ? "Tariffa mancante (€0): camera chiusa alla vendita. Imposta un prezzo per riaprirla." : editableAvail ? (sel?.kind === "avail" ? "Clicca il giorno finale" : `${c.avail} disponibili${c.closed ? ` · ${c.closed} chiuse alla vendita` : ""}. Clicca per chiudere/riaprire le vendite (poi clicca il giorno finale).`) : `${c.avail} disponibili (somma tipologie). Modifica nella vista Esplosa.`}
                  className={`flex items-center justify-center border-r border-line ${editableAvail ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
                  style={{ width: cellW, backgroundColor: inSel ? "color-mix(in srgb, var(--focus) 45%, var(--ok))" : noRate ? "var(--err)" : availBg }}>
                  {noRate ? (
                    <span title="Chiusa · tariffa mancante" className="font-mono text-[11px] font-bold" style={{ color: "#fff" }}>✕</span>
                  ) : (
                    <span className="inline-flex items-center justify-center gap-0.5 font-mono text-xs font-bold tabular-nums" style={{ color: availText }}>
                      {c.closed ? <span title={`${c.closed} chiuse`} className="text-[9px]" style={{ color: "#fff" }}>✕</span> : null}{c.avail}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}
        {secUnits.map((unit) => { const su = structures.find((x) => x.id === unit.structureId)!; return (
          <div key={unit.id}>
            {unitRow(unit, su)}
            {vw.emptyRow && <div className="border-b border-line bg-wash/30" style={{ height: 6 }} />}
          </div>
        ); })}
      </div>
    );
  };

  return (
    <div ref={wrapRef} className="flex flex-col gap-3 select-none">
      {/* Riga filtri — data (jump), navigazione, menu Visualizza */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
        {/* Menu Visualizza — spostato dopo i mesi (order) */}
        <div ref={vizRef} className="relative order-3">
          <button onClick={() => setVizOpen((o) => !o)} title="Visualizza" className={`grid h-9 w-9 place-items-center rounded-lg border transition ${vizOpen ? "border-focus text-focus" : "border-line text-txt hover:bg-wash"}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          {vizOpen && (
            <div className="absolute left-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl">
              <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Vista</div>
              <div className="mb-1 grid grid-cols-2 gap-1 px-1.5">
                {([["type", "Compatta"], ["struct", "Esplosa"]] as ["type" | "struct", string][]).map(([v, lab]) => (
                  <button key={v} onClick={() => patchView({ group: v })} title={v === "type" ? "Raggruppa per tipologia (tipologie uguali unite)" : "Dividi per struttura, poi per tipologia"} className={`rounded-md py-1 text-xs font-semibold transition ${vw.group === v ? "bg-focus text-white" : "bg-wash text-dim hover:text-txt"}`}>{lab}</button>
                ))}
              </div>
              <div className="my-1 border-t border-line" />
              <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Finestra</div>
              <div className="mb-1 grid grid-cols-2 gap-1 px-1.5">
                {([[7, "7 giorni"], ["month", "Mensile"]] as [Span, string][]).map(([v, lab]) => (
                  <button key={String(v)} onClick={() => patchView({ span: v })} className={`rounded-md py-1 text-xs font-semibold transition ${vw.span === v ? "bg-focus text-white" : "bg-wash text-dim hover:text-txt"}`}>{lab}</button>
                ))}
              </div>
              <MenuToggle label="Inizia da ieri" on={vw.fromYesterday} onClick={() => { const nf = !vw.fromYesterday; patchView({ fromYesterday: nf }); if (vw.span !== "month") { const t = new Date(); const base = new Date(t.getFullYear(), t.getMonth(), t.getDate()); setStart(nf ? addDays(base, -1) : base); } }} />
              <div className="my-1 border-t border-line" />
              <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Righe</div>
              <MenuToggle label="Tariffa" on={vw.rate} onClick={() => patchView({ rate: !vw.rate })} />
              <MenuToggle label="Disponibilità" on={vw.avail} onClick={() => patchView({ avail: !vw.avail })} />
              <MenuToggle label="Tasso di occupazione" on={vw.occ} onClick={() => patchView({ occ: !vw.occ })} />
              <div className="my-1 border-t border-line" />
              <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Etichetta barra</div>
              <div className="mb-1 grid grid-cols-2 gap-1 px-1.5">
                <button onClick={() => setBars("dentro")} className={`rounded-md py-1 text-xs font-semibold transition ${barStyle === "dentro" ? "bg-focus text-white" : "bg-wash text-dim hover:text-txt"}`}>Dentro</button>
                <button onClick={() => setBars("sotto")} className={`rounded-md py-1 text-xs font-semibold transition ${barStyle === "sotto" ? "bg-focus text-white" : "bg-wash text-dim hover:text-txt"}`}>Sotto</button>
              </div>
              <div className="my-1 border-t border-line" />
              <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Etichette camera</div>
              <MenuToggle label="Icone (arrivo/partenza, pulizia, lenzuola)" on={showRoomIcons} onClick={toggleRoomIcons} />
            </div>
          )}
        </div>
        {/* Selettore mese (tendina) */}
        <div ref={monthRef} className="relative order-1">
          <button onClick={() => setMonthOpen((o) => !o)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${monthOpen ? "border-focus text-focus" : "border-line text-txt hover:bg-wash"}`}>
            <Icon name="calendar" size={15} /> <span className="capitalize">{monthLabel(start)}</span> <span className="text-xs">▾</span>
          </button>
          {monthOpen && (
            <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-52 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
              {monthList.map((mm) => {
                const active = start.getFullYear() === mm.y && start.getMonth() === mm.m;
                return (
                  <button key={`${mm.y}-${mm.m}`} onClick={() => { setStart(new Date(mm.y, mm.m, 1)); patchView({ span: "month" }); setMonthOpen(false); }} className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm capitalize ${active ? "bg-focus text-white" : "text-txt hover:bg-wash"}`}>{mm.label}</button>
                );
              })}
            </div>
          )}
        </div>
        {/* Salta a una data + frecce ±1 giorno (come nella dashboard) */}
        <div className="order-2 flex items-center gap-1">
          <button onClick={() => setStart((d) => addDays(d, -1))} title="Giorno precedente" aria-label="Giorno precedente" className="grid h-8 w-8 place-items-center rounded-lg border border-line text-base leading-none text-dim transition hover:bg-wash hover:text-txt">‹</button>
          <DateField value={toISO(start)} onChange={(v) => { if (v) setStart(parseISO(v)); }} title="Salta a una data" className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm transition hover:border-focus" />
          <button onClick={() => setStart((d) => addDays(d, 1))} title="Giorno successivo" aria-label="Giorno successivo" className="grid h-8 w-8 place-items-center rounded-lg border border-line text-base leading-none text-dim transition hover:bg-wash hover:text-txt">›</button>
        </div>
        <div className="order-4 ml-auto flex items-center gap-2">
          {/* Selettore card Insights (mostra/nascondi) */}
          {/* Toggle card: un click mostra tutte / nasconde tutte (come le altre sezioni) */}
          <button onClick={() => (INSIGHT_CARDS.some((c) => showCard(c.key)) ? persistCards(new Set(INSIGHT_CARDS.map((c) => c.key))) : persistCards(new Set()))} title={INSIGHT_CARDS.some((c) => showCard(c.key)) ? "Nascondi le card" : "Mostra le card"} className={`grid h-9 w-9 place-items-center rounded-lg border border-line transition ${INSIGHT_CARDS.some((c) => showCard(c.key)) ? "bg-wash text-txt" : "text-dim hover:bg-wash hover:text-txt"}`}>
            <Icon name="chart" size={16} />
          </button>
          <Link href="/importa" title="Importa prenotazioni" aria-label="Importa prenotazioni" className="grid h-9 w-9 place-items-center rounded-lg border border-line text-dim transition hover:bg-wash hover:text-txt">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
          </Link>
          <Link href="/prenotazioni/nuova" className="rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ backgroundColor: "var(--focus)" }}>+ Nuova</Link>
        </div>
      </div>

      {/* Legenda OTA — sopra la riga filtri (invertita) · ✓ = collegato, sfumato = non collegato */}
      <div className="order-[-1] flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
        {(Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]).filter((c) => c !== "blocked").map((c) => {
          const conn = chConnected(c);
          return (
            <div key={c} className="flex items-center gap-1 text-xs text-dim" title={CHANNELS[c].label}>
              <ChannelLogo channel={c} size={24} title={CHANNELS[c].label} />
              {conn === true && <span title="Collegato" className="font-bold leading-none text-[color:var(--ok)]">✓</span>}
              {conn === false && <span title="Canale non collegato" className="font-bold leading-none text-[color:var(--err)]">✗</span>}
            </div>
          );
        })}
        <div className="ml-auto flex items-center gap-3">
          {lastRun && <span className="text-xs text-faint" title="Data e ora dell'ultima sincronizzazione">Ultimo processo · {lastRun}</span>}
          <button onClick={syncNow} disabled={syncing} title={syncing ? "Sincronizzazione in corso…" : "Sincronizza ora con i canali collegati"} className="grid h-9 w-9 place-items-center rounded-lg border border-line text-dim transition hover:bg-wash hover:text-txt disabled:opacity-60">
            <svg className={syncing ? "animate-spin" : ""} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
          </button>
        </div>
      </div>

      {/* INSIGHTS — card innovative sul periodo visibile (in alto, una riga, mostra/nascondi dal selettore) */}
      {activeCard && (
        <div className="order-first flex justify-center pb-1">
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-1 shadow-md">
            <button type="button" onClick={() => moveActiveCard(-1)} aria-label="Sposta a sinistra" className="grid h-6 w-6 place-items-center rounded-full text-sm text-dim hover:text-txt">◀</button>
            <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Sposta · {INSIGHT_CARDS.find((c) => c.key === activeCard)?.label}</span>
            <button type="button" onClick={() => moveActiveCard(1)} aria-label="Sposta a destra" className="grid h-6 w-6 place-items-center rounded-full text-sm text-dim hover:text-txt">▶</button>
            <button type="button" onClick={() => setActiveCard(null)} aria-label="Fine" className="grid h-6 w-6 place-items-center rounded-full text-[color:var(--ok)] hover:opacity-80">✓</button>
          </div>
        </div>
      )}
      <div className="order-first flex gap-3 overflow-x-auto pb-1" onDoubleClick={onCardsDblClick}>
        {showCard("copilot") && (
        <div data-cardkey="copilot" onDrop={() => onCardDrop("copilot")} style={{ order: orderOf("copilot") }} className={`rounded-xl border bg-surface p-3 shadow-sm shrink-0 grow basis-[calc(25%-9px)] min-w-[240px] cursor-default transition ${dragCard === "copilot" ? "opacity-40" : ""} ${dragCard && dragCard !== "copilot" ? "border-dashed border-focus" : "border-line"}`}>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><span>🤖</span> Copilota revenue</div>
          <div className="flex flex-col gap-2">
            {suggestions.slice(0, 3).map((s, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-line p-2">
                <span className="text-sm leading-none" style={{ color: s.color }}>{s.icon}</span>
                <span className="min-w-0 flex-1 text-xs leading-snug text-txt">{s.text}</span>
                {s.apply && s.cta && (tipDone.has(tipKey(s))
                  ? <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--ok)]"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>Applicato</span>
                  : <button onClick={() => { const k = tipKey(s); const doIt = () => { s.apply!(); markTip(k); }; if (s.from != null && s.to != null && s.subject) setPriceConfirm({ kind: "single", subject: s.subject, detail: s.detail, from: s.from, to: s.to, onOk: doIt }); else doIt(); }} className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: s.dir === "up" ? "var(--ok)" : s.dir === "down" ? "var(--err)" : "var(--focus)" }}>{s.cta}</button>)}
              </div>
            ))}
          </div>
        </div>
        )}
        {showCard("pickup") && (
        <div data-cardkey="pickup" onDrop={() => onCardDrop("pickup")} style={{ order: orderOf("pickup") }} className={`rounded-xl border bg-surface p-3 shadow-sm shrink-0 grow basis-[calc(25%-9px)] min-w-[240px] cursor-default transition ${dragCard === "pickup" ? "opacity-40" : ""} ${dragCard && dragCard !== "pickup" ? "border-dashed border-focus" : "border-line"}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><span>📈</span> Ritmo prenotazioni</div>
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `color-mix(in srgb, ${pickVerdict.c} 15%, transparent)`, color: pickVerdict.c }}>{pickDelta >= 0 ? "▲ +" : "▼ "}{pickDelta} vs 7gg</span>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-end gap-2">
              <span className="font-mono text-[2rem] font-bold leading-none text-txt">{pickLast7}</span>
              <span className="pb-0.5 text-[11px] leading-tight text-faint">nuove prenotazioni<br />negli ultimi 7 giorni</span>
            </div>
            <span className="pb-0.5 text-right text-[11px] font-semibold leading-tight" style={{ color: pickVerdict.c }}>{pickLast7 >= pickPrev7 ? "▲" : "▼"} {pickVerdict.t}</span>
          </div>
          <div className="mt-3 flex items-end gap-[3px]" style={{ height: 60 }} title="Nuove prenotazioni per data prenotazione (ultimi 14 giorni)">
            {pickupDays.map((x, i) => { const recent = i >= 7; return (
              <div key={x.iso} className="relative flex-1 rounded-[3px]" style={{ height: "100%", backgroundColor: "color-mix(in srgb, var(--faint) 12%, transparent)" }} title={`${fmtDM(x.d)}: ${x.n} nuove`}>
                <div className="absolute inset-x-0 bottom-0 rounded-[3px] transition-all" style={{ height: `${x.n ? Math.max(14, (x.n / pickupMax) * 100) : 0}%`, backgroundColor: recent ? "var(--focus)" : "color-mix(in srgb, var(--focus) 36%, transparent)" }} />
              </div>
            ); })}
          </div>
          <div className="mt-1 flex justify-between px-0.5 text-[10px] text-faint"><span>14 gg fa</span><span>oggi</span></div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line px-2 py-1.5">
              <div className="text-[10px] text-faint">Sett. prec.</div>
              <div className="font-mono text-sm font-bold text-dim">{pickPrev7} <span className="text-[10px] font-normal text-faint">nuove</span></div>
            </div>
            <div className="rounded-lg border px-2 py-1.5" style={{ borderColor: `color-mix(in srgb, ${pickVerdict.c} 45%, var(--line))`, backgroundColor: `color-mix(in srgb, ${pickVerdict.c} 6%, transparent)` }}>
              <div className="text-[10px] text-faint">Questa sett.</div>
              <div className="font-mono text-sm font-bold" style={{ color: pickVerdict.c }}>{pickLast7} <span className="text-[10px] font-normal text-faint">nuove</span></div>
            </div>
          </div>
        </div>
        )}
        {showCard("gaps") && (
        <div data-cardkey="gaps" onDrop={() => onCardDrop("gaps")} style={{ order: orderOf("gaps") }} className={`rounded-xl border bg-surface p-3 shadow-sm shrink-0 grow basis-[calc(25%-9px)] min-w-[240px] cursor-default transition ${dragCard === "gaps" ? "opacity-40" : ""} ${dragCard && dragCard !== "gaps" ? "border-dashed border-focus" : "border-line"}`}>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><span>🕳️</span> Buchi da riempire</div>
          {gaps.length === 0 ? (
            <div className="flex items-center gap-2 py-1 text-xs text-dim"><span className="font-bold text-[color:var(--ok)]">✓</span> Nessun buco di 1–2 notti nel periodo.</div>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg px-2 py-1.5" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 10%, transparent)" }}>
                  <div className="font-mono text-lg font-bold leading-none" style={{ color: "var(--warn)" }}>{gapNights}</div>
                  <div className="mt-0.5 text-[10px] text-dim">notti vuote · {gaps.length} {gaps.length === 1 ? "buco" : "buchi"}</div>
                </div>
                <div className="rounded-lg px-2 py-1.5" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 10%, transparent)" }}>
                  <div className="truncate font-mono text-lg font-bold leading-none" style={{ color: "var(--ok)" }}>{eur(gapValue)}</div>
                  <div className="mt-0.5 text-[10px] text-dim">recuperabili</div>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                {gaps.slice(0, 3).map((g, i) => (
                  <button key={i} onClick={() => router.push("/preventivi")} className="group flex items-stretch gap-2 overflow-hidden rounded-lg border border-line pr-2 text-left transition hover:border-[color:var(--warn)] hover:bg-wash">
                    <span className="w-1 shrink-0" style={{ backgroundColor: "var(--warn)" }} />
                    <span className="min-w-0 flex-1 py-1">
                      <span className="block truncate text-xs font-semibold text-txt">{g.unit.name}</span>
                      <span className="block truncate text-[10px] text-faint">{fmtRange(g.from, g.to)}</span>
                    </span>
                    <span className="my-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{g.nights}N</span>
                    <span className="my-auto shrink-0 text-faint transition group-hover:text-[color:var(--warn)]">›</span>
                  </button>
                ))}
                {gaps.length > 3 && <span className="px-1 text-[11px] text-faint">+{gaps.length - 3} altri buchi</span>}
              </div>
            </>
          )}
        </div>
        )}
        {showCard("sim") && (
        <div data-cardkey="sim" onDrop={() => onCardDrop("sim")} style={{ order: orderOf("sim") }} className={`rounded-xl border bg-surface p-3 shadow-sm shrink-0 grow basis-[calc(25%-9px)] min-w-[240px] cursor-default transition ${dragCard === "sim" ? "opacity-40" : ""} ${dragCard && dragCard !== "sim" ? "border-dashed border-focus" : "border-line"}`}>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><span>🎚️</span> Simulatore prezzi</div>
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-faint">Ricavi previsti periodo</span>
            <span className="font-mono text-sm font-bold text-txt">{eur(periodRevenue)}</span>
          </div>
          <input type="range" min={-20} max={30} value={whatIf} onChange={(e) => setWhatIf(Number(e.target.value))} className="mt-2 w-full accent-[color:var(--focus)]" />
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-txt">{whatIf >= 0 ? "+" : ""}{whatIf}% prezzo</span>
            <span className="flex items-center gap-1 text-faint">occ. {Math.round(avgOcc)}% <span style={{ color: simOcc > avgOcc ? "var(--ok)" : simOcc < avgOcc ? "var(--err)" : "var(--faint)" }}>→ {simOcc}%</span></span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-faint">Ricavi simulati</span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-base font-bold" style={{ color: simRevenue > periodRevenue ? "var(--ok)" : simRevenue < periodRevenue ? "var(--err)" : "var(--txt)" }}>{eur(simRevenue)}</span>
              {simRevenue !== periodRevenue && (
                <span className="font-mono text-[11px] font-bold" style={{ color: simRevenue > periodRevenue ? "var(--ok)" : "var(--err)" }}>{simRevenue > periodRevenue ? "▲ +" : "▼ −"}{eur(Math.abs(simRevenue - periodRevenue))}</span>
              )}
            </span>
          </div>
          <button onClick={() => setPriceConfirm({ kind: "bulk", pct: whatIf, from: toISO(days[0]), to: toISO(days[days.length - 1]) })} disabled={!whatIf} className="mt-2 w-full rounded-lg py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40" style={{ backgroundColor: whatIf > 0 ? "var(--ok)" : whatIf < 0 ? "var(--err)" : "var(--focus)" }}>
            {whatIf ? `Applica ${whatIf > 0 ? "+" : ""}${whatIf}% ai prezzi` : "Sposta lo slider per applicare"}
          </button>
          <p className="mt-1.5 text-[10px] leading-snug text-faint">Meno prezzo riempie più camere: con spazio libero i ricavi possono salire; oltre un certo sconto no.</p>
        </div>
        )}
        {showCard("alerts") && (
        <div data-cardkey="alerts" onDrop={() => onCardDrop("alerts")} style={{ order: orderOf("alerts") }} className={`rounded-xl border bg-surface p-3 shadow-sm shrink-0 grow basis-[calc(25%-9px)] min-w-[240px] cursor-default transition ${dragCard === "alerts" ? "opacity-40" : ""} ${dragCard && dragCard !== "alerts" ? "border-dashed border-focus" : "border-line"}`}>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><span>⚠️</span> Da controllare</div>
          {calAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg py-5 text-center" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 8%, transparent)" }}>
              <span className="grid h-9 w-9 place-items-center rounded-full text-lg font-bold text-white" style={{ backgroundColor: "var(--ok)" }}>✓</span>
              <span className="text-xs font-semibold text-[color:var(--ok)]">Tutto in ordine</span>
              <span className="text-[10px] text-dim">Nessuna anomalia nel periodo.</span>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: `color-mix(in srgb, ${alertWorst} 10%, transparent)` }}>
                <span className="font-mono text-2xl font-bold leading-none" style={{ color: alertWorst }}>{alertTotal}</span>
                <span className="text-[11px] leading-tight text-dim">cose da<br />sistemare</span>
              </div>
              <div className="flex flex-col gap-1">
                {calAlerts.map((a, i) => (
                  <button key={i} onClick={() => router.push(a.href)} className="group flex items-center gap-2 overflow-hidden rounded-lg border border-line py-1 pl-0 pr-2 text-left transition hover:bg-wash" style={{ borderColor: `color-mix(in srgb, ${a.color} 30%, var(--line))` }}>
                    <span className="w-1 self-stretch shrink-0" style={{ backgroundColor: a.color }} />
                    <span className="text-sm leading-none">{a.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-txt">{a.label}</span>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: a.color }}>{a.n}</span>
                    <span className="shrink-0 text-faint transition group-hover:text-txt">›</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        )}
        {showCard("moves") && (
        <div data-cardkey="moves" onDrop={() => onCardDrop("moves")} style={{ order: orderOf("moves") }} className={`rounded-xl border bg-surface p-3 shadow-sm shrink-0 grow basis-[calc(25%-9px)] min-w-[240px] cursor-default transition ${dragCard === "moves" ? "opacity-40" : ""} ${dragCard && dragCard !== "moves" ? "border-dashed border-focus" : "border-line"}`}>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><span>🔑</span> Prossimi movimenti</div>
          {moves.length === 0 ? (
            <div className="flex items-center gap-2 py-1 text-xs text-dim">Nessun arrivo o partenza nei prossimi 7 giorni.</div>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg py-1.5" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 10%, transparent)" }}>
                  <div className="font-mono text-lg font-bold leading-none" style={{ color: "var(--ok)" }}>{arrivalsN}</div>
                  <div className="mt-0.5 text-[10px] text-dim">arrivi</div>
                </div>
                <div className="rounded-lg py-1.5" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 10%, transparent)" }}>
                  <div className="font-mono text-lg font-bold leading-none" style={{ color: "var(--warn)" }}>{departuresN}</div>
                  <div className="mt-0.5 text-[10px] text-dim">partenze</div>
                </div>
                <div className="rounded-lg py-1.5" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 10%, transparent)" }}>
                  <div className="font-mono text-lg font-bold leading-none" style={{ color: "var(--focus)" }}>{turnoverN}</div>
                  <div className="mt-0.5 text-[10px] text-dim">turnover</div>
                </div>
              </div>
              <div className="flex max-h-[116px] flex-col gap-1 overflow-y-auto pr-0.5">
                {moves.map((m, i) => (
                  <button key={i} onClick={() => openBooking(m.b.id)} className="group flex shrink-0 items-center gap-2 rounded-lg border border-line px-2 py-1 text-left transition hover:bg-wash">
                    <span className="grid h-5 w-8 shrink-0 place-items-center rounded-md text-[9px] font-bold text-white" style={{ backgroundColor: m.kind === "in" ? "var(--ok)" : "var(--warn)" }}>{m.kind === "in" ? "IN" : "OUT"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-txt">{guestName(m.b.guestId)}{m.turn && <span title="Turnover in giornata"> ⚡</span>}</span>
                      <span className="block truncate text-[10px] text-faint">{unitNameOf(m.b.unitId)}</span>
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold capitalize text-dim">{relDay(m.iso)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        )}
        {showCard("channels") && (
        <div data-cardkey="channels" onDrop={() => onCardDrop("channels")} style={{ order: orderOf("channels") }} className={`rounded-xl border bg-surface p-3 shadow-sm shrink-0 grow basis-[calc(25%-9px)] min-w-[240px] cursor-default transition ${dragCard === "channels" ? "opacity-40" : ""} ${dragCard && dragCard !== "channels" ? "border-dashed border-focus" : "border-line"}`}>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><span>🔀</span> Mix canali</div>
          {chTotalN === 0 ? (
            <div className="flex items-center gap-2 py-1 text-xs text-faint">Nessuna prenotazione nel periodo.</div>
          ) : (
            <>
              <div className="mb-2 flex items-end justify-between">
                <div className="leading-none">
                  <span className="font-mono text-2xl font-bold" style={{ color: "var(--ch-direct)" }}>{directShare}%</span>
                  <span className="ml-1 text-[11px] text-dim">diretta</span>
                </div>
                <div className="text-right leading-tight">
                  <div className="text-[10px] text-faint">commissioni OTA</div>
                  <div className="font-mono text-sm font-bold" style={{ color: chCommission > 0 ? "var(--warn)" : "var(--faint)" }}>{chCommission > 0 ? `−${eur(chCommission)}` : "—"}</div>
                </div>
              </div>
              <div className="mb-2 flex h-2.5 overflow-hidden rounded-full">
                {chAgg.map((x) => (<div key={x.ch} style={{ width: `${(x.n / chTotalN) * 100}%`, backgroundColor: `var(${x.meta.cssVar})` }} title={`${x.meta.label}: ${x.n}`} />))}
              </div>
              <div className="flex flex-col gap-1">
                {chAgg.map((x) => (
                  <div key={x.ch} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: `var(${x.meta.cssVar})` }} />
                    <span className="min-w-0 flex-1 truncate text-txt">{x.meta.label}</span>
                    <span className="shrink-0 font-mono text-dim">{x.n}</span>
                    <span className="w-9 shrink-0 text-right font-mono text-faint">{Math.round((x.n / chTotalN) * 100)}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        )}
        {showCard("kpi") && (
        <div data-cardkey="kpi" onDrop={() => onCardDrop("kpi")} style={{ order: orderOf("kpi") }} className={`rounded-xl border bg-surface p-3 shadow-sm shrink-0 grow basis-[calc(25%-9px)] min-w-[240px] cursor-default transition ${dragCard === "kpi" ? "opacity-40" : ""} ${dragCard && dragCard !== "kpi" ? "border-dashed border-focus" : "border-line"}`}>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><span>📊</span> ADR &amp; RevPAR</div>
          <div className="flex flex-col gap-2">
            <div className="rounded-lg border border-line p-2">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[11px] text-faint">ADR · tariffa media</span>
                {prevAdr > 0 && <span className="text-[10px] font-bold" style={{ color: adrDelta > 0 ? "var(--ok)" : adrDelta < 0 ? "var(--err)" : "var(--faint)" }}>{adrDelta > 0 ? "▲ +" : adrDelta < 0 ? "▼ " : ""}{adrDelta}%</span>}
              </div>
              <div className="font-mono text-2xl font-bold leading-none text-txt">{eur(adr)}</div>
              <div className="mt-0.5 text-[10px] text-faint">prezzo medio a notte venduta</div>
            </div>
            <div className="rounded-lg border border-line p-2">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[11px] text-faint">RevPAR</span>
                {prevRevpar > 0 && <span className="text-[10px] font-bold" style={{ color: revparDelta > 0 ? "var(--ok)" : revparDelta < 0 ? "var(--err)" : "var(--faint)" }}>{revparDelta > 0 ? "▲ +" : revparDelta < 0 ? "▼ " : ""}{revparDelta}%</span>}
              </div>
              <div className="font-mono text-2xl font-bold leading-none text-txt">{eur(revpar)}</div>
              <div className="mt-0.5 text-[10px] text-faint">ricavo per camera disponibile</div>
            </div>
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-faint"><span>{soldNights} notti vendute</span><span>occ. {avgOcc}%</span></div>
        </div>
        )}
      </div>

      {/* Occupazione — pannello separato sopra il calendario */}
      {vw.occ && (
      <div ref={occScrollRef} onScroll={() => syncScroll(occScrollRef.current, gridScrollRef.current)} className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <div className="relative" style={{ width: gridW + LABEL_W }}>
          {/* Separatore mese evidenziato */}
          {monthBoundaries.map((b) => (
            <div key={b} className="pointer-events-none absolute inset-y-0 z-20" style={{ left: LABEL_W + b * cellW, borderLeft: "2px solid color-mix(in srgb, var(--txt) 42%, transparent)" }} />
          ))}
          {/* Fascia mese con frecce */}
          <div className="relative flex border-b border-line bg-wash">
            <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-wash" style={{ width: LABEL_W }} />
            <div className="flex" style={{ width: gridW }}>
              {monthSegments.map((seg) => (
                <div key={seg.key} className="flex items-center justify-center overflow-hidden whitespace-nowrap border-r border-line py-1 text-[11px] font-bold uppercase tracking-wide capitalize text-dim" style={{ width: seg.count * cellW }}>{seg.label}</div>
              ))}
            </div>
            <button onClick={goPrev} title={vw.span === "month" ? "Mese precedente" : "Periodo precedente"} className="absolute inset-y-0 z-30 grid w-7 place-items-center text-lg font-bold leading-none text-[color:var(--ok)] transition hover:bg-[color:color-mix(in_srgb,var(--ok)_18%,transparent)]" style={{ left: LABEL_W }}>‹</button>
            <button onClick={goNext} title={vw.span === "month" ? "Mese successivo" : "Periodo successivo"} className="absolute inset-y-0 right-0 z-30 grid w-7 place-items-center text-lg font-bold leading-none text-[color:var(--ok)] transition hover:bg-[color:color-mix(in_srgb,var(--ok)_18%,transparent)]">›</button>
          </div>
          {/* Header giorni */}
          <div className="flex border-b border-line">
            <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-wash" style={{ width: LABEL_W }} />
            <div className="flex" style={{ width: gridW }}>
              {days.map((d) => {
                const iso = toISO(d); const today = iso === todayISO; const hue = dayHue(d);
                return (
                  <div key={iso} className="flex flex-col items-center justify-center border-r border-line py-1" style={{ width: cellW, ...(today ? { boxShadow: "inset 0 -2px 0 var(--focus)" } : {}) }}>
                    <span className="text-[10px] uppercase" style={{ color: hue.text ?? "var(--faint)" }}>{weekdayShort(d)}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: today ? "var(--focus)" : hue.text ?? "var(--txt)" }}>{d.getDate()}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Grafico occupazione */}
          <div className="flex items-stretch">
            <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-line bg-surface px-3 py-2" style={{ width: LABEL_W }}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Occupazione media periodo</span>
              <span className="font-mono text-2xl font-bold leading-tight text-txt">{avgOcc}%</span>
              <button onClick={() => router.push("/statistiche")} className="mt-1 inline-flex w-fit items-center gap-1 text-[11px] font-semibold text-focus transition hover:gap-1.5 hover:underline">Altre statistiche →</button>
            </div>
            <div className="relative" style={{ width: gridW, height: OCC_H + 14 }}>
              <svg width={gridW} height={OCC_H + 14} className="block" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="occGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--focus)" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="var(--focus)" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <g transform="translate(0,7)">
                  {occGridY.map((g) => (
                    <g key={g.p}>
                      <line x1="0" y1={g.y} x2={gridW} y2={g.y} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" opacity="0.7" />
                      <text x="4" y={g.y - 2} fontSize="8" fill="var(--faint)" className="font-mono">{g.p}%</text>
                    </g>
                  ))}
                  <path d={occArea} fill="url(#occGrad)" />
                  <path d={occLine} fill="none" stroke="var(--focus)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {occStrip.map((c, i) => {
                    const today = c.iso === todayISO;
                    return (
                      <circle key={c.iso} cx={occX(i)} cy={occY(c.pct)} r={today ? 3.4 : 2} fill={today ? "var(--focus)" : "var(--surface)"} stroke="var(--focus)" strokeWidth={today ? 0 : 1.4}>
                        <title>{`${weekdayShort(parseISO(c.iso))} ${parseISO(c.iso).getDate()} · ${c.pct}%`}</title>
                      </circle>
                    );
                  })}
                </g>
              </svg>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Calendario */}
      <div ref={gridScrollRef} onScroll={() => syncScroll(gridScrollRef.current, occScrollRef.current)} className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <div
          className="relative"
          style={{ width: gridW + LABEL_W }}
          onMouseMove={(e) => {
            if (!sel) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const idx = Math.max(0, Math.min(dayCount - 1, Math.floor((e.clientX - rect.left - LABEL_W) / cellW)));
            const iso = toISO(addDays(start, idx));
            setSelHover((h) => (h === iso ? h : iso));
          }}
        >
          {/* Separatore verticale evidenziato al cambio mese (su tutta l'altezza) */}
          {monthBoundaries.map((b) => (
            <div key={b} className="pointer-events-none absolute inset-y-0 z-20" style={{ left: LABEL_W + b * cellW, borderLeft: "2px solid color-mix(in srgb, var(--txt) 42%, transparent)" }} />
          ))}
          {/* Fascia mese (con frecce di navigazione a sinistra e alla fine) */}
          <div className="relative flex border-b border-line bg-wash">
            <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-wash" style={{ width: LABEL_W }} />
            <div className="flex" style={{ width: gridW }}>
              {monthSegments.map((seg) => (
                <div key={seg.key} className="flex items-center justify-center overflow-hidden whitespace-nowrap border-r border-line py-1 text-[11px] font-bold uppercase tracking-wide capitalize text-dim" style={{ width: seg.count * cellW }}>
                  {seg.label}
                </div>
              ))}
            </div>
            {/* Frecce dentro il calendario: all'inizio e alla fine delle date */}
            <button onClick={goPrev} title={vw.span === "month" ? "Mese precedente" : "Periodo precedente"} className="absolute inset-y-0 z-30 grid w-7 place-items-center text-lg font-bold leading-none text-[color:var(--ok)] transition hover:bg-[color:color-mix(in_srgb,var(--ok)_18%,transparent)]" style={{ left: LABEL_W }}>‹</button>
            <button onClick={goNext} title={vw.span === "month" ? "Mese successivo" : "Periodo successivo"} className="absolute inset-y-0 right-0 z-30 grid w-7 place-items-center text-lg font-bold leading-none text-[color:var(--ok)] transition hover:bg-[color:color-mix(in_srgb,var(--ok)_18%,transparent)]">›</button>
          </div>

          {/* Header giorni */}
          <div className="flex border-b border-line">
            <div className="sticky left-0 z-20 flex shrink-0 items-center border-r border-line bg-wash px-3" style={{ width: LABEL_W }}>
              {vw.group === "struct" && visibleStructures.length > 1 && (
                <span className="truncate text-[11px] font-bold uppercase tracking-wide" style={{ color: visibleStructures[0].photoColor ?? "var(--focus)" }} title={visibleStructures[0].name}>{visibleStructures[0].name}</span>
              )}
            </div>
            <div className="flex" style={{ width: gridW }}>
              {days.map((d) => {
                const iso = toISO(d);
                const today = iso === todayISO;
                const hue = dayHue(d);
                const isAnchor = sel?.kind === "event" && sel.anchor === iso;
                const inSel = sel?.kind === "event" && !!(selLo && selHi && iso >= selLo && iso <= selHi);
                const ev = events.find((e) => e.from <= iso && iso < e.to);
                return (
                  <div
                    key={iso}
                    onClick={() => clickHeader(iso)}
                    onMouseEnter={() => { if (sel?.kind === "event") setSelHover(iso); }}
                    title={sel?.kind === "event" ? "Clicca il giorno finale dell'evento" : ev ? `Evento: ${ev.name} (clic per modificare)` : "Clicca per creare un evento (poi clicca il giorno finale)"}
                    className="relative flex cursor-pointer flex-col items-center justify-center border-r border-line py-1"
                    style={{ width: cellW, ...(inSel ? { backgroundColor: "color-mix(in srgb, var(--focus) 20%, transparent)" } : {}), ...(isAnchor ? { boxShadow: "inset 0 0 0 2px var(--focus)" } : today ? { boxShadow: "inset 0 -2px 0 var(--focus)" } : {}) }}
                  >
                    <span className="text-[10px] uppercase" style={{ color: hue.text ?? "var(--faint)" }}>{weekdayShort(d)}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: today ? "var(--focus)" : hue.text ?? "var(--txt)" }}>{d.getDate()}</span>
                    {ev && <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ backgroundColor: ev.color }} title={ev.name} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Righe per tipologia — Esplosa (struttura → tipologia) o Compatta (solo per tipologia) */}
          {vw.group === "struct" ? (
            visibleStructures.map((s, si) => {
              const sTypes = roomTypes.filter((rt) => rt.structureId === s.id && units.some((u) => u.structureId === s.id && u.roomTypeId === rt.id));
              if (!sTypes.length) return null;
              return (
                <div key={s.id}>
                  {visibleStructures.length > 1 && si > 0 && (
                    <div className="flex border-t-2" style={{ borderColor: s.photoColor ?? "var(--focus)" }}>
                      <div className="sticky left-0 z-20 flex items-center border-r border-line bg-wash px-3 py-1 text-[11px] font-bold uppercase tracking-wide" style={{ width: LABEL_W, color: s.photoColor ?? "var(--focus)" }}>{s.name}</div>
                      <div className="bg-wash" style={{ width: gridW }} />
                    </div>
                  )}
                  {sTypes.map((type) => renderTypeSection({ keyId: type.id, name: type.name, beds: type.beds, typeIds: [type.id], sectionUnits: units.filter((u) => u.structureId === s.id && u.roomTypeId === type.id), editableAvail: true }))}
                </div>
              );
            })
          ) : (
            (() => {
              const byName = new Map<string, string[]>(); const order: string[] = [];
              roomTypes.forEach((rt) => {
                if (!visibleStructures.some((s) => s.id === rt.structureId)) return;
                if (!visibleUnits.some((u) => u.roomTypeId === rt.id)) return;
                if (!byName.has(rt.name)) { byName.set(rt.name, []); order.push(rt.name); }
                byName.get(rt.name)!.push(rt.id);
              });
              return order.map((name) => {
                const members = byName.get(name)!;
                const rep = roomTypes.find((rt) => rt.id === members[0])!;
                const sectionUnits = visibleUnits.filter((u) => members.includes(u.roomTypeId));
                const keyId = members.length === 1 ? members[0] : "grp:" + name;
                return renderTypeSection({ keyId, name, beds: rep.beds, typeIds: members, sectionUnits, editableAvail: members.length === 1 });
              });
            })()
          )}

          {/* Prenotazioni da assegnare (senza unità) — una sola riga per tutte le strutture */}
          {(() => {
            const unassigned = bookings.filter((b) => !b.unitId && visibleStructures.some((s) => s.id === b.structureId));
            if (!unassigned.length) return null;
            return (
              <div className="flex border-b border-line bg-wash/40">
                <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line px-3 text-xs italic text-faint" style={{ width: LABEL_W, height: rowH }}>
                  Da assegnare
                </div>
                <div className="relative" style={{ width: gridW, height: rowH }}>
                  {unassigned.map((b) => {
                    const g = geom(b.checkIn, b.checkOut);
                    if (!g) return null;
                    const meta = CHANNELS[b.channel];
                    const dragging = dragView?.id === b.id;
                    return (
                      <div
                        key={b.id}
                        onPointerDown={(e) => onBarPointerDown(e, b.id)}
                        title={`${guestName(b.guestId)} · da assegnare`}
                        className="absolute flex cursor-grab items-center overflow-hidden border-2 border-dashed px-2 text-xs font-semibold active:cursor-grabbing"
                        style={{ left: g.left, width: g.width, top: 0, height: rowH, borderColor: `var(${meta.cssVar})`, color: `var(${meta.cssVar})`, background: "color-mix(in srgb, var(--surface) 85%, transparent)", opacity: dragging ? 0.35 : 1, pointerEvents: dragView ? "none" : "auto", touchAction: "none" }}
                      >
                        <span className="truncate">{guestName(b.guestId)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Badge durante il drag */}
      {dragView && (
        <div className="pointer-events-none fixed z-50 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-lg" style={{ left: dragView.x + 14, top: dragView.y + 14, backgroundColor: dragView.valid ? "var(--focus)" : "var(--err)", color: "#fff" }}>
          {dragView.valid ? destinationLabel(dragView, bookings, units) : dragView.reason}
        </div>
      )}


      {/* Selettore su selezione cella: prenotazione o fuori servizio (per l'intervallo scelto) */}
      {pick && (() => {
        const u = units.find((x) => x.id === pick.unitId);
        const nn = nights(pick.from, pick.to) + 1;
        const pretty = `${parseISO(pick.from).toLocaleDateString("it-IT", { day: "numeric", month: "short" })} → ${parseISO(pick.to).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}`;
        const noRate = rangeIsos(pick.from, pick.to).some((iso) => rateFor(pick.roomTypeId, iso) <= 0); // tariffa mancante → vendita bloccata
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
            <button aria-label="Chiudi" onClick={() => setPick(null)} className="absolute inset-0 bg-black/40" />
            <div className="relative w-full max-w-xs rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <div className="font-display text-lg font-bold text-txt">Cosa vuoi inserire?</div>
              <div className="mb-4 mt-0.5 text-xs text-dim">{u?.name} · <span className="capitalize">{pretty}</span> · {nn} {nn === 1 ? "notte" : "notti"}</div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => { const p = pick; setPick(null); router.push(`/preventivi?s=${p.structureId}&rt=${p.roomTypeId}&ci=${p.from}&co=${shiftISO(p.to, 1)}`); }}
                  className="flex items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3 text-left transition hover:border-focus hover:bg-wash"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: "var(--ch-expedia)", color: "#241a05" }}>€</span>
                  <span>
                    <span className="block text-sm font-semibold text-txt">Nuovo preventivo</span>
                    <span className="block text-[11px] text-dim">Prepara un'offerta per queste date</span>
                  </span>
                </button>
                <button
                  disabled={noRate}
                  onClick={noRate ? undefined : () => { const p = pick; setPick(null); router.push(`/prenotazioni/nuova?s=${p.structureId}&ci=${p.from}&co=${shiftISO(p.to, 1)}&u=${p.unitId}&rt=${p.roomTypeId}`); }}
                  title={noRate ? "Tariffa a €0: imposta un prezzo per poter vendere queste date" : undefined}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${noRate ? "cursor-not-allowed border-line opacity-55" : "border-line bg-paper hover:border-focus hover:bg-wash"}`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: noRate ? "var(--faint)" : "var(--focus)" }}>+</span>
                  <span>
                    <span className="block text-sm font-semibold text-txt">Nuova prenotazione</span>
                    <span className="block text-[11px] text-dim">{noRate ? "Tariffa a €0 — imposta un prezzo per vendere" : "Ospite, canale, date e prezzo"}</span>
                  </span>
                </button>
                <button
                  onClick={() => { setOos({ unitId: pick.unitId, structureId: pick.structureId, roomTypeId: pick.roomTypeId, from: pick.from, to: shiftISO(pick.to, 1), reason: "" }); setPick(null); }}
                  className="flex items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3 text-left transition hover:border-focus hover:bg-wash"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: "var(--ch-blocked)" }}>⛔</span>
                  <span>
                    <span className="block text-sm font-semibold text-txt">Fuori servizio</span>
                    <span className="block text-[11px] text-dim">Blocca un periodo con motivo</span>
                  </span>
                </button>
              </div>
              <button onClick={() => setPick(null)} className="mt-4 w-full rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
            </div>
          </div>
        );
      })()}

      {/* Avviso selezione in corso (evento / tariffa / prenotazione) */}
      {sel && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 shadow-lg">
          <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-focus px-2 text-xs font-bold text-white">{selDays}</span>
          <span className="text-sm text-txt">{sel.kind === "event" ? "Evento" : sel.kind === "rate" ? "Tariffa" : sel.kind === "avail" ? "Disponibilità" : "Prenotazione"} · {selDays === 1 ? "1 giorno" : `${selDays} giorni`} — clicca sull'ultimo giorno per <b>confermare</b></span>
          <button onClick={cancelSel} className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-dim hover:bg-wash">Annulla</button>
        </div>
      )}

      {/* Editor evento (crea / modifica) */}
      {evDraft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
          <button aria-label="Chiudi" onClick={() => setEvDraft(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-txt">{evDraft.id ? "Modifica evento" : "Nuovo evento"}</span>
              <button onClick={() => setEvDraft(null)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
            </div>
            <label className="block text-xs font-medium text-dim">Nome
              <input autoFocus value={evDraft.name} onChange={(e) => setEvDraft({ ...evDraft, name: e.target.value })} placeholder="Es. Festa di Santa Lucia, Ponte 25 aprile…" className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">Dal<input type="date" value={evDraft.from} onChange={(e) => setEvDraft({ ...evDraft, from: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
              <label className="block text-xs font-medium text-dim">Al (escluso)<input type="date" value={evDraft.to} onChange={(e) => setEvDraft({ ...evDraft, to: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
            </div>
            <div className="mt-3 text-xs font-medium text-dim">Colore</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {EVENT_COLORS.map((c) => (
                <button key={c} onClick={() => setEvDraft({ ...evDraft, color: c })} className="h-7 w-7 rounded-full transition" style={{ backgroundColor: c, outline: evDraft.color === c ? "2px solid var(--txt)" : "none", outlineOffset: 2 }} title={c} />
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2">
              {evDraft.id && <button onClick={() => { deleteEvent(evDraft.id!); setEvDraft(null); }} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-[color:color-mix(in_srgb,var(--err)_10%,transparent)]">Elimina</button>}
              <button onClick={() => setEvDraft(null)} className="ml-auto rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
              <button onClick={saveEvent} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Salva</button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Tariffa (intervallo: importo fisso o variazione %) */}
      {rateEdit && (() => {
        const isos = rangeIsos(rateEdit.from, rateEdit.to);
        const sample = isos[0];
        const preview = rateEdit.mode === "fixed" ? Math.max(0, Math.round(rateEdit.value)) : Math.max(0, Math.round(rateFor(rateEdit.typeId, sample) * (1 + rateEdit.value / 100)));
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
            <button aria-label="Chiudi" onClick={() => setRateEdit(null)} className="absolute inset-0 bg-black/40" />
            <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-lg font-bold text-txt">Modifica tariffa</span>
                <button onClick={() => setRateEdit(null)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-dim">Dal<input type="date" value={rateEdit.from} onChange={(e) => setRateEdit({ ...rateEdit, from: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
                <label className="block text-xs font-medium text-dim">Al<input type="date" value={rateEdit.to} onChange={(e) => setRateEdit({ ...rateEdit, to: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
              </div>

              <div className="mt-3 flex items-center rounded-lg border border-line p-0.5">
                <button onClick={() => setRateEdit({ ...rateEdit, mode: "fixed" })} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${rateEdit.mode === "fixed" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>Importo fisso</button>
                <button onClick={() => setRateEdit({ ...rateEdit, mode: "percent", value: 10 })} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${rateEdit.mode === "percent" ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>Variazione %</button>
              </div>

              <label className="mt-3 block text-xs font-medium text-dim">
                {rateEdit.mode === "fixed" ? "Nuova tariffa (€)" : "Variazione (%) — usa un valore negativo per ridurre"}
                <input type="number" value={rateEdit.value} onChange={(e) => setRateEdit({ ...rateEdit, value: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" />
              </label>

              <div className="mt-3 rounded-lg border border-line bg-paper p-3 text-xs text-dim">
                Applica a <b className="text-txt">{isos.length}</b> {isos.length === 1 ? "giorno" : "giorni"}.
                {" "}Esempio {parseISO(sample).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}: <span className="font-mono">€{rateFor(rateEdit.typeId, sample)}</span> → <span className="font-mono font-bold text-[color:var(--focus)]">€{preview}</span>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button onClick={resetRate} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-dim hover:bg-wash" title="Rimuovi le modifiche e torna alla tariffa base">Ripristina base</button>
                <button onClick={() => setRateEdit(null)} className="ml-auto rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
                <button onClick={saveRate} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Applica</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modale Disponibilità (chiudi/riduci vendite su un intervallo) */}
      {availEdit && (() => {
        const isos = rangeIsos(availEdit.from, availEdit.to);
        const rt = roomTypes.find((x) => x.id === availEdit.typeId);
        const totalRooms = units.filter((u) => u.roomTypeId === availEdit.typeId && !u.outOfService).length;
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
            <button aria-label="Chiudi" onClick={() => setAvailEdit(null)} className="absolute inset-0 bg-black/40" />
            <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-display text-lg font-bold text-txt">Disponibilità · {rt?.name}</span>
                <button onClick={() => setAvailEdit(null)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-dim">Dal<input type="date" value={availEdit.from} onChange={(e) => { if (e.target.value) setAvailEdit({ ...availEdit, from: e.target.value, to: e.target.value > availEdit.to ? e.target.value : availEdit.to }); }} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
                <label className="block text-xs font-medium text-dim">Al<input type="date" min={availEdit.from} value={availEdit.to} onChange={(e) => { if (e.target.value) setAvailEdit({ ...availEdit, to: e.target.value < availEdit.from ? availEdit.from : e.target.value }); }} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
              </div>
              {(() => {
                const MAXOFF = totalRooms + 20; // consenti overbooking: si possono aprire più camere di quelle reali
                const offered = Math.max(0, totalRooms - availEdit.closed);
                const commit = (v: number) => { const off = Math.max(0, Math.min(MAXOFF, v)); setAvailEdit({ ...availEdit, closed: totalRooms - off }); };
                const setOffered = (v: number) => { setAvailStr(null); commit(v); };
                const stopSell = offered === 0;
                const over = offered > totalRooms;
                const stColor = stopSell ? "var(--err)" : over ? "var(--warn)" : "var(--ok)";
                return (
                  <>
                    <label className="mt-3 block text-xs font-medium text-dim">Camere aperte alla vendita <span className="font-normal text-faint">· su {totalRooms} reali · {isos.length} {isos.length === 1 ? "giorno" : "giorni"}</span>
                      <div className="mt-1 flex items-center gap-2">
                        <input type="number" min={0} value={availStr ?? String(offered)} onFocus={(e) => e.target.select()} onChange={(e) => { const raw = e.target.value; setAvailStr(raw); if (raw !== "") commit(Number(raw)); }} onBlur={() => setAvailStr(null)} className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 font-mono text-sm font-bold text-txt outline-none focus:border-focus" />
                        <button onClick={() => setOffered(offered - 1)} disabled={offered <= 0} title="Diminuisci disponibilità" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-xl font-bold text-txt transition hover:bg-wash disabled:opacity-40">−</button>
                        <button onClick={() => setOffered(offered + 1)} disabled={offered >= MAXOFF} title="Aumenta disponibilità (anche oltre le reali)" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-xl font-bold text-txt transition hover:bg-wash disabled:opacity-40">+</button>
                      </div>
                    </label>
                    <div className="mt-1.5 text-[11px] font-semibold" style={{ color: stColor }}>{stopSell ? "● Vendite chiuse (stop sell)" : over ? `● Overbooking · +${offered - totalRooms} oltre le ${totalRooms} reali` : "● Aperte alla vendita"}</div>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => setOffered(0)} className="flex-1 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-[color:var(--err)] transition hover:bg-wash">Chiudi vendite</button>
                      <button onClick={() => { setAvailStr(null); setAvailEdit({ ...availEdit, closed: 0 }); }} title="Ripristina la disponibilità in base alle camere vendute" className="flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-[color:var(--ok)] transition hover:bg-wash">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                        Ripristina
                      </button>
                    </div>
                    <div className="mt-3 rounded-lg border border-line bg-paper p-3 text-xs text-dim">{stopSell ? <>Vendite <b className="text-[color:var(--err)]">chiuse</b>: 0 camere prenotabili nel periodo.</> : over ? <>Apri <b className="text-[color:var(--warn)]">{offered}</b> camere, <b className="text-[color:var(--warn)]">{offered - totalRooms}</b> oltre le {totalRooms} reali (overbooking). Assicurati di poterle coprire.</> : <>Apri <b className="text-txt">{offered}</b> camere. La disponibilità effettiva è al netto delle prenotazioni già presenti. <b className="text-txt">Ripristina</b> = tutte in vendita (in base al venduto).</>}</div>
                  </>
                );
              })()}
              <div className="mt-4 flex items-center justify-end gap-2">
                <button onClick={() => setAvailEdit(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
                <button onClick={saveAvail} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Applica</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Scheda camera modificabile (dal numero camera, senza cambiare pagina) */}
      {roomInfoId && (() => {
        const u = units.find((x) => x.id === roomInfoId); if (!u) return null;
        return <RoomSettingsModal
          key={u.id}
          unit={u}
          typeName={roomTypes.find((x) => x.id === u.roomTypeId)?.name ?? "—"}
          lastCleanIso={Object.entries(cleanDone).filter(([k]) => k.startsWith(`${u.id}:`)).map(([, v]) => v).sort().pop()}
          cleanedToday={!!cleanDone[`${u.id}:${toISO(new Date())}`]}
          onSaveClean={setCleanState}
          lastLinenIso={Object.entries(linenDone).filter(([k]) => k.startsWith(`${u.id}:`)).map(([, v]) => v).sort().pop()}
          linenDoneToday={!!linenDone[`${u.id}:${toISO(new Date())}`]}
          onSaveLinen={setLinenState}
          updateUnit={updateUnit}
          deleteUnit={(id) => { deleteUnit(id); }}
          addUnit={addUnit}
          onClose={() => setRoomInfoId(null)}
        />;
      })()}

      {/* Conferma correzione prezzo — Copilota (prezzo singolo) */}
      {priceConfirm && priceConfirm.kind === "single" && (() => {
        const pc = priceConfirm; const up = pc.to >= pc.from; const col = up ? "var(--ok)" : "var(--err)";
        return (
          <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
            <button aria-label="Chiudi" onClick={() => setPriceConfirm(null)} className="absolute inset-0 bg-black/40" />
            <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-bold text-white" style={{ backgroundColor: col }}>{up ? "▲" : "▼"}</span>
                <span className="font-display text-lg font-bold text-txt">Confermi la correzione prezzo?</span>
              </div>
              <p className="text-sm text-dim">Sicuro di voler modificare il prezzo di <b className="text-txt">{pc.subject}</b>{pc.detail ? <> · <span className="text-txt">{pc.detail}</span></> : null}?</p>
              <div className="my-3 flex items-center justify-center gap-3 rounded-xl border border-line bg-paper p-3">
                <span className="font-mono text-lg font-semibold text-dim line-through">{eur(pc.from)}</span>
                <span className="text-faint">→</span>
                <span className="font-mono text-2xl font-bold" style={{ color: col }}>{eur(pc.to)}</span>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button onClick={() => setPriceConfirm(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
                <button onClick={() => { pc.onOk(); setPriceConfirm(null); }} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: col }}>Conferma</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Conferma variazione prezzi massiva — Simulatore (preset periodo + Dal/Al) */}
      {priceConfirm && priceConfirm.kind === "bulk" && (() => {
        const pc = priceConfirm; const up = pc.pct >= 0; const col = up ? "var(--ok)" : "var(--err)";
        const nDays = rangeIsos(pc.from, pc.to).length;
        const nTypes = roomTypes.filter((rt) => visibleStructures.some((s) => s.id === rt.structureId) && units.some((u) => u.roomTypeId === rt.id)).length;
        const wkFrom = toISO(start), wkTo = toISO(addDays(start, 6));
        const nxFrom = toISO(addDays(start, 7)), nxTo = toISO(addDays(start, 13));
        const moFrom = toISO(new Date(start.getFullYear(), start.getMonth(), 1)), moTo = toISO(new Date(start.getFullYear(), start.getMonth() + 1, 0));
        const presetBtn = (lab: string, f: string, tt: string) => { const on = pc.from === f && pc.to === tt; return (<button onClick={() => setPriceConfirm({ ...pc, from: f, to: tt })} className={`rounded-md py-1.5 text-[11px] font-semibold transition ${on ? "bg-focus text-white" : "bg-wash text-dim hover:text-txt"}`}>{lab}</button>); };
        return (
          <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
            <button aria-label="Chiudi" onClick={() => setPriceConfirm(null)} className="absolute inset-0 bg-black/40" />
            <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <div className="mb-1 flex items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-bold text-white" style={{ backgroundColor: col }}>{up ? "▲" : "▼"}</span>
                <span className="font-display text-lg font-bold text-txt">Confermi la variazione prezzi?</span>
              </div>
              <p className="text-sm text-dim">Applico <b style={{ color: col }}>{up ? "+" : ""}{pc.pct}%</b> a tutti i prezzi delle <b className="text-txt">{nTypes}</b> tipologie visibili, nel periodo scelto.</p>
              <div className="mt-3 text-xs font-medium text-dim">Periodo</div>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {presetBtn("Settimana", wkFrom, wkTo)}
                {presetBtn("Prossima sett.", nxFrom, nxTo)}
                {presetBtn("Mese", moFrom, moTo)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-dim">Dal<input type="date" value={pc.from} onChange={(e) => { if (e.target.value) setPriceConfirm({ ...pc, from: e.target.value, to: e.target.value > pc.to ? e.target.value : pc.to }); }} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
                <label className="block text-xs font-medium text-dim">Al<input type="date" min={pc.from} value={pc.to} onChange={(e) => { if (e.target.value) setPriceConfirm({ ...pc, to: e.target.value < pc.from ? pc.from : e.target.value }); }} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
              </div>
              <div className="mt-3 rounded-lg border border-line bg-paper p-3 text-xs text-dim">Verranno aggiornati <b className="text-txt">{nDays}</b> {nDays === 1 ? "giorno" : "giorni"} × <b className="text-txt">{nTypes}</b> tipologie. La modifica è reversibile dal calendario.</div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button onClick={() => setPriceConfirm(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
                <button onClick={() => { applyWhatIfRange(pc.from, pc.to, pc.pct); setPriceConfirm(null); }} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: col }}>Applica {up ? "+" : ""}{pc.pct}%</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Conferma spostamento prenotazione */}
      {moveConfirm && (() => {
        const b = bookings.find((x) => x.id === moveConfirm.id);
        const toU = units.find((u) => u.id === moveConfirm.targetUnitId);
        const fromU = moveConfirm.prev.unitId ? units.find((u) => u.id === moveConfirm.prev.unitId) : null;
        const toS = toU ? structures.find((s) => s.id === toU.structureId) : null;
        const nightsN = nights(moveConfirm.checkIn, moveConfirm.checkOut);
        return (
          <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
            <button aria-label="Chiudi" onClick={() => setMoveConfirm(null)} className="absolute inset-0 bg-black/40" />
            <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-bold text-white" style={{ backgroundColor: "var(--focus)" }}>⇄</span>
                <span className="font-display text-lg font-bold text-txt">Confermi lo spostamento?</span>
              </div>
              <p className="text-sm text-dim">Spostare la prenotazione di <b className="text-txt">{b ? guestName(b.guestId) : "—"}</b>?</p>
              {b && toS && toS.id !== b.structureId && (
                <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--txt)" }}>
                  ⇄ Cambi struttura: da <b>{structures.find((s) => s.id === b.structureId)?.name ?? "—"}</b> a <b>{toS.name}</b>. La prenotazione avrà un avviso.
                </div>
              )}
              <div className="my-3 flex flex-col gap-1.5 rounded-xl border border-line bg-paper p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><span className="text-faint">Camera</span><span className="min-w-0 text-right text-txt">{fromU?.name ?? "Da assegnare"} <span className="text-faint">→</span> <b>{toU?.name}</b>{toS ? <span className="text-faint"> · {toS.name}</span> : null}</span></div>
                <div className="flex items-center justify-between gap-2"><span className="text-faint">Periodo</span><span className="font-mono text-txt">{moveConfirm.checkIn.slice(5)} → {moveConfirm.checkOut.slice(5)} <span className="text-faint">({nightsN} ntt)</span></span></div>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button onClick={() => setMoveConfirm(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
                <button onClick={applyMove} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Conferma spostamento</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modale Fuori servizio (periodo + motivo) */}
      {oos && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
          <button aria-label="Chiudi" onClick={() => setOos(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-txt">{oos.id ? "Modifica fuori servizio" : "Fuori servizio"}</span>
              <button onClick={() => setOos(null)} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-dim">Dal<input type="date" value={oos.from} onChange={(e) => setOos({ ...oos, from: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
              <label className="block text-xs font-medium text-dim">Al<input type="date" value={oos.to} onChange={(e) => setOos({ ...oos, to: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
            </div>
            <label className="mt-3 block text-xs font-medium text-dim">Motivo<input value={oos.reason} onChange={(e) => setOos({ ...oos, reason: e.target.value })} placeholder="Es. manutenzione bagno, tinteggiatura…" className="mt-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus" /></label>
            <div className="mt-4 flex items-center justify-end gap-2">
              {oos.id && <button onClick={() => { deleteBooking(oos.id!); setOos(null); }} title="Manutenzione finita: rimetti la camera in vendita" className="mr-auto flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold text-[color:var(--ok)] transition hover:bg-wash" style={{ borderColor: "color-mix(in srgb, var(--ok) 45%, var(--line))" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                Riapri camera
              </button>}
              <button onClick={() => setOos(null)} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Annulla</button>
              <button onClick={saveOos} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">{oos.id ? "Salva" : "Metti fuori servizio"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function destinationLabel(view: DragView, bookings: { id: string; checkIn: string; checkOut: string }[], units: { id: string; name: string }[]) {
  const b = bookings.find((x) => x.id === view.id);
  const u = units.find((x) => x.id === view.targetUnitId);
  if (!b || !u) return "";
  const newIn = shiftISO(b.checkIn, view.dxDays);
  const newOut = shiftISO(b.checkOut, view.dxDays);
  return `${u.name} · ${newIn.slice(8)}→${newOut.slice(8)} (${nights(newIn, newOut)} ntt)`;
}

function MenuToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-txt hover:bg-wash">
      <span>{label}</span>
      <span className={`relative h-4 w-7 shrink-0 rounded-full transition ${on ? "bg-focus" : "bg-line"}`}>
        <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all" style={{ left: on ? "14px" : "2px" }} />
      </span>
    </button>
  );
}

const RS_ROW = "grid grid-cols-[145px_1fr] items-center gap-3 py-1.5";
const RS_FLD = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
function RoomSettingsModal({ unit, typeName, lastCleanIso, cleanedToday, onSaveClean, lastLinenIso, linenDoneToday, onSaveLinen, updateUnit, deleteUnit, addUnit, onClose }: {
  unit: Unit; typeName: string; lastCleanIso?: string; cleanedToday: boolean;
  onSaveClean: (unitId: string, cleaned: boolean) => void;
  lastLinenIso?: string; linenDoneToday: boolean;
  onSaveLinen: (unitId: string, done: boolean) => void;
  updateUnit: (id: string, patch: Partial<Unit>) => void;
  deleteUnit: (id: string) => void;
  addUnit: (u: { structureId: string; roomTypeId: string; name: string }) => string;
  onClose: () => void;
}) {
  const [name, setName] = useState(unit.name);
  const [order, setOrder] = useState<string>(String(unit.order ?? 0));
  const [linen, setLinen] = useState(unit.linenFreq ?? "3 Giorni");
  const [tidy, setTidy] = useState(unit.tidyFreq ?? "1 Giorno");
  const [days, setDays] = useState<string[]>(unit.serviceDays ?? []);
  const [clean, setClean] = useState(cleanedToday ? "Pulita" : "Da pulire");
  const [linenSt, setLinenSt] = useState(linenDoneToday ? "Cambiate" : "Da cambiare");
  const [notes, setNotes] = useState(unit.notes ?? "");
  const toggleDay = (d: string) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  const idShort = (unit.id || "").replace(/[^0-9]/g, "").slice(-6) || unit.id.slice(-4);
  const fmtDt = (iso?: string) => iso ? (() => { try { const d = new Date(iso); return `${d.toLocaleDateString("it-IT")} ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`; } catch { return "—"; } })() : "—";
  const lastCleanTxt = fmtDt(lastCleanIso);
  const lastLinenTxt = fmtDt(lastLinenIso);
  const save = () => {
    updateUnit(unit.id, { name: name.trim() || unit.name, order: Math.floor(Number(order)) || 0, linenFreq: linen, tidyFreq: tidy, serviceDays: days, notes });
    onSaveClean(unit.id, clean === "Pulita");
    onSaveLinen(unit.id, linenSt === "Cambiate");
    onClose();
  };
  const copy = () => {
    const id = addUnit({ structureId: unit.structureId, roomTypeId: unit.roomTypeId, name: `${name} copia` });
    updateUnit(id, { floor: unit.floor, view: unit.view, linenFreq: linen, tidyFreq: tidy, serviceDays: days, amenities: unit.amenities, bedConfig: unit.bedConfig, size: unit.size, notes });
    onClose();
  };
  const del = () => { if (typeof window !== "undefined" && window.confirm(`Eliminare la camera "${unit.name}"?`)) { deleteUnit(unit.id); onClose(); } };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[6vh]">
      <button aria-label="Chiudi" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-lg font-bold text-txt">Scheda camera</span>
          <button onClick={onClose} className="rounded px-2 py-1 text-dim hover:bg-wash hover:text-txt">✕</button>
        </div>
        <div className="divide-y divide-[color:var(--line)]">
          <div className={RS_ROW}><span className="text-sm text-dim">Id</span><span className="font-mono text-sm text-faint">{idShort}</span></div>
          <div className={RS_ROW}><span className="text-sm text-dim">Tipologia</span><span className="text-sm text-txt">{typeName}</span></div>
          <div className={RS_ROW}><span className="text-sm text-dim">Nome *</span><input value={name} onChange={(e) => setName(e.target.value)} className={RS_FLD} /></div>
          <div className={RS_ROW}><span className="text-sm text-dim">Ordinamento *</span><input type="number" value={order} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setOrder(e.target.value)} className={RS_FLD} /></div>
          <div className={RS_ROW}><span className="text-sm text-dim">Frequenza cambio lenzuola</span><select value={linen} onChange={(e) => setLinen(e.target.value)} className={RS_FLD}>{FREQ_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
          <div className={RS_ROW}><span className="text-sm text-dim">Frequenza rassetto</span><select value={tidy} onChange={(e) => setTidy(e.target.value)} className={RS_FLD}>{FREQ_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
          <div className={RS_ROW}><span className="text-sm text-dim">Giorni servizio</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-line">
              {WEEK_DAYS.map((d) => { const on = days.includes(d); return <button key={d} onClick={() => toggleDay(d)} className="border-r border-line px-2.5 py-1.5 text-xs font-semibold last:border-r-0" style={on ? { backgroundColor: "var(--focus)", color: "#fff" } : { color: "var(--dim)" }}>{d}</button>; })}
            </div>
          </div>
          <div className={RS_ROW}><span className="text-sm text-dim">Stato pulizia</span><select value={clean} onChange={(e) => setClean(e.target.value)} className={RS_FLD}><option value="Da pulire">Da pulire</option><option value="Pulita">Pulita</option></select></div>
          <div className={RS_ROW}><span className="text-sm text-dim">Data ultima pulizia</span><span className="text-sm text-dim">{lastCleanTxt}</span></div>
          <div className={RS_ROW}><span className="text-sm text-dim">Stato lenzuola</span><select value={linenSt} onChange={(e) => setLinenSt(e.target.value)} className={RS_FLD}><option value="Da cambiare">Da cambiare</option><option value="Cambiate">Cambiate</option></select></div>
          <div className={RS_ROW}><span className="text-sm text-dim">Ultimo cambio lenzuola</span><span className="text-sm text-dim">{lastLinenTxt}</span></div>
        </div>
        <div className="mt-3"><span className="text-sm text-dim">Note interne</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${RS_FLD} mt-1 resize-y`} /></div>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">Chiudi</button>
          <button onClick={del} className="rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--err)" }}>Elimina</button>
          <button onClick={copy} className="ml-auto rounded-lg border border-line px-3 py-2 text-sm font-medium text-txt hover:bg-wash">Copia</button>
          <button onClick={save} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Salva</button>
        </div>
      </div>
    </div>
  );
}

function StripRow({ label, gridW, children }: { label: string; gridW: number; children: React.ReactNode }) {
  return (
    <div className="flex border-b border-line bg-surface">
      <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint" style={{ width: 212, height: 26 }}>
        {label}
      </div>
      <div className="flex" style={{ width: gridW, height: 26 }}>{children}</div>
    </div>
  );
}

