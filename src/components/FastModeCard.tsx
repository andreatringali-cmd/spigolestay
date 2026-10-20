"use client";

// Impostazioni → «Modalità veloce». ACCESA DI DEFAULT su ogni dispositivo degli account abilitati (chiave locale assente o "1"); "0" = spenta dall'utente su questo
// dispositivo (si ricorda). Il browser scarica solo la struttura di apertura (ultimi 13 mesi di prenotazioni e ospiti collegati) invece di tutto l'archivio e rimanda al
// server solo le modifiche. Il server conserva sempre tutto: si può tornare alla modalità normale in qualsiasi momento.
import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { DELTA_FLAG_KEY, DELTA_FAILED_KEY, deltaAllowedFor, useAuth } from "@/lib/authsync";

export default function FastModeCard() {
  const { user } = useAuth();
  const uid = user?.id ?? "";
  // Mostra la SCELTA dell'utente (acceso salvo "0"), non l'esito della sessione: se in questa sessione la lettura veloce è fallita si resta in modalità normale solo fino alla chiusura della scheda.
  const [on, setOn] = useState(() => { if (typeof window === "undefined" || !uid) return false; try { return localStorage.getItem(DELTA_FLAG_KEY) !== "0"; } catch { return true; } });
  const [failed] = useState(() => { try { return typeof window !== "undefined" && sessionStorage.getItem(DELTA_FAILED_KEY) === uid; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const change = (next: boolean) => {
    setBusy(true);
    try { localStorage.setItem(DELTA_FLAG_KEY, next ? "1" : "0"); } catch { setBusy(false); return; } // "0" = spenta di proposito (si ricorda); "1" = accesa
    setOn(next);
    // Si ricarica: al riavvio l'app salva tutto con il sistema normale e poi passa (o torna) alla modalità scelta.
    window.setTimeout(() => window.location.reload(), 300);
  };
  if (!deltaAllowedFor(uid)) return null; // solo gli account abilitati alla prova
  return (
    <Card className="mt-4">
      <SectionTitle>Modalità veloce</SectionTitle>
      <p className="mb-3 text-xs text-dim">
        Su questo dispositivo l&apos;app scarica solo la struttura su cui si apre (prenotazioni degli ultimi 13 mesi e future, con gli ospiti collegati), invece di tutto l&apos;archivio: si apre più in fretta.
        Le altre strutture si caricano quando le scegli. Le modifiche viaggiano singolarmente e il server conserva sempre tutto lo storico; per le prenotazioni più vecchie c&apos;è «Carica storico» nella barra in alto.
        È attiva per questo dispositivo ed è consigliata; puoi spegnerla quando vuoi.
      </p>
      <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-paper px-3 py-2">
        <span className="text-sm font-medium text-txt">{on ? "Attiva su questo dispositivo (consigliata)" : "Spenta su questo dispositivo"}</span>
        <input id="fast-mode" type="checkbox" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} className="h-4 w-8 shrink-0 accent-[color:var(--focus)]" />
      </label>
      {failed && on && <p className="mt-2 text-xs text-dim">In questa sessione la lettura veloce non è riuscita (collegamento instabile): l&apos;app sta usando la modalità normale. Alla prossima apertura riprova da sola.</p>}
      {busy && <p className="mt-2 text-xs text-dim">Applico… la pagina si ricarica da sola.</p>}
    </Card>
  );
}
