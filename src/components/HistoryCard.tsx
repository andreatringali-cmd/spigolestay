"use client";

// Impostazioni → «Storico prenotazioni». La modalità veloce è sempre accesa (nessun interruttore): qui resta solo la scelta di caricare TUTTO lo storico su questo dispositivo
// (di norma si vedono gli ultimi 13 mesi e le prenotazioni future) e di tornare poi alla vista leggera.
import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { deltaIsActive } from "@/lib/authsync";

const PAST_KEY = "xn-delta-past";
const ACTIVE_KEY = "xn-delta-active";

export default function HistoryCard() {
  const [all, setAll] = useState(() => { try { return typeof window !== "undefined" && sessionStorage.getItem(PAST_KEY) === "all"; } catch { return false; } });
  if (typeof window === "undefined" || !deltaIsActive()) return null; // solo dove la lettura è a finestra
  const loadAll = () => { try { sessionStorage.setItem(PAST_KEY, "all"); } catch { /* niente */ } setAll(true); window.location.reload(); };
  // «Torna alla vista leggera»: si toglie il segno di «finestra già preparata», così al riavvio la copia locale riparte dalla finestra.
  const backToFast = () => { try { sessionStorage.removeItem(PAST_KEY); localStorage.removeItem(ACTIVE_KEY); } catch { /* niente */ } window.location.reload(); };
  return (
    <Card className="mt-4">
      <SectionTitle>Storico prenotazioni</SectionTitle>
      <p className="mb-3 text-xs text-dim">
        {all
          ? "Stai vedendo tutto lo storico su questo dispositivo, fino alla chiusura della scheda."
          : "Su questo dispositivo vedi gli ultimi 13 mesi e le prenotazioni future: l'app si apre più in fretta. Il server conserva sempre tutto."}
      </p>
      {all
        ? <button onClick={backToFast} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-txt hover:border-focus hover:text-focus">Torna alla vista leggera</button>
        : <button onClick={loadAll} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-txt hover:border-focus hover:text-focus">Carica tutto lo storico</button>}
    </Card>
  );
}
