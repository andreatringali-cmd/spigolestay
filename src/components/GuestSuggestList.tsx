"use client";

import type { Guest } from "@/lib/types";
import type { GuestSuggestion } from "@/lib/guest-suggest";
import { useLang } from "@/lib/i18n";

/** Tendina «Già ospiti da noi»: sta sotto il campo Cognome (contenitore `relative`). onMouseDown e non onClick: il campo perderebbe il fuoco prima del clic e la tendina si chiuderebbe. */
export default function GuestSuggestList({ items, onPick }: { items: GuestSuggestion[]; onPick: (g: Guest) => void }) {
  const { t } = useLang();
  if (!items.length) return null;
  return (
    <div role="listbox" aria-label={t("Ospiti già nel registro")} className="absolute left-0 top-full z-20 mt-1 w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
      <div className="border-b border-line px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-faint">{t("Già ospiti da noi")}</div>
      {items.map(({ g, n }) => (
        <button key={g.id} type="button" role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); onPick(g); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-wash">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-txt">{[g.lastName, g.firstName].filter(Boolean).join(" ") || g.fullName}</span>
            <span className="block truncate text-[11px] text-faint">{[g.email, g.phone].filter(Boolean).join(" · ") || t("nessun contatto")}</span>
          </span>
          <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-dim">{n} {n === 1 ? t("soggiorno") : t("soggiorni")}</span>
        </button>
      ))}
    </div>
  );
}
