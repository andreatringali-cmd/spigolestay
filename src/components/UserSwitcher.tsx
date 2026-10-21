"use client";

import { useRef, useState } from "react";
import { useAccess } from "@/lib/access";
import { PERM_TEMPLATES, initials } from "@/lib/users";
import { playSound } from "@/lib/sound";
import { useAuth } from "@/lib/authsync";
import Popover from "./Popover";

import { onSolid } from "@/lib/on-solid";
const roleLabel = (k: string) => (k === "custom" ? "Personalizzato" : PERM_TEMPLATES.find((t) => t.key === k)?.label ?? "—");

// Utente "collegato": in produzione arriva dall'autenticazione. Qui puoi cambiarlo per provare i ruoli.
export default function UserSwitcher({ sidebar, collapsed }: { sidebar?: boolean; collapsed?: boolean }) {
  const { user } = useAccess();
  const { enabled: authEnabled, signOut, user: authUser } = useAuth();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  if (!user) return null;

  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((o) => !o)} className={`flex items-center gap-2 rounded-lg border border-line hover:bg-wash ${sidebar ? `w-full ${collapsed ? "justify-center px-1.5 py-1.5" : "px-2 py-1.5"}` : "px-2 py-1"}`} title="Utente collegato">
        <span className={`grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full text-[11px] font-bold ${onSolid(user.avatarColor)}`} style={{ backgroundColor: user.avatarColor }}>{user.photo ? <img src={user.photo} alt="" className="h-full w-full object-cover" /> : initials(user.firstName, user.lastName)}</span>
        {!(sidebar && collapsed) && <span className={`text-left leading-tight ${sidebar ? "block min-w-0 flex-1" : "hidden sm:block"}`}><span className="block truncate text-xs font-semibold text-txt">{user.firstName} {user.lastName}</span><span className="block text-[11px] text-faint">{roleLabel(user.templateKey)}</span></span>}
      </button>
      {/* Nella barra laterale (in basso) la tendina si apre sopra il pulsante da sola, se sotto non c'è spazio. */}
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)} align={sidebar ? "start" : "end"} width={256} label="Utente collegato">
          <div className="flex items-center gap-2 px-2 py-2">
            <span className={`grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold ${onSolid(user.avatarColor)}`} style={{ backgroundColor: user.avatarColor }}>{user.photo ? <img src={user.photo} alt="" className="h-full w-full object-cover" /> : initials(user.firstName, user.lastName)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-txt">{user.firstName} {user.lastName}</span>
              <span className="block text-[11px] text-dim">{roleLabel(user.templateKey)}</span>
            </span>
          </div>
          {authEnabled && (
            <div className="border-t border-line pt-1">
              {authUser?.email && <div className="px-2 pb-1 pt-0.5 text-[11px] text-faint truncate" title={authUser.email}>Account: {authUser.email}</div>}
              <button onClick={() => { setOpen(false); playSound("logout"); void signOut(); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-[color:var(--bad)] hover:bg-wash">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                Esci
              </button>
            </div>
          )}
      </Popover>
    </div>
  );
}
