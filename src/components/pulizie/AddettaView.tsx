"use client";

// Vista pensata per la signora delle pulizie (e per il titolare che vuole vedere cosa vede lei):
// checklist settimanale, ore lavorate e materiale acquistato.
import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { useAccess } from "@/lib/access";
import Icon from "@/components/Icon";
import AddettaChecklist from "./AddettaChecklist";
import AddettaHours from "./AddettaHours";
import AddettaPurchases from "./AddettaPurchases";

type Sub = "checklist" | "ore" | "acquisti";
const SUBS: { key: Sub; label: string; icon: string }[] = [
  { key: "checklist", label: "Checklist", icon: "clipboard" },
  { key: "ore", label: "Ore", icon: "clock" },
  { key: "acquisti", label: "Acquisti", icon: "box" },
];

export default function AddettaView() {
  const { units, structures, activeStructureId } = useData();
  const { level } = useAccess();
  const [sub, setSub] = useState<Sub>("checklist");
  const canEdit = level("pulizie") === "edit";
  const isManager = level("impostazioni") === "edit"; // chi può configurare l'account crea e modifica anche le voci della checklist

  const scoped = useMemo(() => (activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId)), [structures, activeStructureId]);
  const ids = useMemo(() => new Set(scoped.map((s) => s.id)), [scoped]);
  const scopedUnits = useMemo(() => units.filter((u) => ids.has(u.structureId)), [units, ids]);

  if (!scoped.length) return <p className="rounded-xl border border-line bg-surface p-4 text-sm text-dim">Nessuna struttura disponibile.</p>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      {/* Schede: scorrevoli, con tocchi grandi */}
      <div className="sticky top-14 z-20 -mx-4 overflow-x-auto bg-paper px-4 py-1 md:-mx-6 md:px-6" role="tablist">
        <div className="flex w-max min-w-full gap-1.5 sm:w-full">
          {SUBS.map((s) => (
            <button
              key={s.key} role="tab" aria-selected={sub === s.key} onClick={() => setSub(s.key)}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-sm font-semibold transition ${sub === s.key ? "border-focus bg-focus text-white" : "border-line bg-surface text-dim hover:text-txt"}`}
            >
              <Icon name={s.icon} size={15} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      {sub === "checklist" && <AddettaChecklist structures={scoped} units={scopedUnits} canEdit={canEdit} isManager={isManager} />}
      {sub === "ore" && <AddettaHours structures={scoped} units={scopedUnits} canEdit={canEdit} activeStructureId={activeStructureId} />}
      {sub === "acquisti" && <AddettaPurchases structures={scoped} canEdit={canEdit} activeStructureId={activeStructureId} />}
    </div>
  );
}
