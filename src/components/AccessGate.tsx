"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { NAV } from "./nav";
import { useAccess } from "@/lib/access";

// Protegge le pagine: se l'utente non ha il permesso o il modulo è spento, mostra un avviso.
export default function AccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { can, moduleOn, user } = useAccess();
  const item = NAV.filter((n) => n.href !== "/" && pathname.startsWith(n.href)).sort((a, b) => b.href.length - a.href.length)[0];

  if (item && user) {
    const moduleOff = !moduleOn(item.module);
    const noPerm = !can(item.perm);
    if (moduleOff || noPerm) {
      return (
        <div className="mx-auto mt-16 max-w-md text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-wash text-dim">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          </div>
          <h1 className="font-display text-xl font-bold text-txt">{moduleOff ? "Modulo non attivo" : "Accesso non consentito"}</h1>
          <p className="mt-2 text-sm text-dim">
            {moduleOff
              ? <>La sezione «{item.label}» fa parte di un modulo non incluso nel tuo piano. Attivalo dall'<Link href="/abbonamento" className="font-medium text-focus hover:underline">Abbonamento</Link>.</>
              : <>Il tuo profilo non ha i permessi per «{item.label}». Chiedi a un amministratore di abilitarti dalla sezione Utenti.</>}
          </p>
          <Link href="/" className="mt-5 inline-block rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Torna alla Dashboard</Link>
        </div>
      );
    }
  }
  return <>{children}</>;
}
