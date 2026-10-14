"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { roundCents, sumCents } from "@/lib/money";
import { PageHeader, Card, SectionTitle, StatCard } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import ExportMenu from "@/components/ExportMenu";
import { exportExcel, exportPdf } from "@/lib/export";
import CatIcon, { ICON_KEYS } from "@/components/CatIcon";
import Icon from "@/components/Icon";
import { useConfirm } from "@/components/ConfirmProvider";
import { useToast } from "@/components/ToastProvider";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/authsync";
import { type Kind, type Mov, type Rule, computeAuto, computeScheduled, occurrences, scopeVisible, loadCash, insertMovement, updateMovement, deleteMovement, insertRule, updateRule, deleteRule, addPaid, migrateLocalCash, groupBookingRows, computeBalances, OPENING_CAT, compactEuro, niceAxis, DEFAULT_CONTI, loadConti, saveConti, contoKeyFromLabel, type ContoDef, canDeleteConto, computeForecast, presetRange, matchesQuery, type Preset, loadContiPrefs, saveContiPrefs, moveItem, computeLedger } from "@/lib/cassa";
import SearchInput from "@/components/SearchInput";
import DateField from "@/components/DateField";
import { shiftISO } from "@/lib/dates";
import { fmtDMY } from "@/lib/dates";
import ChannelLogo from "@/components/ChannelLogo";
import { CHANNELS, type Channel } from "@/lib/types";
import { type PayoutMode, type PayoutSettings, PAYOUT_CHANNELS, WEEKDAY_LABELS, cleanRule, loadPayoutSettings, savePayoutSettings } from "@/lib/payouts";

// ---- Conti cassa ------------------------------------------------------------

// ---- Categorie (entrate / uscite) ------------------------------------------
interface Cat { key: string; label: string; kind: Kind; color: string; icon: string; auto?: boolean; custom?: boolean }
const DEFAULT_CATS: Cat[] = [
  // Entrate
  { key: "prenotazioni", label: "Prenotazioni", kind: "in", color: "#0E9F6E", icon: "bed", auto: true },
  { key: "extra", label: "Extra / Colazione", kind: "in", color: "#16A34A", icon: "coffee" },
  { key: "altro_in", label: "Altra entrata", kind: "in", color: "#65A30D", icon: "cash" },
  // Uscite
  { key: "commissioni", label: "Commissioni OTA", kind: "out", color: "#DC2626", icon: "percent", auto: true },
  { key: "apertura", label: "Saldo di partenza", kind: "in", color: "#2563EB", icon: "cash", auto: true },
  { key: "pulizie", label: "Pulizie", kind: "out", color: "#EA580C", icon: "sparkles" },
  { key: "utenze", label: "Utenze", kind: "out", color: "#D97706", icon: "bolt" },
  { key: "manutenzione", label: "Manutenzione", kind: "out", color: "#CA8A04", icon: "wrench" },
  { key: "forniture", label: "Forniture", kind: "out", color: "#9333EA", icon: "cart" },
  { key: "tasse", label: "Tasse e imposte", kind: "out", color: "#7C3AED", icon: "file" },
  { key: "personale", label: "Personale", kind: "out", color: "#2563EB", icon: "users" },
  { key: "marketing", label: "Marketing", kind: "out", color: "#0891B2", icon: "megaphone" },
  { key: "affitto", label: "Affitto", kind: "out", color: "#DB2777", icon: "home" },
  { key: "mutuo", label: "Mutuo", kind: "out", color: "#9D174D", icon: "bank" },
  { key: "altro_out", label: "Altra uscita", kind: "out", color: "#6B7280", icon: "box" },
];

const PALETTE = ["#DC2626", "#EA580C", "#D97706", "#CA8A04", "#16A34A", "#0E9F6E", "#0891B2", "#2563EB", "#4F46E5", "#7C3AED", "#9333EA", "#DB2777", "#6B7280", "#0F766E"];

const FREQ: Record<string, string> = { monthly: "Ogni mese", weekly: "Ogni settimana", yearly: "Ogni anno" };

const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" }); };
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m-${Math.floor(performance.now() * 1000)}`);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

const CATS_KEY = "spigolestay:cassa:cats";

export default function CassaPage() {
  const { bookings, guests, structures, activeStructureId, getStructure } = useData();
  const ask = useConfirm();
  const toast = useToast();
  const { t } = useLang();
  const { user } = useAuth();

  // Categorie (default + personalizzate).
  const [cats, setCats] = useState<Cat[]>(DEFAULT_CATS);
  const [conti, setConti] = useState<ContoDef[]>(() => (typeof window === "undefined" ? [...DEFAULT_CONTI] : loadConti())); // conti di base + quelli aggiunti (più banche…)
  const CONTI = conti;
  // Impostazioni incassi per canale: quando i soldi arrivano davvero sul conto (arrivo, check-out, bonifico settimanale o mensile).
  const [payouts, setPayouts] = useState<PayoutSettings>(() => (typeof window === "undefined" ? {} : loadPayoutSettings()));
  const [payoutModal, setPayoutModal] = useState(false);
  const [openPayouts, setOpenPayouts] = useState<Set<string>>(() => new Set()); // bonifici aperti nell'elenco
  const setPayoutRule = (ch: Channel, patch: Record<string, unknown>) => { const next = { ...payouts, [ch]: cleanRule({ ...(payouts[ch] ?? { mode: "arrival" }), ...patch }) }; setPayouts(next); savePayoutSettings(next); };
  const groupChannels = useMemo(() => new Set<string>(PAYOUT_CHANNELS.filter((c) => payouts[c]?.mode === "weekly" || payouts[c]?.mode === "monthly")), [payouts]);
  const [principal, setPrincipalState] = useState<string>(() => (typeof window === "undefined" ? "banca" : loadContiPrefs().principal)); // dove arrivano i soldi delle prenotazioni OTA
  useEffect(() => { try { const r = localStorage.getItem(CATS_KEY); if (r) { const saved = JSON.parse(r); const customs = saved.filter((c: Cat) => c.custom); setCats([...DEFAULT_CATS, ...customs]); } } catch {} }, []);
  const saveCats = (list: Cat[]) => { setCats(list); try { localStorage.setItem(CATS_KEY, JSON.stringify(list.filter((c) => c.custom))); } catch {} };
  const catOf = (k: string) => cats.find((c) => c.key === k);

  // Movimenti manuali, regole ricorrenti e occorrenze saldate — su Supabase (non più localStorage).
  const [manual, setManual] = useState<Mov[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [paid, setPaid] = useState<string[]>([]);
  const paidSet = useMemo(() => new Set(paid), [paid]);
  // Esito delle scritture sul server: se una fallisce si annulla la modifica fatta a video e si avvisa.
  const [saveErr, setSaveErr] = useState("");
  const checkWrite = (p: Promise<string | null>, what: string, rollback: () => void) => {
    p.then((err) => { if (err) { rollback(); setSaveErr(`${what} non salvato: ${err}. La modifica è stata annullata, riprova.`); } })
      .catch((e) => { rollback(); setSaveErr(`${what} non salvato: ${e instanceof Error ? e.message : "errore di rete"}. La modifica è stata annullata, riprova.`); });
  };
  useEffect(() => {
    if (!user) return;
    (async () => {
      await migrateLocalCash(user.id); // una-tantum: sale i vecchi dati locali sul server
      const c = await loadCash();
      setManual(c.movements); setRules(c.rules); setPaid(c.paid);
    })();
  }, [user]);

  const today = todayISO();

  // Movimenti automatici dalle prenotazioni + occorrenze programmate (logica condivisa con la Chiusura cassa).
  const auto = useMemo<Mov[]>(() => computeAuto(bookings, guests, getStructure, activeStructureId, principal, payouts), [bookings, guests, activeStructureId, getStructure, principal, payouts]);
  const ruleVisible = (structureId?: string) => scopeVisible(structureId, activeStructureId);
  const scheduled = useMemo<Mov[]>(() => computeScheduled(rules, paidSet, activeStructureId, today), [rules, activeStructureId, today, paidSet]);

  // Scadenze da registrare: occorrenze passate di regole NON automatiche, non ancora saldate (stato SCADUTA).
  const pending = useMemo(() => {
    const out: { rule: Rule; iso: string }[] = [];
    const from = fmt(new Date().getFullYear() - 2, new Date().getMonth(), 1);
    for (const r of rules) {
      if (r.auto || !ruleVisible(r.structureId)) continue;
      for (const iso of occurrences(r, from, today)) if (!paidSet.has(`${r.id}|${iso}`)) out.push({ rule: r, iso });
    }
    return out.sort((a, b) => (a.iso < b.iso ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, activeStructureId, today, paidSet]);
  const dropPaid = (keys: string[]) => setPaid((p) => p.filter((x) => !keys.includes(x)));
  const markPaid = (r: Rule, iso: string) => { const k = `${r.id}|${iso}`; setPaid((p) => [...p, k]); if (user) checkWrite(addPaid(user.id, [k]), "Il pagamento", () => dropPaid([k])); };
  const [pendAmt, setPendAmt] = useState<Record<string, string>>({}); // importo reale digitato per le scadenze a importo variabile
  const confirmVariable = (r: Rule, iso: string) => {
    const key = `${r.id}|${iso}`;
    const amt = roundCents(parseFloat((pendAmt[key] ?? String(r.amount)).replace(",", ".")) || 0);
    if (amt <= 0) { toast(t("Inserisci l'importo reale."), "error"); return; }
    const mov: Mov = { id: uid(), date: iso, kind: r.kind, cat: r.cat, desc: r.desc, amount: amt, conto: r.conto, structureId: r.structureId };
    setManual((prev) => [mov, ...prev]);
    if (user) checkWrite(insertMovement(user.id, mov), "Il movimento", () => setManual((prev) => prev.filter((m) => m.id !== mov.id)));
    markPaid(r, iso);
    toast(`${t("Registrato")} · ${r.desc} · ${eur(amt)}`, "success");
  };
  const markAllPaid = () => { const keys = pending.filter((p) => !p.rule.variable).map((p) => `${p.rule.id}|${p.iso}`); setPaid((p) => [...p, ...keys]); if (user) checkWrite(addPaid(user.id, keys), "I pagamenti", () => dropPaid(keys)); };

  // Prossime scadenze (dopo oggi).
  const upcoming = useMemo(() => {
    const horizon = fmt(new Date().getFullYear() + 1, new Date().getMonth(), 28);
    const from = fmt(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1);
    const list: { rule: Rule; date: string }[] = [];
    for (const r of rules) { if (!ruleVisible(r.structureId)) continue; for (const iso of occurrences(r, from, horizon)) list.push({ rule: r, date: iso }); }
    return list.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, activeStructureId]);

  const visibleManual = useMemo(() => manual.filter((m) => ruleVisible(m.structureId)), [manual, activeStructureId]);
  const all = useMemo(() => [...auto, ...scheduled, ...visibleManual].sort((a, b) => (a.date < b.date ? 1 : -1)), [auto, scheduled, visibleManual]);

  // Selettore mese.
  // Filtro: ricerca + periodo. All'apertura: OGGI E FUTURE (flusso di cassa da qui in avanti); si può passare a tutto lo storico o a un periodo.
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<"all" | "in" | "out" | "booking" | "sched" | "manual">("all"); // filtro per tipo di movimento
  const [catF, setCatF] = useState(""); // filtro per categoria
  const matchesTipo = (m: Mov) => {
    if (tipo === "all") return true;
    if (m.cat === OPENING_CAT) return false; // il saldo di partenza non è un movimento del periodo
    if (tipo === "in" || tipo === "out") return m.kind === tipo;
    if (tipo === "booking") return /^(auto-in|auto-comm|fc-in)-/.test(m.id);
    if (tipo === "sched") return !!m.sched;
    return !m.auto && !m.sched && !m.forecast; // inseriti a mano
  };
  const [preset, setPreset] = useState<Preset>("future");
  const [from, setFrom] = useState<string>(() => todayISO());
  const [to, setTo] = useState<string>("");
  const applyPreset = (p: Preset) => { setPreset(p); if (p !== "custom") { const r = presetRange(p, today); setFrom(r.from); setTo(r.to); } };
  const futureView = !!from && from >= today;       // si guarda da oggi in avanti: previsione
  const inPeriod = (iso: string) => (!from || iso >= from) && (!to || iso <= to);
  const periodWord = futureView ? t("previste") : preset === "all" ? t("totali") : t("del periodo");
  // Previsione a 6 mesi: dal mese in corso fino a fine del sesto mese (es. oggi 14.10 → 31.03).
  const fcEnd = useMemo(() => { const [y, m] = today.split("-").map(Number); const d = new Date(y, m - 1 + 6, 0); return fmt(d.getFullYear(), d.getMonth(), d.getDate()); }, [today]);
  const listHorizon = to || fcEnd;                   // senza "Al" la lista prevede i prossimi 6 mesi
  const [chartsOn, setChartsOn] = useState(true);
  const toggleCharts = () => setChartsOn((v) => !v); // aperti a ogni apertura della pagina; nasconderli vale solo per questa visita

  const forecastChart = useMemo<Mov[]>(() => computeForecast(bookings, guests, getStructure, rules, activeStructureId, today, fcEnd, principal, payouts), [bookings, guests, getStructure, rules, activeStructureId, today, fcEnd, principal, payouts]);
  const forecastView = useMemo(() => forecastChart.filter((x) => x.date <= listHorizon), [forecastChart, listHorizon]);
  const rows = [...all, ...forecastView]
    .filter((m) => inPeriod(m.date) && matchesTipo(m) && (!catF || m.cat === catF) && matchesQuery(m, q, { cat: catOf(m.cat)?.label, conto: CONTI.find((c) => c.key === m.conto)?.label }))
    .sort((a, b) => (futureView ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))); // da oggi: dal più vicino; storico: dal più recente
  const catsInRegister = new Set([...all, ...forecastView].map((m) => m.cat)); // categorie presenti nel registro (filtro Categoria: solo quelle attive)
  const rowsStat = rows.filter((m) => m.cat !== OPENING_CAT); // il saldo di partenza non è un incasso né una spesa del periodo
  const entrate = sumCents(rowsStat.filter((m) => m.kind === "in").map((m) => m.amount));
  const uscite = sumCents(rowsStat.filter((m) => m.kind === "out").map((m) => m.amount));
  const saldo = roundCents(entrate - uscite);

  const autoTutte = useMemo<Mov[]>(() => computeAuto(bookings, guests, getStructure, "all", principal, payouts), [bookings, guests, getStructure, principal, payouts]);
  const programmateTutte = useMemo<Mov[]>(() => computeScheduled(rules, paidSet, "all", today), [rules, paidSet, today]);
  const balances = useMemo(() => computeBalances([...autoTutte, ...programmateTutte, ...manual], today, CONTI.map((c) => c.key)), [autoTutte, programmateTutte, manual, today, CONTI]);
  const saldoConti: Record<string, number> = Object.fromEntries(CONTI.filter((c) => balances[c.key]?.since).map((c) => [c.key, balances[c.key].saldo])); // solo i conti con saldo di partenza: gli altri non hanno uno storico completo
  const saldoTot = sumCents(Object.values(saldoConti));
  const hasOpening = CONTI.some((c) => balances[c.key]?.since);
  // Ultima card in vista "oggi e future": saldo previsto = saldo attuale dei conti + entrate − uscite dei giorni dopo oggi (quelli di oggi sono già nel saldo attuale).
  const saldoPrevisto = roundCents(saldoTot + sumCents(rowsStat.filter((m) => m.date > today).map((m) => (m.kind === "in" ? m.amount : -m.amount))));
  const prevCard = futureView && hasOpening;
  // Estratto conto: saldo dopo ogni movimento, solo per la struttura selezionata in alto a destra (con "tutte" sono tutte). I saldi di partenza dei conti valgono sempre.
  const ledgerManual = useMemo(() => manual.filter((m) => m.cat === OPENING_CAT || ruleVisible(m.structureId)), [manual, activeStructureId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ledger = useMemo(() => computeLedger([...auto, ...scheduled, ...ledgerManual, ...forecastView]), [auto, scheduled, ledgerManual, forecastView]);
  const ledgerOrd = (x: Mov) => ledger.order.get(x.id) ?? 0;
  const bkOf = (x: Mov) => (x.ref && /^(auto-in|auto-comm|fc-in)-/.test(x.id) ? bookings.find((b) => b.id === x.ref) : undefined); // prenotazione da cui nasce il movimento
  const rowsOrdered = [...rows].sort((a, b) => { const d = a.date < b.date ? -1 : a.date > b.date ? 1 : ledgerOrd(a) - ledgerOrd(b); return futureView ? d : -d; });
  const listRows = groupBookingRows(rowsOrdered, groupChannels);
  // cella "saldo conti" (riusata dalle voci bonifico)
  const balCell = (bal: number | null, inc: boolean) => (
    <div className="-my-1.5 flex items-center justify-end self-stretch border-l border-line pl-2">
      {inc
        ? <span className="justify-self-end px-2 text-right text-[11px] italic text-faint" title={t("Questo movimento è del giorno in cui hai impostato il saldo: è già compreso nell'importo che hai scritto.")}>{t("già nel saldo")}</span>
        : <span className={"justify-self-end rounded-md px-2 py-0.5 text-right font-mono text-sm font-semibold tabular-nums " + (bal === null ? "text-faint" : bal < 0 ? "text-[color:var(--err)]" : "text-txt")} style={bal !== null && bal < 0 ? { backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)" } : undefined}>{bal === null ? "—" : eur(bal)}</span>}
    </div>
  );

  // ---- Saldo di partenza: scrivi quanto hai oggi su un conto, da lì il saldo si aggiorna ----
  const [opening, setOpening] = useState<{ date: string; amounts: Record<string, string>; newName: string; startOfDay: boolean } | null>(null);
  const openOpening = () => {
    const amounts: Record<string, string> = {};
    for (const c of CONTI) amounts[c.key] = balances[c.key]?.since ? String(balances[c.key].start ?? "").replace(".", ",") : "";
    setOpening({ date: todayISO(), amounts, newName: "", startOfDay: false });
  };
  const addConto = () => {
    if (!opening) return;
    const label = opening.newName.trim();
    if (!label) return;
    const key = contoKeyFromLabel(label, conti);
    const next = [...conti, { key, label }];
    setConti(next); saveConti(next);
    setOpening((o) => (o ? { ...o, newName: "", amounts: { ...o.amounts, [key]: "" } } : o));
  };
  const moveConto = (key: string, dir: -1 | 1) => { const next = moveItem(conti, conti.findIndex((c) => c.key === key), dir); if (next !== conti) { setConti(next); saveConti(next); } };
  const makePrincipal = (key: string) => {
    setPrincipalState(key); saveContiPrefs({ ...loadContiPrefs(), principal: key });
    const first = [...conti].sort((a, b) => (a.key === key ? -1 : b.key === key ? 1 : 0)); setConti(first); saveConti(first); // il principale va in cima
  };
  const [renaming, setRenaming] = useState<{ key: string; label: string } | null>(null);
  const renameConto = () => {
    if (!renaming) return;
    const label = renaming.label.trim();
    if (label) { const next = conti.map((c) => (c.key === renaming.key ? { ...c, label } : c)); setConti(next); saveConti(next); }
    setRenaming(null);
  };
  const deleteConto = async (c: ContoDef) => {
    const chk = canDeleteConto(c.key, [...autoTutte, ...programmateTutte, ...manual], rules, [principal, "contanti"]);
    if (!chk.ok) { await ask({ title: t("Conto non eliminabile"), message: t(chk.reason ?? ""), confirmLabel: t("Ho capito") }); return; }
    if (!(await ask({ title: t("Elimina conto"), message: `${t("Eliminare il conto")} «${c.label}»? ${t("Il suo saldo di partenza verrà tolto.")}`, danger: true, confirmLabel: t("Elimina") }))) return;
    const next = conti.filter((x) => x.key !== c.key);
    setConti(next); saveConti(next);
    const olds = manual.filter((x) => x.cat === OPENING_CAT && x.conto === c.key);
    if (olds.length) {
      const ids = new Set(olds.map((o) => o.id));
      setManual((prev) => prev.filter((x) => !ids.has(x.id)));
      if (user) for (const o of olds) checkWrite(deleteMovement(o.id), "Il saldo di partenza", () => setManual((prev) => (prev.some((x) => x.id === o.id) ? prev : [o, ...prev])));
    }
    setOpening((o) => { if (!o) return o; const { [c.key]: _gone, ...rest } = o.amounts; void _gone; return { ...o, amounts: rest }; });
  };
  const openingTotal = opening ? sumCents(CONTI.map((c) => { const v = parseFloat((opening.amounts[c.key] ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(v) ? v : 0; })) : 0;
  const saveOpening = () => {
    if (!opening) return;
    const date0 = opening.date || todayISO();
    const date = opening.startOfDay ? shiftISO(date0, -1) : date0; // saldo di inizio giornata: valido dalla sera prima, così contano anche i movimenti di quel giorno
    const newMovs: Mov[] = []; const olds: Mov[] = [];
    for (const c of CONTI) {
      const txt = (opening.amounts[c.key] ?? "").trim();
      if (!txt) continue;
      const raw = parseFloat(txt.replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(raw)) continue;
      newMovs.push({ id: uid(), date, kind: raw >= 0 ? "in" : "out", cat: OPENING_CAT, desc: `${t("Saldo di partenza")} · ${c.label}`, amount: roundCents(Math.abs(raw)), conto: c.key });
      olds.push(...manual.filter((x) => x.cat === OPENING_CAT && x.conto === c.key)); // il nuovo sostituisce quello di prima
    }
    if (!newMovs.length) { setOpening(null); return; }
    const oldIds = new Set(olds.map((o) => o.id));
    setManual((prev) => [...newMovs, ...prev.filter((x) => !oldIds.has(x.id))]);
    if (user) {
      for (const o of olds) checkWrite(deleteMovement(o.id), "Il saldo di partenza precedente", () => setManual((prev) => (prev.some((x) => x.id === o.id) ? prev : [o, ...prev])));
      for (const mv of newMovs) checkWrite(insertMovement(user.id, mv), "Il saldo di partenza", () => setManual((prev) => prev.filter((x) => x.id !== mv.id)));
    }
    setOpening(null);
  };

  const perCat = useMemo(() => { const map: Record<string, number> = {}; for (const m of rowsStat) if (m.kind === "out") map[m.cat] = roundCents((map[m.cat] ?? 0) + m.amount); return Object.entries(map).map(([k, v]) => ({ cat: catOf(k), v })).filter((x) => x.cat).sort((a, b) => b.v - a.v); }, [rowsStat]);
  const maxCat = Math.max(1, ...perCat.map((x) => x.v));

  const chartSrc = useMemo(() => [...all, ...(futureView ? forecastChart : [])], [all, forecastChart, futureView]);
  const trend = useMemo(() => {
    const n = futureView ? 6 : 12; // previsione: 6 mesi da quello in corso; altrimenti 12 mesi fino a "Al" o a oggi
    const base = futureView ? monthKey(fcEnd) : to ? monthKey(to) : monthKey(today);
    const [by, bm] = base.split("-").map(Number);
    const list: { ym: string; in: number; out: number }[] = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(by, bm - 1 - i, 1); const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; const mm = chartSrc.filter((m) => monthKey(m.date) === ym && m.cat !== OPENING_CAT); list.push({ ym, in: sumCents(mm.filter((m) => m.kind === "in").map((m) => m.amount)), out: sumCents(mm.filter((m) => m.kind === "out").map((m) => m.amount)) }); }
    return list;
  }, [chartSrc, futureView, to, today, fcEnd]);
  const maxTrend = Math.max(1, ...trend.flatMap((t) => [t.in, t.out]));
  const axis = niceAxis(maxTrend); // asse Y a 4 intervalli con massimo "tondo"
  const axisTicks = [0, 1, 2, 3, 4].map((i) => i * axis.step);

  // ---- Form nuovo movimento -------------------------------------------------
  const [form, setForm] = useState<{ kind: Kind; date: string; cat: string; desc: string; amount: string; conto: string; struttura: string; repeat: "once" | "monthly" | "weekly" | "yearly" }>(() => ({ kind: "out", date: todayISO(), cat: "pulizie", desc: "", amount: "", conto: "contanti", struttura: activeStructureId, repeat: "once" }));
  const setKind = (k: Kind) => setForm((f) => ({ ...f, kind: k, cat: cats.find((c) => c.kind === k && !c.auto)!.key }));
  const NEW_MOV = "__nuovo__";
  const [editingMov, setEditingMov] = useState<string | null>(null); // finestra movimento: id del movimento in modifica, NEW_MOV per uno nuovo, null = chiusa
  const openNewMov = () => { setForm((f) => ({ ...f, kind: "out", cat: cats.find((c) => c.kind === "out" && !c.auto)!.key, desc: "", amount: "", repeat: "once", date: todayISO(), struttura: activeStructureId })); setEditingMov(NEW_MOV); };
  const resetForm = () => { setEditingMov(null); setForm((f) => ({ ...f, desc: "", amount: "", repeat: "once", date: todayISO() })); };
  const startEditMov = (m: Mov) => {
    setEditingMov(m.id);
    setForm({ kind: m.kind, date: m.date, cat: m.cat, desc: m.desc, amount: String(m.amount).replace(".", ","), conto: m.conto, struttura: m.structureId ?? activeStructureId, repeat: "once" });
  };
  // Se la data del movimento cade fuori dal periodo mostrato, allarga il periodo: la riga appena registrata deve vedersi nell'elenco.
  const showDate = (d: string) => {
    if (from && d < from) { setFrom(d); setPreset("custom"); }
    if (to && d > to) { setTo(d); setPreset("custom"); }
  };
  const add = () => {
    const amt = roundCents(parseFloat(form.amount.replace(",", ".")) || 0); // al centesimo (prima era arrotondato all'euro)
    if (amt <= 0) { toast(t("Inserisci un importo maggiore di zero."), "error"); return; }
    if (!form.date) { toast(t("Inserisci la data."), "error"); return; }
    const desc = form.desc.trim() || catOf(form.cat)?.label || "";
    const summary = `${fmtDMY(form.date)} · ${form.kind === "in" ? "+" : "−"} ${eur(amt)}`;
    if (editingMov && editingMov !== NEW_MOV) {
      const prev = manual.find((m) => m.id === editingMov);
      if (!prev) { resetForm(); return; }
      const next: Mov = { ...prev, date: form.date, kind: form.kind, cat: form.cat, desc, amount: amt, conto: form.conto, structureId: form.struttura };
      setManual((all) => all.map((m) => (m.id === prev.id ? next : m)));
      if (user) checkWrite(updateMovement(prev.id, next), "La modifica", () => setManual((all) => all.map((m) => (m.id === prev.id ? prev : m))));
      showDate(form.date);
      toast(`${t("Movimento modificato")} · ${summary}`, "success");
      resetForm();
      return;
    }
    const mov: Mov = { id: uid(), date: form.date, kind: form.kind, cat: form.cat, desc, amount: amt, conto: form.conto, structureId: form.struttura };
    setManual((prev) => [mov, ...prev]);
    if (user) checkWrite(insertMovement(user.id, mov), "Il movimento", () => setManual((prev) => prev.filter((m) => m.id !== mov.id)));
    showDate(form.date);
    toast(`${t("Movimento registrato")} · ${summary}`, "success");
    // Ricorrente: crea la regola che riparte dal periodo SUCCESSIVO (questo è già registrato come movimento).
    if (form.repeat !== "once") {
      const d = new Date(form.date);
      if (form.repeat === "monthly") d.setMonth(d.getMonth() + 1);
      else if (form.repeat === "weekly") d.setDate(d.getDate() + 7);
      else d.setFullYear(d.getFullYear() + 1);
      const nextStart = fmt(d.getFullYear(), d.getMonth(), d.getDate());
      const rule: Rule = { id: uid(), kind: form.kind, cat: form.cat, desc, amount: amt, conto: form.conto, structureId: form.struttura, freq: form.repeat, day: parseInt(form.date.slice(8, 10)) || 1, start: nextStart, auto: true };
      setRules((prev) => [...prev, rule]);
      if (user) checkWrite(insertRule(user.id, rule), "Il pagamento ricorrente", () => setRules((prev) => prev.filter((r) => r.id !== rule.id)));
    }
    resetForm();
  };
  const del = async (id: string) => { if (!(await ask({ message: t("Eliminare questo movimento?"), danger: true, confirmLabel: t("Elimina") }))) return; const gone = manual.find((m) => m.id === id); setManual((prev) => prev.filter((m) => m.id !== id)); checkWrite(deleteMovement(id), "L'eliminazione", () => { if (gone) setManual((prev) => (prev.some((m) => m.id === gone.id) ? prev : [gone, ...prev])); }); };

  // ---- Modale selezione/gestione categorie ----------------------------------
  const [catPicker, setCatPicker] = useState(false);
  const [catFor, setCatFor] = useState<"form" | "rule">("form"); // il selettore categoria serve il modulo movimento o il pagamento programmato
  const [newCat, setNewCat] = useState<{ label: string; color: string; icon: string } | null>(null);
  const openNewCat = () => setNewCat({ label: "", color: PALETTE[8], icon: "star" });
  const createCat = () => {
    if (!newCat || !newCat.label.trim()) return;
    const key = `c-${uid().slice(0, 8)}`;
    const cat: Cat = { key, label: newCat.label.trim(), kind: catFor === "rule" ? rf.kind : form.kind, color: newCat.color, icon: newCat.icon, custom: true };
    saveCats([...cats, cat]);
    if (catFor === "rule") setRf((f) => ({ ...f, cat: key })); else setForm((f) => ({ ...f, cat: key }));
    setNewCat(null);
  };
  const deleteCat = async (key: string) => { if (!(await ask({ message: t("Eliminare questa categoria?"), danger: true, confirmLabel: t("Elimina") }))) return; saveCats(cats.filter((c) => c.key !== key)); if (form.cat === key) setForm((f) => ({ ...f, cat: cats.find((c) => c.kind === f.kind && !c.auto && c.key !== key)!.key }));
    if (rf.cat === key) setRf((f) => ({ ...f, cat: cats.find((c) => c.kind === f.kind && !c.auto && c.key !== key)?.key ?? f.cat })); };

  // ---- Modale pagamento programmato -----------------------------------------
  const [ruleModal, setRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<string | null>(null); // id della regola in modifica (null = nuova)
  const [rf, setRf] = useState<{ kind: Kind; cat: string; desc: string; amount: string; conto: string; struttura: string; freq: Rule["freq"]; day: string; start: string; auto: boolean; end: string; note?: string; variable: boolean }>(() => ({ kind: "out", cat: "affitto", desc: "", amount: "", conto: "banca", struttura: activeStructureId, freq: "monthly", day: "1", start: todayISO(), auto: true, end: "", note: "", variable: false }));
  // La struttura del nuovo movimento/regola segue la struttura selezionata in alto a destra.
  useEffect(() => { setForm((f) => ({ ...f, struttura: activeStructureId })); setRf((f) => ({ ...f, struttura: activeStructureId })); }, [activeStructureId]);
  const openNewRule = () => { setEditingRule(null); setRuleModal(true); };
  const openEditRule = (r: Rule) => {
    setEditingRule(r.id);
    setRf({ kind: r.kind, cat: r.cat, desc: r.desc, amount: String(r.amount).replace(".", ","), conto: r.conto, struttura: r.structureId ?? activeStructureId, freq: r.freq, day: String(r.day), start: r.start, auto: r.auto, end: r.end ?? "", note: r.note ?? "", variable: !!r.variable });
    setRuleModal(true);
  };
  const closeRuleModal = () => { setRuleModal(false); setEditingRule(null); };
  const addRule = () => {
    const amt = roundCents(parseFloat(rf.amount.replace(",", ".")) || 0);
    if (amt <= 0) return;
    if (editingRule) {
      const prev = rules.find((r) => r.id === editingRule);
      if (!prev) return closeRuleModal();
      const next: Rule = { ...prev, kind: rf.kind, cat: rf.cat, desc: rf.desc.trim() || catOf(rf.cat)?.label || "", amount: amt, conto: rf.conto, structureId: rf.struttura, freq: rf.freq, day: parseInt(rf.day) || 1, start: rf.start, auto: rf.variable ? false : rf.auto, end: rf.end || undefined, note: rf.note?.trim() || undefined, variable: rf.variable };
      setRules((all) => all.map((r) => (r.id === prev.id ? next : r)));
      if (user) checkWrite(updateRule(prev.id, next), "La modifica", () => setRules((all) => all.map((r) => (r.id === prev.id ? prev : r))));
      closeRuleModal();
      return;
    }
    const rule: Rule = { id: uid(), kind: rf.kind, cat: rf.cat, desc: rf.desc.trim() || catOf(rf.cat)?.label || "", amount: amt, conto: rf.conto, structureId: rf.struttura, freq: rf.freq, day: parseInt(rf.day) || 1, start: rf.start, auto: rf.variable ? false : rf.auto, end: rf.end || undefined, note: rf.note?.trim() || undefined, variable: rf.variable };
    setRules((prev) => [...prev, rule]);
    if (user) checkWrite(insertRule(user.id, rule), "Il pagamento programmato", () => setRules((prev) => prev.filter((r) => r.id !== rule.id)));
    closeRuleModal();
    setRf((f) => ({ ...f, desc: "", amount: "" }));
  };
  const delRule = async (id: string) => { if (!(await ask({ message: t("Eliminare questo pagamento programmato?"), danger: true, confirmLabel: t("Elimina") }))) return; const gone = rules.find((r) => r.id === id); setRules((prev) => prev.filter((r) => r.id !== id)); checkWrite(deleteRule(id), "L'eliminazione", () => { if (gone) setRules((prev) => (prev.some((r) => r.id === gone.id) ? prev : [...prev, gone])); }); };
  const monthlyRecurring = sumCents(rules.filter((r) => r.freq === "monthly" && ruleVisible(r.structureId)).map((r) => (r.kind === "out" ? r.amount : -r.amount)));

  const selCat = catOf(form.cat);
  const structNameOf = (id?: string) => (!id || id === "all" ? t("Tutte") : getStructure(id)?.name ?? "—");

  // ---- Export ---------------------------------------------------------------
  const periodLabel = from || to ? `${from || "inizio"}_${to || "in-poi"}` : "storico";
  const doExcel = () => {
    const headers = [t("Data"), t("Tipo"), t("Categoria"), t("Descrizione"), t("Conto"), t("Struttura"), `${t("Entrata")} €`, `${t("Uscita")} €`];
    const body = rows.map((m) => [m.date, m.kind === "in" ? t("Entrata") : t("Uscita"), catOf(m.cat)?.label ? t(catOf(m.cat)!.label) : m.cat, m.desc + (m.sched ? ` (${t("programmato")})` : m.auto ? ` (${t("auto")})` : ""), CONTI.find((x) => x.key === m.conto)?.label ? t(CONTI.find((x) => x.key === m.conto)!.label) : m.conto, structNameOf(m.structureId), m.kind === "in" ? m.amount : "", m.kind === "out" ? m.amount : ""]);
    body.push(["", "", "", "", "", t("TOTALI"), entrate, uscite]);
    body.push(["", "", "", "", "", t("SALDO"), saldo, ""]);
    exportExcel(`cassa-${periodLabel}`, headers, body);
  };

  const iconCircle = (c?: Cat, size = 34) => (
    <span className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, backgroundColor: `color-mix(in srgb, ${c?.color ?? "#888"} 16%, transparent)`, color: c?.color ?? "#888" }}>
      <CatIcon name={c?.icon} size={size * 0.52} />
    </span>
  );

  return (
    <div>
      <PageHeader title={t("Cassa · Prima Nota")} subtitle={t("Entrate e uscite, saldo e analisi della cassa")} />
      {saveErr && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[color:var(--err)] bg-paper px-3 py-2 text-sm" style={{ color: "var(--err)" }}>
          <span>{saveErr}</span>
          <button type="button" className="shrink-0 font-semibold underline" onClick={() => setSaveErr("")}>Chiudi</button>
        </div>
      )}

      {/* Riepilogo */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("Saldo attuale")} value={hasOpening ? eur(saldoTot) : "—"} color={hasOpening && saldoTot < 0 ? "var(--err)" : undefined} onClick={() => openOpening()} hint={hasOpening ? <>{Object.keys(saldoConti).length} {t("conti")}</> : t("Imposta il saldo di partenza →")} />
        <StatCard label={`${t("Entrate")} ${periodWord}`} value={eur(entrate)} color="var(--ok)" hint={`${rows.filter((m) => m.kind === "in").length} ${t("movimenti")}`} />
        <StatCard label={`${t("Uscite")} ${periodWord}`} value={eur(uscite)} color="var(--err)" hint={`${rows.filter((m) => m.kind === "out").length} ${t("movimenti")}`} />
        <StatCard label={`${t("Saldo")} ${futureView ? t("previsto") : preset === "all" ? t("totale") : t("del periodo")}`} value={eur(prevCard ? saldoPrevisto : saldo)} color={(prevCard ? saldoPrevisto : saldo) >= 0 ? undefined : "var(--err)"} hint={prevCard ? <>{t("con saldo attuale")} · {t("al")} {fmtDMY(listHorizon)}</> : t("entrate − uscite")} />
      </div>

      {chartsOn && (
      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <SectionTitle>{t("Uscite per categoria")}</SectionTitle>
          {perCat.length === 0 ? <p className="text-sm text-faint">{t("Nessuna uscita nel periodo.")}</p> : (
            <div className="flex flex-col gap-2.5">
              {perCat.map(({ cat, v }) => (
                <div key={cat!.key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-dim"><span style={{ color: cat!.color }}><CatIcon name={cat!.icon} size={15} /></span>{t(cat!.label)}</span>
                    <span className="font-mono text-txt">{eur(v)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${(v / maxCat) * 100}%`, backgroundColor: cat!.color }} /></div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between gap-3">
            <SectionTitle>{futureView ? t("Previsione prossimi 6 mesi") : t("Andamento ultimi 12 mesi")}</SectionTitle>
            <div className="flex items-center gap-4 text-xs text-dim"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--ok)" }} />{t("Entrate")}</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--err)" }} />{t("Uscite")}</span></div>
          </div>
          <div className="flex" style={{ height: 160 }}>
            {/* asse Y */}
            <div className="relative mr-2 w-9 shrink-0" style={{ marginTop: 18, height: 120 }}>
              {axisTicks.map((v) => <span key={v} className="absolute right-0 -translate-y-1/2 font-mono text-[9px] leading-none text-faint" style={{ top: `${100 - (v / axis.max) * 100}%` }}>{compactEuro(v)}</span>)}
            </div>
            <div className="relative min-w-0 flex-1">
              {/* linee di riferimento */}
              <div className="pointer-events-none absolute inset-x-0" style={{ top: 18, height: 120 }}>
                {axisTicks.map((v) => <div key={v} className="absolute inset-x-0 border-t border-dashed border-line" style={{ top: `${100 - (v / axis.max) * 100}%`, opacity: v === 0 ? 1 : 0.7 }} />)}
              </div>
              <div className="relative flex items-end justify-between gap-2 pt-[18px]" style={{ height: 160 }}>
                {trend.map((tr) => (
                  <div key={tr.ym} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex w-full items-end justify-center gap-1.5" style={{ height: 120 }}>
                      <div className="relative w-1/3 max-w-[26px] rounded-t" title={`${t("Entrate")} ${eur(tr.in)}`} style={{ height: `${(tr.in / axis.max) * 100}%`, backgroundColor: "var(--ok)", minHeight: tr.in > 0 ? 3 : 0 }}>
                        {tr.in > 0 && <span className="absolute bottom-full left-1/2 mb-0.5 hidden -translate-x-1/2 whitespace-nowrap font-mono text-[8px] leading-none text-dim sm:block">{compactEuro(tr.in)}</span>}
                      </div>
                      <div className="relative w-1/3 max-w-[26px] rounded-t" title={`${t("Uscite")} ${eur(tr.out)}`} style={{ height: `${(tr.out / axis.max) * 100}%`, backgroundColor: "var(--err)", minHeight: tr.out > 0 ? 3 : 0 }}>
                        {tr.out > 0 && <span className="absolute bottom-full left-1/2 mb-0.5 hidden -translate-x-1/2 whitespace-nowrap font-mono text-[8px] leading-none text-dim sm:block">{compactEuro(tr.out)}</span>}
                      </div>
                    </div>
                    <span className="text-[10px] capitalize text-faint">{monthLabel(tr.ym).split(" ")[0].slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
      )}

      {/* Riga filtri + toggle grafici + Esporta */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <SearchInput value={q} onChange={setQ} placeholder={t("Cerca movimento…")} className="min-w-[220px] max-w-md flex-1" />
        <div className="flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-line bg-surface px-1 py-1">
          <select aria-label={t("Periodo")} value={preset} onChange={(e) => applyPreset(e.target.value as Preset)} className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">
            <option value="future">{t("Oggi e future")}</option>
            <option value="all">{t("Tutto lo storico")}</option>
            <option value="month">{t("Questo mese")}</option>
            <option value="prevMonth">{t("Mese scorso")}</option>
            <option value="year">{t("Quest'anno")}</option>
            <option value="prevYear">{t("Anno scorso")}</option>
            <option value="custom">{t("Personalizzato")}</option>
          </select>
          <DateField value={from} onChange={(v) => { setFrom(v); setPreset("custom"); }} title={t("Dal")} placeholder={t("Dal")} className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs transition hover:border-focus" />
          <span className="text-xs text-faint">→</span>
          <DateField value={to} onChange={(v) => { setTo(v); setPreset("custom"); }} title={t("Al")} placeholder={t("Al")} className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs transition hover:border-focus" />
        </div>
        <select aria-label={t("Tipo di movimento")} value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className={`rounded-lg border bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus ${tipo === "all" ? "border-line" : "border-focus"}`}>
          <option value="all">{t("Tutti i movimenti")}</option>
          <option value="in">{t("Solo entrate")}</option>
          <option value="out">{t("Solo uscite")}</option>
          <option value="booking">{t("Prenotazioni")}</option>
          <option value="sched">{t("Pagamenti programmati")}</option>
          <option value="manual">{t("Inseriti a mano")}</option>
        </select>
        <select aria-label={t("Categoria")} value={catF} onChange={(e) => setCatF(e.target.value)} className={`rounded-lg border bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus ${catF ? "border-focus" : "border-line"}`}>
          <option value="">{t("Tutte le categorie")}</option>
          {cats.filter((c) => c.key !== OPENING_CAT && (c.key === catF || catsInRegister.has(c.key))).map((c) => <option key={c.key} value={c.key}>{c.label ? t(c.label) : c.key}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggleCharts} title={chartsOn ? t("Nascondi i grafici") : t("Mostra i grafici")} className={`grid h-8 w-8 place-items-center rounded-lg border transition ${chartsOn ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] text-focus" : "border-line text-dim hover:bg-wash hover:text-txt"}`}><Icon name="chart" size={15} /></button>
          <button onClick={() => setPayoutModal(true)} title={t("Impostazioni incassi")} aria-label={t("Impostazioni incassi")} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-dim transition hover:bg-wash hover:text-txt"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg></button>
          <button onClick={openNewMov} className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">＋ {t("Nuovo movimento")}</button>
          <ExportMenu onExcel={doExcel} onPdf={exportPdf} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 flex items-center justify-between"><SectionTitle>{t("Movimenti")}</SectionTitle><span className="text-xs text-faint">{listRows.length} {t("nel periodo")}</span></div>
            {rows.length === 0 ? <EmptyState title={t("Nessun movimento.")} /> : (
              <div className="-mx-1 max-h-[640px] overflow-auto px-1">
              <div className="min-w-[920px]">
              <div className="grid grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] items-center gap-x-3 sticky top-0 z-10 border-b border-line bg-surface pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                <span>{t("Data")}</span><span>{t("Movimento")}</span><span className="text-right">{t("Lordo")}</span><span className="text-right">{t("Commissioni")}</span><span className="text-right">{t("Netto")}</span><span className="-mb-1.5 self-stretch border-l border-line pb-1.5 pl-2 text-right" title={t("Saldo dei conti dopo ogni movimento, per la struttura selezionata")}>{t("Saldo conti")}</span>
              </div>
              <div className="flex flex-col divide-y divide-[color:var(--line)]">
                {listRows.map((r) => {
                  if (r.type === "payout") {
                    const open = openPayouts.has(r.id);
                    const lastId = r.movIds.reduce((best, id) => ((ledger.order.get(id) ?? 0) > (ledger.order.get(best) ?? 0) ? id : best), r.movIds[0]);
                    const ch = r.channel as Channel;
                    return (
                      <div key={r.id}>
                        <div onClick={() => setOpenPayouts((prev) => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} title={open ? t("Chiudi il dettaglio") : t("Mostra le prenotazioni di questo pagamento")} className="grid grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] cursor-pointer items-center gap-x-3 whitespace-nowrap rounded py-1.5 hover:bg-wash">
                          <span className="font-mono text-xs text-dim">{fmtDMY(r.date)}</span>
                          <div className="flex min-w-0 items-center gap-2">
                            <ChannelLogo channel={ch} size={24} title={CHANNELS[ch]?.label} />
                            <span className="truncate text-sm font-medium text-txt">{CHANNELS[ch]?.label} · {t("pagamento")} · {r.count} {r.count === 1 ? t("prenotazione") : t("prenotazioni")}</span>
                            {r.forecast && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("previsto")}</span>}
                            <span className="shrink-0 text-faint">{open ? "▾" : "▸"}</span>
                          </div>
                          <span className="text-right font-mono text-xs" style={{ color: "var(--ok)" }}>+ {eur(r.gross)}</span>
                          <span className="text-right font-mono text-xs" style={{ color: "var(--err)" }}>− {eur(r.comm)}</span>
                          <span className="text-right font-mono text-sm font-bold text-txt">{eur(r.net)}</span>
                          {balCell(ledger.balanceAfter.get(lastId) ?? null, ledger.included.has(lastId))}
                        </div>
                        {open && r.items.map((it) => {
                          if (it.type === "payout") return null;
                          const im = it.type === "booking" ? it.income : it.mov;
                          const ib = bkOf(im);
                          const gn = ib ? (guests.find((g) => g.id === ib.guestId)?.fullName || "Ospite") : im.desc;
                          const g2 = it.type === "booking" ? it.gross : im.kind === "in" ? im.amount : 0;
                          const c2 = it.type === "booking" ? it.comm : im.kind === "out" ? im.amount : 0;
                          return (
                            <div key={"i-" + im.id} className="grid grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] items-center gap-x-3 whitespace-nowrap bg-wash/40 py-1 text-xs text-dim">
                              <span />
                              <span className="truncate pl-9">{gn}{ib ? <span className="text-faint"> · {t("check-out")} {fmtDMY(ib.checkOut)}</span> : null}</span>
                              <span className="text-right font-mono">{g2 ? `+ ${eur(g2)}` : ""}</span>
                              <span className="text-right font-mono">{c2 ? `− ${eur(c2)}` : ""}</span>
                              <span className="text-right font-mono">{eur(roundCents(g2 - c2))}</span>
                              <div className="-my-1 self-stretch border-l border-line" />
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                  const isBooking = r.type === "booking";
                  const m = isBooking ? r.income : r.mov;
                  const c = catOf(m.cat);
                  const bk = bkOf(m);
                  const gname = bk ? (guests.find((g) => g.id === bk.guestId)?.fullName || "Ospite") : "";
                  const title = bk ? (m.id.startsWith("auto-comm-") ? t("Commissione") + " · " + gname : m.id.startsWith("fc-in-") ? gname + " · " + t("da incassare") : gname) : m.desc;
                  // saldo in quella data = dopo l'ultimo movimento della riga (per la prenotazione: dopo incasso e commissione)
                  const lastId = isBooking && r.commission && ledgerOrd(r.commission) > ledgerOrd(r.income) ? r.commission.id : m.id;
                  const bal = ledger.balanceAfter.get(lastId) ?? null;
                  // riga modificabile: movimento inserito a mano (si apre la finestra di modifica) o saldo di partenza (si apre la finestra del saldo)
                  const rowClick = isBooking || m.auto || m.sched || m.forecast ? undefined : m.cat === OPENING_CAT ? () => openOpening() : () => startEditMov(m);
                  const included = ledger.included.has(lastId); // del giorno del saldo di partenza: già nell'importo scritto
                  return (
                    <div key={isBooking ? "b-" + r.id : m.id} onClick={rowClick} title={rowClick ? t("Clicca per modificare") : undefined} className={"grid grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] items-center gap-x-3 whitespace-nowrap py-1.5" + (rowClick ? " cursor-pointer rounded hover:bg-wash" : "")}>
                      <span className="font-mono text-xs text-dim">{fmtDMY(m.date)}</span>
                      <div className="flex min-w-0 items-center gap-2">
                        {bk ? <ChannelLogo channel={bk.channel} size={24} title={CHANNELS[bk.channel]?.label} /> : iconCircle(c, 24)}
                        <span className="truncate text-sm font-medium text-txt">{title}</span>
                        {m.forecast ? <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("previsto")}</span> : (m.auto && <span className="shrink-0 rounded bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-faint">{t("auto")}</span>)}
                        {!isBooking && m.sched && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>{t("programmato")}</span>}
                        <span className="min-w-0 truncate text-[11px] text-faint">{[c?.label ? t(c.label) : "", (() => { const l = CONTI.find((x) => x.key === m.conto)?.label; return l ? t(l) : ""; })(), activeStructureId === "all" && m.structureId && m.structureId !== "all" ? structNameOf(m.structureId) : ""].filter(Boolean).join(" · ")}</span>
                      </div>
                      {isBooking ? (
                        <>
                          <span className="text-right font-mono text-xs" style={{ color: "var(--ok)" }}>+ {eur(r.gross)}</span>
                          <span className="text-right font-mono text-xs" style={{ color: "var(--err)" }}>− {eur(r.comm)}</span>
                          <span className="text-right font-mono text-sm font-bold text-txt">{eur(r.net)}</span>
                        </>
                      ) : (
                        <>
                          <span />
                          <span />
                          <span className="text-right font-mono text-sm font-semibold" style={{ color: m.kind === "in" ? "var(--ok)" : "var(--err)" }}>{m.kind === "in" ? "+" : "−"} {eur(m.amount)}</span>
                        </>
                      )}
                      <div className="-my-1.5 flex items-center justify-end self-stretch border-l border-line pl-2">
                      {included
                        ? <span className="justify-self-end px-2 text-right text-[11px] italic text-faint" title={t("Questo movimento è del giorno in cui hai impostato il saldo: è già compreso nell'importo che hai scritto.")}>{t("già nel saldo")}</span>
                        : <span className={"justify-self-end rounded-md px-2 py-0.5 text-right font-mono text-sm font-semibold tabular-nums " + (bal === null ? "text-faint" : bal < 0 ? "text-[color:var(--err)]" : "text-txt")} style={bal !== null && bal < 0 ? { backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)" } : undefined} title={bal === null ? t("Imposta il saldo di partenza per vedere il saldo") : m.forecast ? t("Saldo previsto") : t("Saldo dopo questo movimento")}>{bal === null ? "—" : eur(bal)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
              </div>
            )}
          </Card>
        <div className="grid items-start gap-4 lg:grid-cols-3">

          {/* Pagamenti programmati */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle>{t("Pagamenti programmati")}</SectionTitle>
              <button onClick={openNewRule} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-focus hover:bg-wash">＋ {t("Aggiungi")}</button>
            </div>
            {rules.filter((r) => ruleVisible(r.structureId)).length === 0 ? (
              <p className="text-sm text-faint">{t("Nessun pagamento ricorrente. Aggiungi mutuo, bollette, abbonamenti… si registrano da soli ogni mese.")}</p>
            ) : (
              <>
                <div className="flex flex-col divide-y divide-[color:var(--line)]">
                  {rules.filter((r) => ruleVisible(r.structureId)).map((r) => {
                    const c = catOf(r.cat);
                    const next = upcoming.find((u) => u.rule.id === r.id)?.date;
                    return (
                      <div key={r.id} className="flex items-center gap-3 py-2.5">
                        <button type="button" onClick={() => openEditRule(r)} title={t("Modifica")} className="flex min-w-0 flex-1 items-center gap-3 rounded text-left hover:bg-wash">
                        {iconCircle(c, 32)}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-txt">{r.desc}</span>
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={r.auto ? { backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" } : { backgroundColor: "var(--wash)", color: "var(--dim)" }}>{r.variable ? t("variabile") : r.auto ? t("auto") : t("manuale")}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-faint">{t(FREQ[r.freq])}{r.freq === "monthly" ? ` · ${t("il")} ${r.day}` : ""}{r.end ? ` · ${t("fino al")} ${new Date(r.end).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}` : ""}{next ? ` · ${t("prossima")} ${new Date(next).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}` : ""}</div>
                        </div>
                        <span className="shrink-0 font-mono text-sm font-semibold" style={{ color: r.kind === "in" ? "var(--ok)" : "var(--err)" }}>{r.variable ? "~ " : ""}{r.kind === "in" ? "+" : "−"} {eur(r.amount)}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
                {monthlyRecurring !== 0 && <div className="mt-3 flex justify-between border-t border-line pt-2 text-xs"><span className="text-dim">{t("Impegno mensile ricorrente")}</span><span className="font-mono font-semibold text-[color:var(--err)]">− {eur(monthlyRecurring)}</span></div>}
              </>
            )}
          </Card>

          {/* Scadenze da registrare (SCADUTA) */}
          {pending.length > 0 && (
            <Card className="border-[color:var(--warn)]">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>{t("Scadenze da registrare")}</SectionTitle>
                {pending.some((p) => !p.rule.variable) && <button onClick={markAllPaid} className="rounded-md px-2 py-1 text-xs font-semibold text-white" style={{ backgroundColor: "var(--ok)" }}>{t("Segna tutte pagate")}</button>}
              </div>
              <div className="flex flex-col divide-y divide-[color:var(--line)]">
                {pending.map(({ rule, iso }) => {
                  const c = catOf(rule.cat);
                  return (
                    <div key={`${rule.id}-${iso}`} className="flex items-center gap-3 py-2.5">
                      {iconCircle(c, 32)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-txt">{rule.desc}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                          <span className="rounded px-1.5 py-0.5 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 18%, transparent)", color: "var(--warn)" }}>{t("SCADUTA")}</span>
                          <span className="text-faint">{new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}</span>
                        </div>
                      </div>
                      {rule.variable ? (
                        <>
                          <input inputMode="decimal" aria-label={t("Importo reale")} title={t("Importo reale (la stima è precompilata)")} value={pendAmt[`${rule.id}|${iso}`] ?? String(rule.amount).replace(".", ",")} onChange={(e) => setPendAmt((p) => ({ ...p, [`${rule.id}|${iso}`]: e.target.value }))} className="w-24 shrink-0 rounded-lg border border-line bg-paper px-2 py-1 text-right font-mono text-sm text-txt outline-none focus:border-focus" />
                          <button onClick={() => confirmVariable(rule, iso)} className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "var(--ok)" }}>{t("Registra")}</button>
                        </>
                      ) : (
                        <>
                          <span className="shrink-0 font-mono text-sm font-semibold" style={{ color: rule.kind === "in" ? "var(--ok)" : "var(--err)" }}>{rule.kind === "in" ? "+" : "−"} {eur(rule.amount)}</span>
                          <button onClick={() => markPaid(rule, iso)} className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "var(--ok)" }}>{t("Segna pagata")}</button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Uscite per categoria */}
        </div>
      </div>

      <p className="mt-4 text-xs text-faint">{t("Le entrate")} <b className="text-dim">{t("Prenotazioni")}</b> {t("e le")} <b className="text-dim">{t("Commissioni OTA")}</b> {t("sono automatiche (badge «auto»). I")} <b className="text-dim">{t("Pagamenti programmati")}</b> {t("si registrano da soli ogni mese (badge «programmato»). Aggiungi manualmente le altre voci e crea le categorie che ti servono.")}</p>

      {/* --- Modale saldo di partenza --- */}
      {opening && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
          <button aria-label={t("Chiudi")} onClick={() => setOpening(null)} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <div role="dialog" aria-label={t("Saldo di partenza")} className="relative max-h-[84vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="text-base font-bold text-txt">{t("Saldo di partenza")}</div>
            <p className="mt-1 text-xs text-dim">{t("Scrivi quanto hai oggi su ogni conto. Da qui ogni saldo parte dal suo importo e si aggiorna con le entrate e le uscite dei giorni successivi: lo storico passato non serve. I conti lasciati vuoti non vengono toccati.")}</p>
            <p className="mt-1 text-[11px] text-faint">{t("★ = conto principale: qui arrivano i soldi delle prenotazioni dai portali. ↑ ↓ cambiano l'ordine dei conti.")}</p>
            <div className="mt-3 flex flex-col gap-2">
              {CONTI.map((c) => (
                <div key={c.key} className="flex items-center gap-1.5">
                  <button type="button" onClick={() => makePrincipal(c.key)} title={c.key === principal ? t("Conto principale: qui arrivano i soldi delle prenotazioni") : t("Imposta come conto principale (dove arrivano i soldi delle prenotazioni)")} aria-label={`${t("Conto principale")} ${c.label}`} className={`shrink-0 rounded p-0.5 text-sm leading-none ${c.key === principal ? "text-[color:var(--warn)]" : "text-faint hover:text-[color:var(--warn)]"}`}>{c.key === principal ? "★" : "☆"}</button>
                  {renaming?.key === c.key
                    ? <input autoFocus value={renaming.label} maxLength={30} onChange={(e) => setRenaming({ key: c.key, label: e.target.value })} onBlur={renameConto} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); renameConto(); } if (e.key === "Escape") setRenaming(null); }} className="w-32 shrink-0 rounded-lg border border-focus bg-paper px-2 py-1.5 text-sm text-txt outline-none" />
                    : <span className="w-32 shrink-0 truncate text-sm text-txt" title={t(c.label)}>{t(c.label)}</span>}
                  <input aria-label={`${t("Importo")} ${c.label}`} inputMode="decimal" value={opening.amounts[c.key] ?? ""} onChange={(e) => setOpening((o) => (o ? { ...o, amounts: { ...o.amounts, [c.key]: e.target.value } } : o))} placeholder="—" className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-right font-mono text-sm text-txt outline-none focus:border-focus" />
                  <span className="text-xs text-faint">€</span>
                  <button type="button" onClick={() => moveConto(c.key, -1)} disabled={conti[0]?.key === c.key} title={t("Sposta su")} aria-label={`${t("Sposta su")} ${c.label}`} className="shrink-0 rounded p-0.5 text-faint hover:bg-wash hover:text-txt disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => moveConto(c.key, 1)} disabled={conti[conti.length - 1]?.key === c.key} title={t("Sposta giù")} aria-label={`${t("Sposta giù")} ${c.label}`} className="shrink-0 rounded p-0.5 text-faint hover:bg-wash hover:text-txt disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => setRenaming({ key: c.key, label: c.label })} title={t("Rinomina il conto")} aria-label={`${t("Rinomina")} ${c.label}`} className="shrink-0 rounded p-1 text-faint hover:bg-wash hover:text-txt">✎</button>
                  <button type="button" onClick={() => void deleteConto(c)} title={t("Elimina il conto")} aria-label={`${t("Elimina")} ${c.label}`} className="shrink-0 rounded p-1 text-faint hover:bg-wash hover:text-[color:var(--err)]">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <input value={opening.newName} onChange={(e) => setOpening((o) => (o ? { ...o, newName: e.target.value } : o))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addConto(); } }} placeholder={t("Nuovo conto (es. Revolut, Intesa…)")} maxLength={30} className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
              <button onClick={addConto} disabled={!opening.newName.trim()} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50">{t("+ Aggiungi conto")}</button>
            </div>
            <label className="mt-3 block"><span className="text-xs text-dim">{t("Valido dal giorno")}</span>
              <input type="date" value={opening.date} onChange={(e) => setOpening((o) => (o ? { ...o, date: e.target.value } : o))} className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
            </label>
            <label className="mt-2 flex items-start gap-2 text-xs text-dim">
              <input type="checkbox" checked={opening.startOfDay} onChange={(e) => setOpening((o) => (o ? { ...o, startOfDay: e.target.checked } : o))} className="mt-0.5 h-4 w-4 accent-[color:var(--focus)]" />
              <span>{t("Il saldo è di inizio giornata: somma anche i movimenti di questo giorno (altrimenti sono già compresi nell'importo).")}</span>
            </label>
            <p className="mt-2 text-[11px] text-faint">{t("Le prenotazioni entrano nel saldo alla data di arrivo.")}</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="text-xs text-dim">{t("Totale")}: <b className="font-mono text-sm text-txt">{eur(openingTotal)}</b></div>
              <div className="flex gap-2">
                <button onClick={() => setOpening(null)} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash">{t("Annulla")}</button>
                <button onClick={saveOpening} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">{t("Imposta i saldi")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Modale selezione / gestione categorie --- */}
      {/* --- Modale impostazioni incassi --- */}
      {payoutModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[6vh]">
          <button aria-label={t("Chiudi")} onClick={() => setPayoutModal(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{t("Impostazioni incassi")}</h2><button onClick={() => setPayoutModal(false)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <p className="mb-3 text-xs text-dim">{t("Indica quando ogni portale ti paga. Cassa registra l'incasso nella data in cui i soldi arrivano sul conto e, per i bonifici, riunisce in una voce le prenotazioni dello stesso pagamento. Le impostazioni valgono per tutte le strutture.")}</p>
            <div className="flex flex-col gap-2">
              {PAYOUT_CHANNELS.map((ch) => {
                const rule = payouts[ch] ?? { mode: "arrival" as PayoutMode };
                const sel = "mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus";
                const wd = rule.weekday ?? 4, md = rule.monthDay ?? 1, dd = rule.days ?? 0;
                return (
                  <div key={ch} className="rounded-xl border border-line p-3">
                    <div className="mb-2 flex items-center gap-2"><ChannelLogo channel={ch} size={22} title={CHANNELS[ch].label} /><span className="text-sm font-semibold text-txt">{CHANNELS[ch].label}</span></div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block"><span className="text-xs text-dim">{t("Quando arriva il pagamento")}</span>
                        <select value={rule.mode} onChange={(e) => setPayoutRule(ch, { mode: e.target.value })} className={sel}>
                          <option value="arrival">{t("Alla data di arrivo")}</option>
                          <option value="checkout">{t("Dopo il check-out (carta virtuale)")}</option>
                          <option value="weekly">{t("Bonifico settimanale")}</option>
                          <option value="monthly">{t("Bonifico mensile")}</option>
                        </select>
                      </label>
                      {rule.mode === "checkout" && <label className="block"><span className="text-xs text-dim">{t("Giorni dopo il check-out")}</span><input type="number" min={0} max={60} value={dd} onChange={(e) => setPayoutRule(ch, { days: Number(e.target.value) || 0 })} className={sel} /></label>}
                      {rule.mode === "weekly" && <label className="block"><span className="text-xs text-dim">{t("Giorno del bonifico")}</span><select value={wd} onChange={(e) => setPayoutRule(ch, { weekday: Number(e.target.value) })} className={sel}>{WEEKDAY_LABELS.map((w, i) => <option key={w} value={i}>{t(w)}</option>)}</select></label>}
                      {rule.mode === "monthly" && <label className="block"><span className="text-xs text-dim">{t("Giorno del mese successivo")}</span><input type="number" min={1} max={31} value={md} onChange={(e) => setPayoutRule(ch, { monthDay: Number(e.target.value) || 1 })} className={sel} /></label>}
                    </div>
                    <p className="mt-1.5 text-[11px] text-faint">
                      {rule.mode === "arrival" && t("I soldi risultano incassati il giorno dell'arrivo.")}
                      {rule.mode === "checkout" && (dd ? `${t("Incasso")} ${dd} ${t("giorni dopo il check-out dell'ospite (es. carta virtuale).")}` : t("Incasso il giorno del check-out (es. carta virtuale)."))}
                      {rule.mode === "weekly" && `${t("Un unico bonifico ogni")} ${t(WEEKDAY_LABELS[wd]).toLowerCase()}: ${t("copre i check-out dal")} ${t(WEEKDAY_LABELS[wd]).toLowerCase()} ${t("della settimana prima al giorno precedente.")}`}
                      {rule.mode === "monthly" && `${t("Un unico bonifico il")} ${md} ${t("del mese successivo: copre tutti i check-out del mese, dal 1 all'ultimo giorno.")}`}
                    </p>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setPayoutModal(false)} className="mt-3 w-full rounded-lg bg-focus py-2 text-sm font-semibold text-white hover:opacity-90">{t("Fatto")}</button>
          </div>
        </div>
      )}

      {/* --- Modale modifica movimento --- */}
      {editingMov && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[6vh]">
          <button aria-label={t("Chiudi")} onClick={resetForm} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{editingMov === NEW_MOV ? t("Nuovo movimento") : t("Modifica movimento")}</h2><button onClick={resetForm} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button onClick={() => setKind("out")} className={`rounded-lg border py-2 text-sm font-semibold transition ${form.kind === "out" ? "border-[color:var(--err)] text-[color:var(--err)]" : "border-line text-dim hover:bg-wash"}`}>− {t("Uscita")}</button>
              <button onClick={() => setKind("in")} className={`rounded-lg border py-2 text-sm font-semibold transition ${form.kind === "in" ? "border-[color:var(--ok)] text-[color:var(--ok)]" : "border-line text-dim hover:bg-wash"}`}>+ {t("Entrata")}</button>
            </div>
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Importo (€)")}</span><input inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0,00" className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-lg text-txt outline-none focus:border-focus" /></label>
            <div className="mb-2 block">
              <span className="text-xs text-dim">{t("Categoria")}</span>
              <button onClick={() => { setCatFor("form"); setCatPicker(true); }} className="mt-0.5 flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-2 py-1.5 text-left text-sm text-txt hover:bg-wash">
                {iconCircle(selCat, 28)}<span className="flex-1 font-medium">{selCat?.label ? t(selCat.label) : t("Scegli…")}</span><span className="text-faint">▾</span>
              </button>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-dim">{t("Conto")}</span><select value={form.conto} onChange={(e) => setForm((f) => ({ ...f, conto: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">{CONTI.map((c) => <option key={c.key} value={c.key}>{t(c.label)}</option>)}</select></label>
              <label className="block"><span className="text-xs text-dim">{t("Data")}</span><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            </div>
            {activeStructureId === "all" && <label className="mb-2 block"><span className="text-xs text-dim">{t("Struttura")}</span><select value={form.struttura} onChange={(e) => setForm((f) => ({ ...f, struttura: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
            <label className="mb-3 block"><span className="text-xs text-dim">{t("Descrizione (facoltativa)")}</span><input value={form.desc} onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))} placeholder={t("es. Bolletta Enel agosto")} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            {editingMov === NEW_MOV && (
            <div className="mb-3">
              <span className="text-xs text-dim">{t("Si ripete?")}</span>
              <div className="mt-1 grid grid-cols-4 gap-1.5">
                {([["once", "Solo una volta"], ["monthly", "Ogni mese"], ["weekly", "Ogni settimana"], ["yearly", "Ogni anno"]] as [typeof form.repeat, string][]).map(([v, lab]) => (
                  <button key={v} type="button" onClick={() => setForm((f) => ({ ...f, repeat: v }))} className={`rounded-lg border px-1 py-1.5 text-[11px] font-semibold transition ${form.repeat === v ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(lab)}</button>
                ))}
              </div>
              {form.repeat !== "once" && <p className="mt-1 text-[11px] text-faint">{t("Registro questo movimento oggi e creo un pagamento programmato che si ripete da solo.")}</p>}
            </div>
            )}
            <button onClick={add} className="w-full rounded-lg bg-focus py-2 text-sm font-semibold text-white hover:opacity-90">{editingMov === NEW_MOV ? (form.repeat === "once" ? t("Registra movimento") : t("Registra e programma")) : t("Salva modifiche")}</button>
            {editingMov !== NEW_MOV && <button onClick={() => { const id = editingMov; resetForm(); void del(id); }} className="mt-1.5 w-full rounded-lg border border-line py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina movimento")}</button>}
          </div>
        </div>
      )}
      {catPicker && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[8vh]">
          <button aria-label={t("Chiudi")} onClick={() => { setCatPicker(false); setNewCat(null); }} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{t("Categorie")} {(catFor === "rule" ? rf.kind : form.kind) === "in" ? t("entrata") : t("uscita")}</h2><button onClick={() => { setCatPicker(false); setNewCat(null); }} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="grid grid-cols-3 gap-2">
              {cats.filter((c) => c.kind === (catFor === "rule" ? rf.kind : form.kind) && !c.auto).map((c) => (
                <button key={c.key} onClick={() => { if (catFor === "rule") setRf((f) => ({ ...f, cat: c.key })); else setForm((f) => ({ ...f, cat: c.key })); setCatPicker(false); }} className={`group relative flex flex-col items-center gap-1.5 rounded-xl border p-3 transition hover:bg-wash ${(catFor === "rule" ? rf.cat : form.cat) === c.key ? "border-focus ring-1 ring-[color:var(--focus)]" : "border-line"}`}>
                  {iconCircle(c, 40)}
                  <span className="text-center text-[11px] font-medium leading-tight text-txt">{t(c.label)}</span>
                  {c.custom && <span onClick={(e) => { e.stopPropagation(); deleteCat(c.key); }} title={t("Elimina categoria")} className="absolute right-1 top-1 hidden h-5 w-5 place-items-center rounded-full bg-wash text-[10px] text-faint group-hover:grid hover:text-[color:var(--err)]">✕</span>}
                </button>
              ))}
              <button onClick={openNewCat} className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line p-3 text-dim transition hover:bg-wash hover:text-focus">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-wash text-xl">＋</span><span className="text-[11px] font-medium">{t("Nuova")}</span>
              </button>
            </div>

            {newCat && (
              <div className="mt-4 rounded-xl border border-line p-3">
                <div className="mb-2 text-sm font-semibold text-txt">{t("Nuova categoria")} {(catFor === "rule" ? rf.kind : form.kind) === "in" ? t("entrata") : t("uscita")}</div>
                <input autoFocus value={newCat.label} onChange={(e) => setNewCat({ ...newCat, label: e.target.value })} placeholder={t("Nome categoria")} className="mb-3 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
                <div className="mb-1 text-xs text-dim">{t("Colore")}</div>
                <div className="mb-3 flex flex-wrap gap-1.5">{PALETTE.map((col) => <button key={col} onClick={() => setNewCat({ ...newCat, color: col })} className={`h-6 w-6 rounded-full border-2 ${newCat.color === col ? "border-txt" : "border-transparent"}`} style={{ backgroundColor: col }} />)}</div>
                <div className="mb-1 text-xs text-dim">{t("Icona")}</div>
                <div className="mb-3 grid max-h-40 grid-cols-7 gap-1.5 overflow-y-auto">
                  {ICON_KEYS.map((ic) => <button key={ic} onClick={() => setNewCat({ ...newCat, icon: ic })} className={`grid aspect-square place-items-center rounded-lg border ${newCat.icon === ic ? "border-focus ring-1 ring-[color:var(--focus)]" : "border-line"}`} style={{ color: newCat.color }}><CatIcon name={ic} size={18} /></button>)}
                </div>
                <div className="flex gap-2"><button onClick={() => setNewCat(null)} className="flex-1 rounded-lg border border-line py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button><button onClick={createCat} disabled={!newCat.label.trim()} className="flex-1 rounded-lg bg-focus py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Crea categoria")}</button></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- Modale pagamento programmato --- */}
      {ruleModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
          <button aria-label={t("Chiudi")} onClick={closeRuleModal} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[84vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{editingRule ? t("Modifica pagamento programmato") : t("Nuovo pagamento programmato")}</h2><button onClick={closeRuleModal} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button onClick={() => setRf((f) => ({ ...f, kind: "out", cat: cats.find((c) => c.kind === "out" && !c.auto)!.key }))} className={`rounded-lg border py-2 text-sm font-semibold ${rf.kind === "out" ? "border-[color:var(--err)] text-[color:var(--err)]" : "border-line text-dim"}`}>− {t("Uscita")}</button>
              <button onClick={() => setRf((f) => ({ ...f, kind: "in", cat: cats.find((c) => c.kind === "in" && !c.auto)!.key }))} className={`rounded-lg border py-2 text-sm font-semibold ${rf.kind === "in" ? "border-[color:var(--ok)] text-[color:var(--ok)]" : "border-line text-dim"}`}>+ {t("Entrata")}</button>
            </div>
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Descrizione")}</span><input value={rf.desc} onChange={(e) => setRf((f) => ({ ...f, desc: e.target.value }))} placeholder={t("es. Rata mutuo · Bolletta telefono")} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-dim">{rf.variable ? t("Importo stimato (€)") : t("Importo (€)")}</span><input inputMode="decimal" value={rf.amount} onChange={(e) => setRf((f) => ({ ...f, amount: e.target.value }))} placeholder="0,00" className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-txt outline-none focus:border-focus" /></label>
              <label className="block"><span className="text-xs text-dim">{t("Categoria")}</span><button type="button" onClick={() => { setCatFor("rule"); setCatPicker(true); }} className="mt-0.5 flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-2 py-1.5 text-left text-sm text-txt hover:bg-wash">{iconCircle(catOf(rf.cat), 26)}<span className="min-w-0 flex-1 truncate font-medium">{catOf(rf.cat)?.label ? t(catOf(rf.cat)!.label) : t("Scegli…")}</span><span className="text-faint">▾</span></button></label>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-dim">{t("Frequenza")}</span><select value={rf.freq} onChange={(e) => setRf((f) => ({ ...f, freq: e.target.value as Rule["freq"] }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus"><option value="monthly">{t("Ogni mese")}</option><option value="weekly">{t("Ogni settimana")}</option><option value="yearly">{t("Ogni anno")}</option></select></label>
              {rf.freq === "monthly" ? (
                <label className="block"><span className="text-xs text-dim">{t("Giorno del mese")}</span><input type="number" min={1} max={31} value={rf.day} onChange={(e) => setRf((f) => ({ ...f, day: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
              ) : (
                <label className="block"><span className="text-xs text-dim">{t("Data inizio")}</span><input type="date" value={rf.start} onChange={(e) => setRf((f) => ({ ...f, start: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
              )}
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-dim">{t("Conto")}</span><select value={rf.conto} onChange={(e) => setRf((f) => ({ ...f, conto: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">{CONTI.map((c) => <option key={c.key} value={c.key}>{t(c.label)}</option>)}</select></label>
              {activeStructureId === "all" && <label className="block"><span className="text-xs text-dim">{t("Struttura")}</span><select value={rf.struttura} onChange={(e) => setRf((f) => ({ ...f, struttura: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">{activeStructureId === "all" && <option value="all">{t("Tutte")}</option>}{structures.filter((s) => activeStructureId === "all" || s.id === activeStructureId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
            </div>
            {rf.freq === "monthly" && <label className="mb-2 block"><span className="text-xs text-dim">{t("A partire da")}</span><input type="date" value={rf.start} onChange={(e) => setRf((f) => ({ ...f, start: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>}
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Termina ripetizione")}</span><input type="date" value={rf.end} onChange={(e) => setRf((f) => ({ ...f, end: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /><span className="mt-0.5 block text-[11px] text-faint">{t("Lascia vuoto per «Mai».")}</span></label>
            <label className="mb-3 block"><span className="text-xs text-dim">{t("Nota (facoltativa)")}</span><input value={rf.note ?? ""} onChange={(e) => setRf((f) => ({ ...f, note: e.target.value }))} placeholder={t("es. IBAN, numero pratica…")} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            <button type="button" onClick={() => setRf((f) => ({ ...f, variable: !f.variable, auto: f.variable ? f.auto : false }))} className="mb-2 flex w-full items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left hover:bg-wash">
              <span><span className="text-sm font-medium text-txt">{t("Importo variabile")}</span><span className="mt-0.5 block text-[11px] text-faint">{rf.variable ? t("L'importo qui sopra è una stima per la previsione. Alla scadenza ti chiedo quanto hai speso davvero.") : t("Per spese che cambiano ogni mese: pulizie, biancheria, colazioni…")}</span></span>
              <span className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: rf.variable ? "var(--ok)" : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: rf.variable ? "22px" : "2px" }} /></span>
            </button>
            {!rf.variable && (
            <button type="button" onClick={() => setRf((f) => ({ ...f, auto: !f.auto }))} className="mb-3 flex w-full items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left hover:bg-wash">
              <span><span className="text-sm font-medium text-txt">{t("Registrazione automatica")}</span><span className="mt-0.5 block text-[11px] text-faint">{rf.auto ? t("Alla scadenza il movimento si registra da solo.") : t("Alla scadenza dovrai confermarlo con «Segna come pagata».")}</span></span>
              <span className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: rf.auto ? "var(--ok)" : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: rf.auto ? "22px" : "2px" }} /></span>
            </button>
            )}
            <button onClick={addRule} className="w-full rounded-lg bg-focus py-2 text-sm font-semibold text-white hover:opacity-90">{editingRule ? t("Salva modifiche") : t("Salva pagamento programmato")}</button>
            {editingRule && <button onClick={async () => { const id = editingRule; closeRuleModal(); await delRule(id); }} className="mt-1.5 w-full rounded-lg border border-line py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina pagamento")}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
