"use client";

// Checklist di cose da fare per camere e zone comuni, con frequenza settimanale decisa dal titolare.
// L'addetta spunta (data e ora si registrano da sole); il titolare crea, modifica ed elimina le voci.
import { useMemo, useState } from "react";
import type { Structure, Unit } from "@/lib/types";
import {
  KEY_CHECKS, KEY_TASKS, WEEKDAY_SHORT, WEEKDAY_LONG, freqLabel, liveTasks, normalizeFreq, removeEntity, targetsFor, taskState, toggleCheck, weekDates, weekSummary,
  type CleanCheck, type CleanTask, type Freq, type TaskScope, type TaskState,
} from "@/lib/pulizie-addetta";
import { fmtDMY } from "@/lib/dates";
import { useConfirm } from "@/components/ConfirmProvider";
import Icon from "@/components/Icon";
import { useSyncedList } from "./useSyncedList";
import { Card, Field, Seg, Sheet, btnGhost, btnPrimary, hhmm, inputCls, newId, stamp } from "./addetta-ui";

const STATE_CHIP: Record<TaskState["state"], { label: string; color: string }> = {
  done: { label: "Fatta", color: "var(--ok)" },
  urgent: { label: "Da fare oggi", color: "var(--err)" },
  todo: { label: "Da fare", color: "#CA8A04" },
  later: { label: "", color: "var(--faint)" },
};

export default function AddettaChecklist({ structures, units, canEdit, isManager }: { structures: Structure[]; units: Unit[]; canEdit: boolean; isManager: boolean }) {
  const confirm = useConfirm();
  const [tasks, setTasks] = useSyncedList<CleanTask>(KEY_TASKS);
  const [checks, setChecks] = useSyncedList<CleanCheck>(KEY_CHECKS);
  const [editing, setEditing] = useState<null | Partial<CleanTask>>(null);
  const [onlyTodo, setOnlyTodo] = useState(false);
  const now = stamp();
  const today = now.today;
  const live = useMemo(() => liveTasks(tasks), [tasks]);
  const week = useMemo(() => weekSummary(live, structures, units, checks, today), [live, structures, units, checks, today]);
  const wd = weekDates(today);
  const pct = week.required ? Math.round((week.done / week.required) * 100) : 0;

  const tick = (task: CleanTask, targetId: string, structureId: string) => {
    if (!canEdit) return;
    const n = stamp();
    setChecks((prev) => toggleCheck(prev, { taskId: task.id, targetId, structureId, todayISO: n.today, nowISO: n.iso, nowMs: n.ms, newId: newId() }));
  };

  const sub = (s: TaskState): string => {
    if (s.state === "later" && s.nextDay) return `${s.done}/${s.required} · prossima ${WEEKDAY_LONG[s.nextDay - 1].toLowerCase()}`;
    if (s.today) return `${s.done}/${s.required} questa settimana · fatta oggi alle ${hhmm(s.today.at)}`;
    if (s.last) return `${s.done}/${s.required} questa settimana · ultima ${fmtDMY(s.last.date).slice(0, 5)} ${hhmm(s.last.at)}`;
    return `${s.done}/${s.required} questa settimana`;
  };

  const row = (task: CleanTask, target: { id: string; label: string; structureId: string }) => {
    const s = taskState(task, target.id, checks, today);
    if (onlyTodo && (s.state === "done" || s.state === "later")) return null;
    const ticked = !!s.today;
    const chip = STATE_CHIP[s.state];
    return (
      <div key={`${task.id}:${target.id}`} className="flex items-stretch">
      <button
        onClick={() => tick(task, target.id, target.structureId)}
        disabled={!canEdit}
        className={`flex min-h-[56px] min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition active:bg-wash ${s.state === "done" && !ticked ? "opacity-70" : ""}`}
        aria-pressed={ticked}
      >
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-lg font-bold leading-none ${ticked ? "border-[color:var(--ok)] bg-[color:var(--ok)] text-white" : s.state === "done" ? "border-[color:var(--ok)] text-[color:var(--ok)]" : "border-line text-transparent"}`}>✓</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${s.state === "done" ? "text-dim" : "text-txt"}`}>{task.scope === "room" ? target.label : task.name}</span>
          <span className="block truncate text-[11px] text-dim">{sub(s)}</span>
        </span>
        {chip.label && <span className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: chip.color, background: `color-mix(in srgb, ${chip.color} 14%, transparent)` }}>{s.overdue ? "In ritardo" : chip.label}</span>}
      </button>
      {isManager && <button onClick={() => setEditing(task)} aria-label={`Modifica la voce «${task.name}»`} title="Modifica la voce" className="grid w-11 shrink-0 place-items-center text-dim hover:bg-wash hover:text-txt"><Icon name="settings" size={15} /></button>}
      </div>
    );
  };

  const saveTask = () => {
    const e = editing; if (!e || !e.name?.trim()) return;
    const n = Date.now();
    const base = { name: e.name.trim(), scope: (e.scope ?? "common") as TaskScope, structureId: e.structureId || undefined, unitIds: e.scope === "room" && e.structureId && e.unitIds?.length ? e.unitIds : undefined, freq: normalizeFreq(e.freq) };
    setTasks((prev) => (e.id ? prev.map((t) => (t.id === e.id ? { ...t, ...base, updatedAt: n } : t)) : [...prev, { id: newId(), ...base, order: prev.length + 1, updatedAt: n }]));
    setEditing(null);
  };
  const delTask = async (t: CleanTask) => {
    if (!(await confirm({ title: "Eliminare la voce?", message: `«${t.name}» sparisce dalla checklist. Le spunte già fatte restano nei riepiloghi.`, danger: true, confirmLabel: "Elimina" }))) return;
    setTasks((prev) => removeEntity(prev, t.id, Date.now()));
    setEditing(null);
  };

  // Voci per struttura: zone comuni e camere
  const groups = structures.map((s) => {
    const mine = live.map((t) => ({ t, targets: targetsFor(t, [s], units) })).filter((x) => x.targets.length);
    return { s, common: mine.filter((x) => x.t.scope === "common"), rooms: mine.filter((x) => x.t.scope === "room") };
  }).filter((g) => g.common.length || g.rooms.length);

  return (
    <div className="flex flex-col gap-3">
      {/* Riga filtri: settimana e avanzamento, «Solo da fare», «Nuova voce» (titolare). Sotto, le voci da spuntare. */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="text-sm font-bold text-txt">Questa settimana <span className="font-normal text-dim">{fmtDMY(wd[0]).slice(0, 5)} – {fmtDMY(wd[6]).slice(0, 5)}</span></div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-dim">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-wash"><span className="block h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--ok)" }} /></span>
              <span>{week.done}/{week.required} spunte · {week.completed}/{week.targets} voci complete</span>
            </div>
          </div>
          <label className="flex min-h-[40px] cursor-pointer items-center gap-1.5 text-xs text-dim"><input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} className="h-4 w-4 accent-[color:var(--focus)]" /> Solo da fare</label>
          {isManager && <button onClick={() => setEditing({ scope: "common", freq: { kind: "weekly", times: 1 }, structureId: structures.length === 1 ? structures[0].id : undefined })} className="ml-auto flex min-h-[40px] items-center gap-1.5 rounded-lg bg-focus px-3 text-xs font-semibold text-white hover:opacity-90"><Icon name="plus" size={14} /> Nuova voce</button>}
        </div>
      </Card>

      {!canEdit && <p className="rounded-lg bg-wash px-3 py-2 text-xs text-dim">Hai solo il permesso di lettura: non puoi spuntare le voci.</p>}

      {groups.map(({ s, common, rooms }) => (
        <div key={s.id} className="flex flex-col gap-3">
          {structures.length > 1 && <div className="px-1 text-[11px] font-bold uppercase tracking-wide text-faint">{s.name}</div>}
          {common.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-1.5 border-b border-line bg-wash px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><Icon name="building" size={13} /> Zone comuni</div>
              <div className="divide-y divide-[color:var(--line)]">{common.map(({ t, targets }) => row(t, targets[0]))}</div>
            </Card>
          )}
          {rooms.map(({ t, targets }) => (
            <Card key={t.id} className="overflow-hidden">
              <div className="flex items-center gap-1.5 border-b border-line bg-wash px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-dim"><Icon name="bed" size={13} /> <span className="min-w-0 truncate">{t.name}</span> <span className="ml-auto whitespace-nowrap font-medium normal-case text-faint">{freqLabel(t.freq)}</span></div>
              <div className="divide-y divide-[color:var(--line)]">{targets.map((tg) => row(t, tg))}</div>
            </Card>
          ))}
        </div>
      ))}

      {editing && (
        <TaskEditor
          task={editing} structures={structures} units={units}
          onChange={setEditing} onClose={() => setEditing(null)} onSave={saveTask}
          onDelete={editing.id ? () => delTask(editing as CleanTask) : undefined}
        />
      )}
    </div>
  );
}

function TaskEditor({ task, structures, units, onChange, onClose, onSave, onDelete }: { task: Partial<CleanTask>; structures: Structure[]; units: Unit[]; onChange: (t: Partial<CleanTask>) => void; onClose: () => void; onSave: () => void; onDelete?: () => void }) {
  const freq: Freq = task.freq ?? { kind: "weekly", times: 1 };
  const scope = task.scope ?? "common";
  const roomsOfStruct = task.structureId ? units.filter((u) => u.structureId === task.structureId) : [];
  const picked = new Set(task.unitIds ?? []);
  const toggleDay = (d: number) => {
    const days = freq.kind === "days" ? freq.days : [];
    onChange({ ...task, freq: { kind: "days", days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b) } });
  };
  return (
    <Sheet
      title={task.id ? "Modifica voce" : "Nuova voce"} onClose={onClose}
      footer={<>
        {onDelete && <button onClick={onDelete} className="mr-auto rounded-lg px-3 py-2.5 text-sm font-semibold text-[color:var(--err)] hover:bg-wash">Elimina</button>}
        <button onClick={onClose} className={btnGhost}>Annulla</button>
        <button onClick={onSave} disabled={!task.name?.trim() || (freq.kind === "days" && freq.days.length === 0)} className={btnPrimary}>Salva</button>
      </>}
    >
      <Field label="Cosa fare">
        <input autoFocus value={task.name ?? ""} onChange={(e) => onChange({ ...task, name: e.target.value })} maxLength={120} placeholder="Es. Pulizia sopra i pensili della cucina" className={inputCls} />
      </Field>
      <Field label="Dove">
        <Seg<TaskScope> value={scope} onChange={(v) => onChange({ ...task, scope: v })} options={[{ key: "common", label: "Zona comune" }, { key: "room", label: "Nelle camere" }]} />
      </Field>
      {structures.length > 1 && (
        <Field label="Struttura">
          <select value={task.structureId ?? ""} onChange={(e) => onChange({ ...task, structureId: e.target.value || undefined, unitIds: undefined })} className={inputCls}>
            <option value="">Tutte le strutture</option>
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      )}
      {scope === "room" && roomsOfStruct.length > 0 && (
        <Field label="Camere" hint={picked.size ? `${picked.size} scelte` : "tutte"}>
          <div className="flex flex-wrap gap-1.5">
            {roomsOfStruct.map((u) => {
              const on = picked.has(u.id);
              return <button key={u.id} type="button" onClick={() => { const next = new Set(picked); if (on) next.delete(u.id); else next.add(u.id); onChange({ ...task, unitIds: [...next] }); }} className={`min-h-[36px] rounded-lg border px-3 text-xs font-semibold ${on ? "border-focus bg-focus text-white" : "border-line text-dim hover:bg-wash"}`}>{u.name}</button>;
            })}
          </div>
        </Field>
      )}
      <Field label="Quando">
        <Seg<Freq["kind"]> value={freq.kind} onChange={(k) => onChange({ ...task, freq: k === "weekly" ? { kind: "weekly", times: 1 } : { kind: "days", days: [] } })} options={[{ key: "weekly", label: "N volte a settimana" }, { key: "days", label: "Giorni fissi" }]} />
      </Field>
      {freq.kind === "weekly" ? (
        <div className="mt-2 flex items-center justify-center gap-4">
          <button type="button" onClick={() => onChange({ ...task, freq: { kind: "weekly", times: Math.max(1, freq.times - 1) } })} className="grid h-11 w-11 place-items-center rounded-full border border-line text-xl text-dim hover:bg-wash" aria-label="Meno">−</button>
          <span className="min-w-[8rem] text-center text-sm font-bold text-txt">{freqLabel(freq)}</span>
          <button type="button" onClick={() => onChange({ ...task, freq: { kind: "weekly", times: Math.min(7, freq.times + 1) } })} className="grid h-11 w-11 place-items-center rounded-full border border-line text-xl text-dim hover:bg-wash" aria-label="Più">+</button>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-7 gap-1">
          {WEEKDAY_SHORT.map((d, i) => {
            const on = freq.days.includes(i + 1);
            return <button key={d} type="button" onClick={() => toggleDay(i + 1)} className={`min-h-[44px] rounded-lg border text-xs font-semibold ${on ? "border-focus bg-focus text-white" : "border-line text-dim hover:bg-wash"}`}>{d}</button>;
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-faint">
        {freq.kind === "weekly" ? "Può essere fatta in uno qualsiasi dei giorni della settimana (lunedì–domenica)." : freq.days.length ? "Se il giorno passa senza spunta, la voce risulta «in ritardo»." : "Scegli almeno un giorno."}
      </p>
    </Sheet>
  );
}
