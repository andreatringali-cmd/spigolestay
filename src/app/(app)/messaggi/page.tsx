"use client";

import { Suspense, useState } from "react";
import { PageHeader } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import OtaMessagesPanel from "@/components/messaging/OtaMessagesPanel";
import ModelliPanel from "@/components/messaging/ModelliPanel";

type Tab = "ota" | "modelli";

// Messaggi: qui ci sono solo le conversazioni con gli ospiti delle OTA (Booking.com, Airbnb, Expedia) e i modelli di messaggio.
// WhatsApp ed email si seguono fuori da Xenora (i modelli servono ai pulsanti nelle schede delle prenotazioni).
export default function MessaggiPage() {
  return <Suspense fallback={null}><MessaggiInner /></Suspense>;
}

function MessaggiInner() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>(() => {
    try { return new URLSearchParams(window.location.search).get("tab") === "modelli" ? "modelli" : "ota"; } catch { return "ota"; }
  });

  const TABS: { id: Tab; label: string; icon: string; hint: string }[] = [
    { id: "ota", label: t("Messaggi OTA"), icon: "💬", hint: t("Le conversazioni con gli ospiti di Booking.com, Airbnb ed Expedia: ricevi e rispondi direttamente sui portali") },
    { id: "modelli", label: t("Modelli"), icon: "📝", hint: t("Crea i tuoi messaggi e scegli quali mostrare come pulsante nella scheda della prenotazione") },
  ];
  const active = TABS.find((x) => x.id === tab)!;

  return (
    <div>
      <PageHeader title={t("Messaggi")} subtitle={active.hint} />

      <div role="tablist" aria-label="Sezioni dei messaggi" className="mb-4 flex w-full gap-3 max-sm:mb-3 max-sm:gap-2">
        {TABS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-center text-xs font-semibold shadow-sm transition sm:gap-2 sm:px-4 sm:py-3 sm:text-sm ${tab === x.id ? "border-focus bg-[color:color-mix(in_srgb,var(--focus)_12%,transparent)] text-focus" : "border-line bg-surface text-dim hover:bg-wash hover:text-txt"}`}
          >
            <span className="text-base">{x.icon}</span>{x.label}
          </button>
        ))}
      </div>

      {tab === "ota" && <OtaMessagesPanel />}
      {tab === "modelli" && <ModelliPanel />}
    </div>
  );
}
