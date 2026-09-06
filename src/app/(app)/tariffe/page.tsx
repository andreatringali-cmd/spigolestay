"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { addDays, isWeekend, toISO, weekdayShort } from "@/lib/dates";
import type { RoomType } from "@/lib/types";
import { effectiveBase, effectiveMinStay, effectiveClosed } from "@/lib/pricing";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLang } from "@/lib/i18n";

const DAYS = 14;
const BOARDS = ["Solo pernottamento", "Colazione", "Mezza pensione", "Pensione completa"];

interface RatePlan { id: string; name: string; adjPct: number; refundable: boolean; board: string; minStay: number }
const DEFAULT_PLANS: RatePlan[] = [
  { id: "std", name: "Standard", adjPct: 0, refundable: true, board: "Solo pernottamento", minStay: 1 },
  { id: "bb", name: "Colazione inclusa", adjPct: 8, refundable: true, board: "Colazione", minStay: 1 },
  { id: "nonref", name: "Non rimborsabile", adjPct: -10, refundable: false, board: "Solo pernottamento", minStay: 2 },
  { id: "flex", name: "Flessibile", adjPct: 5, refundable: true, board: "Solo pernottamento", minStay: 1 },
];
const PLANS_KEY = "spigolestay:rateplans";
const RULES_KEY = "spigolestay:pricerules";
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p-${Math.floor(performance.now() * 1000)}`);

const inp = "rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus";

export default function TariffePage() {
  const { structures, roomTypes, rateOverrides, updateRoomType, activeStructureId } = useData();
  const [localStructure, setLocalStructure] = useState<string>("all");
  const effStructure = activeStructureId !== "all" ? activeStructureId : localStructure;

  const ask = useConfirm();
  const { t } = useLang();
  const [plans, setPlans] = useState<RatePlan[]>(DEFAULT_PLANS);
  const [weekendPct, setWeekendPct] = useState(25);
  const [planId, setPlanId] = useState("std");
  useEffect(() => {
    try { const p = localStorage.getItem(PLANS_KEY); if (p) setPlans(JSON.parse(p)); const r = localStorage.getItem(RULES_KEY); if (r) setWeekendPct(JSON.parse(r).weekendPct ?? 25); } catch {}
  }, []);
  const savePlans = (next: RatePlan[]) => { setPlans(next); try { localStorage.setItem(PLANS_KEY, JSON.stringify(next)); } catch {} };
  const saveWeekend = (v: number) => { setWeekendPct(v); try { localStorage.setItem(RULES_KEY, JSON.stringify({ weekendPct: v })); } catch {} };
  const setPlan = (id: string, patch: Partial<RatePlan>) => savePlans(plans.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addPlan = () => savePlans([...plans, { id: uid(), name: "Nuovo piano", adjPct: 0, refundable: true, board: "Solo pernottamento", minStay: 1 }]);
  const delPlan = async (id: string) => { if (!(await ask({ message: t("Eliminare questo piano tariffario?"), danger: true, confirmLabel: t("Elimina") }))) return; savePlans(plans.filter((p) => p.id !== id)); };

  const start = new Date();
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const days = Array.from({ length: DAYS }, (_, i) => addDays(s, i));
  const types = roomTypes.filter((rt) => effStructure === "all" || rt.structureId === effStructure);
  const refBase = types.length ? effectiveBase(types[0], roomTypes) : 100;
  const activePlan = plans.find((p) => p.id === planId) ?? plans[0];

  // Prezzo del giorno per una tipologia: override calendario → base derivata → +weekend, poi piano.
  const dayPrice = (rt: RoomType, d: Date) => {
    const iso = toISO(d);
    const base = effectiveBase(rt, roomTypes);
    const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(base * (isWeekend(d) ? 1 + weekendPct / 100 : 1));
    return Math.max(0, Math.round(raw * (1 + (activePlan?.adjPct ?? 0) / 100)));
  };

  // ── Mappa tariffe derivate (albero master → derivate) ──
  const childrenOf = (id: string) => types.filter((x) => x.deriveFrom === id);
  const scarto = (rt: RoomType) => { const v = rt.deriveValue ?? 0; const sign = v >= 0 ? "+" : ""; return rt.deriveMode === "percent" ? `${sign}${v}%` : `${sign}${v} €`; };
  const roots = types.filter((rt) => !rt.deriveFrom || !types.some((x) => x.id === rt.deriveFrom));
  const TypeNode = ({ rt, seen = new Set<string>() }: { rt: RoomType; seen?: Set<string> }) => {
    if (seen.has(rt.id)) return null;
    const nextSeen = new Set(seen); nextSeen.add(rt.id);
    const kids = childrenOf(rt.id);
    const closed = effectiveClosed(rt, roomTypes);
    return (
      <div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 shadow-sm">
          <span className="font-semibold text-txt">{rt.name}</span>
          <span className="font-mono text-xs font-bold text-txt">{eur(effectiveBase(rt, roomTypes))}</span>
          {!rt.deriveFrom && <span className="rounded-full bg-wash px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-dim">master</span>}
          {rt.deriveInherit && <span title={t("Eredita disponibilità e restrizioni")} className="text-[11px] text-focus">⇊</span>}
          {closed && <span className="rounded-full bg-[color:color-mix(in_srgb,var(--err)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[color:var(--err)]">{t("chiusa")}</span>}
        </div>
        {kids.length > 0 && (
          <div className="mt-2 ml-3 flex flex-col gap-2 border-l-2 border-line pl-3">
            {kids.map((k) => (
              <div key={k.id} className="flex items-start gap-2">
                <span className="mt-2 shrink-0 rounded-full bg-focus px-1.5 py-0.5 text-[10px] font-bold text-white">{scarto(k)}</span>
                <TypeNode rt={k} seen={nextSeen} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title={t("Tariffe")}
        subtitle={t("Piani tariffari, tariffe derivate e prezzi giorno per giorno")}
        actions={activeStructureId === "all" ? (
          <select value={localStructure} onChange={(e) => setLocalStructure(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus">
            <option value="all">{t("Tutte le strutture")}</option>
            {structures.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
        ) : null}
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        {/* Piani tariffari */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle>{t("Piani tariffari")}</SectionTitle>
            <button onClick={addPlan} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-focus hover:bg-wash">＋ {t("Piano")}</button>
          </div>
          <div className="flex flex-col gap-2">
            {plans.map((p) => {
              const price = Math.round(refBase * (1 + p.adjPct / 100));
              return (
                <div key={p.id} className="rounded-lg border border-line p-2.5">
                  <div className="flex items-center gap-2">
                    <input value={p.name} onChange={(e) => setPlan(p.id, { name: e.target.value })} className={`${inp} min-w-0 flex-1 font-medium`} />
                    <div className="text-right"><div className="font-mono text-sm font-bold text-txt">{eur(price)}</div><div className="text-[10px] text-faint">{t("su")} {eur(refBase)}</div></div>
                    {!DEFAULT_PLANS.some((d) => d.id === p.id) && <button onClick={() => delPlan(p.id)} className="rounded p-1 text-faint hover:text-[color:var(--err)]">✕</button>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1 text-dim">{t("Scarto %")}<input type="number" value={p.adjPct} onChange={(e) => setPlan(p.id, { adjPct: Number(e.target.value) })} className={`${inp} w-16`} /></label>
                    <label className="flex items-center gap-1 text-dim">{t("Notti min")}<input type="number" min={1} value={p.minStay} onChange={(e) => setPlan(p.id, { minStay: Number(e.target.value) })} className={`${inp} w-14`} /></label>
                    <select value={p.board} onChange={(e) => setPlan(p.id, { board: e.target.value })} className={inp}>{BOARDS.map((b) => <option key={b} value={b}>{t(b)}</option>)}</select>
                    <button onClick={() => setPlan(p.id, { refundable: !p.refundable })} className={`rounded-full px-2 py-1 text-[11px] font-medium ${p.refundable ? "bg-[color:color-mix(in_srgb,var(--ok)_16%,transparent)] text-[color:var(--ok)]" : "bg-[color:color-mix(in_srgb,var(--err)_14%,transparent)] text-[color:var(--err)]"}`}>{p.refundable ? t("Rimborsabile") : t("Non rimborsabile")}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Regole di prezzo + derivate */}
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>{t("Regole di prezzo")}</SectionTitle>
            <label className="flex items-center justify-between text-sm text-txt">{t("Maggiorazione weekend")}<span className="flex items-center gap-1"><input type="number" value={weekendPct} onChange={(e) => saveWeekend(Number(e.target.value))} className={`${inp} w-20`} /><span className="text-dim">%</span></span></label>
            <p className="mt-2 text-[11px] text-faint">{t("Applicata a venerdì/sabato/domenica sui giorni senza tariffa forzata dal calendario.")}</p>
          </Card>

          <Card>
            <SectionTitle>{t("Tariffe derivate")}</SectionTitle>
            <p className="mb-3 text-xs text-dim">{t("Una tipologia può avere tariffa")} <b>{t("indipendente")}</b> {t("o")} <b>{t("derivata")}</b> {t("da un'altra con scarto in € o %.")}</p>
            <div className="flex flex-col gap-2">
              {types.map((rt) => {
                const derived = !!rt.deriveFrom;
                const eff = effectiveBase(rt, roomTypes);
                const sources = types.filter((x) => x.id !== rt.id);
                const inheriting = derived && !!rt.deriveInherit;
                const minS = inheriting ? effectiveMinStay(rt, roomTypes) : (rt.minStay ?? 0);
                const closed = inheriting ? effectiveClosed(rt, roomTypes) : !!rt.salesClosed;
                return (
                  <div key={rt.id} className="rounded-lg border border-line p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[110px] flex-1 text-sm font-medium text-txt">{rt.name}{closed && <span className="ml-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--err)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[color:var(--err)]">{t("chiusa")}</span>}</div>
                      <select value={derived ? "derived" : "indep"} onChange={(e) => updateRoomType(rt.id, e.target.value === "derived" ? { deriveFrom: sources[0]?.id ?? "", deriveMode: rt.deriveMode ?? "amount", deriveValue: rt.deriveValue ?? -10 } : { deriveFrom: undefined })} className={inp}>
                        <option value="indep">{t("Indipendente")}</option>
                        <option value="derived">{t("Derivata")}</option>
                      </select>
                      {!derived ? (
                        <input type="number" min={0} value={rt.basePrice} onChange={(e) => updateRoomType(rt.id, { basePrice: Number(e.target.value) })} className={`${inp} w-20`} />
                      ) : (
                        <>
                          <select value={rt.deriveFrom} onChange={(e) => updateRoomType(rt.id, { deriveFrom: e.target.value })} className={inp}>{sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                          <select value={rt.deriveMode ?? "amount"} onChange={(e) => updateRoomType(rt.id, { deriveMode: e.target.value as "amount" | "percent" })} className={inp}><option value="amount">±€</option><option value="percent">±%</option></select>
                          <input type="number" value={rt.deriveValue ?? 0} onChange={(e) => updateRoomType(rt.id, { deriveValue: Number(e.target.value) })} className={`${inp} w-16`} />
                        </>
                      )}
                      <div className="ml-auto font-mono text-sm font-bold text-txt">{eur(eff)}{derived && <span className="ml-1 text-[10px] font-normal text-focus">{t("der.")}</span>}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-dim">
                      {derived && (
                        <>
                          <label className="flex items-center gap-1.5"><input type="checkbox" checked={rt.deriveRound !== false} onChange={(e) => updateRoomType(rt.id, { deriveRound: e.target.checked })} className="h-3.5 w-3.5 accent-[color:var(--focus)]" /> {t("Arrotonda")}</label>
                          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!rt.deriveInherit} onChange={(e) => updateRoomType(rt.id, { deriveInherit: e.target.checked })} className="h-3.5 w-3.5 accent-[color:var(--focus)]" /> {t("Eredita disp./restrizioni")}</label>
                        </>
                      )}
                      <label className="flex items-center gap-1.5">{t("Notti min")}<input type="number" min={0} disabled={inheriting} value={minS} onChange={(e) => updateRoomType(rt.id, { minStay: Math.max(0, Number(e.target.value)) })} className={`${inp} w-14 py-1 disabled:opacity-40`} /></label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" disabled={inheriting} checked={closed} onChange={(e) => updateRoomType(rt.id, { salesClosed: e.target.checked })} className="h-3.5 w-3.5 accent-[color:var(--err)] disabled:opacity-40" /> {t("Chiudi vendite")}</label>
                      {inheriting && <span className="text-faint">{t("(dalla master)")}</span>}
                    </div>
                  </div>
                );
              })}
              {types.length === 0 && <div className="py-2 text-sm text-faint">{t("Nessuna tipologia.")}</div>}
            </div>
          </Card>
        </div>
      </div>

      {/* Mappa tariffe derivate */}
      {roots.length > 0 && types.some((rt) => rt.deriveFrom) && (
        <Card className="mb-5">
          <SectionTitle>{t("Mappa tariffe derivate")}</SectionTitle>
          <p className="mb-3 text-xs text-dim">{t("Ogni tipologia master con le sue derivate e lo scarto applicato. Cambia il prezzo della master e le derivate si aggiornano da sole.")}</p>
          <div className="overflow-x-auto">
            <div className="flex flex-wrap gap-6 pb-1">
              {roots.map((rt) => <TypeNode key={rt.id} rt={rt} />)}
            </div>
          </div>
        </Card>
      )}

      {/* Striscia prezzi */}
      <div className="mb-2 flex items-center gap-2">
        <SectionTitle>{t("Prezzi giorno per giorno")}</SectionTitle>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="ml-auto rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-txt outline-none focus:border-focus">{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.adjPct >= 0 ? "+" : ""}{p.adjPct}%)</option>)}</select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="sticky left-0 z-10 bg-wash px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-faint">{t("Tipologia")}</th>
              {days.map((d) => (
                <th key={toISO(d)} className={`px-2 py-2 text-center text-xs font-medium ${isWeekend(d) ? "bg-wash text-dim" : "text-faint"}`}><div>{weekdayShort(d)}</div><div className="font-mono text-txt">{d.getDate()}</div></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((rt) => {
              const base = effectiveBase(rt, roomTypes);
              return (
                <tr key={rt.id} className="border-b border-line last:border-0">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2.5">
                    <div className="text-sm font-medium text-txt">{rt.name}</div>
                    <div className="text-[10px] text-faint">{rt.beds} {t("posti")} · {t("base")} {eur(base)}{rt.deriveFrom ? ` (${t("der.")})` : ""}</div>
                  </td>
                  {days.map((d) => {
                    const iso = toISO(d);
                    const forced = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso];
                    return (
                      <td key={iso} className={`px-2 py-2.5 text-center ${isWeekend(d) ? "bg-wash" : ""}`}>
                        <span className={`font-mono text-sm tabular-nums ${forced != null ? "font-bold text-focus" : "text-txt"}`} title={forced != null ? t("Tariffa forzata dal calendario") : ""}>{dayPrice(rt, d)}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-faint">{t("Il prezzo mostrato applica il piano selezionato al prezzo base (o alla")} <b className="text-focus">{t("tariffa forzata dal calendario")}</b>{t(", in evidenza). Le derivate si aggiornano da sole al cambio della base.")}</p>
    </div>
  );
}
