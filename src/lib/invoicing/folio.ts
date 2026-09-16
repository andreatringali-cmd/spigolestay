// Logica FISCALE pura del modulo fatturazione (nessun I/O → unit-test friendly).
// Costruisce le righe del documento dal folio di una prenotazione, applica il
// raggruppamento IVA per aliquota, scala gli acconti, calcola il bollo secondo
// il regime. Importi SEMPRE in centesimi interi.

export type Regime = "imprenditoriale_ordinario" | "forfettario" | "non_imprenditoriale";
export type DocKind = "ricevuta_non_fiscale" | "fattura" | "nota_di_credito";
export type SourceKind = "accommodation" | "cleaning" | "extra" | "city_tax" | "rounding";

export const BOLLO_THRESHOLD_CENTS = 7747; // 77,47 €
export const BOLLO_CENTS = 200;            // 2,00 €
export const FORFETTARIO_NOTE =
  "Operazione effettuata ai sensi dell'art. 1, commi 54-89, L. 190/2014 - regime forfettario. " +
  "Operazione non soggetta a IVA. Imposta di bollo assolta in modo virtuale ove dovuta.";

// Riga "grezza" del folio, prima del raggruppamento.
export interface FolioLine {
  folioRef: string;      // id stabile della riga (per anti doppia-fatturazione)
  description: string;
  qty: number;
  unitCents: number;     // imponibile unitario in centesimi
  vatRate: number;       // 10 | 22 | 0
  outOfScope?: boolean;  // fuori campo IVA (tassa di soggiorno, art. 15)
  sourceKind: SourceKind;
}

export interface DocumentLineDraft {
  pos: number;
  description: string;
  qty: number;
  unitPriceCents: number;
  vatRate: number;
  vatNature: string | null;   // N1 fuori campo / N2.2 forfettario / null
  lineTotalCents: number;
  sourceKind: SourceKind;
  folioRef: string;
}

export interface DraftTotals {
  taxableCents: number;
  vatCents: number;
  outOfScopeCents: number;
  bolloCents: number;
  roundingCents: number;
  totalCents: number;
  advanceCents: number;
  toPayCents: number;
}

export interface BuildInput {
  regime: Regime;
  docKind?: DocKind;              // forzato a ricevuta per non_imprenditoriale
  folio: FolioLine[];
  selectedRefs?: string[];       // sottoinsieme di folioRef da fatturare (default: tutte)
  advanceCents?: number;         // acconti già incassati
  rounding?: boolean;            // arrotondamento all'euro del totale
  sendSdiDefault?: boolean;
}

export interface BuildResult {
  docKind: DocKind;
  lines: DocumentLineDraft[];
  totals: DraftTotals;
  sendSdi: boolean;
  regimeNote: string | null;
}

const round = (n: number) => Math.round(n);

// Converte euro (numero del prototipo) in centesimi interi.
export const toCents = (eur: number | undefined): number => round((eur || 0) * 100);

// Applica il regime a una riga: determina aliquota effettiva e natura IVA.
function applyRegime(line: FolioLine, regime: Regime): { rate: number; nature: string | null } {
  if (line.outOfScope) return { rate: 0, nature: "N1" };               // fuori campo art. 15
  if (regime === "forfettario") return { rate: 0, nature: "N2.2" };    // non soggetta
  if (regime === "non_imprenditoriale") return { rate: 0, nature: null };
  return { rate: line.vatRate, nature: null };                          // ordinario: IVA per aliquota
}

export function buildDocumentDraft(input: BuildInput): BuildResult {
  const regime = input.regime;
  const docKind: DocKind = regime === "non_imprenditoriale"
    ? "ricevuta_non_fiscale"
    : (input.docKind ?? "fattura");

  const sel = input.selectedRefs && input.selectedRefs.length
    ? new Set(input.selectedRefs)
    : null;
  const picked = input.folio.filter((l) => (sel ? sel.has(l.folioRef) : true) && (l.qty !== 0));

  // Righe documento (con aliquota/natura per regime).
  const lines: DocumentLineDraft[] = picked.map((l, i) => {
    const { rate, nature } = applyRegime(l, regime);
    const lineTotal = round(l.unitCents * l.qty);
    return {
      pos: i + 1,
      description: l.description,
      qty: l.qty,
      unitPriceCents: l.unitCents,
      vatRate: rate,
      vatNature: nature,
      lineTotalCents: lineTotal,
      sourceKind: l.sourceKind,
      folioRef: l.folioRef,
    };
  });

  // Raggruppamento IVA per aliquota: l'imposta si calcola sulla base sommata per aliquota.
  const taxableCents = lines.filter((l) => !l.vatNature || l.vatNature === "N2.2")
    .reduce((a, l) => a + l.lineTotalCents, 0);
  const outOfScopeCents = lines.filter((l) => l.vatNature === "N1")
    .reduce((a, l) => a + l.lineTotalCents, 0);

  const byRate = new Map<number, number>();
  for (const l of lines) {
    if (l.vatRate > 0) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + l.lineTotalCents);
  }
  let vatCents = 0;
  for (const [rate, base] of byRate) vatCents += round(base * rate / 100);

  // Bollo: solo forfettario, se il totale (imponibile + fuori campo) supera 77,47 €.
  const preBollo = taxableCents + vatCents + outOfScopeCents;
  const bolloCents = (regime === "forfettario" && preBollo > BOLLO_THRESHOLD_CENTS) ? BOLLO_CENTS : 0;

  let totalCents = taxableCents + vatCents + outOfScopeCents + bolloCents;

  // Arrotondamento opzionale del totale all'euro.
  let roundingCents = 0;
  if (input.rounding) {
    const rounded = round(totalCents / 100) * 100;
    roundingCents = rounded - totalCents;
    totalCents = rounded;
  }

  const advanceCents = Math.max(0, input.advanceCents ?? 0);
  const toPayCents = Math.max(0, totalCents - advanceCents);

  const sendSdi = docKind === "ricevuta_non_fiscale"
    ? false
    : (input.sendSdiDefault ?? (regime !== "non_imprenditoriale"));

  return {
    docKind,
    lines,
    totals: { taxableCents, vatCents, outOfScopeCents, bolloCents, roundingCents, totalCents, advanceCents, toPayCents },
    sendSdi,
    regimeNote: regime === "forfettario" ? FORFETTARIO_NOTE : null,
  };
}
