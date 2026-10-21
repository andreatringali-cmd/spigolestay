"use client";

// Scheda utente → "Accesso a Xenora". Nessun passaggio manuale: quando crei o salvi la scheda parte l'invito, e le strutture assegnate
// e i permessi li allinea Xenora da sola (vedi CollaboratorSync). Qui si vede lo stato dell'invito e, se serve, si rimanda o si annulla.
import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmProvider";
import { fmtDate } from "@/lib/dates";
import { cancelInvite, markInvited, runInvite } from "@/lib/invite-client";
import { inviteStateOf, isValidEmail, signupLink } from "@/lib/user-access";
import type { User } from "@/lib/users";

type Line = { ok: boolean; text: string };
export interface UserAccessProps {
  user: User;
  structures?: { id: string; name: string }[]; // strutture del titolare: servono a condividere quelle assegnate alla persona
  onShared?: (structureId: string, orgId: string) => void;
}

const btn = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-50";

export default function UserAccessCard({ user, structures = [], onShared }: UserAccessProps) {
  const ask = useConfirm();
  const email = user.email.trim().toLowerCase();
  const valid = isValidEmail(email);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [link, setLink] = useState("");
  // stato mostrato: parte da quello salvato sulla scheda e si aggiorna dopo ogni azione
  const [invitedAt, setInvitedAt] = useState<string | undefined>(user.invitedAt);
  const [mailFailed, setMailFailed] = useState<boolean>(!!user.inviteMailFailed);
  const state = inviteStateOf({ ...user, invitedAt, inviteMailFailed: mailFailed }, { lastAccess: user.lastLogin?.at ?? null });

  // (Ri)manda l'invito: abilita l'indirizzo, condivide le strutture assegnate e manda l'email (con il link all'invito).
  const resend = async () => {
    if (!valid) return;
    setBusy(true); setLines([]);
    try {
      const r = await runInvite(user, structures);
      for (const [sid, oid] of Object.entries(r.orgIds)) onShared?.(sid, oid);
      const out: Line[] = [{ ok: r.ok && r.notified, text: r.message }];
      for (const w of r.warnings) out.push({ ok: false, text: w });
      if (r.deferred > 0) out.push({ ok: true, text: "Le strutture le condividerà il titolare dell'account appena apre Xenora." });
      setLines(out);
      if (r.ok) {
        setInvitedAt(r.sentAt ?? new Date().toISOString()); setMailFailed(!r.notified);
        markInvited(user.id, { invitedAt: r.sentAt ?? new Date().toISOString(), ...(r.notified ? {} : { inviteMailFailed: true }) });
        if (!r.notified) setLink(signupLink(window.location.origin, email));
      }
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!(await ask({ title: "Annulla invito", message: `Annullare l'invito a ${email}? Non potrà più registrarsi con questo invito; la scheda resta e potrai invitarla di nuovo.`, danger: true, confirmLabel: "Annulla invito", cancelLabel: "Tieni l'invito" }))) return;
    setBusy(true); setLines([]);
    try {
      const r = await cancelInvite(email);
      setLines([{ ok: r.ok, text: r.message }]);
      if (r.ok) { setInvitedAt(undefined); setMailFailed(false); setLink(""); markInvited(user.id, null); }
    } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setLines((l) => [...l, { ok: true, text: "Link copiato." }]); } catch { /* niente */ } };

  return (
    <Card>
      <SectionTitle>Accesso a Xenora</SectionTitle>
      <p className="mt-1 text-xs text-dim">
        Salvando la scheda la persona riceve l&apos;email con il link per entrare e sceglie la password. Le strutture e i permessi indicati qui sotto li trova già al primo accesso.
      </p>
      {!valid && <p className="mt-2 text-xs font-medium text-[color:var(--warn)]">Inserisci prima un&apos;email valida e salva.</p>}
      {valid && state && (
        <p className="mt-2 text-xs font-medium text-txt" role="status">
          {state.kind === "sent" && <>Invitato · invito inviato il {fmtDate(state.at)}. In attesa che si registri.</>}
          {state.kind === "mail-failed" && <>Invitato · l&apos;email del {fmtDate(state.at)} non è partita: rimanda l&apos;invito o copia il link.</>}
          {state.kind === "not-sent" && <>Invito non ancora inviato.</>}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={btn} disabled={!valid || busy} onClick={() => void resend()}>{busy ? "Attendi…" : state?.kind === "not-sent" ? "Invia invito" : "Rimanda invito"}</button>
        {valid && state && state.kind !== "not-sent" && <button className={btn} disabled={busy} onClick={() => void cancel()}>Annulla invito</button>}
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
