"use client";

// Dialog di conferma dell'app (centrato, grafica del gestionale) al posto del confirm() del browser.
// Uso: const confirm = useConfirm(); if (await confirm({ title, message, danger })) { ... }

import { createContext, useContext, useState, type ReactNode } from "react";

interface ConfirmOptions { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm: ConfirmFn = (opts) => {
    const o = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => setState({ ...o, resolve }));
  };
  const close = (v: boolean) => { state?.resolve(v); setState(null); };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button aria-label="Annulla" onClick={() => close(false)} className="absolute inset-0 bg-black/45" />
          <div className="anim-in relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${state.danger ? "var(--err)" : "var(--focus)"} 15%, transparent)`, color: state.danger ? "var(--err)" : "var(--focus)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-bold text-txt">{state.title ?? "Confermi l'operazione?"}</h2>
                <p className="mt-1 text-sm text-dim">{state.message}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => close(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-dim hover:bg-wash">{state.cancelLabel ?? "Annulla"}</button>
              <button autoFocus onClick={() => close(true)} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: state.danger ? "var(--err)" : "var(--focus)" }}>{state.confirmLabel ?? "Conferma"}</button>
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
