"use client";

// Da controllare: segnalazioni che non sono adempimenti (contatti, invii non consegnati, canali in calo, arrivi senza camera).
import Link from "next/link";
import Icon from "@/components/Icon";
import ChannelLogo from "@/components/ChannelLogo";
import type { Channel } from "@/lib/types";
import type { ControlloItem } from "@/lib/dashboard2";
import { tint } from "../_ui";
import { Tile, TileHead, toneColor } from "./_kit";

export default function Controllo({ items, delay = 0 }: { items: ControlloItem[]; delay?: number }) {
  return (
    <Tile label="Da controllare" delay={delay}>
      <TileHead title="Da controllare" count={items.length || undefined} sub="Cose che non sono scadenze ma meritano un'occhiata" />
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl px-3 py-4" style={{ backgroundColor: tint("var(--ok)", 8) }}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold" style={{ backgroundColor: tint("var(--ok)", 16), color: "var(--ok)" }}>✓</span>
          <span className="text-sm text-dim">Niente da segnalare: contatti, invii e canali sono a posto.</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => {
            const c = toneColor(it.tone);
            return (
              <li key={it.key}>
                <Link href={it.href} className="group flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2.5 transition hover:border-line hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]">
                  {it.channel ? (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: tint(c, 14) }}><ChannelLogo channel={it.channel as Channel} size={22} /></span>
                  ) : (
                    <span className="grid h-9 min-w-9 shrink-0 place-items-center rounded-xl px-1 font-display text-base font-bold tabular-nums" style={{ backgroundColor: tint(c, 14), color: c }}>{it.count}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug text-txt">{it.label}</span>
                    {it.detail && <span className="block truncate text-xs text-dim">{it.detail}</span>}
                  </span>
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
