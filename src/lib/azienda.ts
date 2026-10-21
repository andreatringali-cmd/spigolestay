// Dati dell'azienda che gestisce Xenora, in UN SOLO punto.
// L'azienda del titolare non è ancora stata aperta: finché i dati non esistono NON si inventa nulla e ogni voce
// resta un segnaposto visibile e uniforme «[DA COMPLETARE: …]» (così si trova anche con una ricerca nel codice).
// Alla data di apertura basta sostituire i valori qui sotto: Termini, Privacy, Cookie, footer di login/prezzi/pagine legali
// li leggono tutti da questo file. Elenco completo e passi successivi: docs/DATI-AZIENDA.md.

export const DA_COMPLETARE = (cosa: string) => `[DA COMPLETARE: ${cosa}]`;
/** true finché la voce è ancora un segnaposto (utile per i test e per nascondere righe vuote). */
export const isSegnaposto = (v: string) => v.startsWith("[DA COMPLETARE");

export const AZIENDA = {
  /** Nome del prodotto: è un marchio, NON una persona giuridica. */
  prodotto: "Xenora",
  /** Denominazione / ragione sociale con forma giuridica (es. «… S.r.l.»). */
  denominazione: DA_COMPLETARE("denominazione sociale"),
  partitaIva: DA_COMPLETARE("partita IVA"),
  codiceFiscale: DA_COMPLETARE("codice fiscale"),
  /** Sede legale completa: via, numero, CAP, città, provincia. */
  sede: DA_COMPLETARE("sede legale"),
  pec: DA_COMPLETARE("indirizzo PEC"),
  /** Contatto per richieste privacy e diritti dell'interessato. Oggi coincide con la casella generale, già attiva. */
  emailPrivacy: "info@xenora.it",
  /** Casella generale (assistenza, richieste di accesso). Già attiva: è quella usata dal modulo demo e dalla pagina Prezzi. */
  emailContatti: "info@xenora.it",
  /** Sito vetrina (esiste già). */
  sitoVetrina: "https://xenoradigitalsolutions.com",
} as const;

/** Riga unica per i footer: «© 2026 Xenora · <denominazione>». */
export const copyrightRiga = (anno: number) => `© ${anno} ${AZIENDA.prodotto} · ${AZIENDA.denominazione}`;
