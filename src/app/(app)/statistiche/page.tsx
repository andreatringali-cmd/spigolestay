"use client";

import { Fragment, useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { CHANNELS, type Channel } from "@/lib/types";
import { toISO, addDays, nights } from "@/lib/dates";
import { eur, num } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import Donut from "@/components/Donut";
import Bars from "@/components/Bars";
import ColumnChart from "@/components/ColumnChart";
import { flagColor, flagGradient } from "@/lib/flags";
import ChartGallery from "@/components/ChartGallery";
import { useLang } from "@/lib/i18n";

const PALETTE = ["#BE5D38", "#7A8450", "#C08A3A", "#957A66", "#4F8A5B", "#5B74E6", "#B3453A"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const monthLabelOf = (mk: string) => { const [yy, mm] = mk.split("-").map(Number); return new Date(yy, mm - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" }); };
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });

export default function StatistichePage() {
  const { bookings, structures, units, guests, activeStructureId } = useData();
  const { t } = useLang();

  const active = bookings.filter((b) => b.status !== "cancelled" && (activeStructureId === "all" || b.structureId === activeStructureId));
  const scopedStructures = activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId);
  const scopedUnits = units.filter((u) => !u.outOfService && (activeStructureId === "all" || u.structureId === activeStructureId));
  const channels = (Object.keys(CHANNELS) as Channel[]).filter((c) => c !== "blocked");
  const chColor = (c: Channel) => `var(${CHANNELS[c].cssVar})`;

  const totalNights = active.reduce((a, b) => a + nights(b.checkIn, b.checkOut), 0);
  const totalRevenue = active.reduce((a, b) => a + (b.total ?? 0), 0);
  const adr = totalNights ? totalRevenue / totalNights : 0;

  const today = new Date();
  const s = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayISO = toISO(s);

  // ---- Filtro unico: mese selezionato (guida KPI, grafici e report previsionale) ----
  const y = today.getFullYear(), mo = today.getMonth();
  const curMonthKey = `${y}-${pad2(mo + 1)}`;
  const bks = active.filter((b) => b.channel !== "blocked");
  const monthOptions = useMemo(() => {
    const keys = bks.map((b) => b.checkIn.slice(0, 7));
    let min = keys.length ? keys.reduce((a, k) => (k < a ? k : a)) : curMonthKey;
    let max = keys.length ? keys.reduce((a, k) => (k > a ? k : a)) : curMonthKey;
    if (curMonthKey < min) min = curMonthKey;
    if (curMonthKey > max) max = curMonthKey;
    const out: string[] = []; let [Y, M] = min.split("-").map(Number); const [maxY, maxM] = max.split("-").map(Number); let g = 0;
    while ((Y < maxY || (Y === maxY && M <= maxM)) && g++ < 240) { out.push(`${Y}-${pad2(M)}`); M++; if (M > 12) { M = 1; Y++; } }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, activeStructureId, curMonthKey]);
  const [repMonth, setRepMonth] = useState(curMonthKey);
  const [rY, rM] = repMonth.split("-").map(Number); // rM 1-based
  const R = { from: `${repMonth}-01`, to: toISO(new Date(rY, rM, 1)), pfrom: toISO(new Date(rY, rM - 2, 1)), pto: toISO(new Date(rY, rM - 1, 1)), label: monthLabelOf(repMonth), cmp: t("mese prec.") };
  const daysBetween = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
  const metrics = (from: string, to: string) => {
    if (!from || !to) return { revenue: 0, roomNights: 0, count: 0, occ: 0, adr: 0, revpar: 0 };
    const days = daysBetween(from, to);
    let roomNights = 0, revenue = 0;
    for (const b of active) {
      const s2 = b.checkIn > from ? b.checkIn : from;
      const e2 = b.checkOut < to ? b.checkOut : to;
      const nInP = Math.max(0, Math.round((new Date(e2).getTime() - new Date(s2).getTime()) / 86400000));
      if (nInP <= 0) continue;
      if (b.unitId) roomNights += nInP;
      revenue += (b.total ?? 0) * (nInP / Math.max(1, nights(b.checkIn, b.checkOut)));
    }
    const arrivals = active.filter((b) => b.checkIn >= from && b.checkIn < to).length;
    const occ = scopedUnits.length ? roomNights / (scopedUnits.length * days) : 0;
    return { revenue: Math.round(revenue), roomNights, count: arrivals, occ, adr: roomNights ? revenue / roomNights : 0, revpar: scopedUnits.length ? revenue / (scopedUnits.length * days) : 0 };
  };
  const cur = metrics(R.from, R.to);
  const prev = metrics(R.pfrom, R.pto);
  const delta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : a > 0 ? 100 : 0);

  // Prenotazioni con arrivo nel mese selezionato → base di tutti i grafici categoriali.
  const monthArr = active.filter((b) => b.channel !== "blocked" && b.checkIn >= R.from && b.checkIn < R.to);
  const monthRevenue = monthArr.reduce((a, b) => a + (b.total ?? 0), 0);

  // Ricavi per canale (mese)
  const revenueByChannel = channels.map((c) => ({ label: CHANNELS[c].label, value: monthArr.filter((b) => b.channel === c).reduce((a, b) => a + (b.total ?? 0), 0), color: chColor(c) })).filter((x) => x.value > 0);

  // Occupazione per giorno della settimana (media sui giorni del mese selezionato) → colonne verticali
  const wd = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  const wdAgg = Array.from({ length: 7 }, () => ({ sum: 0, cnt: 0 }));
  {
    const [wy, wm] = repMonth.split("-").map(Number);
    const dim = new Date(wy, wm, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      const iso = `${repMonth}-${pad2(d)}`;
      const occ = active.filter((b) => b.unitId && b.channel !== "blocked" && scopedUnits.some((u) => u.id === b.unitId) && b.checkIn <= iso && iso < b.checkOut).length;
      const pct = scopedUnits.length ? Math.round((occ / scopedUnits.length) * 100) : 0;
      const w = new Date(iso).getDay();
      wdAgg[w].sum += pct; wdAgg[w].cnt++;
    }
  }
  const weekday = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ label: t(wd[w]), value: wdAgg[w].cnt ? Math.round(wdAgg[w].sum / wdAgg[w].cnt) : 0 }));

  // Provenienza per paese (mese)
  const countryMap: Record<string, number> = {};
  monthArr.forEach((b) => { const c = guests.find((g) => g.id === b.guestId)?.country ?? "—"; countryMap[c] = (countryMap[c] || 0) + 1; });
  const byCountry = Object.entries(countryMap).map(([k, v]) => ({ label: k, value: v, color: flagColor(k), fill: flagGradient(k) }));

  // Durata soggiorno (mese)
  const buckets: Record<string, number> = { "1 notte": 0, "2 notti": 0, "3 notti": 0, "4+ notti": 0 };
  monthArr.forEach((b) => { const n = nights(b.checkIn, b.checkOut); if (n <= 1) buckets["1 notte"]++; else if (n === 2) buckets["2 notti"]++; else if (n === 3) buckets["3 notti"]++; else buckets["4+ notti"]++; });
  const stayDist = Object.entries(buckets).map(([k, v]) => ({ label: t(k), value: v, color: "var(--focus)" }));

  // Ricavi per struttura (mese)
  const revByStructure = scopedStructures.map((st) => ({ label: st.name, value: monthArr.filter((b) => b.structureId === st.id).reduce((a, b) => a + (b.total ?? 0), 0), color: "var(--ok)", fmt: eur }));

  // ---- Report previsionale (stile Octorate): giorno per giorno, storico + previsione (usa il mese selezionato in alto) ----
  const rep = useMemo(() => {
    const [Y, M] = repMonth.split("-").map(Number);
    const dim = new Date(Y, M, 0).getDate();
    const out: { iso: string; storico: boolean; camere: number; occ: number; arrivi: number; partenze: number; ospiti: number; adr: number; lordo: number; commissioni: number }[] = [];
    for (let d = 1; d <= dim; d++) {
      const iso = `${repMonth}-${pad2(d)}`;
      const occBks = bks.filter((b) => b.checkIn <= iso && iso < b.checkOut);
      const camere = occBks.filter((b) => b.unitId).length;
      const lordo = Math.round(occBks.reduce((a, b) => a + (b.total ? b.total / nights(b.checkIn, b.checkOut) : 0), 0));
      const commissioni = Math.round(occBks.reduce((a, b) => { const nightly = b.total ? b.total / nights(b.checkIn, b.checkOut) : 0; const pct = b.commissionPct ?? CHANNELS[b.channel].commission * 100; return a + (nightly * pct) / 100; }, 0));
      const ospiti = occBks.reduce((a, b) => a + b.adults + b.children, 0);
      const arrivi = bks.filter((b) => b.checkIn === iso).length;
      const partenze = bks.filter((b) => b.checkOut === iso).length;
      out.push({ iso, storico: iso < todayISO, camere, occ: scopedUnits.length ? camere / scopedUnits.length : 0, arrivi, partenze, ospiti, adr: camere ? lordo / camere : 0, lordo, commissioni });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repMonth, bookings, activeStructureId, scopedUnits.length]);

  const repSum = (pred: (r: (typeof rep)[number]) => boolean) => {
    const rows = rep.filter(pred);
    const camere = rows.reduce((a, r) => a + r.camere, 0);
    const lordo = rows.reduce((a, r) => a + r.lordo, 0);
    const commissioni = rows.reduce((a, r) => a + r.commissioni, 0);
    const days = rows.length;
    return { days, camere, arrivi: rows.reduce((a, r) => a + r.arrivi, 0), partenze: rows.reduce((a, r) => a + r.partenze, 0), ospiti: rows.reduce((a, r) => a + r.ospiti, 0), adr: camere ? lordo / camere : 0, lordo, commissioni, netto: lordo - commissioni, occ: scopedUnits.length && days ? camere / (scopedUnits.length * days) : 0 };
  };
  const totStorico = repSum((r) => r.storico);
  const totPrevis = repSum((r) => !r.storico);
  const totAll = repSum(() => true);
  const repDayLabel = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });

  // Galleria grafici (4 per pagina, frecce per scorrere)
  // Con una sola struttura selezionata i grafici "per struttura" non hanno senso: si nascondono.
  const singleStruct = activeStructureId !== "all" || structures.length <= 1;
  const charts = [
    { key: "rev-ch", title: t("Ricavi per canale (mese)"), node: <Donut data={revenueByChannel} center={`€ ${num(monthRevenue)}`} format={(n) => eur(n)} /> },
    { key: "weekday", title: t("Occupazione per giorno settimana"), node: <ColumnChart bars={weekday} format={(n) => `${n}%`} /> },
    { key: "country", title: t("Provenienza ospiti per paese"), node: <ColumnChart bars={byCountry} barWidth={44} labelColor="var(--txt)" /> },
    { key: "stay", title: t("Durata del soggiorno"), node: <Bars items={stayDist} /> },
    { key: "rev-str", title: t("Ricavi per struttura"), perStructure: true, node: <Bars items={revByStructure} /> },
  ].filter((c) => !(singleStruct && c.perStructure));

  return (
    <div>
      <PageHeader title={t("Statistiche")} subtitle={t("Andamento e report previsionale del mese selezionato")} />

      {/* KPI del mese selezionato con confronto sul mese precedente */}
      <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiD label={t("Notti vendute")} value={String(cur.roomNights)} d={prev ? delta(cur.roomNights, prev.roomNights) : null} cmp={R.cmp} />
        <KpiD label={t("Occupazione")} value={`${Math.round(cur.occ * 100)}%`} d={prev ? delta(cur.occ, prev.occ) : null} cmp={R.cmp} />
        <KpiD label="ADR" value={eur(cur.adr)} d={prev ? delta(cur.adr, prev.adr) : null} cmp={R.cmp} />
        <KpiD label="RevPAR" value={eur(cur.revpar)} d={prev ? delta(cur.revpar, prev.revpar) : null} cmp={R.cmp} />
        <KpiD label={t("Ricavi")} value={eur(cur.revenue)} d={prev ? delta(cur.revenue, prev.revenue) : null} cmp={R.cmp} />
      </div>
      <p className="mt-2 text-xs text-faint">{t("Valori riferiti a")} <b className="text-dim">{R.label.toLowerCase()}</b>{prev ? ` · ${t("confronto con")} ${R.cmp}` : ""}. {t("Complessivo storico: ricavi")} {eur(totalRevenue)} · ADR {eur(adr)} · {totalNights} {t("notti")}.</p>

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">Grafici</span>
          <span className="ml-auto text-[11px] text-faint">Scorri per vederli tutti →</span>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {charts.map((c) => (
            <div key={c.key} className="flex min-w-[260px] shrink-0 grow basis-[calc(20%-13px)] flex-col rounded-xl border border-line bg-surface p-4 shadow-sm">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">{c.title}</div>
              <div className="flex-1">{c.node}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Riga filtro: mese unico che guida KPI e report */}
      <div className="mt-8 mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
        <span className="text-sm font-semibold text-txt">{t("Mese")}</span>
        <select value={repMonth} onChange={(e) => setRepMonth(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm capitalize text-txt outline-none focus:border-focus">
          {monthOptions.map((mk) => <option key={mk} value={mk} className="capitalize">{monthLabelOf(mk)}</option>)}
        </select>
        <span className="ml-auto text-xs text-faint">{t("Card e report seguono il mese scelto")}</span>
      </div>

      {/* Report previsionale (stile Octorate): giorno per giorno, storico + previsione */}
      <div>
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <h2 className="font-display text-lg font-bold text-txt">{t("Report previsionale")}</h2>
          <span className="text-sm capitalize text-dim">· {monthLabelOf(repMonth)}</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <div style={{ minWidth: 1000 }}>
            {/* Corpo scorrevole con intestazione fissa */}
            <div className="max-h-[54vh] overflow-y-auto">
              <table className="w-full table-fixed text-sm">
                <RepCols />
                <thead className="sticky top-0 z-10">
                  <tr className="bg-wash text-left text-xs uppercase tracking-wide text-faint shadow-[0_1px_0_var(--line)]">
                    <th className="px-3 py-2 font-semibold">{t("Giorno")}</th>
                    <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("Camere")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("Occup.")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("Arrivi")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("Part.")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("Ospiti")}</th>
                    <th className="px-3 py-2 text-right font-semibold">ADR</th>
                    <th className="px-3 py-2 text-right font-semibold">Revenue</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("Commiss.")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("Netto")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.map((r) => {
                    const isToday = r.iso === todayISO;
                    return (
                      <tr key={r.iso} className={`border-b border-line last:border-0 ${isToday ? "bg-[color:color-mix(in_srgb,var(--focus)_8%,transparent)]" : r.storico ? "" : "bg-[color:color-mix(in_srgb,var(--ok)_4%,transparent)]"}`}>
                        <td className="truncate px-3 py-2 font-medium capitalize text-txt">{repDayLabel(r.iso)}{isToday && <span className="ml-1.5 rounded-full bg-focus px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">{t("oggi")}</span>}</td>
                        <td className="px-3 py-2"><span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={r.storico ? { backgroundColor: "color-mix(in srgb, var(--faint) 20%, transparent)", color: "var(--dim)" } : { backgroundColor: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "var(--ok)" }}>{r.storico ? t("Storico") : t("Previsione")}</span></td>
                        <td className="px-3 py-2 text-right font-mono text-dim">{r.camere}/{scopedUnits.length}</td>
                        <td className="px-3 py-2 text-right font-mono text-dim">{Math.round(r.occ * 100)}%</td>
                        <td className="px-3 py-2 text-right font-mono text-dim">{r.arrivi || ""}</td>
                        <td className="px-3 py-2 text-right font-mono text-dim">{r.partenze || ""}</td>
                        <td className="px-3 py-2 text-right font-mono text-dim">{r.ospiti || ""}</td>
                        <td className="px-3 py-2 text-right font-mono text-dim">{r.camere ? eur(r.adr) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-txt">{eur(r.lordo)}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: r.commissioni > 0 ? "var(--warn)" : "var(--faint)" }}>{r.commissioni ? `−${eur(r.commissioni)}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: "var(--ok)" }}>{eur(r.lordo - r.commissioni)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Totali sempre visibili */}
            <table className="w-full table-fixed border-t-2 border-line text-sm">
              <RepCols />
              <tbody>
                <tr><td colSpan={11} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: "#2C8A8A" }}>{t("Totali")}</td></tr>
                {([["Somma storico", totStorico, "var(--dim)"], ["Somma previsione", totPrevis, "var(--ok)"], ["Totale", totAll, "var(--txt)"]] as const).map(([lab, tt, col], i) => (
                  <tr key={lab} className={`border-t border-line ${i === 2 ? "bg-wash font-bold" : "font-medium"}`}>
                    <td className="truncate px-3 py-2" colSpan={2} style={{ color: col }}>{t(lab)}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{tt.camere}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{Math.round(tt.occ * 100)}%</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{tt.arrivi}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{tt.partenze}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{tt.ospiti}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{tt.camere ? eur(tt.adr) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-txt">{eur(tt.lordo)}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--warn)" }}>{tt.commissioni ? `−${eur(tt.commissioni)}` : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-[color:var(--ok)]">{eur(tt.netto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-xs text-faint"><b className="text-dim">{t("Storico")}</b> {t("= giorni già passati")} · <b className="text-dim">{t("Previsione")}</b> {t("= giorni futuri")}. {t("Tutte le prenotazioni prese e confermate valgono come ricavo pieno (come se tutto fosse incassato). Gli incassi effettivi sono nella sezione")} <b className="text-dim">{t("Incassi")}</b>.</p>
      </div>
    </div>
  );
}

function RepCols() {
  const w = [118, 100, 84, 84, 70, 70, 74, 84, 104, 106, 106];
  return <colgroup>{w.map((x, i) => <col key={i} style={{ width: x }} />)}</colgroup>;
}

function KpiD({ label, value, d, cmp }: { label: string; value: string; d: number | null; cmp: string }) {
  const up = (d ?? 0) >= 0;
  const color = d == null ? "var(--faint)" : up ? "var(--ok)" : "var(--err)";
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold tabular-nums text-txt">{value}</div>
      {d != null && (
        <div className="mt-1 flex items-center gap-1 text-[11px]" style={{ color }}>
          <span>{up ? "▲" : "▼"}</span><span className="font-semibold">{Math.abs(d)}%</span><span className="text-faint">vs {cmp}</span>
        </div>
      )}
    </div>
  );
}

