"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { PageHeader, Button } from "@/components/ui";
import { loadUsers, PERM_TEMPLATES, initials, userHasStructure, type User } from "@/lib/users";
import { useLang } from "@/lib/i18n";
import { useAccess } from "@/lib/access";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/dates";
import { keyActivate } from "@/lib/a11y";
import { useAuth } from "@/lib/authsync";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { cancelInvite, fetchInviteDates, markInvited, runInvite } from "@/lib/invite-client";
import { inviteStateOf, type InviteState } from "@/lib/user-access";

export default function UtentiPage() {
  const router = useRouter();
  const { t } = useLang();
  const { allStructures: structures, activeStructureId } = useData(); // tutte le strutture, non solo quelle selezionate in alto
  const { moduleOn, level } = useAccess();
  const { user: authUser } = useAuth();
  const toast = useToast();
  const ask = useConfirm();
  const canInvite = level("utenti") === "edit"; // «Rimanda» e «Annulla» solo a chi gestisce gli utenti
  const [busyId, setBusyId] = useState("");
  const [inviteDates, setInviteDates] = useState<Record<string, string>>({}); // inviti già presenti sul server, per email
  const canMulti = moduleOn("team"); // il multiutente è nei piani superiori
  const [users, setUsers] = useState<User[]>([]);
  const [lastSeen, setLastSeen] = useState<Record<string, string | null>>({}); // ultimo accesso reale (dall'autenticazione), per email
  // La scheda cambia in background (esito dell'invito appena creato): ricarica l'elenco.
  useEffect(() => {
    const h = () => setUsers(loadUsers());
    window.addEventListener("spigolestay:users", h);
    return () => window.removeEventListener("spigolestay:users", h);
  }, []);
  useEffect(() => { let off = false; void fetchInviteDates().then((d) => { if (!off) setInviteDates(d); }); return () => { off = true; }; }, []);
  useEffect(() => {
    const list = loadUsers();
    setUsers(list);
    const emails = list.map((u) => u.email.trim().toLowerCase()).filter((e) => /\S+@\S+/.test(e));
    if (!supabase || !emails.length) return;
    let cancelled = false;
    (async () => {
      try {
        const token = (await supabase!.auth.getSession())?.data.session?.access_token;
        if (!token) return;
        const r = await fetch("/api/access/last-seen", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ emails }) });
        const j = (await r.json().catch(() => ({}))) as { seen?: Record<string, string | null> };
        if (!cancelled && j.seen) setLastSeen(j.seen);
      } catch { /* resta quello del profilo */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const lastAccess = (u: User) => { const at = lastSeen[u.email.trim().toLowerCase()] || u.lastLogin?.at; return at ? fmtDate(at) : null; };

  const inviteOf = (u: User): InviteState | null => inviteStateOf(u, { selfEmail: authUser?.email ?? undefined, lastAccess: lastAccess(u), serverDates: inviteDates });
  const resend = async (u: User) => {
    setBusyId(u.id);
    try {
      const r = await runInvite(u, structures.map((x) => ({ id: x.id, name: x.name })));
      for (const w of r.warnings) toast(w, "error");
      if (!r.ok) { toast(r.message, "error"); return; }
      markInvited(u.id, { invitedAt: r.sentAt ?? new Date().toISOString(), ...(r.notified ? {} : { inviteMailFailed: true }) });
      toast(r.message, r.notified ? "success" : "error");
    } finally { setBusyId(""); }
  };
  const cancel = async (u: User) => {
    if (!(await ask({ title: t("Annulla invito"), message: `${t("Annullare l'invito a")} ${u.email}? ${t("Non potrà più registrarsi con questo invito; la scheda resta e potrai invitarla di nuovo.")}`, danger: true, confirmLabel: t("Annulla invito"), cancelLabel: t("Tieni l'invito") }))) return;
    setBusyId(u.id);
    try {
      const r = await cancelInvite(u.email);
      if (r.ok) { markInvited(u.id, null); setInviteDates((d) => { const n = { ...d }; delete n[u.email.trim().toLowerCase()]; return n; }); }
      toast(r.message, r.ok ? "success" : "error");
    } finally { setBusyId(""); }
  };

  const inviteLine = (i: InviteState) => (i.kind === "not-sent" ? t("Invito non ancora inviato") : i.kind === "mail-failed" ? `${t("Email non partita · invito del")} ${fmtDate(i.at)}` : `${t("Invito inviato il")} ${fmtDate(i.at)}`);
  const templateLabel = (k: string) => (k === "custom" ? t("Personalizzato") : t(PERM_TEMPLATES.find((t) => t.key === k)?.label ?? "—"));
  // Con una struttura selezionata: solo gli utenti che vi hanno accesso (chi ha accesso a tutte le strutture compare ovunque).
  const allIds = structures.map((s) => s.id);
  const shownUsers = users.filter((u) => userHasStructure(u, activeStructureId, allIds));
  const structLabel = (u: User) => (u.allStructures ? t("Tutte le strutture") : u.structureIds.length ? u.structureIds.map((id) => structures.find((s) => s.id === id)?.name).filter(Boolean).join(", ") || t("Nessuna") : t("Nessuna struttura scelta"));

  return (
    <div>
      <PageHeader
        title={t("Utenti")}
        subtitle={t("Chi accede al gestionale e con quali permessi")}
        actions={canMulti
          ? <Button size="sm" onClick={() => router.push("/utenti/nuovo")}>+ {t("Nuovo utente")}</Button>
          : <Button variant="secondary" size="sm" onClick={() => router.push("/abbonamento")} title={t("Il multiutente è incluso nei piani superiori")} className="flex"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg> {t("Aggiungi utente (piano superiore)")}</Button>}
      />

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[760px] text-sm max-sm:min-w-0">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-dim">
              <th className="px-3 py-2 font-semibold">{t("Utente")}</th>
              <th className="px-3 py-2 font-semibold max-sm:hidden">{t("Username")}</th>
              <th className="px-3 py-2 font-semibold max-sm:hidden">{t("Email")}</th>
              <th className="px-3 py-2 font-semibold max-sm:hidden">{t("Telefono")}</th>
              <th className="px-3 py-2 font-semibold max-sm:hidden">{t("Modello permessi")}</th>
              <th className="px-3 py-2 font-semibold max-sm:hidden">{t("Strutture")}</th>
              <th className="px-3 py-2 font-semibold max-sm:hidden">{t("Ultimo accesso")}</th>
              <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {shownUsers.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-dim">{t("Nessun utente ha accesso a questa struttura.")}</td></tr>}
            {shownUsers.map((u) => (
              <tr key={u.id} onClick={() => router.push(`/utenti/${u.id}`)} {...keyActivate(() => router.push(`/utenti/${u.id}`))} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold text-white" style={{ backgroundColor: u.avatarColor }}>{u.photo ? <img src={u.photo} alt="" className="h-full w-full object-cover" /> : initials(u.firstName, u.lastName)}</div>
                    <div>
                      <div className="font-medium text-txt">{u.firstName} {u.lastName}</div>
                      <div className="truncate text-[11px] text-faint sm:hidden">{templateLabel(u.templateKey)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-dim max-sm:hidden">{u.username}</td>
                <td className="px-3 py-2.5 text-xs text-dim max-sm:hidden">{u.email || <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-xs text-dim max-sm:hidden">{u.phone || <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5 max-sm:hidden"><span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-dim">{templateLabel(u.templateKey)}</span></td>
                <td className="px-3 py-2.5 max-w-[220px] truncate text-xs text-dim max-sm:hidden" title={structLabel(u)}>{structLabel(u)}</td>
                <td className="px-3 py-2.5 text-xs text-dim max-sm:hidden">{lastAccess(u) ?? (inviteOf(u) ? <span className="text-dim">{inviteLine(inviteOf(u)!)}</span> : <span className="text-faint">{t("Mai")}</span>)}</td>
                <td className="px-3 py-2.5">
                  {(() => {
                    const inv = u.active ? inviteOf(u) : null; // chi non è ancora entrato è «Invitato», non «Attivo»
                    const tone = inv ? "var(--warn)" : u.active ? "var(--ok)" : "var(--faint)";
                    return (
                      <>
                        <span className="flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${tone} 18%, transparent)`, color: inv ? "var(--warn)" : u.active ? "var(--ok)" : "var(--dim)" }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone }} />{inv ? (inv.kind === "not-sent" ? t("Invito non inviato") : t("Invitato")) : u.active ? t("Attivo") : t("Disattivo")}
                        </span>
                        {inv && <div className="mt-1 text-[11px] text-dim">{inviteLine(inv)}</div>}
                        {inv && canInvite && (
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <button type="button" disabled={busyId === u.id} onClick={(e) => { e.stopPropagation(); void resend(u); }} onKeyDown={(e) => e.stopPropagation()} className="text-[11px] font-semibold text-focus hover:underline disabled:opacity-50 max-sm:py-1.5">{busyId === u.id ? t("Attendi…") : inv.kind === "not-sent" ? t("Invia invito") : t("Rimanda invito")}</button>
                            {inv.kind !== "not-sent" && <button type="button" disabled={busyId === u.id} onClick={(e) => { e.stopPropagation(); void cancel(u); }} onKeyDown={(e) => e.stopPropagation()} className="text-[11px] font-semibold text-dim hover:text-[color:var(--err)] hover:underline disabled:opacity-50 max-sm:py-1.5">{t("Annulla invito")}</button>}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </td>
                <td className="px-3 py-2.5 text-right"><span className="text-faint">›</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
