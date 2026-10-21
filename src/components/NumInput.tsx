"use client";

// Campo importo/numero che accetta virgola E punto come separatore decimale e permette la digitazione intermedia ("75,", "75,7").
// Tiene il TESTO digitato (la bozza) e comunica al padre solo numeri validi: a differenza di <input type="number"> non si azzera
// quando l'utente scrive la virgola. Sulla tastiera del telefono mostra il tastierino decimale (inputMode="decimal").

import { useEffect, useRef, useState } from "react";
import { NUM_TYPING_RE, formatDecimalIT, parseDecimalIT, roundDecimals } from "@/lib/num-it";
import { useFieldControl } from "./ui/Field";

interface Props {
  value: number | null;
  /** Con `allowNull` un campo svuotato comunica null; altrimenti 0. */
  onChange: (v: number | null) => void;
  allowNull?: boolean;
  min?: number;
  max?: number;
  /** Cifre decimali massime (default 2: centesimi). */
  decimals?: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}

export default function NumInput({ value, onChange, allowNull, min = 0, max, decimals = 2, className, placeholder, disabled, id, "aria-label": ariaLabel }: Props) {
  const fc = useFieldControl(); // dentro un <Field label="…"> prende id e attributi aria
  const [draft, setDraft] = useState<string>(() => formatDecimalIT(value, decimals));
  const focused = useRef(false);

  const clamp = (n: number) => {
    let v = roundDecimals(n, decimals);
    if (v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
  };

  // Allinea la bozza quando il valore cambia da FUORI (caricamento, "Saldo", ricalcoli). Mentre si scrive, una bozza che vale già
  // il valore del padre ("75," = 75) o vuota non si tocca: altrimenti la virgola appena digitata sparirebbe.
  useEffect(() => {
    if (focused.current) {
      if (draft.trim() === "") return;
      const p = parseDecimalIT(draft);
      if (p !== null && value !== null && clamp(p) === value && clamp(p) === roundDecimals(p, decimals)) return;
    }
    const next = formatDecimalIT(value, decimals);
    if (next !== draft) setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      id={id ?? fc.id}
      aria-describedby={fc["aria-describedby"]}
      aria-invalid={fc["aria-invalid"]}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={ariaLabel}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      value={draft}
      onFocus={(e) => { focused.current = true; e.target.select(); }}
      onChange={(e) => {
        const raw = e.target.value;
        if (!NUM_TYPING_RE.test(raw)) return; // lettere e simboli non entrano
        setDraft(raw);
        if (raw.trim() === "") { onChange(allowNull ? null : clamp(0)); return; }
        const n = parseDecimalIT(raw);
        if (n === null) return; // "-" o testo incompleto: si aspetta, senza toccare il valore
        onChange(clamp(n));
      }}
      onBlur={() => {
        focused.current = false;
        const n = parseDecimalIT(draft);
        setDraft(n === null ? formatDecimalIT(value, decimals) : formatDecimalIT(clamp(n), decimals));
      }}
    />
  );
}
