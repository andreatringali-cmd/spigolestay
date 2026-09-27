"use client";

import { useEffect, useRef } from "react";
import { useData } from "@/lib/store";
import { buildAriPayload, type ChxStructMap } from "@/lib/channex-ari";

// Sincronizzazione AUTOMATICA disponibilità+prezzi verso Channex.
// Sostituisce il vecchio pulsante manuale "Prezzi & disponibilità": ogni volta che cambiano
// prenotazioni, camere (anche fuori servizio) o prezzi, dopo un breve ritardo (debounce) invia
// l'aggiornamento a Channex per ogni struttura collegata (mappatura in localStorage). Silenzioso.
// Montato nell'AppShell: gira sempre, indipendentemente dalla pagina aperta.
const CHX_MAP_KEY = "spigolestay:channexmap";
const DEBOUNCE_MS = 4000;

export default function ChannexAutoSync() {
  const { roomTypes, units, bookings, rateOverrides } = useData();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  useEffect(() => {
    // Salta il primo render (caricamento iniziale): non è una modifica dell'utente.
    if (first.current) { first.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      let chxMap: Record<string, ChxStructMap> = {};
      try { chxMap = JSON.parse(localStorage.getItem(CHX_MAP_KEY) || "{}"); } catch { return; }
      const linked = Object.entries(chxMap).filter(([, m]) => m?.propertyId && m?.rooms);
      if (linked.length === 0) return; // nessuna struttura collegata a Channex
      let weekendPct = 25;
      try { weekendPct = JSON.parse(localStorage.getItem("spigolestay:pricerules") || "{}").weekendPct ?? 25; } catch {}
      for (const [sid, map] of linked) {
        const { availability, rates } = buildAriPayload(map, sid, roomTypes, units, bookings, rateOverrides, { weekendPct });
        if (availability.length === 0 && rates.length === 0) continue;
        try {
          await fetch("/api/channex/ari", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ availability, rates }) });
        } catch { /* rete assente: si riproverà al prossimo cambiamento */ }
      }
    }, DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [bookings, units, rateOverrides, roomTypes]);

  return null;
}
