// Onboarding "porta i tuoi dati": template CSV scaricabile + utilità anti-duplicato.
// File nuovo e isolato — non tocca lo store, il parser ICS o altri moduli.
// Le colonne rispecchiano i campi che la pagina /importa sa mappare in automatico.

import { normName, toISO } from "../ics";

// Colonne attese nel template (l'ordine è quello del file scaricato dall'utente).
export const TEMPLATE_COLUMNS = [
  "Nome ospite",
  "Email",
  "Telefono",
  "Struttura",
  "Camera / tipologia",
  "Check-in",
  "Check-out",
  "Adulti",
  "Bambini",
  "Totale",
  "Canale",
  "Note",
] as const;

// Due righe di esempio: mostrano che vanno bene sia le date ISO (YYYY-MM-DD) sia DD/MM/YYYY,
// e sia il punto sia la virgola come separatore decimale dell'importo.
const SAMPLE_ROWS: string[][] = [
  ["Mario Rossi", "mario.rossi@email.it", "+39 333 1234567", "", "Matrimoniale vista mare", "2025-06-12", "2025-06-15", "2", "0", "420", "Diretta", "Arrivo previsto ore 15"],
  ["Anna Bianchi", "anna@email.com", "+39 340 7654321", "", "Doppia", "20/07/2025", "23/07/2025", "2", "1", "510,50", "Booking.com", "Culla richiesta"],
];

// Racchiude tra virgolette solo se serve (contiene virgola, punto e virgola, virgolette o a capo).
function csvCell(v: string): string {
  return /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Contenuto del template CSV. Con BOM UTF-8 così Excel apre correttamente gli accenti.
export function buildTemplateCsv(): string {
  const lines = [
    TEMPLATE_COLUMNS.join(","),
    ...SAMPLE_ROWS.map((r) => r.map(csvCell).join(",")),
  ];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// Chiave anti-duplicato: stessa struttura + ospite (normalizzato) + check-in + check-out.
// Usata sia per confrontare con le prenotazioni già presenti sia per scartare i doppioni
// interni allo stesso file.
export function bookingDedupeKey(structureId: string, guestName: string, checkIn: string, checkOut: string): string {
  return [structureId, normName(guestName), toISO(checkIn), toISO(checkOut)].join("|");
}
