"use client";

// Toast leggeri, non bloccanti (in sostituzione di window.alert). useToast() → toast(msg, type?).
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastType = "info" | "success" | "error";
interface Toast { id: number; message: string; type: ToastType }
type ToastFn = (message: string, type?: ToastType) => void;

const Ctx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(Ctx);

const COLOR: Record<ToastType, string> = { info: "var(--focus)", success: "var(--ok)", error: "var(--err)" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback<ToastFn>((message, type = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, message, type }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-[92vw] flex-col gap-2" aria-live="polite">
        {items.map((x) => (
          <div key={x.id} onClick={() => setItems((xs) => xs.filter((i) => i.id !== x.id))}
            className="pointer-events-auto flex items-start gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-txt shadow-2xl"
            style={{ borderLeft: `3px solid ${COLOR[x.type]}` }}>
            <span aria-hidden style={{ color: COLOR[x.type] }}>{x.type === "success" ? "✓" : x.type === "error" ? "!" : "i"}</span>
            <span className="min-w-0">{x.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
