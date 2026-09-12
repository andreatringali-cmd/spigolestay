"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";

/** Un segnaposto e la cosa che inserisce in automatico nel messaggio. */
export interface VarItem { token: string; desc: string }

/** Set pronti per i vari editor (i token devono combaciare con quelli sostituiti a runtime). */
export const MSG_VARS: VarItem[] = [
  { token: "{ospite}", desc: "Nome dell'ospite che riceve il messaggio" },
  { token: "{struttura}", desc: "Nome della tua struttura" },
  { token: "{camera}", desc: "Nome o numero della camera prenotata" },
  { token: "{checkin}", desc: "Data di arrivo (check-in)" },
  { token: "{checkout}", desc: "Data di partenza (check-out)" },
  { token: "{notti}", desc: "Numero di notti del soggiorno" },
  { token: "{codice_accesso}", desc: "Codici d'ingresso della camera (portone, porta…)" },
  { token: "{saldo}", desc: "Importo ancora da saldare" },
  { token: "{link_guida}", desc: "Link alla guida ospiti personalizzata" },
  { token: "{link_checkin}", desc: "Link al self check-in online" },
];

export const PROMO_VARS: VarItem[] = [
  { token: "{nome}", desc: "Nome dell'ospite" },
  { token: "{struttura}", desc: "Nome della tua struttura" },
  { token: "{sconto}", desc: "Percentuale di sconto della promo" },
  { token: "{codice}", desc: "Codice promozionale da usare in prenotazione" },
  { token: "{scadenza}", desc: "Data entro cui vale l'offerta" },
  { token: "{contatti}", desc: "I tuoi contatti / link per prenotare diretto" },
];

/**
 * Legenda dei segnaposto: spiega cosa inserisce ogni {variabile}.
 * Se passi `onInsert`, ogni riga diventa cliccabile e aggiunge il token al testo.
 */
export default function VarLegend({ vars, onInsert, defaultOpen = false }: { vars: VarItem[]; onInsert?: (token: string) => void; defaultOpen?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(defaultOpen);
  const Row = onInsert ? "button" : "div";
  return (
    <div className="rounded-xl border border-line bg-wash/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-txt">
          <span aria-hidden>{"{ }"}</span> {t("Variabili disponibili")}
          <span className="font-normal text-faint">· {t("si compilano da sole")}</span>
        </span>
        <span className="text-faint">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-line p-2">
          {onInsert && <p className="mb-1.5 px-1 text-[11px] text-faint">{t("Tocca una voce per inserirla nel messaggio.")}</p>}
          <div className="grid gap-0.5 sm:grid-cols-2">
            {vars.map((v) => (
              <Row
                key={v.token}
                {...(onInsert ? { type: "button" as const, onClick: () => onInsert(v.token) } : {})}
                className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-left ${onInsert ? "hover:bg-surface" : ""}`}
              >
                <code className="shrink-0 rounded bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] px-1.5 py-0.5 text-[11px] font-semibold text-focus">{v.token}</code>
                <span className="text-[11px] leading-snug text-dim">{t(v.desc)}</span>
              </Row>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
