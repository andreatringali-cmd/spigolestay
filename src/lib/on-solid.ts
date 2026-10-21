// Classe del testo da usare SOPRA uno sfondo pieno quando il colore arriva da una variabile.
// - token di stato ("var(--ok)" ecc.) → coppia text-on-* (bianco in chiaro, quasi-nero in scuro)
// - altri token ("var(--dim)", ...) → coppia dell'accento
// - colori fissi scelti dall'utente (#hex, rgb) → bianco, come prima (non seguono il tema).
// Le classi sono scritte per intero così Tailwind le trova.
export function onSolid(color: string | undefined | null): string {
  const c = color ?? "";
  if (c.includes("--err")) return "text-on-err";
  if (c.includes("--warn")) return "text-on-warn";
  if (c.includes("--ok")) return "text-on-ok";
  if (c.includes("var(--")) return "text-on-focus";
  return "text-white";
}
