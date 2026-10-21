"use client";

// «Completa la configurazione»: passi veri di una struttura nuova (dati, camere, prezzi, guida, canali, utenti), ognuno con il suo collegamento.
// Compare solo finché manca qualcosa di obbligatorio e si può nascondere; dal nascosto si riapre con il pulsante nella testata.
import Link from "next/link";
import type { SetupState } from "@/lib/dashboard";
import { Panel } from "./_kit";

function Mark({ done }: { done: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className={`shrink-0 ${done ? "text-ok" : "text-dim"}`}>
      <circle cx="8" cy="8" r="7" fill={done ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
      {done && <path d="M4.8 8.3l2.2 2.2 4.2-4.6" fill="none" stroke="var(--surface)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export default function Avvio({ state, onHide }: { state: SetupState; onHide: () => void }) {
  return (
    <Panel
      title="Completa la configurazione" count={`${state.done}/${state.total}`}
      right={<button type="button" onClick={onHide} className="rounded-[var(--r-md)] px-2 py-1 text-xs font-medium text-dim hover:bg-wash hover:text-txt max-sm:min-h-10">Nascondi</button>}
    >
      <div className="px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-3">
          <div role="progressbar" aria-label="Avanzamento della configurazione" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.pct} className="h-1.5 flex-1 overflow-hidden rounded-full bg-wash">
            <div className="h-full rounded-full bg-focus" style={{ width: `${state.pct}%` }} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-dim">{state.pct}%</span>
        </div>
        <ul className="mt-1.5 grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
          {state.steps.map((s) => (
            <li key={s.key} className={`min-w-0 ${s.done ? "max-sm:hidden" : ""}`}>
              <Link href={s.href} className="flex min-h-10 items-center gap-2.5 rounded-[var(--r-md)] px-1.5 py-1 hover:bg-wash">
                <Mark done={s.done} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-medium ${s.done ? "text-dim" : "text-txt"}`}>
                    <span className="sr-only">{s.done ? "Fatto: " : "Da fare: "}</span>{s.label}
                  </span>
                  <span className="block truncate text-xs text-dim">{!s.done && s.missing.length > 0 ? `Mancano: ${s.missing.join(", ")}` : s.hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
