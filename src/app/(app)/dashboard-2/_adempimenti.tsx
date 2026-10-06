"use client";

// Adempimenti: il cuore operativo. Mezzo anello con la % di passaggi completati e righe a icone ordinate per urgenza.
import Link from "next/link";
import Icon from "@/components/Icon";
import { type AdempimentoItem } from "@/lib/dashboard2";
import { num } from "@/lib/format";
import { tint } from "../_ui";
import { CountUp, HalfGauge, LiveDot, P, Tile, TileHead } from "./_kit";

const OK = "var(--ok)";
const ICON: Record<string, string> = { checkin: "login", questura: "id", qerr: "alertTriangle", pay: "card", tax: "receipt", istat: "chart", guide: "chat" };

export default function Adempimenti({ items, total, urgent, loading, health, delay = 0 }: {
  items: AdempimentoItem[]; total: number; urgent: number; loading: boolean; health: { done: number; total: number; pct: number }; delay?: number;
}) {
  const ok = total === 0;
  const gaugeColor = health.pct >= 90 ? OK : health.pct >= 60 ? P.amb : P.cor;
  const stateColor = ok ? OK : urgent > 0 ? P.cor : P.amb;
  return (
    <Tile id="adempimenti" label="Adempimenti" delay={delay} className="scroll-mt-4">
      <TileHead
        title="Adempimenti"
        right={loading ? null : (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: tint(stateColor, 14), color: stateColor }}>
            {urgent > 0 ? <LiveDot color={stateColor} size={7} /> : <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stateColor }} />}
            {ok ? "In regola" : `${total} da fare`}
          </span>
        )}
      />
      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Controllo degli adempimenti in corso">
          {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-xl bg-wash" style={{ opacity: 0.7 - i * 0.15 }} />)}
        </div>
      ) : (
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-[148px_minmax(0,1fr)] sm:items-center">
          <div className="flex flex-col items-center gap-1.5">
            <HalfGauge pct={health.pct} color={gaugeColor} width={148} label={`Passaggi completati: ${health.pct}% (${health.done} su ${health.total})`}>
              <span className="font-display text-3xl font-bold leading-none tabular-nums text-txt"><CountUp value={health.pct} duration={1000} /><span className="text-base font-semibold text-faint">%</span></span>
            </HalfGauge>
            <span className="text-[11px] text-faint" title="Check-in, pagamenti e schedine di chi è in struttura, arriva o parte oggi">{health.total ? `${health.done}/${health.total} fatti` : "nessun passaggio"}</span>
          </div>

          {ok ? (
            <div className="flex items-center gap-3 rounded-xl px-3 py-3.5" style={{ backgroundColor: tint(OK, 9) }}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: tint(OK, 16), color: OK }}><Icon name="id" size={20} /></span>
              <span className="font-display text-lg font-bold leading-tight text-txt">Tutto in regola</span>
            </div>
          ) : (
            <ul className="flex min-w-0 flex-col gap-0.5">
              {items.map((it, i) => {
                const c = it.tone === "err" ? P.cor : P.amb;
                return (
                  <li key={it.key} className="d2-fade" style={{ animationDelay: `${delay + 120 + i * 55}ms` }}>
                    <Link
                      href={it.href} title={`${it.count === 1 ? it.one : it.many}${it.detail ? ` · ${it.detail}` : ""}`}
                      className="group flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: tint(c, 14), color: c }}><Icon name={ICON[it.key] ?? "clipboard"} size={15} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold leading-tight text-txt">{it.short}</span>
                        {it.detail && <span className="hidden truncate text-[11px] leading-tight text-faint sm:block">{it.detail}</span>}
                      </span>
                      {it.amount !== undefined && <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-dim">€ {num(it.amount)}</span>}
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-xs font-bold tabular-nums" style={{ backgroundColor: tint(c, 14), color: c }}>
                        {it.tone === "err" && <LiveDot color={c} size={6} />}{it.count}
                      </span>
                      <span className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-focus"><Icon name="chevron" size={13} /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Tile>
  );
}
