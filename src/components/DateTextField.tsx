"use client";

import { useEffect, useState } from "react";
import { fmtDMY } from "@/lib/dates";

// Campo data a testo con maschera gg.mm.aaaa, pensato per date lontane nel passato (data di nascita,
// scadenza documento) dove un calendario a mesi sarebbe scomodo da telefono. Il valore esterno è sempre ISO
// (yyyy-mm-dd); vuoto finché il testo non è una data completa e valida.

/** "31.05.1962" (o 31/05/1962, 31-05-1962) → "1962-05-31"; "" se incompleta o non valida. */
export function parseDMY(text: string): string {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text.trim());
  if (!m) return "";
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Inserisce i punti mentre si digitano le cifre: "3105" → "31.05", "31051962" → "31.05.1962". */
function maskDMY(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

export default function DateTextField({
  value,
  onChange,
  className = "",
  placeholder = "gg.mm.aaaa",
  id,
  title,
  disabled = false,
  required = false,
  min,
  max,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  id?: string;
  title?: string;
  disabled?: boolean;
  required?: boolean;
  min?: string;
  max?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(() => (value ? fmtDMY(value) : ""));
  // Se il valore cambia dall'esterno (es. reset del modulo) riallinea il testo; non toccarlo se coincide già.
  useEffect(() => {
    setText((t) => (parseDMY(t) === value ? t : value ? fmtDMY(value) : ""));
  }, [value]);

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      required={required}
      placeholder={placeholder}
      maxLength={10}
      value={text}
      onChange={(e) => {
        const t = maskDMY(e.target.value);
        setText(t);
        let iso = parseDMY(t);
        if (iso && ((min && iso < min) || (max && iso > max))) iso = "";
        onChange(iso);
      }}
      className={className}
    />
  );
}
