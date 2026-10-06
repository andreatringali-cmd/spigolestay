"use client";

// Colonna principale (versione COMPATTA): le cose da fare, per ENTE (default) o per URGENZA. Ogni voce sta su una riga sola:
// nome e stato a sinistra, scadenza come pillola piccola a destra, azione principale come bottone piccolo e le altre azioni nel menu «⋯».
// Si mostrano le prime 3 per gruppo ("Mostra tutte"); i gruppi in regola si raccolgono in una sola riga espandibile.
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { eur } from "@/lib/format";
import { ENTE_META, ENTI, URGENCY_LABEL, nWord, type Ente, type Summary, type Task, type TaskAction, type Urgency } from "@/lib/adempimenti2";
import { EmptyLine, IconTile, Pill, tint } from "../_ui";
import { BTN_PRIMARY, BTN_QUIET, Panel, toneColor, URG_COLOR } from "./_kit";

export type View = "ente" | "urgenza";
export type Filter = "all" | Urgency;
export type OnAction = (t: Task | null, a: TaskAction) => void;

const PER_ENTE = 3;
const PER_URG: Record<Urgency, number> = { late: 4, today: 4, soon: 3 };

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
    { key: "soon", label: "Prossimi", n: totalSoon, color: URG_COLOR.soon },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div role="group" aria-label="Come raggruppare" className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[11px] font-semibold">
        {([["ente", "Per ente"], ["urgenza", "Per urgenza"]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => onView(k)} className={`min-h-7 rounded-md px-2.5 py-0.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)] ${view === k ? "bg-wash text-txt shadow-sm" : "text-dim hover:text-txt"}`}>{l}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtra per urgenza">
        {chips.filter((c) => c.key === "all" || c.n > 0 || filter === c.key).map((c) => {
          const on = filter === c.key;
          return (
            <button key={c.key} type="button" aria-pressed={on} onClick={() => onFilter(c.key)} className="inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]" style={on ? { backgroundColor: tint(c.color, 13), color: c.color, borderColor: tint(c.color, 30) } : { borderColor: "var(--line)", color: "var(--dim)" }}>
              {c.label}<span className="font-mono tabular-nums opacity-80">{c.n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────── Menu «⋯» di una voce ─────────────
function RowMenu({ items, onPick }: { items: TaskAction[]; onPick: (a: TaskAction) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  if (!items.length) return <span className="w-1 shrink-0" aria-hidden />;
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Altre azioni" onClick={() => setOpen((o) => !o)} className="grid h-8 w-8 place-items-center rounded-lg text-base font-bold leading-none text-faint transition hover:bg-line hover:text-txt focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">⋯</button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-40 rounded-xl border border-line bg-surface p-1 shadow-lg">
          {items.map((a, i) => (
            <button key={i} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(a); }} className="block w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs font-semibold text-txt transition hover:bg-wash">{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────── Una voce (una riga) ─────────────
export function TaskRow({ t, structName, busyId, onAction, showEnte }: { t: Task; structName?: string; busyId: string; onAction: OnAction; showEnte?: boolean }) {
  const c = URG_COLOR[t.urgency];
  const fix = t.kind === "checkin_fix" || t.kind === "questura_fix";
  const sc = fix ? "var(--err)" : c;
  const busy = busyId === t.id;
  const meta = [...t.meta, structName].filter(Boolean).join(" · ");
  const short = ENTE_META[t.ente].short;
  // Altre azioni nel menu: la secondaria e, se c'è una prenotazione, "Apri prenotazione" (senza doppioni).
  const items: TaskAction[] = [];
  if (t.secondary) items.push(t.secondary);
  if (t.repId && t.action.kind !== "fix" && t.secondary?.kind !== "fix") items.push({ kind: "fix", label: "Apri prenotazione" });
  return (
    <li className="group relative flex items-center gap-2 rounded-lg py-1.5 pl-3 pr-1 transition hover:bg-wash sm:gap-2.5" title={meta ? `${t.title} · ${meta}` : t.title}>
      <span aria-hidden className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full" style={{ backgroundColor: c, opacity: 0.85 }} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex min-w-0 items-center gap-2">
          {showEnte && <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wide text-faint sm:inline">{short}</span>}
          <span className="min-w-0 truncate text-[13px] font-semibold text-txt">{t.title}</span>
          <span className="hidden shrink-0 sm:inline-flex"><Pill color={sc} className="text-[10px]! py-px!">{t.status}</Pill></span>
          {meta && <span className="hidden min-w-0 truncate text-[11px] text-faint lg:inline">{meta}</span>}
        </div>
        {/* Mobile: seconda riga sottile con stato e scadenza (la pillola a destra c'è solo da sm in su) */}
        <div className="mt-0.5 truncate text-[11px] sm:hidden"><span style={{ color: sc }} className="font-semibold">{showEnte ? `${short} · ` : ""}{t.status}</span><span className="text-faint"> · </span><span style={{ color: c }}>{t.dueLabel}</span>{t.amount !== undefined && <span className="font-mono text-dim"> · {eur(t.amount)}</span>}</div>
      </div>
      {t.amount !== undefined && <span className="hidden shrink-0 font-mono text-xs font-bold tabular-nums text-txt sm:inline">{eur(t.amount)}</span>}
      <span className="hidden shrink-0 sm:inline-flex"><Pill color={c} icon="clock" className="text-[10px]! py-px!">{t.dueLabel}</Pill></span>
      <button type="button" disabled={busy} onClick={() => onAction(t, t.action)} className={BTN_PRIMARY}>{busy ? "…" : t.action.label}</button>
      <RowMenu items={items} onPick={(a) => onAction(t, a)} />
    </li>
  );
}

// Piè del gruppo: "Mostra tutte", completate di recente e azione di ente, su una riga sola.
function GroupFoot({ total, limit, open, onToggle, done, act, busyId, onAction }: { total: number; limit: number; open: boolean; onToggle: () => void; done?: number; act?: TaskAction | null; busyId?: string; onAction?: OnAction }) {
  const more = total > limit;
  if (!more && !done && !act) return null;
  const actBusy = !!act && act.kind === "sync" && busyId === `sync:${act.sync}`;
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-3 border-t border-line px-2.5 py-1">
      <div className="flex items-center gap-2">
        {more && (
          <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold text-focus transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">
            {open ? "Mostra meno" : `Mostra tutte (${total})`}<span className={open ? "-rotate-90" : "rotate-90"}><Icon name="chevron" size={11} /></span>
          </button>
        )}
        {!!done && <span className="text-[11px] font-medium" style={{ color: "var(--ok)" }}>✓ {nWord(done, "completata", "completate")}</span>}
      </div>
      {act && onAction && <button type="button" onClick={() => onAction(null, act)} disabled={actBusy} className={`${BTN_QUIET} !min-h-8 !px-1.5 !text-[11px]`}>{actBusy ? "…" : act.label}</button>}
    </footer>
  );
}

// ───────────── Vista per ente ─────────────
function EnteCard({ ente, tasks, done, structOf, busyId, onAction, delay }: { ente: Ente; tasks: Task[]; done: number; structOf: (t: Task) => string | undefined; busyId: string; onAction: OnAction; delay: number }) {
  const [open, setOpen] = useState(false);
  const m = ENTE_META[ente];
  const late = tasks.filter((t) => t.urgency === "late").length, today = tasks.filter((t) => t.urgency === "today").length, soon = tasks.filter((t) => t.urgency === "soon").length;
  const tone = late > 0 ? "err" : today > 0 ? "warn" : "focus";
  const shown = open ? tasks : tasks.slice(0, PER_ENTE);
  return (
    <Panel id={`ente-${ente}`} className="scroll-mt-4" delay={delay}>
      <header className="flex items-center gap-2 px-2.5 py-2">
        <IconTile icon={m.icon} color={toneColor(tone)} size="sm" />
        <h3 className="min-w-0 flex-1 truncate font-display text-sm font-bold leading-tight text-txt" title={m.sub}>{m.label}</h3>
        <div className="flex shrink-0 items-center gap-1">
          {late > 0 && <Pill color={URG_COLOR.late} className="text-[10px]! py-px!">{late} in ritardo</Pill>}
          {today > 0 && <Pill color={URG_COLOR.today} className="text-[10px]! py-px!">{today} oggi</Pill>}
          {soon > 0 && <Pill color={URG_COLOR.soon} className="text-[10px]! py-px!">{soon} in arrivo</Pill>}
        </div>
      </header>
      <ul className="flex flex-col px-1 pb-1">
        {shown.map((t) => <TaskRow key={t.id} t={t} structName={structOf(t)} busyId={busyId} onAction={onAction} />)}
      </ul>
      <GroupFoot total={tasks.length} limit={PER_ENTE} open={open} onToggle={() => setOpen((o) => !o)} done={done} act={ENTE_ACTION[ente]} busyId={busyId} onAction={onAction} />
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
        return <EnteCard key={e} ente={e} tasks={mine} done={doneOf(e)} structOf={structOf} busyId={busyId} onAction={onAction} delay={60 + i * 40} />;
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
    <Panel delay={delay} label={URGENCY_LABEL[urgency]}>
      <header className="flex items-center gap-2 rounded-t-2xl px-2.5 py-2" style={{ backgroundColor: tint(c, 8) }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c }} />
        <h3 className="font-display text-sm font-bold leading-tight text-txt">{URGENCY_LABEL[urgency]}</h3>
        <span className="rounded-full px-1.5 py-px font-mono text-[10px] font-bold" style={{ backgroundColor: tint(c, 14), color: c }}>{tasks.length}</span>
      </header>
      <ul className="flex flex-col px-1 py-1">
        {shown.map((t) => <TaskRow key={t.id} t={t} showEnte structName={structOf(t)} busyId={busyId} onAction={onAction} />)}
      </ul>
      <GroupFoot total={tasks.length} limit={limit} open={open} onToggle={() => setOpen((o) => !o)} />
    </Panel>
  );
}

export function UrgencyView({ tasks, structOf, busyId, onAction }: { tasks: Task[]; structOf: (t: Task) => string | undefined; busyId: string; onAction: OnAction }) {
  return (
    <>
      {(["late", "today", "soon"] as const).map((u, i) => {
        const mine = tasks.filter((t) => t.urgency === u);
        if (!mine.length) return null;
        return <UrgencyCard key={u} urgency={u} tasks={mine} structOf={structOf} busyId={busyId} onAction={onAction} delay={60 + i * 40} />;
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
    <Panel id="regola" className="scroll-mt-4" delay={160} label="Gruppi in regola">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-10 w-full items-center gap-2 rounded-2xl px-2.5 py-1.5 text-left transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold" style={{ backgroundColor: tint("var(--ok)", 16), color: "var(--ok)" }}>✓</span>
        <span className="min-w-0 flex-1 truncate text-[13px]"><span className="font-semibold text-txt">{enti.length === ENTI.length ? "Tutto in regola" : "Già in regola"}</span><span className="text-faint"> · {line}</span></span>
        <span className={`shrink-0 text-faint transition ${open ? "-rotate-90" : "rotate-90"}`}><Icon name="chevron" size={13} /></span>
      </button>
      {open && (
        <ul className="border-t border-line px-1 py-1">
          {enti.map((e) => {
            const m = ENTE_META[e];
            const d = summary.byEnte.find((x) => x.ente === e)?.done ?? 0;
            return (
              <li key={e} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
                <IconTile icon={m.icon} color="var(--ok)" size="sm" />
                <div className="min-w-0 flex-1 truncate text-xs"><span className="font-semibold text-txt">{m.short}</span><span className="text-faint"> · {m.allDone}{d > 0 ? ` · ${nWord(d, "completata", "completate")}` : ""}</span></div>
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1"><EmptyLine icon="search">Niente in questa categoria.</EmptyLine></div>
      <button type="button" onClick={onReset} className={BTN_QUIET}>Mostra tutto</button>
    </div>
  );
}
