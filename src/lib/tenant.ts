"use client";

// Account di lavoro: per un titolare è il suo id; per un collaboratore (invitato da "Utenti") è l'id di chi lo ha invitato.
// Le tabelle di contabilità e adempimenti sono legate a questo id (tenant_id), non all'id di chi sta usando l'app.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./authsync";

const cache = new Map<string, string>();

export function useTenantId(): string | undefined {
  const { user } = useAuth();
  const uid = user?.id;
  const [, bump] = useState(0);

  useEffect(() => {
    if (!uid || !supabase || cache.has(uid)) return;
    let off = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sb = supabase;
    // Una risposta {data:null, error} (token scaduto, rete instabile, 5xx) NON è un esito: non si mette in cache
    // il proprio id (un collaboratore scriverebbe i dati su un account che il titolare non vede) ma si riprova con attesa crescente.
    const attempt = (n: number) => {
      const done = (v: string) => { cache.set(uid, v); if (!off) bump((k) => k + 1); };
      const fail = () => {
        if (!off) timer = setTimeout(() => attempt(n + 1), Math.min(30000, 1000 * 2 ** Math.min(n, 5)));
      };
      void Promise.resolve(sb.rpc("workspace_owner", { uid })).then(({ data, error }) => {
        if (error) fail();
        else done(typeof data === "string" && data ? data : uid);
      }, fail);
    };
    attempt(0);
    return () => { off = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Tutti aspettano la risposta valida del server (mai scrivere con il proprio id per errore, anche se il flag xn-collab manca su questo dispositivo): i chiamanti gestiscono già !tenantId.
  return uid ? cache.get(uid) : undefined;
}
