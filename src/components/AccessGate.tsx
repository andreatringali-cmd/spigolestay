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
    // Permesso utente mancante → blocco secco (non è una questione di piano).
    if (noPerm) {
      return (
        <div className="mx-auto mt-16 max-w-md text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-wash text-dim">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          </div>
          <h1 className="font-display text-xl font-bold text-txt">Accesso non consentito</h1>
          <p className="mt-2 text-sm text-dim">Il tuo profilo non ha i permessi per «{item.label}». Chiedi a un amministratore di abilitarti dalla sezione Utenti.</p>
          <Link href="/" className="mt-5 inline-block rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Torna alla Dashboard</Link>
        </div>
      );
    }
    // Sezione non inclusa nel piano → ANTEPRIMA (contenuto reale sfocato) + finestra piani sopra,
    // così l'utente vede in cosa consiste la pagina ed è invogliato ad abbonarsi.
    if (moduleOff) {
      return (
        <div className="relative min-h-[70vh]">
          <div className="pointer-events-none select-none blur-[3px] opacity-40" aria-hidden="true">{children}</div>
          <div className="absolute inset-0 z-20 flex items-start justify-center px-4 pt-16 sm:pt-24">
            <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-2xl">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              </div>
              <h1 className="font-display text-xl font-bold text-txt">«{item.label}» è nel piano superiore</h1>
              <p className="mt-2 text-sm text-dim">Questa è un&apos;anteprima della sezione. Attiva il piano che la include per usarla davvero.</p>
              <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
                <Link href="/abbonamento" className="w-full rounded-lg bg-focus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:w-auto">Vedi i piani</Link>
                <Link href="/" className="w-full rounded-lg border border-line px-4 py-2 text-sm font-medium text-dim hover:bg-wash sm:w-auto">Torna alla Dashboard</Link>
              </div>
            </div>
          </div>
        </div>
      );
    }
  }
  return <>{children}</>;
}
