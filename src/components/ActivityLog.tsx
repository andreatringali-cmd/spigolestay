"use client";

import { Button } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/store";
import type { ActivityType } from "@/lib/store";
import { useLang } from "@/lib/i18n";
import Popover from "./Popover";

const TYPE_COLOR: Record<ActivityType, string> = {
  booking: "var(--ok)", cancel: "var(--err)", block: "var(--faint)", move: "var(--focus)",
  event: "#7C3AED", rate: "var(--warn)", rateplan: "#B8860B", quote: "var(--focus)", payment: "var(--ok)",
  login: "#957A66", auth: "#957A66", message: "#25A0A0", config: "#5E7C8B",
};
const TYPE_LABEL: Record<ActivityType, string> = {
  booking: "Prenotazione", cancel: "Cancellazione", block: "Fuori servizio", move: "Spostamento",
  event: "Evento", rate: "Tariffe", rateplan: "Piano tariffario", quote: "Preventivo", payment: "Pagamento",
  login: "Accesso", auth: "Sicurezza account", message: "Messaggio", config: "Configurazione",
};

function relTime(ts: number, t: (s: string) => string): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t("adesso");
  const m = Math.floor(s / 60); if (m < 60) return `${m} ${t("min fa")}`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} ${t("h fa")}`;
  const d = Math.floor(h / 24); return `${d} ${t("g fa")}`;
}

const SEEN_KEY = "spigolestay:activityseen";

export default function ActivityLog() {
  const { activities: allActivities, activeStructureId } = useData();
  // Solo le voci della struttura attiva (quelle senza struttura — accessi, sicurezza — restano sempre visibili).
  const activities = activeStructureId === "all" ? allActivities : allActivities.filter((a) => !a.structureId || a.structureId === activeStructureId);
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null); // ancora della tendina (Popover): chiusura fuori/Esc la gestisce lei
  // "Non letti" = attività più recenti dell'ultima apertura del pannello (persistito nel browser).
  const [seenTs, setSeenTs] = useState<number>(0);
  useEffect(() => { try { setSeenTs(Number(localStorage.getItem(SEEN_KEY)) || 0); } catch {} }, []);
  const unread = activities.filter((a) => a.ts > seenTs).length;
  const markSeen = () => {
    const now = Date.now();
    setSeenTs(now);
    try { localStorage.setItem(SEEN_KEY, String(now)); } catch {}
  };
  const toggle = () => setOpen((o) => { if (!o) markSeen(); return !o; });

  return (
    <div className="relative">
      <Button variant="secondary" size="xs" ref={btnRef} onClick={toggle} title={t("Registro attività")} aria-label={t("Registro attività")} className="relative w-8 !px-0 max-sm:w-10 max-sm:!px-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-focus px-1 text-[9px] font-bold text-on-focus">{unread > 99 ? "99+" : unread}</span>
        )}
      </Button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)} align="end" width={320} maxHeight={560} label={t("Registro attività")}>
        <div className="p-1">
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-dim">{t("Registro attività")}</div>
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
      </Popover>
    </div>
  );
}
