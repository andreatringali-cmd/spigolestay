// Avviso (una sola volta per processo) quando un segreto/valore di configurazione usa il VALORE DI RIPIEGO scritto nel codice.
// Solo log: non cambia mai il valore usato, quindi token e credenziali già emessi restano validi.
const warned = new Set<string>();
export function warnFallbackOnce(name: string, detail: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[config] ${name} non impostata: uso il valore di ripiego del codice. ${detail}`);
}
