"use client";

// Colonna principale: le cose da fare, per ENTE (default) o per URGENZA. Ogni voce ha il suo stato in tinta tenue, la scadenza a parole,
// un'azione principale e una secondaria discreta. Si mostrano le prime N per gruppo ("Mostra tutte"); i gruppi in regola si
// raccolgono in una sola riga espandibile.
import { useState } from "react";
import Icon from "@/components/Icon";
import { eur } from "@/lib/format";
import { ENTE_META, ENTI, URGENCY_LABEL, nWord, type Ente, type Summary, type Task, type TaskAction, type Urgency } from "@/lib/adempimenti2";
import { EmptyLine, EYEBROW, IconTile, Pill, tint } from "../_ui";
import { BTN_PRIMARY, BTN_QUIET, Panel, toneColor, URG_COLOR } from "./_kit";

export type View = "ente" | "urgenza";
export type Filter = "all" | Urgency;
export type OnAction = (t: Task | null, a: TaskAction) => void;

const PER_ENTE = 4;
const PER_URG: Record<Urgency, number> = { late: 6, today: 6, soon: 4 };

// Azione a livello di ente (non di una singola voce): cose sempre utili, mai un invio.
const ENTE_ACTION: Record<Ente, TaskAction | null> = {
  questura: { kind: "link", label: "Apri Alloggiati Web", href: "/alloggiati-web" },
  istat: { kind: "sync", sync: "istat", label: "Genera da arrivi" },
  tassa: { kind: "link", label: "Tassa di soggiorno", href: "/tassa-soggiorno" },
  checkin: null,
  pagamenti: { kind: "link", label: "Scadenzario incassi", href: "/scadenzario-incassi" },
  fatture: { kind: "link", label: "Documenti", href: "/documenti" },
};

// ───────────── Barra di controllo: vista e filtro ─────────────
export function Toolbar({ view, onView, filter, onFilter, summary, totalSoon }: { view: View; onView: (v: View) => void; filter: Filter; onFilter: (f: Filter) => void; summary: Summary; totalSoon: number }) {
  const chips: { key: Filter; label: string; n: number; color: string }[] = [
    { key: "all", label: "Tutto", n: summary.late + summary.today + totalSoon, color: "var(--txt)" },
    { key: "late", label: "In ritardo", n: summary.late, color: URG_COLOR.late },
    { key: "today", label: "Oggi", n: summary.today, color: URG_COLOR.today },
    { key: "soon", label: "Prossimi giorni", n: totalSoon, color: URG_COLOR.soon },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      <div role="group" aria-label="Come raggruppare" className="inline-flex rounded-xl border border-line bg-surface p-0.5 text-xs font-semibold">
        {([["ente", "Per ente"], ["urgenza", "Per urgenza"]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => onView(k)} className={`min-h-8 rounded-[10px] px-3 py-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)] ${view === k ? "bg-wash text-txt shadow-sm" : "text-dim hover:text-txt"}`}>{l}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtra per urgenza">
        {chips.filter((c) => c.key === "all" || c.n > 0 || filter === c.key).map((c) => {
          const on = filter === c.key;
          return (
            <button key={c.key} type="button" aria-pressed={on} onClick={() => onFilter(c.key)} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]" style={on ? { backgroundColor: tint(c.color, 13), color: c.color, borderColor: tint(c.color, 30) } : { borderColor: "var(--line)", color: "var(--dim)" }}>
              {c.label}<span className="font-mono tabular-nums opacity-80">{c.n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────── Una voce ─────────────
export function TaskRow({ t, structName, busyId, onAction, showEnte }: { t: Task; structName?: string; busyId: string; onAction: OnAction; showEnte?: boolean }) {
  const c = URG_COLOR[t.urgency];
  const fix = t.kind === "checkin_fix" || t.kind === "questura_fix";
  const busy = busyId === t.id;
  const meta = [...t.meta, structName].filter(Boolean).join(" · ");
  return (
    <li className="group relative flex flex-col gap-2.5 rounded-xl px-3 py-3 transition hover:bg-wash sm:flex-row sm:items-center sm:gap-4">
      <span aria-hidden className="absolute bottom-3 left-0 top-3 w-[3px] rounded-full" style={{ backgroundColor: c, opacity: 0.85 }} />
      <div className="min-w-0 flex-1 pl-2.5">
        {showEnte && <div className={`${EYEBROW} mb-0.5`}>{ENTE_META[t.ente].short}</div>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-sm font-semibold leading-snug text-txt">{t.title}</span>
          <Pill color={fix ? "var(--err)" : c}>{t.status}</Pill>
        </div>
        {meta && <div className="mt-0.5 break-words text-xs text-faint">{meta}</div>}
        <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: c }}><Icon name="clock" size={12} />{t.dueLabel}</div>
      </div>
      {t.amount !== undefined && <span className="pl-2.5 font-mono text-sm font-bold tabular-nums text-txt sm:pl-0 sm:text-right">{eur(t.amount)}</span>}
      <div className="flex items-center gap-1 pl-2.5 sm:pl-0">
        <button type="button" disabled={busy} onClick={() => onAction(t, t.action)} className={`${BTN_PRIMARY} flex-1 sm:flex-none`}>{busy ? "…" : t.action.label}</button>
        {t.secondary && <button type="button" disabled={busy} onClick={() => onAction(t, t.secondary!)} className={BTN_QUIET}>{t.secondary.label}</button>}
      </div>
    </li>
  );
}

function ShowAll({ total, limit, open, onToggle }: { total: number; limit: number; open: boolean; onToggle: () => void }) {
  if (total <= limit) return null;
  return (
    <div className="px-3 pb-3 pt-1 sm:px-4">
      <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-focus transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">
        {open ? "Mostra meno" : `Mostra tutte (${total})`}<span className={open ? "-rotate-90" : "rotate-90"}><Icon name="chevron" size={12} /></span>
      </button>
    </div>
  );
}

// ───────────── Vista per ente ─────────────
function EnteCard({ ente, tasks, done, structOf, busyId, onAction, delay }: { ente: Ente; tasks: Task[]; done: number; structOf: (t: Task) => string | undefined; busyId: string; onAction: OnAction; delay: number }) {
  const [open, setOpen] = useState(false);
  const m = ENTE_META[ente];
  const late = tasks.filter((t) => t.urgency === "late").length, today = tasks.filter((t) => t.urgency === "today").length, soon = tasks.filter((t) => t.urgency === "soon").length;
  const tone = late > 0 ? "err" : today > 0 ? "warn" : "focus";
  const shown = open ? tasks : tasks.slice(0, PER_ENTE);
  const act = ENTE_ACTION[ente];
  return (
    <Panel id={`ente-${ente}`} className="scroll-mt-4 overflow-hidden" delay={delay}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 p-4 pb-2 sm:p-5 sm:pb-2">
        <IconTile icon={m.icon} color={toneColor(tone)} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-bold leading-tight tracking-tight text-txt">{m.label}</h3>
          <p className="mt-0.5 text-xs text-faint">{m.sub}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {late > 0 && <Pill color={URG_COLOR.late}>{late} in ritardo</Pill>}
          {today > 0 && <Pill color={URG_COLOR.today}>{today} oggi</Pill>}
          {soon > 0 && <Pill color={URG_COLOR.soon}>{soon} in arrivo</Pill>}
        </div>
      </header>
      <ul className="flex flex-col gap-0.5 px-1.5 pb-1 pt-1 sm:px-2.5">
        {shown.map((t) => <TaskRow key={t.id} t={t} structName={structOf(t)} busyId={busyId} onAction={onAction} />)}
      </ul>
      <ShowAll total={tasks.length} limit={PER_ENTE} open={open} onToggle={() => setOpen((o) => !o)} />
      {(act || done > 0) && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 sm:px-5">
          {done > 0 ? <span className="text-xs font-medium" style={{ color: "var(--ok)" }}>✓ {nWord(done, "completata", "completate")} di recente</span> : <span />}
          {act && <button type="button" onClick={() => onAction(null, act)} disabled={busyId === `sync:${act.sync ?? ""}` && act.kind === "sync"} className={BTN_QUIET}>{busyId === `sync:${act.sync ?? ""}` && act.kind === "sync" ? "…" : act.label}</button>}
        </footer>
      )}
    </Panel>
  );
}

export function EnteView({ tasks, summary, structOf, busyId, onAction }: { tasks: Task[]; summary: Summary; structOf: (t: Task) => string | undefined; busyId: string; onAction: OnAction }) {
  const doneOf = (e: Ente) => summary.byEnte.find((x) => x.ente === e)?.done ?? 0;
  return (
    <>
      {ENTI.map((e, i) => {
        const mine = tasks.filter((t) => t.ente === e);
        if (!mine.length) return null;
        return <EnteCard key={e} ente={e} tasks={mine} done={doneOf(e)} structOf={structOf} busyId={busyId} onAction={onAction} delay={80 + i * 50} />;
      })}
    </>
  );
}

// ───────────── Vista per urgenza ─────────────
function UrgencyCard({ urgency, tasks, structOf, busyId, onAction, delay }: { urgency: Urgency; tasks: Task[]; structOf: (t: Task) => string | undefined; busyId: string; onAction: OnAction; delay: number }) {
  const [open, setOpen] = useState(false);
  const c = URG_COLOR[urgency];
  const limit = PER_URG[urgency];
  const shown = open ? tasks : tasks.slice(0, limit);
  return (
    <Panel className="overflow-hidden" delay={delay} label={URGENCY_LABEL[urgency]}>
      <header className="flex items-center gap-3 px-4 py-3.5 sm:px-5" style={{ backgroundColor: tint(c, 8) }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c }} />
        <h3 className="font-display text-base font-bold leading-tight text-txt">{URGENCY_LABEL[urgency]}</h3>
        <span className="rounded-full px-2 py-0.5 font-mono text-[11px] font-bold" style={{ backgroundColor: tint(c, 14), color: c }}>{tasks.length}</span>
      </header>
      <ul className="flex flex-col gap-0.5 px-1.5 pb-1 pt-2 sm:px-2.5">
        {shown.map((t) => <TaskRow key={t.id} t={t} showEnte structName={structOf(t)} busyId={busyId} onAction={onAction} />)}
      </ul>
      <ShowAll total={tasks.length} limit={limit} open={open} onToggle={() => setOpen((o) => !o)} />
    </Panel>
  );
}

export function UrgencyView({ tasks, structOf, busyId, onAction }: { tasks: Task[]; structOf: (t: Task) => string | undefined; busyId: string; onAction: OnAction }) {
  return (
    <>
      {(["late", "today", "soon"] as const).map((u, i) => {
        const mine = tasks.filter((t) => t.urgency === u);
        if (!mine.length) return null;
        return <UrgencyCard key={u} urgency={u} tasks={mine} structOf={structOf} busyId={busyId} onAction={onAction} delay={80 + i * 50} />;
      })}
    </>
  );
}

// ───────────── Gruppi in regola: una riga sola, espandibile ─────────────
export function RegolaPanel({ enti, summary, open, onToggle }: { enti: Ente[]; summary: Summary; open: boolean; onToggle: () => void }) {
  if (!enti.length) return null;
  const names = enti.map((e) => ENTE_META[e].short);
  const line = names.length <= 3 ? names.join(", ").replace(/, ([^,]*)$/, " e $1") : `${names.slice(0, 2).join(", ")} e altri ${names.length - 2}`;
  return (
    <Panel id="regola" className="scroll-mt-4 overflow-hidden" delay={200} label="Gruppi in regola">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-h-12 items-center gap-3 px-4 py-3 text-left transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)] sm:px-5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold" style={{ backgroundColor: tint("var(--ok)", 16), color: "var(--ok)" }}>✓</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-txt">{enti.length === ENTI.length ? "Tutto in regola" : "Già in regola"}</span>
          <span className="block truncate text-xs text-faint">{line}</span>
        </span>
        <span className={`shrink-0 text-faint transition ${open ? "-rotate-90" : "rotate-90"}`}><Icon name="chevron" size={14} /></span>
      </button>
      {open && (
        <ul className="border-t border-line px-2 py-1.5 sm:px-3">
          {enti.map((e) => {
            const m = ENTE_META[e];
            const d = summary.byEnte.find((x) => x.ente === e)?.done ?? 0;
            return (
              <li key={e} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5">
                <IconTile icon={m.icon} color="var(--ok)" size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-txt">{m.label}</div>
                  <div className="text-xs text-faint">{m.allDone}{d > 0 ? ` · ${nWord(d, "completata", "completate")} di recente` : ""}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function EmptyFilter({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1"><EmptyLine icon="search">Niente in questa categoria.</EmptyLine></div>
      <button type="button" onClick={onReset} className={BTN_QUIET}>Mostra tutto</button>
    </div>
  );
}
