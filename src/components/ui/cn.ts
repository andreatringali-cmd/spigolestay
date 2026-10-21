// Unisce nomi di classe ignorando i valori falsi (false, null, undefined, "").
// Uso: cn("px-3", attivo && "bg-focus", className)
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
