"use client";

// Stato condiviso dei Messaggi OTA nel browser (letto / non serve rispondere): legge e scrive la chiave piatta `spigolestay:msg:state`, che la sincronizzazione porta
// agli altri collaboratori della struttura (vedi msg-state.ts). Quando arrivano novità dal server (evento «spigolestay:datasync») o da un'altra scheda, si rilegge da sola.
import { useCallback, useEffect, useRef, useState } from "react";
import { kvGet, kvSet } from "./bigstore";
import { MSG_STATE_KEY, migrateOldSeen, parseMsgState, serializeMsgState, type MsgState } from "./msg-state";

const OLD_SEEN_KEY = "xn:msg2:seen"; // vecchio segno «letto» (solo questo dispositivo): riportato una volta nello stato condiviso

export function useMsgState(by: string): { state: MsgState; update: (fn: (s: MsgState) => MsgState) => void } {
  const [state, setState] = useState<MsgState>({});
  const sig = useRef("");
  const byRef = useRef(by);
  useEffect(() => { byRef.current = by; }, [by]);

  const read = useCallback((): MsgState => {
    let raw: string | null = null;
    try { raw = kvGet(MSG_STATE_KEY); } catch { /* storage non disponibile */ }
    return parseMsgState(raw);
  }, []);
  const publish = useCallback((s: MsgState) => {
    const t = serializeMsgState(s);
    if (t === sig.current) return;
    sig.current = t; setState(s);
  }, []);

  useEffect(() => {
    // Migrazione una tantum del vecchio segno locale (poi la vecchia chiave si toglie).
    try {
      const oldRaw = localStorage.getItem(OLD_SEEN_KEY);
      if (oldRaw !== null) {
        let old: unknown = null;
        try { old = JSON.parse(oldRaw); } catch { /* rovinato: si scarta */ }
        const cur = read();
        const next = migrateOldSeen(cur, old, byRef.current || "migrazione", Date.now());
        if (next !== cur) { try { kvSet(MSG_STATE_KEY, serializeMsgState(next)); } catch { /* quota piena: resta il vecchio segno */ return; } }
        localStorage.removeItem(OLD_SEEN_KEY);
      }
    } catch { /* storage non disponibile */ }
    publish(read());
    const reread = () => publish(read());
    window.addEventListener("spigolestay:datasync", reread); // la sincronizzazione ha portato novità dagli altri collaboratori
    window.addEventListener("storage", reread);              // un'altra scheda dello stesso browser
    window.addEventListener("focus", reread);
    return () => { window.removeEventListener("spigolestay:datasync", reread); window.removeEventListener("storage", reread); window.removeEventListener("focus", reread); };
  }, [read, publish]);

  /** Modifica a partire dal valore PIÙ RECENTE nel browser (non da quello mostrato): due modifiche ravvicinate non si perdono. Se la funzione ritorna lo stesso oggetto non si scrive nulla. */
  const update = useCallback((fn: (s: MsgState) => MsgState) => {
    const cur = read();
    const next = fn(cur);
    if (next === cur) return;
    try { kvSet(MSG_STATE_KEY, serializeMsgState(next)); } catch { return; }
    publish(next);
  }, [read, publish]);

  return { state, update };
}
