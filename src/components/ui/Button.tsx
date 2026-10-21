import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

// Pulsante unico dell'app (Xenora DS 1).
//  - variant: primary (azione principale, una per finestra), secondary (bordo), ghost (senza bordo), danger (rosso pieno: eliminare),
//    icon (quadrato solo icona: aria-label OBBLIGATORIO, lo impone il tipo).
//  - size: xs = 32 px (righe compatte di tabelle e barre strumenti), sm = 36 px, md = 40 px; su telefono (max-sm) salgono a 40 / 44 / 44 px (bersaglio di tocco).
//  - loading: mostra l'anello, blocca i clic e mette aria-busy. disabled: opacità 50 % + cursor-not-allowed.
//  - Il focus da tastiera è l'anello globale (:focus-visible) già ripetuto qui in modo esplicito.
// Uso:
//   <Button onClick={salva} loading={salvo}>Salva</Button>
//   <Button variant="secondary">Annulla</Button>
//   <Button variant="danger">Elimina</Button>
//   <Button variant="icon" aria-label="Chiudi"><Icon name="x" /></Button>
export type ButtonSize = "xs" | "sm" | "md";
type TextVariant = "primary" | "secondary" | "ghost" | "danger";

interface BaseProps extends Omit<ComponentPropsWithRef<"button">, "className"> {
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  children?: ReactNode;
}
export type ButtonProps = (BaseProps & { variant?: TextVariant }) | (BaseProps & { variant: "icon"; "aria-label": string });

const BASE = "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-semibold transition select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_VARIANT: Record<TextVariant | "icon", string> = {
  primary: "bg-focus text-on-focus hover:brightness-95 active:brightness-90",
  secondary: "border border-line-strong bg-surface text-txt hover:bg-wash active:bg-wash",
  ghost: "text-dim hover:bg-wash hover:text-txt active:bg-wash",
  danger: "bg-err text-on-err hover:brightness-95 active:brightness-90",
  icon: "border border-transparent text-dim hover:bg-wash hover:text-txt active:bg-wash",
};

const SIZE_TEXT: Record<ButtonSize, string> = {
  xs: "h-8 px-2.5 text-xs max-sm:h-10 max-sm:px-3",
  sm: "h-9 px-3 text-sm max-sm:h-11 max-sm:px-3.5",
  md: "h-10 px-4 text-sm max-sm:h-11",
};
const SIZE_ICON: Record<ButtonSize, string> = {
  xs: "h-8 w-8 text-sm max-sm:h-10 max-sm:w-10",
  sm: "h-9 w-9 text-sm max-sm:h-11 max-sm:w-11",
  md: "h-10 w-10 text-sm max-sm:h-11 max-sm:w-11",
};

/** Classi del pulsante, riusabili su un <a>/<Link> che deve avere l'aspetto di un pulsante. */
export function buttonClass(variant: TextVariant | "icon" = "primary", size: ButtonSize = "md", extra = ""): string {
  return cn(BASE, BUTTON_VARIANT[variant], variant === "icon" ? SIZE_ICON[size] : SIZE_TEXT[size], extra);
}

export function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", loading = false, fullWidth = false, className, children, disabled, type = "button", ...rest } = props;
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, cn(fullWidth && "w-full", className))}
    >
      {loading && <Spinner size={size === "md" ? 16 : 14} />}
      {children}
    </button>
  );
}

/** Pulsante quadrato solo icona: `label` diventa aria-label (obbligatorio) e title (tooltip da mouse). */
export function IconButton({ label, size = "md", className, children, ...rest }: Omit<BaseProps, "children"> & { label: string; children: ReactNode }) {
  return (
    <Button {...rest} variant="icon" size={size} aria-label={label} title={rest.title ?? label} className={className}>
      {children}
    </Button>
  );
}
