"use client";

// «Da fare»: adempimenti e controlli in un solo elenco, dal più urgente. Ogni riga dice cosa, per chi, quanto e ha il suo pulsante di azione.
import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import ChannelLogo from "@/components/ChannelLogo";
import type { Channel } from "@/lib/types";
import type { TodoRow } from "@/lib/dashboard";
import { eur } from "@/lib/format";
import { BTN_SM, EmptyRow, HeadLink, Panel, Skeleton, TONE_TEXT } from "./_kit";

const VISIBLE = 6;

export default function DaFare({ rows, loading, health, setupPending }: {
  rows: TodoRow[]; loading: boolean; health: { done: number; total: number; pct: number }; setupPending: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, VISIBLE);
  const hidden = rows.length - shown.length;
  const urgent = rows.filter((r) => r.tone === "err").length;
  return (
    <Panel
      id="da-fare" title="Da fare" className="scroll-mt-4"
      right={
        <>
          {!loading && health.total > 0 && <span className="max-sm:hidden" title="Check-in, pagamenti e schedine di chi è in struttura, arriva o parte oggi">{health.done} di {health.total} passaggi fatti</span>}
          <HeadLink href="/adempimenti">Adempimenti</HeadLink>
        </>
      }
    >
      {loading ? (
        <div aria-busy="true" aria-label="Controllo degli adempimenti in corso" className="divide-y divide-line">
          {[0, 1, 2].map((i) => <div key={i} className="flex h-11 items-center gap-3 px-3"><Skeleton className="h-4 w-4" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-6 w-16" /></div>)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyRow>{setupPending ? "Nessun adempimento da mostrare: completa prima la configurazione della struttura." : "Nessun adempimento in scadenza e niente da controllare."}</EmptyRow>
      ) : (
        <>
          {urgent > 0 && <p className="sr-only" role="status">{urgent} {urgent === 1 ? "voce urgente" : "voci urgenti"}</p>}
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <li key={r.key} className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1">
                <span className={`grid h-5 w-5 place-items-center ${TONE_TEXT[r.tone]}`} aria-hidden>
                  {r.channel ? <ChannelLogo channel={r.channel as Channel} size={18} /> : <Icon name={r.tone === "err" && r.icon === "clipboard" ? "alertTriangle" : r.icon} size={16} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold leading-5 text-txt" title={r.title}>{r.title}</span>
                  <span className="block truncate text-xs leading-4 text-dim">
                    <span className={`font-medium ${TONE_TEXT[r.tone]}`}>{r.label}</span>{r.detail ? <> · {r.detail}</> : null}
                    {r.amount !== undefined && <span className="sm:hidden"> · {eur(r.amount)}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {r.amount !== undefined && <span className="font-mono text-xs tabular-nums text-dim max-sm:hidden">{eur(r.amount)}</span>}
                  <Link href={r.href} aria-label={`${r.action}: ${r.title}`} className={BTN_SM}>{r.action}</Link>
                </span>
              </li>
            ))}
          </ul>
          {(hidden > 0 || all) && rows.length > VISIBLE && (
            <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="flex min-h-9 w-full items-center justify-center border-t border-line px-3 text-xs font-medium text-focus hover:bg-wash max-sm:min-h-10">
              {all ? "Mostra meno" : `Mostra altre ${hidden}`}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}
