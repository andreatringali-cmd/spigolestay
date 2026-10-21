import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLockup, PUB } from "./PublicUi";
import PublicTheme from "./PublicTheme";
import PublicThemeBoot from "./PublicThemeBoot";

// Guscio comune per le pagine legali pubbliche (privacy, cookie, termini).
// Stessa identità di login e app (token del prodotto, chiaro/scuro). L'avviso "bozza" resta finché non c'è il testo definitivo.
export default function LegalShell({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <div className={PUB.page}>
      <PublicThemeBoot />
      <PublicTheme />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <BrandLockup size="sm" href="/login" />
          <Link href="/login" className={`${PUB.link} py-2 text-sm`}>Torna all&apos;accesso</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className={PUB.h1}>{title}</h1>
        {updated && <p className="mt-1 text-xs text-dim">Ultimo aggiornamento: {updated}</p>}

        {/* Avviso discreto: resta finché il testo non è definitivo (ragione sociale, P.IVA, sede da completare) */}
        <p role="note" className="mt-4 flex items-start gap-2 border-l-2 py-0.5 pl-3 text-xs text-dim" style={{ borderColor: "var(--warn)" }}>
          <span className="shrink-0 rounded-full border border-line bg-wash px-2 py-0.5 text-[11px] font-semibold text-txt">Bozza</span>
          <span>In fase di revisione legale. Alcuni dati (ragione sociale, P.IVA, sede) sono da completare.</span>
        </p>

        <div className="legal-body mt-8 text-sm leading-relaxed text-txt sm:text-[15px]">
          {children}
        </div>

        <footer className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-xs text-dim sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Xenora Digital Solutions · <a href="https://xenoradigitalsolutions.com" className={PUB.linkSubtle}>xenoradigitalsolutions.com</a></span>
          <nav aria-label="Documenti legali" className="flex flex-wrap gap-x-4">
            <Link href="/termini" className={`${PUB.linkSubtle} py-2`}>Termini</Link>
            <Link href="/privacy" className={`${PUB.linkSubtle} py-2`}>Privacy</Link>
            <Link href="/cookie" className={`${PUB.linkSubtle} py-2`}>Cookie</Link>
          </nav>
        </footer>
      </main>

      <style>{`
        .legal-body h2{font-family:var(--font-archivo),system-ui,sans-serif;font-size:18px;font-weight:700;color:var(--txt);margin:28px 0 8px}
        .legal-body p{margin:0 0 12px}
        .legal-body ul{margin:0 0 12px;padding-left:20px;list-style:disc}
        .legal-body li{margin:4px 0}
        .legal-body a{color:var(--focus);text-decoration:underline;text-underline-offset:2px}
        .legal-body a:hover{text-decoration-thickness:2px}
      `}</style>
    </div>
  );
}
