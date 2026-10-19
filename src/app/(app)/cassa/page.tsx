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
import { type Kind, type Mov, type Rule, computeAuto, computeScheduled, occurrences, scopeVisible, loadCash, cashOrgOf, insertMovement, updateMovement, deleteMovement, insertRule, updateRule, deleteRule, addPaid, migrateLocalCash, groupBookingRows, groupOpeningRows, computeBalances, OPENING_CAT, compactEuro, niceAxis, DEFAULT_CONTI, loadConti, saveConti, contoKeyFromLabel, type ContoDef, canDeleteConto, computeForecast, presetRange, matchesQuery, type Preset, loadContiPrefs, saveContiPrefs, moveWithin, contiOfStructure, contiKeysInScope, contoUnassigned, contoDisplayLabel, contoVisible, isContoAssigned, routeFor, principalOf, moveContoOfStructure, openingsReplacedBy, countOnConto, updateContoOfMovements, updateContoOfRules, type ContiPrefs, type ContiRouter, computeLedger, loadOverrides, saveOverrides, applyOverrides, occurrenceKey, type OccOverrides, monthlyCommissionInfo, REST_IN_PREFIX, type CashScope, cashScopeOf, scopeIds, movSid, balanceParts, balanceTotalsBySid, openingOf, signedAmount, normSid, nextRecurrenceStart } from "@/lib/cassa";
import SearchInput from "@/components/SearchInput";
import DateField from "@/components/DateField";
import { shiftISO } from "@/lib/dates";
import { fmtDMY, fmtDate, fmtDM } from "@/lib/dates";
import ChannelLogo from "@/components/ChannelLogo";
import BookingChannelLogo from "@/components/BookingChannelLogo";
import { CHANNELS, type Channel } from "@/lib/types";
import { type PayoutMode, type PayoutSettingsMap, PAYOUT_CHANNELS, WEEKDAY_LABELS, DEFAULT_PAYOUTS_ID, COMMISSION_DEFAULT_DAY, COMMISSION_MAX_DAY, cleanRule, isGroupedPayout, loadPayoutSettings, payoutSettingsFor, savePayoutSettings } from "@/lib/payouts";
import { formatDecimalIT, parseDecimalIT } from "@/lib/num-it";
import { commissionShareOf, commissionOf, lordoOf } from "@/lib/booking";
import { useTenantId } from "@/lib/tenant";
import { useSyncedList } from "@/components/pulizie/useSyncedList";
import { KEY_ORDERS, type PulizieOrder } from "@/lib/pulizie-addetta";
import { receiptsByMovement } from "@/lib/pulizie-purchase";
import { openReceipt } from "@/lib/pulizie-purchase-client";

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
  const { bookings, guests, structures, getStructure, allStructures, selectedStructureIds, raw } = useData();
  // AMBITO della Cassa: le strutture selezionate in alto a destra (una, più d'una, o tutte). Ogni struttura ha i propri registri, saldi, entrate e uscite; con più strutture si sommano.
  const scope = useMemo<CashScope>(() => cashScopeOf(selectedStructureIds, allStructures.map((x) => x.id)), [selectedStructureIds, allStructures]);
  const scopeKey = typeof scope === "string" ? scope : scope.join(",");
  const singleSid = typeof scope === "string" && scope !== "all" ? scope : ""; // struttura di destinazione predefinita: solo se ne è selezionata UNA
  const multiScope = !singleSid; // più strutture (o tutte): nel registro serve il nome della struttura
  const scopeStructs = useMemo(() => { const ids = scopeIds(scope, allStructures.map((x) => x.id)); return allStructures.filter((x) => ids.includes(x.id)); }, [scope, allStructures]);
  const ask = useConfirm();
  const toast = useToast();
  const { t } = useLang();
  const { user } = useAuth();
  const orgForStruct = (sid?: string) => cashOrgOf(allStructures.find((s) => s.id === sid)?.orgId); // org della cassa condivisa (soci) della struttura, se c'è
  const tenantId = useTenantId(); // account di lavoro: per un collaboratore è quello di chi lo ha invitato
  // Senza l'account di lavoro (collaboratore, risposta del server in arrivo) non si scrive: il dato finirebbe sull'account sbagliato o andrebbe perso in silenzio.
  const needTenant = (): string | null => { if (tenantId) return tenantId; toast(t("Account di lavoro non ancora caricato: riprova tra qualche secondo."), "error"); return null; };
  // Importo scritto a mano (formato italiano) → euro al centesimo, oppure null (con avviso a video) se vuoto, non valido o non positivo.
  const readAmount = (txt: string): number | null => {
    if (!txt.trim()) { toast(t("Inserisci un importo maggiore di zero."), "error"); return null; }
    const n = parseDecimalIT(txt);
    if (n === null) { toast(t("Importo non valido: scrivi un numero, per esempio 1234,56."), "error"); return null; }
    const a = roundCents(n);
    if (a <= 0) { toast(t("Inserisci un importo maggiore di zero."), "error"); return null; }
    return a;
  };
  // Acquisti di materiale (modulo Pulizie): il movimento ha lo stesso id dell'acquisto, quindi da qui si risale allo scontrino allegato.
  const [pOrders] = useSyncedList<PulizieOrder>(KEY_ORDERS);
  const receiptOf = useMemo(() => receiptsByMovement(pOrders), [pOrders]);
  const openRcpt = async (path: string) => { const e = await openReceipt(path); if (e) toast(e, "error"); };

  // Categorie (default + personalizzate).
  const [cats, setCats] = useState<Cat[]>(DEFAULT_CATS);
  const [conti, setConti] = useState<ContoDef[]>(() => (typeof window === "undefined" ? [...DEFAULT_CONTI] : loadConti())); // conti di base + quelli aggiunti (più banche…)
  const CONTI = conti;
  // Impostazioni incassi per canale: quando i soldi arrivano davvero sul conto (arrivo, check-out, bonifico settimanale o mensile).
  const [payouts, setPayouts] = useState<PayoutSettingsMap>(() => (typeof window === "undefined" ? {} : loadPayoutSettings()));
  // Le impostazioni incassi arrivano anche dal server (sincronizzazione): quando il browser le riceve si rileggono, senza dover ricaricare la pagina.
  useEffect(() => {
    const h = () => { try { setPayouts(loadPayoutSettings()); setConti(loadConti()); setPrefsState(loadContiPrefs()); } catch { /* storage non disponibile */ } }; // anche conti e conti principali per struttura (li vedono i collaboratori)
    window.addEventListener("spigolestay:datasync", h);
    return () => window.removeEventListener("spigolestay:datasync", h);
  }, []);
  const [payoutModal, setPayoutModal] = useState(false);
  const [overrides, setOverrides] = useState<OccOverrides>(() => (typeof window === "undefined" ? {} : loadOverrides())); // righe modificate per singola scadenza
  const [occCtx, setOccCtx] = useState<{ key: string; ruleId: string; orig: { amount: number; date: string; desc: string; cat: string; conto: string } } | null>(null);
  const [openPayouts, setOpenPayouts] = useState<Set<string>>(() => new Set()); // bonifici aperti nell'elenco
  // Le impostazioni incassi sono PER STRUTTURA: nella finestra si sceglie la struttura (di partenza la attiva, se è una sola; altrimenti la prima).
  const [payoutStruct, setPayoutStruct] = useState("");
  const payoutSid = scopeStructs.some((x) => x.id === payoutStruct) ? payoutStruct : (scopeStructs[0]?.id ?? structures[0]?.id ?? "");
  const payoutKey = payoutSid || DEFAULT_PAYOUTS_ID;
  const payoutsOfModal = payoutSettingsFor(payouts, payoutSid);
  const openPayoutModal = () => { setPayoutStruct(""); setPayoutModal(true); };
  const commitPayouts = (next: PayoutSettingsMap) => { setPayouts(next); savePayoutSettings(next); };
  // Al primo cambio una struttura che eredita le predefinite ne crea la copia propria.
  const setPayoutRule = (ch: Channel, patch: Record<string, unknown>) => { const base = payoutSettingsFor(payouts, payoutSid); commitPayouts({ ...payouts, [payoutKey]: { ...base, [ch]: cleanRule({ ...(base[ch] ?? { mode: "arrival" }), ...patch }) } }); };
  const copyPayoutsToAll = async () => {
    if (!(await ask({ title: t("Copia su tutte le strutture"), message: `${t("Le impostazioni di")} «${getStructure(payoutSid)?.name ?? ""}» ${t("sostituiranno quelle di tutte le altre strutture.")}`, confirmLabel: t("Copia") }))) return;
    const cur = payoutSettingsFor(payouts, payoutSid);
    const next: PayoutSettingsMap = { ...payouts, [DEFAULT_PAYOUTS_ID]: { ...cur } };
    for (const x of structures) next[x.id] = { ...cur };
    commitPayouts(next); toast(t("Impostazioni copiate su tutte le strutture"), "success");
  };
  // Il bonifico unico riunisce solo prenotazioni della stessa struttura: quali canali raggruppare dipende dalla struttura della riga.
  const groupPayout = useMemo(() => (channel: string, structureId: string | undefined) => isGroupedPayout(payouts, channel, structureId), [payouts]);
  const [prefs, setPrefsState] = useState<ContiPrefs>(() => (typeof window === "undefined" ? { order: [], principal: "banca" } : loadContiPrefs())); // conto principale PER STRUTTURA (dove arrivano i soldi delle prenotazioni OTA)
  const router = useMemo<ContiRouter>(() => (sid) => routeFor(conti, prefs, sid), [conti, prefs]); // conti della struttura che incassa: principale, contanti, carta
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
    if (!user || !tenantId) return; // un collaboratore aspetta di conoscere l'account di lavoro
    (async () => {
      await migrateLocalCash(tenantId); // una-tantum: sale i vecchi dati locali sul server
      const c = await loadCash();
      setManual(c.movements); setRules(c.rules); setPaid(c.paid);
    })();
  }, [user, tenantId]);

  const today = todayISO();

  // Movimenti automatici dalle prenotazioni + occorrenze programmate (logica condivisa con la Chiusura cassa).
  const auto = useMemo<Mov[]>(() => computeAuto(raw.bookings, guests, getStructure, scope, router, payouts), [raw.bookings, guests, scopeKey, getStructure, router, payouts]); // eslint-disable-line react-hooks/exhaustive-deps
  const ruleVisible = (structureId?: string) => scopeVisible(structureId, scope);
  const scheduled = useMemo<Mov[]>(() => applyOverrides(computeScheduled(rules, paidSet, scope, today), overrides), [rules, scopeKey, today, paidSet, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [rules, scopeKey, today, paidSet]);
  const dropPaid = (keys: string[]) => setPaid((p) => p.filter((x) => !keys.includes(x)));
  const markPaid = (r: Rule, iso: string) => { const tid = needTenant(); if (!tid) return; const k = `${r.id}|${iso}`; setPaid((p) => [...p, k]); if (user) checkWrite(addPaid(tid, [k], () => orgForStruct(r.structureId)), "Il pagamento", () => dropPaid([k])); };
  const [pendAmt, setPendAmt] = useState<Record<string, string>>({}); // importo reale digitato per le scadenze a importo variabile
  const confirmVariable = (r: Rule, iso: string) => {
    const key = `${r.id}|${iso}`;
    const tid = needTenant(); if (!tid) return;
    const txt = pendAmt[key] ?? String(r.amount);
    const parsed = txt.trim() ? parseDecimalIT(txt) : 0;
    if (parsed === null) { toast(t("Importo non valido: scrivi un numero, per esempio 1234,56."), "error"); return; }
    const amt = roundCents(parsed);
    if (amt <= 0) { toast(t("Inserisci l'importo reale."), "error"); return; }
    const mov: Mov = { id: uid(), date: iso, kind: r.kind, cat: r.cat, desc: r.desc, amount: amt, conto: r.conto, structureId: r.structureId };
    setManual((prev) => [mov, ...prev]);
    checkWrite(insertMovement(tid, mov, orgForStruct(mov.structureId)), "Il movimento", () => setManual((prev) => prev.filter((m) => m.id !== mov.id)));
    markPaid(r, iso);
    toast(`${t("Registrato")} · ${r.desc} · ${eur(amt)}`, "success");
  };
  const markAllPaid = () => { const tid = needTenant(); if (!tid) return; const keys = pending.filter((p) => !p.rule.variable).map((p) => `${p.rule.id}|${p.iso}`); setPaid((p) => [...p, ...keys]); if (user) checkWrite(addPaid(tid, keys, (key) => orgForStruct(rules.find((r) => key.startsWith(r.id + "|"))?.structureId)), "I pagamenti", () => dropPaid(keys)); };

  // Prossime scadenze (dopo oggi).
  const upcoming = useMemo(() => {
    const horizon = fmt(new Date().getFullYear() + 1, new Date().getMonth(), 28);
    const from = fmt(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1);
    const list: { rule: Rule; date: string }[] = [];
    for (const r of rules) { if (!ruleVisible(r.structureId)) continue; for (const iso of occurrences(r, from, horizon)) list.push({ rule: r, date: iso }); }
    return list.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, scopeKey]);

  const visibleManual = useMemo(() => manual.filter((m) => ruleVisible(m.structureId)), [manual, scopeKey]);
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
    if (tipo === "booking") return /^(auto-in|auto-comm|auto-commm|fc-in)-/.test(m.id);
    if (tipo === "sched") return !!m.sched;
    return !m.auto && !m.sched && !m.forecast; // inseriti a mano
  };
  const [preset, setPreset] = useState<Preset>("future");
  const [from, setFrom] = useState<string>(() => todayISO());
  const [to, setTo] = useState<string>("");
  const applyPreset = (p: Preset) => { setPreset(p); if (p !== "custom") { const r = presetRange(p, today); setFrom(r.from); setTo(r.to); } };
  const futureView = !!from && from >= today;       // si guarda da oggi in avanti: previsione
  // Periodo «Personalizzato» con il solo «Dal» (senza «Al»): si legge IN ORDINE, dalla data scelta in avanti (prima il più vicino al «Dal»), non dal futuro più lontano a ritroso.
  const openFrom = preset === "custom" && !!from && !to && !futureView;
  const ascending = futureView || openFrom;
  const inPeriod = (iso: string) => (!from || iso >= from) && (!to || iso <= to);
  const periodWord = futureView ? t("previste") : preset === "all" ? t("totali") : t("del periodo");
  // Previsione a 6 mesi: dal mese in corso fino a fine del sesto mese (es. oggi 14.10 → 31.03).
  const fcEnd = useMemo(() => { const [y, m] = today.split("-").map(Number); const d = new Date(y, m - 1 + 6, 0); return fmt(d.getFullYear(), d.getMonth(), d.getDate()); }, [today]);
  const listHorizon = to || fcEnd;                   // senza "Al" la lista prevede i prossimi 6 mesi
  const [chartsOn, setChartsOn] = useState(true);
  const toggleCharts = () => setChartsOn((v) => !v); // aperti a ogni apertura della pagina; nasconderli vale solo per questa visita

  const forecastChart = useMemo<Mov[]>(() => applyOverrides(computeForecast(raw.bookings, guests, getStructure, rules, scope, today, fcEnd, router, payouts), overrides), [raw.bookings, guests, getStructure, rules, scopeKey, today, fcEnd, router, payouts, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const forecastView = useMemo(() => forecastChart.filter((x) => x.date <= listHorizon), [forecastChart, listHorizon]);
  const rows = [...all, ...forecastView]
    .filter((m) => inPeriod(m.date) && matchesTipo(m) && (!catF || m.cat === catF) && matchesQuery(m, q, { cat: catOf(m.cat)?.label, conto: CONTI.find((c) => c.key === m.conto)?.label }))
    .sort((a, b) => (ascending ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))); // da oggi o dal «Dal» scelto: dal più vicino; storico: dal più recente
  const catsInRegister = new Set([...all, ...forecastView].map((m) => m.cat)); // categorie presenti nel registro (filtro Categoria: solo quelle attive)
  const rowsStat = rows.filter((m) => m.cat !== OPENING_CAT); // il saldo di partenza non è un incasso né una spesa del periodo
  const entrate = sumCents(rowsStat.filter((m) => m.kind === "in").map((m) => m.amount));
  const uscite = sumCents(rowsStat.filter((m) => m.kind === "out").map((m) => m.amount));
  const saldo = roundCents(entrate - uscite);

  // SALDI PER STRUTTURA: ogni struttura ha il proprio saldo di partenza su ogni conto e conta solo i propri movimenti; il saldo dell'ambito è la somma (con "Tutte" valgono anche i vecchi saldi comuni).
  const balMovs = useMemo<Mov[]>(() => [...auto, ...scheduled, ...visibleManual], [auto, scheduled, visibleManual]);
  // conti dell'ambito (più quelli non assegnati su cui ci sono movimenti dell'ambito: non spariscono dal saldo)
  const contiKeys = useMemo(() => contiKeysInScope(conti, balMovs, scope), [conti, balMovs, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const balances = useMemo(() => computeBalances(balMovs, today, contiKeys, scope), [balMovs, today, contiKeys, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const balParts = useMemo(() => balanceParts(balMovs, today, contiKeys, scope), [balMovs, today, contiKeys, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const saldoPerStruttura = useMemo(() => balanceTotalsBySid(balParts).map((x) => ({ ...x, name: x.sid ? (getStructure(x.sid)?.name ?? "—") : t("Comuni (vecchio saldo)") })), [balParts, getStructure, t]);
  const saldoConti: Record<string, number> = Object.fromEntries(contiKeys.filter((k) => balances[k]?.since).map((k) => [k, balances[k].saldo])); // solo i conti con saldo di partenza: gli altri non hanno uno storico completo
  const saldoTot = sumCents(Object.values(saldoConti));

  const hasOpening = contiKeys.some((k) => balances[k]?.since);
  // Ultima card in vista "oggi e future": saldo previsto = saldo attuale dei conti + entrate − uscite dei giorni dopo oggi (quelli di oggi sono già nel saldo attuale).
  const prevCard = futureView && hasOpening;
  // Con il saldo attuale come base, le card contano solo i movimenti dopo oggi (quelli di oggi e prima sono già nel saldo attuale): così saldo attuale + entrate − uscite = saldo previsto.
  const cardRows = (prevCard ? rowsStat.filter((m) => m.date > today) : rowsStat).filter((m) => !futureView || m.date <= listHorizon); // l'etichetta «al {listHorizon}» deve valere anche per i movimenti manuali/auto oltre l'orizzonte
  const entrateCard = sumCents(cardRows.filter((m) => m.kind === "in").map((m) => m.amount));
  const usciteCard = sumCents(cardRows.filter((m) => m.kind === "out").map((m) => m.amount));
  const saldoPrevistoCalc = roundCents(saldoTot + entrateCard - usciteCard);
  // Estratto conto: saldo dopo ogni movimento, solo per le strutture selezionate in alto a destra (somma dei saldi di ciascuna, dalla propria data di partenza).
  const ledger = useMemo(() => computeLedger([...auto, ...scheduled, ...visibleManual, ...forecastView], scope), [auto, scheduled, visibleManual, forecastView, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ledgerOrd = (x: Mov) => ledger.order.get(x.id) ?? 0;
  // La card del saldo previsto deve dare ESATTAMENTE il saldo dell'ultima riga dell'estratto conto entro l'orizzonte: si legge dall'estratto conto stesso (stesse regole di saldo di partenza,
  // movimenti del giorno del saldo già compresi, previsti), invece di rifare il calcolo con regole leggermente diverse.
  const saldoPrevisto = (() => {
    if (!prevCard) return saldoPrevistoCalc;
    let lastId: string | undefined; let best = -1;
    for (const m of [...auto, ...scheduled, ...visibleManual, ...forecastView]) { if (m.date > listHorizon) continue; const o = ledger.order.get(m.id); if (o !== undefined && o > best) { best = o; lastId = m.id; } }
    const v = lastId ? ledger.balanceAfter.get(lastId) : null;
    return v == null ? saldoPrevistoCalc : v;
  })();
  const bkOf = (x: Mov) => (x.ref && /^(auto-in|auto-comm|fc-in)-/.test(x.id) ? raw.bookings.find((b) => b.id === x.ref) : undefined); // prenotazione da cui nasce il movimento
  // Commissioni trattenute dal portale TUTTE INSIEME (modalità mensile): sulla riga dell'incasso restano solo come nota informativa, il movimento vero è l'aggregato mensile.
  const infoOf = (x: Mov) => { const b = x.ref && /^(auto-in|fc-in)-/.test(x.id) && !x.id.startsWith(REST_IN_PREFIX) ? raw.bookings.find((y) => y.id === x.ref) : undefined; return b ? monthlyCommissionInfo(b, payouts) : undefined; };
  const infoText = (i: { amount: number; pct: number; date: string }) => `${t("commissione")} − ${eur(i.amount)} (${String(i.pct).replace(".", ",")}%) · ${t("trattenuta il")} ${fmtDMY(i.date)}`;
  const rowsOrdered = [...rows].sort((a, b) => { const d = a.date < b.date ? -1 : a.date > b.date ? 1 : ledgerOrd(a) - ledgerOrd(b); return ascending ? d : -d; });
  // I saldi di partenza non sono righe del registro: contano nel saldo e si vedono nel dettaglio della riga «Oggi» (si modificano dalla card «Saldo attuale»).
  const listRows = groupOpeningRows(groupBookingRows(rowsOrdered, groupPayout)).filter((r) => r.type !== "opening" && !(r.type === "mov" && r.mov.cat === OPENING_CAT));
  // cella "saldo conti" (riusata dalle voci bonifico)
  const balCell = (bal: number | null, inc: boolean) => (
    <div className="-my-1.5 flex items-center justify-end self-stretch border-l border-line pl-2">
      {inc
        ? <span className="justify-self-end px-2 text-right text-[11px] italic text-faint" title={t("Questo movimento è del giorno in cui hai impostato il saldo: è già compreso nell'importo che hai scritto.")}>{t("già nel saldo")}</span>
        : <span className={"justify-self-end rounded-md px-2 py-0.5 text-right font-mono text-sm font-semibold tabular-nums " + (bal === null ? "text-faint" : bal < 0 ? "text-[color:var(--err)]" : "text-txt")} style={bal !== null && bal < 0 ? { backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)" } : undefined}>{bal === null ? "—" : eur(bal)}</span>}
    </div>
  );

  // ---- Saldo di partenza: scrivi quanto hai oggi su un conto, da lì il saldo si aggiorna ----
  // I saldi sono PER STRUTTURA e per conto. La finestra edita le strutture selezionate in alto a destra: una sezione per struttura, con i SUOI conti.
  const oKey = (sid: string, key: string) => `${sid}|${key}`;
  const [opening, setOpening] = useState<{ date: string; amounts: Record<string, string>; newName: string; newSids: string[]; startOfDay: boolean } | null>(null);
  const [assignOpen, setAssignOpen] = useState<string | null>(null); // conto di cui si stanno scegliendo le strutture
  const [moveCtx, setMoveCtx] = useState<{ sid: string; from: string; to: string } | null>(null); // spostamento in blocco dei movimenti di una struttura da un conto a un altro
  const contiOf = (sid: string) => contiOfStructure(conti, sid);
  const existingAmount = (sid: string, key: string) => { const op = sid ? openingOf(manual, sid, key) : undefined; return op ? formatDecimalIT(signedAmount(op)) : ""; };
  const openingAmounts = () => { const amounts: Record<string, string> = {}; for (const s of scopeStructs) for (const c of contiOf(s.id)) amounts[oKey(s.id, c.key)] = existingAmount(s.id, c.key); return amounts; };
  const openOpening = () => {
    setAssignOpen(null); setMoveCtx(null);
    // La data proposta è quella del saldo già impostato (i campi mostrano gli importi di QUEL giorno): con la data di oggi gli stessi importi diventerebbero il saldo di oggi e cambierebbe tutto il calcolo.
    const existingDates = scopeStructs.flatMap((x) => contiOf(x.id).map((c) => (openingOf(manual, x.id, c.key)?.date ?? ""))).filter(Boolean).sort();
    setOpening({ date: existingDates.length ? existingDates[existingDates.length - 1] : todayISO(), amounts: openingAmounts(), newName: "", newSids: singleSid ? [singleSid] : scopeStructs.map((x) => x.id), startOfDay: false });
  };
  const amountOf = (sid: string, key: string) => (opening && oKey(sid, key) in opening.amounts ? opening.amounts[oKey(sid, key)] : existingAmount(sid, key));
  const setAmount = (sid: string, key: string, v: string) => setOpening((o) => (o ? { ...o, amounts: { ...o.amounts, [oKey(sid, key)]: v } } : o));
  const persistConti = (next: ContoDef[]) => { setConti(next); saveConti(next); };
  const addConto = () => {
    if (!opening) return;
    const label = opening.newName.trim();
    // I conti si creano dalla singola struttura selezionata e sono SUOI.
    const sid = scopeStructs.length === 1 ? scopeStructs[0].id : "";
    if (!label || !sid) return;
    const key = contoKeyFromLabel(label, conti, sid); // stesso nome di un altro conto = conto NUOVO con chiave distinta
    persistConti([...conti, { key, label, structureIds: [sid] }]);
    setOpening((o) => (o ? { ...o, newName: "" } : o));
  };
  const moveConto = (sid: string, key: string, dir: -1 | 1) => { const next = moveWithin(conti, key, dir, contiOf(sid).map((c) => c.key)); if (next !== conti) persistConti(next); };
  const makePrincipal = (sid: string, key: string) => {
    const cur = loadContiPrefs();
    const next: ContiPrefs = { ...cur, principalBy: { ...(cur.principalBy ?? {}), [sid]: key } };
    setPrefsState(next); saveContiPrefs(next);
  };
  const toggleSid = (key: string, sid: string) => {
    const c = conti.find((x) => x.key === key);
    if (!c) return;
    const cur = c.structureIds ?? [];
    const next = cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid];
    if (!next.length) { toast(t("Un conto deve appartenere ad almeno una struttura."), "error"); return; }
    persistConti(conti.map((x) => (x.key === key ? { ...x, structureIds: next } : x)));
    if (cur.includes(sid) && countOnConto(manual, sid, key) + countOnConto(rules, sid, key) > 0) toast(t("I movimenti di questa struttura su questo conto restano dove sono: puoi spostarli con «Sposta movimenti tra conti»."), "success");
  };
  const [renaming, setRenaming] = useState<{ key: string; label: string } | null>(null);
  const renameConto = () => {
    if (!renaming) return;
    const label = renaming.label.trim();
    if (label) persistConti(conti.map((c) => (c.key === renaming.key ? { ...c, label } : c)));
    setRenaming(null);
  };
  const deleteConto = async (c: ContoDef, sid: string) => {
    // i conti su cui arrivano in automatico le prenotazioni (principale e contanti di ogni struttura) non si eliminano
    const fixed = [...new Set(allStructures.flatMap((x) => { const r = router(x.id); return [r.principal, r.accounts?.cash].filter((k): k is string => !!k); }))];
    const chk = canDeleteConto(c.key, [...computeAuto(raw.bookings, guests, getStructure, "all", router, payouts), ...computeScheduled(rules, paidSet, "all", today), ...manual], rules, fixed);
    if (!chk.ok) { await ask({ title: t("Conto non eliminabile"), message: t(chk.reason ?? ""), confirmLabel: t("Ho capito") }); return; }
    // Il conto è condiviso: se un'altra struttura ci ha messo un proprio saldo di partenza, eliminarlo da qui lo farebbe sparire anche da lei.
    const otherSids = [...new Set(manual.filter((x) => x.cat === OPENING_CAT && x.conto === c.key && movSid(x) && movSid(x) !== sid).map((x) => movSid(x)))];
    if (otherSids.length) { await ask({ title: t("Conto non eliminabile"), message: `${t("Il conto è usato anche da")} ${otherSids.map((id) => getStructure(id)?.name ?? "—").join(", ")} ${t("(ha un saldo di partenza). Azzera prima il suo saldo da quella struttura.")}`, confirmLabel: t("Ho capito") }); return; }
    if (!(await ask({ title: t("Elimina conto"), message: `${t("Eliminare il conto")} «${c.label}»? ${t("Il suo saldo di partenza verrà tolto.")}`, danger: true, confirmLabel: t("Elimina") }))) return;
    persistConti(conti.filter((x) => x.key !== c.key));
    const olds = manual.filter((x) => x.cat === OPENING_CAT && x.conto === c.key && (!movSid(x) || movSid(x) === sid)); // solo i saldi di questa struttura (e i vecchi comuni)
    if (olds.length) {
      const ids = new Set(olds.map((o) => o.id));
      setManual((prev) => prev.filter((x) => !ids.has(x.id)));
      if (user) for (const o of olds) checkWrite(deleteMovement(o.id), "Il saldo di partenza", () => setManual((prev) => (prev.some((x) => x.id === o.id) ? prev : [o, ...prev])));
    }
  };
  // Sposta in blocco i movimenti (e i pagamenti programmati) di UNA struttura da un conto a un altro. Non tocca le altre strutture.
  const moveStored = async () => {
    if (!moveCtx) return;
    const { sid, from, to } = moveCtx;
    if (!sid || !from || !to || from === to) return;
    const mv = moveContoOfStructure(manual, sid, from, to);
    const rl = moveContoOfStructure(rules, sid, from, to);
    if (mv.ids.length + rl.ids.length === 0) { toast(t("Nessun movimento da spostare."), "error"); return; }
    const lab = (k: string) => conti.find((c) => c.key === k)?.label ?? k;
    const sname = getStructure(sid)?.name ?? "—";
    const what = `${mv.ids.length} ${t("movimenti")}${rl.ids.length ? ` ${t("e")} ${rl.ids.length} ${t("pagamenti programmati")}` : ""}`;
    if (!(await ask({ title: t("Sposta i movimenti"), message: `${t("Sposto")} ${what} ${t("di")} «${sname}» ${t("dal conto")} «${lab(from)}» ${t("al conto")} «${lab(to)}». ${t("I movimenti delle altre strutture non cambiano.")}`, confirmLabel: t("Sposta") }))) return;
    const mvSet = new Set(mv.ids), rlSet = new Set(rl.ids);
    setManual(mv.list); setRules(rl.list);
    // anche le scadenze modificate a mano di quelle regole
    const ovNext: OccOverrides = {}; let ovChanged = false;
    for (const [k, v] of Object.entries(overrides)) { if (v.conto === from && rlSet.has(k.split("|")[0])) { ovNext[k] = { ...v, conto: to }; ovChanged = true; } else ovNext[k] = v; }
    if (ovChanged) { setOverrides(ovNext); saveOverrides(ovNext); }
    if (user) {
      checkWrite(updateContoOfMovements(mv.ids, to), "Lo spostamento dei movimenti", () => setManual((all) => all.map((m) => (mvSet.has(m.id) ? { ...m, conto: from } : m))));
      checkWrite(updateContoOfRules(rl.ids, to), "Lo spostamento dei pagamenti programmati", () => setRules((all) => all.map((r) => (rlSet.has(r.id) ? { ...r, conto: from } : r))));
    }
    setMoveCtx(null);
    toast(`${mv.ids.length + rl.ids.length} ${t("spostati")} · ${sname}: ${lab(from)} → ${lab(to)}`, "success");
  };
  const openingTotal = opening ? sumCents(scopeStructs.flatMap((s) => contiOf(s.id).map((c) => parseDecimalIT(amountOf(s.id, c.key)) ?? 0))) : 0;
  const saveOpening = async () => {
    if (!opening) return;
    const tid = needTenant(); if (!tid) return;
    const pairs = scopeStructs.flatMap((s) => contiOf(s.id).map((c) => ({ s, c })));
    { const bad = pairs.find(({ s, c }) => { const txt = amountOf(s.id, c.key).trim(); return !!txt && parseDecimalIT(txt) === null; }); if (bad) { toast(`${t("Importo non valido")} · ${bad.s.name} · ${bad.c.label}`, "error"); return; } }
    const curOf = (sid: string, key: string) => { const op = openingOf(manual, sid, key); return op ? signedAmount(op) : 0; };
    // Protezione: se si sta per portare a zero un saldo che oggi ha un importo, si chiede conferma (è così che si perde il saldo per errore).
    const azzerati = pairs.filter(({ s, c }) => { const txt = amountOf(s.id, c.key).trim(); const v = txt ? parseDecimalIT(txt) : null; return v === 0 && Math.abs(curOf(s.id, c.key)) > 0.005; });
    if (azzerati.length && !(await ask({ title: "Azzerare il saldo di partenza?", message: `Stai per portare a zero: ${azzerati.map(({ s, c }) => `${s.name} · ${c.label} (ora ${eur(curOf(s.id, c.key))})`).join(", ")}. Gli altri saldi non cambiano.`, danger: true, confirmLabel: "Azzera" }))) return;
    const date0 = opening.date || todayISO();
    const date = opening.startOfDay ? shiftISO(date0, -1) : date0; // saldo di inizio giornata: valido dalla sera prima, così contano anche i movimenti di quel giorno
    const newMovs: Mov[] = []; const savedPairs: { sid: string; conto: string }[] = [];
    for (const { s, c } of pairs) {
      const txt = amountOf(s.id, c.key).trim();
      if (!txt) continue;
      const val = parseDecimalIT(txt);
      if (val === null) continue;
      newMovs.push({ id: uid(), date, kind: val >= 0 ? "in" : "out", cat: OPENING_CAT, desc: `${t("Saldo di partenza")} · ${s.name} · ${c.label}`, amount: roundCents(Math.abs(val)), conto: c.key, structureId: s.id });
      savedPairs.push({ sid: s.id, conto: c.key });
    }
    if (!newMovs.length) { setOpening(null); return; }
    // un conto vecchio, non ancora assegnato, diventa della struttura che ne scrive il saldo (le altre strutture non lo vedono più)
    { const claim = new Map<string, string>(); for (const { sid, conto } of savedPairs) { const c = conti.find((x) => x.key === conto); if (c && !isContoAssigned(c) && !claim.has(conto)) claim.set(conto, sid); } if (claim.size) persistConti(conti.map((x) => (claim.has(x.key) ? { ...x, structureIds: [claim.get(x.key) as string] } : x))); }
    // i vecchi saldi COMUNI (senza struttura) degli stessi conti si sostituiscono da soli, così non si contano due volte
    const oldList = openingsReplacedBy(manual, savedPairs); // il nuovo sostituisce quello di prima SOLO di questa struttura e conto, più i comuni degli stessi conti
    const oldIds = new Set(oldList.map((o) => o.id));
    setManual((prev) => [...newMovs, ...prev.filter((x) => !oldIds.has(x.id))]);
    if (user) {
      for (const o of oldList) checkWrite(deleteMovement(o.id), "Il saldo di partenza precedente", () => setManual((prev) => (prev.some((x) => x.id === o.id) ? prev : [o, ...prev])));
      for (const mv of newMovs) checkWrite(insertMovement(tid, mv, orgForStruct(mv.structureId)), "Il saldo di partenza", () => setManual((prev) => prev.filter((x) => x.id !== mv.id)));
    }
    setOpening(null);
  };

  const perCat = useMemo(() => { const map: Record<string, number> = {}; for (const m of rowsStat) if (m.kind === "out") map[m.cat] = roundCents((map[m.cat] ?? 0) + m.amount); return Object.entries(map).map(([k, v]) => ({ cat: catOf(k), v })).filter((x) => x.cat).sort((a, b) => b.v - a.v); }, [rowsStat]);
  const perCatIn = useMemo(() => { const map: Record<string, number> = {}; for (const m of rowsStat) if (m.kind === "in" && m.cat !== OPENING_CAT) map[m.cat] = roundCents((map[m.cat] ?? 0) + m.amount); return Object.entries(map).map(([k, v]) => ({ cat: catOf(k), v })).filter((x) => x.cat).sort((a, b) => b.v - a.v); }, [rowsStat]);
  const [catView, setCatView] = useState<"out" | "in">("out"); // lato del riquadro: uscite o entrate per categoria
  const catRows = catView === "out" ? perCat : perCatIn;
  const maxCat = Math.max(1, ...catRows.map((x) => x.v));

  const chartSrc = useMemo(() => [...all, ...(futureView ? forecastChart : [])], [all, forecastChart, futureView]);
  const trend = useMemo(() => {
    const n = futureView ? 6 : 12; // previsione: 6 mesi da quello in corso; altrimenti 12 mesi fino a "Al" o a oggi
    const base = futureView ? monthKey(fcEnd) : to ? monthKey(to) : monthKey(today);
    const [by, bm] = base.split("-").map(Number);
    const list: { ym: string; in: number; out: number }[] = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(by, bm - 1 - i, 1); const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; const mm = chartSrc.filter((m) => monthKey(m.date) === ym && m.cat !== OPENING_CAT); list.push({ ym, in: sumCents(mm.filter((m) => m.kind === "in").map((m) => m.amount)), out: sumCents(mm.filter((m) => m.kind === "out").map((m) => m.amount)) }); }
    return list;
  }, [chartSrc, futureView, to, today, fcEnd]);
  // Clic sul grafico: il registro si filtra su quel mese; barra verde = solo entrate, rossa = solo uscite, nome del mese = tutto. Di nuovo sullo stesso = toglie il filtro.
  const pickMonth = (ym: string, k: "all" | "in" | "out") => {
    const [y, m] = ym.split("-").map(Number);
    const f = ym + "-01", l = ym + "-" + pad(new Date(y, m, 0).getDate());
    if (from === f && to === l && tipo === k) { applyPreset("future"); setTipo("all"); return; }
    setPreset("custom"); setFrom(f); setTo(l); setTipo(k);
    setTimeout(() => { try { document.getElementById("cassa-filtri")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* niente */ } }, 50);
  };
  // Clic su una categoria del grafico: il registro mostra solo le uscite di quella categoria (di nuovo = toglie il filtro).
  const pickCat = (key: string) => {
    if (catF === key) { setCatF(""); setTipo("all"); return; }
    setCatF(key); setTipo(catView);
    setTimeout(() => { try { document.getElementById("cassa-filtri")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* niente */ } }, 50);
  };
  const monthOn = (ym: string) => { const [y, m] = ym.split("-").map(Number); return from === ym + "-01" && to === ym + "-" + pad(new Date(y, m, 0).getDate()); };
  const maxTrend = Math.max(1, ...trend.flatMap((t) => [t.in, t.out]));
  const axis = niceAxis(maxTrend); // asse Y a 4 intervalli con massimo "tondo"
  const axisTicks = [0, 1, 2, 3, 4].map((i) => i * axis.step);

  // ---- Form nuovo movimento -------------------------------------------------
  const [form, setForm] = useState<{ kind: Kind; date: string; cat: string; desc: string; amount: string; conto: string; struttura: string; repeat: "once" | "monthly" | "weekly" | "yearly" }>(() => ({ kind: "out", date: todayISO(), cat: "pulizie", desc: "", amount: "", conto: "contanti", struttura: singleSid, repeat: "once" }));
  const setKind = (k: Kind) => setForm((f) => ({ ...f, kind: k, cat: cats.find((c) => c.kind === k && !c.auto)!.key }));
  const NEW_MOV = "__nuovo__";
  const [movTab, setMovTab] = useState<"mov" | "prog">("mov"); // scheda della finestra Nuovo movimento
  const OCC_MOV = "__scadenza__"; // la finestra movimento modifica UNA scadenza di un pagamento programmato
  const [editingMov, setEditingMov] = useState<string | null>(null); // finestra movimento: id del movimento in modifica, NEW_MOV per uno nuovo, null = chiusa
  const openNewMov = () => { setForm((f) => ({ ...f, kind: "out", cat: cats.find((c) => c.kind === "out" && !c.auto)!.key, desc: "", amount: "", repeat: "once", date: todayISO(), struttura: singleSid })); setMovTab("mov"); setEditingMov(NEW_MOV); };
  const resetForm = () => { setEditingMov(null); setOccCtx(null); setForm((f) => ({ ...f, desc: "", amount: "", repeat: "once", date: todayISO() })); };
  const openOcc = (m: Mov) => {
    const r = rules.find((x) => x.id === m.ref);
    if (!r) return;
    const key = occurrenceKey(m);
    const origDate = key.split("|")[1] ?? m.date;
    setOccCtx({ key, ruleId: r.id, orig: { amount: r.amount, date: origDate, desc: r.desc, cat: r.cat, conto: r.conto } });
    setForm({ kind: m.kind, date: m.date, cat: m.cat, desc: m.desc, amount: String(m.amount).replace(".", ","), conto: m.conto, struttura: m.structureId ?? (singleSid || "all"), repeat: "once" });
    setEditingMov(OCC_MOV);
  };
  const saveOcc = () => {
    if (!occCtx) return;
    const amt = readAmount(form.amount);
    if (amt === null) return;
    if (!form.date) { toast(t("Inserisci la data."), "error"); return; }
    const desc = form.desc.trim() || occCtx.orig.desc;
    const o = occCtx.orig;
    const next = { ...overrides };
    if (amt === o.amount && form.date === o.date && desc === o.desc && form.cat === o.cat && form.conto === o.conto) delete next[occCtx.key];
    else next[occCtx.key] = { amount: amt, date: form.date, desc, cat: form.cat, conto: form.conto };
    setOverrides(next); saveOverrides(next);
    toast(`${t("Scadenza modificata")} · ${fmtDMY(form.date)} · ${eur(amt)}`, "success");
    resetForm();
  };
  const resetOcc = () => { if (!occCtx) return; const next = { ...overrides }; delete next[occCtx.key]; setOverrides(next); saveOverrides(next); resetForm(); };
  const startEditMov = (m: Mov) => {
    setEditingMov(m.id);
    setForm({ kind: m.kind, date: m.date, cat: m.cat, desc: m.desc, amount: String(m.amount).replace(".", ","), conto: m.conto, struttura: m.structureId ?? (singleSid || "all"), repeat: "once" });
  };
  // Se la data del movimento cade fuori dal periodo mostrato, allarga il periodo: la riga appena registrata deve vedersi nell'elenco.
  const showDate = (d: string) => {
    if (from && d < from) { setFrom(d); setPreset("custom"); }
    if (to && d > to) { setTo(d); setPreset("custom"); }
  };
  const add = () => {
    if (editingMov === OCC_MOV) { saveOcc(); return; }
    if (!form.struttura) { toast(t("Scegli la struttura."), "error"); return; } // con più strutture (o tutte) la struttura va scelta: niente voci «comuni» per sbaglio
    const amt = readAmount(form.amount); // al centesimo; formato italiano ("1.234,56"), testo non valido = errore
    if (amt === null) return;
    if (!form.date) { toast(t("Inserisci la data."), "error"); return; }
    const desc = form.desc.trim() || catOf(form.cat)?.label || "";
    const summary = `${fmtDMY(form.date)} · ${form.kind === "in" ? "+" : "−"} ${eur(amt)}`;
    if (editingMov && editingMov !== NEW_MOV) {
      const prev = manual.find((m) => m.id === editingMov);
      if (!prev) { resetForm(); return; }
      const next: Mov = { ...prev, date: form.date, kind: form.kind, cat: form.cat, desc, amount: amt, conto: form.conto, structureId: form.struttura };
      setManual((all) => all.map((m) => (m.id === prev.id ? next : m)));
      if (user) checkWrite(updateMovement(prev.id, next, orgForStruct(next.structureId)), "La modifica", () => setManual((all) => all.map((m) => (m.id === prev.id ? prev : m))));
      showDate(form.date);
      toast(`${t("Movimento modificato")} · ${summary}`, "success");
      resetForm();
      return;
    }
    const tid = needTenant(); if (!tid) return;
    const mov: Mov = { id: uid(), date: form.date, kind: form.kind, cat: form.cat, desc, amount: amt, conto: form.conto, structureId: form.struttura };
    setManual((prev) => [mov, ...prev]);
    checkWrite(insertMovement(tid, mov, orgForStruct(mov.structureId)), "Il movimento", () => setManual((prev) => prev.filter((m) => m.id !== mov.id)));
    showDate(form.date);
    toast(`${t("Movimento registrato")} · ${summary}`, "success");
    // Ricorrente: crea la regola che riparte dal periodo SUCCESSIVO (questo è già registrato come movimento).
    if (form.repeat !== "once") {
      const nextStart = nextRecurrenceStart(form.date, form.repeat); // giorno limitato a fine mese: dal 29/30/31 non salta febbraio
      const rule: Rule = { id: uid(), kind: form.kind, cat: form.cat, desc, amount: amt, conto: form.conto, structureId: form.struttura, freq: form.repeat, day: parseInt(form.date.slice(8, 10)) || 1, start: nextStart, auto: true };
      setRules((prev) => [...prev, rule]);
      checkWrite(insertRule(tid, rule, orgForStruct(rule.structureId)), "Il pagamento ricorrente", () => setRules((prev) => prev.filter((r) => r.id !== rule.id)));
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
  const [rf, setRf] = useState<{ kind: Kind; cat: string; desc: string; amount: string; conto: string; struttura: string; freq: Rule["freq"]; day: string; start: string; auto: boolean; end: string; note?: string; variable: boolean }>(() => ({ kind: "out", cat: "affitto", desc: "", amount: "", conto: "banca", struttura: singleSid, freq: "monthly", day: "1", start: todayISO(), auto: true, end: "", note: "", variable: false }));
  // La struttura del nuovo movimento/regola segue la struttura selezionata in alto a destra.
  useEffect(() => { setForm((f) => ({ ...f, struttura: singleSid })); setRf((f) => ({ ...f, struttura: singleSid })); }, [singleSid]);
  // Il menu «Conto» mostra solo i conti della struttura scelta (più il conto attuale del movimento, se non è suo, segnalato: non lo si cambia di nascosto).
  const nameOfStruct = (id: string) => getStructure(id)?.name ?? "—";
  // Con più strutture selezionate (o tutte) il nome del conto dice a quale struttura appartiene: «Revolut - Spigolehouse», «Revolut - Central Perk».
  const contoLabel = (key: string, sid?: string) => {
    const c = conti.find((x) => x.key === key);
    if (!c) return key;
    const base = t(c.label);
    if (!multiScope) return base;
    const mine = c.structureIds ?? [];
    const ids = sid && mine.includes(sid) ? [sid] : mine.filter((id) => scopeStructs.some((x) => x.id === id));
    return ids.length ? `${base} - ${ids.map(nameOfStruct).join(", ")}` : base;
  };
  const contoOptions = (sid: string, current: string) => {
    const list = contiOfStructure(conti, sid);
    const extra = current && !list.some((c) => c.key === current) ? conti.find((c) => c.key === current) : undefined;
    return extra ? [...list, extra] : list;
  };
  const contoOptLabel = (c: ContoDef, sid: string) => `${contoVisible(c, sid && sid !== "all" ? sid : "all") ? "" : "⚠ "}${multiScope ? contoLabel(c.key, sid && sid !== "all" ? sid : undefined) : t(contoDisplayLabel(c, conti, nameOfStruct))}`;
  const defaultContoFor = (sid: string) => { const r = routeFor(conti, prefs, sid); return r.accounts?.cash ?? r.principal; };
  // Un NUOVO movimento / pagamento programmato deve cadere su un conto della struttura scelta: se quello attuale non lo è, si passa ai suoi contanti (o al suo principale).
  useEffect(() => { if (editingMov === NEW_MOV && form.struttura && !contiOfStructure(conti, form.struttura).some((c) => c.key === form.conto)) setForm((f) => ({ ...f, conto: defaultContoFor(form.struttura) })); }, [editingMov, form.struttura, form.conto, conti, prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ruleModal && !editingRule && rf.struttura && !contiOfStructure(conti, rf.struttura).some((c) => c.key === rf.conto)) setRf((f) => ({ ...f, conto: defaultContoFor(rf.struttura) })); }, [ruleModal, editingRule, rf.struttura, rf.conto, conti, prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const openNewRule = () => { setEditingRule(null); setRuleModal(true); };
  const openEditRule = (r: Rule) => {
    setEditingRule(r.id);
    setRf({ kind: r.kind, cat: r.cat, desc: r.desc, amount: String(r.amount).replace(".", ","), conto: r.conto, struttura: r.structureId ?? (singleSid || "all"), freq: r.freq, day: String(r.day), start: r.start, auto: r.auto, end: r.end ?? "", note: r.note ?? "", variable: !!r.variable });
    setRuleModal(true);
  };
  const closeRuleModal = () => { setRuleModal(false); setEditingRule(null); };
  const addRule = () => {
    const amt = readAmount(rf.amount);
    if (amt === null) return;
    if (!rf.struttura) { toast(t("Scegli la struttura."), "error"); return; }
    if (editingRule) {
      const prev = rules.find((r) => r.id === editingRule);
      if (!prev) return closeRuleModal();
      const next: Rule = { ...prev, kind: rf.kind, cat: rf.cat, desc: rf.desc.trim() || catOf(rf.cat)?.label || "", amount: amt, conto: rf.conto, structureId: rf.struttura, freq: rf.freq, day: parseInt(rf.day) || 1, start: rf.start, auto: rf.variable ? false : rf.auto, end: rf.end || undefined, note: rf.note?.trim() || undefined, variable: rf.variable };
      setRules((all) => all.map((r) => (r.id === prev.id ? next : r)));
      if (user) checkWrite(updateRule(prev.id, next, orgForStruct(next.structureId)), "La modifica", () => setRules((all) => all.map((r) => (r.id === prev.id ? prev : r))));
      closeRuleModal();
      return;
    }
    const rule: Rule = { id: uid(), kind: rf.kind, cat: rf.cat, desc: rf.desc.trim() || catOf(rf.cat)?.label || "", amount: amt, conto: rf.conto, structureId: rf.struttura, freq: rf.freq, day: parseInt(rf.day) || 1, start: rf.start, auto: rf.variable ? false : rf.auto, end: rf.end || undefined, note: rf.note?.trim() || undefined, variable: rf.variable };
    const tid = needTenant(); if (!tid) return;
    setRules((prev) => [...prev, rule]);
    checkWrite(insertRule(tid, rule, orgForStruct(rule.structureId)), "Il pagamento programmato", () => setRules((prev) => prev.filter((r) => r.id !== rule.id)));
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
    const body = rows.map((m) => [fmtDMY(m.date), m.kind === "in" ? t("Entrata") : t("Uscita"), catOf(m.cat)?.label ? t(catOf(m.cat)!.label) : m.cat, m.desc + (m.sched ? ` (${t("programmato")})` : m.auto ? ` (${t("auto")})` : ""), CONTI.find((x) => x.key === m.conto)?.label ? t(CONTI.find((x) => x.key === m.conto)!.label) : m.conto, structNameOf(movSid(m)), m.kind === "in" ? m.amount : "", m.kind === "out" ? m.amount : ""]);
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
      <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <StatCard label={t("Saldo attuale")} value={hasOpening ? eur(saldoTot) : "—"} color={hasOpening && saldoTot < 0 ? "var(--err)" : undefined} onClick={() => openOpening()} hint={hasOpening ? <>{Object.keys(saldoConti).length} {t("conti")}{saldoPerStruttura.length > 1 && <span className="mt-0.5 block space-y-px text-[10px] leading-tight">{saldoPerStruttura.map((x) => <span key={x.sid || "comuni"} className="flex items-baseline justify-between gap-2"><span className="truncate">{x.name}</span><span className="shrink-0 font-mono">{eur(x.saldo)}</span></span>)}</span>}</> : t("Imposta il saldo di partenza →")} />
        <StatCard label={`${t("Entrate")} ${periodWord}`} value={eur(entrateCard)} color="var(--ok)" hint={`${cardRows.filter((m) => m.kind === "in").length} ${t("movimenti")}`} />
        <StatCard label={`${t("Uscite")} ${periodWord}`} value={eur(usciteCard)} color="var(--err)" hint={`${cardRows.filter((m) => m.kind === "out").length} ${t("movimenti")}`} />
        <StatCard label={`${t("Saldo")} ${futureView ? t("previsto") : preset === "all" ? t("totale") : t("del periodo")}`} value={eur(prevCard ? saldoPrevisto : saldo)} color={(prevCard ? saldoPrevisto : saldo) >= 0 ? undefined : "var(--err)"} hint={prevCard ? <>{t("con saldo attuale")} · {t("al")} {fmtDMY(listHorizon)}</> : t("entrate − uscite")} />
      </div>

      {chartsOn && (
      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <div className="mb-1 flex items-center justify-between gap-2">
            <SectionTitle>{catView === "out" ? t("Uscite per categoria") : t("Entrate per categoria")}</SectionTitle>
            <button type="button" onClick={() => { setCatView((v) => (v === "out" ? "in" : "out")); setCatF(""); }} title={catView === "out" ? t("Mostra le entrate per categoria") : t("Mostra le uscite per categoria")} aria-label={catView === "out" ? t("Mostra le entrate per categoria") : t("Mostra le uscite per categoria")} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line text-dim hover:bg-wash hover:text-txt">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
            </button>
          </div>
          {catRows.length === 0 ? <p className="text-sm text-faint">{catView === "out" ? t("Nessuna uscita nel periodo.") : t("Nessuna entrata nel periodo.")}</p> : (
            <div className="flex max-h-[172px] flex-col gap-2.5 overflow-y-auto pr-2">
              {catRows.map(({ cat, v }) => (
                <button key={cat!.key} type="button" onClick={() => pickCat(cat!.key)} aria-pressed={catF === cat!.key} title={t("clicca per filtrare")} className={`block w-full rounded-md px-1 py-0.5 text-left transition hover:bg-wash ${catF === cat!.key ? "bg-wash ring-1 ring-[color:var(--focus)]" : ""}`}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-dim"><span style={{ color: cat!.color }}><CatIcon name={cat!.icon} size={15} /></span>{t(cat!.label)}</span>
                    <span className="font-mono text-txt">{eur(v)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${(v / maxCat) * 100}%`, backgroundColor: cat!.color }} /></div>
                </button>
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
                  <div key={tr.ym} className={`flex flex-1 flex-col items-center gap-1 rounded-md ${monthOn(tr.ym) ? "bg-wash" : ""}`}>
                    <div className="flex w-full items-end justify-center gap-1.5" style={{ height: 120 }}>
                      <div role="button" tabIndex={0} aria-label={`${t("Solo entrate")} · ${monthLabel(tr.ym)} · ${eur(tr.in)}`} onClick={() => pickMonth(tr.ym, "in")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickMonth(tr.ym, "in"); } }} className="relative w-1/3 max-w-[26px] cursor-pointer rounded-t hover:opacity-80" title={`${t("Entrate")} ${eur(tr.in)} · ${t("clicca per filtrare")}`} style={{ height: `${(tr.in / axis.max) * 100}%`, backgroundColor: "var(--ok)", minHeight: tr.in > 0 ? 3 : 0 }}>
                        {tr.in > 0 && <span className="absolute bottom-full left-1/2 mb-0.5 hidden -translate-x-1/2 whitespace-nowrap font-mono text-[8px] leading-none text-dim sm:block">{compactEuro(tr.in)}</span>}
                      </div>
                      <div role="button" tabIndex={0} aria-label={`${t("Solo uscite")} · ${monthLabel(tr.ym)} · ${eur(tr.out)}`} onClick={() => pickMonth(tr.ym, "out")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickMonth(tr.ym, "out"); } }} className="relative w-1/3 max-w-[26px] cursor-pointer rounded-t hover:opacity-80" title={`${t("Uscite")} ${eur(tr.out)} · ${t("clicca per filtrare")}`} style={{ height: `${(tr.out / axis.max) * 100}%`, backgroundColor: "var(--err)", minHeight: tr.out > 0 ? 3 : 0 }}>
                        {tr.out > 0 && <span className="absolute bottom-full left-1/2 mb-0.5 hidden -translate-x-1/2 whitespace-nowrap font-mono text-[8px] leading-none text-dim sm:block">{compactEuro(tr.out)}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => pickMonth(tr.ym, "all")} aria-label={`${t("Tutti i movimenti")} · ${monthLabel(tr.ym)}`} className="w-full rounded px-1 text-[10px] capitalize text-faint hover:text-txt">{monthLabel(tr.ym).split(" ")[0].slice(0, 3)}</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
      )}

      {/* Riga filtri + toggle grafici + Esporta */}
      <div id="cassa-filtri" className="mb-4 flex scroll-mt-16 flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={toggleCharts} title={chartsOn ? t("Nascondi i grafici") : t("Mostra i grafici")} className={`grid h-8 w-8 place-items-center rounded-lg border transition ${chartsOn ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] text-focus" : "border-line text-dim hover:bg-wash hover:text-txt"}`}><Icon name="chart" size={15} /></button>
          <button onClick={openPayoutModal} title={t("Impostazioni incassi")} aria-label={t("Impostazioni incassi")} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-dim transition hover:bg-wash hover:text-txt"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg></button>
          <button onClick={openNewMov} className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">＋ {t("Nuovo movimento")}</button>
          <ExportMenu onExcel={doExcel} onPdf={exportPdf} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 flex items-center justify-between"><SectionTitle>{t("Movimenti")}</SectionTitle><span className="text-xs text-faint">{listRows.length} {t("nel periodo")}</span></div>
            {rows.length === 0 ? <EmptyState title={t("Nessun movimento.")} /> : (
              <div className="-mx-1 max-h-[70dvh] overflow-auto px-1 md:max-h-[640px]">
              <div className="md:min-w-[920px]">
              <div className="grid max-md:grid-cols-[58px_minmax(0,1fr)_84px_92px] md:grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] items-center gap-x-3 sticky top-0 z-10 border-b border-line bg-surface pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                <span>{t("Data")}</span><span>{t("Movimento")}</span><span className="text-right max-md:hidden">{t("Lordo")}</span><span className="text-right max-md:hidden">{t("Commissioni")}</span><span className="text-right">{t("Netto")}</span><span className="-mb-1.5 self-stretch border-l border-line pb-1.5 pl-2 text-right" title={t("Saldo dei conti dopo ogni movimento, per la struttura selezionata")}>{t("Saldo conti")}</span>
              </div>
              <div className="flex flex-col divide-y divide-[color:var(--line)]">
                {(() => {
                const rowDate = (x: (typeof listRows)[number]) => (x.type === "payout" || x.type === "opening" ? x.date : x.type === "booking" ? x.income.date : x.mov.date);
                const els = listRows.map((r) => {
                  if (r.type === "opening") {
                    const open = openPayouts.has(r.id);
                    const lastId = r.movIds.reduce((best, id) => ((ledger.order.get(id) ?? 0) > (ledger.order.get(best) ?? 0) ? id : best), r.movIds[0]);
                    const stName = r.structureId ? structNameOf(r.structureId) : "";
                    return (
                      <div key={r.id}>
                        <div onClick={() => setOpenPayouts((prev) => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} title={open ? t("Chiudi il dettaglio") : t("Mostra i conti")} className="grid max-md:grid-cols-[58px_minmax(0,1fr)_84px_92px] md:grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] cursor-pointer items-center gap-x-3 whitespace-nowrap py-2.5 hover:bg-wash/60">
                          <span className="font-mono text-xs text-dim">{fmtDMY(r.date)}</span>
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-wash text-dim"><Icon name="coins" size={13} /></span>
                            <span className="truncate text-sm font-medium text-txt">{t("Saldo di partenza")}{stName ? ` · ${stName}` : ""} · {r.items.length} {t("conti")}</span>
                            <span className="shrink-0 text-faint">{open ? "▾" : "▸"}</span>
                          </div>
                          <span className="max-md:hidden" />
                          <span className="max-md:hidden" />
                          <span className="text-right font-mono text-sm font-bold" style={{ color: r.total >= 0 ? "var(--ok)" : "var(--err)" }}>{r.total >= 0 ? "+ " : "− "}{eur(Math.abs(r.total))}</span>
                          {balCell(ledger.balanceAfter.get(lastId) ?? null, ledger.included.has(lastId))}
                        </div>
                        {open && r.items.map((m) => (
                          <div key={"o-" + m.id} className="grid max-md:grid-cols-[58px_minmax(0,1fr)_84px_92px] md:grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] items-center gap-x-3 whitespace-nowrap bg-wash/40 py-1 text-xs text-dim">
                            <span />
                            <span className="truncate pl-9">{(CONTI.find((c) => c.key === m.conto)?.label) ?? m.conto}</span>
                            <span className="max-md:hidden" />
                            <span className="max-md:hidden" />
                            <span className="text-right font-mono">{m.kind === "in" ? "+ " : "− "}{eur(m.amount)}</span>
                            <div className="-my-1 self-stretch border-l border-line" />
                          </div>
                        ))}
                      </div>
                    );
                  }
                  if (r.type === "payout") {
                    const open = openPayouts.has(r.id);
                    const infoSum = sumCents(r.items.map((it) => (it.type === "mov" ? infoOf(it.mov)?.amount : it.type === "booking" ? infoOf(it.income)?.amount : 0)));
                    const lastId = r.movIds.reduce((best, id) => ((ledger.order.get(id) ?? 0) > (ledger.order.get(best) ?? 0) ? id : best), r.movIds[0]);
                    const ch = r.channel as Channel;
                    return (
                      <div key={r.id}>
                        <div onClick={() => setOpenPayouts((prev) => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} title={open ? t("Chiudi il dettaglio") : t("Mostra le prenotazioni di questo pagamento")} className="grid max-md:grid-cols-[58px_minmax(0,1fr)_84px_92px] md:grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] cursor-pointer items-center gap-x-3 whitespace-nowrap rounded py-1.5 hover:bg-wash">
                          <span className="font-mono text-xs text-dim">{fmtDMY(r.date)}</span>
                          <div className="flex min-w-0 items-center gap-2">
                            <ChannelLogo channel={ch} size={24} title={CHANNELS[ch]?.label} />
                            <span className="truncate text-sm font-medium text-txt">{CHANNELS[ch]?.label} · {t("pagamento")} · {r.count} {r.count === 1 ? t("prenotazione") : t("prenotazioni")}</span>
                            {r.forecast && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("previsto")}</span>}
                            <span className="shrink-0 text-faint">{open ? "▾" : "▸"}</span>
                          </div>
                          <span className="text-right font-mono text-xs max-md:hidden" style={{ color: "var(--ok)" }}>+ {eur(r.gross)}</span>
                          {r.comm === 0 && infoSum > 0 ? <span className="text-right font-mono text-[11px] italic text-faint max-md:hidden" title={t("Commissioni trattenute dal portale tutte insieme, a parte: non cambiano il saldo.")}>(− {eur(infoSum)})</span> : <span className="text-right font-mono text-xs max-md:hidden" style={{ color: "var(--err)" }}>− {eur(r.comm)}{r.gross > 0 && r.comm > 0 && <span className="ml-1 text-[10px] text-faint" title={t("Commissioni ÷ lordo")}>{String(Math.round((r.comm / r.gross) * 1000) / 10).replace(".", ",")}%</span>}</span>}
                          <span className="text-right font-mono text-sm font-bold text-txt">{eur(r.net)}</span>
                          {balCell(ledger.balanceAfter.get(lastId) ?? null, ledger.included.has(lastId))}
                        </div>
                        {open && r.items.map((it) => {
                          if (it.type === "payout" || it.type === "opening") return null;
                          const im = it.type === "booking" ? it.income : it.mov;
                          const ib = bkOf(im);
                          const gn = ib ? (guests.find((g) => g.id === ib.guestId)?.fullName || "Ospite") : im.desc;
                          const g2 = it.type === "booking" ? it.gross : im.kind === "in" ? im.amount : 0;
                          const c2 = it.type === "booking" ? it.comm : im.kind === "out" ? im.amount : 0;
                          const inf2 = !c2 ? infoOf(im) : undefined;
                          return (
                            <div key={"i-" + im.id} className="grid max-md:grid-cols-[58px_minmax(0,1fr)_84px_92px] md:grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] items-center gap-x-3 whitespace-nowrap bg-wash/40 py-1 text-xs text-dim">
                              <span />
                              <span className="truncate pl-9">{gn}{ib ? <span className="text-faint"> · {t("check-out")} {fmtDMY(ib.checkOut)}</span> : null}</span>
                              <span className="text-right font-mono max-md:hidden">{g2 ? `+ ${eur(g2)}` : ""}</span>
                              <span className={"text-right font-mono max-md:hidden" + (inf2 ? " text-[11px] italic text-faint" : "")} title={inf2 ? infoText(inf2) : undefined}>{c2 ? `− ${eur(c2)}` : inf2 ? `(− ${eur(inf2.amount)})` : ""}</span>
                              <span className="text-right font-mono">{eur(roundCents(g2 - c2))}</span>
                              <div className="-my-1 self-stretch border-l border-line" />
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                  if (r.type === "mov" && r.mov.commRefs) {
                    // commissioni di un mese pagate TUTTE INSIEME dal portale (un movimento vero, espandibile sulle prenotazioni incluse)
                    const m = r.mov;
                    const open = openPayouts.has(m.id);
                    const ch = (m.channel ?? "other") as Channel;
                    const det = m.commRefs!.map((id) => raw.bookings.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => !!b);
                    const totComm = sumCents(det.map((b) => commissionOf(b)));
                    const totLordo = sumCents(det.map((b) => lordoOf(b)));
                    const pctOf = (c: number, l: number) => (l > 0 ? String(Math.round((c / l) * 1000) / 10).replace(".", ",") + "%" : "");
                    return (
                      <div key={m.id}>
                        <div onClick={() => setOpenPayouts((prev) => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} title={open ? t("Chiudi il dettaglio") : t("Mostra le prenotazioni incluse in queste commissioni")} className="grid max-md:grid-cols-[58px_minmax(0,1fr)_84px_92px] md:grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] cursor-pointer items-center gap-x-3 whitespace-nowrap rounded py-1.5 hover:bg-wash">
                          <span className="font-mono text-xs text-dim">{fmtDMY(m.date)}</span>
                          <div className="flex min-w-0 items-center gap-2">
                            <ChannelLogo channel={ch} size={24} title={CHANNELS[ch]?.label} />
                            <span className="truncate text-sm font-medium text-txt">{m.desc}</span>
                            <span className="shrink-0 rounded bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-faint">{t("auto")}</span>
                            <span className="shrink-0 text-faint">{open ? "▾" : "▸"}</span>
                          </div>
                          <span className="max-md:hidden" />
                          <span className="max-md:hidden" />
                          <span className="text-right font-mono text-sm font-semibold" style={{ color: "var(--err)" }}>− {eur(m.amount)}</span>
                          {balCell(ledger.balanceAfter.get(m.id) ?? null, ledger.included.has(m.id))}
                        </div>
                        {open && (
                          <>
                            {det.map((b) => (
                              <div key={"cm-" + b.id} className="grid max-md:grid-cols-[58px_minmax(0,1fr)_84px_92px] md:grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] items-center gap-x-3 whitespace-nowrap bg-wash/40 py-1 text-xs text-dim">
                                <span />
                                <span className="truncate pl-9">{guests.find((g) => g.id === b.guestId)?.fullName || "Ospite"}<span className="text-faint"> · {t("check-out")} {fmtDMY(b.checkOut)}</span></span>
                                <span className="text-right font-mono max-md:hidden">{lordoOf(b) ? `+ ${eur(lordoOf(b))}` : ""}</span>
                                <span className="text-right font-mono max-md:hidden" title={t("Commissioni ÷ lordo")}>{String(commissionShareOf(b)).replace(".", ",")}%</span>
                                <span className="text-right font-mono">− {eur(roundCents(commissionOf(b)))}</span>
                                <div className="-my-1 self-stretch border-l border-line" />
                              </div>
                            ))}
                            <div className="grid max-md:grid-cols-[58px_minmax(0,1fr)_84px_92px] md:grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] items-center gap-x-3 whitespace-nowrap bg-wash/40 py-1 text-xs font-semibold text-dim">
                              <span />
                              <span className="truncate pl-9">{t("Totale")} · {det.length} {det.length === 1 ? t("prenotazione") : t("prenotazioni")}</span>
                              <span className="text-right font-mono max-md:hidden">{totLordo ? `+ ${eur(totLordo)}` : ""}</span>
                              <span className="text-right font-mono max-md:hidden" title={t("Commissioni ÷ lordo")}>{pctOf(totComm, totLordo)}</span>
                              <span className="text-right font-mono">− {eur(totComm)}</span>
                              <div className="-my-1 self-stretch border-l border-line" />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  }
                  const isBooking = r.type === "booking";
                  const m = isBooking ? r.income : r.mov;
                  const inf = isBooking ? undefined : infoOf(m);
                  const c = catOf(m.cat);
                  const bk = bkOf(m);
                  const gname = bk ? (guests.find((g) => g.id === bk.guestId)?.fullName || "Ospite") : "";
                  const title = bk ? (m.id.startsWith("auto-comm-") ? t("Commissione") + " · " + gname + (bk ? " · " + String(commissionShareOf(bk)).replace(".", ",") + "%" : "") : m.id.startsWith("fc-in-") ? gname + " · " + t("da incassare") : gname) : m.desc;
                  // saldo in quella data = dopo l'ultimo movimento della riga (per la prenotazione: dopo incasso e commissione)
                  const lastId = isBooking && r.commission && ledgerOrd(r.commission) > ledgerOrd(r.income) ? r.commission.id : m.id;
                  const bal = ledger.balanceAfter.get(lastId) ?? null;
                  // riga modificabile: movimento inserito a mano (si apre la finestra di modifica) o saldo di partenza (si apre la finestra del saldo)
                  const rowClick = isBooking ? undefined : m.sched && m.ref ? () => openOcc(m) : m.auto || m.forecast ? undefined : m.cat === OPENING_CAT ? () => openOpening() : () => startEditMov(m);
                  const included = ledger.included.has(lastId); // del giorno del saldo di partenza: già nell'importo scritto
                  return (
                    <div key={isBooking ? "b-" + r.id : m.id}>
                    <div onClick={rowClick} title={rowClick ? t("Clicca per modificare") : undefined} className={"grid max-md:grid-cols-[58px_minmax(0,1fr)_84px_92px] md:grid-cols-[84px_minmax(0,1fr)_108px_108px_116px_128px] items-center gap-x-3 whitespace-nowrap py-1.5" + (m.variable ? " rounded bg-[color:color-mix(in_srgb,var(--warn)_12%,transparent)]" : "") + (rowClick ? " cursor-pointer rounded hover:bg-wash" : "")}>
                      <span className="font-mono text-xs text-dim">{fmtDMY(m.date)}</span>
                      <div className="flex min-w-0 items-center gap-2">
                        {bk ? <BookingChannelLogo booking={bk} size={24} title={CHANNELS[bk.channel]?.label} /> : iconCircle(c, 24)}
                        <span className="truncate text-sm font-medium text-txt">{title}</span>
                        {!isBooking && receiptOf.get(m.id) && <button type="button" onClick={(e) => { e.stopPropagation(); void openRcpt(receiptOf.get(m.id)!.path); }} aria-label={t("Apri scontrino")} title={t("Apri scontrino")} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line text-dim hover:bg-wash hover:text-txt"><Icon name="receipt" size={13} /></button>}
                        {m.forecast ? <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}>{t("previsto")}</span> : (m.auto && <span className="shrink-0 rounded bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-faint">{t("auto")}</span>)}
                        {!isBooking && m.sched && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>{t("programmato")}</span>}
                        {!isBooking && m.variable && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 22%, transparent)", color: "var(--warn)" }} title={t("Importo variabile: è una stima, alla scadenza registri quello reale")}>{t("variabile")}</span>}
                        {!isBooking && m.edited && <span className="shrink-0 rounded bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-dim" title={t("Riga modificata solo per questa scadenza")}>{t("modificato")}</span>}
                        <span className="min-w-0 truncate text-[11px] text-faint">{[c?.label ? t(c.label) : "", contoLabel(m.conto, movSid(m) || undefined), multiScope && movSid(m) && !contoLabel(m.conto, movSid(m) || undefined).includes(" - ") ? structNameOf(movSid(m)) : ""].filter(Boolean).join(" · ")}</span>
                        {contoUnassigned(m, conti) && <span className="shrink-0 text-[10px] font-semibold text-[color:var(--warn)]" title={t("Conto non assegnato a questa struttura: correggi il conto dalla modifica del movimento, oppure sposta in blocco i movimenti da «Saldo di partenza» → «Sposta movimenti tra conti».")}>⚠ {t("conto non assegnato")}</span>}
                      </div>
                      {isBooking ? (
                        <>
                          <span className="text-right font-mono text-xs max-md:hidden" style={{ color: "var(--ok)" }}>+ {eur(r.gross)}</span>
                          <span className="text-right font-mono text-xs max-md:hidden" style={{ color: "var(--err)" }}>− {eur(r.comm)}{r.gross > 0 && r.comm > 0 && <span className="ml-1 text-[10px] text-faint" title={t("Commissioni ÷ lordo")}>{String(Math.round((r.comm / r.gross) * 1000) / 10).replace(".", ",")}%</span>}</span>
                          <span className="text-right font-mono text-sm font-bold text-txt">{eur(r.net)}</span>
                        </>
                      ) : (
                        <>
                          <span className="max-md:hidden" />
                          <span className="max-md:hidden" />
                          <span className="text-right font-mono text-sm font-semibold" style={{ color: m.kind === "in" ? "var(--ok)" : "var(--err)" }}>{m.variable ? "~ " : ""}{m.kind === "in" ? "+" : "−"} {eur(m.amount)}</span>
                        </>
                      )}
                      <div className="-my-1.5 flex items-center justify-end self-stretch border-l border-line pl-2">
                      {included
                        ? <span className="justify-self-end px-2 text-right text-[11px] italic text-faint" title={t("Questo movimento è del giorno in cui hai impostato il saldo: è già compreso nell'importo che hai scritto.")}>{t("già nel saldo")}</span>
                        : <span className={"justify-self-end rounded-md px-2 py-0.5 text-right font-mono text-sm font-semibold tabular-nums " + (bal === null ? "text-faint" : bal < 0 ? "text-[color:var(--err)]" : "text-txt")} style={bal !== null && bal < 0 ? { backgroundColor: "color-mix(in srgb, var(--err) 10%, transparent)" } : undefined} title={bal === null ? t("Imposta il saldo di partenza per vedere il saldo") : m.forecast ? t("Saldo previsto") : t("Saldo dopo questo movimento")}>{bal === null ? "—" : eur(bal)}</span>}
                      </div>
                    </div>
                    {inf && <div className="-mt-0.5 pb-1 pl-[70px] text-[11px] italic leading-tight text-faint md:pl-[96px]" title={t("Il portale trattiene le commissioni tutte insieme: non è un movimento di questa riga e non cambia il saldo.")}>{infoText(inf)}</div>}
                    </div>
                  );
                });
                // Cambio d'anno: una riga più spessa con il titolo dell'anno che comincia (si vede subito dove finisce un anno e inizia l'altro)
                const oggiOpen = openPayouts.has("oggi");
                const oggiNode = (k: string) => (
                        <div key={k}>
                          <div onClick={() => setOpenPayouts((prev) => { const n = new Set(prev); if (n.has("oggi")) n.delete("oggi"); else n.add("oggi"); return n; })} title={oggiOpen ? t("Chiudi il dettaglio") : t("Mostra i saldi dei conti")} className="flex cursor-pointer items-center gap-2 border-y-2 border-[color:var(--warn)] bg-wash px-3 py-1 text-xs font-bold text-txt hover:bg-wash/70">
                            <span className="rounded-full bg-[color:var(--warn)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white">{t("Oggi")}</span><span>{fmtDMY(today)}</span><span className="text-faint">{oggiOpen ? "▾" : "▸"}</span>
                            {hasOpening && <span className="ml-auto font-mono">{t("saldo attuale")} {eur(saldoTot)}</span>}
                          </div>
                          {oggiOpen && balParts.filter((b) => b.own || b.start !== undefined || Math.abs(b.saldo) > 0.004).map((b) => (
                            <div key={"og-" + b.sid + "|" + b.conto} className="flex items-center gap-2 bg-wash/40 px-3 py-1 text-xs text-dim">
                              <span className="truncate pl-9">{contoLabel(b.conto, b.sid || undefined)}</span>
                              <span className="ml-auto font-mono" style={{ color: b.saldo < 0 ? "var(--err)" : undefined }}>{eur(b.saldo)}</span>
                            </div>
                          ))}
                        </div>
                );
                // «Oggi»: sempre la PRIMA riga del registro (poi tutto il resto), con il dettaglio dei saldi dei conti
                let oggiPlaced = false; // «Dal» scelto nel passato: la riga «Oggi» sta tra i movimenti fino a oggi e quelli dopo
                const withDividers = els.flatMap((el, i) => {
                  const parts: React.ReactNode[] = [];
                  const d = rowDate(listRows[i]);
                  if (openFrom && !oggiPlaced && d > today) { oggiPlaced = true; parts.push(oggiNode("oggi")); }
                  const y = d.slice(0, 4);
                  if (i > 0 && y !== rowDate(listRows[i - 1]).slice(0, 4)) parts.push(<div key={"anno-" + y + "-" + i} className="flex items-center gap-3 border-t-4 border-[color:var(--focus)] bg-wash px-3 py-1.5"><span className="font-display text-sm font-bold tracking-wide text-txt">{y}</span><span className="h-px flex-1 bg-[color:var(--line)]" /></div>);
                  parts.push(el);
                  return parts;
                });
                if (listRows.length > 0) { if (openFrom) { if (!oggiPlaced) withDividers.push(oggiNode("oggi")); } else withDividers.unshift(oggiNode("oggi")); }
                return withDividers;
                })()}
              </div>
              </div>
              </div>
            )}
          </Card>
        <div className="flex flex-col gap-4">

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
                    <div key={`${rule.id}-${iso}`} className={"flex items-center gap-3 py-2.5" + (rule.variable ? " rounded px-2 bg-[color:color-mix(in_srgb,var(--warn)_12%,transparent)]" : "")}>
                      {iconCircle(c, 32)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-txt">{rule.desc}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                          <span className="rounded px-1.5 py-0.5 font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 18%, transparent)", color: "var(--warn)" }}>{t("SCADUTA")}</span>
                          <span className="text-faint">{fmtDate(iso)}</span>
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4 pt-[8dvh]">
          <button aria-label={t("Chiudi")} onClick={() => setOpening(null)} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <div role="dialog" aria-label={t("Saldo di partenza")} className="relative max-h-[84dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="text-base font-bold text-txt">{t("Saldo di partenza")}</div>
            <p className="mt-1 text-xs text-dim">{t("Scrivi quanto hai oggi su ogni conto. Da qui ogni saldo parte dal suo importo e si aggiorna con le entrate e le uscite dei giorni successivi: lo storico passato non serve. I conti lasciati vuoti non vengono toccati.")}</p>
            <p className="mt-1 text-[11px] text-faint">{t("★ = conto principale della struttura: qui arrivano i soldi delle prenotazioni dai portali. ↑ ↓ cambiano l'ordine dei conti.")}</p>
            {scopeStructs.map((s) => {
              const list = contiOf(s.id);
              const pr = principalOf(conti, prefs, s.id);
              const mv = moveCtx?.sid === s.id ? moveCtx : null;
              return (
                <div key={s.id} className="mt-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-semibold text-dim">{scopeStructs.length > 1 ? s.name : ""}</span>
                    <button type="button" onClick={() => setMoveCtx(mv ? null : { sid: s.id, from: "", to: "" })} className="shrink-0 text-[11px] font-medium text-focus hover:underline">{t("Sposta movimenti tra conti")}</button>
                  </div>
                  {mv && (() => {
                    const withItems = conti.filter((c) => countOnConto(manual, s.id, c.key) + countOnConto(rules, s.id, c.key) > 0);
                    return (
                      <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-line p-2 text-xs">
                        <select aria-label={t("Dal conto")} value={mv.from} onChange={(e) => setMoveCtx({ ...mv, from: e.target.value, to: mv.to === e.target.value ? "" : mv.to })} className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-txt outline-none focus:border-focus">
                          <option value="">{withItems.length ? t("Dal conto…") : t("Nessun movimento da spostare.")}</option>
                          {withItems.map((c) => <option key={c.key} value={c.key}>{contoDisplayLabel(c, conti, (id) => getStructure(id)?.name ?? "—")} ({countOnConto(manual, s.id, c.key) + countOnConto(rules, s.id, c.key)}){contoVisible(c, s.id) ? "" : " ⚠"}</option>)}
                        </select>
                        <span className="text-faint">→</span>
                        <select aria-label={t("Al conto")} value={mv.to} onChange={(e) => setMoveCtx({ ...mv, to: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-txt outline-none focus:border-focus">
                          <option value="">{t("Al conto…")}</option>
                          {list.filter((c) => c.key !== mv.from).map((c) => <option key={c.key} value={c.key}>{contoDisplayLabel(c, conti, (id) => getStructure(id)?.name ?? "—")}</option>)}
                        </select>
                        <button type="button" onClick={() => void moveStored()} disabled={!mv.from || !mv.to} className="shrink-0 rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Sposta")}</button>
                      </div>
                    );
                  })()}
                  <div className="flex flex-col gap-2">
                    {list.map((c) => {
                      const unassigned = !isContoAssigned(c);
                      const multi = allStructures.length > 1;
                      return (
                        <div key={c.key} className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => makePrincipal(s.id, c.key)} title={c.key === pr ? t("Conto principale: qui arrivano i soldi delle prenotazioni") : t("Imposta come conto principale (dove arrivano i soldi delle prenotazioni)")} aria-label={`${t("Conto principale")} ${c.label}`} className={`shrink-0 rounded p-0.5 text-sm leading-none ${c.key === pr ? "text-[color:var(--warn)]" : "text-faint hover:text-[color:var(--warn)]"}`}>{c.key === pr ? "★" : "☆"}</button>
                            {renaming?.key === c.key
                              ? <input autoFocus value={renaming.label} maxLength={30} onChange={(e) => setRenaming({ key: c.key, label: e.target.value })} onBlur={renameConto} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); renameConto(); } if (e.key === "Escape") setRenaming(null); }} className="w-32 shrink-0 rounded-lg border border-focus bg-paper px-2 py-1.5 text-sm text-txt outline-none" />
                              : <span className="w-32 shrink-0 truncate text-sm text-txt" title={t(c.label)}>{t(c.label)}</span>}
                            <input aria-label={`${t("Importo")} ${c.label}`} inputMode="decimal" value={amountOf(s.id, c.key)} onBlur={(e) => { const v = parseDecimalIT(e.target.value); if (v !== null) setAmount(s.id, c.key, formatDecimalIT(v)); }} onChange={(e) => setAmount(s.id, c.key, e.target.value)} placeholder="—" className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-right font-mono text-sm text-txt outline-none focus:border-focus" />
                            <span className="text-xs text-faint">€</span>
                            <button type="button" onClick={() => moveConto(s.id, c.key, -1)} disabled={list[0]?.key === c.key} title={t("Sposta su")} aria-label={`${t("Sposta su")} ${c.label}`} className="shrink-0 rounded p-0.5 text-faint hover:bg-wash hover:text-txt disabled:opacity-30">↑</button>
                            <button type="button" onClick={() => moveConto(s.id, c.key, 1)} disabled={list[list.length - 1]?.key === c.key} title={t("Sposta giù")} aria-label={`${t("Sposta giù")} ${c.label}`} className="shrink-0 rounded p-0.5 text-faint hover:bg-wash hover:text-txt disabled:opacity-30">↓</button>
                            <button type="button" onClick={() => setRenaming({ key: c.key, label: c.label })} title={t("Rinomina il conto")} aria-label={`${t("Rinomina")} ${c.label}`} className="shrink-0 rounded p-1 text-faint hover:bg-wash hover:text-txt">✎</button>
                            <button type="button" onClick={() => void deleteConto(c, s.id)} title={t("Elimina il conto")} aria-label={`${t("Elimina")} ${c.label}`} className="shrink-0 rounded p-1 text-faint hover:bg-wash hover:text-[color:var(--err)]">✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {scopeStructs.length === 1 && <div className="mt-3 border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <input value={opening.newName} onChange={(e) => setOpening((o) => (o ? { ...o, newName: e.target.value } : o))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addConto(); } }} placeholder={t("Nuovo conto (es. Revolut, Intesa…)")} maxLength={30} className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
                <button onClick={addConto} disabled={!opening.newName.trim()} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-focus hover:bg-wash disabled:opacity-50">{t("+ Aggiungi conto")}</button>
              </div>
            </div>}
            <label className="mt-3 block"><span className="text-xs text-dim">{t("Valido dal giorno")}</span>
              <DateField value={opening.date} onChange={(v) => setOpening((o) => (o ? { ...o, date: v } : o))} className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4 pt-[6dvh]">
          <button aria-label={t("Chiudi")} onClick={() => setPayoutModal(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-2xl">
            <div className="mb-1 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{t("Impostazioni incassi")}</h2><button onClick={() => setPayoutModal(false)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <p className="mb-2 text-xs text-dim">{t("Quando ogni portale ti paga: Cassa registra l'incasso nel giorno in cui arriva sul conto e, per i bonifici, riunisce le prenotazioni dello stesso pagamento.")}</p>
            {scopeStructs.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {scopeStructs.map((x) => <button key={x.id} type="button" onClick={() => setPayoutStruct(x.id)} aria-pressed={payoutSid === x.id} className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${payoutSid === x.id ? "border-transparent bg-focus text-white" : "border-line text-dim hover:bg-wash"}`}>{x.name}</button>)}
              </div>
            )}
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="hidden grid-cols-[132px_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 border-b border-line bg-wash px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint md:grid"><span>{t("Portale")}</span><span>{t("Quando arriva il pagamento")}</span><span>{t("Commissioni")}</span></div>
              {PAYOUT_CHANNELS.map((ch) => {
                const rule = payoutsOfModal[ch] ?? { mode: "arrival" as PayoutMode };
                const wd = rule.weekday ?? 4, md = rule.monthDay ?? 1, dd = rule.days ?? 0;
                const tip = rule.mode === "arrival" ? t("I soldi risultano incassati il giorno dell'arrivo.")
                  : rule.mode === "checkout" ? (dd ? `${t("Incasso")} ${dd} ${t("giorni dopo il check-out dell'ospite (es. carta virtuale).")}` : t("Incasso il giorno del check-out (es. carta virtuale)."))
                  : rule.mode === "weekly" ? `${t("Un unico bonifico ogni")} ${t(WEEKDAY_LABELS[wd]).toLowerCase()}: ${t("copre i check-out dal")} ${t(WEEKDAY_LABELS[wd]).toLowerCase()} ${t("della settimana prima al giorno precedente.")}`
                  : `${t("Un unico bonifico il")} ${md} ${t("del mese successivo: copre tutti i check-out del mese, dal 1 all'ultimo giorno.")}`;
                const tipFull = rule.commission ? `${tip} ${t("Le commissioni sono trattenute tutte insieme il")} ${rule.commission.day} ${t("del mese dopo, per le prenotazioni con check-out del mese precedente.")}` : tip;
                return (
                  <div key={ch} title={tipFull} className="grid grid-cols-1 gap-x-3 gap-y-1.5 border-b border-line px-3 py-2.5 last:border-b-0 md:grid-cols-[132px_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
                    <div className="flex shrink-0 items-center gap-2 md:min-h-[34px]"><ChannelLogo channel={ch} size={20} title={CHANNELS[ch].label} /><span className="truncate text-sm font-semibold text-txt">{CHANNELS[ch].label}</span></div>
                    <div className="flex flex-wrap items-center gap-1.5">
                    <select aria-label={t("Quando arriva il pagamento")} value={rule.mode} onChange={(e) => setPayoutRule(ch, { mode: e.target.value })} className="w-full max-w-[210px] rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">
                      <option value="arrival">{t("Alla data di arrivo")}</option>
                      <option value="checkout">{t("Dopo il check-out (carta virtuale)")}</option>
                      <option value="weekly">{t("Bonifico settimanale")}</option>
                      <option value="monthly">{t("Bonifico mensile")}</option>
                    </select>
                    {rule.mode === "checkout" && <span className="flex items-center gap-1.5 text-xs text-dim"><input type="number" min={0} max={60} aria-label={t("Giorni dopo il check-out")} value={dd} onChange={(e) => setPayoutRule(ch, { days: Number(e.target.value) || 0 })} className="w-14 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />{t("giorni dopo")}</span>}
                    {rule.mode === "weekly" && <select aria-label={t("Giorno del bonifico")} value={wd} onChange={(e) => setPayoutRule(ch, { weekday: Number(e.target.value) })} className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">{WEEKDAY_LABELS.map((w, i) => <option key={w} value={i}>{t(w)}</option>)}</select>}
                    {rule.mode === "monthly" && <span className="flex items-center gap-1.5 text-xs text-dim">{t("il")}<input type="number" min={1} max={31} aria-label={t("Giorno del mese successivo")} value={md} onChange={(e) => setPayoutRule(ch, { monthDay: Number(e.target.value) || 1 })} className="w-14 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />{t("del mese dopo")}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
                      <span className="md:hidden">{t("Commissioni")}</span>
                      <select aria-label={t("Quando il portale trattiene le commissioni")} value={rule.commission ? "monthly" : "together"} onChange={(e) => setPayoutRule(ch, { commission: e.target.value === "monthly" ? { mode: "monthly", day: rule.commission?.day ?? COMMISSION_DEFAULT_DAY } : undefined })} className="w-full max-w-[210px] rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus">
                        <option value="together">{t("Insieme all'incasso")}</option>
                        <option value="monthly">{t("Tutte insieme, il mese dopo")}</option>
                      </select>
                      {rule.commission && <span className="flex items-center gap-1.5" title={t("Un'unica trattenuta per le prenotazioni con check-out nello stesso mese (es. il 15 febbraio per quelle di gennaio). L'incasso resta per intero.")}>{t("il")}<input type="number" min={1} max={COMMISSION_MAX_DAY} aria-label={t("Giorno del mese dopo")} value={rule.commission.day} onChange={(e) => setPayoutRule(ch, { commission: { mode: "monthly", day: Math.min(COMMISSION_MAX_DAY, Math.max(1, Math.round(Number(e.target.value)) || 1)) } })} className="w-14 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-txt outline-none focus:border-focus" />{t("del mese dopo")}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setPayoutModal(false)} className="mt-3 w-full rounded-lg bg-focus py-1.5 text-sm font-semibold text-white hover:opacity-90">{t("Fatto")}</button>
          </div>
        </div>
      )}

      {/* --- Modale modifica movimento --- */}
      {editingMov && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4 pt-[6dvh]">
          <button aria-label={t("Chiudi")} onClick={resetForm} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{editingMov === NEW_MOV ? t("Nuovo movimento") : editingMov === OCC_MOV ? t("Modifica scadenza") : t("Modifica movimento")}</h2><button onClick={resetForm} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            {editingMov === NEW_MOV && (
              <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-wash p-1">
                {([["mov", t("Movimento")], ["prog", `${t("Pagamenti programmati")} (${rules.filter((r) => ruleVisible(r.structureId)).length})`]] as ["mov" | "prog", string][]).map(([k, lab]) => (
                  <button key={k} onClick={() => setMovTab(k)} className={`rounded-md py-1.5 text-sm font-semibold transition ${movTab === k ? "bg-surface text-txt shadow-sm" : "text-dim hover:text-txt"}`}>{lab}</button>
                ))}
              </div>
            )}
            {editingMov === NEW_MOV && movTab === "prog" ? (
              <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-faint">{t("Pagamenti programmati")}</div>
                <button onClick={() => { resetForm(); openNewRule(); }} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-focus hover:bg-wash">＋ {t("Aggiungi")}</button>
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
                        <div key={r.id} className={"flex items-center gap-3 py-2.5" + (r.variable ? " rounded px-2 bg-[color:color-mix(in_srgb,var(--warn)_12%,transparent)]" : "")}>
                          <button type="button" onClick={() => { resetForm(); openEditRule(r); }} title={t("Modifica")} className="flex min-w-0 flex-1 items-center gap-3 rounded text-left hover:bg-wash">
                          {iconCircle(c, 32)}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-txt">{r.desc}</span>
                              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={r.auto ? { backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" } : { backgroundColor: "var(--wash)", color: "var(--dim)" }}>{r.variable ? t("variabile") : r.auto ? t("auto") : t("manuale")}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-faint">{t(FREQ[r.freq])}{r.freq === "monthly" ? ` · ${t("il")} ${r.day}` : ""}{r.end ? ` · ${t("fino al")} ${fmtDate(r.end)}` : ""}{next ? ` · ${t("prossima")} ${fmtDM(next)}` : ""}</div>
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
  
              </div>
            ) : (
            <>
            {editingMov === OCC_MOV && <p className="mb-3 -mt-1 text-xs text-dim">{t("La modifica vale solo per questa scadenza: il pagamento programmato resta uguale per le altre.")}</p>}
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button onClick={() => setKind("out")} disabled={editingMov === OCC_MOV} className={`rounded-lg border py-2 text-sm font-semibold transition disabled:opacity-60 ${form.kind === "out" ? "border-[color:var(--err)] text-[color:var(--err)]" : "border-line text-dim hover:bg-wash"}`}>− {t("Uscita")}</button>
              <button onClick={() => setKind("in")} disabled={editingMov === OCC_MOV} className={`rounded-lg border py-2 text-sm font-semibold transition disabled:opacity-60 ${form.kind === "in" ? "border-[color:var(--ok)] text-[color:var(--ok)]" : "border-line text-dim hover:bg-wash"}`}>+ {t("Entrata")}</button>
            </div>
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Importo (€)")}</span><input inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0,00" className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-lg text-txt outline-none focus:border-focus" /></label>
            <div className="mb-2 block">
              <span className="text-xs text-dim">{t("Categoria")}</span>
              <button onClick={() => { setCatFor("form"); setCatPicker(true); }} className="mt-0.5 flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-2 py-1.5 text-left text-sm text-txt hover:bg-wash">
                {iconCircle(selCat, 28)}<span className="flex-1 font-medium">{selCat?.label ? t(selCat.label) : t("Scegli…")}</span><span className="text-faint">▾</span>
              </button>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-dim">{t("Conto")}</span><select value={form.conto} onChange={(e) => setForm((f) => ({ ...f, conto: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">{contoOptions(form.struttura, form.conto).map((c) => <option key={c.key} value={c.key}>{contoOptLabel(c, form.struttura)}</option>)}</select></label>
              <label className="block"><span className="text-xs text-dim">{t("Data")}</span><DateField value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            </div>
            {!singleSid && <label className="mb-2 block"><span className="text-xs text-dim">{t("Struttura")} *</span><select value={form.struttura} onChange={(e) => setForm((f) => ({ ...f, struttura: e.target.value }))} className={"mt-0.5 w-full rounded-lg border bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus " + (form.struttura ? "border-line" : "border-[color:var(--warn)]")}><option value="">{t("Scegli la struttura…")}</option>{form.struttura === "all" && <option value="all">{t("Comune (tutte)")}</option>}{structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
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
            {editingMov && editingMov !== NEW_MOV && editingMov !== OCC_MOV && receiptOf.get(editingMov) && <button type="button" onClick={() => void openRcpt(receiptOf.get(editingMov)!.path)} className="mb-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-sm font-medium text-txt hover:bg-wash"><Icon name="receipt" size={14} /> {t("Apri scontrino")}</button>}
            <button onClick={add} className="w-full rounded-lg bg-focus py-2 text-sm font-semibold text-white hover:opacity-90">{editingMov === NEW_MOV ? (form.repeat === "once" ? t("Registra movimento") : t("Registra e programma")) : t("Salva modifiche")}</button>
            {editingMov === OCC_MOV && occCtx && (
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <button onClick={() => { const r = rules.find((x) => x.id === occCtx.ruleId); resetForm(); if (r) openEditRule(r); }} className="rounded-lg border border-line py-2 text-sm font-medium text-dim hover:bg-wash">{t("Modifica la regola")}</button>
                <button onClick={resetOcc} disabled={overrides[occCtx.key] == null} className="rounded-lg border border-line py-2 text-sm font-medium text-dim hover:bg-wash disabled:opacity-40">{t("Ripristina originale")}</button>
              </div>
            )}
            {editingMov !== NEW_MOV && editingMov !== OCC_MOV && <button onClick={() => { const id = editingMov; resetForm(); void del(id); }} className="mt-1.5 w-full rounded-lg border border-line py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina movimento")}</button>}
            </>
            )}
          </div>
        </div>
      )}
      {catPicker && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[8dvh]">
          <button aria-label={t("Chiudi")} onClick={() => { setCatPicker(false); setNewCat(null); }} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{t("Categorie")} {(catFor === "rule" ? rf.kind : form.kind) === "in" ? t("entrata") : t("uscita")}</h2><button onClick={() => { setCatPicker(false); setNewCat(null); }} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="grid grid-cols-3 gap-2">
              {cats.filter((c) => c.kind === (catFor === "rule" ? rf.kind : form.kind) && !c.auto).map((c) => (
                <button key={c.key} onClick={() => { if (catFor === "rule") setRf((f) => ({ ...f, cat: c.key })); else setForm((f) => ({ ...f, cat: c.key })); setCatPicker(false); }} className={`group relative flex flex-col items-center gap-1.5 rounded-xl border p-3 transition hover:bg-wash ${(catFor === "rule" ? rf.cat : form.cat) === c.key ? "border-focus ring-1 ring-[color:var(--focus)]" : "border-line"}`}>
                  {iconCircle(c, 40)}
                  <span className="text-center text-[11px] font-medium leading-tight text-txt">{t(c.label)}</span>
                  {c.custom && <span onClick={(e) => { e.stopPropagation(); deleteCat(c.key); }} title={t("Elimina categoria")} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-wash text-[10px] text-faint [@media(hover:hover)]:hidden [@media(hover:hover)]:group-hover:grid hover:text-[color:var(--err)]">✕</span>}
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4 pt-[8dvh]">
          <button aria-label={t("Chiudi")} onClick={closeRuleModal} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[84dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
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
                <label className="block"><span className="text-xs text-dim">{t("Data inizio")}</span><DateField value={rf.start} onChange={(v) => setRf((f) => ({ ...f, start: v }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
              )}
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-dim">{t("Conto")}</span><select value={rf.conto} onChange={(e) => setRf((f) => ({ ...f, conto: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">{contoOptions(rf.struttura, rf.conto).map((c) => <option key={c.key} value={c.key}>{contoOptLabel(c, rf.struttura)}</option>)}</select></label>
              {!singleSid && <label className="block"><span className="text-xs text-dim">{t("Struttura")} *</span><select value={rf.struttura} onChange={(e) => setRf((f) => ({ ...f, struttura: e.target.value }))} className={"mt-0.5 w-full rounded-lg border bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus " + (rf.struttura ? "border-line" : "border-[color:var(--warn)]")}><option value="">{t("Scegli la struttura…")}</option>{rf.struttura === "all" && <option value="all">{t("Comune (tutte)")}</option>}{structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
            </div>
            {rf.freq === "monthly" && <label className="mb-2 block"><span className="text-xs text-dim">{t("A partire da")}</span><DateField value={rf.start} onChange={(v) => setRf((f) => ({ ...f, start: v }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>}
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Termina ripetizione")}</span><DateField value={rf.end} onChange={(v) => setRf((f) => ({ ...f, end: v }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /><span className="mt-0.5 block text-[11px] text-faint">{t("Lascia vuoto per «Mai».")}</span></label>
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
