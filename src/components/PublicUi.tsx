import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

// Identità visiva UNICA delle pagine di accesso (login, invito, accetta-invito, 404, pagine legali) e dell'onboarding.
// Solo token del prodotto (--paper, --surface, --line, --txt, --dim, --focus, --err, --warn, --ok): niente hex.
// Niente "use client": serve sia ai componenti server (404, legali) sia a quelli client (login, wizard).

/** Regola password: minimo 8 caratteri (scritta una volta sola). */
export const PASSWORD_MIN = 8;
export const PASSWORD_RULE = `Almeno ${PASSWORD_MIN} caratteri, meglio con lettere e numeri.`;

// Testo sul pulsante primario: text-on-focus (bianco in chiaro, quasi-nero in tema scuro, token di globals.css).
const ON_FOCUS = "text-on-focus";
const RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const PUB = {
  // Fondo pagina e scheda (stesso linguaggio delle card dell'app: rounded-xl, bordo line, ombra leggera)
  page: "min-h-dvh bg-paper text-txt",
  card: "w-full rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8",
  // Tipografia: titolo pagina 24 px Archivo, testo 14 px, aiuti 12 px in dim (mai faint per testo informativo)
  h1: "font-display text-2xl font-bold tracking-tight text-txt",
  lead: "mt-1 text-sm text-dim",
  hint: "mt-1 block text-xs text-dim",
  label: "mb-1 block text-xs font-medium text-dim",
  // Campo: 16 px su telefono (niente zoom di iOS), 14 px da tablet in su; anello di focus visibile
  field: `h-10 w-full rounded-lg border border-line bg-paper px-3 text-base text-txt outline-none placeholder:text-faint focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30 disabled:opacity-50 sm:h-9 sm:text-sm`,
  // Pulsanti: stessa altezza e raggio ovunque (h-10 su telefono, h-9 da tablet in su; rounded-lg)
  btn: `inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition sm:h-9 disabled:cursor-not-allowed disabled:opacity-50 ${RING}`,
  btnPrimary: `inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-focus px-4 text-sm font-semibold ${ON_FOCUS} shadow-sm transition hover:opacity-90 sm:h-9 disabled:cursor-not-allowed disabled:opacity-50 ${RING}`,
  btnSecondary: `inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-txt transition hover:bg-wash sm:h-9 disabled:cursor-not-allowed disabled:opacity-50 ${RING}`,
  link: `font-semibold text-focus underline-offset-2 hover:underline ${RING} rounded-sm`,
  linkSubtle: `text-dim underline-offset-2 hover:text-txt hover:underline ${RING} rounded-sm`,
} as const;

type NoticeKind = "err" | "info" | "warn" | "ok";
const NOTICE_COLOR: Record<NoticeKind, string> = { err: "var(--err)", warn: "var(--warn)", ok: "var(--ok)", info: "var(--focus)" };

// Avviso: bordo e fondo in tinta dello stato, testo sempre --txt (contrasto pieno) + icona + etichetta nascosta:
// il significato non dipende dal solo colore. Gli errori sono annunciati dai lettori di schermo (role="alert").
export function Notice({ kind = "info", children, className = "" }: { kind?: NoticeKind; children: ReactNode; className?: string }) {
  const c = NOTICE_COLOR[kind];
  const label = kind === "err" ? "Errore" : kind === "warn" ? "Attenzione" : kind === "ok" ? "Fatto" : "Informazione";
  return (
    <div
      role={kind === "err" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-txt ${className}`}
      style={{ borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${c} 10%, transparent)` }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0">
        {kind === "ok" ? <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>
          : kind === "info" ? <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>
          : <><path d="M12 3l10 18H2z" /><path d="M12 10v5" /><path d="M12 18h.01" /></>}
      </svg>
      <span className="sr-only">{label}: </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Marchio: farfalla + nome in Archivo (funziona in chiaro e scuro, a differenza del logo orizzontale con testo nero).
export function BrandLockup({ size = "md", href }: { size?: "sm" | "md"; href?: string }) {
  const px = size === "sm" ? 28 : 40;
  const inner = (
    <>
      <Image src="/xenora-mark.png" alt="" width={px} height={px} priority className="shrink-0 object-contain" style={{ width: px, height: px }} />
      <span className={`font-display font-bold tracking-tight text-txt ${size === "sm" ? "text-lg" : "text-2xl"}`}>Xenora</span>
    </>
  );
  return href
    ? <Link href={href} aria-label="Xenora" className={`inline-flex items-center gap-2.5 rounded-md ${RING}`}>{inner}</Link>
    : <div className="inline-flex items-center gap-2.5">{inner}</div>;
}

// Schermata di stato a tutta pagina (pagina non trovata, link non valido…): marchio, titolo, spiegazione, una sola azione.
export function StatusScreen({ title, text, action }: { title: string; text: string; action?: { href: string; label: string } }) {
  return (
    <div className={`${PUB.page} flex items-center justify-center px-4 py-10`}>
      <main className={`${PUB.card} max-w-md text-center`}>
        <div className="mb-5 flex justify-center"><BrandLockup /></div>
        <h1 className={PUB.h1}>{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-dim">{text}</p>
        {action && <Link href={action.href} className={`${PUB.btnPrimary} mt-6`}>{action.label}</Link>}
      </main>
    </div>
  );
}
