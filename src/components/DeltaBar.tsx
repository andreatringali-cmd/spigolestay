"use client";

// Barra sottile (solo con la modalità veloce, che è sempre accesa): compare SOLO quando c'è qualcosa da dire — «Carico <struttura>…», un errore di caricamento o una cancellazione di
// massa bloccata per sicurezza. Il caricamento di tutto lo storico sta in Impostazioni → Storico prenotazioni (HistoryCard).
import { useEffect, useState } from "react";
import { deltaIsActive } from "@/lib/authsync";
import { useStructLoad, clearLoadError } from "@/lib/struct-load";

export default function DeltaBar() {
  const sl = useStructLoad(); // caricamento di altre strutture: «Carico …» e, se non riesce, un messaggio chiaro (la vista resta com'è)
  const [blocked, setBlocked] = useState("");
  useEffect(() => {
    const h = (e: Event) => setBlocked(String((e as CustomEvent).detail || "Una cancellazione di massa è stata bloccata per sicurezza."));
    window.addEventListener("xenora:delta-blocked", h);
    return () => window.removeEventListener("xenora:delta-blocked", h);
  }, []);
  if (!deltaIsActive()) return null;
  if (sl.loading.length === 0 && !sl.error && !blocked) return null; // niente barra fissa: compare solo quando serve
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-wash px-3 py-1.5 text-[11px] text-dim">
      {sl.loading.length > 0 && <span className="font-semibold text-txt" role="status">Carico {sl.loading[sl.loading.length - 1]}…</span>}
      {sl.error && <span className="font-semibold" style={{ color: "var(--err)" }} role="alert">{sl.error} <button onClick={clearLoadError} className="font-semibold text-focus hover:underline">Ok</button></span>}
      {blocked && <span className="font-semibold" style={{ color: "var(--err)" }}>{blocked}</span>}
    </div>
  );
}
