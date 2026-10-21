"use client";

import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

// Campi di modulo unici (Xenora DS 1): etichetta, aiuto, errore, altezza unica (40 px, 44 su telefono).
//  - <Field label hint error required> avvolge UN controllo (Input, Select, Textarea o un campo custom come DateField/NumInput
//    che accetti id/aria-*): Field genera l'id e collega etichetta (htmlFor), aiuto e errore (aria-describedby, aria-invalid).
//  - L'errore è un <p role="alert">: lo annuncia il lettore di schermo appena compare. Bordo rosso sul campo.
//  - Input/Select/Textarea funzionano anche da soli, oppure con le scorciatoie label/hint/error (si avvolgono da sole in un Field).
//  - Focus: bordo blu + anello visibile. Disabled: sfondo wash e testo attenuato. Placeholder: --faint.
// Uso:
//   <Field label="Email" hint="Ti scriviamo qui la conferma" error={errore} required>
//     <Input type="email" value={v} onChange={(e) => setV(e.target.value)} />
//   </Field>
//   <Select label="Stato" value={s} onChange={...}><option value="a">A</option></Select>
interface FieldCtx { id: string; describedBy?: string; invalid: boolean; required: boolean }
const Ctx = createContext<FieldCtx | null>(null);

/** Classe di base del controllo (riusabile da componenti custom come campi data o numerici). */
export const FIELD_CONTROL = "w-full rounded-lg border bg-surface px-3 text-sm text-txt placeholder:text-faint transition-colors focus:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-wash disabled:text-faint";
const OK_BORDER = "border-line-strong";
const ERR_BORDER = "border-err";
const HEIGHT = "h-10 max-sm:h-11";

/** Classi complete di un campo (per componenti che non possono usare <Input>, es. <DateField className=...>). */
export function inputClass(invalid = false, extra = ""): string {
  return cn(FIELD_CONTROL, HEIGHT, invalid ? ERR_BORDER : OK_BORDER, extra);
}

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  /** Messaggio di errore: se presente il campo è non valido (aria-invalid) e il messaggio è annunciato (role=alert). */
  error?: ReactNode;
  required?: boolean;
  /** Id del controllo; se manca lo genera React. */
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, required = false, id, className, children }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const hasHint = hint != null && hint !== false;
  const hasError = isErr(error);
  const ids = [hasHint ? `${fid}-hint` : "", hasError ? `${fid}-error` : ""].filter(Boolean).join(" ");
  return (
    <Ctx.Provider value={{ id: fid, describedBy: ids || undefined, invalid: hasError, required }}>
      <div className={cn("block", className)}>
        {label != null && (
          <label htmlFor={fid} className="mb-1 block text-xs font-medium text-dim">
            {label}
            {required && <span className="ml-0.5 text-err" aria-hidden="true">*</span>}
          </label>
        )}
        {children}
        {hasHint && !hasError && <p id={`${fid}-hint`} className="mt-1 text-xs text-dim">{hint}</p>}
        {hasHint && hasError && <p id={`${fid}-hint`} className="sr-only">{hint}</p>}
        {hasError && <p id={`${fid}-error`} role="alert" className="mt-1 text-xs font-medium text-err">{error}</p>}
      </div>
    </Ctx.Provider>
  );
}

/** Per componenti custom dentro un <Field>: restituisce id e attributi aria da mettere sul controllo. */
export function useFieldControl(): { id?: string; "aria-describedby"?: string; "aria-invalid"?: true; required?: true } {
  const c = useContext(Ctx);
  if (!c) return {};
  return { id: c.id, "aria-describedby": c.describedBy, "aria-invalid": c.invalid ? true : undefined, required: c.required ? true : undefined };
}

type Shortcuts = { label?: ReactNode; hint?: ReactNode; error?: ReactNode };
const hasShortcuts = (p: Shortcuts): boolean => p.label != null || p.hint != null || p.error != null;
const isErr = (e: ReactNode): boolean => e != null && e !== false && e !== "";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, Shortcuts { fieldClassName?: string }
export function Input({ label, hint, error, fieldClassName, className, ...rest }: InputProps) {
  const f = useFieldControl();
  if (hasShortcuts({ label, hint, error })) {
    return <Field label={label} hint={hint} error={error} required={rest.required} id={rest.id} className={fieldClassName}><Input {...rest} className={className} /></Field>;
  }
  const invalid = Boolean(f["aria-invalid"]);
  return (
    <input
      {...rest}
      id={rest.id ?? f.id}
      aria-describedby={rest["aria-describedby"] ?? f["aria-describedby"]}
      aria-invalid={invalid ? true : rest["aria-invalid"]}
      required={rest.required ?? f.required}
      className={cn(FIELD_CONTROL, HEIGHT, invalid ? ERR_BORDER : OK_BORDER, className)}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, Shortcuts { fieldClassName?: string }
export function Select({ label, hint, error, fieldClassName, className, children, ...rest }: SelectProps) {
  const f = useFieldControl();
  if (hasShortcuts({ label, hint, error })) {
    return <Field label={label} hint={hint} error={error} required={rest.required} id={rest.id} className={fieldClassName}><Select {...rest} className={className}>{children}</Select></Field>;
  }
  const invalid = Boolean(f["aria-invalid"]);
  return (
    <div className="relative">
      <select
        {...rest}
        id={rest.id ?? f.id}
        aria-describedby={rest["aria-describedby"] ?? f["aria-describedby"]}
        aria-invalid={invalid ? true : rest["aria-invalid"]}
        required={rest.required ?? f.required}
        className={cn(FIELD_CONTROL, HEIGHT, "appearance-none pr-9", invalid ? ERR_BORDER : OK_BORDER, className)}
      >
        {children}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dim" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9" /></svg>
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, Shortcuts { fieldClassName?: string }
export function Textarea({ label, hint, error, fieldClassName, className, ...rest }: TextareaProps) {
  const f = useFieldControl();
  if (hasShortcuts({ label, hint, error })) {
    return <Field label={label} hint={hint} error={error} required={rest.required} id={rest.id} className={fieldClassName}><Textarea {...rest} className={className} /></Field>;
  }
  const invalid = Boolean(f["aria-invalid"]);
  return (
    <textarea
      {...rest}
      id={rest.id ?? f.id}
      aria-describedby={rest["aria-describedby"] ?? f["aria-describedby"]}
      aria-invalid={invalid ? true : rest["aria-invalid"]}
      required={rest.required ?? f.required}
      className={cn(FIELD_CONTROL, "min-h-20 py-2", invalid ? ERR_BORDER : OK_BORDER, className)}
    />
  );
}
