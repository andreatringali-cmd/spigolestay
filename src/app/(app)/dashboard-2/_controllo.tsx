"use client";

// Da controllare: segnalazioni che non sono adempimenti (invii non consegnati, arrivi senza camera, contatti, canali in calo, camere ferme).
import Link from "next/link";
import Icon from "@/components/Icon";
import ChannelLogo from "@/components/ChannelLogo";
import type { Channel } from "@/lib/types";
import type { ControlloItem } from "@/lib/dashboard2";
import { tint } from "../_ui";
import { LiveDot, P, Tile, TileHead } from "./_kit";

const OK = "var(--ok)";
const ICON = (k: string) => (k.startsWith("invio") ? "mail" : k === "senzacamera" ? "bed" : k === "contatti" ? "chat" : k === "oos" ? "lock" : "alertTriangle");
const COLOR = { err: P.cor, warn: P.amb, dim: "var(--faint)" } as const;

export default function Controllo({ items, delay = 0 }: { items: ControlloItem[]; delay?: number }) {
  return (
    <Tile label="Da controllare" delay={delay}>
      <TileHead title="Da controllare" count={items.length || undefined} />
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl px-3 py-3.5" style={{ backgroundColor: tint(OK, 9) }}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold" style={{ backgroundColor: tint(OK, 16), color: OK }}>✓</span>
          <span className="text-sm font-semibold text-txt">Niente da segnalare</span>
        </div>
      ) : (
        <ul className="grid gap-x-3 gap-y-0.5 lg:grid-cols-2">
          {items.map((it, i) => {
            const c = COLOR[it.tone];
            return (
              <li key={it.key} className="d2-fade min-w-0" style={{ animationDelay: `${delay + 100 + i * 50}ms` }}>
                <Link href={it.href} title={`${it.label}${it.detail ? ` · ${it.detail}` : ""}`} className="group flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: tint(c, 14), color: c }}>
                    {it.channel ? <ChannelLogo channel={it.channel as Channel} size={20} /> : <Icon name={ICON(it.key)} size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold leading-tight text-txt">{it.label}</span>
                    {it.detail && <span className="block truncate text-[11px] leading-tight text-faint">{it.detail}</span>}
                  </span>
                  {it.count > 1 && <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-xs font-bold tabular-nums" style={{ backgroundColor: tint(c, 14), color: c }}>{it.tone === "err" && <LiveDot color={c} size={6} />}{it.count}</span>}
                  {it.count <= 1 && it.tone === "err" && <LiveDot color={c} size={7} />}
                  <span className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-focus"><Icon name="chevron" size={13} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Tile>
  );
}
