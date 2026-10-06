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
const CTA_KEY = "spigolestay:calcta";
const CTD_KEY = "spigolestay:calctd";
const DEBOUNCE_MS = 4000;
// Snapshot dell'ultimo ARI inviato con successo, per struttura. Serve al DELTA: prima di inviare
// calcoliamo la finestra completa, la confrontiamo con lo snapshot e spediamo SOLO le righe cambiate.
const SNAPSHOT_KEY = "spigolestay:channex-arisnapshot";
// Timestamp (per struttura) dell'ultimo full-sync completo: lo forziamo al massimo 1 volta/24h.
const LASTFULL_KEY = "spigolestay:channex-lastfullsync";
// Finestra di sincronizzazione richiesta dalla certificazione Channex: 500 giorni.
const FULL_DAYS = 500;
const FULLSYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
// Evento custom emesso dal calendario quando cambiano le chiusure vendita (persistite in
// localStorage, fuori dallo stato condiviso): serve a far scattare comunque la sincronizzazione.
export const CHANNEX_DIRTY_EVENT = "spigolestay:channex-dirty";

// Full sync manuale su richiesta (pulsante "Canali"): azzera il timestamp dell'ultimo full-sync
// per la struttura così il prossimo giro di ChannexAutoSync invia SEMPRE la finestra intera
// (needFull=true), non il delta — esattamente le 2 chiamate (availability+restrictions) richieste
// da Channex per il test "Full sync on demand".
export function forceFullSync(structureId: string) {
  const lastFull = loadJSON<Record<string, number>>(LASTFULL_KEY, {});
  delete lastFull[structureId];
  saveJSON(LASTFULL_KEY, lastFull);
  window.dispatchEvent(new Event(CHANNEX_DIRTY_EVENT));
}

// Snapshot per struttura: mappa chiave→valore (stringa) delle righe già inviate.
// - disponibilità:  chiave `${property_id}|${room_type_id}|${date}` → valore = numero disponibilità
// - restrizioni:    chiave `${property_id}|${rate_plan_id}|${date}` → valore = JSON canonico dei campi
type StructSnapshot = { availability: Record<string, string>; restrictions: Record<string, string> };
type SnapshotStore = Record<string, StructSnapshot>;

function loadJSON<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fallback; } catch { return fallback; }
}
function saveJSON(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage pieno/negato: si riprova al prossimo giro */ }
}

// Lo snapshot pesa centinaia di KB: sta in sessionStorage (quota separata) e NON nel localStorage, che è quasi pieno
// e sincronizzato col server. Se manca (nuova sessione) si fa un full-sync, che comunque si fa ogni 24h.
function loadSnapshots(): SnapshotStore {
  try { const r = sessionStorage.getItem(SNAPSHOT_KEY); return r ? (JSON.parse(r) as SnapshotStore) : {}; } catch { return {}; }
}
function saveSnapshots(v: SnapshotStore) {
  try { sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(v)); } catch { /* storage pieno: si ripete il full-sync */ }
}

// Chiave/valore per il diff.
const availKey = (r: { property_id: string; room_type_id: string; date: string }) => `${r.property_id}|${r.room_type_id}|${r.date}`;
const availVal = (r: { availability: number }) => String(r.availability);
const restrKey = (r: { property_id: string; rate_plan_id: string; date?: string; date_from?: string }) => `${r.property_id}|${r.rate_plan_id}|${r.date ?? r.date_from ?? ""}`;
// Valore canonico (ordine campi fisso) così due righe identiche producono la stessa stringa.
const restrVal = (r: { rate?: string; min_stay_arrival?: number; max_stay?: number; stop_sell?: boolean; closed_to_arrival?: boolean; closed_to_departure?: boolean }) =>
  JSON.stringify({ rate: r.rate, min_stay_arrival: r.min_stay_arrival, max_stay: r.max_stay, stop_sell: r.stop_sell, closed_to_arrival: r.closed_to_arrival, closed_to_departure: r.closed_to_departure });

export default function ChannexAutoSync() {
  const { raw, rateOverrides } = useData(); // dati completi: la sincronizzazione non dipende dalle strutture selezionate in alto
  const { roomTypes, units, bookings } = raw;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        // Restrizioni OTA impostate dall'owner (chiuso all'arrivo / alla partenza), fuori dallo stato condiviso.
        let cta: Record<string, true> = {};
        try { cta = JSON.parse(localStorage.getItem(CTA_KEY) || "{}"); } catch {}
        let ctd: Record<string, true> = {};
        try { ctd = JSON.parse(localStorage.getItem(CTD_KEY) || "{}"); } catch {}
        const { roomTypes: rt, units: un, bookings: bk, rateOverrides: ro } = dataRef.current;

        const snapshots = loadSnapshots();
        const lastFull = loadJSON<Record<string, number>>(LASTFULL_KEY, {});
        const now = Date.now();

        for (const [sid, map] of linked) {
          // Finestra COMPLETA 500 giorni (una sola build: da qui si ricava full o delta).
          const { availability, restrictions } = buildAriPayload(map, sid, rt, un, bk, ro, { days: FULL_DAYS, weekendPct, closes, cta, ctd });
          if (availability.length === 0 && restrictions.length === 0) continue;

          const snap = snapshots[sid];
          // Full-sync quando: manca lo snapshot (primo caricamento) oppure sono passate 24h.
          const needFull = !snap || (now - (lastFull[sid] ?? 0) >= FULLSYNC_INTERVAL_MS);

          // Mappe chiave→valore correnti (servono sia per il diff che per aggiornare lo snapshot).
          const curAvail: Record<string, string> = {};
          for (const a of availability) curAvail[availKey(a)] = availVal(a);
          const curRestr: Record<string, string> = {};
          for (const r of restrictions) curRestr[restrKey(r)] = restrVal(r);

          // Righe da inviare: full = tutte; delta = solo quelle nuove o cambiate rispetto allo snapshot.
          let sendAvail = availability;
          let sendRestr = restrictions;
          if (!needFull) {
            const prevA = snap!.availability || {};
            const prevR = snap!.restrictions || {};
            sendAvail = availability.filter((a) => prevA[availKey(a)] !== availVal(a));
            sendRestr = restrictions.filter((r) => prevR[restrKey(r)] !== restrVal(r));
            if (sendAvail.length === 0 && sendRestr.length === 0) continue; // niente cambiato per questa struttura
          }

          let availOk = false, restrOk = false;
          try {
            const res = await fetch("/api/channex/ari", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ availability: sendAvail, restrictions: sendRestr }),
            });
            const j = await res.json().catch(() => null) as null | { availability?: { ok?: boolean }; restrictions?: { ok?: boolean } };
            availOk = !!j?.availability?.ok;
            restrOk = !!j?.restrictions?.ok;
          } catch { /* rete assente: snapshot non aggiornato → si riprova al prossimo cambiamento */ }

          // Aggiorna lo snapshot SOLO con le righe inviate con successo (per endpoint).
          const nextSnap: StructSnapshot = snap ? { availability: { ...snap.availability }, restrictions: { ...snap.restrictions } } : { availability: {}, restrictions: {} };
          if (needFull) {
            // Full riuscito → lo snapshot diventa l'intera finestra corrente (reset), altrimenti lo si lascia com'è.
            if (availOk) nextSnap.availability = curAvail;
            if (restrOk) nextSnap.restrictions = curRestr;
            // Registra il full-sync solo se ENTRAMBE le parti sono andate a buon fine, così un full
            // fallito viene ritentato (e non "blindato" per 24h).
            if (availOk && restrOk) { lastFull[sid] = now; saveJSON(LASTFULL_KEY, lastFull); }
          } else {
            // Delta → aggiorna nello snapshot solo le chiavi effettivamente inviate con successo.
            if (availOk) for (const a of sendAvail) nextSnap.availability[availKey(a)] = availVal(a);
            if (restrOk) for (const r of sendRestr) nextSnap.restrictions[restrKey(r)] = restrVal(r);
          }
          snapshots[sid] = nextSnap;
          saveSnapshots(snapshots);
        }
      }, DEBOUNCE_MS);
    };

    // 1) Cambiamenti nello stato condiviso + primo caricamento: schedula sempre un push (il DELTA
    // rende innocuo il caso "niente cambiato" = non invia nulla; se manca lo snapshot fa il full-sync
    // iniziale, necessario per una struttura appena collegata).
    schedulePush();

    // 2) Chiusure vendita e collegamento struttura: vivono fuori dallo stato condiviso → evento custom.
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
