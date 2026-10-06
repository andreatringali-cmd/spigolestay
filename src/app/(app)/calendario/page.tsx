"use client";

import { useState } from "react";
import CalendarGrid from "@/components/CalendarGrid";
import { PageHeader } from "@/components/ui";
import WeatherWidget from "@/components/WeatherWidget";
import { useLang } from "@/lib/i18n";
import { useData } from "@/lib/store";
import CalendarioDettaglio from "./_dettaglio";

type Vista = "grid" | "detail";
const VIEW_KEY = "spigolestay:cal:view";

export default function CalendarioPage() {
  const { t } = useLang();
  const { activeStructureId, getStructure } = useData();
  const st = activeStructureId !== "all" ? getStructure(activeStructureId) : undefined;
  // Vista scelta (ricordata): null finché non è letta dal browser, per non montare la griglia se si preferisce il dettaglio.
  const [view, setView] = useState<Vista>(() => { try { return localStorage.getItem(VIEW_KEY) === "detail" ? "detail" : "grid"; } catch { return "grid"; } });
  const choose = (v: Vista) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch {} };
  // Selettore della vista: stesso aspetto di "Compatta / Dettagliata" in Prenotazioni. Nella griglia sta nella riga dei filtri,
  // prima del pulsante dei grafici; nella vista dettagliata (che non ha quella riga) resta in alto accanto al meteo.
  const viewSwitch = (
    <div className="no-print flex rounded-lg border border-line bg-surface p-0.5 text-xs font-semibold" role="group" aria-label={t("Vista")}>
      {([["grid", t("Griglia")], ["detail", t("Dettagliata")]] as const).map(([k, l]) => (
        <button key={k} onClick={() => choose(k)} aria-pressed={view === k} className={`rounded-md px-2.5 py-1.5 transition ${view === k ? "bg-focus text-white" : "text-dim hover:text-txt"}`}>{l}</button>
      ))}
    </div>
  );
  return (
    <div>
      <PageHeader
        title={t("Calendario")}
        subtitle={st ? `${st.name} · ${t("Disponibilità, prenotazioni e tariffe, giorno per giorno")}` : t("Disponibilità, prenotazioni e tariffe di tutte le strutture, giorno per giorno")}
        actions={<>
          <WeatherWidget compact />
        </>}
      />
      {view === "grid" && <CalendarGrid viewSwitch={viewSwitch} />}
      {view === "detail" && <CalendarioDettaglio viewSwitch={viewSwitch} />}
    </div>
  );
}
