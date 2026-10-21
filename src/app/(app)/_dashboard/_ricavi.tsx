"use client";

// Ricavi delle prenotazioni in corso e future (stessa cifra del riepilogo di Prenotazioni): totale, quante prenotazioni e notti, ADR e ricavo medio per prenotazione.
import { eur } from "@/lib/format";
import { EmptyRow, HeadLink, Panel } from "./_kit";

export default function Ricavi({ total, count, nights, onNew }: { total: number; count: number; nights: number; onNew?: () => void }) {
  return (
    <Panel title="Ricavi, in corso e future" right={<HeadLink href="/statistiche">Statistiche</HeadLink>}>
      {count === 0 ? (
        <EmptyRow action={onNew && <button type="button" onClick={onNew} className="inline-flex items-center rounded-[var(--r-md)] px-1.5 py-1 text-xs font-medium text-focus hover:bg-wash max-sm:min-h-10">Nuova prenotazione</button>}>Nessuna prenotazione in corso o futura.</EmptyRow>
      ) : (
        <div className="px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p className="font-display text-2xl font-bold leading-none tabular-nums text-txt" aria-label={`Totale lordo ${eur(total)}`}>{eur(total)}</p>
            <dl className="flex gap-5 text-xs text-dim">
              <div title="Prezzo medio a notte"><dt className="inline">ADR </dt><dd className="inline font-mono font-semibold tabular-nums text-txt">{eur(nights ? total / nights : 0)}</dd></div>
              <div title="Ricavo medio per prenotazione"><dt className="inline">Per prenotazione </dt><dd className="inline font-mono font-semibold tabular-nums text-txt">{eur(total / count)}</dd></div>
            </dl>
          </div>
          <p className="mt-1.5 text-xs text-dim">{count} {count === 1 ? "prenotazione" : "prenotazioni"} · {nights} {nights === 1 ? "notte" : "notti"} · totale lordo come in Prenotazioni</p>
        </div>
      )}
    </Panel>
  );
}
