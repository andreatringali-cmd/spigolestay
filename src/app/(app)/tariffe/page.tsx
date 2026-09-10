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

interface RatePlan { id: string; name: string; adjPct: number; refundable: boolean; board: string; minStay: number; enabled?: boolean }
const DEFAULT_PLANS: RatePlan[] = [
  { id: "std", name: "Standard", adjPct: 0, refundable: true, board: "Solo pernottamento", minStay: 1, enabled: true },
  { id: "bb", name: "Colazione inclusa", adjPct: 8, refundable: true, board: "Colazione", minStay: 1, enabled: true },
  { id: "nonref", name: "Non rimborsabile", adjPct: -10, refundable: false, board: "Solo pernottamento", minStay: 2, enabled: true },
  { id: "flex", name: "Flessibile", adjPct: 5, refundable: true, board: "Solo pernottamento", minStay: 1, enabled: true },
];
const PLANS_KEY = "spigolestay:rateplans";
const RULES_KEY = "spigolestay:pricerules";
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p-${Math.floor(performance.now() * 1000)}`);

const inp = "rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus";

// Pallino numerato dei 3 passi
function StepDot({ n }: { n: number }) {
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: "var(--focus)" }}>{n}</span>;
}

// Iconcine ospiti (occupazione della tariffa): es. "doppia uso singola" = 1, "tripla uso matrimoniale" = 2.
function Occ({ n }: { n: number }) {
  const c = Math.max(1, Math.min(Math.round(n) || 1, 8));
  return (
    <span className="inline-flex items-center gap-0.5 align-middle text-dim" title={`${c} ${c === 1 ? "ospite" : "ospiti"}`}>
      {Array.from({ length: c }).map((_, i) => (
        <svg key={i} width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 8a7 7 0 1114 0H3z" /></svg>
      ))}
    </span>
  );
}

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
  const addPlan = () => savePlans([...plans, { id: uid(), name: "Nuovo piano", adjPct: 0, refundable: true, board: "Solo pernottamento", minStay: 1, enabled: true }]);
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
          <Occ n={rt.maxOccupancy ?? rt.beds} />
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

  const hasDerived = types.some((rt) => rt.deriveFrom);

  return (
    <div>
      <PageHeader
        title={t("Tariffe")}
        subtitle={t("Come si forma il prezzo e come lo vendi — prezzi base, regole e piani tariffari")}
        actions={activeStructureId === "all" ? (
          <select value={localStructure} onChange={(e) => setLocalStructure(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt outline-none focus:border-focus">
            <option value="all">{t("Tutte le strutture")}</option>
            {structures.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
        ) : null}
      />

      {/* Come nasce il prezzo — la formula, in chiaro */}
      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-[560px] items-center gap-1.5 rounded-2xl border border-line bg-surface p-3 shadow-sm">
          {([
            ["🏷️", t("Prezzo base"), t("per tipologia, anche derivato")],
            ["📅", t("Regole auto"), t("es. weekend +%")],
            ["🗓️", t("Prezzo del giorno"), t("il calendario vince")],
            ["🎯", t("Piano tariffario"), t("come lo vendi")],
          ] as [string, string, string][]).map(([ic, h, sub], i, arr) => (
            <div key={h} className="flex items-center gap-1.5">
              <div className="flex items-center gap-2.5 rounded-xl bg-wash px-3 py-2">
                <span className="text-lg leading-none">{ic}</span>
                <div className="leading-tight">
                  <div className="text-sm font-semibold text-txt">{h}</div>
                  <div className="text-[11px] text-faint">{sub}</div>
                </div>
              </div>
              {i < arr.length - 1 && <span className="text-faint" style={{ color: "var(--focus)" }}>→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ① Prezzi base & regole */}
      <section className="mb-7">
        <div className="mb-1 flex items-center gap-2"><StepDot n={1} /><SectionTitle>{t("Prezzi base & regole")}</SectionTitle></div>
        <p className="mb-3 pl-8 text-xs text-dim">{t("Il prezzo di partenza di ogni tipologia. Una tipologia può avere un prezzo indipendente o derivato da un'altra (+/− € o %). Vale per i giorni che non forzi dal calendario.")}</p>
        <Card>
          {/* Regola weekend */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-wash px-3 py-2 text-sm">
            <span className="font-medium text-txt">📅 {t("Maggiorazione weekend")}</span>
            <span className="flex items-center gap-1"><input type="number" value={weekendPct} onChange={(e) => saveWeekend(Number(e.target.value))} className={`${inp} w-20`} /><span className="text-dim">%</span></span>
            <span className="text-[11px] text-faint">{t("su ven/sab/dom, se non c'è un prezzo forzato dal calendario")}</span>
          </div>

          <div className="flex flex-col gap-2">
            {types.map((rt) => {
              const derived = !!rt.deriveFrom;
              const eff = effectiveBase(rt, roomTypes);
              const sources = types.filter((x) => x.id !== rt.id);
              const inheriting = derived && !!rt.deriveInherit;
              const minS = inheriting ? effectiveMinStay(rt, roomTypes) : (rt.minStay ?? 0);
              const closed = inheriting ? effectiveClosed(rt, roomTypes) : !!rt.salesClosed;
              return (
                <div key={rt.id} className="rounded-xl border border-line bg-paper p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[110px] flex-1 text-sm font-semibold text-txt">
                      {rt.name}
                      <span className="ml-1.5"><Occ n={rt.maxOccupancy ?? rt.beds} /></span>
                      {!derived && <span className="ml-1.5 rounded-full bg-wash px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-dim">master</span>}
                      {closed && <span className="ml-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--err)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[color:var(--err)]">{t("chiusa")}</span>}
                    </div>
                    <div className="inline-flex rounded-lg border border-line p-0.5">
                      {([["indep", t("Indipendente")], ["derived", t("Derivata")]] as [string, string][]).map(([v, lab]) => (
                        <button key={v} onClick={() => updateRoomType(rt.id, v === "derived" ? { deriveFrom: sources[0]?.id ?? "", deriveMode: rt.deriveMode ?? "amount", deriveValue: rt.deriveValue ?? -10 } : { deriveFrom: undefined })} className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${(v === "derived") === derived ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{lab}</button>
                      ))}
                    </div>
                    {!derived ? (
                      <label className="flex items-center gap-1 text-xs text-dim">€<input type="number" min={0} value={rt.basePrice} onChange={(e) => updateRoomType(rt.id, { basePrice: Number(e.target.value) })} className={`${inp} w-20`} /></label>
                    ) : (
                      <>
                        <select value={rt.deriveFrom} onChange={(e) => updateRoomType(rt.id, { deriveFrom: e.target.value })} className={inp}>{sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                        <select value={rt.deriveMode ?? "amount"} onChange={(e) => updateRoomType(rt.id, { deriveMode: e.target.value as "amount" | "percent" })} className={inp}><option value="amount">±€</option><option value="percent">±%</option></select>
                        <input type="number" value={rt.deriveValue ?? 0} onChange={(e) => updateRoomType(rt.id, { deriveValue: Number(e.target.value) })} className={`${inp} w-16`} />
                      </>
                    )}
                    <div className="ml-auto text-right">
                      <div className="font-mono text-base font-bold text-txt">{eur(eff)}</div>
                      <div className="text-[10px] text-faint">{derived ? t("derivata") : t("base")} · {t("a notte")}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2 text-[11px] text-dim">
                    {derived && (
                      <>
                        <label className="flex items-center gap-1.5"><input type="checkbox" checked={rt.deriveRound !== false} onChange={(e) => updateRoomType(rt.id, { deriveRound: e.target.checked })} className="h-3.5 w-3.5 accent-[color:var(--focus)]" /> {t("Arrotonda")}</label>
                        <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!rt.deriveInherit} onChange={(e) => updateRoomType(rt.id, { deriveInherit: e.target.checked })} className="h-3.5 w-3.5 accent-[color:var(--focus)]" /> {t("Eredita disp./restrizioni")}</label>
                      </>
                    )}
                    <label className="flex items-center gap-1.5">{t("Ospiti")}<input type="number" min={1} value={rt.maxOccupancy ?? rt.beds} onChange={(e) => updateRoomType(rt.id, { maxOccupancy: Math.max(1, Number(e.target.value)) })} className={`${inp} w-14 py-1`} /></label>
                    <label className="flex items-center gap-1.5">{t("Notti min")}<input type="number" min={0} disabled={inheriting} value={minS} onChange={(e) => updateRoomType(rt.id, { minStay: Math.max(0, Number(e.target.value)) })} className={`${inp} w-14 py-1 disabled:opacity-40`} /></label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" disabled={inheriting} checked={closed} onChange={(e) => updateRoomType(rt.id, { salesClosed: e.target.checked })} className="h-3.5 w-3.5 accent-[color:var(--err)] disabled:opacity-40" /> {t("Chiudi vendite")}</label>
                    {inheriting && <span className="text-faint">{t("(dalla master)")}</span>}
                  </div>
                </div>
              );
            })}
            {types.length === 0 && <div className="py-2 text-sm text-faint">{t("Nessuna tipologia.")}</div>}
          </div>

          {/* Mappa derivate: solo se c'è almeno una derivata */}
          {roots.length > 0 && hasDerived && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{t("Mappa tariffe derivate")}</div>
              <div className="overflow-x-auto"><div className="flex flex-wrap gap-6 pb-1">{roots.map((rt) => <TypeNode key={rt.id} rt={rt} />)}</div></div>
            </div>
          )}
        </Card>
      </section>

      {/* ② Piani tariffari */}
      <section className="mb-7">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><StepDot n={2} /><SectionTitle>{t("Piani tariffari")}</SectionTitle></div>
          <button onClick={addPlan} className="rounded-lg bg-focus px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">＋ {t("Nuovo piano")}</button>
        </div>
        <p className="mb-3 pl-8 text-xs text-dim">{t("La stessa camera, più modi di venderla. Ogni piano parte dal prezzo del giorno e applica uno scarto. Lo scegli quando crei un preventivo o una prenotazione.")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => {
            const on = p.enabled !== false;
            const price = Math.round(refBase * (1 + p.adjPct / 100));
            const isDefault = DEFAULT_PLANS.some((d) => d.id === p.id);
            return (
              <div key={p.id} className={`relative flex flex-col rounded-2xl border p-3.5 shadow-sm transition ${on ? "bg-surface" : "bg-wash opacity-80"}`} style={on ? { borderColor: "color-mix(in srgb, var(--focus) 38%, var(--line))" } : { borderColor: "var(--line)" }}>
                <div className="flex items-start gap-2">
                  <input value={p.name} onChange={(e) => setPlan(p.id, { name: e.target.value })} className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-bold text-txt outline-none hover:border-line focus:border-focus" />
                  {!isDefault && <button onClick={() => delPlan(p.id)} title={t("Elimina")} className="rounded p-1 text-faint hover:text-[color:var(--err)]">✕</button>}
                </div>
                <div className="mt-1 flex items-end gap-2">
                  <span className="font-mono text-2xl font-bold leading-none text-txt">{eur(price)}</span>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: p.adjPct === 0 ? "var(--wash)" : `color-mix(in srgb, ${p.adjPct > 0 ? "var(--ok)" : "var(--err)"} 16%, transparent)`, color: p.adjPct === 0 ? "var(--dim)" : p.adjPct > 0 ? "var(--ok)" : "var(--err)" }}>{p.adjPct > 0 ? "+" : ""}{p.adjPct}%</span>
                </div>
                <div className="text-[10px] text-faint">{t("su")} {eur(refBase)} {t("base")} · {t("esempio")}</div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <select value={p.board} onChange={(e) => setPlan(p.id, { board: e.target.value })} className="rounded-full border border-line bg-paper px-2 py-1 text-[11px] text-dim outline-none focus:border-focus">{BOARDS.map((b) => <option key={b} value={b}>{t(b)}</option>)}</select>
                  <span className="inline-flex items-center gap-1 rounded-full bg-wash px-2 py-1 text-dim">{t("min")}<input type="number" min={1} value={p.minStay} onChange={(e) => setPlan(p.id, { minStay: Number(e.target.value) })} className="w-8 bg-transparent text-center font-semibold text-txt outline-none" />{t("notti")}</span>
                  <button onClick={() => setPlan(p.id, { refundable: !p.refundable })} className="rounded-full px-2 py-1 font-medium" style={{ backgroundColor: `color-mix(in srgb, ${p.refundable ? "var(--ok)" : "var(--err)"} 14%, transparent)`, color: p.refundable ? "var(--ok)" : "var(--err)" }}>{p.refundable ? t("Rimborsabile") : t("Non rimborsabile")}</button>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                  <label className="flex items-center gap-1 text-[11px] text-dim">{t("Scarto")}<input type="number" value={p.adjPct} onChange={(e) => setPlan(p.id, { adjPct: Number(e.target.value) })} className={`${inp} w-16 py-1`} />%</label>
                  <button onClick={() => setPlan(p.id, { enabled: !on })} className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: on ? "var(--ok)" : "var(--faint)" }}>
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: on ? "var(--ok)" : "var(--faint)" }} />{on ? t("Attivo") : t("Sospeso")}
                  </button>
                </div>
              </div>
            );
          })}
          <button onClick={addPlan} className="flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line text-dim transition hover:border-focus hover:text-focus">
            <span className="text-2xl">＋</span><span className="text-sm font-semibold">{t("Nuovo piano")}</span>
          </button>
        </div>
      </section>

      {/* ③ Anteprima prezzi */}
      <section>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><StepDot n={3} /><SectionTitle>{t("Anteprima prezzi")}</SectionTitle></div>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-txt outline-none focus:border-focus">{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.adjPct >= 0 ? "+" : ""}{p.adjPct}%)</option>)}</select>
        </div>
        <p className="mb-3 pl-8 text-xs text-dim">{t("Cosa vedrebbe l'ospite, giorno per giorno, con il piano scelto. In")} <b className="text-focus">{t("evidenza")}</b> {t("i prezzi forzati dal calendario.")}</p>
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
        <p className="mt-3 text-xs text-faint">{t("Il prezzo applica il piano selezionato al prezzo del giorno (base + regole, oppure la tariffa forzata dal calendario). Imposti i prezzi specifici per data dal")} <b className="text-focus">{t("Calendario")}</b>.</p>
      </section>
    </div>
  );
}
