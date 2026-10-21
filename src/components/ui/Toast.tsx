import type { ReactNode } from "react";
import { cn } from "./cn";

// Messaggi all'utente, in due forme con lo stesso linguaggio visivo (barra colorata a sinistra, icona, testo):
//  - <ToastView> = notifica a comparsa (la usa ToastProvider: `const toast = useToast(); toast("Salvato", "success")`).
//  - <Alert> = avviso INLINE nella pagina o in una finestra (errore di un modulo, pagina vuota con spiegazione, esito di un'operazione).
// Accessibilità: gli errori e gli avvisi sono role="alert" (annunciati subito), gli altri role="status" (annunciati con calma).
// Il colore non è mai l'unico segnale: c'è sempre l'icona e il testo.
// Uso:
//   <Alert tone="err" title="Non è stato possibile salvare">Controlla la connessione e riprova.</Alert>
//   <Alert tone="ok" onClose={() => setMsg(null)}>Salvato</Alert>
export type AlertTone = "info" | "ok" | "warn" | "err";

const BAR: Record<AlertTone, string> = {
  info: "border-l-focus",
  ok: "border-l-ok",
  warn: "border-l-warn",
  err: "border-l-err",
};
const ICON_COLOR: Record<AlertTone, string> = { info: "text-focus", ok: "text-ok", warn: "text-warn", err: "text-err" };
const BG: Record<AlertTone, string> = { info: "bg-focus/10", ok: "bg-ok/10", warn: "bg-warn/10", err: "bg-err/10" };

function ToneIcon({ tone }: { tone: AlertTone }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false };
  if (tone === "ok") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>;
  if (tone === "err") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>;
  if (tone === "warn") return <svg {...common}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>;
}

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Se presente compare il pulsante «Chiudi» (✕). */
  onClose?: () => void;
  closeLabel?: string;
  /** Azione a destra (es. un <Button size="sm" variant="secondary">Riprova</Button>). */
  action?: ReactNode;
  className?: string;
}

export function Alert({ tone = "info", title, children, onClose, closeLabel = "Chiudi", action, className }: AlertProps) {
  const urgent = tone === "err" || tone === "warn";
  return (
    <div role={urgent ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-lg border border-line border-l-4 px-3 py-2.5 text-sm text-txt", BAR[tone], BG[tone], className)}>
      <span className={cn("mt-0.5 shrink-0", ICON_COLOR[tone])}><ToneIcon tone={tone} /></span>
      <div className="min-w-0 flex-1">
        {title != null && <div className="font-semibold">{title}</div>}
        {children != null && <div className={cn(title != null && "mt-0.5 text-dim")}>{children}</div>}
      </div>
      {action}
      {onClose && (
        <button type="button" onClick={onClose} aria-label={closeLabel} className="-my-1 -mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-dim hover:bg-wash hover:text-txt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-sm:h-10 max-sm:w-10">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      )}
    </div>
  );
}

/** Una notifica a comparsa (il contenitore fisso in basso lo gestisce ToastProvider). */
export function ToastView({ message, tone = "info", onClose, closeLabel = "Chiudi" }: { message: ReactNode; tone?: AlertTone; onClose?: () => void; closeLabel?: string }) {
  return (
    <div className="pointer-events-auto w-[min(24rem,calc(100vw-2rem))] rounded-lg bg-surface shadow-[var(--shadow-3)]">
      <Alert tone={tone} onClose={onClose} closeLabel={closeLabel}><span className="whitespace-pre-line">{message}</span></Alert>
    </div>
  );
}
