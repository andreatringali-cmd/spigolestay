// Plurale corretto per i testi italiani mostrati a persone: plural(1, "notte", "notti") → "1 notte", plural(3, "notte", "notti") → "3 notti".
// Per le altre lingue usare le chiavi dizionario (singolare/plurale) o countLabel di lib/mail/shell.
export function plural(n: number, uno: string, altri: string): string {
  return `${n} ${n === 1 ? uno : altri}`;
}
