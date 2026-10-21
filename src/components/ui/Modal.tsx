"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

// Finestra di dialogo unica (Xenora DS 1). Fa da sola tutto ciò che serve all'accessibilità:
//  - role="dialog" aria-modal="true" aria-labelledby (il titolo) / aria-describedby (la descrizione);
//  - Esc la chiude (solo la finestra in cima, se ce ne sono più d'una: una conferma sopra una scheda chiude prima la conferma);
//  - trappola del focus (Tab e Maiusc+Tab restano dentro) e, alla chiusura, il focus torna all'elemento che l'aveva aperta;
//  - blocca lo scorrimento della pagina sotto (anche con più finestre aperte);
//  - è disegnata in un portale nel <body> (nessun contenitore con transform/overflow può spostarla) con z-index dai token (--z-modal);
//  - su telefono diventa un «foglio» agganciato in basso (sheet), a tutta larghezza, con angoli arrotondati solo in alto.
// Focus iniziale: l'elemento con data-autofocus (o con autoFocus di React), altrimenti il primo controllo del contenuto, altrimenti la finestra.
// Per le azioni DISTRUTTIVE metti data-autofocus (o autoFocus) sul pulsante «Annulla», non su «Elimina».
// Uso:
//   <Modal open={aperta} onClose={() => setAperta(false)} title="Nuova tariffa" footer={<><Button variant="secondary" onClick={chiudi}>Annulla</Button><Button onClick={salva}>Salva</Button></>}>
//     …campi…
//   </Modal>
export type ModalSize = "sm" | "md" | "lg" | "xl";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Testo sotto il titolo (collegato con aria-describedby). */
  description?: ReactNode;
  children?: ReactNode;
  /** Barra azioni in fondo: «Annulla» a sinistra del primario, allineati a destra. */
  footer?: ReactNode;
  size?: ModalSize;
  /** true = non si chiude con Esc, clic fuori o ✕ (operazione in corso). */
  busy?: boolean;
  /** false = il clic sullo sfondo non chiude. */
  dismissOnBackdrop?: boolean;
  /** Etichetta del pulsante ✕ (aria-label). */
  closeLabel?: string;
  /** «top» = sopra alle altre finestre (le conferme). */
  layer?: "modal" | "top";
  /** Elemento a cui dare il focus all'apertura (alternativa a data-autofocus). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

const SIZE: Record<ModalSize, string> = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-3xl" };
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Pila delle finestre aperte (l'ultima è in cima) e contatore del blocco scorrimento: moduli, non per istanza.
const stack: string[] = [];
let lockCount = 0;
let prevOverflow = "";

function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true" && (el.offsetParent !== null || el === document.activeElement));
}

const noopSubscribe = () => () => {};

export function Modal(props: ModalProps) {
  // Il portale esiste solo nel browser: sul server e all'idratazione non si disegna nulla.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!props.open || !mounted) return null;
  return createPortal(<ModalView {...props} />, document.body);
}

/** Il contenuto della finestra (sfondo + pannello) con tutta la logica. Esportato per i test; nelle pagine usa <Modal>. */
export function ModalView({ onClose, title, description, children, footer, size = "md", busy = false, dismissOnBackdrop = true, closeLabel = "Chiudi", layer = "modal", initialFocusRef, className }: ModalProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }); // sempre l'ultimo valore, letto solo negli eventi

  // Focus iniziale, ritorno del focus, blocco scorrimento, pila per Esc.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    stack.push(uid);
    if (lockCount++ === 0) { prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const target = initialFocusRef?.current
        ?? panel.querySelector<HTMLElement>("[data-autofocus]")
        ?? visibleFocusables(panel).find((el) => !el.hasAttribute("data-modal-close"))
        ?? panel.querySelector<HTMLElement>("[data-modal-close]")
        ?? panel;
      target.focus();
      if (!panel.contains(document.activeElement)) panel.focus(); // il candidato era disabilitato o nascosto
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || stack[stack.length - 1] !== uid) return;
      e.stopImmediatePropagation(); // non chiude anche pannelli/popover sotto
      if (!busyRef.current) closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(uid); if (i >= 0) stack.splice(i, 1);
      if (--lockCount === 0) document.body.style.overflow = prevOverflow;
      if (prev && prev.isConnected) prev.focus();
    };
  }, [uid, initialFocusRef]);

  // Trappola del focus: Tab dall'ultimo controllo torna al primo e viceversa.
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = visibleFocusables(panelRef.current);
    if (items.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto overscroll-contain p-4 pt-[10dvh] max-sm:items-end max-sm:p-0" style={{ zIndex: layer === "top" ? "calc(var(--z-modal) + 10)" : "var(--z-modal)" }} data-modal-layer={layer}>
      <div className="fixed inset-0 bg-black/45" aria-hidden="true" data-modal-backdrop onClick={() => { if (dismissOnBackdrop && !busy) onClose(); }} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description != null ? descId : undefined}
        tabIndex={-1}
        onKeyDown={trap}
        className={cn(
          "anim-in relative flex max-h-[85dvh] w-full flex-col rounded-2xl border border-line bg-surface shadow-[var(--shadow-3)] outline-none",
          "max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]",
          SIZE[size], className,
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg font-bold text-txt">{title}</h2>
            {description != null && <p id={descId} className="mt-1 text-sm text-dim">{description}</p>}
          </div>
          <button
            type="button"
            data-modal-close
            aria-label={closeLabel}
            disabled={busy}
            onClick={onClose}
            className="-mr-2 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-dim hover:bg-wash hover:text-txt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 max-sm:h-11 max-sm:w-11"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {children != null && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 text-sm text-txt">{children}</div>}
        {footer != null && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
