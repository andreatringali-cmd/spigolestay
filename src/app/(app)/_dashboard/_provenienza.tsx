"use client";

// Provenienza: i primi 5 Paesi degli ospiti (ultimi 12 mesi) con bandiera e barre sottili.
import Flag from "@/components/Flag";
import type { CountryRow } from "@/lib/dashboard";
import { tint } from "../_ui";
import { MoreLink, P, ThinBar, Tile, TileHead } from "./_kit";

const FLAG_CODE: Record<string, string> = { IT: "it", FR: "fr", DE: "de", ES: "es", GB: "gb" };
const BAR = [P.cy, P.vi, P.az, P.li, P.cy];

function Country({ code }: { code: string }) {
  const f = FLAG_CODE[code];
  if (f) return <Flag code={f} className="h-4 w-6" />;
  // Bandiere non disegnate: sigla del Paese su fondo tenue
  return <span className="grid h-4 w-6 shrink-0 place-items-center rounded-[2px] text-[9px] font-bold leading-none text-dim" style={{ backgroundColor: tint("var(--faint)", 22) }}>{code}</span>;
}

export default function Provenienza({ rows, known, delay = 0 }: { rows: CountryRow[]; known: number; delay?: number }) {
  const top = rows[0]?.count || 1;
  return (
    <Tile label="Provenienza degli ospiti" delay={delay}>
      <TileHead title="Provenienza" sub={`${known} prenotazioni, 12 mesi`} right={<MoreLink href="/provenienza">Dettagli</MoreLink>} />
      <ul className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.code} className="flex items-center gap-3" title={`${r.name}: ${r.count} ${r.count === 1 ? "prenotazione" : "prenotazioni"} (${r.share}%)`}>
            <Country code={r.code} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold text-txt">{r.name}</span>
                <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-dim">{r.share}%</span>
              </div>
              <ThinBar pct={(r.count / top) * 100} color={BAR[i % BAR.length]} delay={150 + i * 90} />
            </div>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
