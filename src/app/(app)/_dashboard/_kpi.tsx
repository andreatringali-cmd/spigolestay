"use client";

// Riga di indicatori operativi: etichetta breve, numero grande, una riga di dettaglio. Ogni indicatore è un vero collegamento alla pagina giusta.
import Link from "next/link";
import { Skeleton, TONE_TEXT, type Tone } from "./_kit";

export interface KpiItem {
  key: string;
  label: string;
  value: string;
  sub: string;
  href: string;
  /** tono del numero (rosso solo per ritardi/errori); assente = testo normale */
  tone?: Tone;
  /** dato ancora in arrivo: si mostra uno scheletro della stessa dimensione */
  loading?: boolean;
  /** valore lungo (importi): corpo del numero leggermente più piccolo per non andare a capo */
  long?: boolean;
}

export default function Kpis({ items }: { items: KpiItem[] }) {
  return (
    <section aria-labelledby="dash-kpi">
      <h2 id="dash-kpi" className="sr-only">Indicatori di oggi</h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((k) => (
          <li key={k.key} className="min-w-0">
            <Link
              href={k.href}
              aria-label={k.loading ? `${k.label}: in caricamento` : `${k.label}: ${k.value}. ${k.sub}`}
              className="flex min-h-[76px] flex-col justify-between gap-1 rounded-[var(--r-lg)] border border-line bg-surface px-3 py-2.5 hover:bg-wash"
            >
              <span className="truncate text-xs font-medium text-dim">{k.label}</span>
              {k.loading ? <Skeleton className="h-7 w-16" /> : (
                <span className={`truncate font-display font-bold leading-none tabular-nums ${k.long ? "text-[clamp(1.25rem,1.7vw,1.5rem)]" : "text-2xl"} ${k.tone ? TONE_TEXT[k.tone] : "text-txt"}`}>{k.value}</span>
              )}
              {k.loading ? <Skeleton className="h-4 w-24" /> : <span className="truncate text-xs text-dim">{k.sub}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
