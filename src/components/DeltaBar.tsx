"use client";

// Barra sottile mostrata SOLO con la «Modalità veloce» attiva: dice che si vedono gli ultimi 13 mesi e permette di caricare tutto lo storico (o tornare alla vista veloce).
// Avvisa anche se una cancellazione di massa è stata bloccata per sicurezza.
import { useEffect, useState } from "react";
import { deltaIsActive } from "@/lib/authsync";

const PAST_KEY = "xn-delta-past";
const ACTIVE_KEY = "xn-delta-active";

export default function DeltaBar() {
  const [blocked, setBlocked] = useState("");
  const [all, setAll] = useState(() => { try { return sessionStorage.getItem(PAST_KEY) === "all"; } catch { return false; } });
  useEffect(() => {
    const h = (e: Event) => setBlocked(String((e as CustomEvent).detail || "Una cancellazione di massa è stata bloccata per sicurezza."));
    window.addEventListener("xenora:delta-blocked", h);
    return () => window.removeEventListener("xenora:delta-blocked", h);
  }, []);
  if (!deltaIsActive()) return null;
  const loadAll = () => { try { sessionStorage.setItem(PAST_KEY, "all"); } catch { /* niente */ } setAll(true); window.location.reload(); };
  // «Torna alla vista veloce»: si toglie il segno di «finestra già preparata», così al riavvio la copia locale riparte dalla finestra.
  const backToFast = () => { try { sessionStorage.removeItem(PAST_KEY); localStorage.removeItem(ACTIVE_KEY); } catch { /* niente */ } window.location.reload(); };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-wash px-3 py-1.5 text-[11px] text-dim">
      <span className="font-semibold text-txt">Modalità veloce</span>
      <span>{all ? "stai vedendo tutto lo storico" : "stai vedendo gli ultimi 13 mesi e le prenotazioni future"}</span>
      {all
        ? <button onClick={backToFast} className="font-semibold text-focus hover:underline">Torna alla vista veloce</button>
        : <button onClick={loadAll} className="font-semibold text-focus hover:underline">Carica storico</button>}
      {blocked && <span className="font-semibold" style={{ color: "var(--err)" }}>{blocked}</span>}
    </div>
  );
}
