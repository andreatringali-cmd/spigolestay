"use client";

// Storico delle modifiche di tariffa applicate (Autopilot / Revenue / Nèttare) con "Annulla".
// Legge lib/revenue-history.ts (salvato su questo dispositivo). L'annullamento ripristina il
// valore di prima solo per le tariffe che non sono state ritoccate dopo.
import { useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { useConfirm } from "@/components/ConfirmProvider";
import { useToast } from "@/components/ToastProvider";
import { eur } from "@/lib/format";
import { Card, SectionTitle } from "@/components/ui";
import { loadHistory, subscribeHistory, planUndo, markUndone, SOURCE_LABEL, type PriceBatch, type RevenueSource } from "@/lib/revenue-history";

const fmtTs = (ts: number) => new Date(ts).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function PriceHistoryCard({ structureId, sources, onUndone }: { structureId: string; sources?: RevenueSource[]; onUndone?: (b: PriceBatch) => void }) {
  const { rateOverrides, setDayRates, clearDayRates, structures, addActivity } = useData();
  const ask = useConfirm();
  const toast = useToast();
  const [list, setList] = useState<PriceBatch[]>([]);
  useEffect(() => {
    const refresh = () => setList(loadHistory(structureId).filter((b) => !sources || sources.includes(b.source)));
    refresh();
    return subscribeHistory(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureId, sources?.join(",")]);

  const undo = async (b: PriceBatch) => {
    const plan = planUndo(b, rateOverrides);
    const n = Object.keys(plan.restore).length + plan.clear.length;
    if (n === 0) { toast("Nulla da ripristinare: le tariffe sono già state modificate dopo questa applicazione.", "info"); markUndone(b.id); return; }
    const sName = structures.find((s) => s.id === b.structureId)?.name ?? "";
    const ok = await ask({
      title: "Annulla applicazione tariffe",
      message: `Ripristino ${n} tariffe${sName ? ` di ${sName}` : ""} al valore di prima.${plan.skipped ? ` ${plan.skipped} tariffe sono state ritoccate dopo e restano come sono.` : ""}`,
      confirmLabel: "Ripristina",
    });
    if (!ok) return;
    if (Object.keys(plan.restore).length) setDayRates(plan.restore);
    if (plan.clear.length) clearDayRates(plan.clear);
    markUndone(b.id);
    addActivity("rate", `Annullata applicazione tariffe (${SOURCE_LABEL[b.source]}, ${fmtTs(b.ts)}): ripristinate ${n} tariffe.`, b.structureId);
    toast(`Ripristinate ${n} tariffe${plan.skipped ? ` · ${plan.skipped} lasciate (modificate dopo)` : ""}.`, "success");
    onUndone?.(b);
  };

  return (
    <Card className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle>Storico modifiche applicate</SectionTitle>
        <span className="text-[11px] text-faint">salvato su questo dispositivo</span>
      </div>
      {list.length === 0 ? (
        <p className="py-4 text-center text-sm text-faint">Nessuna applicazione registrata. Quando applichi dei prezzi, compaiono qui e puoi annullarli.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.slice(0, 8).map((b) => {
            const stillOn = !b.undoneAt;
            const avg = b.changes.length ? Math.round(b.changes.reduce((a, c) => a + (c.effBefore > 0 ? ((c.after - c.effBefore) / c.effBefore) * 100 : 0), 0) / b.changes.length) : 0;
            const sample = b.changes[0];
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-txt">{SOURCE_LABEL[b.source]} <span className="font-normal text-faint">· {fmtTs(b.ts)}</span>{structureId === "all" && structures.length > 1 && <span className="font-normal text-faint"> · {structures.find((s) => s.id === b.structureId)?.name ?? ""}</span>}</div>
                  <div className="text-[11px] text-dim">{b.changes.length} tariffe · variazione media {avg > 0 ? "+" : ""}{avg}%{sample ? ` · es. ${sample.typeName} ${new Date(sample.iso + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}: ${eur(sample.effBefore)} → ${eur(sample.after)}` : ""}</div>
                </div>
                {stillOn
                  ? <button onClick={() => void undo(b)} className="shrink-0 rounded-lg border border-line px-3 py-1 text-xs font-semibold text-txt hover:bg-wash">Annulla</button>
                  : <span className="shrink-0 rounded-full bg-wash px-2.5 py-0.5 text-[11px] font-medium text-faint">annullata · {fmtTs(b.undoneAt!)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
