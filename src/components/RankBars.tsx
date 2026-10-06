"use client";

// Classifica a barre orizzontali (bandiera/etichetta · barra · valore · %): per liste lunghe (es. paesi di provenienza) dove un grafico a colonne
// con decine di etichette non è leggibile. Mostra i primi N, raggruppa il resto in "Altri" e tiene a parte i valori "non indicati".
// Le barre si disegnano all'apertura (stesso effetto degli altri grafici).
export interface RankItem { label: string; value: number; color?: string; fill?: string; flag?: string; title?: string }

export default function RankBars({ items, top = 8, unknownLabel = "Non indicato", othersLabel = "Altri", unknownKey = "—", format = (n) => String(n) }: {
  items: RankItem[]; top?: number; unknownLabel?: string; othersLabel?: string; unknownKey?: string; format?: (n: number) => string;
}) {
  const unknown = items.filter((i) => i.label === unknownKey).reduce((a, i) => a + i.value, 0);
  const known = items.filter((i) => i.label !== unknownKey && i.value > 0).sort((a, b) => b.value - a.value);
  const shown = known.slice(0, top);
  const rest = known.slice(top);
  const restSum = rest.reduce((a, i) => a + i.value, 0);
  const total = known.reduce((a, i) => a + i.value, 0);
  if (!total) return <div className="py-6 text-center text-sm text-faint">Nessun dato nel periodo</div>;
  const rows: (RankItem & { muted?: boolean })[] = [...shown, ...(restSum > 0 ? [{ label: `${othersLabel} (${rest.length})`, value: restSum, color: "var(--faint)", muted: true }] : [])];
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2.5 pt-1">
      {rows.map((r, i) => (
        <div key={r.label} className="flex items-center gap-2.5 text-xs" title={r.title ?? r.label}>
          <span className="flex w-[4.5rem] shrink-0 items-center gap-1.5 font-medium text-txt">
            {r.flag ? <span className="text-[15px] leading-none">{r.flag}</span> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color ?? "var(--faint)" }} />}
            <span className="truncate">{r.label}</span>
          </span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-wash">
            <span className="anim-grow block h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.muted ? "var(--faint)" : (r.fill || r.color || "var(--focus)"), opacity: r.muted ? 0.55 : 1, animationDelay: `${i * 0.07}s` }} />
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-dim"><b className="text-txt">{format(r.value)}</b> <span className="text-faint">{Math.round((r.value / total) * 100)}%</span></span>
        </div>
      ))}
      {unknown > 0 && <div className="mt-0.5 text-[11px] text-faint">{unknownLabel}: {format(unknown)} {unknown === 1 ? "prenotazione" : "prenotazioni"} senza paese</div>}
    </div>
  );
}
