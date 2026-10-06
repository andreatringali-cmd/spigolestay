"use client";

// Testata: lo stato a colpo d'occhio (anello di avanzamento, "In regola" / "N cose da fare"), la prossima cosa urgente con la sua
// azione immediata e il riepilogo per ente (cliccabile: porta al gruppo).
import Icon from "@/components/Icon";
import { ENTE_META, nWord, plural, type Ente, type Summary, type Task, type TaskAction, URGENCY_LABEL } from "@/lib/adempimenti2";
import { EYEBROW, IconTile, Pill, tint } from "../_ui";
import { BTN_PRIMARY, CountUp, Panel, Ring, ThinBar, toneColor, URG_COLOR } from "./_kit";

function sentenceOf(s: Summary): string {
  const parts: string[] = [];
  if (s.late > 0) parts.push(`${s.late} in ritardo`);
  if (s.today > 0) parts.push(`${s.today} per oggi`);
  if (s.todo === 0) return s.soon > 0 ? `Nulla di urgente · ${nWord(s.soon, "scadenza", "scadenze")} nei prossimi giorni.` : "Check-in, Questura, ISTAT, tassa e saldi non hanno nulla in sospeso.";
  if (s.soon > 0) parts.push(`${s.soon} nei prossimi giorni`);
  return parts.join(" · ");
}

function NextCard({ task, onAction, busyId, structName }: { task: Task | null; onAction: (t: Task, a: TaskAction) => void; busyId: string; structName?: string }) {
  if (!task) {
    return (
      <div className="flex items-center gap-3 rounded-xl px-4 py-4" style={{ backgroundColor: tint("var(--ok)", 9) }}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: tint("var(--ok)", 16), color: "var(--ok)" }}><Icon name="shield" size={19} /></span>
        <div className="min-w-0">
          <div className="text-sm font-bold text-txt">Niente di urgente</div>
          <div className="text-xs text-dim">Puoi dedicarti al resto: gli adempimenti sono sotto controllo.</div>
        </div>
      </div>
    );
  }
  const c = URG_COLOR[task.urgency];
  const busy = busyId === task.id;
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: tint(c, 8) }}>
      <div className="flex items-center justify-between gap-2">
        <span className={EYEBROW}>Prossimo da fare</span>
        <Pill color={c}>{URGENCY_LABEL[task.urgency]}</Pill>
      </div>
      <div className="mt-2 min-w-0">
        <div className="truncate text-[15px] font-bold leading-snug text-txt">{task.title}</div>
        <div className="mt-0.5 truncate text-xs text-dim">{ENTE_META[task.ente].short} · {task.status}{structName ? ` · ${structName}` : ""}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: c }}><Icon name="clock" size={12} />{task.dueLabel}</div>
      </div>
      <button type="button" disabled={busy} onClick={() => onAction(task, task.action)} className={`${BTN_PRIMARY} mt-3 w-full`}>{busy ? "…" : task.action.label}<Icon name="chevron" size={13} /></button>
    </div>
  );
}

export default function Hero({ summary, next, nextStruct, dateLabel, scopeLabel, loading, onAction, busyId, onEnte }: {
  summary: Summary; next: Task | null; nextStruct?: string; dateLabel: string; scopeLabel: string; loading: boolean;
  onAction: (t: Task, a: TaskAction) => void; busyId: string; onEnte: (e: Ente) => void;
}) {
  const color = toneColor(summary.tone);
  const ok = summary.todo === 0;
  const total = summary.done + summary.todo;
  return (
    <Panel className="p-4 sm:p-6" label="Stato degli adempimenti" delay={40}>
      {loading ? (
        <div className="flex items-center gap-5" aria-busy="true" aria-label="Controllo degli adempimenti in corso">
          <div className="h-[120px] w-[120px] shrink-0 rounded-full bg-wash motion-safe:animate-pulse" />
          <div className="flex-1 space-y-2.5"><div className="h-3 w-40 rounded bg-wash motion-safe:animate-pulse" /><div className="h-7 w-56 max-w-full rounded bg-wash motion-safe:animate-pulse" /><div className="h-3 w-64 max-w-full rounded bg-wash motion-safe:animate-pulse" /></div>
        </div>
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-8">
          <div className="flex min-w-0 items-center gap-4 sm:gap-6">
            <Ring pct={summary.pct} color={color} size={120} label={ok ? "Tutto in regola" : `${summary.todo} da fare, ${summary.pct}% completato`}>
              {ok
                ? <span style={{ color }}><Icon name="shield" size={34} strokeWidth={1.7} /></span>
                : <div className="text-center leading-none"><div className="font-display text-[40px] font-bold tabular-nums" style={{ color }}><CountUp value={summary.todo} /></div><div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-faint">da fare</div></div>}
            </Ring>
            <div className="min-w-0">
              <div className={EYEBROW}>{dateLabel}{scopeLabel ? ` · ${scopeLabel}` : ""}</div>
              <h2 className="mt-0.5 font-display text-[26px] font-bold leading-tight tracking-tight text-txt sm:text-3xl">{ok ? "In regola" : summary.todo === 1 ? "1 cosa da fare" : `${summary.todo} cose da fare`}</h2>
              <p className="mt-1 text-sm text-dim">{sentenceOf(summary)}</p>
              {total > 0 && (
                <div className="mt-3 max-w-xs" title="Completate nelle ultime 24-48 ore rispetto a quelle dovute adesso">
                  <ThinBar pct={summary.pct} color={color} />
                  <div className="mt-1 text-[11px] text-faint">{summary.done} {plural(summary.done, "completata", "completate")} · {summary.todo} {plural(summary.todo, "resta", "restano")}</div>
                </div>
              )}
            </div>
          </div>
          <div className="min-w-0 lg:ml-auto lg:w-[22rem] lg:max-w-[40%] lg:shrink-0"><NextCard task={next} onAction={onAction} busyId={busyId} structName={nextStruct} /></div>
        </div>
      )}

      {!loading && (
        <div className="mt-5 grid grid-cols-2 gap-2 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-6">
          {summary.byEnte.map((e) => {
            const c = toneColor(e.tone);
            const m = ENTE_META[e.ente];
            return (
              <button key={e.ente} type="button" onClick={() => onEnte(e.ente)} className="group flex min-w-0 flex-col items-start gap-2 rounded-xl border border-transparent px-2.5 py-2.5 text-left transition hover:border-line hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]" aria-label={`${m.label}: ${e.urgent > 0 ? `${e.urgent} da fare` : "in regola"}`}>
                <span className="flex w-full items-center gap-2"><IconTile icon={m.icon} color={c} size="sm" /><span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-txt">{m.short}</span></span>
                <span className="text-xs font-semibold" style={{ color: e.urgent > 0 ? c : "var(--ok)" }}>
                  {e.urgent > 0 ? `${e.urgent} da fare` : "In regola"}
                  {e.soon > 0 && <span className="font-medium text-faint"> · {e.soon} in arrivo</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
