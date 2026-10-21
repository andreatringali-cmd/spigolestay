// Indicatore di caricamento (anello che gira). Decorativo: il testo «Caricamento…» sta nel contesto (aria-busy sul genitore).
// Uso: <Spinner /> oppure <Spinner size={20} className="text-focus" />
export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
