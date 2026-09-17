"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import ExportMenu from "@/components/ExportMenu";
import { exportExcel, exportPdf } from "@/lib/export";
import CatIcon, { ICON_KEYS } from "@/components/CatIcon";
import Icon from "@/components/Icon";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/authsync";
import { type Kind, type Mov, type Rule, computeAuto, computeScheduled, occurrences, scopeVisible, loadCash, insertMovement, deleteMovement, insertRule, deleteRule, addPaid, migrateLocalCash } from "@/lib/cassa";

// ---- Conti cassa ------------------------------------------------------------
const CONTI = [
  { key: "contanti", label: "Contanti" },
  { key: "banca", label: "Banca" },
  { key: "paypal", label: "PayPal" },
  { key: "carta", label: "Carta / POS" },
] as const;

// ---- Categorie (entrate / uscite) ------------------------------------------
interface Cat { key: string; label: string; kind: Kind; color: string; icon: string; auto?: boolean; custom?: boolean }
const DEFAULT_CATS: Cat[] = [
  // Entrate
  { key: "prenotazioni", label: "Prenotazioni", kind: "in", color: "#0E9F6E", icon: "bed", auto: true },
  { key: "extra", label: "Extra / Colazione", kind: "in", color: "#16A34A", icon: "coffee" },
  { key: "altro_in", label: "Altra entrata", kind: "in", color: "#65A30D", icon: "cash" },
  // Uscite
  { key: "commissioni", label: "Commissioni OTA", kind: "out", color: "#DC2626", icon: "percent", auto: true },
  { key: "pulizie", label: "Pulizie", kind: "out", color: "#EA580C", icon: "sparkles" },
  { key: "utenze", label: "Utenze", kind: "out", color: "#D97706", icon: "bolt" },
  { key: "manutenzione", label: "Manutenzione", kind: "out", color: "#CA8A04", icon: "wrench" },
  { key: "forniture", label: "Forniture", kind: "out", color: "#9333EA", icon: "cart" },
  { key: "tasse", label: "Tasse e imposte", kind: "out", color: "#7C3AED", icon: "file" },
  { key: "personale", label: "Personale", kind: "out", color: "#2563EB", icon: "users" },
  { key: "marketing", label: "Marketing", kind: "out", color: "#0891B2", icon: "megaphone" },
  { key: "affitto", label: "Affitto / Mutuo", kind: "out", color: "#DB2777", icon: "home" },
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

// Grafico a ciambella (torta) per la composizione delle uscite.
function Donut({ data, center, size = 148 }: { data: { label: string; value: number; color: string }[]; center?: string; size?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = 42, C = 2 * Math.PI * r, cx = 50, cy = 50;
  let acc = 0;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--wash)" strokeWidth="15" />
      {total > 0 && data.map((d, i) => {
        const frac = d.value / total;
        const seg = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth="15" strokeLinecap="butt" strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C} transform={`rotate(-90 ${cx} ${cy})`} />;
        acc += frac;
        return seg;
      })}
      {center && <text x="50" y="52" textAnchor="middle" className="fill-[color:var(--txt)]" style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono, monospace)" }}>{center}</text>}
    </svg>
  );
}

export default function CassaPage() {
  const { bookings, guests, structures, activeStructureId, getStructure } = useData();
  const ask = useConfirm();
  const { t } = useLang();
  const { user } = useAuth();

  // Categorie (default + personalizzate).
  const [cats, setCats] = useState<Cat[]>(DEFAULT_CATS);
  useEffect(() => { try { const r = localStorage.getItem(CATS_KEY); if (r) { const saved = JSON.parse(r); const customs = saved.filter((c: Cat) => c.custom); setCats([...DEFAULT_CATS, ...customs]); } } catch {} }, []);
  const saveCats = (list: Cat[]) => { setCats(list); try { localStorage.setItem(CATS_KEY, JSON.stringify(list.filter((c) => c.custom))); } catch {} };
  const catOf = (k: string) => cats.find((c) => c.key === k);

  // Movimenti manuali, regole ricorrenti e occorrenze saldate — su Supabase (non più localStorage).
  const [manual, setManual] = useState<Mov[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [paid, setPaid] = useState<string[]>([]);
  const paidSet = useMemo(() => new Set(paid), [paid]);
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
  const auto = useMemo<Mov[]>(() => computeAuto(bookings, guests, getStructure, activeStructureId), [bookings, guests, activeStructureId, getStructure]);
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
  const markPaid = (r: Rule, iso: string) => { const k = `${r.id}|${iso}`; setPaid((p) => [...p, k]); if (user) addPaid(user.id, [k]); };
  const markAllPaid = () => { const keys = pending.map((p) => `${p.rule.id}|${p.iso}`); setPaid((p) => [...p, ...keys]); if (user) addPaid(user.id, keys); };

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
  const months = useMemo(() => { const s = new Set(all.map((m) => monthKey(m.date))); s.add(monthKey(today)); return Array.from(s).sort().reverse(); }, [all, today]);
  const [month, setMonth] = useState<string>("all");
  const [chartsOn, setChartsOn] = useState(true);
  useEffect(() => { try { const r = localStorage.getItem("spigolestay:cassacharts:on"); if (r !== null) setChartsOn(r === "1"); } catch {} }, []);
  const toggleCharts = () => setChartsOn((v) => { const n = !v; try { localStorage.setItem("spigolestay:cassacharts:on", n ? "1" : "0"); } catch {} return n; });

  const rows = all.filter((m) => month === "all" || monthKey(m.date) === month);
  const entrate = rows.filter((m) => m.kind === "in").reduce((a, m) => a + m.amount, 0);
  const uscite = rows.filter((m) => m.kind === "out").reduce((a, m) => a + m.amount, 0);
  const saldo = entrate - uscite;

  const saldoConti = useMemo(() => { const map: Record<string, number> = {}; for (const m of all) map[m.conto] = (map[m.conto] ?? 0) + (m.kind === "in" ? m.amount : -m.amount); return map; }, [all]);
  const saldoTot = Object.values(saldoConti).reduce((a, v) => a + v, 0);

  const perCat = useMemo(() => { const map: Record<string, number> = {}; for (const m of rows) if (m.kind === "out") map[m.cat] = (map[m.cat] ?? 0) + m.amount; return Object.entries(map).map(([k, v]) => ({ cat: catOf(k), v })).filter((x) => x.cat).sort((a, b) => b.v - a.v); }, [rows]);
  const maxCat = Math.max(1, ...perCat.map((x) => x.v));

  const trend = useMemo(() => {
    const base = month === "all" ? monthKey(today) : month;
    const [by, bm] = base.split("-").map(Number);
    const list: { ym: string; in: number; out: number }[] = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(by, bm - 1 - i, 1); const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; const mm = all.filter((m) => monthKey(m.date) === ym); list.push({ ym, in: mm.filter((m) => m.kind === "in").reduce((a, m) => a + m.amount, 0), out: mm.filter((m) => m.kind === "out").reduce((a, m) => a + m.amount, 0) }); }
    return list;
  }, [all, month, today]);
  const maxTrend = Math.max(1, ...trend.flatMap((t) => [t.in, t.out]));

  // ---- Form nuovo movimento -------------------------------------------------
  const [form, setForm] = useState<{ kind: Kind; date: string; cat: string; desc: string; amount: string; conto: string; struttura: string; repeat: "once" | "monthly" | "weekly" | "yearly" }>(() => ({ kind: "out", date: todayISO(), cat: "pulizie", desc: "", amount: "", conto: "contanti", struttura: activeStructureId, repeat: "once" }));
  const setKind = (k: Kind) => setForm((f) => ({ ...f, kind: k, cat: cats.find((c) => c.kind === k && !c.auto)!.key }));
  const add = () => {
    const amt = Math.round(parseFloat(form.amount.replace(",", ".")) || 0);
    if (amt <= 0) return;
    const desc = form.desc.trim() || catOf(form.cat)?.label || "";
    const mov: Mov = { id: uid(), date: form.date, kind: form.kind, cat: form.cat, desc, amount: amt, conto: form.conto, structureId: form.struttura };
    setManual((prev) => [mov, ...prev]);
    if (user) insertMovement(user.id, mov);
    // Ricorrente: crea la regola che riparte dal periodo SUCCESSIVO (questo è già registrato come movimento).
    if (form.repeat !== "once") {
      const d = new Date(form.date);
      if (form.repeat === "monthly") d.setMonth(d.getMonth() + 1);
      else if (form.repeat === "weekly") d.setDate(d.getDate() + 7);
      else d.setFullYear(d.getFullYear() + 1);
      const nextStart = fmt(d.getFullYear(), d.getMonth(), d.getDate());
      const rule: Rule = { id: uid(), kind: form.kind, cat: form.cat, desc, amount: amt, conto: form.conto, structureId: form.struttura, freq: form.repeat, day: parseInt(form.date.slice(8, 10)) || 1, start: nextStart, auto: true };
      setRules((prev) => [...prev, rule]);
      if (user) insertRule(user.id, rule);
    }
    setForm((f) => ({ ...f, desc: "", amount: "", repeat: "once" }));
  };
  const del = async (id: string) => { if (!(await ask({ message: t("Eliminare questo movimento?"), danger: true, confirmLabel: t("Elimina") }))) return; setManual((prev) => prev.filter((m) => m.id !== id)); deleteMovement(id); };

  // ---- Modale selezione/gestione categorie ----------------------------------
  const [catPicker, setCatPicker] = useState(false);
  const [newCat, setNewCat] = useState<{ label: string; color: string; icon: string } | null>(null);
  const openNewCat = () => setNewCat({ label: "", color: PALETTE[8], icon: "star" });
  const createCat = () => {
    if (!newCat || !newCat.label.trim()) return;
    const key = `c-${uid().slice(0, 8)}`;
    const cat: Cat = { key, label: newCat.label.trim(), kind: form.kind, color: newCat.color, icon: newCat.icon, custom: true };
    saveCats([...cats, cat]);
    setForm((f) => ({ ...f, cat: key }));
    setNewCat(null);
  };
  const deleteCat = async (key: string) => { if (!(await ask({ message: t("Eliminare questa categoria?"), danger: true, confirmLabel: t("Elimina") }))) return; saveCats(cats.filter((c) => c.key !== key)); if (form.cat === key) setForm((f) => ({ ...f, cat: cats.find((c) => c.kind === f.kind && !c.auto && c.key !== key)!.key })); };

  // ---- Modale pagamento programmato -----------------------------------------
  const [ruleModal, setRuleModal] = useState(false);
  const [rf, setRf] = useState<{ kind: Kind; cat: string; desc: string; amount: string; conto: string; struttura: string; freq: Rule["freq"]; day: string; start: string; auto: boolean; end: string; note?: string }>(() => ({ kind: "out", cat: "affitto", desc: "", amount: "", conto: "banca", struttura: activeStructureId, freq: "monthly", day: "1", start: todayISO(), auto: true, end: "", note: "" }));
  const rfCats = cats.filter((c) => c.kind === rf.kind && !c.auto);
  const addRule = () => {
    const amt = Math.round(parseFloat(rf.amount.replace(",", ".")) || 0);
    if (amt <= 0) return;
    const rule: Rule = { id: uid(), kind: rf.kind, cat: rf.cat, desc: rf.desc.trim() || catOf(rf.cat)?.label || "", amount: amt, conto: rf.conto, structureId: rf.struttura, freq: rf.freq, day: parseInt(rf.day) || 1, start: rf.start, auto: rf.auto, end: rf.end || undefined, note: rf.note?.trim() || undefined };
    setRules((prev) => [...prev, rule]);
    if (user) insertRule(user.id, rule);
    setRuleModal(false);
    setRf((f) => ({ ...f, desc: "", amount: "" }));
  };
  const delRule = async (id: string) => { if (!(await ask({ message: t("Eliminare questo pagamento programmato?"), danger: true, confirmLabel: t("Elimina") }))) return; setRules((prev) => prev.filter((r) => r.id !== id)); deleteRule(id); };
  const monthlyRecurring = rules.filter((r) => r.freq === "monthly" && ruleVisible(r.structureId)).reduce((a, r) => a + (r.kind === "out" ? r.amount : -r.amount), 0);

  const selCat = catOf(form.cat);
  const structNameOf = (id?: string) => (!id || id === "all" ? t("Tutte") : getStructure(id)?.name ?? "—");

  // ---- Export ---------------------------------------------------------------
  const periodLabel = month === "all" ? "storico" : month;
  const doExcel = () => {
    const headers = [t("Data"), t("Tipo"), t("Categoria"), t("Descrizione"), t("Conto"), t("Struttura"), `${t("Entrata")} €`, `${t("Uscita")} €`];
    const body = rows.map((m) => [m.date, m.kind === "in" ? t("Entrata") : t("Uscita"), catOf(m.cat)?.label ? t(catOf(m.cat)!.label) : m.cat, m.desc + (m.sched ? ` (${t("programmato")})` : m.auto ? ` (${t("auto")})` : ""), CONTI.find((x) => x.key === m.conto)?.label ? t(CONTI.find((x) => x.key === m.conto)!.label) : m.conto, structNameOf(m.structureId), m.kind === "in" ? m.amount : "", m.kind === "out" ? m.amount : ""]);
    body.push(["", "", "", "", "", t("TOTALI"), entrate, uscite]);
    body.push(["", "", "", "", "", t("SALDO"), saldo, ""]);
    exportExcel(`cassa-${periodLabel}`, headers, body);
  };

  const structLabel = activeStructureId === "all" ? t("tutte le strutture") : getStructure(activeStructureId)?.name ?? "";
  const iconCircle = (c?: Cat, size = 34) => (
    <span className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, backgroundColor: `color-mix(in srgb, ${c?.color ?? "#888"} 16%, transparent)`, color: c?.color ?? "#888" }}>
      <CatIcon name={c?.icon} size={size * 0.52} />
    </span>
  );

  return (
    <div>
      <PageHeader title={t("Cassa · Prima Nota")} subtitle={t("Entrate e uscite, saldo e analisi della cassa")} />

      {/* Riepilogo */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="!p-4"><div className="text-xs font-medium text-dim">{t("Saldo cassa")}</div><div className={`mt-1 font-mono text-2xl font-bold ${saldoTot >= 0 ? "text-txt" : "text-[color:var(--err)]"}`}>{eur(saldoTot)}</div><div className="mt-1 text-[11px] text-faint">{t("tutti i conti · storico")}</div></Card>
        <Card className="!p-4"><div className="text-xs font-medium text-dim">{t("Entrate")} {month === "all" ? t("totali") : t("del mese")}</div><div className="mt-1 font-mono text-2xl font-bold" style={{ color: "var(--ok)" }}>{eur(entrate)}</div><div className="mt-1 text-[11px] text-faint">{rows.filter((m) => m.kind === "in").length} {t("movimenti")}</div></Card>
        <Card className="!p-4"><div className="text-xs font-medium text-dim">{t("Uscite")} {month === "all" ? t("totali") : t("del mese")}</div><div className="mt-1 font-mono text-2xl font-bold" style={{ color: "var(--err)" }}>{eur(uscite)}</div><div className="mt-1 text-[11px] text-faint">{rows.filter((m) => m.kind === "out").length} {t("movimenti")}</div></Card>
        <Card className="!p-4"><div className="text-xs font-medium text-dim">{t("Saldo")} {month === "all" ? t("totale") : t("del mese")}</div><div className={`mt-1 font-mono text-2xl font-bold ${saldo >= 0 ? "text-txt" : "text-[color:var(--err)]"}`}>{eur(saldo)}</div><div className="mt-1 text-[11px] text-faint">{t("entrate − uscite")}</div></Card>
      </div>

      {chartsOn && (
      <div className="mb-4 grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <SectionTitle>{t("Composizione uscite")}</SectionTitle>
          {perCat.length === 0 ? <div className="grid h-[160px] place-items-center text-sm text-faint">{t("Nessuna uscita nel periodo")}</div> : (
            <div className="flex items-center gap-4">
              <Donut data={perCat.map((x) => ({ label: x.cat!.label, value: x.v, color: x.cat!.color }))} center={uscite >= 1000 ? `${(uscite / 1000).toFixed(1)}k` : `${uscite}`} />
              <div className="flex flex-col gap-1">
                {perCat.slice(0, 6).map(({ cat, v }) => (
                  <div key={cat!.key} className="flex items-center gap-1.5 text-xs"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat!.color }} /><span className="text-dim">{t(cat!.label)}</span><span className="ml-2 font-mono text-faint">{Math.round((v / uscite) * 100)}%</span></div>
                ))}
                {perCat.length > 6 && <div className="text-[11px] text-faint">+{perCat.length - 6} {t("altre")}</div>}
              </div>
            </div>
          )}
        </Card>
        <Card className="lg:col-span-3">
          <SectionTitle>{t("Andamento ultimi 12 mesi")}</SectionTitle>
          <div className="flex items-end justify-between gap-2 pt-2" style={{ height: 160 }}>
            {trend.map((tr) => (
              <div key={tr.ym} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end justify-center gap-1.5" style={{ height: 120 }}>
                  <div className="w-1/3 max-w-[26px] rounded-t" title={`${t("Entrate")} ${eur(tr.in)}`} style={{ height: `${(tr.in / maxTrend) * 100}%`, backgroundColor: "var(--ok)", minHeight: tr.in > 0 ? 3 : 0 }} />
                  <div className="w-1/3 max-w-[26px] rounded-t" title={`${t("Uscite")} ${eur(tr.out)}`} style={{ height: `${(tr.out / maxTrend) * 100}%`, backgroundColor: "var(--err)", minHeight: tr.out > 0 ? 3 : 0 }} />
                </div>
                <span className="text-[10px] capitalize text-faint">{monthLabel(tr.ym).split(" ")[0].slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-dim"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--ok)" }} />{t("Entrate")}</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--err)" }} />{t("Uscite")}</span></div>
        </Card>
      </div>
      )}

      {/* Riga filtri + toggle grafici + Esporta */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <button onClick={() => setMonth("all")} className={`rounded-full px-3 py-1 text-xs font-medium transition ${month === "all" ? "bg-focus text-white" : "border border-line text-dim hover:bg-wash"}`}>{t("Tutto lo storico")}</button>
        {months.map((ym) => <button key={ym} onClick={() => setMonth(ym)} className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${month === ym ? "bg-focus text-white" : "border border-line text-dim hover:bg-wash"}`}>{monthLabel(ym)}</button>)}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggleCharts} title={chartsOn ? t("Nascondi i grafici") : t("Mostra i grafici")} className={`grid h-8 w-8 place-items-center rounded-lg border transition ${chartsOn ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] text-focus" : "border-line text-dim hover:bg-wash hover:text-txt"}`}><Icon name="chart" size={15} /></button>
          <span className="rounded-full bg-wash px-3 py-1 text-xs text-dim">{structLabel}</span>
          <ExportMenu onExcel={doExcel} onPdf={exportPdf} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Colonna sinistra */}
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("Nuovo movimento")}</SectionTitle>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button onClick={() => setKind("out")} className={`rounded-lg border py-2 text-sm font-semibold transition ${form.kind === "out" ? "border-[color:var(--err)] text-[color:var(--err)]" : "border-line text-dim hover:bg-wash"}`}>− {t("Uscita")}</button>
              <button onClick={() => setKind("in")} className={`rounded-lg border py-2 text-sm font-semibold transition ${form.kind === "in" ? "border-[color:var(--ok)] text-[color:var(--ok)]" : "border-line text-dim hover:bg-wash"}`}>+ {t("Entrata")}</button>
            </div>
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Importo (€)")}</span><input inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0,00" className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-lg text-txt outline-none focus:border-focus" /></label>
            <div className="mb-2 block">
              <span className="text-xs text-dim">{t("Categoria")}</span>
              <button onClick={() => setCatPicker(true)} className="mt-0.5 flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-2 py-1.5 text-left text-sm text-txt hover:bg-wash">
                {iconCircle(selCat, 28)}<span className="flex-1 font-medium">{selCat?.label ? t(selCat.label) : t("Scegli…")}</span><span className="text-faint">▾</span>
              </button>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-dim">{t("Conto")}</span><select value={form.conto} onChange={(e) => setForm((f) => ({ ...f, conto: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">{CONTI.map((c) => <option key={c.key} value={c.key}>{t(c.label)}</option>)}</select></label>
              <label className="block"><span className="text-xs text-dim">{t("Data")}</span><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            </div>
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Struttura")}</span><select value={form.struttura} onChange={(e) => setForm((f) => ({ ...f, struttura: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus"><option value="all">{t("Tutte le strutture")}</option>{structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="mb-3 block"><span className="text-xs text-dim">{t("Descrizione (facoltativa)")}</span><input value={form.desc} onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))} placeholder={t("es. Bolletta Enel agosto")} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            <div className="mb-3">
              <span className="text-xs text-dim">{t("Si ripete?")}</span>
              <div className="mt-1 grid grid-cols-4 gap-1.5">
                {([["once", "Solo una volta"], ["monthly", "Ogni mese"], ["weekly", "Ogni settimana"], ["yearly", "Ogni anno"]] as [typeof form.repeat, string][]).map(([v, lab]) => (
                  <button key={v} type="button" onClick={() => setForm((f) => ({ ...f, repeat: v }))} className={`rounded-lg border px-1 py-1.5 text-[11px] font-semibold transition ${form.repeat === v ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{t(lab)}</button>
                ))}
              </div>
              {form.repeat !== "once" && <p className="mt-1 text-[11px] text-faint">{t("Registro questo movimento oggi e creo un pagamento programmato che si ripete da solo.")}</p>}
            </div>
            <button onClick={add} className="w-full rounded-lg bg-focus py-2 text-sm font-semibold text-white hover:opacity-90">{form.repeat === "once" ? t("Registra movimento") : t("Registra e programma")}</button>
          </Card>

          {/* Pagamenti programmati */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle>{t("Pagamenti programmati")}</SectionTitle>
              <button onClick={() => setRuleModal(true)} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-focus hover:bg-wash">＋ {t("Aggiungi")}</button>
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
                        {iconCircle(c, 32)}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-txt">{r.desc}</span>
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={r.auto ? { backgroundColor: "color-mix(in srgb, var(--ok) 14%, transparent)", color: "var(--ok)" } : { backgroundColor: "var(--wash)", color: "var(--dim)" }}>{r.auto ? t("auto") : t("manuale")}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-faint">{t(FREQ[r.freq])}{r.freq === "monthly" ? ` · ${t("il")} ${r.day}` : ""}{r.end ? ` · ${t("fino al")} ${new Date(r.end).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}` : ""}{next ? ` · ${t("prossima")} ${new Date(next).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}` : ""}</div>
                        </div>
                        <span className="shrink-0 font-mono text-sm font-semibold" style={{ color: r.kind === "in" ? "var(--ok)" : "var(--err)" }}>{r.kind === "in" ? "+" : "−"} {eur(r.amount)}</span>
                        <button onClick={() => delRule(r.id)} title={t("Elimina")} className="shrink-0 rounded p-1 text-faint hover:bg-wash hover:text-[color:var(--err)]">✕</button>
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
                <button onClick={markAllPaid} className="rounded-md px-2 py-1 text-xs font-semibold text-white" style={{ backgroundColor: "var(--ok)" }}>{t("Segna tutte pagate")}</button>
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
                      <span className="shrink-0 font-mono text-sm font-semibold" style={{ color: rule.kind === "in" ? "var(--ok)" : "var(--err)" }}>{rule.kind === "in" ? "+" : "−"} {eur(rule.amount)}</span>
                      <button onClick={() => markPaid(rule, iso)} className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ backgroundColor: "var(--ok)" }}>{t("Segna pagata")}</button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Uscite per categoria */}
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
        </div>

        {/* Colonna destra */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <div className="mb-3 flex items-center justify-between"><SectionTitle>{t("Movimenti")}</SectionTitle><span className="text-xs text-faint">{rows.length} {t("nel periodo")}</span></div>
            {rows.length === 0 ? <EmptyState title={t("Nessun movimento.")} /> : (
              <div className="-mx-1 max-h-[640px] overflow-y-auto px-1">
              <div className="flex flex-col divide-y divide-[color:var(--line)]">
                {rows.map((m) => {
                  const c = catOf(m.cat);
                  return (
                    <div key={m.id} className="flex items-center gap-3 py-2.5">
                      {iconCircle(c, 34)}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-txt">{m.desc}</span>
                          {m.auto && <span className="shrink-0 rounded bg-wash px-1.5 py-0.5 text-[10px] font-semibold text-faint">{t("auto")}</span>}
                          {m.sched && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>{t("programmato")}</span>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                          <span>{new Date(m.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</span>
                          <span>·</span><span>{c?.label ? t(c.label) : ""}</span>
                          <span>·</span><span className="capitalize">{(() => { const l = CONTI.find((x) => x.key === m.conto)?.label; return l ? t(l) : ""; })()}</span>
                          {m.structureId && m.structureId !== "all" && <><span>·</span><span>{structNameOf(m.structureId)}</span></>}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold" style={{ color: m.kind === "in" ? "var(--ok)" : "var(--err)" }}>{m.kind === "in" ? "+" : "−"} {eur(m.amount)}</span>
                      {!m.auto && !m.sched && <button onClick={() => del(m.id)} title={t("Elimina")} className="shrink-0 rounded p-1 text-faint hover:bg-wash hover:text-[color:var(--err)]">✕</button>}
                    </div>
                  );
                })}
              </div>
              </div>
            )}
            {rows.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                <div><div className="text-[11px] text-faint">{t("Entrate")}</div><div className="font-mono text-sm font-semibold" style={{ color: "var(--ok)" }}>+ {eur(entrate)}</div></div>
                <div><div className="text-[11px] text-faint">{t("Uscite")}</div><div className="font-mono text-sm font-semibold" style={{ color: "var(--err)" }}>− {eur(uscite)}</div></div>
                <div><div className="text-[11px] text-faint">{t("Saldo")}</div><div className={`font-mono text-sm font-bold ${saldo >= 0 ? "text-txt" : "text-[color:var(--err)]"}`}>{eur(saldo)}</div></div>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>{t("Saldo per conto")}</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CONTI.map((c) => <div key={c.key} className="rounded-lg border border-line p-3"><div className="text-xs text-dim">{t(c.label)}</div><div className={`mt-0.5 font-mono text-lg font-bold ${(saldoConti[c.key] ?? 0) >= 0 ? "text-txt" : "text-[color:var(--err)]"}`}>{eur(saldoConti[c.key] ?? 0)}</div></div>)}
            </div>
          </Card>
        </div>
      </div>

      <p className="mt-4 text-xs text-faint">{t("Le entrate")} <b className="text-dim">{t("Prenotazioni")}</b> {t("e le")} <b className="text-dim">{t("Commissioni OTA")}</b> {t("sono automatiche (badge «auto»). I")} <b className="text-dim">{t("Pagamenti programmati")}</b> {t("si registrano da soli ogni mese (badge «programmato»). Aggiungi manualmente le altre voci e crea le categorie che ti servono.")}</p>

      {/* --- Modale selezione / gestione categorie --- */}
      {catPicker && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
          <button aria-label={t("Chiudi")} onClick={() => { setCatPicker(false); setNewCat(null); }} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{t("Categorie")} {form.kind === "in" ? t("entrata") : t("uscita")}</h2><button onClick={() => { setCatPicker(false); setNewCat(null); }} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="grid grid-cols-3 gap-2">
              {cats.filter((c) => c.kind === form.kind && !c.auto).map((c) => (
                <button key={c.key} onClick={() => { setForm((f) => ({ ...f, cat: c.key })); setCatPicker(false); }} className={`group relative flex flex-col items-center gap-1.5 rounded-xl border p-3 transition hover:bg-wash ${form.cat === c.key ? "border-focus ring-1 ring-[color:var(--focus)]" : "border-line"}`}>
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
                <div className="mb-2 text-sm font-semibold text-txt">{t("Nuova categoria")} {form.kind === "in" ? t("entrata") : t("uscita")}</div>
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
          <button aria-label={t("Chiudi")} onClick={() => setRuleModal(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[84vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{t("Nuovo pagamento programmato")}</h2><button onClick={() => setRuleModal(false)} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button onClick={() => setRf((f) => ({ ...f, kind: "out", cat: cats.find((c) => c.kind === "out" && !c.auto)!.key }))} className={`rounded-lg border py-2 text-sm font-semibold ${rf.kind === "out" ? "border-[color:var(--err)] text-[color:var(--err)]" : "border-line text-dim"}`}>− {t("Uscita")}</button>
              <button onClick={() => setRf((f) => ({ ...f, kind: "in", cat: cats.find((c) => c.kind === "in" && !c.auto)!.key }))} className={`rounded-lg border py-2 text-sm font-semibold ${rf.kind === "in" ? "border-[color:var(--ok)] text-[color:var(--ok)]" : "border-line text-dim"}`}>+ {t("Entrata")}</button>
            </div>
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Descrizione")}</span><input value={rf.desc} onChange={(e) => setRf((f) => ({ ...f, desc: e.target.value }))} placeholder={t("es. Rata mutuo · Bolletta telefono")} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-dim">{t("Importo (€)")}</span><input inputMode="decimal" value={rf.amount} onChange={(e) => setRf((f) => ({ ...f, amount: e.target.value }))} placeholder="0,00" className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-txt outline-none focus:border-focus" /></label>
              <label className="block"><span className="text-xs text-dim">{t("Categoria")}</span><select value={rf.cat} onChange={(e) => setRf((f) => ({ ...f, cat: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus">{rfCats.map((c) => <option key={c.key} value={c.key}>{t(c.label)}</option>)}</select></label>
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
              <label className="block"><span className="text-xs text-dim">{t("Struttura")}</span><select value={rf.struttura} onChange={(e) => setRf((f) => ({ ...f, struttura: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm text-txt outline-none focus:border-focus"><option value="all">{t("Tutte")}</option>{structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            </div>
            {rf.freq === "monthly" && <label className="mb-2 block"><span className="text-xs text-dim">{t("A partire da")}</span><input type="date" value={rf.start} onChange={(e) => setRf((f) => ({ ...f, start: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>}
            <label className="mb-2 block"><span className="text-xs text-dim">{t("Termina ripetizione")}</span><input type="date" value={rf.end} onChange={(e) => setRf((f) => ({ ...f, end: e.target.value }))} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /><span className="mt-0.5 block text-[11px] text-faint">{t("Lascia vuoto per «Mai».")}</span></label>
            <label className="mb-3 block"><span className="text-xs text-dim">{t("Nota (facoltativa)")}</span><input value={rf.note ?? ""} onChange={(e) => setRf((f) => ({ ...f, note: e.target.value }))} placeholder={t("es. IBAN, numero pratica…")} className="mt-0.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" /></label>
            <button type="button" onClick={() => setRf((f) => ({ ...f, auto: !f.auto }))} className="mb-3 flex w-full items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left hover:bg-wash">
              <span><span className="text-sm font-medium text-txt">{t("Registrazione automatica")}</span><span className="mt-0.5 block text-[11px] text-faint">{rf.auto ? t("Alla scadenza il movimento si registra da solo.") : t("Alla scadenza dovrai confermarlo con «Segna come pagata».")}</span></span>
              <span className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: rf.auto ? "var(--ok)" : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: rf.auto ? "22px" : "2px" }} /></span>
            </button>
            <button onClick={addRule} className="w-full rounded-lg bg-focus py-2 text-sm font-semibold text-white hover:opacity-90">{t("Salva pagamento programmato")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
