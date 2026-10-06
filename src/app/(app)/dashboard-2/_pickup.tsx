"use client";

// Pickup: prenotazioni ricevute ogni giorno negli ultimi 30 giorni. Colonne sottili, ultimi 7 giorni evidenziati, confronto con la settimana prima.
import { type PickupStats } from "@/lib/dashboard2";
import { tint } from "../_ui";
import { Columns, CountUp, P, Tile, TileHead, Tip, useChartHover } from "./_kit";

const WD = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

export default function Pickup({ pickup, delay = 0 }: { pickup: PickupStats; delay?: number }) {
  const n = pickup.days.length;
  const { idx, bind } = useChartHover(n, "bin");
  const d = pickup.deltaPct;
  const dColor = d === null ? "" : d >= 0 ? "var(--ok)" : P.cor;
  // sfumatura ciano → viola lungo i 30 giorni; i giorni più vecchi sono più tenui
  const colors = pickup.days.map((_, i) => { const c = `color-mix(in srgb, ${P.cy} ${Math.round(100 - (i / Math.max(1, n - 1)) * 100)}%, ${P.vi})`; return i >= n - 7 ? c : tint(c, 42); });
  const hc = idx !== null ? pickup.days[idx] : null;
  return (
    <Tile label="Prenotazioni ricevute" delay={delay} className="flex flex-col">
      <TileHead title="Pickup" sub="Prenotazioni ricevute, 30 giorni" />
      {pickup.total === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-faint">Nessuna prenotazione ricevuta.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="font-display text-4xl font-bold leading-none tabular-nums text-txt"><CountUp value={pickup.total} duration={1000} delay={100} /></div>
            <div className="mb-0.5 flex items-center gap-2 text-xs text-dim">
              <span title="Ultimi 7 giorni"><strong className="font-mono text-txt">{pickup.last7}</strong> in 7g</span>
              {d !== null && <span className="rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: tint(dColor, 14), color: dColor }} title="Ultimi 7 giorni contro i 7 precedenti">{d >= 0 ? "+" : "−"}{Math.abs(d)}%</span>}
            </div>
          </div>
          <div className="relative mt-4" {...bind} role="img" aria-label={`Prenotazioni ricevute negli ultimi 30 giorni: ${pickup.total}. Ultimi 7 giorni: ${pickup.last7}, i 7 precedenti: ${pickup.prev7}.`}>
            <Columns values={pickup.days.map((x) => x.count)} colors={colors} height={84} gap={2} hover={idx} delay={150} />
            {hc && (
              <Tip xPct={((idx! + 0.5) / n) * 100}>
                <div className="font-semibold">{WD[new Date(hc.iso + "T00:00:00Z").getUTCDay()]} {Number(hc.iso.slice(8))} {MESI[Number(hc.iso.slice(5, 7)) - 1]}</div>
                <div className="font-mono"><strong>{hc.count}</strong> <span className="text-faint">{hc.count === 1 ? "prenotazione" : "prenotazioni"}</span></div>
              </Tip>
            )}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-faint"><span>30 giorni fa</span><span>oggi</span></div>
        </>
      )}
    </Tile>
  );
}
