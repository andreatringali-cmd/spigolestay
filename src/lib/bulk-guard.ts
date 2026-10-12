// Rete di sicurezza per le cancellazioni di massa (logica pura, senza dipendenze dal browser).
// Dal 20 o più elementi cancellati in un colpo, l'interfaccia chiede di scrivere ELIMINA e scarica prima una copia JSON.

export const BULK_THRESHOLD = 20;
export const CONFIRM_WORD = "ELIMINA";

/** True se la cancellazione di `count` elementi richiede conferma forte + copia di sicurezza. */
export function needsBulkGuard(count: number): boolean {
  return Number.isFinite(count) && count >= BULK_THRESHOLD;
}

/** Accetta ELIMINA in maiuscolo o minuscolo, ignorando gli spazi (anche in mezzo). */
export function isConfirmWordOk(input: string): boolean {
  return String(input ?? "").replace(/\s+/g, "").toUpperCase() === CONFIRM_WORD;
}

const p2 = (n: number) => String(n).padStart(2, "0");

function slug(kind: string): string {
  const s = String(kind ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "dati";
}

/** Es. xenora-copia-prima-di-eliminare-ospiti-2026-10-12-0930.json (data e ora locali). */
export function backupFileName(kind: string, now: Date = new Date()): string {
  const d = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  const h = `${p2(now.getHours())}${p2(now.getMinutes())}`;
  return `xenora-copia-prima-di-eliminare-${slug(kind)}-${d}-${h}.json`;
}

export interface BulkBackupPayload<T = unknown> {
  app: "xenora";
  tipo: "copia-prima-di-eliminare";
  elementi: string;
  creatoIl: string;
  totale: number;
  dati: T[];
}

export function buildBackupPayload<T>(kind: string, items: T[], now: Date = new Date()): BulkBackupPayload<T> {
  return { app: "xenora", tipo: "copia-prima-di-eliminare", elementi: slug(kind), creatoIl: now.toISOString(), totale: items.length, dati: items };
}
