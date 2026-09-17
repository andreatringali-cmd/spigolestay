"use client";

// Esegue il Revenue Autopilot UNA VOLTA AL GIORNO in background (se attivo),
// così i prezzi si aggiornano anche senza aprire la pagina Autopilot.
// Montato nell'AppShell. Rispetta i guardrail e applica gli override del calendario.
import { useEffect, useRef } from "react";
import { useData } from "@/lib/store";
import { toISO } from "@/lib/dates";
import { italianHolidays, italianBridges } from "@/lib/holidays";
import { computeSuggestions, loadAutopilot, saveAutopilot, toOverrideMap, highDemandMap } from "@/lib/autopilot";

export default function AutopilotRunner() {
  const { bookings, roomTypes, units, events, rateOverrides, setDayRates, structures } = useData();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (!roomTypes.length) return; // attendi l'idratazione dello store
    const cfg = loadAutopilot();
    const today = toISO(new Date());
    if (!cfg.on || cfg.lastRun === today) { done.current = true; return; }

    const years = [new Date().getFullYear(), new Date().getFullYear() + 1];
    const city = structures[0]?.city ?? "";
    const holidays = italianHolidays(years, city);
    const bridges = italianBridges(holidays);
    const hd = highDemandMap(events ?? [], holidays, bridges, today, cfg.horizonDays);

    const sugg = computeSuggestions(bookings, roomTypes, units, rateOverrides, cfg, today, "all", hd);
    if (sugg.length) setDayRates(toOverrideMap(sugg));
    saveAutopilot({ ...cfg, lastRun: today });
    done.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomTypes.length]);

  return null;
}
