"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { useData } from "@/lib/store";
import { isThreadUnread } from "@/lib/navbadges";
import ConversazioniPanel from "@/components/messaging/ConversazioniPanel";
import ConciergePanel from "@/components/messaging/ConciergePanel";
import ModelliPanel from "@/components/messaging/ModelliPanel";

type Tab = "conversazioni" | "modelli" | "concierge";

// Area Messaggi unificata: chat + invii programmati, modelli & automazioni, e concierge AI — a tab.
export default function MessaggiPage() {
  const { t } = useLang();
  const { bookings, activeStructureId } = useData();
  const [tab, setTab] = useState<Tab>(() => {
    try { const p = new URLSearchParams(window.location.search).get("tab"); return (p === "modelli" || p === "concierge") ? p : "conversazioni"; } catch { return "conversazioni"; }
  });

  // Conversazioni "da leggere" della struttura attiva: stesso conteggio del filtro "Da leggere" nell'elenco (messaggio dell'ospite non ancora letto, oppure segnata a mano).
  // Prima contava tutte le strutture e anche le già lette, per questo il numero non tornava con l'elenco.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const compute = () => {
      try {
        const th = JSON.parse(localStorage.getItem("spigolestay:threads:v1") || "{}") as Record<string, { dir: string; ts?: number }[]>;
        const arch = JSON.parse(localStorage.getItem("spigolestay:archived") || "[]") as string[];
        const manual = JSON.parse(localStorage.getItem("spigolestay:manualunread") || "[]") as string[];
        // Ospiti con prenotazioni nella struttura attiva (con "Tutte" valgono tutti).
        const inStruct = new Set<string>(); const anyBooking = new Set<string>();
        for (const b of bookings) { if (b.channel === "blocked") continue; anyBooking.add(b.guestId); if (activeStructureId === "all" || b.structureId === activeStructureId) inStruct.add(b.guestId); }
        let n = 0;
        for (const gid of Object.keys(th)) {
          if (arch.includes(gid)) continue;
          if (activeStructureId !== "all" && !inStruct.has(gid) && anyBooking.has(gid)) continue;
          if (manual.includes(gid) || isThreadUnread(gid, th[gid])) n++;
        }
        setUnread(n);
      } catch { setUnread(0); }
    };
    compute();
    const ev = ["focus", "spigolestay:threads", "spigolestay:navseen", "spigolestay:datasync", "storage"];
    ev.forEach((e) => window.addEventListener(e, compute));
    return () => ev.forEach((e) => window.removeEventListener(e, compute));
  }, [bookings, activeStructureId]);

  const TABS: { id: Tab; label: string; icon: string; hint: string }[] = [
    { id: "conversazioni", label: t("Conversazioni"), icon: "💬", hint: t("Un unico posto per chattare con gli ospiti · messaggi e invii programmati") },
    { id: "modelli", label: t("Modelli"), icon: "📝", hint: t("Modelli & automazioni · crea i messaggi riutilizzabili e decidi se e quando inviarli in automatico") },
    { id: "concierge", label: t("Concierge AI"), icon: "🤖", hint: t("Risponde da solo agli ospiti h24, dalla tua base di conoscenza") },
  ];
  const active = TABS.find((x) => x.id === tab)!;

  return (
    <div>
      <PageHeader title={t("Messaggi")} subtitle={active.hint} />

      <div className="mb-4 flex w-full gap-3">
        {TABS.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-center text-xs font-semibold shadow-sm transition sm:gap-2 sm:px-4 sm:py-3 sm:text-sm ${tab === x.id ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] text-focus" : "border-line bg-surface text-dim hover:bg-wash hover:text-txt"}`}
          >
            <span className="text-base">{x.icon}</span>{x.label}
            {x.id === "conversazioni" && unread > 0 && <span className="ml-1 inline-flex min-w-[1.1rem] justify-center rounded-full px-1 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: "var(--ok)" }}>{unread}</span>}
          </button>
        ))}
      </div>

      {tab === "conversazioni" && <ConversazioniPanel onManageTemplates={() => setTab("modelli")} />}
      {tab === "modelli" && <ModelliPanel />}
      {tab === "concierge" && <ConciergePanel />}
    </div>
  );
}
