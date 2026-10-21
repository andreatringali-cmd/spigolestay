"use client";

// Pulsante «Filtri» per il TELEFONO: al posto di una barra con tanti filtri (che occupa 3-5 righe o va scorsa di lato) c'è UN solo pulsante, con il numero dei filtri attivi,
// che apre una tendina (Popover, dentro lo schermo) con tutti i filtri uno sotto l'altro. Dal tablet in su il pulsante non c'è (sm:hidden) e i filtri restano inline come prima.
// Uso (i filtri si scrivono UNA volta e si mostrano due volte: inline da sm in su, nella tendina su telefono):
//   const controls = (<> …select, date, interruttori… </>);
//   <div className="flex flex-wrap items-center gap-2 max-sm:hidden">{controls}</div>
//   <FilterSheet count={activeFilters} onReset={clearFilters}>{controls}</FilterSheet>
import { useRef, useState, type ReactNode } from "react";
import Popover from "./Popover";

export default function FilterSheet({ count = 0, onReset, children, label = "Filtri", className = "", keepOpen = false }: {
  /** Numero di filtri attivi (diversi dal valore di partenza): appare nel pallino sul pulsante. */
  count?: number;
  /** Se presente, nella tendina compare «Azzera» (visibile solo con almeno un filtro attivo). */
  onReset?: () => void;
  /** I controlli; se è una funzione riceve close() per chiudere la tendina (es. quando un pulsante apre una finestra sopra di essa). */
  children: ReactNode | ((close: () => void) => ReactNode);
  label?: string;
  className?: string;
  /** Con true la tendina resta aperta dopo il clic su un pulsante (per scelte multiple, es. interruttori da accendere uno dopo l'altro). Di norma si chiude da sola. */
  keepOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  // Dopo il clic su un PULSANTE dentro la tendina (es. «Nascondi i grafici», «Azzera», un segmento) la tendina si chiude da sola, a meno che quel pulsante abbia aperto
  // un'altra tendina/calendario (campo data) o la tendina sia marcata keepOpen / il pulsante abbia data-keep-open. Select e campi di testo non la chiudono.
  const onPanelClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (keepOpen) return;
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || btn.closest("[data-keep-open]")) return;
    const before = document.querySelectorAll("[data-xn-popover]").length;
    window.setTimeout(() => { if (document.querySelectorAll("[data-xn-popover]").length <= before) setOpen(false); }, 60);
  };
  return (
    <>
      <button
        ref={ref} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        className={`relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:hidden ${count > 0 || open ? "border-focus text-focus" : "border-line-strong text-dim"} bg-surface ${className}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
        {label}
        {count > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-focus px-1 text-[11px] font-bold leading-none text-on-focus">{count}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="end" width={340} label={label}>
       <div onClick={onPanelClick}>
        <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-dim">{label}</span>
          {onReset && count > 0 && <button type="button" onClick={onReset} className="-my-1.5 min-h-9 rounded-md px-2 text-xs font-semibold text-focus hover:bg-wash">Azzera</button>}
        </div>
        {/* I controlli si dispongono uno sotto l'altro a tutta larghezza (select, campi data, interruttori) */}
        <div className="flex flex-col gap-2 px-2 pb-2 [&_input]:w-full [&_select]:w-full">{typeof children === "function" ? children(() => setOpen(false)) : children}</div>
       </div>
      </Popover>
    </>
  );
}
