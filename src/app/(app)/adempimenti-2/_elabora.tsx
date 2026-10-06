"use client";

// "Elabora tutto": prepara in un colpo solo schedine Questura, movimenti ISTAT e tassa di soggiorno.
// Stesso flusso e stesse chiamate di "Adempimenti oggi": 1) PREPARA (sincronizza, non invia nulla) → 2) se c'è un invio REALE da fare
// chiede conferma esplicita → 3) esito passo per passo. I gate ALLOGGIATI_LIVE / ISTAT_LIVE restano lato server: senza, tutto è "in prova".
import { useState, type ReactNode } from "react";
import Icon from "@/components/Icon";
import ConfirmDialog from "@/components/ConfirmDialog";
import { apiPost } from "@/lib/invoicing/client";
import { cityTaxTotalByStructure } from "@/lib/citytax";
import { eur } from "@/lib/format";
import { tint } from "../_ui";
import { Panel } from "./_kit";
import type { Booking, Structure } from "@/lib/types";

type Status = "fatto" | "prova" | "errore" | "niente";
export type RunStep = { key: string; label: string; status: Status; detail: string; count: number };
type RunResult = { steps: RunStep[]; live: { alloggiati: boolean; istat: boolean } };

const STEP_META: Record<Status, { label: string; tone: string }> = {
  fatto: { label: "Fatto", tone: "var(--ok)" },
  prova: { label: "In prova", tone: "var(--warn)" },
  errore: { label: "Errore", tone: "var(--err)" },
  niente: { label: "Niente da fare", tone: "var(--faint)" },
};
const p2 = (n: number) => String(n).padStart(2, "0");

export function useElabora({ structureIds, bookings, getStructure, reload }: {
  structureIds: string[]; bookings: Booking[]; getStructure: (id: string) => Structure | undefined; reload: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<RunStep[] | null>(null);
  const [confirm, setConfirm] = useState<RunResult | null>(null);

  // Tassa di soggiorno del trimestre in corso (stima con le regole della struttura): è solo un calcolo, non invia nulla.
  const taxStep = (): RunStep => {
    const now = new Date();
    const y = now.getFullYear();
    const startM = Math.floor(now.getMonth() / 3) * 3;
    const start = `${y}-${p2(startM + 1)}-01`;
    const end = startM + 3 >= 12 ? `${y + 1}-01-01` : `${y}-${p2(startM + 4)}-01`;
    const list = bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && b.checkIn >= start && b.checkIn < end);
    const { total, count } = cityTaxTotalByStructure(list, getStructure);
    return {
      key: "tassa", label: "Tassa di soggiorno", status: count > 0 ? "fatto" : "niente", count,
      detail: count > 0 ? `Imposta stimata ${eur(total)} su ${count} ${count === 1 ? "soggiorno" : "soggiorni"} (trimestre in corso, regole della struttura).` : "Nessun soggiorno da tassare nel periodo.",
    };
  };
  const call = (mode: "prepare" | "confirm") => apiPost<RunResult>("adempimenti/run", { mode, structureIds });

  /** Avvio: PREPARA (non invia nulla). Se c'è un invio reale da fare chiede conferma, altrimenti mostra subito l'esito (in prova). */
  const start = async () => {
    setBusy(true); setSteps(null);
    try {
      const r = await call("prepare");
      const cnt = (k: string) => r.steps.find((s) => s.key === k)?.count ?? 0;
      const willSendReal = (r.live.alloggiati && cnt("schedine") > 0) || (r.live.istat && cnt("istat") > 0);
      if (willSendReal) setConfirm(r);
      else { setSteps([...r.steps, taxStep()]); await reload(); }
    } catch (e) {
      setSteps([{ key: "errore", label: "Elaborazione", status: "errore", count: 0, detail: e instanceof Error ? e.message : "Errore durante l'elaborazione." }]);
    } finally { setBusy(false); }
  };
  const doConfirm = async () => {
    setBusy(true);
    try { const r = await call("confirm"); setSteps([...r.steps, taxStep()]); await reload(); }
    catch (e) { setSteps([{ key: "errore", label: "Elaborazione", status: "errore", count: 0, detail: e instanceof Error ? e.message : "Errore durante l'invio." }]); }
    finally { setBusy(false); setConfirm(null); }
  };
  return { busy, steps, confirm, start, doConfirm, closeSteps: () => setSteps(null), closeConfirm: () => setConfirm(null) };
}

/** Pulsante in testata. */
export function ElaboraButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} disabled={busy}
      title="Prepara schedine Questura, movimenti ISTAT e tassa di soggiorno. Prima di inviare agli enti ti chiede conferma."
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-txt shadow-sm transition hover:border-focus hover:text-focus focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] disabled:opacity-60"
    >
      <span className="text-focus"><Icon name="sparkles" size={16} /></span>
      {busy ? "Elaboro…" : "Elabora tutto"}
    </button>
  );
}

/** Avanzamento (mentre lavora) ed esito (a lavoro finito). */
export function ElaboraPanel({ busy, steps, onClose }: { busy: boolean; steps: RunStep[] | null; onClose: () => void }): ReactNode {
  if (!busy && !steps) return null;
  if (busy && !steps) {
    return (
      <Panel className="p-4 sm:p-5" label="Elaborazione in corso">
        <div className="flex items-center gap-3" role="status" aria-live="polite">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl motion-safe:animate-pulse" style={{ backgroundColor: tint("var(--focus)", 14), color: "var(--focus)" }}><Icon name="sparkles" size={17} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-txt">Sto controllando schedine, ISTAT e tassa di soggiorno…</div>
            <div className="mt-0.5 text-xs text-dim">Finché non confermi, agli enti non parte nulla.</div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: tint("var(--focus)", 14) }}><div className="h-full w-1/3 rounded-full motion-safe:animate-pulse" style={{ backgroundColor: "var(--focus)" }} /></div>
          </div>
        </div>
      </Panel>
    );
  }
  const trial = steps!.some((s) => s.status === "prova");
  return (
    <Panel className="p-4 sm:p-5" label="Esito di Elabora tutto">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold leading-tight text-txt">Esito di «Elabora tutto»</h2>
          {trial && <p className="mt-0.5 text-xs text-dim">Prova: l&apos;invio reale non è attivo, agli enti non è stato mandato nulla.</p>}
        </div>
        <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition hover:bg-wash hover:text-txt focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]" aria-label="Chiudi l'esito">✕</button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {steps!.map((s) => {
          const m = STEP_META[s.status];
          return (
            <li key={s.key} className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: tint(m.tone, 8) }}>
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[13px] font-bold" style={{ backgroundColor: tint(m.tone, 16), color: m.tone }}>{s.status === "fatto" ? "✓" : s.status === "errore" ? "!" : s.status === "prova" ? "·" : "–"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[13px] font-semibold text-txt">{s.label}</span>
                  <span className="text-[11px] font-semibold" style={{ color: m.tone }}>{m.label}</span>
                </div>
                <div className="mt-0.5 text-xs text-dim">{s.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Conferma esplicita: compare solo se c'è un invio REALE agli enti. */
export function ElaboraConfirm({ prepared, busy, onConfirm, onClose }: { prepared: RunResult | null; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  if (!prepared) return null;
  const cnt = (k: string) => prepared.steps.find((s) => s.key === k)?.count ?? 0;
  const sched = prepared.live.alloggiati ? cnt("schedine") : 0;
  const istatN = prepared.live.istat ? cnt("istat") : 0;
  return (
    <ConfirmDialog
      title="Elabora tutto — invio agli enti"
      message={<>Stai per inviare in un colpo solo: {sched > 0 && <><b className="text-txt">{sched}</b> {sched === 1 ? "schedina" : "schedine"} alla Questura</>}{sched > 0 && istatN > 0 && " e "}{istatN > 0 && <><b className="text-txt">{istatN}</b> {istatN === 1 ? "movimento" : "movimenti"} ISTAT</>}. La tassa di soggiorno verrà solo calcolata.</>}
      warning={<>L&apos;invio agli enti è <b>definitivo</b> e non può essere annullato. Le voci non pronte o con enti non attivi restano in prova.</>}
      confirmLabel="Invia tutto" tone="var(--err)" busy={busy} onConfirm={onConfirm} onClose={onClose}
    />
  );
}
