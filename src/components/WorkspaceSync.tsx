"use client";

// Un collaboratore (invitato da "Utenti") lavora sulle impostazioni dell'attività del titolare: incassi per canale, tariffe, modelli messaggi,
// pulizie, collegamenti, ecc. Qui si scaricano dal server all'avvio e si inviano le sue modifiche, come farebbe un secondo dispositivo del titolare.
// Il titolare non passa da qui: continua a sincronizzare come sempre (il server aggiorna il suo stato e il suo browser si allinea).
import { useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { supabase } from "@/lib/supabase";
import { localWorkspaceKeys } from "@/lib/workspace-keys";

const PULL_MS = 20_000;
const PUSH_MS = 3_000;

export default function WorkspaceSync() {
  const { structures } = useData();
  const { user } = useAuth();
  const [collab, setCollab] = useState(false);
  const sids = structures.map((s) => s.id).join(",");

  useEffect(() => {
    const read = () => { try { setCollab(localStorage.getItem("xn-collab") === "1"); } catch { /* niente */ } };
    read();
    window.addEventListener("xn-collab", read);
    return () => window.removeEventListener("xn-collab", read);
  }, []);

  useEffect(() => {
    if (!collab || !user?.id || !supabase) return;
    const sb = supabase;
    let stop = false;
    const server: Record<string, string> = {}; // ultimo valore noto sul server
    const base: Record<string, string> = {};   // valore locale dopo l'ultimo allineamento: serve a capire cosa ha cambiato lei
    let ready = false;

    const keys = () => {
      const out = new Set(localWorkspaceKeys());
      for (const id of sids.split(",").filter(Boolean)) {
        out.add(`spigolestay:sito:${id}`); out.add(`spigolestay:pulizie:autoshare:${id}`); out.add(`spigolestay:reviews:placeid:${id}`);
      }
      return [...out];
    };

    const pull = async (): Promise<boolean> => {
      const { data, error } = await sb.rpc("ws_get", { p_keys: keys() });
      if (error || !data || typeof data !== "object") return false;
      let changed = false;
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (typeof v !== "string") continue;
        let local: string | null = null;
        try { local = localStorage.getItem(k); } catch { /* niente */ }
        if (!(k in server)) {
          // prima volta: vince il server (le impostazioni sono quelle del titolare)
          if (local !== v) { try { localStorage.setItem(k, v); changed = true; } catch { /* storage pieno */ } }
          server[k] = v; base[k] = v;
        } else if (v !== server[k]) {
          const dirty = local !== base[k]; // modifica sua non ancora inviata: vince la sua, viene inviata al prossimo giro
          if (!dirty) { try { localStorage.setItem(k, v); changed = true; } catch { /* niente */ } base[k] = v; }
          server[k] = v;
        }
      }
      return changed;
    };

    const push = async () => {
      if (!ready) return;
      for (const k of keys()) {
        let local: string | null = null;
        try { local = localStorage.getItem(k); } catch { /* niente */ }
        if (local === null) continue;
        if (!(k in base)) { base[k] = local; continue; } // chiave nuova mai vista sul server: il valore iniziale non si invia (sono i predefiniti dell'app)
        if (local === base[k] || local === server[k]) continue;
        const { error } = await sb.rpc("ws_set", { p_key: k, p_value: local });
        if (!error) { server[k] = local; base[k] = local; }
      }
    };

    (async () => {
      try {
        const changed = await pull();
        ready = true;
        // le pagine leggono le impostazioni all'apertura: se ne sono arrivate di nuove si ricarica una volta per sessione
        if (changed && !sessionStorage.getItem("xn-ws-reloaded")) { sessionStorage.setItem("xn-ws-reloaded", "1"); window.location.reload(); }
      } catch { /* si riprova al prossimo giro */ }
    })();
    const t1 = window.setInterval(() => { if (!stop) void pull().then(() => { ready = true; }).catch(() => null); }, PULL_MS);
    const t2 = window.setInterval(() => { if (!stop) void push().catch(() => null); }, PUSH_MS);
    return () => { stop = true; window.clearInterval(t1); window.clearInterval(t2); };
  }, [collab, user?.id, sids]);

  return null;
}
