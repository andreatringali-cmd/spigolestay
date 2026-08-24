"use client";

import CalendarGrid from "@/components/CalendarGrid";
import { PageHeader } from "@/components/ui";
import WeatherWidget from "@/components/WeatherWidget";
import { useLang } from "@/lib/i18n";

export default function CalendarioPage() {
  const { t } = useLang();
  return (
    <div>
      <PageHeader title={t("Calendario")} subtitle={t("Disponibilità, prenotazioni e tariffe di tutte le strutture, giorno per giorno")} actions={<WeatherWidget compact />} />
      <CalendarGrid />
    </div>
  );
}
