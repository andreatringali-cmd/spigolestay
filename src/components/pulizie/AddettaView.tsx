"use client";

// Vista pensata per la signora delle pulizie (e per il titolare che vuole vedere cosa vede lei):
// ore lavorate (checklist e acquisti stanno nelle schede Checklist e Scorte & spesa).
import { useMemo } from "react";
import { useData } from "@/lib/store";
import { useAccess } from "@/lib/access";
import AddettaChecklist from "./AddettaChecklist";
import AddettaHours from "./AddettaHours";

/** section "checklist" = solo la checklist (scheda a sé); "addetta" = ore lavorate. */
export default function AddettaView({ section = "addetta" }: { section?: "checklist" | "addetta" }) {
  const { units, structures, activeStructureId } = useData();
  const { level } = useAccess();
  const canEdit = level("pulizie") === "edit";
  const isManager = level("impostazioni") === "edit"; // chi può configurare l'account crea e modifica anche le voci della checklist

  const scoped = useMemo(() => (activeStructureId === "all" ? structures : structures.filter((s) => s.id === activeStructureId)), [structures, activeStructureId]);
  const ids = useMemo(() => new Set(scoped.map((s) => s.id)), [scoped]);
  const scopedUnits = useMemo(() => units.filter((u) => ids.has(u.structureId)), [units, ids]);

  if (!scoped.length) return <p className="rounded-xl border border-line bg-surface p-4 text-sm text-dim">Nessuna struttura disponibile.</p>;

  if (section === "checklist") return <div className="mx-auto flex w-full max-w-3xl flex-col gap-3"><AddettaChecklist structures={scoped} units={scopedUnits} canEdit={canEdit} isManager={isManager} /></div>;

  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-3"><AddettaHours structures={scoped} units={scopedUnits} canEdit={canEdit} activeStructureId={activeStructureId} /></div>;
}
