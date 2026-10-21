"use client";

import { Switch } from "./ui/Switch";

// Interruttore on/off condiviso (accessibile: role="switch"). Sostituisce le copie locali nelle pagine.
// È un sottile adattatore sul <Switch> del design system (components/ui/Switch.tsx): stessa API di sempre (on, onClick, color, label, disabled).
export default function Toggle({ on, onClick, color = "var(--focus)", label, disabled }: { on: boolean; onClick?: () => void; color?: string; label?: string; disabled?: boolean }) {
  return <Switch checked={on} onClick={onClick} color={color} label={label} disabled={disabled} />;
}
