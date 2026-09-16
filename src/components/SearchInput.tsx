"use client";

// Campo di ricerca UNIFICATO per tutto il channel manager.
// Regole condivise: larghezza ~ una card, icona lente a sinistra, sfondo grigio (bg-wash)
// diverso dal colore della barra/superficie. Usare questo ovunque al posto di input "Cerca…" ad-hoc.
import Icon from "@/components/Icon";

export default function SearchInput({
  value,
  onChange,
  placeholder = "Cerca…",
  className = "",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={`relative w-full sm:w-72 ${className}`}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
        <Icon name="search" size={16} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full rounded-lg border border-line bg-wash py-2 pl-9 pr-3 text-sm text-txt outline-none placeholder:text-faint focus:border-focus"
      />
    </div>
  );
}
