"use client";

import { Alert, Button, Modal } from "./ui/index";

// Finestra di conferma per azioni definitive/irreversibili (es. invio alla Questura/Osservatorio).
// Costruita sul <Modal> del design system: role=dialog, Esc, trappola del focus, ritorno del focus, blocco scroll.
// Focus iniziale: su «Annulla» quando l'azione è distruttiva (tone = var(--err)), altrimenti sul pulsante di conferma.
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
  const danger = tone === "var(--err)";
  const custom = !danger && tone !== "var(--focus)"; // warn/ok: colore pieno scelto dal chiamante
  const onTone = tone === "var(--warn)" ? "var(--on-warn)" : tone === "var(--ok)" ? "var(--on-ok)" : "var(--on-focus)";
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="md"
      busy={busy}
      layer="top"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus={danger ? "" : undefined}>{cancelLabel}</Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={busy || disabled}
          data-autofocus={danger ? undefined : ""}
          style={custom ? { backgroundColor: tone, color: onTone } : undefined}
        >{busy ? "Invio…" : confirmLabel}</Button>
      </>}
    >
      {message && <div className="text-dim">{message}</div>}
      {warning && <Alert tone="warn" className="mt-3">{warning}</Alert>}
    </Modal>
  );
}
