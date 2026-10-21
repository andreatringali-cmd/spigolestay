"use client";

// Dialog di conferma dell'app (centrato, grafica del gestionale) al posto del confirm() del browser.
// Uso: const confirm = useConfirm(); if (await confirm({ title, message, danger })) { ... }

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isConfirmWordOk, CONFIRM_WORD } from "@/lib/bulk-guard";

// typeToConfirm: conferma forte per le cancellazioni di massa: il pulsante resta spento finché non si scrive ELIMINA.
// count/countLabel: numero grande ben visibile (es. 1.696 + "prenotazioni").
interface ConfirmOptions { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; typeToConfirm?: boolean; count?: number; countLabel?: string }
type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm: ConfirmFn = (opts) => {
    const o = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => { setTyped(""); setState({ ...o, resolve }); });
  };
  const [typed, setTyped] = useState("");
  const wordOk = !state?.typeToConfirm || isConfirmWordOk(typed);
  const close = (v: boolean) => { if (v && !wordOk) return; state?.resolve(v); setState(null); setTyped(""); }; useEffect(() => { if (!state) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); state.resolve(false); setState(null); setTyped(""); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [state]); // Esc = Annulla (e non chiude anche la scheda sotto)

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button aria-label="Annulla" onClick={() => close(false)} className="absolute inset-0 bg-black/45" />
          <div className="anim-in relative max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${state.danger ? "var(--err)" : "var(--focus)"} 15%, transparent)`, color: state.danger ? "var(--err)" : "var(--focus)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-bold text-txt">{state.title ?? "Confermi l'operazione?"}</h2>
                <p className="mt-1 text-sm text-dim">{state.message}</p>
              </div>
            </div>
            {typeof state.count === "number" && (
              <div className="mt-4 rounded-xl border px-4 py-3 text-center" style={{ borderColor: "color-mix(in srgb, var(--err) 45%, var(--line))", backgroundColor: "color-mix(in srgb, var(--err) 8%, transparent)" }}>
                <div className="font-display text-3xl font-extrabold tabular-nums" style={{ color: "var(--err)" }}>{state.count.toLocaleString("it-IT")}</div>
                {state.countLabel && <div className="text-xs font-semibold uppercase tracking-wide text-dim">{state.countLabel}</div>}
              </div>
            )}
            {state.typeToConfirm && (
              <label className="mt-4 block text-sm text-txt">
                Per confermare scrivi <b>{CONFIRM_WORD}</b>
                <input
                  autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} placeholder={CONFIRM_WORD}
                  onKeyDown={(e) => { if (e.key === "Enter" && wordOk) close(true); }}
                  className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm font-semibold uppercase tracking-wider text-txt"
                />
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => close(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-dim hover:bg-wash">{state.cancelLabel ?? "Annulla"}</button>
              <button autoFocus={!state.typeToConfirm} disabled={!wordOk} onClick={() => close(true)} className={`rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${state.danger ? "text-on-err" : "text-on-focus"}`} style={{ backgroundColor: state.danger ? "var(--err)" : "var(--focus)" }}>{state.confirmLabel ?? "Conferma"}</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConfirm deve stare dentro <ConfirmProvider>");
  return c;
}
