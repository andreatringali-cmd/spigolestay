"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { loadUsers, PERM_TEMPLATES, initials, type User } from "@/lib/users";
import { useLang } from "@/lib/i18n";

export default function UtentiPage() {
  const router = useRouter();
  const { t } = useLang();
  const { structures } = useData();
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => { setUsers(loadUsers()); }, []);

  const templateLabel = (k: string) => (k === "custom" ? t("Personalizzato") : t(PERM_TEMPLATES.find((t) => t.key === k)?.label ?? "—"));
  const structLabel = (u: User) => (u.allStructures ? t("Tutte le strutture") : u.structureIds.length ? u.structureIds.map((id) => structures.find((s) => s.id === id)?.name).filter(Boolean).join(", ") : t("Nessuna"));

  return (
    <div>
      <PageHeader
        title={t("Utenti")}
        subtitle={t("Chi accede al gestionale e con quali permessi")}
        actions={<button onClick={() => router.push("/utenti/nuovo")} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90">+ {t("Nuovo utente")}</button>}
      />

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-3 py-2 font-semibold">{t("Utente")}</th>
              <th className="px-3 py-2 font-semibold">{t("Username")}</th>
              <th className="px-3 py-2 font-semibold">{t("Email")}</th>
              <th className="px-3 py-2 font-semibold">{t("Telefono")}</th>
              <th className="px-3 py-2 font-semibold">{t("Modello permessi")}</th>
              <th className="px-3 py-2 font-semibold">{t("Strutture")}</th>
              <th className="px-3 py-2 font-semibold">{t("Ultimo accesso")}</th>
              <th className="px-3 py-2 font-semibold">{t("Stato")}</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} onClick={() => router.push(`/utenti/${u.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-wash">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold text-white" style={{ backgroundColor: u.avatarColor }}>{u.photo ? <img src={u.photo} alt="" className="h-full w-full object-cover" /> : initials(u.firstName, u.lastName)}</div>
                    <div>
                      <div className="font-medium text-txt">{u.firstName} {u.lastName}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-dim">{u.username}</td>
                <td className="px-3 py-2.5 text-xs text-dim">{u.email || <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-xs text-dim">{u.phone || <span className="text-faint">—</span>}</td>
                <td className="px-3 py-2.5"><span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-dim">{templateLabel(u.templateKey)}</span></td>
                <td className="px-3 py-2.5 max-w-[220px] truncate text-xs text-dim" title={structLabel(u)}>{structLabel(u)}</td>
                <td className="px-3 py-2.5 text-xs text-dim">{u.lastLogin ? new Date(u.lastLogin.at).toLocaleDateString("it-IT") : <span className="text-faint">{t("Mai")}</span>}</td>
                <td className="px-3 py-2.5">
                  <span className="flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${u.active ? "var(--ok)" : "var(--faint)"} 18%, transparent)`, color: u.active ? "var(--ok)" : "var(--dim)" }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: u.active ? "var(--ok)" : "var(--faint)" }} />{u.active ? t("Attivo") : t("Disattivo")}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right"><span className="text-faint">›</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-faint">{t("Clicca una riga per aprire la scheda completa (account, 2FA, strutture, permessi granulari). In produzione l'accesso è applicato lato server e la foto è caricabile.")}</p>
    </div>
  );
}
