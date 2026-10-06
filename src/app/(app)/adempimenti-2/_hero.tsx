"use client";

// Testata COMPATTA: anello piccolo + "In regola" / "N cose da fare" + barra su una riga, una fascia sottile con la prossima cosa
// urgente e il suo bottone, e sei tessere di riepilogo per ente su una riga (icona + numero + nome breve), cliccabili.
import Icon from "@/components/Icon";
import { ENTE_META, nWord, plural, type Ente, type Summary, type Task, type TaskAction, URGENCY_LABEL } from "@/lib/adempimenti2";
import { IconTile, tint } from "../_ui";
import { BTN_PRIMARY, CountUp, Panel, Ring, ThinBar, toneColor, URG_COLOR } from "./_kit";

function sentenceOf(s: Summary): string {
  const parts: string[] = [];
  if (s.late > 0) parts.push(`${s.late} in ritardo`);
  if (s.today > 0) parts.push(`${s.today} per oggi`);
  if (s.todo === 0) return s.soon > 0 ? `Nulla di urgente · ${nWord(s.soon, "scadenza", "scadenze")} nei prossimi giorni` : "Nulla in sospeso";
  if (s.soon > 0) parts.push(`${s.soon} nei prossimi giorni`);
  return parts.join(" · ");
}

function NextStrip({ task, onAction, busyId, structName }: { task: Task | null; onAction: (t: Task, a: TaskAction) => void; busyId: string; structName?: string }) {
  if (!task) {
    return (
      <div className="mt-2.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ backgroundColor: tint("var(--ok)", 9) }}>
        <span style={{ color: "var(--ok)" }}><Icon name="shield" size={15} /></span>
        <span className="min-w-0 truncate text-xs text-dim"><b className="font-semibold text-txt">Niente di urgente</b> · gli adempimenti sono sotto controllo</span>
      </div>
    );
  }
  const c = URG_COLOR[task.urgency];
  const busy = busyId === task.id;
  return (
    <div className="mt-2.5 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5" style={{ backgroundColor: tint(c, 9) }}>
      <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wide sm:inline" style={{ color: c }}>{URGENCY_LABEL[task.urgency]}</span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13px] font-semibold text-txt"><span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Prossimo</span>{task.title}</div>
        <div className="truncate text-[11px] text-dim">{ENTE_META[task.ente].short} · {task.status}{structName ? ` · ${structName}` : ""} · <span className="font-semibold" style={{ color: c }}>{task.dueLabel}</span></div>
      </div>
      <button type="button" disabled={busy} onClick={() => onAction(task, task.action)} className={BTN_PRIMARY}>{busy ? "…" : task.action.label}</button>
    </div>
  );
}

export default function Hero({ summary, next, nextStruct, loading, onAction, busyId, onEnte }: {
  summary: Summary; next: Task | null; nextStruct?: string; loading: boolean;
  onAction: (t: Task, a: TaskAction) => void; busyId: string; onEnte: (e: Ente) => void;
}) {
  const color = toneColor(summary.tone);
  const ok = summary.todo === 0;
  const total = summary.done + summary.todo;
  return (
    <Panel className="p-2.5 sm:p-3" label="Stato degli adempimenti" delay={30}>
      {loading ? (
        <div className="flex items-center gap-3" aria-busy="true" aria-label="Controllo degli adempimenti in corso">
          <div className="h-[52px] w-[52px] shrink-0 rounded-full bg-wash motion-safe:animate-pulse" />
          <div className="flex-1 space-y-2"><div className="h-4 w-44 max-w-full rounded bg-wash motion-safe:animate-pulse" /><div className="h-2.5 w-60 max-w-full rounded bg-wash motion-safe:animate-pulse" /></div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Ring pct={summary.pct} color={color} size={52} stroke={10} label={ok ? "Tutto in regola" : `${summary.todo} da fare, ${summary.pct}% completato`}>
              {ok
                ? <span style={{ color }}><Icon name="shield" size={20} strokeWidth={1.8} /></span>
                : <span className="font-display text-lg font-bold leading-none tabular-nums" style={{ color }}><CountUp value={summary.todo} /></span>}
            </Ring>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <h2 className="font-display text-lg font-bold leading-tight tracking-tight text-txt">{ok ? "In regola" : summary.todo === 1 ? "1 cosa da fare" : `${summary.todo} cose da fare`}</h2>
                <span className="text-xs text-dim">{sentenceOf(summary)}</span>
              </div>
              {total > 0 && (
                <div className="mt-1.5 flex items-center gap-2" title="Completate nelle ultime 24-48 ore rispetto a quelle dovute adesso">
                  <div className="w-24 shrink-0 sm:w-40"><ThinBar pct={summary.pct} color={color} /></div>
                  <span className="truncate text-[11px] text-faint">{summary.done} {plural(summary.done, "completata", "completate")} · {summary.todo} {plural(summary.todo, "resta", "restano")}</span>
                </div>
              )}
            </div>
          </div>
          <NextStrip task={next} onAction={onAction} busyId={busyId} structName={nextStruct} />
          <div className="mt-2 grid grid-cols-3 gap-1 border-t border-line pt-2 sm:grid-cols-6">
            {summary.byEnte.map((e) => {
              const c = toneColor(e.tone);
              const m = ENTE_META[e.ente];
              return (
                <button key={e.ente} type="button" onClick={() => onEnte(e.ente)} title={`${m.label}: ${e.urgent > 0 ? `${e.urgent} da fare` : "in regola"}${e.soon > 0 ? ` · ${e.soon} in arrivo` : ""}`} aria-label={`${m.label}: ${e.urgent > 0 ? `${e.urgent} da fare` : "in regola"}`} className="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">
                  <span className="hidden sm:block"><IconTile icon={m.icon} color={c} size="sm" /></span>
                  <span className="font-mono text-[13px] font-bold tabular-nums" style={{ color: e.urgent > 0 ? c : "var(--ok)" }}>{e.urgent > 0 ? e.urgent : "✓"}</span>
                  <span className="min-w-0 truncate text-[11.5px] font-semibold text-txt">{m.short}</span>
                  {e.soon > 0 && <span className="shrink-0 text-[10px] font-medium text-faint">+{e.soon}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}
