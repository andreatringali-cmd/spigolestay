"use client";

// Checklist di cose da fare per camere e zone comuni, con frequenza settimanale decisa dal titolare.
// L'addetta spunta (data e ora si registrano da sole); il titolare crea, modifica ed elimina le voci.
import { useEffect, useMemo, useState } from "react";
import type { Structure, Unit } from "@/lib/types";
import {
  EXAMPLE_TASK_PREFIX, KEY_CHECKS, KEY_TASKS, exampleTasksFor, WEEKDAY_SHORT, WEEKDAY_LONG, freqLabel, liveTasks, normalizeFreq, removeEntity, targetsFor, taskState, toggleCheck, weekDates, weekStart, weekSummary,
  type CleanCheck, type CleanTask, type Freq, type TaskScope, type TaskState,
} from "@/lib/pulizie-addetta";
import { addDays, fmtDMY, parseISO, toISO } from "@/lib/dates";
import DateField from "@/components/DateField";
import { useConfirm } from "@/components/ConfirmProvider";
import Icon from "@/components/Icon";
import { readList, useSyncedList } from "./useSyncedList";
import { Card, Field, Seg, Sheet, btnGhost, btnPrimary, hhmm, inputCls, newId, stamp } from "./addetta-ui";

const STATE_CHIP: Record<TaskState["state"], { label: string; color: string }> = {
  done: { label: "Fatta", color: "var(--ok)" },
  urgent: { label: "Da fare oggi", color: "var(--err)" },
  todo: { label: "Da fare", color: "var(--warn)" },
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
  // Settimana scelta (qualunque data al suo interno). Quella corrente si spunta; le altre si consultano soltanto.
  const [pick, setPick] = useState("");
  const viewDay = pick || today;
  const isCurrent = weekStart(viewDay) === weekStart(today);
  const isPast = weekStart(viewDay) < weekStart(today);
  // Giorno di riferimento per i calcoli: oggi nella settimana corrente; a fine settimana per una passata (conta quanto è stato fatto); a inizio per una futura.
  const ref = isCurrent ? today : isPast ? weekDates(viewDay)[6] : weekStart(viewDay);
  const shiftWeek = (n: number) => setPick(toISO(addDays(parseISO(weekStart(viewDay)), 7 * n)));
  const live = useMemo(() => liveTasks(tasks), [tasks]);
  // Esempi scritti nel codice: una struttura senza voci parte con le tre voci d'esempio (una sola volta: gli id sono fissi, se le elimini non tornano).
  // Si attende qualche secondo: la sincronizzazione può portare le voci vere da un altro dispositivo.
  useEffect(() => {
    if (!canEdit) return;
    const t = setTimeout(() => {
      const prev = readList<CleanTask>(KEY_TASKS);
      const lv = liveTasks(prev);
      const add = structures.flatMap((s) =>
        prev.some((x) => x.id.startsWith(`${EXAMPLE_TASK_PREFIX}${s.id}:`)) || lv.some((x) => targetsFor(x, [s], units).length) ? [] : exampleTasksFor(s.id));
      if (add.length) setTasks((p) => [...p, ...add.filter((a) => !p.some((x) => x.id === a.id))]);
    }, 2500);
    return () => clearTimeout(t);
  }, [canEdit, structures, units, setTasks]);
  const week = useMemo(() => weekSummary(live, structures, units, checks, ref), [live, structures, units, checks, ref]);
  const wd = weekDates(viewDay);
  const pct = week.required ? Math.round((week.done / week.required) * 100) : 0;

  // Un solo pulsante per voce. Finché mancano spunte ne aggiunge una (anche più volte nello stesso giorno); a voce completa, un altro tocco annulla le spunte di OGGI.
  const tick = (task: CleanTask, targetId: string, structureId: string, st: TaskState) => {
    if (!canEdit) return;
    const n = stamp();
    if (st.done < st.required) {
      setChecks((prev) => [...prev, { id: newId(), taskId: task.id, targetId, structureId, date: n.today, at: n.iso, updatedAt: n.ms }]);
    } else if (st.today) {
      setChecks((prev) => toggleCheck(prev, { taskId: task.id, targetId, structureId, todayISO: n.today, nowISO: n.iso, nowMs: n.ms, newId: newId() })); // rimuove le spunte di oggi
    }
  };

  const sub = (s: TaskState): string => {
    if (!isCurrent) return s.last ? `${s.done}/${s.required} · ultima ${fmtDMY(s.last.date).slice(0, 5)} ${hhmm(s.last.at)}` : `${s.done}/${s.required}`;
    if (s.state === "later" && s.nextDay) return `${s.done}/${s.required} · prossima ${WEEKDAY_LONG[s.nextDay - 1].toLowerCase()}`;
    if (s.today) return `${s.done}/${s.required} questa settimana · ultima oggi alle ${hhmm(s.today.at)}`;
    if (s.last) return `${s.done}/${s.required} questa settimana · ultima ${fmtDMY(s.last.date).slice(0, 5)} ${hhmm(s.last.at)}`;
    return `${s.done}/${s.required} questa settimana`;
  };

  const row = (task: CleanTask, target: { id: string; label: string; structureId: string }) => {
    const s = taskState(task, target.id, checks, ref);
    if (onlyTodo && (s.state === "done" || (isCurrent && s.state === "later"))) return null;
    const full = isCurrent && s.done >= s.required;              // voce completa: spunta verde
    const partial = isCurrent && s.done > 0 && s.done < s.required; // fatta in parte (es. 1 di 2): cerchio arancione con «1/2»
    const ticked = full;
    const chip = isCurrent ? STATE_CHIP[s.state] : s.state === "done" ? STATE_CHIP.done : isPast ? { label: "Non fatta", color: "var(--err)" } : { label: "", color: "var(--faint)" };
    return (
      <div key={`${task.id}:${target.id}`} className="flex items-stretch">
      <button
        onClick={() => tick(task, target.id, target.structureId, s)}
        disabled={!canEdit || !isCurrent || (full && !s.today)}
        title={!isCurrent ? undefined : full ? (s.today ? "Completa: tocca per annullare le spunte di oggi" : "Completa per questa settimana") : "Tocca per segnarla come fatta"}
        className={`flex min-h-[56px] min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition active:bg-wash ${s.state === "done" && !ticked ? "opacity-70" : ""}`}
        aria-pressed={ticked}
      >
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 font-bold leading-none ${full ? "border-[color:var(--ok)] bg-[color:var(--ok)] text-lg text-on-ok" : partial ? "border-[color:var(--warn)] bg-[color:color-mix(in_srgb,var(--warn)_12%,transparent)] text-[11px] text-[color:var(--warn)]" : "border-line text-lg text-transparent"}`}>{partial ? `${s.done}/${s.required}` : "✓"}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${s.state === "done" ? "text-dim" : "text-txt"}`}>{task.scope === "room" ? target.label : task.name}</span>
          <span className="block truncate text-[11px] text-dim">{sub(s)}</span>
        </span>
        {chip.label && <span className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: chip.color, background: `color-mix(in srgb, ${chip.color} 14%, transparent)` }}>{isCurrent && s.overdue ? "In ritardo" : chip.label}</span>}
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
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => shiftWeek(-1)} aria-label="Settimana precedente" title="Settimana precedente" className="grid h-9 w-9 place-items-center rounded-lg border border-line text-dim hover:bg-wash">‹</button>
              <div className="text-sm font-bold text-txt">{isCurrent ? "Questa settimana" : isPast ? "Settimana passata" : "Settimana futura"} <span className="font-normal text-dim">{fmtDMY(wd[0]).slice(0, 5)} – {fmtDMY(wd[6]).slice(0, 5)}</span></div>
              <button onClick={() => shiftWeek(1)} aria-label="Settimana successiva" title="Settimana successiva" className="grid h-9 w-9 place-items-center rounded-lg border border-line text-dim hover:bg-wash">›</button>
              <DateField value={viewDay} onChange={(v) => setPick(v)} title="Scegli una data: si apre la sua settimana" className="w-36 rounded-lg border border-line bg-paper px-2 py-2 text-sm" />
              {!isCurrent && <button onClick={() => setPick("")} className="min-h-[36px] rounded-lg border border-line px-2.5 text-xs font-semibold text-focus hover:bg-wash">Questa settimana</button>}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-dim">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-wash"><span className="block h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--ok)" }} /></span>
              <span title="Ogni voce va fatta un certo numero di volte a settimana: «spunte» sono le volte già fatte su quelle richieste in tutto.">{week.done} spunte fatte su {week.required} richieste · {week.completed} voci complete su {week.targets}</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setOnlyTodo((v) => !v)} aria-pressed={onlyTodo} className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${onlyTodo ? "border-transparent bg-focus text-on-focus" : "border-line text-dim hover:bg-wash hover:text-txt"}`}>Solo da fare</button>
  {isManager && <button onClick={() => setEditing({ scope: "common", freq: { kind: "weekly", times: 1 }, structureId: structures.length === 1 ? structures[0].id : undefined })} className="flex h-9 items-center gap-1.5 rounded-lg bg-focus px-3 text-xs font-semibold text-on-focus hover:opacity-90"><Icon name="plus" size={14} /> Nuova voce</button>}
          </div>
        </div>
      </Card>

      {!canEdit && <p className="rounded-lg bg-wash px-3 py-2 text-xs text-dim">Hai solo il permesso di lettura: non puoi spuntare le voci.</p>}
      {canEdit && !isCurrent && <p className="rounded-lg bg-wash px-3 py-2 text-xs text-dim">Stai guardando {isPast ? "una settimana passata" : "una settimana futura"}: le voci si possono spuntare solo nella settimana corrente.</p>}

      {groups.map(({ s, common, rooms }) => (
        <div key={s.id} className="flex flex-col gap-3">
          {structures.length > 1 && <div className="px-1 text-[11px] font-bold uppercase tracking-wide text-dim">{s.name}</div>}
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
              return <button key={u.id} type="button" onClick={() => { const next = new Set(picked); if (on) next.delete(u.id); else next.add(u.id); onChange({ ...task, unitIds: [...next] }); }} className={`min-h-[36px] rounded-lg border px-3 text-xs font-semibold ${on ? "border-focus bg-focus text-on-focus" : "border-line text-dim hover:bg-wash"}`}>{u.name}</button>;
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
            return <button key={d} type="button" onClick={() => toggleDay(i + 1)} className={`min-h-[44px] rounded-lg border text-xs font-semibold ${on ? "border-focus bg-focus text-on-focus" : "border-line text-dim hover:bg-wash"}`}>{d}</button>;
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-faint">
        {freq.kind === "weekly" ? "Può essere fatta in uno qualsiasi dei giorni della settimana (lunedì–domenica)." : freq.days.length ? "Se il giorno passa senza spunta, la voce risulta «in ritardo»." : "Scegli almeno un giorno."}
      </p>
    </Sheet>
  );
}
