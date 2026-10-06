// Colori del planning pulizie, con un significato preciso e uguale ovunque (Pulizie, Dashboard):
//   rosso  = c'è una partenza e nessun arrivo   (la camera si svuota)
//   verde  = c'è un arrivo e nessuna partenza   (la camera si riempie)
//   rosso + verde, metà e metà = partenza e arrivo lo stesso giorno (turnover: la camera passa da un ospite all'altro)
//   azzurro = riassetto (l'ospite è in casa, si rifà la camera)
//   grigio  = niente da fare (fermo)
export type CleanAct = "turnover" | "partenza" | "arrivo" | "riassetto" | "niente";

const ERR = "var(--err)", OK = "var(--ok)";
const SOLID: Record<Exclude<CleanAct, "turnover">, string> = { partenza: ERR, arrivo: OK, riassetto: "#0891B2", niente: "var(--faint)" };

/** Colore pieno (testo, puntino, barra). Il turnover è metà e metà. */
export const cleanBar = (a: CleanAct): string => (a === "turnover" ? `linear-gradient(90deg, ${ERR} 50%, ${OK} 50%)` : SOLID[a]);
/** Fondo tenue di pillole e tessere. */
export const cleanTint = (a: CleanAct, pct = 14): string => {
  const mix = (c: string) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  return a === "turnover" ? `linear-gradient(90deg, ${mix(ERR)} 50%, ${mix(OK)} 50%)` : mix(SOLID[a]);
};
/** Colore del testo sopra il fondo tenue (il turnover usa il testo normale, perché ha due colori). */
export const cleanText = (a: CleanAct): string => (a === "turnover" ? "var(--txt)" : SOLID[a]);
/** Colore unico per contatori e icone dove una sfumatura non si può usare (il turnover è un po' di entrambi: si mostra il rosso della partenza). */
export const cleanSolid = (a: CleanAct): string => (a === "turnover" ? ERR : SOLID[a]);
