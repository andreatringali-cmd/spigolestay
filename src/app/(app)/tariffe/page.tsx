"use client";

import { Fragment, useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { addDays, isWeekend, toISO, weekdayShort } from "@/lib/dates";
import type { RoomType } from "@/lib/types";
import { effectiveBase, effectiveMinStay, effectiveClosed } from "@/lib/pricing";
import { AV_COLORS } from "@/lib/users";
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
  const [openMasters, setOpenMasters] = useState<Set<string>>(new Set()); // vuoto = derivate chiuse (a tendina)
  const toggleMaster = (id: string) => setOpenMasters((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
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

  // Albero: derivate annidate sotto la madre, a tendina.
  const childrenOf = (id: string) => types.filter((x) => x.deriveFrom === id);
  const descendantsOf = (id: string): RoomType[] => { const out: RoomType[] = []; const walk = (pid: string) => childrenOf(pid).forEach((c) => { out.push(c); walk(c.id); }); walk(id); return out; };
  const roots = types.filter((rt) => !rt.deriveFrom || !types.some((x) => x.id === rt.deriveFrom));
  // Colore identità della camera (come nel calendario): colore tipologia o palette per indice.
  const typeColor = (rt: RoomType) => rt.color ?? AV_COLORS[Math.max(0, types.findIndex((x) => x.id === rt.id)) % AV_COLORS.length];
  const Chevron = ({ open }: { open: boolean }) => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-faint transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}><polyline points="9 18 15 12 9 6" /></svg>;

  // Riga tabella "Prezzi base" (madre o derivata)
  const baseRow = (rt: RoomType) => {
    const derived = !!rt.deriveFrom;
    const kids = childrenOf(rt.id);
    const isOpen = openMasters.has(rt.id);
    const eff = effectiveBase(rt, roomTypes);
    const srcName = derived ? (types.find((x) => x.id === rt.deriveFrom)?.name ?? "?") : "";
    const inheriting = derived && !!rt.deriveInherit;
    const minS = inheriting ? effectiveMinStay(rt, roomTypes) : (rt.minStay ?? 0);
    const closed = inheriting ? effectiveClosed(rt, roomTypes) : !!rt.salesClosed;
    return (
      <tr key={rt.id} className={`border-b border-line last:border-0 hover:bg-wash ${derived ? "bg-[color:color-mix(in_srgb,var(--focus)_4%,transparent)]" : ""}`}>
        <td className="px-3 py-2.5">
          <div className={`flex flex-wrap items-center gap-1.5 ${derived ? "pl-7" : ""}`}>
            {!derived && (kids.length > 0
              ? <button onClick={() => toggleMaster(rt.id)} title={isOpen ? t("Comprimi") : t("Espandi")} className="shrink-0"><Chevron open={isOpen} /></button>
              : <span className="inline-block w-3 shrink-0" />)}
            <span className="h-5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: typeColor(rt) }} />
            <span className="font-semibold text-txt">{rt.name}</span>
            <Occ n={rt.maxOccupancy ?? rt.beds} />
            {derived
              ? <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>↳ {t("derivata")} {scarto(rt)}</span>
              : <span className="rounded-full bg-wash px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-dim">master</span>}
          </div>
        </td>
        <td className="px-3 py-2.5">
          {!derived
            ? <label className="flex items-center gap-1 text-xs text-dim">€<input type="number" min={0} value={rt.basePrice} onFocus={(e) => e.currentTarget.select()} onChange={(e) => { const v = e.target.value; updateRoomType(rt.id, { basePrice: v === "" ? 0 : Math.max(0, Number(v)) }); }} className={`${inp} w-24`} /></label>
            : <span className="text-[11px] text-faint">{t("da")} {srcName}</span>}
        </td>
        <td className="px-3 py-2.5 text-center"><input type="number" min={1} value={rt.maxOccupancy ?? rt.beds} onFocus={(e) => e.currentTarget.select()} onChange={(e) => updateRoomType(rt.id, { maxOccupancy: Math.max(1, Number(e.target.value)) })} className={`${inp} w-14 py-1 text-center`} /></td>
        <td className="px-3 py-2.5 text-center"><input type="number" min={0} disabled={inheriting} value={minS} onFocus={(e) => e.currentTarget.select()} onChange={(e) => updateRoomType(rt.id, { minStay: Math.max(0, Number(e.target.value)) })} className={`${inp} w-14 py-1 text-center disabled:opacity-40`} /></td>
        <td className="px-3 py-2.5">
          <button disabled={inheriting} onClick={() => updateRoomType(rt.id, { salesClosed: !closed })} className="rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40" style={{ backgroundColor: `color-mix(in srgb, ${closed ? "var(--err)" : "var(--ok)"} 15%, transparent)`, color: closed ? "var(--err)" : "var(--ok)" }}>{closed ? t("Chiuse") : t("Aperte")}</button>
          {inheriting && <span className="ml-1 text-[10px] text-faint">{t("da madre")}</span>}
        </td>
        <td className="px-3 py-2.5 text-right"><span className="font-mono text-base font-bold text-txt">{eur(eff)}</span><span className="text-[10px] text-faint">/{t("notte")}</span></td>
      </tr>
    );
  };

  // Riga tabella "Anteprima prezzi" (madre o derivata)
  const prevRow = (rt: RoomType) => {
    const base = effectiveBase(rt, roomTypes);
    const color = typeColor(rt);
    const derived = !!rt.deriveFrom;
    const kids = childrenOf(rt.id);
    const isOpen = openMasters.has(rt.id);
    return (
      <tr key={rt.id} className="group border-b border-line last:border-0">
        <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 group-hover:bg-wash">
          <div className={`flex items-center gap-2 ${derived ? "pl-6" : ""}`}>
            {!derived && (kids.length > 0
              ? <button onClick={() => toggleMaster(rt.id)} title={isOpen ? t("Comprimi") : t("Espandi")} className="shrink-0"><Chevron open={isOpen} /></button>
              : <span className="inline-block w-3 shrink-0" />)}
            <span className="h-6 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <div>
              <div className="text-sm font-medium text-txt">{rt.name}</div>
              <div className="text-[10px] text-faint">{t("base")} {eur(base)}{derived ? ` · ${t("der.")}` : ""}</div>
            </div>
          </div>
        </td>
        {days.map((d) => {
          const iso = toISO(d);
          const forced = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso];
          const isToday = iso === toISO(s);
          const we = isWeekend(d);
          return (
            <td key={iso} className="px-2 py-2.5 text-center group-hover:bg-[color:color-mix(in_srgb,var(--focus)_5%,transparent)]" style={isToday ? { backgroundColor: "color-mix(in srgb, var(--focus) 8%, transparent)" } : we ? { backgroundColor: "var(--wash)" } : undefined}>
              {forced != null
                ? <span className="inline-block rounded px-1.5 py-0.5 font-mono text-sm font-bold tabular-nums" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 16%, transparent)", color: "var(--focus)" }} title={t("Tariffa forzata dal calendario")}>{dayPrice(rt, d)}</span>
                : <span className="font-mono text-sm tabular-nums text-txt">{dayPrice(rt, d)}</span>}
            </td>
          );
        })}
      </tr>
    );
  };

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

      {/* Come nasce il prezzo — catena essenziale */}
      <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-xs shadow-sm">
        <span className="font-semibold uppercase tracking-wide text-faint">{t("Come nasce il prezzo")}</span>
        {([t("Prezzo base"), t("Regola weekend"), t("Prezzo del giorno"), t("Piano tariffario")]).map((h, i, arr) => (
          <span key={h} className="flex items-center gap-2">
            <span className="rounded-full bg-wash px-2.5 py-1 font-medium text-txt">{h}</span>
            {i < arr.length - 1 && <span style={{ color: "var(--focus)" }}>→</span>}
          </span>
        ))}
      </div>

      {/* Prezzi base */}
      <section className="mb-7">
        <SectionTitle>{t("Prezzi base")}</SectionTitle>

        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-3 py-2.5 font-semibold">{t("Tipologia")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("Prezzo base")}</th>
                  <th className="px-3 py-2.5 text-center font-semibold">{t("Ospiti")}</th>
                  <th className="px-3 py-2.5 text-center font-semibold">{t("Notti min.")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("Vendite")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("Effettivo")}</th>
                </tr>
              </thead>
              <tbody>
                {roots.map((m) => (
                  <Fragment key={m.id}>
                    {baseRow(m)}
                    {openMasters.has(m.id) && descendantsOf(m.id).map((k) => baseRow(k))}
                  </Fragment>
                ))}
                {types.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-faint">{t("Nessuna tipologia.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Regola weekend */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm shadow-sm">
          <span className="font-semibold text-txt">📅 {t("Maggiorazione weekend")}</span>
          <span className="flex items-center gap-1"><input type="number" value={weekendPct} onFocus={(e) => e.currentTarget.select()} onChange={(e) => saveWeekend(Number(e.target.value))} className={`${inp} w-20`} /><span className="text-dim">%</span></span>
          <span className="text-[11px] text-faint">{t("su ven/sab/dom, se non c'è un prezzo forzato dal calendario")}</span>
        </div>

        {types.some((rt) => rt.deriveFrom) && (
          <div className="mt-3 flex justify-end">
            <a href="/tariffe-derivate" className="text-[11px] font-semibold text-focus hover:underline">{t("Tariffe derivate")} →</a>
          </div>
        )}
      </section>

      {/* Anteprima prezzi */}
      <section>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>{t("Anteprima prezzi")}</SectionTitle>
          <div className="flex items-center gap-2">
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-txt outline-none focus:border-focus">{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.adjPct >= 0 ? "+" : ""}{p.adjPct}%)</option>)}</select>
            <a href="/piani-tariffari" className="whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-focus hover:bg-wash">{t("Gestisci piani")} →</a>
          </div>
        </div>
        <p className="mb-2 text-xs text-dim">{t("Cosa vedrebbe l'ospite, giorno per giorno, con il piano scelto.")}</p>
        {/* Legenda */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-line bg-wash" /> {t("weekend")}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 22%, transparent)" }} /> {t("oggi")}</span>
          <span className="flex items-center gap-1.5"><span className="rounded px-1 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 16%, transparent)", color: "var(--focus)" }}>€</span> {t("prezzo forzato dal calendario")}</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-wash px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-faint">{t("Tipologia")}</th>
                {days.map((d) => {
                  const isToday = toISO(d) === toISO(s);
                  const we = isWeekend(d);
                  const dow = d.getDay(); // 0 = domenica, 6 = sabato
                  const first = d.getDate() === 1 || toISO(d) === toISO(days[0]);
                  return (
                    <th key={toISO(d)} className="px-2 py-2 text-center text-xs font-medium" style={isToday ? { backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)" } : we ? { backgroundColor: "var(--wash)" } : undefined}>
                      <div className="font-semibold" style={{ color: dow === 6 ? "#E08A3A" : dow === 0 ? "var(--err)" : we ? "var(--dim)" : "var(--faint)" }}>{weekdayShort(d)}</div>
                      <div className="font-mono font-semibold text-txt">{d.getDate()}</div>
                      {first && <div className="text-[9px] uppercase text-faint">{d.toLocaleDateString("it-IT", { month: "short" })}</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {roots.map((m) => (
                <Fragment key={m.id}>
                  {prevRow(m)}
                  {openMasters.has(m.id) && descendantsOf(m.id).map((k) => prevRow(k))}
                </Fragment>
              ))}
              {types.length === 0 && <tr><td colSpan={DAYS + 1} className="px-3 py-4 text-center text-sm text-faint">{t("Nessuna tipologia.")}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">{t("Il prezzo applica il piano selezionato al prezzo del giorno (base + regole, oppure la tariffa forzata dal calendario). Imposti i prezzi specifici per data dal")} <b className="text-focus">{t("Calendario")}</b>.</p>
      </section>
    </div>
  );
}
