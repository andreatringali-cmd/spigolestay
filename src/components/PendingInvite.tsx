"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/authsync";

// Se l'utente ha aperto un link di invito prima di accedere, appena è collegato
// lo riporta alla pagina di accettazione (così l'invito non resta in sospeso).
export default function PendingInvite() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    try {
      const code = localStorage.getItem("xn-pending-invite");
      if (code) window.location.replace(`/accetta-invito?code=${encodeURIComponent(code)}`);
    } catch {}
  }, [user?.id]);
  return null;
}
