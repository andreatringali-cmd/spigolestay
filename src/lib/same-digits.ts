// Confronto tra numeri di telefono ignorando spazi, "+" e altri simboli: conta solo le cifre.
export const onlyDigits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");
export const sameDigits = (a: string | null | undefined, b: string | null | undefined): boolean => onlyDigits(a) === onlyDigits(b);
