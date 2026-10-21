"use client";

// Mattoncini della Dashboard: pochi, sobri, solo token del prodotto (nessuna palette propria, nessun gradiente, nessuna animazione decorativa).
// Un solo livello di bordo: il riquadro (Panel) ha il bordo, le righe dentro sono separate da linee sottili.
import { useId, type ReactNode } from "react";
import Link from "next/link";

export type Tone = "ok" | "warn" | "err" | "dim" | "focus";

/** Colore del testo per tono. Il rosso vale SOLO errore/ritardo. */
export const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", err: "text-err", dim: "text-dim", focus: "text-focus" };
const TONE_BG: Record<Tone, string> = { ok: "bg-ok/12", warn: "bg-warn/12", err: "bg-err/12", dim: "bg-wash", focus: "bg-focus/12" };

/** Etichetta di stato: il significato sta sempre nel testo, il colore lo rinforza soltanto. */
export function Chip({ tone = "dim", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex max-w-full shrink-0 items-center truncate rounded-[var(--r-sm)] px-1.5 py-0.5 text-xs font-medium leading-4 ${TONE_BG[tone]} ${TONE_TEXT[tone]}`}>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Riquadro della Dashboard: titolo h2 collegato alla sezione, contatore e azione a destra. Nessuna ombra, nessun effetto al passaggio. */
export function Panel({ title, count, right, children, className = "", id }: { title: string; count?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const hid = useId();
  return (
    <section id={id} aria-labelledby={hid} className={`min-w-0 rounded-[var(--r-lg)] border border-line bg-surface ${className}`}>
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={hid} className="truncate text-sm font-semibold text-txt">{title}</h2>
          {count !== undefined && count !== null && <span className="rounded-[var(--r-sm)] bg-wash px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-dim">{count}</span>}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2 text-xs text-dim">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** Collegamento discreto di intestazione («Statistiche», «Gestisci»…): bersaglio da 40 px sul telefono. */
export function HeadLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex items-center rounded-[var(--r-md)] px-1.5 py-1 text-xs font-medium text-focus hover:bg-wash max-sm:min-h-10 max-sm:px-2.5">{children}</Link>;
}

/** Scheletro di caricamento a dimensione fissa (nessun salto di layout). Si ferma con prefers-reduced-motion. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block rounded bg-wash motion-safe:animate-pulse ${className}`} />;
}

/** Riga vuota di un elenco: testo breve, senza decorazioni. */
export function EmptyRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm text-dim">
      <span>{children}</span>
      {action}
    </div>
  );
}

/** Pulsante piccolo (stile secondario): stessa altezza ovunque, 40 px sul telefono. */
export const BTN_SM = "inline-flex min-h-8 items-center justify-center gap-1 rounded-[var(--r-md)] border border-line-strong bg-surface px-2.5 text-xs font-medium text-txt hover:bg-wash max-sm:min-h-10 max-sm:px-3";
