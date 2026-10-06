"use client";

// Adempimenti: il cuore operativo. Voci ordinate per urgenza, ognuna porta alla pagina giusta.
import Link from "next/link";
import Icon from "@/components/Icon";
import { type AdempimentoItem } from "@/lib/dashboard2";
import { num } from "@/lib/format";
import { tint } from "../_ui";
import { Tile, TileHead, toneColor } from "./_kit";

export default function Adempimenti({ items, total, urgent, loading, delay = 0 }: { items: AdempimentoItem[]; total: number; urgent: number; loading: boolean; delay?: number }) {
  const ok = total === 0;
  const stateColor = toneColor(ok ? "ok" : urgent > 0 ? "err" : "warn");
  return (
    <Tile id="adempimenti" label="Adempimenti" delay={delay} className="scroll-mt-4">
      <TileHead
        title="Adempimenti"
        sub="Check-in, Questura, ISTAT, tassa di soggiorno e saldi"
        right={loading ? null : (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: tint(stateColor, 13), color: stateColor }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
            {ok ? "In regola" : `${total} da fare`}
          </span>
        )}
      />
      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Controllo degli adempimenti in corso">
          {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-wash" style={{ opacity: 0.7 - i * 0.15 }} />)}
        </div>
      ) : ok ? (
        <div className="flex items-center gap-4 rounded-xl px-4 py-5" style={{ backgroundColor: tint("var(--ok)", 8) }}>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full" style={{ backgroundColor: tint("var(--ok)", 16), color: "var(--ok)" }}><Icon name="id" size={22} /></span>
          <div className="min-w-0">
            <div className="font-display text-lg font-bold leading-tight text-txt">Tutto in regola</div>
            <div className="mt-0.5 text-sm text-dim">Check-in, schedine Questura, ISTAT, tassa di soggiorno e saldi non hanno nulla in sospeso.</div>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it, i) => {
            const c = toneColor(it.tone);
            return (
              <li key={it.key} className="anim-in" style={{ animationDelay: `${delay + 80 + i * 55}ms` }}>
                <Link
                  href={it.href}
                  className="group flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2.5 transition hover:border-line hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
                >
                  <span className="grid h-10 min-w-10 shrink-0 place-items-center rounded-xl px-1.5 font-display text-lg font-bold tabular-nums" style={{ backgroundColor: tint(c, 14), color: c }}>{it.count}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-txt">{it.count === 1 ? it.one : it.many}</span>
                    {it.detail && <span className="block truncate text-xs text-dim">{it.detail}</span>}
                  </span>
                  {it.amount !== undefined && <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-txt">€ {num(it.amount)}</span>}
                  <span className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-focus"><Icon name="chevron" size={14} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Tile>
  );
}
