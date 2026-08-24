"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store";
import type { ActivityType } from "@/lib/store";
import { useLang } from "@/lib/i18n";

const TYPE_COLOR: Record<ActivityType, string> = {
  booking: "var(--ok)", cancel: "var(--err)", block: "var(--faint)", move: "var(--focus)",
  event: "#7C3AED", rate: "var(--warn)", quote: "var(--focus)", payment: "var(--ok)",
};
const TYPE_LABEL: Record<ActivityType, string> = {
  booking: "Prenotazione", cancel: "Cancellazione", block: "Fuori servizio", move: "Spostamento",
  event: "Evento", rate: "Tariffe", quote: "Preventivo", payment: "Pagamento",
};

function relTime(ts: number, t: (s: string) => string): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t("adesso");
  const m = Math.floor(s / 60); if (m < 60) return `${m} ${t("min fa")}`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} ${t("h fa")}`;
  const d = Math.floor(h / 24); return `${d} ${t("g fa")}`;
}

export default function ActivityLog() {
  const { activities } = useData();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title={t("Registro attività")} aria-label={t("Registro attività")} className="relative grid h-9 w-9 place-items-center rounded-lg border border-line text-dim transition hover:bg-wash hover:text-txt">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
        </svg>
        {activities.length > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-focus px-1 text-[9px] font-bold text-white">{activities.length > 99 ? "99+" : activities.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-xl">
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-faint">{t("Registro attività")}</div>
          {activities.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-faint">{t("Nessuna attività registrata.")}<br />{t("Crea o modifica qualcosa per vederla qui.")}</div>
          ) : (
            activities.map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-wash">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TYPE_COLOR[a.type] }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-txt">{a.text}</div>
                  <div className="text-[11px] text-faint">{t(TYPE_LABEL[a.type])} · {relTime(a.ts, t)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
