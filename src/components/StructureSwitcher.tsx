"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { useAccess } from "@/lib/access";
import Icon from "./Icon";

export default function StructureSwitcher() {
  const { allStructures, activeStructureId, setActiveStructure, selectedStructureIds, setActiveStructures } = useData();
  // Utente staff con restrizione: solo le strutture consentite e niente vista "Tutte" (null = nessuna restrizione).
  const { allowedStructureIds } = useAccess();
  const structures = allowedStructureIds ? allStructures.filter((s) => allowedStructureIds.includes(s.id)) : allStructures;
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);

  // Selezione multipla: spunta le strutture che vuoi vedere (insieme). Una sola = come prima; tutte = "Tutte le strutture".
  const chosen = new Set(selectedStructureIds.filter((id) => structures.some((s) => s.id === id)));
  const allOn = structures.length > 0 && structures.every((s) => chosen.has(s.id));
  const current = chosen.size === 1 ? structures.find((s) => chosen.has(s.id)) : undefined;
  const apply = (ids: string[]) => { if (ids.length) setActiveStructures(ids); };
  const toggle = (id: string) => { const next = new Set(chosen); if (next.has(id)) next.delete(id); else next.add(id); apply([...next]); };
  const only = (id: string) => { setActiveStructure(id); setOpen(false); };
  const label = current ? null : allOn ? t("Tutte le strutture") : `${chosen.size} ${t("strutture")}`;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-line bg-paper py-1.5 pl-2.5 pr-2 text-sm transition hover:border-focus"
      >
        <span style={{ color: "var(--focus)" }}><Icon name="building" size={16} /></span>
        {current ? (
          <span className="flex items-baseline gap-1.5">
            <span className="max-w-[110px] truncate font-medium text-txt sm:max-w-[180px]">{current.name}</span>
            {current.city && <span className="hidden text-[11px] text-faint sm:inline">{current.city}</span>}
          </span>
        ) : (
          <span className="font-medium text-txt">{label}</span>
        )}
        <span className={`text-dim transition-transform ${open ? "rotate-90" : ""}`}><Icon name="chevron" size={14} /></span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl">
          {!allowedStructureIds && <Item checked={allOn} onClick={() => apply(structures.map((x) => x.id))} name={t("Tutte le strutture")} />}
          {!allowedStructureIds && <div className="my-1 border-t border-line" />}
          {structures.map((x) => (
            <Item key={x.id} checked={chosen.has(x.id)} onClick={() => toggle(x.id)} name={x.name} sub={x.city} onOnly={structures.length > 1 ? () => only(x.id) : undefined} onlyLabel={t("solo")} />
          ))}
          {structures.length > 1 && <div className="mt-1 border-t border-line px-2.5 pb-1 pt-1.5 text-[11px] text-faint">{t("Spunta le strutture che vuoi vedere insieme.")}</div>}
        </div>
      )}
    </div>
  );
}

function Item({ checked, onClick, name, sub, onOnly, onlyLabel }: { checked: boolean; onClick: () => void; name: string; sub?: string; onOnly?: () => void; onlyLabel?: string }) {
  return (
    <div className="group flex items-center rounded-lg transition hover:bg-wash" style={checked ? { backgroundColor: "color-mix(in srgb, var(--focus) 8%, transparent)" } : undefined}>
      <button onClick={onClick} role="checkbox" aria-checked={checked} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm">
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-bold leading-none text-white" style={{ borderColor: checked ? "var(--focus)" : "var(--line)", background: checked ? "var(--focus)" : "transparent" }}>{checked ? "✓" : ""}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-txt">{name}</span>
        {sub && <span className="text-[11px] text-faint">{sub}</span>}
      </button>
      {onOnly && <button onClick={onOnly} title={onlyLabel} className="mr-1.5 rounded-md px-1.5 py-1 text-[11px] font-semibold text-focus opacity-0 transition hover:bg-surface group-hover:opacity-100 focus-visible:opacity-100">{onlyLabel}</button>}
    </div>
  );
}
