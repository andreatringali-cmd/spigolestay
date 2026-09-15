"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { effectiveBase } from "@/lib/pricing";
import { eur } from "@/lib/format";
import { PageHeader, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";

const BOARDS = ["Solo pernottamento", "Colazione", "Mezza pensione", "Pensione completa"];
const DEPOSITS = [
  { id: "none", label: "Nessun anticipo" },
  { id: "deposit", label: "Acconto alla prenotazione" },
  { id: "prepaid", label: "Prepagato (100%)" },
] as const;
type DepositId = (typeof DEPOSITS)[number]["id"];

interface RatePlan {
  id: string; name: string; adjPct: number; refundable: boolean; board: string; minStay: number; enabled?: boolean;
  cancelDays?: number;          // giorni per cancellazione gratuita (se rimborsabile)
  deposit?: DepositId;          // politica di incasso
  depositPct?: number;          // % acconto se deposit = "deposit"
  dateFrom?: string; dateTo?: string; // intervallo temporale (vuoto = sempre)
  roomTypeIds?: string[];       // tipologie a cui si applica (assente/vuoto = tutte)
  description?: string;
}
// Set consigliato per un B&B (colazione sempre inclusa): base flessibile a 0%, non rimborsabile scontato, lunga permanenza.
const DEFAULT_PLANS: RatePlan[] = [
  { id: "flex", name: "Flessibile", adjPct: 0, refundable: true, board: "Colazione", minStay: 1, enabled: true, cancelDays: 3, deposit: "none", description: "Cancellazione gratuita fino a 3 giorni prima dell'arrivo. Colazione inclusa." },
  { id: "nonref", name: "Non rimborsabile", adjPct: -10, refundable: false, board: "Colazione", minStay: 1, enabled: true, deposit: "prepaid", description: "Tariffa scontata, pagamento immediato e non rimborsabile. Colazione inclusa." },
  { id: "long", name: "Lunga permanenza", adjPct: -12, refundable: true, board: "Colazione", minStay: 5, enabled: true, cancelDays: 7, deposit: "deposit", depositPct: 30, description: "Sconto per soggiorni di almeno 5 notti. Colazione inclusa." },
];
const PLANS_KEY = "spigolestay:rateplans";
const SEED_KEY = "spigolestay:rateplans:seed"; // marca l'avvenuta prima impostazione dei piani consigliati
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p-${Math.floor(performance.now() * 1000)}`);
const inp = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";
const lbl = "block text-xs font-medium text-dim";
const VIEW_KEY = "spigolestay:piani:view";

const depositLabel = (p: RatePlan, t: (s: string) => string) =>
  p.deposit === "prepaid" ? t("Prepagato") : p.deposit === "deposit" ? `${t("Acconto")} ${p.depositPct ?? 30}%` : t("Nessun anticipo");
const cancelLabel = (p: RatePlan, t: (s: string) => string) =>
  p.refundable ? (p.cancelDays ? `${t("Rimborsabile")} · ${p.cancelDays}gg` : t("Rimborsabile")) : t("Non rimborsabile");
const fmtRange = (p: RatePlan, t: (s: string) => string) => {
  if (!p.dateFrom && !p.dateTo) return t("Sempre");
  const d = (s?: string) => (s ? s.split("-").reverse().join("/") : "…");
  return `${d(p.dateFrom)} → ${d(p.dateTo)}`;
};

function Toggle({ on, onClick, color = "var(--focus)" }: { on: boolean; onClick?: () => void; color?: string }) {
  return <button type="button" onClick={onClick} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? color : "var(--line)" }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} /></button>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[5vh]">
      <button aria-label={t("Chiudi")} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-xl rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold text-txt">{title}</h2><button onClick={onClose} className="rounded px-2 py-1 text-dim hover:bg-wash">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export default function PianiTariffariPage() {
  const { structures, roomTypes, activeStructureId } = useData();
  const [localStructure, setLocalStructure] = useState<string>("all");
  const effStructure = activeStructureId !== "all" ? activeStructureId : localStructure;
  const ask = useConfirm();
  const { t } = useLang();
  const [plans, setPlans] = useState<RatePlan[]>(DEFAULT_PLANS);
  const [view, setView] = useState<"list" | "cards">("cards");
  const [editId, setEditId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY); if (v === "list" || v === "cards") setView(v);
      const raw = localStorage.getItem(PLANS_KEY);
      const seeded = localStorage.getItem(SEED_KEY);
      const applyDefaults = () => { setPlans(DEFAULT_PLANS); localStorage.setItem(PLANS_KEY, JSON.stringify(DEFAULT_PLANS)); localStorage.setItem(SEED_KEY, "1"); };
      if (!raw) { applyDefaults(); return; }
      const arr: RatePlan[] = JSON.parse(raw);
      const ids = arr.map((x) => x.id).sort().join(",");
      // Se sono ancora i 4 piani "di fabbrica" originali e non ho mai seminato i consigliati, li sostituisco.
      if (!seeded && ids === "bb,flex,nonref,std") applyDefaults();
      else setPlans(arr);
    } catch {}
  }, []);
  const savePlans = (next: RatePlan[]) => { setPlans(next); try { localStorage.setItem(PLANS_KEY, JSON.stringify(next)); } catch {} };
  const setView2 = (v: "list" | "cards") => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch {} };
  const upsert = (p: RatePlan) => savePlans(plans.some((x) => x.id === p.id) ? plans.map((x) => (x.id === p.id ? p : x)) : [...plans, p]);
  const setPlan = (id: string, patch: Partial<RatePlan>) => savePlans(plans.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const delPlan = async (id: string) => { if (!(await ask({ message: t("Eliminare questo piano tariffario?"), danger: true, confirmLabel: t("Elimina") }))) return; savePlans(plans.filter((p) => p.id !== id)); };
  const addPlan = () => { const p: RatePlan = { id: uid(), name: t("Nuovo piano"), adjPct: 0, refundable: true, board: "Solo pernottamento", minStay: 1, enabled: true, deposit: "none" }; upsert(p); setEditId(p.id); };

  const types = roomTypes.filter((rt) => effStructure === "all" || rt.structureId === effStructure);
  const refBase = types.length ? effectiveBase(types[0], roomTypes) : 100;
  const roomName = (id: string) => roomTypes.find((r) => r.id === id)?.name ?? "?";
  const editing = editId ? plans.find((p) => p.id === editId) ?? null : null;

  return (
    <div>
      <PageHeader
        title={t("Piani tariffari")}
        subtitle={t("La stessa camera, più modi di venderla. Ogni piano parte dal prezzo del giorno e applica uno scarto. Lo scegli quando crei un preventivo o una prenotazione.")}
        actions={activeStructureId === "all" ? (
          <select value={localStructure} onChange={(e) => setLocalStructure(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus">
            <option value="all">{t("Tutte le strutture")}</option>
            {structures.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
        ) : null}
      />

      {/* Barra: vista + legenda + aggiungi */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-dim shadow-sm">
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          <button onClick={() => setView2("list")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition ${view === "list" ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5h18M3 12h18M3 19h18" /></svg>{t("Elenco")}
          </button>
          <button onClick={() => setView2("cards")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition ${view === "cards" ? "bg-focus text-white" : "text-dim hover:bg-wash"}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>{t("Schede")}
          </button>
        </div>
        <span className="h-4 w-px bg-line" />
        <span className="flex items-center gap-1.5"><span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>+%</span> {t("aumento")}</span>
        <span className="flex items-center gap-1.5"><span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--err) 16%, transparent)", color: "var(--err)" }}>−%</span> {t("sconto")}</span>
        <span className="hidden sm:inline">🛏️ {t("trattamento")} · 📅 {t("intervallo")} · 💳 {t("incasso")}</span>
        <button onClick={addPlan} className="ml-auto rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">＋ {t("Nuovo piano")}</button>
      </div>

      {view === "list" ? (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-3 py-2.5 font-semibold">{t("Etichetta")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("Trattamento")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("Variazione")}</th>
                  <th className="px-3 py-2.5 text-center font-semibold">{t("Notti min.")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("Cancellazione")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("Incasso")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("Camere")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("Stato")}</th>
                  <th className="px-3 py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const on = p.enabled !== false;
                  const nRooms = p.roomTypeIds?.length;
                  return (
                    <tr key={p.id} onClick={() => setEditId(p.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-txt">{p.name}</div>
                        <div className="text-[10px] text-faint">{fmtRange(p, t)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-dim">{t(p.board)}</td>
                      <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: p.adjPct === 0 ? "var(--wash)" : `color-mix(in srgb, ${p.adjPct > 0 ? "var(--ok)" : "var(--err)"} 16%, transparent)`, color: p.adjPct === 0 ? "var(--dim)" : p.adjPct > 0 ? "var(--ok)" : "var(--err)" }}>{p.adjPct > 0 ? "+" : ""}{p.adjPct}%</span></td>
                      <td className="px-3 py-2.5 text-center font-mono text-dim">{p.minStay}</td>
                      <td className="px-3 py-2.5"><span className="text-xs font-medium" style={{ color: p.refundable ? "var(--ok)" : "var(--err)" }}>{cancelLabel(p, t)}</span></td>
                      <td className="px-3 py-2.5 text-xs text-dim">{depositLabel(p, t)}</td>
                      <td className="px-3 py-2.5 text-xs text-dim">{nRooms ? `${nRooms} ${t("tipologie")}` : t("Tutte")}</td>
                      <td className="px-3 py-2.5"><button onClick={(e) => { e.stopPropagation(); setPlan(p.id, { enabled: !on }); }} className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: on ? "var(--ok)" : "var(--faint)" }}><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: on ? "var(--ok)" : "var(--faint)" }} />{on ? t("Attivo") : t("Sospeso")}</button></td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={(e) => { e.stopPropagation(); delPlan(p.id); }} title={t("Elimina")} className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-[color:var(--err)] hover:bg-wash">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => {
            const on = p.enabled !== false;
            const price = Math.round(refBase * (1 + p.adjPct / 100));
            return (
              <button key={p.id} onClick={() => setEditId(p.id)} className={`relative flex flex-col rounded-2xl border p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${on ? "bg-surface" : "bg-wash opacity-80"}`} style={on ? { borderColor: "color-mix(in srgb, var(--focus) 38%, var(--line))" } : { borderColor: "var(--line)" }}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-bold text-txt">{p.name}</span>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: p.adjPct === 0 ? "var(--wash)" : `color-mix(in srgb, ${p.adjPct > 0 ? "var(--ok)" : "var(--err)"} 16%, transparent)`, color: p.adjPct === 0 ? "var(--dim)" : p.adjPct > 0 ? "var(--ok)" : "var(--err)" }}>{p.adjPct > 0 ? "+" : ""}{p.adjPct}%</span>
                </div>
                <div className="mt-1 font-mono text-2xl font-bold leading-none text-txt">{eur(price)}</div>
                <div className="text-[10px] text-faint">{t("su")} {eur(refBase)} {t("base")} · {t("esempio")}</div>
                <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-wash px-2 py-0.5 text-dim">{t(p.board)}</span>
                  <span className="rounded-full px-2 py-0.5 font-medium" style={{ backgroundColor: `color-mix(in srgb, ${p.refundable ? "var(--ok)" : "var(--err)"} 14%, transparent)`, color: p.refundable ? "var(--ok)" : "var(--err)" }}>{cancelLabel(p, t)}</span>
                  <span className="rounded-full bg-wash px-2 py-0.5 text-dim">{depositLabel(p, t)}</span>
                  <span className="rounded-full bg-wash px-2 py-0.5 text-dim">{t("min")} {p.minStay} {t("notti")}</span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-xs">
                  <span className="flex items-center gap-1.5 font-semibold" style={{ color: on ? "var(--ok)" : "var(--faint)" }}><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: on ? "var(--ok)" : "var(--faint)" }} />{on ? t("Attivo") : t("Sospeso")}</span>
                  <span className="font-medium text-focus">{t("Dettagli")} →</span>
                </div>
              </button>
            );
          })}
          <button onClick={addPlan} className="flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line text-dim transition hover:border-focus hover:text-focus">
            <span className="text-2xl">＋</span><span className="text-sm font-semibold">{t("Nuovo piano")}</span>
          </button>
        </div>
      )}

      <p className="mt-4 text-xs text-faint">{t("Vedi l'effetto dei piani giorno per giorno nell'Anteprima prezzi della pagina")} <a href="/tariffe" className="font-semibold text-focus hover:underline">{t("Tariffe")}</a>.</p>

      {editing && <PlanModal plan={editing} allTypes={types} roomName={roomName} onSave={(p) => { upsert(p); setEditId(null); }} onDelete={async () => { await delPlan(editing.id); setEditId(null); }} onClose={() => setEditId(null)} />}
    </div>
  );
}

function PlanModal({ plan, allTypes, roomName, onSave, onDelete, onClose }: {
  plan: RatePlan; allTypes: { id: string; name: string }[]; roomName: (id: string) => string;
  onSave: (p: RatePlan) => void; onDelete: () => void; onClose: () => void;
}) {
  const { t } = useLang();
  const [f, setF] = useState<RatePlan>({ ...plan });
  const set = <K extends keyof RatePlan>(k: K, v: RatePlan[K]) => setF((p) => ({ ...p, [k]: v }));
  const allSelected = !f.roomTypeIds || f.roomTypeIds.length === 0;
  const toggleRoom = (id: string) => setF((p) => {
    const cur = p.roomTypeIds && p.roomTypeIds.length ? p.roomTypeIds : allTypes.map((x) => x.id);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    return { ...p, roomTypeIds: next.length === allTypes.length ? undefined : next };
  });
  const num = (v: string, min = 0) => (v === "" ? min : Math.max(min, Math.floor(Number(v)) || 0));
  const selectedRooms = useMemo(() => (allSelected ? allTypes.map((x) => x.id) : f.roomTypeIds!), [allSelected, f.roomTypeIds, allTypes]);

  return (
    <Modal title={t("Dettagli piano tariffario")} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className={`${lbl} col-span-2`}>{t("Nome")}<input value={f.name} onChange={(e) => set("name", e.target.value)} className={`${inp} mt-1`} placeholder={t("Es. BB Flessibile 7gg")} /></label>
        <label className={lbl}>{t("Trattamento")}<select value={f.board} onChange={(e) => set("board", e.target.value)} className={`${inp} mt-1`}>{BOARDS.map((b) => <option key={b} value={b}>{t(b)}</option>)}</select></label>
        <label className={lbl}>{t("Notti minime")}<input type="number" min={1} value={f.minStay} onFocus={(e) => e.currentTarget.select()} onChange={(e) => set("minStay", num(e.target.value, 1))} className={`${inp} mt-1`} /></label>
      </div>

      {/* Prezzo */}
      <div className="mt-3 rounded-lg border border-line p-3">
        <span className={lbl}>{t("Variazione prezzo")} <span className="font-normal text-faint">· {t("sul prezzo del giorno")}</span></span>
        <div className="mt-1.5 flex items-center gap-2">
          <input type="number" value={f.adjPct} onFocus={(e) => e.currentTarget.select()} onChange={(e) => set("adjPct", Math.floor(Number(e.target.value)) || 0)} className="w-24 rounded-lg border border-line bg-paper px-2.5 py-2 text-sm text-txt outline-none focus:border-focus" />
          <span className="text-sm text-dim">%</span>
          <span className="ml-auto text-xs text-faint">{t("Negativo = sconto (es. −10% non rimborsabile), positivo = supplemento (es. +8% colazione).")}</span>
        </div>
      </div>

      {/* Politiche prenotazione */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="col-span-2 grid grid-cols-2 gap-3 rounded-lg border border-line p-3">
          <label className="col-span-2 flex items-center justify-between gap-2 text-sm text-txt">{t("Rimborsabile")}<Toggle on={f.refundable} onClick={() => set("refundable", !f.refundable)} /></label>
          {f.refundable && <label className={`${lbl} col-span-2`}>{t("Cancellazione gratuita fino a (giorni prima)")}<input type="number" min={0} value={f.cancelDays ?? 0} onFocus={(e) => e.currentTarget.select()} onChange={(e) => set("cancelDays", num(e.target.value))} className={`${inp} mt-1`} placeholder="7" /></label>}
        </div>
        <label className={lbl}>{t("Politica di incasso")}<select value={f.deposit ?? "none"} onChange={(e) => set("deposit", e.target.value as DepositId)} className={`${inp} mt-1`}>{DEPOSITS.map((d) => <option key={d.id} value={d.id}>{t(d.label)}</option>)}</select></label>
        {f.deposit === "deposit" && <label className={lbl}>{t("Acconto %")}<input type="number" min={1} max={100} value={f.depositPct ?? 30} onFocus={(e) => e.currentTarget.select()} onChange={(e) => set("depositPct", num(e.target.value, 1))} className={`${inp} mt-1`} /></label>}
      </div>

      {/* Intervallo temporale */}
      <div className="mt-3 rounded-lg border border-line p-3">
        <div className="flex items-center justify-between">
          <span className={lbl}>{t("Intervallo temporale")} <span className="font-normal text-faint">· {t("vuoto = sempre valido")}</span></span>
          {(f.dateFrom || f.dateTo) && <button onClick={() => setF((p) => ({ ...p, dateFrom: undefined, dateTo: undefined }))} className="text-[11px] font-medium text-focus hover:underline">{t("Azzera")}</button>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input type="date" value={f.dateFrom ?? ""} onChange={(e) => set("dateFrom", e.target.value || undefined)} className="rounded-lg border border-line bg-paper px-2.5 py-2 text-sm text-txt outline-none focus:border-focus" />
          <span className="text-dim">→</span>
          <input type="date" value={f.dateTo ?? ""} onChange={(e) => set("dateTo", e.target.value || undefined)} className="rounded-lg border border-line bg-paper px-2.5 py-2 text-sm text-txt outline-none focus:border-focus" />
        </div>
      </div>

      {/* Camere a cui si applica */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className={lbl}>{t("Camere a cui si applica")}</span>
          <div className="flex gap-2 text-[11px] font-medium">
            <button onClick={() => set("roomTypeIds", undefined)} className="text-focus hover:underline">{t("Tutte")}</button>
            <button onClick={() => set("roomTypeIds", [])} className="text-dim hover:underline">{t("Nessuna")}</button>
          </div>
        </div>
        <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {allTypes.map((rt) => { const on = selectedRooms.includes(rt.id); return (
            <button key={rt.id} type="button" onClick={() => toggleRoom(rt.id)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus" : "border-line text-dim hover:bg-wash"}`}>{on ? "✓ " : ""}{roomName(rt.id)}</button>
          ); })}
          {allTypes.length === 0 && <span className="text-xs text-faint">{t("Nessuna tipologia disponibile.")}</span>}
        </div>
        <p className="mt-1 text-[11px] text-faint">{allSelected ? t("Si applica a tutte le tipologie.") : `${selectedRooms.length} ${t("tipologie selezionate")}`}</p>
      </div>

      {/* Descrizione */}
      <label className={`${lbl} mt-3`}>{t("Descrizione")} <span className="font-normal text-faint">· {t("mostrata all'ospite (preventivi, booking)")}</span>
        <textarea value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} className={`${inp} mt-1 resize-y`} placeholder={t("Es. Cancellazione gratuita fino a 7 giorni prima dell'arrivo.")} />
      </label>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={onDelete} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-[color:var(--err)] hover:bg-wash">{t("Elimina")}</button>
        <label className="ml-1 flex items-center gap-2 text-sm text-dim">{t("Attivo")}<Toggle on={f.enabled !== false} onClick={() => set("enabled", f.enabled === false)} color="var(--ok)" /></label>
        <button onClick={onClose} className="ml-auto rounded-lg border border-line px-3 py-2 text-sm text-dim hover:bg-wash">{t("Annulla")}</button>
        <button onClick={() => onSave(f)} disabled={!f.name.trim()} className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">{t("Salva")}</button>
      </div>
    </Modal>
  );
}
