"use client";

import { useEffect } from "react";

// Finestra di conferma per azioni definitive/irreversibili (es. invio alla Questura/Osservatorio).
export default function ConfirmDialog({ title, message, warning, confirmLabel = "Conferma", cancelLabel = "Annulla", tone = "var(--focus)", busy, disabled, onConfirm, onClose }: {
  title: string;
  message?: React.ReactNode;
  warning?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: string;
  busy?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose, busy]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => { if (!busy) onClose(); }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-txt">{title}</h2>
        {message && <div className="mt-2 text-sm text-dim">{message}</div>}
        {warning && (
          <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--warn)" }}>
            <span aria-hidden>⚠️</span><span>{warning}</span>
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">{cancelLabel}</button>
          <button onClick={onConfirm} disabled={busy || disabled} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: tone }}>{busy ? "Invio…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
