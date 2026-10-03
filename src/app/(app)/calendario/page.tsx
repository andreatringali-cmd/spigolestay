"use client";

import { useEffect, useState } from "react";
import CalendarGrid from "@/components/CalendarGrid";
import { PageHeader } from "@/components/ui";
import WeatherWidget from "@/components/WeatherWidget";
import { useLang } from "@/lib/i18n";
import { useData } from "@/lib/store";
import CalendarioDettaglio from "./_dettaglio";
import CalendarioV3 from "./_v3";

type Vista = "grid" | "detail" | "v3";
const VIEW_KEY = "spigolestay:cal:view";

export default function CalendarioPage() {
  const { t } = useLang();
  const { activeStructureId, getStructure } = useData();
  const st = activeStructureId !== "all" ? getStructure(activeStructureId) : undefined;
  // Vista scelta (ricordata): null finché non è letta dal browser, per non montare la griglia se si preferisce il dettaglio.
  const [view, setView] = useState<Vista | null>(null);
  useEffect(() => {
    let v: Vista = "grid";
    try { const saved = localStorage.getItem(VIEW_KEY); if (saved === "detail" || saved === "v3") v = saved; } catch {}
    setView(v);
  }, []);
  const choose = (v: Vista) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch {} };
  return (
    <div>
      <PageHeader
        title={t("Calendario")}
        subtitle={st ? `${st.name} · ${t("Disponibilità, prenotazioni e tariffe, giorno per giorno")}` : t("Disponibilità, prenotazioni e tariffe di tutte le strutture, giorno per giorno")}
        actions={<>
          <div className="no-print inline-flex rounded-lg border border-line bg-wash p-0.5" role="group" aria-label="Vista del calendario">
            {([["grid", "Griglia"], ["detail", "Dettagliato"], ["v3", "v3"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => choose(k)} aria-pressed={view === k} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${view === k ? "bg-surface text-focus shadow-sm" : "text-dim hover:text-txt"}`}>{l}</button>
            ))}
          </div>
          <WeatherWidget compact />
        </>}
      />
      {view === "grid" && <CalendarGrid />}
      {view === "detail" && <CalendarioDettaglio />}
      {view === "v3" && <CalendarioV3 />}
    </div>
  );
}
