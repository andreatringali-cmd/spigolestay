"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { addDays, isWeekend, toISO, weekdayShort } from "@/lib/dates";
import type { RoomType } from "@/lib/types";
import { effectiveBase, effectiveMinStay, effectiveClosed } from "@/lib/pricing";
import { eur } from "@/lib/format";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { useLang } from "@/lib/i18n";

const DAYS = 14;

interface RatePlan { id: string; name: string; adjPct: number; refundable: boolean; board: string; minStay: number; enabled?: boolean }
const DEFAULT_PLANS: RatePlan[] = [
  { id: "flex", name: "Flessibile", adjPct: 0, refundable: true, board: "Colazione", minStay: 1, enabled: true },
  { id: "nonref", name: "Non rimborsabile", adjPct: -10, refundable: false, board: "Colazione", minStay: 1, enabled: true },
  { id: "long", name: "Lunga permanenza", adjPct: -12, refundable: true, board: "Colazione", minStay: 5, enabled: true },
];
const PLANS_KEY = "spigolestay:rateplans";
const RULES_KEY = "spigolestay:pricerules";

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

  const { t } = useLang();
  const [plans, setPlans] = useState<RatePlan[]>(DEFAULT_PLANS);
  const [weekendPct, setWeekendPct] = useState(25);
  const [planId, setPlanId] = useState("flex");
  useEffect(() => {
    try {
      const p = localStorage.getItem(PLANS_KEY);
      const arr: RatePlan[] = p ? JSON.parse(p) : DEFAULT_PLANS;
      setPlans(arr);
      setPlanId((prev) => (arr.some((x) => x.id === prev) ? prev : arr[0]?.id ?? prev));
      const r = localStorage.getItem(RULES_KEY); if (r) setWeekendPct(JSON.parse(r).weekendPct ?? 25);
    } catch {}
  }, []);
  const saveWeekend = (v: number) => { setWeekendPct(v); try { localStorage.setItem(RULES_KEY, JSON.stringify({ weekendPct: v })); } catch {} };

  const start = new Date();
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const days = Array.from({ length: DAYS }, (_, i) => addDays(s, i));
  const types = roomTypes.filter((rt) => effStructure === "all" || rt.structureId === effStructure);
  const activePlan = plans.find((p) => p.id === planId) ?? plans[0];

  // Prezzo del giorno per una tipologia: override calendario → base derivata → +weekend, poi piano.
  const dayPrice = (rt: RoomType, d: Date) => {
    const iso = toISO(d);
    const base = effectiveBase(rt, roomTypes);
    const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(base * (isWeekend(d) ? 1 + weekendPct / 100 : 1));
    return Math.max(0, Math.round(raw * (1 + (activePlan?.adjPct ?? 0) / 100)));
  };

  // Scarto della derivata rispetto alla madre (mostrato come info nella lista prezzi base).
  const scarto = (rt: RoomType) => { const v = rt.deriveValue ?? 0; const sign = v >= 0 ? "+" : ""; return rt.deriveMode === "percent" ? `${sign}${v}%` : `${sign}${v} €`; };

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
        <p className="mb-3 pl-8 text-xs text-dim">{t("Il prezzo di partenza di ogni tipologia. Imposta qui il prezzo delle tipologie indipendenti; le derivate (es. uso singola) si creano dalla pagina Camere e seguono la madre. Vale per i giorni che non forzi dal calendario.")}</p>
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
              const srcName = derived ? (types.find((x) => x.id === rt.deriveFrom)?.name ?? "?") : "";
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
                      {derived && <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>↳ {t("derivata")} {scarto(rt)}</span>}
                      {closed && <span className="ml-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--err)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[color:var(--err)]">{t("chiusa")}</span>}
                    </div>
                    {!derived ? (
                      <label className="flex items-center gap-1 text-xs text-dim">€<input type="number" min={0} value={rt.basePrice} onFocus={(e) => e.currentTarget.select()} onChange={(e) => { const v = e.target.value; updateRoomType(rt.id, { basePrice: v === "" ? 0 : Math.max(0, Number(v)) }); }} className={`${inp} w-20`} /></label>
                    ) : (
                      <span className="text-[11px] text-faint">{t("da")} {srcName} · {t("gestisci in Camere")}</span>
                    )}
                    <div className="ml-auto text-right">
                      <div className="font-mono text-base font-bold text-txt">{eur(eff)}</div>
                      <div className="text-[10px] text-faint">{derived ? t("derivata") : t("base")} · {t("a notte")}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2 text-[11px] text-dim">
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

          {types.some((rt) => rt.deriveFrom) && (
            <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-line bg-wash px-3 py-2 text-[11px] text-dim">
              <span>{t("Le tariffe derivate (es. uso singola) si creano e si collegano dalla pagina")} <b className="text-txt">{t("Camere")}</b>.</span>
              <a href="/camere" className="shrink-0 whitespace-nowrap font-semibold text-focus hover:underline">{t("Vai a Camere")} →</a>
            </div>
          )}
        </Card>
      </section>

      {/* ② Anteprima prezzi */}
      <section>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><StepDot n={2} /><SectionTitle>{t("Anteprima prezzi")}</SectionTitle></div>
          <div className="flex items-center gap-2">
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-txt outline-none focus:border-focus">{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.adjPct >= 0 ? "+" : ""}{p.adjPct}%)</option>)}</select>
            <a href="/piani-tariffari" className="whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-focus hover:bg-wash">{t("Gestisci piani")} →</a>
          </div>
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
