"use client";

// Dialog di conferma dell'app (centrato, grafica del gestionale) al posto del confirm() del browser.
// Uso: const confirm = useConfirm(); if (await confirm({ title, message, danger })) { ... }
// Costruito sul <Modal> del design system (role=dialog, Esc = Annulla, trappola e ritorno del focus, blocco scroll).
// Focus iniziale: su «Annulla» per le azioni distruttive (danger), sul campo per la conferma forte (typeToConfirm), sul pulsante di conferma negli altri casi.

import { createContext, useContext, useState, type ReactNode } from "react";
import { isConfirmWordOk, CONFIRM_WORD } from "@/lib/bulk-guard";
import { Button, Input, Modal } from "./ui/index";

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
  const close = (v: boolean) => { if (v && !wordOk) return; state?.resolve(v); setState(null); setTyped(""); };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          open
          onClose={() => close(false)}
          title={state.title ?? "Confermi l'operazione?"}
          size="sm"
          layer="top"
          footer={<>
            <Button variant="secondary" onClick={() => close(false)} data-autofocus={state.danger && !state.typeToConfirm ? "" : undefined}>{state.cancelLabel ?? "Annulla"}</Button>
            <Button variant={state.danger ? "danger" : "primary"} disabled={!wordOk} onClick={() => close(true)} data-autofocus={!state.danger && !state.typeToConfirm ? "" : undefined}>{state.confirmLabel ?? "Conferma"}</Button>
          </>}
        >
          <div className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${state.danger ? "bg-err/15 text-err" : "bg-focus/15 text-focus"}`} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
            </span>
            <p className="min-w-0 flex-1 whitespace-pre-line text-sm text-dim">{state.message}</p>
          </div>
          {typeof state.count === "number" && (
            <div className="mt-4 rounded-xl border border-err/45 bg-err/10 px-4 py-3 text-center">
              <div className="font-display text-3xl font-extrabold tabular-nums text-err">{state.count.toLocaleString("it-IT")}</div>
              {state.countLabel && <div className="text-xs font-semibold uppercase tracking-wide text-dim">{state.countLabel}</div>}
            </div>
          )}
          {state.typeToConfirm && (
            <div className="mt-4 text-sm text-txt">
              <Input
                label={<>Per confermare scrivi <b>{CONFIRM_WORD}</b></>}
                data-autofocus="" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} placeholder={CONFIRM_WORD}
                onKeyDown={(e) => { if (e.key === "Enter" && wordOk) close(true); }}
                className="font-semibold uppercase tracking-wider"
              />
            </div>
          )}
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConfirm deve stare dentro <ConfirmProvider>");
  return c;
}
