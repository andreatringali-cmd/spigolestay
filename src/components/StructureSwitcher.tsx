"use client";

import { useRef, useState } from "react";
import { useData } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import { useAccess } from "@/lib/access";
import Icon from "./Icon";
import Popover from "./Popover";
import { useStructLoad } from "@/lib/struct-load";
import { HOME_PREF_KEY } from "@/lib/home-struct";

export default function StructureSwitcher() {
  const { allStructures, activeStructureId, setActiveStructure, selectedStructureIds, setActiveStructures } = useData();
  // Utente staff con restrizione: solo le strutture consentite e niente vista "Tutte" (null = nessuna restrizione).
  const { allowedStructureIds } = useAccess();
  const structures = allowedStructureIds ? allStructures.filter((s) => allowedStructureIds.includes(s.id)) : allStructures;
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const sl = useStructLoad(); // modalità veloce: "Carico <struttura>…" mentre arrivano i dati di un'altra struttura (la vista di prima resta finché non sono pronti)
  const loadingLabel = sl.loading.length ? sl.loading[sl.loading.length - 1] : "";
  // Struttura di apertura: «Apri sempre su questa» (preferenza per dispositivo, vedi lib/home-struct.ts). Assente = la principale (prima dell'elenco).
  const readHomePref = () => { if (typeof window === "undefined") return ""; try { return localStorage.getItem(HOME_PREF_KEY) || ""; } catch { return ""; } };
  const [homePref, setHomePref] = useState(readHomePref);
  const setHome = (id: string) => { try { localStorage.setItem(HOME_PREF_KEY, id); window.dispatchEvent(new Event("spigolestay:homepref")); } catch { /* niente */ } setHomePref(id); };

  // Selezione multipla: spunta le strutture che vuoi vedere (insieme). Una sola = come prima; tutte = "Tutte le strutture".
  const chosen = new Set(selectedStructureIds.filter((id) => structures.some((s) => s.id === id)));
  const allOn = structures.length > 0 && structures.every((s) => chosen.has(s.id));
  const current = chosen.size === 1 ? structures.find((s) => chosen.has(s.id)) : undefined;
  const apply = (ids: string[]) => { if (ids.length) setActiveStructures(ids); };
  const toggle = (id: string) => { const next = new Set(chosen); if (next.has(id)) next.delete(id); else next.add(id); apply([...next]); };
  const only = (id: string) => { setActiveStructure(id); setOpen(false); };
  const label = current ? null : allOn ? t("Tutte le strutture") : `${chosen.size} ${t("strutture")}`;

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={() => { setHomePref(readHomePref()); setOpen((o) => !o); }}
        className="flex items-center gap-2 rounded-lg border border-line bg-paper py-1.5 pl-2.5 pr-2 text-sm transition hover:border-focus max-sm:min-h-10"
      >
        <span style={{ color: "var(--focus)" }}><Icon name="building" size={16} /></span>
        {loadingLabel ? (
          <span className="max-w-[150px] truncate font-medium text-dim sm:max-w-[220px]" role="status">{t("Carico")} {loadingLabel}…</span>
        ) : current ? (
          <span className="flex items-baseline gap-1.5">
            <span className="max-w-[110px] truncate font-medium text-txt sm:max-w-[180px] md:max-w-[110px] lg:max-w-[180px]">{current.name}</span>
            {current.city && <span className="hidden text-[11px] text-faint sm:inline md:hidden xl:inline">{current.city}</span>}
          </span>
        ) : (
          <span className="font-medium text-txt">{label}</span>
        )}
        <span className={`text-dim transition-transform ${open ? "rotate-90" : ""}`}><Icon name="chevron" size={14} /></span>
      </button>

      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)} align="end" width={288} label={t("Strutture")}>
          {!allowedStructureIds && <Item checked={allOn} onClick={() => apply(structures.map((x) => x.id))} name={t("Tutte le strutture")} />}
          {!allowedStructureIds && <div className="my-1 border-t border-line" />}
          {structures.map((x) => (
            <Item key={x.id} checked={chosen.has(x.id)} onClick={() => toggle(x.id)} name={x.name} sub={x.city} onOnly={structures.length > 1 ? () => only(x.id) : undefined} onlyLabel={t("solo")} />
          ))}
          {structures.length > 1 && <div className="mt-1 border-t border-line px-2.5 pb-1 pt-1.5 text-[11px] text-faint">{t("Spunta le strutture che vuoi vedere insieme.")}</div>}
          {current && structures.length > 1 && !allowedStructureIds && (
            homePref === current.id
              ? <div className="px-2.5 pb-1.5 text-[11px] font-semibold text-focus">✓ {t("L'app si apre sempre su questa struttura")}</div>
              : <button onClick={() => setHome(current.id)} className="mx-1 mb-1 rounded-md px-1.5 py-1.5 text-left text-[11px] font-semibold text-focus hover:bg-wash max-sm:min-h-10">{t("Apri sempre su questa")}</button>
          )}
      </Popover>
    </div>
  );
}

function Item({ checked, onClick, name, sub, onOnly, onlyLabel }: { checked: boolean; onClick: () => void; name: string; sub?: string; onOnly?: () => void; onlyLabel?: string }) {
  return (
    <div className="group flex items-center rounded-lg transition hover:bg-wash" style={checked ? { backgroundColor: "color-mix(in srgb, var(--focus) 8%, transparent)" } : undefined}>
      <button onClick={onClick} role="checkbox" aria-checked={checked} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm max-sm:min-h-11">
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-bold leading-none text-white" style={{ borderColor: checked ? "var(--focus)" : "var(--line)", background: checked ? "var(--focus)" : "transparent" }}>{checked ? "✓" : ""}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-txt">{name}</span>
        {sub && <span className="text-[11px] text-faint">{sub}</span>}
      </button>
      {onOnly && <button onClick={onOnly} title={onlyLabel} className="mr-1.5 rounded-md px-1.5 py-1 text-[11px] font-semibold text-focus opacity-0 transition hover:bg-surface group-hover:opacity-100 focus-visible:opacity-100 max-sm:py-2.5 [@media(hover:none)]:opacity-100">{onlyLabel}</button>}
    </div>
  );
}
