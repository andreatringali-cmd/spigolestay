"use client";

// Segnalazioni di problemi per singola camera o zona comune ("non funziona la tv", "cambiare la lampadina del bagno"…).
// Stessa lista della pagina Pulizie e del badge nel menu: il titolare le vede lì, aperte e risolte.
import { useMemo, useState } from "react";
import type { Structure, Unit } from "@/lib/types";
import { KEY_ISSUES, createIssue, isZoneId, issueTargets, removeEntity, setIssueResolved, type PulizieIssue } from "@/lib/pulizie-addetta";
import { fmtDMY } from "@/lib/dates";
import { useConfirm } from "@/components/ConfirmProvider";
import Icon from "@/components/Icon";
import { useSyncedList } from "./useSyncedList";
import { Card, Field, Sheet, btnGhost, btnPrimary, hhmm, inputCls, newId, stamp } from "./addetta-ui";

const TYPES: { key: string; label: string; color: string }[] = [
  { key: "guasto", label: "Guasto", color: "var(--err)" },
  { key: "danno", label: "Danno / macchia", color: "var(--warn)" },
  { key: "scorte", label: "Scorte finite", color: "var(--ok)" },
  { key: "smarrito", label: "Oggetto smarrito", color: "var(--focus)" },
  { key: "altro", label: "Altro", color: "var(--dim)" },
];
const typeMeta = (k: string) => TYPES.find((t) => t.key === k) ?? TYPES[TYPES.length - 1];

export default function AddettaIssues({ structures, units, canEdit, activeStructureId }: { structures: Structure[]; units: Unit[]; canEdit: boolean; activeStructureId: string }) {
  const confirm = useConfirm();
  const [issues, setIssues] = useSyncedList<PulizieIssue>(KEY_ISSUES);
  const targets = useMemo(() => issueTargets(structures, units), [structures, units]);
  const [draft, setDraft] = useState<null | { unitId: string; type: string; note: string }>(null);
  const [showResolved, setShowResolved] = useState(false);

  const inStruct = (i: PulizieIssue) => {
    const sid = i.structureId ?? units.find((u) => u.id === i.unitId)?.structureId;
    return activeStructureId === "all" || !sid || sid === activeStructureId;
  };
  const visible = issues.filter((i) => !i._deleted && inStruct(i));
  const open = visible.filter((i) => !i.resolved).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const resolved = visible.filter((i) => i.resolved).sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt));

  const save = () => {
    if (!draft) return;
    const target = targets.find((t) => t.unitId === draft.unitId);
    if (!target) return;
    const n = stamp();
    setIssues((prev) => createIssue(prev, { id: newId(), target, type: draft.type, note: draft.note, dateISO: n.today, nowISO: n.iso, nowMs: n.ms }));
    setDraft(null);
  };
  const toggle = (i: PulizieIssue, resolvedNow: boolean) => { const n = stamp(); setIssues((prev) => setIssueResolved(prev, i.id, resolvedNow, n.iso, n.ms)); };
  const del = async (i: PulizieIssue) => {
    if (!(await confirm({ title: "Eliminare la segnalazione?", message: `«${i.note}» verrà tolta dall'elenco.`, danger: true, confirmLabel: "Elimina" }))) return;
    setIssues((prev) => removeEntity(prev, i.id, Date.now()));
  };
  const when = (iso: string) => `${fmtDMY(iso).slice(0, 5)} ${hhmm(iso)}`.trim();

  const item = (i: PulizieIssue, isOpen: boolean) => {
    const m = typeMeta(i.type);
    return (
      <div key={i.id} className="flex items-start gap-2 px-3 py-2.5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${m.color} 14%, transparent)`, color: m.color }}><Icon name={isZoneId(i.unitId) ? "building" : "bed"} size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs"><span className="font-bold text-txt">{i.unitName}</span>{structures.length > 1 && <span className="text-faint">· {i.structureName}</span>}<span className="font-semibold" style={{ color: m.color }}>· {m.label}</span></div>
          <div className="break-words text-sm text-txt">{i.note}</div>
          <div className="mt-0.5 text-[11px] text-faint">{isOpen ? `Segnalata ${when(i.createdAt)}` : `Segnalata ${when(i.createdAt)} · risolta ${i.resolvedAt ? when(i.resolvedAt) : ""}`}</div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <button onClick={() => toggle(i, isOpen)} title={isOpen ? "Segna risolto" : "Riapri"} aria-label={isOpen ? "Segna risolto" : "Riapri"} className={`grid h-10 w-10 place-items-center rounded-lg border border-line text-base hover:bg-wash ${isOpen ? "text-[color:var(--ok)]" : "text-dim"}`}>{isOpen ? "✓" : "↺"}</button>
            <button onClick={() => del(i)} title="Elimina" aria-label="Elimina" className="grid h-10 w-10 place-items-center rounded-lg border border-line text-faint hover:text-[color:var(--err)]"><Icon name="trash" size={15} /></button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <button onClick={() => setDraft({ unitId: targets[0]?.unitId ?? "", type: "guasto", note: "" })} disabled={!targets.length} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-focus px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-40"><Icon name="alertTriangle" size={16} /> Segnala un problema</button>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-1.5 border-b border-line bg-wash px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-dim">Aperte <span className="text-faint">· {open.length}</span></div>
        {open.length === 0 ? <div className="px-3 py-4 text-center text-xs text-faint">Nessun problema aperto.</div> : <div className="divide-y divide-[color:var(--line)]">{open.map((i) => item(i, true))}</div>}
      </Card>

      {resolved.length > 0 && (
        <Card className="overflow-hidden">
          <button onClick={() => setShowResolved((v) => !v)} className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-[11px] font-bold uppercase tracking-wide text-dim">Risolte <span className="text-faint">· {resolved.length}</span><span className="ml-auto text-xs font-medium normal-case">{showResolved ? "▲" : "▼"}</span></button>
          {showResolved && <div className="divide-y divide-[color:var(--line)] border-t border-line">{resolved.slice(0, 60).map((i) => item(i, false))}</div>}
        </Card>
      )}

      {draft && (
        <Sheet title="Segnala un problema" onClose={() => setDraft(null)} footer={<><button onClick={() => setDraft(null)} className={btnGhost}>Annulla</button><button onClick={save} disabled={!draft.note.trim() || !draft.unitId} className={btnPrimary}>Invia segnalazione</button></>}>
          <Field label="Dove">
            <select value={draft.unitId} onChange={(e) => setDraft({ ...draft, unitId: e.target.value })} className={inputCls}>
              {structures.map((s) => (
                <optgroup key={s.id} label={s.name}>
                  {targets.filter((t) => t.structureId === s.id).map((t) => <option key={t.unitId} value={t.unitId}>{t.unitName}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Tipo">
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map((t) => <button key={t.key} type="button" onClick={() => setDraft({ ...draft, type: t.key })} className={`min-h-[40px] rounded-lg border px-3 text-xs font-semibold ${draft.type === t.key ? "text-white" : "border-line text-dim hover:bg-wash"}`} style={draft.type === t.key ? { background: t.color, borderColor: t.color } : undefined}>{t.label}</button>)}
            </div>
          </Field>
          <Field label="Cosa non va">
            <textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} rows={3} maxLength={400} placeholder="Es. Non funziona la TV · Cambiare la lampadina dell'applique del bagno" className={inputCls} />
          </Field>
        </Sheet>
      )}
    </div>
  );
}
