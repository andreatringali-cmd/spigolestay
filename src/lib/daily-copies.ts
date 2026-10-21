// Copie giornaliere (migrazione 0018): raggruppamento puro per l'elenco admin «Copie disponibili». Niente rete, niente browser.
// Le righe arrivano da app_state_daily / org_state_daily SENZA la colonna `data` (solo giorno, dimensione, rev, istante della copia).

export interface CopyRow { id: string; day: string; bytes: number; rev: number; takenAt: string }
export interface AccountCopies {
  kind: "user" | "org";
  id: string;
  label: string;
  copies: CopyRow[];       // dalla più recente alla più vecchia
  totalBytes: number;
  lastDay: string | null;
}

/** Raggruppa per account (id) e ordina le copie dalla più recente. `labels` = etichetta leggibile per id (email o nome organizzazione). */
export function groupCopies(kind: "user" | "org", rows: CopyRow[], labels: Map<string, string>): AccountCopies[] {
  const by = new Map<string, CopyRow[]>();
  for (const r of rows) {
    if (!r || typeof r.id !== "string" || typeof r.day !== "string") continue;
    const list = by.get(r.id) ?? [];
    list.push({ id: r.id, day: r.day, bytes: Number(r.bytes) || 0, rev: Number(r.rev) || 0, takenAt: String(r.takenAt ?? "") });
    by.set(r.id, list);
  }
  const out: AccountCopies[] = [];
  for (const [id, copies] of by) {
    copies.sort((a, b) => b.day.localeCompare(a.day));
    out.push({
      kind, id, label: labels.get(id) || (kind === "org" ? "Organizzazione senza nome" : "Utente senza email") + ` (${id.slice(0, 8)})`,
      copies, totalBytes: copies.reduce((s, c) => s + c.bytes, 0), lastDay: copies[0]?.day ?? null,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "it"));
}

/** «1,2 MB», «340 KB», «512 B» — in italiano (virgola decimale). */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`.replace(".", ",");
  const mb = kb / 1024;
  return `${mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`.replace(".", ",");
}
