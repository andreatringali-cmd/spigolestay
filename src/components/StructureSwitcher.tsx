"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import Icon from "./Icon";

export default function StructureSwitcher() {
  const { structures, activeStructureId, setActiveStructure } = useData();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);

  const current = structures.find((s) => s.id === activeStructureId);
  const pick = (id: string) => { setActiveStructure(id); setOpen(false); };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-line bg-paper py-1.5 pl-2.5 pr-2 text-sm transition hover:border-focus"
      >
        <span style={{ color: "var(--focus)" }}><Icon name="building" size={16} /></span>
        {current ? (
          <span className="flex items-baseline gap-1.5">
            <span className="max-w-[180px] truncate font-medium text-txt">{current.name}</span>
            <span className="font-mono text-[11px] text-faint">{current.id}</span>
          </span>
        ) : (
          <span className="font-medium text-txt">{t("Tutte le strutture")}</span>
        )}
        <span className={`text-dim transition-transform ${open ? "rotate-90" : ""}`}><Icon name="chevron" size={14} /></span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl">
          <Item active={activeStructureId === "all"} onClick={() => pick("all")} name={t("Tutte le strutture")} />
          <div className="my-1 border-t border-line" />
          {structures.map((s) => (
            <Item key={s.id} active={activeStructureId === s.id} onClick={() => pick(s.id)} name={s.name} id={s.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function Item({ active, onClick, name, id }: { active: boolean; onClick: () => void; name: string; id?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-wash"
      style={active ? { backgroundColor: "color-mix(in srgb, var(--focus) 12%, transparent)" } : undefined}
    >
      <span style={{ color: active ? "var(--focus)" : "var(--faint)" }}><Icon name="building" size={16} /></span>
      <span className="min-w-0 flex-1 truncate font-medium text-txt">{name}</span>
      {id && <span className="font-mono text-[11px] text-faint">{id}</span>}
      {active && <span style={{ color: "var(--focus)" }}>✓</span>}
    </button>
  );
}
