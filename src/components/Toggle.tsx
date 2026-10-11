"use client";

// Interruttore on/off condiviso (accessibile: role="switch"). Sostituisce le copie locali nelle pagine.
export default function Toggle({ on, onClick, color = "var(--focus)", label, disabled }: { on: boolean; onClick?: () => void; color?: string; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick} className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ backgroundColor: on ? color : "var(--line)" }}>
      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? "22px" : "2px" }} />
    </button>
  );
}
