"use client";

// Toast leggeri, non bloccanti (in sostituzione di window.alert). useToast() → toast(msg, type?).
// Grafica e accessibilità dal design system (components/ui/Toast.tsx): gli errori sono annunciati subito (role="alert"), gli altri con calma
// (role="status"); c'è il pulsante «Chiudi»; gli errori restano 8 s (il resto 4,2 s).
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ToastView, type AlertTone } from "./ui/index";

type ToastType = "info" | "success" | "error";
interface Toast { id: number; message: string; type: ToastType }
type ToastFn = (message: string, type?: ToastType) => void;

const Ctx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(Ctx);

const TONE: Record<ToastType, AlertTone> = { info: "info", success: "ok", error: "err" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastFn>((message, type = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, message, type }]);
    setTimeout(() => dismiss(id), type === "error" ? 8000 : 4200);
  }, [dismiss]);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 flex max-w-[calc(100vw-2rem)] flex-col gap-2 max-md:bottom-20" style={{ zIndex: "var(--z-toast)" }}>
        {items.map((x) => (
          <div key={x.id}>
            <ToastView message={x.message} tone={TONE[x.type]} onClose={() => dismiss(x.id)} />
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
