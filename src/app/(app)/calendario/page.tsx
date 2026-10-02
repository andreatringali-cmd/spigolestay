"use client";

import CalendarGrid from "@/components/CalendarGrid";
import { PageHeader } from "@/components/ui";
import WeatherWidget from "@/components/WeatherWidget";
import { useLang } from "@/lib/i18n";
import { useData } from "@/lib/store";

export default function CalendarioPage() {
  const { t } = useLang();
  const { activeStructureId, getStructure } = useData();
  const st = activeStructureId !== "all" ? getStructure(activeStructureId) : undefined;
  return (
    <div>
      <PageHeader title={t("Calendario")} subtitle={st ? `${st.name} · ${t("Disponibilità, prenotazioni e tariffe, giorno per giorno")}` : t("Disponibilità, prenotazioni e tariffe di tutte le strutture, giorno per giorno")} actions={<WeatherWidget compact />} />
      <CalendarGrid />
    </div>
  );
}
