"use client";

// «Qualità»: come ti vedono gli ospiti, in una pagina. Usa le recensioni che Xenora ha già (Booking.com, Airbnb ed Expedia tramite Channex, dirette dal mini-sito, manuali):
// punteggio medio, quota di 5 stelle, andamento mensile, confronto con l'anno prima, temi da migliorare e temi che piacciono, voti per canale.
// Niente numeri inventati: dove un dato non c'è si scrive «n/d». Le recensioni di Google non sono incluse finché non è collegato il profilo dell'attività.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, SectionTitle, StatCard, Button } from "@/components/ui";
import EmptyState from "@/components/EmptyState";
import { useData } from "@/lib/store";
import { apiPost } from "@/lib/invoicing/client";
import { fmtDate } from "@/lib/dates";
import { bySource, compareWindows, monthlySeries, reviewsCsv, summarize, toImprove, whatTheyLove, type QReview } from "@/lib/quality";

interface ChxRow { id: string; date: string; rating: number; text: string; source: string }
interface ChxStruct { reviews: ChxRow[]; notInstalled?: boolean; error?: string }
type ManualRow = QReview & { structureId?: string };

const SRC_LABEL: Record<string, string> = { booking: "Booking.com", airbnb: "Airbnb", expedia: "Expedia", direct: "Diretta", google: "Google", tripadvisor: "Tripadvisor" };
const fmt1 = (v: number | null | undefined) => (v == null ? "n/d" : v.toFixed(1).replace(".", ","));
const fmtPct = (v: number | null | undefined) => (v == null ? "n/d" : `${Math.round(v)}%`);
const sign = (v: number | null, unit: string, digits = 1) => (v == null ? "n/d" : `${v > 0 ? "+" : ""}${v.toFixed(digits).replace(".", ",")}${unit}`);
const tone = (v: number | null) => (v == null || Math.abs(v) < 0.05 ? "var(--dim)" : v > 0 ? "var(--ok)" : "var(--err)");

export default function QualitaPage() {
  const { structures, activeStructureId, directReviews } = useData();
  const [chx, setChx] = useState<{ loading: boolean; off: boolean; notInstalled: boolean; byStructure: Record<string, ChxStruct> }>({ loading: true, off: false, notInstalled: false, byStructure: {} });
  const [manual, setManual] = useState<ManualRow[]>([]);

  useEffect(() => {
    let alive = true;
    apiPost<{ ok: boolean; byStructure?: Record<string, ChxStruct> }>("channex/reviews", { action: "list" })
      .then((j) => { if (!alive) return; const by = j.byStructure ?? {}; setChx({ loading: false, off: !j.ok, notInstalled: Object.values(by).some((s) => s.notInstalled), byStructure: by }); })
      .catch(() => { if (alive) setChx({ loading: false, off: true, notInstalled: false, byStructure: {} }); });
    try { const m = localStorage.getItem("spigolestay:reviews:manual"); if (m) setManual(JSON.parse(m)); } catch { /* storage non disponibile */ }
    return () => { alive = false; };
  }, []);

  const all = activeStructureId === "all";
  const scopeIds = useMemo(() => (all ? structures.map((s) => s.id) : [activeStructureId]), [all, structures, activeStructureId]);

  const reviews: QReview[] = useMemo(() => {
    const out: QReview[] = [];
    for (const sid of scopeIds) for (const r of chx.byStructure[sid]?.reviews ?? []) if (["booking", "airbnb", "expedia"].includes(r.source)) out.push({ id: r.id, date: r.date, rating: r.rating, text: r.text || "", source: r.source });
    for (const r of directReviews ?? []) if (scopeIds.includes(r.structureId)) out.push({ id: r.id, date: r.date, rating: r.rating, text: r.text || "", source: "direct" });
    for (const m of manual) if (!m.structureId || scopeIds.includes(m.structureId)) out.push({ id: m.id, date: m.date, rating: m.rating, text: m.text || "", source: m.source });
    return out.filter((r) => Number.isFinite(r.rating) && r.date);
  }, [chx.byStructure, directReviews, manual, scopeIds]);

  const now = Date.now();
  const total = useMemo(() => summarize(reviews), [reviews]);
  const year = useMemo(() => compareWindows(reviews, 365, now), [reviews]); // eslint-disable-line react-hooks/exhaustive-deps
  const month = useMemo(() => compareWindows(reviews, 30, now), [reviews]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => monthlySeries(reviews, 12, now), [reviews]); // eslint-disable-line react-hooks/exhaustive-deps
  const improve = useMemo(() => toImprove(reviews, 3), [reviews]);
  const love = useMemo(() => whatTheyLove(reviews, 3), [reviews]);
  const channels = useMemo(() => bySource(reviews), [reviews]);
  const low = useMemo(() => reviews.filter((r) => r.rating < 8).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8), [reviews]);
  const maxCount = Math.max(1, ...series.map((m) => m.count));

  const exportCsv = () => {
    const blob = new Blob([reviewsCsv(reviews)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `recensioni-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  return (
    <div>
      <PageHeader title="Qualità" subtitle="Come ti vedono gli ospiti: punteggio, andamento e temi delle recensioni"
        actions={reviews.length ? <Button variant="secondary" size="sm" onClick={exportCsv}>Esporta CSV</Button> : undefined} />

      {chx.loading ? (
        <div role="status" className="py-10 text-center text-sm text-dim">Caricamento delle recensioni…</div>
      ) : reviews.length === 0 ? (
        <>
          <EmptyState
            title="Nessuna recensione da analizzare"
            sub={chx.notInstalled ? "Per vedere le recensioni di Booking.com, Airbnb ed Expedia serve attivare l'app «Messages & Reviews» su Channex per questa struttura. Intanto puoi aggiungerne a mano nella pagina Recensioni." : "Quando arriveranno recensioni (dai canali collegati, dal mini-sito o inserite a mano) le trovi qui."}
          />
          <div className="text-center"><Link href="/recensioni" className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-semibold text-txt hover:bg-wash">Vai a Recensioni</Link></div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Punteggio medio" value={<>{fmt1(total.avg10)}<span className="text-xs text-faint">/10</span></>} hint={total.avg5 != null ? `${fmt1(total.avg5)} su 5 stelle` : undefined} />
            <StatCard label="5 stelle" value={fmtPct(total.fiveStarPct)} color="var(--ok)" hint="voto 9 o più su 10" />
            <StatCard label="Recensioni" value={total.count} hint={`${year.current.count} negli ultimi 12 mesi`} />
            <StatCard label="Sotto 6 su 10" value={fmtPct(total.negativePct)} color={total.negativePct ? "var(--warn)" : "var(--ok)"} hint="quota di voti bassi" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>Confronto</SectionTitle>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-dim"><th className="py-1 font-semibold"> </th><th className="py-1 font-semibold">Ora</th><th className="py-1 font-semibold">Prima</th><th className="py-1 text-right font-semibold">Differenza</th></tr></thead>
                <tbody>
                  <tr className="border-t border-line"><td className="py-2 text-dim" colSpan={4}>Ultimi 12 mesi, contro i 12 precedenti</td></tr>
                  <tr><td className="py-1">Punteggio</td><td className="font-mono">{fmt1(year.current.avg10)}</td><td className="font-mono">{fmt1(year.previous.avg10)}</td><td className="text-right font-mono font-semibold" style={{ color: tone(year.deltaAvg10) }}>{sign(year.deltaAvg10, "")}</td></tr>
                  <tr><td className="py-1">5 stelle</td><td className="font-mono">{fmtPct(year.current.fiveStarPct)}</td><td className="font-mono">{fmtPct(year.previous.fiveStarPct)}</td><td className="text-right font-mono font-semibold" style={{ color: tone(year.deltaFiveStarPts) }}>{sign(year.deltaFiveStarPts, " pt", 0)}</td></tr>
                  <tr><td className="py-1">Recensioni</td><td className="font-mono">{year.current.count}</td><td className="font-mono">{year.previous.count}</td><td className="text-right text-dim"> </td></tr>
                  <tr className="border-t border-line"><td className="py-2 text-dim" colSpan={4}>Ultimi 30 giorni, contro i 30 precedenti</td></tr>
                  <tr><td className="py-1">Punteggio</td><td className="font-mono">{fmt1(month.current.avg10)}</td><td className="font-mono">{fmt1(month.previous.avg10)}</td><td className="text-right font-mono font-semibold" style={{ color: tone(month.deltaAvg10) }}>{sign(month.deltaAvg10, "")}</td></tr>
                  <tr><td className="py-1">Recensioni</td><td className="font-mono">{month.current.count}</td><td className="font-mono">{month.previous.count}</td><td className="text-right text-dim"> </td></tr>
                </tbody>
              </table>
              {year.previous.count === 0 && <p className="mt-2 text-xs text-dim">Non ci sono ancora recensioni più vecchie di 12 mesi: il confronto con l&apos;anno prima compare appena ci sono.</p>}
            </Card>

            <Card>
              <SectionTitle>Per canale</SectionTitle>
              <div className="space-y-2">
                {channels.map((c) => (
                  <div key={c.source} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 font-medium text-txt">{SRC_LABEL[c.source] ?? c.source}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-wash" aria-hidden><div className="h-full rounded-full" style={{ width: `${Math.round(((c.avg10 ?? 0) / 10) * 100)}%`, backgroundColor: (c.avg10 ?? 0) >= 8 ? "var(--ok)" : (c.avg10 ?? 0) >= 6 ? "var(--warn)" : "var(--err)" }} /></div>
                    <span className="w-12 text-right font-mono font-semibold">{fmt1(c.avg10)}</span>
                    <span className="w-20 text-right text-xs text-dim">{c.count} recens.</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="mt-4">
            <SectionTitle>Andamento mensile (ultimi 12 mesi)</SectionTitle>
            <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Punteggio medio e numero di recensioni per mese">
              {series.map((m) => (
                <div key={m.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${m.label}: ${m.count} recensioni, media ${fmt1(m.avg10)}`}>
                  <span className="text-[10px] font-mono text-dim">{m.avg10 == null ? "" : fmt1(m.avg10)}</span>
                  <div className="w-full rounded-t" style={{ height: `${m.count === 0 ? 2 : Math.max(6, (m.count / maxCount) * 100)}%`, backgroundColor: m.avg10 == null ? "var(--line)" : m.avg10 >= 8 ? "var(--ok)" : m.avg10 >= 6 ? "var(--warn)" : "var(--err)", opacity: m.count === 0 ? 0.4 : 0.85 }} />
                  <span className="text-[10px] text-faint">{m.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-dim">L&apos;altezza della barra è il numero di recensioni del mese, il colore il punteggio medio (verde da 8, giallo da 6, rosso sotto).</p>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>Cosa migliorare</SectionTitle>
              {improve.length === 0 ? <p className="text-sm text-dim">Nelle recensioni con voto sotto 8 non compaiono temi ricorrenti: bene così.</p> : (
                <ol className="space-y-3">
                  {improve.map((t, i) => (
                    <li key={t.key} className="flex gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-wash text-xs font-bold text-txt">{i + 1}</span>
                      <div className="min-w-0"><div className="text-sm font-semibold text-txt">{t.label} <span className="font-normal text-dim">· {t.count} {t.count === 1 ? "recensione" : "recensioni"}</span></div><div className="mt-0.5 text-xs italic text-dim">«{t.example}»</div></div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <Card>
              <SectionTitle>Cosa piace agli ospiti</SectionTitle>
              {love.length === 0 ? <p className="text-sm text-dim">Non ci sono ancora abbastanza recensioni con testo e voto alto.</p> : (
                <ol className="space-y-3">
                  {love.map((t, i) => (
                    <li key={t.key} className="flex gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-wash text-xs font-bold text-txt">{i + 1}</span>
                      <div className="min-w-0"><div className="text-sm font-semibold text-txt">{t.label} <span className="font-normal text-dim">· {t.count} {t.count === 1 ? "recensione" : "recensioni"}</span></div><div className="mt-0.5 text-xs italic text-dim">«{t.example}»</div></div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
          <p className="mt-2 text-xs text-dim">I temi sono ricavati dalle parole usate nelle recensioni (italiano e inglese): è un conteggio, non una lettura del senso. Leggi sempre le frasi originali.</p>

          {low.length > 0 && (
            <Card className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-2"><SectionTitle>Recensioni da guardare (voto sotto 8)</SectionTitle><Link href="/recensioni" className="text-xs font-semibold text-focus hover:underline">Rispondi in Recensioni →</Link></div>
              <ul className="divide-y divide-[color:var(--line)]">
                {low.map((r) => (
                  <li key={r.id} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-dim"><span className="font-mono font-semibold text-txt">{fmt1(r.rating)}/10</span><span>{SRC_LABEL[r.source] ?? r.source}</span><span>{fmtDate(r.date)}</span></div>
                    {r.text ? <div className="mt-0.5 text-txt">{r.text.length > 260 ? `${r.text.slice(0, 260)}…` : r.text}</div> : <div className="mt-0.5 text-dim">Nessun testo.</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="mt-4 text-xs text-dim">Non incluso: la percentuale «amati dagli ospiti» di Airbnb (non arriva dai canali) e le recensioni Google, finché non è collegato il profilo dell&apos;attività.</p>
        </>
      )}
    </div>
  );
}
