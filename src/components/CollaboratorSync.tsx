"use client";

// Allinea le schede utente con la realtà: se in "Utenti" una persona ha strutture assegnate, le trova davvero condivise.
// Parte da sola all'apertura di Xenora (una volta per sessione del browser e per persona/struttura), senza pulsanti da premere.
// Idempotente: se è già dentro non succede nulla. Gli errori compaiono in un avviso, non restano nascosti.
import { useEffect } from "react";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/authsync";
import { useToast } from "@/components/ToastProvider";
import { supabase } from "@/lib/supabase";
import { loadUsers } from "@/lib/users";
import { humanInviteError, isValidEmail, permsForMember, structuresToShare } from "@/lib/user-access";

export default function CollaboratorSync() {
  const { structures, updateStructure } = useData();
  const { user: authUser } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (!supabase || !authUser?.email || structures.length === 0) return;
    const me = authUser.email.trim().toLowerCase();
    const people = loadUsers().filter((u) => u.id !== "u-owner" && isValidEmail(u.email) && u.email.trim().toLowerCase() !== me && structuresToShare(structures, u).length > 0);
    if (people.length === 0) return;
    let cancelled = false;
    (async () => {
      const token = (await supabase!.auth.getSession())?.data.session?.access_token;
      if (!token || cancelled) return;
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      for (const u of people) {
        const email = u.email.trim().toLowerCase();
        // il profilo aggiornato raggiunge la sua scheda (senza email; risponde 403 a chi non è l'amministratore: va bene)
        try {
          const profile = { id: u.id, firstName: u.firstName, lastName: u.lastName, username: u.username, phone: u.phone, language: u.language, avatarColor: u.avatarColor, templateKey: u.templateKey, perms: u.perms, allStructures: u.allStructures, structureIds: u.structureIds };
          await fetch("/api/admin/allowlist", { method: "POST", headers, body: JSON.stringify({ email, profileOnly: true, profile }) });
        } catch { /* niente */ }
        let shared = 0;
        for (const st of structuresToShare(structures, u)) {
          const key = `spigolestay:shared:${email}:${st.id}`;
          try { if (sessionStorage.getItem(key)) continue; } catch { /* niente */ }
          try {
            const r = await fetch("/api/org/invite", { method: "POST", headers, body: JSON.stringify({ structureId: st.id, email, silent: true }) });
            const j = (await r.json().catch(() => ({}))) as { ok?: boolean; orgId?: string; already?: boolean; error?: string; message?: string };
            if (cancelled) return;
            if (j.ok) {
              try { sessionStorage.setItem(key, "1"); } catch { /* niente */ }
              if (j.orgId && !st.orgId) updateStructure(st.id, { orgId: j.orgId });
              if (!j.already) shared += 1;
            } else if (j.error !== "email_not_registered") toast(`${st.name} → ${u.firstName || email}: ${humanInviteError(j.error, j.message)}`, "error"); // chi non ha ancora un account (schede senza invito) non è un errore
          } catch { /* rete: riprova alla prossima apertura */ }
        }
        // permessi del profilo applicati come permessi di co-gestore, appena la persona è dentro (si riapplicano se cambiano)
        const perms = permsForMember(u.perms as Record<string, string> | undefined);
        const permsSig = JSON.stringify(perms);
        for (const st of structuresToShare(structures, u)) {
          const pkey = `spigolestay:perms:${email}:${st.id}`;
          try { if (sessionStorage.getItem(pkey) === permsSig) continue; } catch { /* niente */ }
          try {
            const r = await fetch(`/api/org/members?structureId=${encodeURIComponent(st.id)}`, { headers });
            const j = (await r.json().catch(() => ({}))) as { members?: { userId: string; email: string }[] };
            const m = (j.members ?? []).find((x) => (x.email || "").toLowerCase() === email);
            if (!m) continue; // non è ancora entrata: si applicano al prossimo avvio
            const pr = await fetch("/api/org/members", { method: "POST", headers, body: JSON.stringify({ structureId: st.id, userId: m.userId, permissions: perms }) });
            if (pr.ok) { try { sessionStorage.setItem(pkey, permsSig); } catch { /* niente */ } }
          } catch { /* rete: riprova alla prossima apertura */ }
        }
        if (shared > 0) toast(`${shared} ${shared === 1 ? "struttura condivisa" : "strutture condivise"} con ${u.firstName || email}`, "success");
      }
    })();
    return () => { cancelled = true; };
    // una volta per apertura: le strutture si caricano all'avvio, poi non serve rifarlo a ogni modifica
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.email, structures.length]);

  return null;
}
