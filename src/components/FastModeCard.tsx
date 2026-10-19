"use client";

// Impostazioni → «Modalità veloce (prova)». Per questo dispositivo: il browser scarica solo gli ultimi 13 mesi di prenotazioni (e gli ospiti collegati) invece di tutto
// l'archivio e rimanda al server solo le modifiche. Il server conserva sempre tutto: si può tornare alla modalità normale in qualsiasi momento.
import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { DELTA_FLAG_KEY, deltaAllowedFor, deltaWanted, useAuth } from "@/lib/authsync";

export default function FastModeCard() {
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const [on, setOn] = useState(() => (typeof window === "undefined" || !uid ? false : deltaWanted(uid)));
  const [busy, setBusy] = useState(false);
  const change = (next: boolean) => {
    setBusy(true);
    try { if (next) localStorage.setItem(DELTA_FLAG_KEY, "1"); else localStorage.removeItem(DELTA_FLAG_KEY); } catch { setBusy(false); return; }
    setOn(next);
    // Si ricarica: al riavvio l'app salva tutto con il sistema normale e poi passa (o torna) alla modalità scelta.
    window.setTimeout(() => window.location.reload(), 300);
  };
  if (!deltaAllowedFor(uid)) return null; // solo gli account abilitati alla prova
  return (
    <Card className="mt-4">
      <SectionTitle>Modalità veloce (prova)</SectionTitle>
      <p className="mb-3 text-xs text-dim">
        Su questo dispositivo l&apos;app scarica solo le prenotazioni degli ultimi 13 mesi (e quelle future) con gli ospiti collegati, invece di tutto l&apos;archivio: si apre più in fretta.
        Le modifiche viaggiano singolarmente e il server conserva sempre tutto lo storico. Per vedere le prenotazioni più vecchie c&apos;è «Carica storico» nella barra in alto.
        Puoi spegnerla quando vuoi.
      </p>
      <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-paper px-3 py-2">
        <span className="text-sm font-medium text-txt">{on ? "Attiva su questo dispositivo" : "Spenta su questo dispositivo"}</span>
        <input id="fast-mode" type="checkbox" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} className="h-4 w-8 shrink-0 accent-[color:var(--focus)]" />
      </label>
      {busy && <p className="mt-2 text-xs text-dim">Applico… la pagina si ricarica da sola.</p>}
    </Card>
  );
}
