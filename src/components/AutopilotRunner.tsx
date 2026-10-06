"use client";

// Esegue il Revenue Autopilot UNA VOLTA AL GIORNO in background (se attivo),
// così i prezzi si aggiornano anche senza aprire la pagina Autopilot.
// Montato nell'AppShell. Rispetta i guardrail e applica gli override del calendario.
import { useEffect, useRef } from "react";
import { useData } from "@/lib/store";
import { toISO } from "@/lib/dates";
import { italianHolidays, italianBridges } from "@/lib/holidays";
import { computeSuggestions, loadAutopilot, saveAutopilot, toOverrideMap, highDemandMap } from "@/lib/autopilot";
import { summarizeAppliedSuggestions } from "@/lib/autopilot-explain";
import { inScope } from "@/lib/scope";
import { buildChanges, recordBatches } from "@/lib/revenue-history";

export default function AutopilotRunner() {
  const { raw, rateOverrides, setDayRates, addActivity } = useData(); // dati completi: l'autopilot non dipende dalle strutture selezionate in alto
  const { bookings, roomTypes, units, events, structures } = raw;
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (!roomTypes.length) return; // attendi l'idratazione dello store
    const today = toISO(new Date());
    const years = [new Date().getFullYear(), new Date().getFullYear() + 1];

    // Ogni struttura ha il proprio autopilot (config + ultima esecuzione) e viene ottimizzata da sola,
    // con la SUA città (festivi) e i SUOI eventi: mai le tariffe di una struttura calcolate sui dati di un'altra.
    const list = structures.length ? structures : [undefined];
    for (const st of list) {
      const sid = st?.id;
      const cfg = loadAutopilot(sid);
      if (!cfg.on || cfg.lastRun === today) continue;
      const holidays = italianHolidays(years, st?.city ?? "");
      const bridges = italianBridges(holidays);
      const evs = (events ?? []).filter((e) => !sid || inScope(e.structureId, sid));
      const hd = highDemandMap(evs, holidays, bridges, today, cfg.horizonDays);
      const sugg = computeSuggestions(bookings, roomTypes, units, rateOverrides, cfg, today, sid ?? "all", hd);
      if (sugg.length) {
        // Storico con "Annulla": registra il valore precedente di ogni tariffa prima di scriverla.
        recordBatches("autopilot-auto", "Autopilot giornaliero", buildChanges(sugg.map((x) => ({ key: x.key, typeName: x.typeName, iso: x.iso, structureId: x.structureId, effBefore: x.current, after: x.suggested })), rateOverrides));
        setDayRates(toOverrideMap(sugg));
        addActivity("rate", `Autopilot${st ? ` (${st.name})` : ""}: ${sugg.length} tariffe aggiornate automaticamente. ${summarizeAppliedSuggestions(sugg)}`, sid);
      }
      saveAutopilot({ lastRun: today }, sid);
    }
    done.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomTypes.length]);

  return null;
}
