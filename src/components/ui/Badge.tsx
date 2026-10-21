import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

// Pillola di stato unica (Xenora DS 1): testo SEMPRE visibile (mai solo colore), corpo >= 11 px.
//  - tone: ok (verde = completato/pagato), warn (ambra = attenzione/in scadenza), err (rosso = errore/scaduto/annullato),
//    info (blu = informativo/selezionato), neutral (grigio = neutro/non attivo). Il rosso NON è una categoria: solo problemi.
//  - size: sm = 11 px (default, nelle tabelle), md = 12 px.
//  - dot: pallino colorato prima del testo (aiuta chi non distingue i colori; usalo quando la stessa colonna ha più stati).
// Uso:
//   <Badge tone="ok">Saldato</Badge>   <Badge tone="warn" dot>Da incassare</Badge>   <Badge size="md">12 notti</Badge>
export type BadgeTone = "ok" | "warn" | "err" | "info" | "neutral";
export type BadgeSize = "sm" | "md";

const TONE: Record<BadgeTone, string> = {
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  err: "bg-err/15 text-err",
  info: "bg-focus/15 text-focus",
  neutral: "bg-wash text-dim",
};
const DOT: Record<BadgeTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  info: "bg-focus",
  neutral: "bg-dim",
};
const SIZE: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-[11px] leading-4",
  md: "px-2.5 py-1 text-xs leading-4",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
  children: ReactNode;
}

export function Badge({ tone = "neutral", size = "sm", dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold", TONE[tone], SIZE[size], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}
