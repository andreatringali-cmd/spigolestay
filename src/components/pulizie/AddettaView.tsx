"use client";

// Checklist della signora delle pulizie (e per il titolare che vuole vedere cosa vede lei): voci per camera o zona comune, con frequenza settimanale.
import { useMemo } from "react";
import { useData } from "@/lib/store";
import { useAccess } from "@/lib/access";
import AddettaChecklist from "./AddettaChecklist";

export default function AddettaView() {
  const { units, structures, activeStructureId } = useData();
  const { level } = useAccess();
  const canEdit = level("pulizie") === "edit";
  const isManager = level("impostazioni") === "edit"; // chi può configurare l'account crea e modifica anche le voci della checklist

  const scoped = useMemo(() => (activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId)), [structures, activeStructureId]);
  const ids = useMemo(() => new Set(scoped.map((s) => s.id)), [scoped]);
  const scopedUnits = useMemo(() => units.filter((u) => ids.has(u.structureId)), [units, ids]);

  if (!scoped.length) return <p className="rounded-xl border border-line bg-surface p-4 text-sm text-dim">Nessuna struttura disponibile.</p>;
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-3"><AddettaChecklist structures={scoped} units={scopedUnits} canEdit={canEdit} isManager={isManager} /></div>;
}
