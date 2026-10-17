"use client";

import { useEffect, useRef } from "react";
import { ymdRome } from "@/lib/dates-rome";
import { useData } from "@/lib/store";
import { apiPost } from "@/lib/invoicing/client";
import { applyPatches, healDuplicates, healRoundedTotals, mergePatches, needsChannexCheck, reconcilePatches, type ReconcileResult } from "@/lib/booking-heal";

// Allineamento AUTOMATICO e silenzioso delle prenotazioni già presenti (nessun pulsante, nessun incolla). Montato nell'AppShell accanto a ChannexAutoSync.
//  1) in locale, subito dopo il caricamento: totali Booking con i centesimi (= incassato, se a meno di 1 €) e doppioni Octorate/Channex (la riga Octorate si segna
//     annullata come duplicato e i suoi dati passano sulla riga Channex; nulla viene cancellato);
//  2) con Channex: per le prenotazioni Booking senza commissione esatta (o con totale intero non confermato), check-out da 30 giorni fa in avanti, rilegge la
//     revision attuale tramite /api/channex/reconcile, a blocchi piccoli e con pausa, e scrive commissione/costo d'incasso/totale esatti.
// Le scritture passano da patchBookingsSilently: updatedAt nuovo (la sincronizzazione le adotta) ma nessuna voce nel registro, email o Google Calendar.
// Parte ~25 s dopo l'apertura, poi al massimo ogni 3 ore finché l'app resta aperta. Un collaboratore non lo esegue (lo fa il titolare).
const START_DELAY_MS = 25_000;
const REPEAT_MS = 3 * 60 * 60 * 1000;
const CHUNK = 3;              // prenotazioni per richiesta (la coda Channex ha il limite di 20 richieste/minuto)
const PAUSE_MS = 9_000;       // pausa tra un blocco e il successivo
const SESSION_MAX = 36;       // al massimo 36 prenotazioni rilette per sessione (le altre alla prossima, il progresso resta ricordato)
const MAX_FAIL_STREAK = 2;    // ci si ferma al secondo errore di fila
const CHECKED_KEY = "xn-heal-checked";   // id → timestamp dell'ultimo controllo (riprova al massimo ogni 24 ore); locale a questo browser, non sincronizzato
const LOCK_KEY = "xn-heal-lock";         // evita che due schede facciano il giro insieme
const DEFINITIVE = new Set(["canale_non_supportato", "non_autorizzato", "revision_non_corrispondente", "nessuna revision per questa prenotazione"]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function loadChecked(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(CHECKED_KEY) || sessionStorage.getItem(CHECKED_KEY) || "{}") as Record<string, number>; } catch { return {}; }
}
function saveChecked(m: Record<string, number>) {
  // Si tengono solo i controlli delle ultime 48 ore (la mappa non cresce all'infinito).
  const cut = Date.now() - 48 * 60 * 60 * 1000;
  const keep = Object.fromEntries(Object.entries(m).filter(([, t]) => t > cut));
  const s = JSON.stringify(keep);
  try { localStorage.setItem(CHECKED_KEY, s); } catch { try { sessionStorage.setItem(CHECKED_KEY, s); } catch { /* niente: si riprova più tardi */ } }
}

export default function BookingHealer() {
  const { raw, patchBookingsSilently } = useData();
  const ref = useRef({ bookings: raw.bookings, patch: patchBookingsSilently });
  useEffect(() => { ref.current = { bookings: raw.bookings, patch: patchBookingsSilently }; }); // sempre i dati più recenti per il giro in background
  const hasData = raw.bookings.length > 0;
  const sessionCount = useRef(0);
  const running = useRef(false);

  useEffect(() => {
    if (!hasData) return;
    try { if (localStorage.getItem("xn-collab") === "1") return; } catch { /* niente */ }
    let alive = true;

    const run = async () => {
      if (running.current || !alive) return;
      try {
        const lock = Number(localStorage.getItem(LOCK_KEY) || 0);
        if (Date.now() - lock < 5 * 60 * 1000) return;
        localStorage.setItem(LOCK_KEY, String(Date.now()));
      } catch { /* senza storage si procede */ }
      running.current = true;
      try {
        // 1) locale: doppioni prima (possono portare un totale con i centesimi), poi totali arrotondati sul risultato.
        const base = ref.current.bookings;
        const dups = healDuplicates(base);
        const tots = healRoundedTotals(applyPatches(base, dups));
        const local = mergePatches(dups, tots);
        if (local.length) ref.current.patch(local);

        // 2) Channex: commissioni e totali esatti, a blocchi.
        const checked = loadChecked();
        const today = ymdRome(new Date());
        const ids = needsChannexCheck(applyPatches(base, local), today, checked, Date.now(), Math.max(0, SESSION_MAX - sessionCount.current));
        let fails = 0;
        for (let i = 0; i < ids.length && alive; i += CHUNK) {
          if (i > 0) await sleep(PAUSE_MS);
          if (!alive) break;
          const chunk = ids.slice(i, i + CHUNK);
          sessionCount.current += chunk.length;
          let resp: { results?: ReconcileResult[]; stopped?: string } | null = null;
          try { resp = await apiPost<{ results?: ReconcileResult[]; stopped?: string }>("channex/reconcile", { ids: chunk }); } catch { resp = null; }
          if (!resp) { if (++fails >= MAX_FAIL_STREAK) break; continue; }
          fails = 0;
          const results = resp.results ?? [];
          const now = Date.now();
          for (const r of results) if (r.ok || (r.error && DEFINITIVE.has(r.error))) checked[r.id] = now;
          saveChecked(checked);
          const patches = reconcilePatches(ref.current.bookings, results);
          if (patches.length) ref.current.patch(patches);
          if (resp.stopped) break; // Channex ha dato errori ripetuti o il tempo è finito: si riprova al prossimo giro
        }
      } catch { /* silenzioso: l'allineamento non deve mai disturbare */ }
      finally { running.current = false; }
    };

    const first = setTimeout(run, START_DELAY_MS);
    const iv = setInterval(run, REPEAT_MS);
    return () => { alive = false; clearTimeout(first); clearInterval(iv); };
  }, [hasData]);

  return null;
}
