"use client";

import { useEffect, useRef } from "react";
import { useData } from "@/lib/store";
import { buildAriPayload, type ChxStructMap } from "@/lib/channex-ari";
import { apiPost } from "@/lib/invoicing/client";

// Sincronizzazione AUTOMATICA disponibilità+prezzi verso Channex.
// Sostituisce il vecchio pulsante manuale "Prezzi & disponibilità": ogni volta che cambiano
// prenotazioni, camere (anche fuori servizio) o prezzi, dopo un breve ritardo (debounce) invia
// l'aggiornamento a Channex per ogni struttura collegata (mappatura in localStorage). Silenzioso.
// Montato nell'AppShell: gira sempre, indipendentemente dalla pagina aperta.
const CHX_MAP_KEY = "spigolestay:channexmap";
const CLOSES_KEY = "spigolestay:calcloses";
const DEBOUNCE_MS = 4000;
// Evento custom emesso dal calendario quando cambiano le chiusure vendita (persistite in
// localStorage, fuori dallo stato condiviso): serve a far scattare comunque la sincronizzazione.
export const CHANNEX_DIRTY_EVENT = "spigolestay:channex-dirty";

export default function ChannexAutoSync() {
  const { roomTypes, units, bookings, rateOverrides } = useData();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  // Ultimi dati "vivi" a disposizione del push (aggiornati a ogni render): così anche il push
  // avviato da un evento esterno (chiusure vendita) usa lo stato corrente.
  const dataRef = useRef({ roomTypes, units, bookings, rateOverrides });
  dataRef.current = { roomTypes, units, bookings, rateOverrides };

  useEffect(() => {
    const schedulePush = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        let chxMap: Record<string, ChxStructMap> = {};
        try { chxMap = JSON.parse(localStorage.getItem(CHX_MAP_KEY) || "{}"); } catch { return; }
        const linked = Object.entries(chxMap).filter(([, m]) => m?.propertyId && m?.rooms);
        if (linked.length === 0) return; // nessuna struttura collegata a Channex
        let weekendPct = 25;
        try { weekendPct = JSON.parse(localStorage.getItem("spigolestay:pricerules") || "{}").weekendPct ?? 25; } catch {}
        let closes: Record<string, number> = {};
        try { closes = JSON.parse(localStorage.getItem(CLOSES_KEY) || "{}"); } catch {}
        const { roomTypes: rt, units: un, bookings: bk, rateOverrides: ro } = dataRef.current;
        for (const [sid, map] of linked) {
          const { availability, rates } = buildAriPayload(map, sid, rt, un, bk, ro, { weekendPct, closes });
          if (availability.length === 0 && rates.length === 0) continue;
          try {
            await fetch("/api/channex/ari", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ availability, rates }) });
          } catch { /* rete assente: si riproverà al prossimo cambiamento */ }
        }
      }, DEBOUNCE_MS);
    };

    // 1) Cambiamenti nello stato condiviso (prenotazioni, camere, prezzi): salta il primo render.
    if (first.current) { first.current = false; }
    else schedulePush();

    // 2) Chiusure vendita: vivono in localStorage fuori dallo stato condiviso → evento custom.
    window.addEventListener(CHANNEX_DIRTY_EVENT, schedulePush);
    return () => { window.removeEventListener(CHANNEX_DIRTY_EVENT, schedulePush); if (timer.current) clearTimeout(timer.current); };
  }, [bookings, units, rateOverrides, roomTypes]);

  // ENTRATA: mentre Xenora è aperta, controlla da solo le nuove prenotazioni OTA dal feed Channex
  // (in aggiunta al webhook in tempo reale e alla rete di sicurezza cron lato server). Così le
  // prenotazioni compaiono senza premere nulla, anche per quelle già presenti prima del webhook.
  useEffect(() => {
    const hasLinked = () => { try { const m = JSON.parse(localStorage.getItem(CHX_MAP_KEY) || "{}"); return Object.values(m).some((x) => (x as ChxStructMap)?.propertyId); } catch { return false; } };
    const pull = () => { if (!hasLinked()) return; apiPost("channex/import", {}).catch(() => {}); };
    const firstPull = setTimeout(pull, 15000); // primo controllo ~15s dopo l'apertura
    const iv = setInterval(pull, 3 * 60 * 1000); // poi ogni 3 minuti
    return () => { clearTimeout(firstPull); clearInterval(iv); };
  }, []);

  return null;
}
