"use client";

// Scheda utente → "Accesso a Xenora": un solo posto per dare un accesso vero a una persona.
//  1) Invita: abilita l'email e le manda il link di registrazione (sceglie LEI la password al primo accesso);
//  2) Condividi le strutture del profilo (l'invito di sempre, con le sue regole di sicurezza: l'email deve essere registrata);
//  3) Applica i permessi del profilo come permessi di co-gestore, dopo che ha accettato.
// Tutto passa dalle API esistenti (/api/admin/allowlist, /api/org/invite, /api/org/members): qui non c'è logica nuova lato server.
import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmProvider";
import { humanInviteError, isValidEmail, permsForMember, signupLink, structuresToShare } from "@/lib/user-access";
import type { User } from "@/lib/users";

type Line = { ok: boolean; text: string };
export interface UserAccessProps {
  user: User;
  structures: { id: string; name: string }[];
  onShared: (structureId: string, orgId: string) => void;
}

const bearer = async () => (await supabase?.auth.getSession())?.data.session?.access_token || "";
const btn = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash disabled:opacity-50";
const btnMain = "rounded-lg bg-focus px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50";

export default function UserAccessCard({ user, structures, onShared }: UserAccessProps) {
  const ask = useConfirm();
  const email = user.email.trim().toLowerCase();
  const valid = isValidEmail(email);
  const targets = structuresToShare(structures, user);
  const [busy, setBusy] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [link, setLink] = useState("");

  const call = async (path: string, body: unknown) => {
    const token = await bearer();
    if (!token) return { status: 401, j: { error: "unauthorized" } as Record<string, unknown> };
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, j: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const done = (ls: Line[]) => { setLines(ls); setBusy(""); };

  // 1) Invito: l'email entra tra gli accessi e riceve il link di registrazione.
  const invite = async () => {
    if (!valid) return;
    setBusy("invite"); setLines([]);
    try {
      const { status, j } = await call("/api/admin/allowlist", { email, note: `Utente: ${user.firstName} ${user.lastName}`.trim(), kind: "collaboratore", profile: { id: user.id, firstName: user.firstName, lastName: user.lastName, username: user.username, phone: user.phone, language: user.language, avatarColor: user.avatarColor, templateKey: user.templateKey, perms: user.perms, allStructures: user.allStructures, structureIds: user.structureIds } });
      if (status === 403) { done([{ ok: false, text: "Solo il titolare dell'account può invitare nuovi utenti." }]); return; }
      if (!j.ok) { done([{ ok: false, text: humanInviteError(String(j.error ?? ""), String(j.message ?? "")) }]); return; }
      setLink(signupLink(window.location.origin, email));
      const head: Line = j.notified
        ? { ok: true, text: `Invito inviato a ${email}: riceve un'email con il link per registrarsi e scegliere la password.` }
        : { ok: true, text: `${email} è abilitata, ma l'email non è partita (invio email non attivo). Copia il link qui sotto e mandaglielo tu.` };
      // Stesso passaggio: le strutture del profilo restano pronte per lei, al primo accesso le trova già.
      const out: Line[] = [head];
      for (const s of targets) {
        try {
          const { j: sj } = await call("/api/org/invite", { structureId: s.id, email, silent: true });
          if (sj.ok) { if (sj.orgId) onShared(s.id, String(sj.orgId)); out.push({ ok: true, text: `${s.name}: condivisa, la trova al primo accesso.` }); }
          else out.push({ ok: false, text: `${s.name}: ${humanInviteError(String(sj.error ?? ""), String(sj.message ?? ""))}` });
        } catch { out.push({ ok: false, text: `${s.name}: rete non disponibile.` }); }
      }
      done(out);
    } catch { done([{ ok: false, text: "Rete non disponibile." }]); }
  };

  // 2) Condivisione delle strutture del profilo.
  const share = async () => {
    if (!valid || !targets.length) return;
    const names = targets.map((s) => s.name).join(", ");
    if (!(await ask({ title: "Condividere le strutture?", message: `Invito ${email} a co-gestire: ${names}. La prima volta che una struttura viene condivisa passa nell'organizzazione condivisa (come è già successo per le altre). Per essere invitata deve essersi già registrata.`, confirmLabel: "Condividi" }))) return;
    setBusy("share"); setLines([]);
    const out: Line[] = [];
    for (const s of targets) {
      try {
        const { j } = await call("/api/org/invite", { structureId: s.id, email, silent: true });
        if (j.ok) { if (j.orgId) onShared(s.id, String(j.orgId)); out.push({ ok: true, text: `${s.name}: invito inviato.` }); }
        else out.push({ ok: false, text: `${s.name}: ${humanInviteError(String(j.error ?? ""), String(j.message ?? ""))}` });
      } catch { out.push({ ok: false, text: `${s.name}: rete non disponibile.` }); }
    }
    done(out);
  };

  // 3) Permessi del profilo applicati come permessi di co-gestore (serve che abbia già accettato l'invito).
  const applyPerms = async () => {
    if (!valid || !targets.length) return;
    setBusy("perms"); setLines([]);
    const perms = permsForMember(user.perms);
    const out: Line[] = [];
    for (const s of targets) {
      try {
        const token = await bearer();
        const r = await fetch(`/api/org/members?structureId=${encodeURIComponent(s.id)}`, { headers: { Authorization: `Bearer ${token}` } });
        const j = (await r.json().catch(() => ({}))) as { members?: { userId: string; email: string }[] };
        const m = (j.members ?? []).find((x) => (x.email || "").toLowerCase() === email);
        if (!m) { out.push({ ok: false, text: `${s.name}: non ha ancora accettato l'invito.` }); continue; }
        const { status } = await call("/api/org/members", { structureId: s.id, userId: m.userId, permissions: perms });
        out.push({ ok: status < 300, text: status < 300 ? `${s.name}: permessi applicati.` : `${s.name}: permessi non applicati.` });
      } catch { out.push({ ok: false, text: `${s.name}: rete non disponibile.` }); }
    }
    done(out);
  };

  const copy = async () => { try { await navigator.clipboard.writeText(link); setLines((l) => [...l, { ok: true, text: "Link copiato." }]); } catch { /* niente */ } };

  return (
    <Card>
      <SectionTitle>Accesso a Xenora</SectionTitle>
      <p className="mt-1 text-xs text-dim">
        Con <b className="text-txt">Invita</b> riceve l&apos;email con il link di registrazione e <b className="text-txt">sceglie lei la password</b>; le strutture del profilo le trova già al primo accesso, senza altri passaggi.
        Quando è entrata, <b className="text-txt">Applica i permessi</b> imposta i permessi del profilo sulle strutture.
      </p>
      {!valid && <p className="mt-2 text-xs font-medium text-[color:var(--warn)]">Inserisci prima un&apos;email valida e salva.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={btnMain} disabled={!valid || !!busy} onClick={() => void invite()}>{busy === "invite" ? "Invio…" : targets.length ? `Invita e condividi (${targets.length})` : "Invita"}</button>
        <button className={btn} disabled={!valid || !!busy || !targets.length} onClick={() => void applyPerms()}>{busy === "perms" ? "Applico…" : "Applica i permessi"}</button>
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
