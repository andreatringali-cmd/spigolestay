"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";

// Alleggerimento dei dati (solo amministratore della piattaforma): sposta le foto ancora incorporate nei dati (data URI) su
// Supabase Storage, a piccoli blocchi, in background. Una sola volta per sessione del browser: chiede lo stato in modalità
// "prova" e, se ci sono foto da spostare, richiama /api/admin/media-migrate un blocco alla volta finché ha finito.
// Non blocca l'interfaccia (solo richieste di rete e una riga discreta in basso). Il controllo vero dell'accesso è sul server.
const OWNER_EMAILS = ["spigolehouse@gmail.com", "andreatringali.spi@gmail.com"];
const SESSION_FLAG = "xn-media-migrate-session";
const START_DELAY_MS = 8000;   // lascia finire l'avvio dell'app prima di fare qualunque richiesta
const PAUSE_MS = 1500;         // pausa tra un blocco e il successivo
const MAX_FAIL_STREAK = 2;     // si ferma al primo errore ripetuto 2 volte

interface MigrateResp {
  ok?: boolean; done?: boolean; processed?: number; uploaded?: number; remainingImages?: number; remainingBytes?: number;
  errors?: { row: string; path: string; message: string }[]; partialScan?: boolean; error?: string;
}

type Phase = "idle" | "running" | "done" | "stopped";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function MediaMigrator() {
  const { user } = useAuth();
  const isOwner = !!user?.email && OWNER_EMAILS.includes(user.email.toLowerCase());
  const [phase, setPhase] = useState<Phase>("idle");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [moved, setMoved] = useState(0);
  const [hidden, setHidden] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!isOwner || !supabase || started.current) return;
    try { if (sessionStorage.getItem(SESSION_FLAG)) return; } catch { /* sessionStorage non disponibile: si va avanti, una volta per montaggio */ }
    started.current = true;
    let alive = true;

    const call = async (body: Record<string, unknown>): Promise<MigrateResp | null> => {
      const token = (await supabase!.auth.getSession()).data.session?.access_token;
      if (!token) return null;
      const res = await fetch("/api/admin/media-migrate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      if (res.status === 409) return { ok: false, error: "busy" }; // un altro blocco è in corso (altra scheda): non insistere
      const j = (await res.json().catch(() => null)) as MigrateResp | null;
      return j;
    };

    const timer = setTimeout(async () => {
      if (!alive) return;
      try {
        // 1) stato in "prova": nessuna scrittura
        const st = await call({ dryRun: true });
        if (!alive || !st || st.error) { return; }
        try { sessionStorage.setItem(SESSION_FLAG, "1"); } catch { /* ignora */ }
        const left0 = st.remainingImages ?? 0;
        if (left0 <= 0) return;
        setRemaining(left0); setPhase("running");

        // 2) blocchi in sequenza
        let failStreak = 0, noProgress = 0, total = 0, anyWrite = false;
        while (alive) {
          let r: MigrateResp | null = null;
          try { r = await call({ maxImages: 10, maxMs: 40000 }); } catch { r = null; }
          if (!alive) return;
          if (r?.error === "busy") { setPhase("idle"); return; }
          const processed = r?.processed ?? 0;
          total += processed; if (processed > 0) anyWrite = true;
          if (r && typeof r.remainingImages === "number") setRemaining(r.remainingImages);
          setMoved(total);
          const hadError = !r || r.error || (r.errors && r.errors.length > 0);
          failStreak = hadError && processed === 0 ? failStreak + 1 : 0;
          noProgress = processed === 0 ? noProgress + 1 : 0;
          if (r?.done) { setPhase("done"); break; }
          if (failStreak >= MAX_FAIL_STREAK || noProgress >= MAX_FAIL_STREAK + 1) { setPhase("stopped"); break; }
          await sleep(PAUSE_MS);
        }
        // 3) il rev sul server è cambiato: si forza subito una sincronizzazione (lo stesso evento che il browser lancia quando si torna sulla scheda)
        if (anyWrite) { try { window.dispatchEvent(new Event("focus")); } catch { /* ambiente senza window */ } }
      } catch { /* nessuna conseguenza: riproverà alla prossima sessione */ }
    }, START_DELAY_MS);

    return () => { alive = false; clearTimeout(timer); started.current = false; };
  }, [isOwner]);

  // Il messaggio finale resta qualche secondo, poi sparisce.
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setHidden(true), 15000);
    return () => clearTimeout(t);
  }, [phase]);

  if (!isOwner || hidden || phase === "idle") return null;
  const text =
    phase === "running" ? `Alleggerisco i dati… ${remaining ?? "…"} foto rimaste`
    : phase === "done" ? `Dati alleggeriti: ${moved} foto spostate. I dispositivi si aggiornano da soli.`
    : `Alleggerimento dei dati fermato (${remaining ?? "?"} foto rimaste): riprova più tardi.`;
  return (
    <div role="status" className="no-print fixed bottom-3 left-3 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-dim shadow-sm">
      <span>{text}</span>
      {phase !== "running" && <button onClick={() => setHidden(true)} className="text-dim hover:text-txt" aria-label="Chiudi">✕</button>}
    </div>
  );
}
