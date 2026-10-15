"use client";

// Ore lavorate dalla signora, messe in relazione con ciò che ha spuntato nello stesso periodo (camere pulite e voci della checklist).
import { useMemo, useState } from "react";
import type { Structure, Unit } from "@/lib/types";
import {
  KEY_CHECKS, KEY_DONE, KEY_HOURS, KEY_TASKS, fmtHours, monthOf, monthName, monthSummary, parseHours, removeEntity, shiftMonth,
  type CleanCheck, type CleanHours, type CleanTask,
} from "@/lib/pulizie-addetta";
import { fmtDMY } from "@/lib/dates";
import { useConfirm } from "@/components/ConfirmProvider";
import DateField from "@/components/DateField";
import Icon from "@/components/Icon";
import { useSyncedList, useSyncedMap } from "./useSyncedList";
import { Card, btnPrimary, inputCls, newId, stamp } from "./addetta-ui";

export default function AddettaHours({ structures, units, canEdit, activeStructureId }: { structures: Structure[]; units: Unit[]; canEdit: boolean; activeStructureId: string }) {
  const confirm = useConfirm();
  const [hours, setHours] = useSyncedList<CleanHours>(KEY_HOURS);
  const [checks] = useSyncedList<CleanCheck>(KEY_CHECKS);
  const [tasks] = useSyncedList<CleanTask>(KEY_TASKS);
  // Camere segnate come pulite: mappa `${unitId}:${data}` → ora (chiave già usata dal planning)
  const [done] = useSyncedMap<string>(KEY_DONE);
  const today = stamp().today;
  const [date, setDate] = useState(today);
  const [val, setVal] = useState("");
  const [note, setNote] = useState("");
  const [sid, setSid] = useState(activeStructureId !== "all" ? activeStructureId : "");
  const [ym, setYm] = useState(monthOf(today));
  const [err, setErr] = useState("");

  const sidScope = (x?: string) => activeStructureId === "all" || !x || x === activeStructureId;
  const unitStruct = useMemo(() => new Map(units.map((u) => [u.id, u.structureId])), [units]);
  const scopedHours = hours.filter((h) => sidScope(h.structureId));
  const scopedChecks = checks.filter((c) => sidScope(c.structureId));
  const roomDates = Object.keys(done).map((k) => ({ unit: k.slice(0, k.lastIndexOf(":")), date: k.slice(k.lastIndexOf(":") + 1) })).filter((x) => sidScope(unitStruct.get(x.unit))).map((x) => x.date);
  const sum = monthSummary({ ym, hours: scopedHours, checks: scopedChecks, roomDates, tasks });
  const entries = scopedHours.filter((h) => !h._deleted && monthOf(h.date) === ym).sort((a, b) => b.date.localeCompare(a.date));

  const add = () => {
    const h = parseHours(val);
    if (h == null) { setErr("Scrivi le ore, ad esempio 4 oppure 4,5 (massimo 24)."); return; }
    if (!date) { setErr("Scegli il giorno."); return; }
    setErr("");
    const n = stamp();
    setHours((prev) => [...prev, { id: newId(), date, hours: h, structureId: sid || undefined, note: note.trim() || undefined, updatedAt: n.ms }]);
    setVal(""); setNote("");
    setYm(monthOf(date));
  };
  const del = async (h: CleanHours) => {
    if (!(await confirm({ title: "Eliminare le ore?", message: `${fmtDMY(h.date)} · ${fmtHours(h.hours)}`, danger: true, confirmLabel: "Elimina" }))) return;
    setHours((prev) => removeEntity(prev, h.id, Date.now()));
  };

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <Card className="p-3">
          <div className="mb-2 text-sm font-bold text-txt">Ore lavorate</div>
          <div className="grid grid-cols-2 gap-2">
            <div><div className="mb-1 text-[11px] font-medium text-dim">Giorno</div><DateField value={date} onChange={setDate} className="w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm" /></div>
            <label className="block"><div className="mb-1 text-[11px] font-medium text-dim">Ore</div><input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Es. 4,5" className={inputCls + " py-2.5"} /></label>
          </div>
          {structures.length > 1 && (
            <select value={sid} onChange={(e) => setSid(e.target.value)} className={inputCls + " mt-2"}>
              <option value="">Tutte le strutture</option>
              {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Nota (facoltativa)" className={inputCls + " mt-2"} />
          {err && <p className="mt-2 text-xs text-[color:var(--err)]">{err}</p>}
          <button onClick={add} className={btnPrimary + " mt-3 flex min-h-[48px] w-full items-center justify-center gap-2"}><Icon name="plus" size={15} /> Aggiungi ore</button>
        </Card>
      )}

      {/* Mese */}
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setYm((m) => shiftMonth(m, -1))} aria-label="Mese precedente" className="grid h-11 w-11 place-items-center rounded-lg border border-line text-lg text-dim hover:bg-wash">‹</button>
        <span className="text-sm font-bold capitalize text-txt">{monthName(ym)}</span>
        <button onClick={() => setYm((m) => shiftMonth(m, 1))} aria-label="Mese successivo" className="grid h-11 w-11 place-items-center rounded-lg border border-line text-lg text-dim hover:bg-wash">›</button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["Ore totali", fmtHours(sum.totalHours)], ["Giorni lavorati", String(sum.daysWorked)], ["Camere pulite", String(sum.roomsCleaned)], ["Voci checklist", String(sum.taskChecks)]] as [string, string][]).map(([l, v]) => (
          <Card key={l} className="p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-dim">{l}</div><div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-txt">{v}</div></Card>
        ))}
      </div>

      {/* Ore inserite */}
      <Card className="overflow-hidden">
        <div className="border-b border-line bg-wash px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-dim">Ore inserite</div>
        {entries.length === 0 ? <div className="px-3 py-4 text-center text-xs text-faint">Nessuna ora inserita in questo mese.</div> : (
          <div className="divide-y divide-[color:var(--line)]">
            {entries.map((h) => (
              <div key={h.id} className="flex min-h-[48px] items-center gap-2 px-3 py-1.5">
                <span className="w-24 shrink-0 whitespace-nowrap font-mono text-xs text-dim">{fmtDMY(h.date)}</span>
                <span className="w-16 shrink-0 whitespace-nowrap text-sm font-bold text-txt">{fmtHours(h.hours)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-dim">{[structures.length > 1 && h.structureId ? structures.find((s) => s.id === h.structureId)?.name : "", h.note].filter(Boolean).join(" · ")}</span>
                {canEdit && <button onClick={() => del(h)} aria-label="Elimina" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-faint hover:text-[color:var(--err)]"><Icon name="trash" size={15} /></button>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ore e attività: giorno per giorno e per attività */}
      {sum.days.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line bg-wash px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-dim">Giorno per giorno</div>
          <div className="grid grid-cols-[6rem_1fr_1fr_1fr] gap-x-2 border-b border-line px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-faint"><span>Giorno</span><span>Ore</span><span>Camere</span><span>Voci</span></div>
          <div className="divide-y divide-[color:var(--line)]">
            {sum.days.map((d) => (
              <div key={d.date} className="grid grid-cols-[6rem_1fr_1fr_1fr] gap-x-2 px-3 py-1.5 text-xs">
                <span className="whitespace-nowrap font-mono text-dim">{fmtDMY(d.date).slice(0, 5)}</span>
                <span className={`whitespace-nowrap font-semibold ${d.hours ? "text-txt" : "text-faint"}`}>{d.hours ? fmtHours(d.hours) : "—"}</span>
                <span className="text-dim">{d.rooms || "—"}</span>
                <span className="text-dim">{d.checks || "—"}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {sum.perTask.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line bg-wash px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-dim">Ore per attività <span className="font-medium normal-case text-faint">· stima</span></div>
          <div className="divide-y divide-[color:var(--line)]">
            {sum.perTask.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-txt">{r.name}</span>
                <span className="shrink-0 whitespace-nowrap text-dim">{r.checks}×</span>
                <span className="w-14 shrink-0 whitespace-nowrap text-right font-semibold text-txt">{sum.totalHours ? fmtHours(r.estHours) : "—"}</span>
              </div>
            ))}
            {sum.unallocatedHours > 0 && <div className="flex items-center gap-2 px-3 py-2 text-xs text-dim"><span className="min-w-0 flex-1 truncate">Ore in giorni senza nulla di spuntato</span><span className="shrink-0 whitespace-nowrap font-semibold">{fmtHours(sum.unallocatedHours)}</span></div>}
          </div>
          <p className="border-t border-line px-3 py-2 text-[11px] text-faint">Le ore di ogni giorno sono divise in parti uguali tra le camere e le voci spuntate quel giorno: è una stima, non un cronometro.</p>
        </Card>
      )}
    </div>
  );
}

