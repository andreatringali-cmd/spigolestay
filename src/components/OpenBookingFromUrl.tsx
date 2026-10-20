"use client";

import { useEffect, useRef } from "react";
import { useData } from "@/lib/store";
import { ensureLoaded } from "@/lib/struct-load";

// Link diretto alla scheda prenotazione (usato dalle email al titolare): `/prenotazioni?b=<id>`.
// All'apertura legge `?b=`, aspetta che i dati della prenotazione siano caricati (la sincronizzazione col server può arrivare dopo il primo
// rendering), apre la scheda e poi ripulisce l'indirizzo. Se la prenotazione non esiste (eliminata) ripulisce comunque dopo qualche secondo.
// Se la prenotazione è di una struttura che non è tra quelle selezionate, passa alla vista "tutte" perché la scheda si possa mostrare.
const GIVE_UP_MS = 20_000;

function cleanUrl() {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has("b")) return;
    u.searchParams.delete("b");
    window.history.replaceState(window.history.state, "", u.pathname + (u.search || "") + u.hash);
  } catch { /* indirizzo non modificabile: pazienza */ }
}

export default function OpenBookingFromUrl() {
  const { raw, openBooking, selectedStructureIds, setActiveStructure, allStructures } = useData();
  const askedAll = useRef(false);
  const wanted = useRef<string | null>(null);
  const opened = useRef(false);

  // Lettura una volta sola dell'id richiesto + scadenza.
  useEffect(() => {
    let id: string | null = null;
    try { id = new URLSearchParams(window.location.search).get("b"); } catch { id = null; }
    if (!id) return;
    wanted.current = id;
    const t = setTimeout(() => { if (!opened.current) { wanted.current = null; cleanUrl(); } }, GIVE_UP_MS);
    return () => clearTimeout(t);
  }, []);

  // Appena la prenotazione compare nei dati, la si apre.
  useEffect(() => {
    const id = wanted.current;
    if (!id || opened.current) return;
    const b = raw.bookings.find((x) => x.id === id);
    if (!b) {
      // Modalità veloce: la prenotazione può essere di una struttura non ancora caricata → si caricano tutte (una volta) e poi si riprova; fuori dalla modalità veloce non fa nulla.
      if (!askedAll.current) { askedAll.current = true; void ensureLoaded(allStructures.map((s) => s.id), "tutte le strutture", true); }
      return;
    }
    opened.current = true;
    wanted.current = null;
    if (!selectedStructureIds.includes(b.structureId)) setActiveStructure("all");
    openBooking(id);
    cleanUrl();
  }, [raw.bookings, selectedStructureIds, openBooking, setActiveStructure, allStructures]);

  return null;
}
