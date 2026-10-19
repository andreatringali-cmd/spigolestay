"use client";

// Tendina (menu a comparsa) ancorata a un pulsante. SU TUTTI i dispositivi compare accanto al pulsante, mai in fondo allo schermo e mai tagliata:
//  - è disegnata nel <body> (portale), quindi nessun contenitore con overflow:hidden, transform o animazioni può nasconderla o spostarla;
//  - si posiziona sotto il pulsante (sopra se sotto non c'è spazio), allineata a sinistra o a destra, e resta SEMPRE dentro lo schermo (margine 8px);
//  - se il contenuto è più alto dello spazio disponibile scorre al suo interno;
//  - si chiude con un tocco fuori, con Esc, e segue il pulsante se la pagina scorre o la finestra cambia misura.
// Uso:
//   const btnRef = useRef<HTMLButtonElement>(null);
//   <button ref={btnRef} onClick={() => setOpen(o => !o)}>…</button>
//   <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)} align="end" width={280}>…voci…</Popover>
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const MARGIN = 8;   // distanza minima dai bordi dello schermo
const GAP = 6;      // distanza dal pulsante

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Quale bordo del pulsante allineare: "start" = sinistro, "end" = destro. */
  align?: "start" | "end";
  /** Larghezza desiderata in px (si riduce da sola su schermi stretti). Assente = come il pulsante, almeno 200. */
  width?: number;
  /** Altezza massima in px (oltre scorre). Assente = lo spazio disponibile. */
  maxHeight?: number;
  className?: string;
  /** Etichetta per gli assistivi. */
  label?: string;
  /** Con true la tendina resta aperta quando si tocca il pulsante (lo gestisce il chiamante). */
  ignoreAnchorClicks?: boolean;
}

interface Pos { left: number; top?: number; bottom?: number; width: number; maxHeight: number }

export default function Popover({ open, onClose, anchorRef, children, align = "start", width, maxHeight, className = "", label, ignoreAnchorClicks = true }: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dark, setDark] = useState(false); // tema scuro: è una classe su un contenitore dell'app, non su <body> dove la tendina viene disegnata

  const place = useCallback(() => {
    const a = anchorRef.current; if (!a) return;
    setDark(!!a.closest(".dark"));
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(width ?? Math.max(r.width, 200), vw - MARGIN * 2);
    let left = align === "end" ? r.right - w : r.left;
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    const below = vh - r.bottom - GAP - MARGIN, above = r.top - GAP - MARGIN;
    const want = Math.min(maxHeight ?? 10000, popRef.current?.scrollHeight ?? 320);
    const goUp = below < Math.min(want, 220) && above > below; // sotto non c'è spazio e sopra ce n'è di più
    setPos(goUp
      ? { left, bottom: vh - r.top + GAP, width: w, maxHeight: Math.min(maxHeight ?? 10000, above) }
      : { left, top: r.bottom + GAP, width: w, maxHeight: Math.min(maxHeight ?? 10000, below) });
  }, [anchorRef, align, width, maxHeight]);

  useLayoutEffect(() => { if (open) place(); }, [open, place, children]);
  useEffect(() => {
    if (!open) return;
    const on = () => place();
    window.addEventListener("resize", on); window.addEventListener("scroll", on, true); window.visualViewport?.addEventListener("resize", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("scroll", on, true); window.visualViewport?.removeEventListener("resize", on); };
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const down = (e: Event) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      // Tendine annidate (es. il calendario di un campo data dentro la tendina «Filtri»): un tocco dentro un'altra tendina non chiude questa
      if ((t as Element).closest?.("[data-xn-popover]")) return;
      if (ignoreAnchorClicks && anchorRef.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down, true); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [open, onClose, anchorRef, ignoreAnchorClicks]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={popRef} role="dialog" aria-label={label} data-xn-popover=""
      className={`fixed z-[1000] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-1 text-txt shadow-xl ${dark ? "dark" : ""} ${className}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top, bottom: pos?.bottom, width: pos?.width, maxHeight: pos?.maxHeight, visibility: pos ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
