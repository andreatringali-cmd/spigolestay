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
  const isCollab = (() => { try { return typeof window !== "undefined" && localStorage.getItem("xn-collab") === "1"; } catch { return false; } })();

  useEffect(() => {
    if (!uid || !supabase || cache.has(uid)) return;
    let off = false;
    void Promise.resolve(supabase.rpc("workspace_owner", { uid })).then(({ data }) => {
      cache.set(uid, typeof data === "string" && data ? data : uid);
      if (!off) bump((n) => n + 1);
    }, () => { if (!isCollab) { cache.set(uid, uid); if (!off) bump((n) => n + 1); } });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Un collaboratore aspetta la risposta del server (mai scrivere con il proprio id per errore); un titolare usa subito il suo.
  return uid ? (cache.get(uid) ?? (isCollab ? undefined : uid)) : undefined;
}
