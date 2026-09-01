"use client";

import { useEffect } from "react";

// Regola globale: quando la rotella del mouse è sopra una striscia scorrevole
// orizzontalmente (grafici, ecc.), lo scroll verticale la fa scorrere a destra/sinistra.
// Vale per tutte le pagine, senza dover modificare ogni striscia.
export default function WheelScroll() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // gesto già orizzontale (trackpad) → nativo
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body && el !== document.documentElement) {
        const style = getComputedStyle(el);
        // 1) Priorità: se un box può scorrere in VERTICALE nella direzione della rotella, lascialo fare (nativo).
        const oy = style.overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
          const atTop = el.scrollTop <= 0;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          const canScrollHere = !((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0));
          if (canScrollHere) return; // scorre in verticale dentro il box, niente conversione orizzontale
          // altrimenti: box a fine corsa in questa direzione → prosegui verso lo scroll orizzontale
        }
        // 2) Altrimenti: se è una striscia orizzontale, converti lo scroll verticale in orizzontale.
        const ox = style.overflowX;
        if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1) {
          const atStart = el.scrollLeft <= 0;
          const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
          if (!((atStart && e.deltaY < 0) || (atEnd && e.deltaY > 0))) {
            el.scrollLeft += e.deltaY;
            e.preventDefault();
          }
          return;
        }
        el = el.parentElement;
      }
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}
