// Riconciliazione di un'importazione: ogni riga del file ha un ESITO (nuova, già presente, scartata con motivo) e, finita l'importazione,
// si CONFRONTA il file con quello che c'è davvero in Xenora (righe trovate, importi). Serve a chi migra da un altro gestionale per sapere,
// con certezza e non a occhio, che le prenotazioni sono arrivate tutte.
// Stesso criterio di lib/guest-key (senza accenti né maiuscole): copiato qui per tenere il file autonomo e collaudabile con Node puro.
const normName = (s?: string) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export type OutcomeStatus = "nuova" | "gia_presente" | "scartata";

export interface ImportOutcome {
  row: number;            // numero di riga nel file (la 1 è l'intestazione)
  guest: string;
  checkIn: string;        // ISO, vuoto se non riconosciuta
  checkOut: string;
  room: string;           // camera/tipologia scritta nel file
  code: string;           // codice prenotazione del canale
  extId?: string;         // identificativo stabile (es. octorate:123)
  total?: number;
  status: OutcomeStatus;
  reason?: string;        // perché è stata scartata o considerata doppione
}

export interface ImportStats {
  fileRows: number; created: number; already: number; skipped: number;
  multiGroups: number; multiRooms: number;
  guestsNew: number; guestsReused: number; relinked: number; noRoom: number;
}

export interface ImportReport { at: number; fileName: string; structureId: string; outcomes: ImportOutcome[]; stats: ImportStats }

export interface VerifyBooking { extId?: string; guestName: string; checkIn: string; checkOut: string; total?: number }

export interface Verification {
  expected: number;                 // righe del file che dovevano esserci (nuove + già presenti)
  found: number;                    // quelle trovate in Xenora
  missing: ImportOutcome[];         // righe del file che in Xenora non si trovano
  fileTotal: number;                // somma importi del file (righe attese)
  systemTotal: number;              // somma importi in Xenora (righe trovate)
  amountDiffs: { outcome: ImportOutcome; system: number }[]; // righe con importo diverso
}

const key = (name: string, ci: string, co: string) => `${normName(name)}|${ci}|${co}`;
const eq = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Confronta gli esiti con le prenotazioni presenti ORA nella struttura. Prima per identificativo, poi (se manca) per ospite+date contando le copie. */
export function verifyOutcomes(outcomes: ImportOutcome[], bookings: VerifyBooking[]): Verification {
  const byExt = new Map<string, VerifyBooking>();
  const byKey = new Map<string, VerifyBooking[]>();
  for (const b of bookings) {
    if (b.extId) byExt.set(b.extId, b);
    const k = key(b.guestName, b.checkIn, b.checkOut);
    const arr = byKey.get(k); if (arr) arr.push(b); else byKey.set(k, [b]);
  }
  const used = new Set<VerifyBooking>();
  const expected = outcomes.filter((o) => o.status !== "scartata");
  const missing: ImportOutcome[] = [];
  const amountDiffs: Verification["amountDiffs"] = [];
  let found = 0, fileTotal = 0, systemTotal = 0;
  for (const o of expected) {
    fileTotal += o.total ?? 0;
    let hit: VerifyBooking | undefined;
    if (o.extId && byExt.has(o.extId)) hit = byExt.get(o.extId);
    else {
      const arr = byKey.get(key(o.guest, o.checkIn, o.checkOut));
      hit = arr?.find((b) => !used.has(b));
    }
    if (!hit) { missing.push(o); continue; }
    used.add(hit);
    found++;
    systemTotal += hit.total ?? 0;
    if (o.total !== undefined && !eq(o.total, hit.total ?? 0)) amountDiffs.push({ outcome: o, system: hit.total ?? 0 });
  }
  return { expected: expected.length, found, missing, fileTotal, systemTotal, amountDiffs };
}

/** Quante righe scartate per ciascun motivo. */
export function skipReasons(outcomes: ImportOutcome[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const o of outcomes) if (o.status === "scartata") m.set(o.reason || "motivo non indicato", (m.get(o.reason || "motivo non indicato") ?? 0) + 1);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

const STATUS_LABEL: Record<OutcomeStatus, string> = { nuova: "importata", gia_presente: "già presente", scartata: "scartata" };

/** CSV (separatore ;, con BOM per Excel) con una riga per ogni riga del file e il suo esito; con `missingKeys` marca le righe che non si trovano. */
export function outcomesToCsv(outcomes: ImportOutcome[], missing?: Set<ImportOutcome>): string {
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["riga", "ospite", "check-in", "check-out", "camera nel file", "codice", "importo", "esito", "motivo"];
  const lines = outcomes.map((o) => [
    o.row, o.guest, o.checkIn, o.checkOut, o.room, o.code, o.total ?? "",
    missing?.has(o) ? "NON TROVATA in Xenora" : STATUS_LABEL[o.status], o.reason ?? "",
  ].map(esc).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n");
}
