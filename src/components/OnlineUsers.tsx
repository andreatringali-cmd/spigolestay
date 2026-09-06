"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useAccess } from "@/lib/access";

// Utenti online (dimostrativo: in produzione arriverà dalla presenza reale).
// Deriva dagli utenti reali dell'account: dopo l'onboarding c'è solo il titolare.
const initials = (n: string) => n.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
const AVATAR = ["var(--focus)", "#0891B2", "#DB2777", "#2F9E6F", "#C08A3A"];

export default function OnlineUsers() {
  const { t } = useLang();
  const { users, user } = useAccess();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const online = (users || [])
    .filter((u) => u.active !== false)
    .map((u) => ({
      id: u.id,
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.username || t("Utente"),
      role: u.id === user?.id ? t("Titolare") : (u.templateKey && u.templateKey !== "none" ? u.templateKey : t("Utente")),
      you: u.id === user?.id,
      photo: u.photo,
    }));

  if (online.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title={t("Utenti online")} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 transition hover:bg-wash">
        <div className="flex -space-x-2">
          {online.slice(0, 3).map((u, i) => (
            <span key={u.id} className="grid h-6 w-6 place-items-center overflow-hidden rounded-full border-2 border-surface text-[10px] font-bold text-white" style={{ backgroundColor: AVATAR[i % AVATAR.length] }}>{u.photo ? <img src={u.photo} alt="" className="h-full w-full object-cover" /> : initials(u.name)}</span>
          ))}
        </div>
        <span className="hidden items-center gap-1 text-xs font-medium text-dim sm:flex">
          <span className="h-2 w-2 rounded-full bg-[color:var(--ok)]" />{online.length} {t("online")}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-xl border border-line bg-surface p-2 shadow-xl">
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-faint">{t("Online adesso")} · {online.length}</div>
          {online.map((u, i) => (
            <div key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
              <span className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: AVATAR[i % AVATAR.length] }}>
                {u.photo ? <img src={u.photo} alt="" className="h-full w-full object-cover" /> : initials(u.name)}
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-[color:var(--ok)]" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-txt">{u.name}{u.you && <span className="ml-1 text-[10px] text-faint">{t("(tu)")}</span>}</div>
                <div className="text-[11px] text-dim">{u.role}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
