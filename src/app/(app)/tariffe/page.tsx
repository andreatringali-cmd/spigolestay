"use client";

import { Fragment, useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { addDays, isWeekend, toISO, weekdayShort } from "@/lib/dates";
import type { RoomType } from "@/lib/types";
import { effectiveBase, effectiveMinStay, effectiveClosed, loadWeekendOn } from "@/lib/pricing";
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
  const [weekendOn, setWeekendOnState] = useState(true);
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
      setWeekendOnState(loadWeekendOn());
    } catch {}
  }, []);
  const saveWeekend = (v: number) => { setWeekendPct(v); try { localStorage.setItem(RULES_KEY, JSON.stringify({ weekendPct: v, weekendOn })); } catch {} };
  const setWeekendOn = (on: boolean) => { setWeekendOnState(on); try { localStorage.setItem(RULES_KEY, JSON.stringify({ weekendPct, weekendOn: on })); } catch {} };

  const start = new Date();
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const days = Array.from({ length: DAYS }, (_, i) => addDays(s, i));
  const types = roomTypes.filter((rt) => effStructure === "all" || rt.structureId === effStructure);
  const activePlan = plans.find((p) => p.id === planId) ?? plans[0];

  // Prezzo del giorno per una tipologia: override calendario → base derivata → +weekend, poi piano.
  const dayPrice = (rt: RoomType, d: Date) => {
    const iso = toISO(d);
    const base = effectiveBase(rt, roomTypes);
    const raw = rateOverrides[`${rt.id}|${iso}`] ?? rateOverrides[iso] ?? Math.round(base * (isWeekend(d) && weekendOn ? 1 + weekendPct / 100 : 1));
    return Math.max(0, Math.round(raw * (1 + (activePlan?.adjPct ?? 0) / 100)));
  };

  // Scarto della derivata rispetto alla madre (mostrato come info nella lista prezzi base).
  const scarto = (rt: RoomType) => { const v = rt.deriveValue ?? 0; const sign = v >= 0 ? "+" : ""; return rt.deriveMode === "percent" ? `${sign}${v}%` : `${sign}${v} €`; };
  // Nome struttura di una tipologia — mostrato in vista "tutte le strutture" per distinguere
  // tipologie omonime (es. due "Deluxe" di strutture diverse) che altrimenti sono indistinguibili.
  const structureNameOf = (structureId: string) => structures.find((st) => st.id === structureId)?.name ?? "—";

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
    const motherRt = derived ? types.find((x) => x.id === rt.deriveFrom) : undefined;
    const srcName = derived ? (motherRt?.name ?? "?") : "";
    // Una derivata condivide le camere FISICHE della madre (stessa stanza, prezzo diverso):
    // l'occupazione massima non può essere diversa, quindi segue sempre quella della madre.
    const occ = derived ? (motherRt?.maxOccupancy ?? motherRt?.beds ?? rt.beds) : (rt.maxOccupancy ?? rt.beds);
    const inheriting = derived && !!rt.deriveInherit;
    const minS = inheriting ? effectiveMinStay(rt, roomTypes) : (rt.minStay ?? 0);
    const closed = inheriting ? effectiveClosed(rt, roomTypes) : !!rt.salesClosed;
    return (
      <tr key={rt.id} className={`border-b border-line last:border-0 hover:bg-wash ${derived ? "bg-[color:color-mix(in_srgb,var(--focus)_4%,transparent)]" : ""}`}>
        <td className="px-3 py-2.5">
          <div className={derived ? "pl-7" : ""}>
            <div className="flex flex-wrap items-center gap-1.5">
              {!derived && (kids.length > 0
                ? <button onClick={() => toggleMaster(rt.id)} title={isOpen ? t("Comprimi") : t("Espandi")} className="shrink-0"><Chevron open={isOpen} /></button>
                : <span className="inline-block w-3 shrink-0" />)}
              <span className="h-5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: typeColor(rt) }} />
              <span className="font-semibold text-txt">{rt.name}</span>
              <Occ n={occ} />
              {derived
                ? <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>↳ {t("derivata")} {scarto(rt)}</span>
                : <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-dim">master</span>}
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5">
          {!derived
            ? <label className="flex items-center gap-1 text-xs text-dim">€<input type="number" min={0} value={rt.basePrice} onFocus={(e) => e.currentTarget.select()} onChange={(e) => { const v = e.target.value; updateRoomType(rt.id, { basePrice: v === "" ? 0 : Math.max(0, Number(v)) }); }} className={`${inp} w-24`} /></label>
            : <span className="text-xs text-faint">{t("da")} {srcName}</span>}
        </td>
        <td className="px-3 py-2.5 text-center">
          {!derived
            ? <input type="number" min={1} value={occ} onFocus={(e) => e.currentTarget.select()} onChange={(e) => updateRoomType(rt.id, { maxOccupancy: Math.max(1, Number(e.target.value)) })} className={`${inp} w-14 py-1 text-center`} />
            : <span className="text-xs text-faint" title={t("Stessa camera della madre: l'occupazione segue sempre la sua")}>{occ} <span className="text-faint">({t("da madre")})</span></span>}
        </td>
        <td className="px-3 py-2.5 text-center"><input type="number" min={0} disabled={inheriting} value={minS} onFocus={(e) => e.currentTarget.select()} onChange={(e) => updateRoomType(rt.id, { minStay: Math.max(0, Number(e.target.value)) })} className={`${inp} w-14 py-1 text-center disabled:opacity-40`} /></td>
        <td className="px-3 py-2.5">
          <button disabled={inheriting} onClick={() => updateRoomType(rt.id, { salesClosed: !closed })} className="rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40" style={{ backgroundColor: `color-mix(in srgb, ${closed ? "var(--err)" : "var(--ok)"} 15%, transparent)`, color: closed ? "var(--err)" : "var(--ok)" }}>{closed ? t("Chiuse") : t("Aperte")}</button>
          {inheriting && <span className="ml-1 text-xs text-faint">{t("da madre")}</span>}
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
              <div className="text-[10px] text-faint">
                {effStructure === "all" ? `${structureNameOf(rt.structureId)} · ` : ""}{t("base")} {eur(base)}{derived ? ` · ${t("der.")}` : ""}
              </div>
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
                ? <span className="font-mono text-sm font-bold tabular-nums text-txt" title={t("Tariffa forzata dal calendario")}>{dayPrice(rt, d)}<sup className="ml-0.5 text-[9px] font-bold not-italic" style={{ color: "var(--focus)" }}>€</sup></span>
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

      {/* Come nasce il prezzo — catena essenziale, un colore diverso per passaggio invece di
          quattro pillole grigie identiche: si legge come un percorso, non come un elenco piatto. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-sm">
        <span className="mr-1 font-semibold uppercase tracking-wide text-faint">{t("Come nasce il prezzo")}</span>
        {([
          [t("Prezzo base"), "#5B74E6"],
          [t("Regola weekend"), "#C08A3A"],
          [t("Prezzo del giorno"), "#4F8A5B"],
          [t("Piano tariffario"), "#B3453A"],
        ] as const).map(([h, col], i, arr) => (
          <span key={h} className="flex items-center gap-1.5">
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: col }}>{h}</span>
            {i < arr.length - 1 && <span className="text-faint">→</span>}
          </span>
        ))}
      </div>

      {/* Prezzi base — un box per struttura quando la vista è "tutte le strutture", una tabella
          sola quando ne è selezionata una: evita di dover leggere l'etichetta struttura riga per riga. */}
      <section className="mb-6">
        <SectionTitle>{t("Prezzi base")}</SectionTitle>

        {(() => {
          const baseTable = (rootsForBox: RoomType[]) => (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: "30%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "14%" }} />
                  </colgroup>
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
                    {rootsForBox.map((m) => (
                      <Fragment key={m.id}>
                        {baseRow(m)}
                        {openMasters.has(m.id) && descendantsOf(m.id).map((k) => baseRow(k))}
                      </Fragment>
                    ))}
                    {rootsForBox.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-faint">{t("Nessuna tipologia.")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          );
          if (effStructure !== "all") return baseTable(roots);
          const structsWithTypes = structures.filter((st) => roots.some((r) => r.structureId === st.id));
          if (structsWithTypes.length === 0) return baseTable([]);
          return (
            <div className="flex flex-col gap-5">
              {structsWithTypes.map((st, i) => (
                <div key={st.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: AV_COLORS[i % AV_COLORS.length] }} />
                    <span className="font-display text-sm font-bold text-txt">{st.name}</span>
                  </div>
                  {baseTable(roots.filter((r) => r.structureId === st.id))}
                </div>
              ))}
            </div>
          );
        })()}

        {/* Regola weekend */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-sm">
          <button type="button" onClick={() => setWeekendOn(!weekendOn)} aria-pressed={weekendOn} title={weekendOn ? t("Disattiva la maggiorazione weekend") : t("Attiva la maggiorazione weekend")} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: weekendOn ? "var(--ok)" : "var(--line)" }}>
            <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: weekendOn ? "22px" : "2px" }} />
          </button>
          <span className={`font-semibold ${weekendOn ? "text-txt" : "text-faint"}`}>📅 {t("Maggiorazione weekend")}</span>
          <span className="flex items-center gap-1"><input type="number" value={weekendPct} disabled={!weekendOn} onFocus={(e) => e.currentTarget.select()} onChange={(e) => saveWeekend(Number(e.target.value))} className={`${inp} w-20 disabled:opacity-40`} /><span className="text-dim">%</span></span>
          <span className="text-xs text-faint">{weekendOn ? t("su ven/sab/dom, se non c'è un prezzo forzato dal calendario") : t("spenta: nessuna maggiorazione applicata nel weekend")}</span>
        </div>
      </section>

      {/* Anteprima prezzi */}
      <section>
        <SectionTitle>{t("Anteprima prezzi")}</SectionTitle>
        {/* Legenda + azioni: tutto in un'unica riga */}
        <div className="mb-2.5 mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-sm">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-line bg-wash" /> {t("weekend")}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 22%, transparent)" }} /> {t("oggi")}</span>
          <span className="flex items-center gap-1.5"><span className="rounded px-1 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 16%, transparent)", color: "var(--focus)" }}>€</span> {t("prezzo forzato dal calendario")}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {types.some((rt) => rt.deriveFrom) && <a href="/tariffe-derivate" className="whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-sm font-medium text-focus hover:bg-wash">{t("Tariffe derivate")} →</a>}
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-txt outline-none focus:border-focus">{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.adjPct >= 0 ? "+" : ""}{p.adjPct}%)</option>)}</select>
            <a href="/piani-tariffari" className="whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-sm font-medium text-focus hover:bg-wash">{t("Gestisci piani")} →</a>
          </div>
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
      </section>
    </div>
  );
}
