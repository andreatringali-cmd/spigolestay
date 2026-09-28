import type { ReactNode } from "react";
import Link from "next/link";

// Guscio comune per le pagine legali pubbliche (privacy, cookie, termini).
// Tema chiaro, leggibile, coerente con il login. Include l'avviso "bozza".
export default function LegalShell({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[#1f1b16]">
      <header className="border-b border-[#eceae4]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/login" className="text-sm font-bold tracking-tight">Xenora</Link>
          <Link href="/login" className="text-[13px] text-[#2f6bb0] hover:underline">← Torna all&apos;accesso</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {updated && <p className="mt-1 text-[13px] text-[#9a9186]">Ultimo aggiornamento: {updated}</p>}

        <div className="mt-4 rounded-lg border border-[#e6cfa2] bg-[#fbf3e2] px-4 py-3 text-[13px] text-[#8a6d1f]">
          ⚠ Bozza in fase di revisione legale. Alcuni dati (ragione sociale, P.IVA, sede) sono da completare.
        </div>

        <div className="legal-body mt-8 text-[15px] leading-relaxed text-[#3a3630]">
          {children}
        </div>

        <p className="mt-12 border-t border-[#eceae4] pt-6 text-[12px] text-[#9a9186]">© {new Date().getFullYear()} Xenora Digital Solutions · <a href="https://xenoradigitalsolutions.com" className="hover:underline">xenoradigitalsolutions.com</a></p>
      </main>

      <style>{`
        .legal-body h2{font-size:18px;font-weight:700;color:#1f1b16;margin:28px 0 8px}
        .legal-body p{margin:0 0 12px}
        .legal-body ul{margin:0 0 12px;padding-left:20px;list-style:disc}
        .legal-body li{margin:4px 0}
        .legal-body a{color:#2f6bb0}
        .legal-body a:hover{text-decoration:underline}
      `}</style>
    </div>
  );
}
