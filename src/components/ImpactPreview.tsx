"use client";

// Anteprima dell'impatto in € di una variazione di tariffe, mostrata PRIMA di applicarla.
// Usata da Revenue, Autopilot e Nèttare. I numeri arrivano da lib/revenue-impact.ts e sono
// calcolati sulle camere ancora libere (le prenotazioni già confermate non cambiano prezzo).
import { eur } from "@/lib/format";
import type { ImpactSummary } from "@/lib/revenue-impact";

export interface ImpactExample { label: string; from: number; to: number; note?: string }

export default function ImpactPreview({ open, title, subtitle, impact, examples, notes, confirmLabel = "Applica", onConfirm, onCancel }: {
  open: boolean; title: string; subtitle?: string; impact: ImpactSummary; examples?: ImpactExample[]; notes?: string[];
  confirmLabel?: string; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  const net = impact.net;
  const cell = "rounded-lg border border-line bg-paper px-3 py-2";
  const lab = "text-[10px] font-semibold uppercase tracking-wide text-faint";
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Annulla" onClick={onCancel} className="absolute inset-0 bg-black/45" />
      <div className="anim-in relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <h2 className="font-display text-base font-bold text-txt">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-dim">{subtitle}</p>}

        {impact.changes === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-faint">Nessuna tariffa cambierebbe: non c&apos;è nulla da applicare.</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className={cell}><div className={lab}>Tariffe</div><div className="font-mono text-lg font-bold text-txt">{impact.changes}</div><div className="text-[10px] text-faint">{impact.ups} su · {impact.downs} giù</div></div>
              <div className={cell}><div className={lab}>Variazione media</div><div className="font-mono text-lg font-bold" style={{ color: impact.avgDeltaPct >= 0 ? "var(--ok)" : "var(--warn)" }}>{impact.avgDeltaPct > 0 ? "+" : ""}{impact.avgDeltaPct}%</div></div>
              <div className={cell}><div className={lab}>Camere libere</div><div className="font-mono text-lg font-bold text-txt">{impact.freeNightRooms}</div><div className="text-[10px] text-faint">notti-camera toccate</div></div>
              <div className={cell}><div className={lab}>Già vendute</div><div className="font-mono text-lg font-bold text-txt">{impact.soldNightRooms}</div><div className="text-[10px] text-faint">prezzo invariato</div></div>
            </div>

            <div className="mt-3 rounded-lg border border-line p-3 text-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Se si vendessero tutte le camere ancora libere</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-txt">
                <span className="font-mono">{eur(impact.revenueBefore)}</span><span className="text-faint">→</span><span className="font-mono font-semibold">{eur(impact.revenueAfter)}</span>
                <span className="font-mono text-base font-bold" style={{ color: net >= 0 ? "var(--ok)" : "var(--warn)" }}>{net >= 0 ? "+" : "−"}{eur(Math.abs(net))}</span>
              </div>
              <div className="mt-1 text-[11px] text-dim">Rialzi: fino a <b style={{ color: "var(--ok)" }}>+{eur(impact.deltaMaxUp)}</b> · Ribassi: fino a <b style={{ color: "var(--warn)" }}>−{eur(Math.abs(impact.deltaMaxDown))}</b></div>
              <p className="mt-2 text-[11px] text-faint">È uno scenario, non una previsione: non sappiamo quante di quelle camere si venderanno davvero. Le prenotazioni già confermate non cambiano prezzo.</p>
            </div>

            {examples && examples.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-dim">
                {examples.slice(0, 5).map((e, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-wash px-2.5 py-1.5">
                    <span className="min-w-0 truncate text-txt">{e.label}</span>
                    <span className="shrink-0 font-mono">{eur(e.from)} → <b style={{ color: e.to >= e.from ? "var(--ok)" : "var(--warn)" }}>{eur(e.to)}</b></span>
                    {e.note && <span className="w-full text-[10px] text-faint">{e.note}</span>}
                  </li>
                ))}
                {impact.changes > Math.min(5, examples.length) && <li className="px-1 text-[11px] text-faint">…e altre {impact.changes - Math.min(5, examples.length)} tariffe.</li>}
              </ul>
            )}
          </>
        )}

        {notes?.map((n, i) => <p key={i} className="mt-2 text-[11px] text-faint">{n}</p>)}
        <p className="mt-2 text-[11px] text-faint">Potrai annullare questa applicazione dallo storico modifiche (finché non ritocchi quelle tariffe a mano).</p>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-dim hover:bg-wash">Annulla</button>
          <button onClick={onConfirm} disabled={impact.changes === 0} autoFocus className="rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
