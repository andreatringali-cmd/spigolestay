"use client";

// Scheda utente → "Accesso a Xenora". Nessun passaggio manuale: quando crei o salvi la scheda parte l'invito, e le strutture assegnate
// e i permessi li allinea Xenora da sola (vedi CollaboratorSync). Qui si vede solo lo stato e, se serve, si rimanda l'email di invito.
import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { humanInviteError, isValidEmail, signupLink } from "@/lib/user-access";
import type { User } from "@/lib/users";

type Line = { ok: boolean; text: string };
export interface UserAccessProps {
  user: User;
  structures?: { id: string; name: string }[]; // non più usate: la condivisione è automatica (resta per compatibilità con la pagina)
  onShared?: (structureId: string, orgId: string) => void;
}

const bearer = async () => (await supabase?.auth.getSession())?.data.session?.access_token || "";
const btn = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-50";

export default function UserAccessCard({ user }: UserAccessProps) {
  const email = user.email.trim().toLowerCase();
  const valid = isValidEmail(email);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [link, setLink] = useState("");

  // Rimanda l'email di invito (con il link di registrazione). Le strutture non c'entrano: arrivano da sole.
  const resend = async () => {
    if (!valid) return;
    setBusy(true); setLines([]);
    try {
      const token = await bearer();
      const r = await fetch("/api/admin/allowlist", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ email, note: `Utente: ${user.firstName} ${user.lastName}`.trim(), kind: "collaboratore" }) });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (r.status === 403) { setLines([{ ok: false, text: "Solo il titolare dell'account può invitare nuovi utenti." }]); return; }
      if (!j.ok) { setLines([{ ok: false, text: humanInviteError(String(j.error ?? ""), String(j.message ?? "")) }]); return; }
      setLink(signupLink(window.location.origin, email));
      setLines([j.notified
        ? { ok: true, text: `Invito inviato a ${email}.` }
        : { ok: true, text: `${email} è abilitata, ma l'email non è partita (invio email non attivo). Copia il link qui sotto e mandaglielo tu.` }]);
    } catch { setLines([{ ok: false, text: "Rete non disponibile." }]); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setLines((l) => [...l, { ok: true, text: "Link copiato." }]); } catch { /* niente */ } };

  return (
    <Card>
      <SectionTitle>Accesso a Xenora</SectionTitle>
      <p className="mt-1 text-xs text-dim">
        Salvando la scheda la persona riceve l&apos;email con il link di registrazione e sceglie la password. Le strutture e i permessi indicati qui sotto li trova già al primo accesso.
      </p>
      {!valid && <p className="mt-2 text-xs font-medium text-[color:var(--warn)]">Inserisci prima un&apos;email valida e salva.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={btn} disabled={!valid || busy} onClick={() => void resend()}>{busy ? "Invio…" : "Rinvia l'invito"}</button>
      </div>
      {link && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[11px] text-dim">
          <span className="min-w-0 flex-1 truncate">{link}</span>
          <button className={btn} onClick={() => void copy()}>Copia</button>
        </div>
      )}
      {lines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {lines.map((l, i) => <li key={i} style={{ color: l.ok ? "var(--ok)" : "var(--warn)" }}>{l.ok ? "✓" : "•"} {l.text}</li>)}
        </ul>
      )}
    </Card>
  );
}
