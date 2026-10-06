"use client";

// "Oggi": chi arriva, chi parte, chi è in casa. Colori col significato di sempre:
// verde = arrivo, rosso = partenza, metà e metà = turnover (stessa camera), blu = ospite in casa.
import { useState } from "react";
import { cleanTint } from "@/lib/pulizie-colors";
import { tint } from "../_ui";
import { MoreLink, P, Tile, TileHead, toneColor } from "./_kit";

export interface MoveRow {
  id: string;
  kind: "arr" | "dep" | "stay";
  turnover: boolean;
  room: string | null;           // numero/nome breve della camera (null = da assegnare)
  name: string;
  sub: string;
  chip?: { text: string; tone: "ok" | "warn" | "err" | "dim" };
}

const KIND = {
  arr: { title: "Arrivi", color: "var(--ok)" },
  dep: { title: "Partenze", color: "var(--err)" },
  stay: { title: "In casa", color: P.ind },
} as const;
const STAY_VISIBLE = 4;

function Row({ r, onOpen }: { r: MoveRow; onOpen: (id: string) => void }) {
  const color = KIND[r.kind].color;
  const tileBg = r.turnover ? cleanTint("turnover", 16) : tint(color, 14);
  const chipColor = r.chip ? toneColor(r.chip.tone) : "";
  return (
    <li>
      <button
        type="button" onClick={() => onOpen(r.id)}
        className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl font-display text-sm font-bold" style={{ background: tileBg, color: r.turnover ? "var(--txt)" : color }} title={r.turnover ? "Turnover: partenza e arrivo nella stessa camera" : undefined}>
          <span className="max-w-full truncate px-0.5">{r.room ?? "—"}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-txt">{r.name}</span>
          <span className="block truncate text-xs text-dim">{r.sub}</span>
        </span>
        {r.chip && <span className="max-w-[44%] shrink-0 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: tint(chipColor, 14), color: chipColor }}>{r.chip.text}</span>}
      </button>
    </li>
  );
}

export default function Oggi({ rows, turnovers, onOpen, delay = 0 }: { rows: MoveRow[]; turnovers: number; onOpen: (id: string) => void; delay?: number }) {
  const [all, setAll] = useState(false);
  const groups = (["arr", "dep", "stay"] as const).map((k) => ({ k, list: rows.filter((r) => r.kind === k) })).filter((g) => g.list.length);
  return (
    <Tile label="Oggi" delay={delay}>
      <TileHead title="Oggi" sub={turnovers > 0 ? `${turnovers} turnover` : undefined} right={<MoreLink href="/prenotazioni">Prenotazioni</MoreLink>} />
      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-faint">Nessun movimento, nessun ospite in casa.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => {
            const meta = KIND[g.k];
            const hidden = g.k === "stay" && !all && g.list.length > STAY_VISIBLE + 1;
            const list = hidden ? g.list.slice(0, STAY_VISIBLE) : g.list;
            return (
              <div key={g.k}>
                <div className="mb-1 flex items-center gap-2 px-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                  <h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: meta.color }}>{meta.title}</h3>
                  <span className="font-mono text-[11px] text-faint">{g.list.length}</span>
                </div>
                <ul>{list.map((r) => <Row key={r.id} r={r} onOpen={onOpen} />)}</ul>
                {hidden && (
                  <button type="button" onClick={() => setAll(true)} className="ml-2 mt-1 rounded-lg px-2 py-1 text-xs font-semibold text-focus transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">
                    Mostra tutti ({g.list.length})
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Tile>
  );
}
