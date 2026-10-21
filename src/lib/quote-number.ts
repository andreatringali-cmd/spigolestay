// Numerazione dei preventivi: progressivo PER STRUTTURA e per anno (riparte da 1 ogni anno e per ogni struttura nuova).
// Prima il progressivo era unico per tutto l'account: il primo preventivo di una struttura nuova usciva come «2/2026» perché
// l'altra struttura ne aveva già emesso uno. I preventivi vecchi senza struttura contano per tutte (così non si ripete un numero già usato).
export function nextQuoteNumber(saved: { number?: number; createdAt: string; structureId?: string }[], structureId: string, year: number): number {
  return saved
    .filter((p) => new Date(p.createdAt).getFullYear() === year && (!p.structureId || p.structureId === structureId))
    .reduce((m, p) => Math.max(m, p.number ?? 0), 0) + 1;
}
