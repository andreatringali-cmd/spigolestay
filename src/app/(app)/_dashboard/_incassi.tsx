"use client";

// Ricavi delle prenotazioni in corso e future (stessa cifra del riepilogo di Prenotazioni): numero grande, quante prenotazioni e notti, ADR e ricavo medio per prenotazione.
import { num } from "@/lib/format";
import { tint } from "../_ui";
import { CountUp, MoreLink, P, Tile, TileHead } from "./_kit";

export default function Incassi({ total, count, nights, delay = 0 }: {
  total: number; count: number; nights: number; delay?: number;
}) {
  return (
    <Tile label="Ricavi in corso e future" delay={delay} className="flex flex-col">
      <TileHead title="Ricavi" sub="in corso e future" right={<MoreLink href="/statistiche">Statistiche</MoreLink>} />
      {count === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-faint">Nessuna prenotazione in corso o futura.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="font-display text-[2.1rem] font-bold leading-none tabular-nums text-txt sm:text-4xl">€ <CountUp value={total} format={(v) => num(v)} duration={1100} delay={150} /></div>
          </div>
          <div className="mt-2 text-xs text-dim">{count} {count === 1 ? "prenotazione" : "prenotazioni"} · {nights} {nights === 1 ? "notte" : "notti"} · totale lordo come in Prenotazioni</div>
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            {([["ADR", nights ? total / nights : 0, P.vi, "Prezzo medio a notte"], ["Per prenotazione", total / count, P.az, "Ricavo medio per prenotazione"]] as const).map(([label, value, color, hint]) => (
              <div key={label} className="rounded-xl px-3 py-2" style={{ backgroundColor: tint(color, 9) }} title={hint}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{label}</span>
                  <span className="font-mono text-sm font-bold tabular-nums text-txt">€ <CountUp value={value} format={(v) => num(v)} delay={300} /></span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Tile>
  );
}
