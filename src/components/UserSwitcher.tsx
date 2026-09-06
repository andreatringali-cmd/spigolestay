"use client";

import { useEffect, useRef, useState } from "react";
import { useAccess } from "@/lib/access";
import { PERM_TEMPLATES, initials } from "@/lib/users";
import { playSound } from "@/lib/sound";

const roleLabel = (k: string) => (k === "custom" ? "Personalizzato" : PERM_TEMPLATES.find((t) => t.key === k)?.label ?? "—");

// Utente "collegato": in produzione arriva dall'autenticazione. Qui puoi cambiarlo per provare i ruoli.
export default function UserSwitcher({ sidebar, collapsed }: { sidebar?: boolean; collapsed?: boolean }) {
  const { user, users, setUserId } = useAccess();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={`flex items-center gap-2 rounded-lg border border-line hover:bg-wash ${sidebar ? `w-full ${collapsed ? "justify-center px-1.5 py-1.5" : "px-2 py-1.5"}` : "px-2 py-1"}`} title="Utente collegato">
        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: user.avatarColor }}>{user.photo ? <img src={user.photo} alt="" className="h-full w-full object-cover" /> : initials(user.firstName, user.lastName)}</span>
        {!(sidebar && collapsed) && <span className={`text-left leading-tight ${sidebar ? "block min-w-0 flex-1" : "hidden sm:block"}`}><span className="block truncate text-xs font-semibold text-txt">{user.firstName} {user.lastName}</span><span className="block text-[10px] text-faint">{roleLabel(user.templateKey)}</span></span>}
      </button>
      {open && (
        <div className={`absolute z-40 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-xl ${sidebar ? "bottom-full left-0 mb-1 w-64 max-w-[calc(100vw-2rem)]" : "right-0 top-full mt-1 w-64"}`}>
          <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Collegato come (prova ruoli)</div>
          {users.map((u) => (
            <button key={u.id} onClick={() => { const isSame = u.id === user.id; setUserId(u.id); setOpen(false); playSound(isSame ? "logout" : "login"); }} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${u.id === user.id ? "bg-wash" : "hover:bg-wash"}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold text-white" style={{ backgroundColor: u.avatarColor }}>{u.photo ? <img src={u.photo} alt="" className="h-full w-full object-cover" /> : initials(u.firstName, u.lastName)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-txt">{u.firstName} {u.lastName}</span><span className="block text-[11px] text-dim">{roleLabel(u.templateKey)}</span></span>
              {u.id === user.id && <span className="text-focus">✓</span>}
            </button>
          ))}
          <div className="border-t border-line px-2 py-1.5 text-[10px] text-faint">In produzione l'utente arriva dal login. Il menu e le pagine si adattano ai suoi permessi e ai moduli attivi.</div>
        </div>
      )}
    </div>
  );
}
