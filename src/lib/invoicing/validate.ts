// Validazioni PURE (nessun I/O, nessun import → testabili con `node --test`) per il modulo
// fatturazione: formati di P.IVA / codice fiscale / codice destinatario / PEC / CAP / provincia
// e controlli di coerenza di un documento prima dell'emissione.
//
// Principio: BLOCCO (error) solo per ciò che è oggettivamente sbagliato (formato non valido,
// dato obbligatorio assente, incoerenza aritmetica); AVVISO (warn) per ciò che dipende dal caso
// (es. SdI potrebbe scartare). Nessuna regola fiscale nuova: solo formati pubblici del tracciato
// FatturaPA e le regole già presenti in folio.ts (bollo, forfettario).

export type IssueLevel = "error" | "warn";
export interface Issue { level: IssueLevel; field: string; msg: string }

const clean = (v: unknown) => String(v ?? "").trim();

// ---- Partita IVA italiana: 11 cifre + cifra di controllo (algoritmo ufficiale tipo Luhn) ----
export function normalizeVat(v: string): string {
  return clean(v).replace(/[\s.\-]/g, "").toUpperCase().replace(/^IT(?=\d{11}$)/, "");
}
export function isValidPartitaIvaIT(v: string): boolean {
  const s = normalizeVat(v);
  if (!/^\d{11}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(s[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(s[10]);
}

// ---- Codice fiscale: 16 caratteri (con carattere di controllo) oppure 11 cifre (società) ----
const CF_ODD: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
export function normalizeCf(v: string): string { return clean(v).replace(/\s/g, "").toUpperCase(); }
// "format": struttura valida? "checksum": anche il carattere di controllo torna?
export function checkCodiceFiscale(v: string): { format: boolean; checksum: boolean } {
  const s = normalizeCf(v);
  if (/^\d{11}$/.test(s)) return { format: true, checksum: isValidPartitaIvaIT(s) };
  // Le lettere LMNPQRSTUV possono sostituire le cifre (omocodia).
  if (!/^[A-Z]{6}[\dLMNPQRSTUV]{2}[A-EHLMPR-T][\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{3}[A-Z]$/.test(s)) return { format: false, checksum: false };
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = s[i];
    if (i % 2 === 0) sum += CF_ODD[ch];
    else sum += /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
  }
  return { format: true, checksum: String.fromCharCode(65 + (sum % 26)) === s[15] };
}

// ---- Altri formati ----
// Codice destinatario SdI: 7 caratteri alfanumerici (6 per le PA). "0000000" = nessun codice (usa PEC/cassetto),
// "XXXXXXX" = cliente estero.
export function isValidSdiCode(v: string): boolean { return /^[A-Za-z0-9]{6,7}$/.test(clean(v)); }
export function isValidPec(v: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean(v)); }
export function isValidCapIT(v: string): boolean { return /^\d{5}$/.test(clean(v)); }
export function isValidProvinceIT(v: string): boolean { return /^[A-Za-z]{2}$/.test(clean(v)); }

// ---- Anagrafica (usata sia per l'emittente sia per l'intestatario) ----
export interface PartyInput {
  name?: string; vat?: string | null; taxCode?: string | null; country?: string | null;
  address?: string | null; city?: string | null; cap?: string | null; province?: string | null;
}

export function validateParty(p: PartyInput, prefix: string, who: string): Issue[] {
  const out: Issue[] = [];
  const country = (clean(p.country) || "IT").toUpperCase();
  const it = country === "IT";
  const vat = clean(p.vat), cf = clean(p.taxCode);
  if (vat && it && !isValidPartitaIvaIT(vat)) out.push({ level: "error", field: `${prefix}.vat`, msg: `${who}: la Partita IVA non è valida (servono 11 cifre con cifra di controllo corretta).` });
  if (cf && it) {
    const r = checkCodiceFiscale(cf);
    if (!r.format) out.push({ level: "error", field: `${prefix}.taxCode`, msg: `${who}: il codice fiscale non ha un formato valido (16 caratteri, oppure 11 cifre per le società).` });
    else if (!r.checksum) out.push({ level: "warn", field: `${prefix}.taxCode`, msg: `${who}: il carattere di controllo del codice fiscale non torna, ricontrolla di averlo digitato bene.` });
  }
  if (it && clean(p.cap) && !isValidCapIT(clean(p.cap))) out.push({ level: "error", field: `${prefix}.cap`, msg: `${who}: il CAP deve avere 5 cifre.` });
  if (it && clean(p.province) && !isValidProvinceIT(clean(p.province))) out.push({ level: "error", field: `${prefix}.province`, msg: `${who}: la provincia va indicata con la sigla di 2 lettere (es. SR).` });
  return out;
}

// ---- Controlli di un documento prima dell'emissione ----
export interface DocLineInput { description: string; qty: number; unitEur: number; vat: string }
export interface DocCheckInput {
  docKind: string;                 // fattura | nota_di_credito | ricevuta_non_fiscale
  regime: string | null;           // regime con cui è stato creato il documento
  issueDate: string;               // YYYY-MM-DD
  dueDate: string;                 // YYYY-MM-DD o ""
  sendSdi: boolean;
  counterpart: { kind: string; name: string; lastName?: string; vat: string; tax_code: string; country: string; address: string; city: string; cap: string; province: string };
  sdiCode: string;
  pec: string;
  lines: DocLineInput[];
  bollo: boolean;
  preBolloCents: number;           // imponibile + IVA + fuori campo, senza bollo
  totalCents: number;
  bolloThresholdCents: number;     // soglia 77,47 € (da folio.ts)
  issuer: { denominazione?: string | null; vat?: string | null; tax_code?: string | null; address?: string | null; city?: string | null; cap?: string | null; province?: string | null } | null;
}

export function validateDocument(d: DocCheckInput): Issue[] {
  const out: Issue[] = [];
  const isReceipt = d.docKind === "ricevuta_non_fiscale";
  const electronic = d.sendSdi && !isReceipt;
  const cp = d.counterpart;
  const country = (clean(cp.country) || "IT").toUpperCase();
  const it = country === "IT";

  // Emittente (per account): senza dati l'XML/PDF esce vuoto o viene scartato.
  if (!isReceipt) {
    const iss = d.issuer;
    if (!iss || (!clean(iss.denominazione) && !clean(iss.vat) && !clean(iss.tax_code))) {
      out.push({ level: "error", field: "issuer", msg: "Mancano i dati dell'emittente: completali in Impostazioni fattura prima di emettere." });
    } else {
      if (!clean(iss.denominazione)) out.push({ level: "error", field: "issuer.denominazione", msg: "Emittente: manca la denominazione (Impostazioni fattura)." });
      if (!clean(iss.vat) && !clean(iss.tax_code)) out.push({ level: "error", field: "issuer.vat", msg: "Emittente: manca la Partita IVA o il codice fiscale (Impostazioni fattura)." });
      if (electronic && (!clean(iss.address) || !clean(iss.cap) || !clean(iss.city))) out.push({ level: "warn", field: "issuer.address", msg: "Emittente: indirizzo, CAP e città sono richiesti dal tracciato della fattura elettronica (Impostazioni fattura)." });
    }
  }

  // Intestatario
  if (!`${clean(cp.name)} ${clean(cp.lastName)}`.trim()) out.push({ level: "error", field: "counterpart.name", msg: "Indica il nome o la ragione sociale dell'intestatario." });
  out.push(...validateParty({ name: cp.name, vat: cp.vat, taxCode: cp.tax_code, country: cp.country, address: cp.address, city: cp.city, cap: cp.cap, province: cp.province }, "counterpart", "Intestatario"));
  if (electronic && it && !clean(cp.vat) && !clean(cp.tax_code)) out.push({ level: "error", field: "counterpart.taxCode", msg: "Intestatario italiano senza Partita IVA né codice fiscale: lo SdI scarta la fattura (serve almeno uno dei due)." });
  if (electronic && (!clean(cp.address) || !clean(cp.city) || (it && !clean(cp.cap)))) out.push({ level: "warn", field: "counterpart.address", msg: "Indirizzo, CAP e città dell'intestatario sono richiesti dal tracciato FatturaPA." });
  if (electronic) {
    if (clean(d.sdiCode) && !isValidSdiCode(d.sdiCode)) out.push({ level: "error", field: "sdiCode", msg: "Codice destinatario non valido: devono essere 7 caratteri alfanumerici (0000000 se il cliente non ne ha uno)." });
    if (clean(d.pec) && !isValidPec(d.pec)) out.push({ level: "error", field: "pec", msg: "L'indirizzo PEC non è valido." });
    if (!it && clean(d.sdiCode) && clean(d.sdiCode).toUpperCase() !== "XXXXXXX") out.push({ level: "warn", field: "sdiCode", msg: "Per un cliente estero il codice destinatario previsto è XXXXXXX." });
  }

  // Righe
  if (d.lines.length === 0) out.push({ level: "error", field: "lines", msg: "Aggiungi almeno una voce al documento." });
  d.lines.forEach((l, i) => {
    const n = i + 1;
    if (!clean(l.description) || clean(l.description) === "—") out.push({ level: "error", field: `lines.${i}.description`, msg: `Voce ${n}: manca la descrizione.` });
    if (!(l.qty > 0)) out.push({ level: "error", field: `lines.${i}.qty`, msg: `Voce ${n}: la quantità deve essere maggiore di zero.` });
    if (l.unitEur < 0) out.push({ level: "warn", field: `lines.${i}.unitEur`, msg: `Voce ${n}: prezzo negativo (sconto?). Verifica che sia voluto.` });
    if (l.vat === "0" && !isReceipt) out.push({ level: "error", field: `lines.${i}.vat`, msg: `Voce ${n}: l'aliquota 0% richiede una natura IVA: scegli "Fuori campo (N1)" o "Non sogg. (N2.2)".` });
    if (d.regime === "forfettario" && !isReceipt && l.vat !== "N1" && l.vat !== "N2.2") out.push({ level: "error", field: `lines.${i}.vat`, msg: `Voce ${n}: in regime forfettario non si applica IVA, usa "Non sogg. (N2.2)".` });
  });
  if (d.lines.length > 0 && d.totalCents === 0) out.push({ level: "warn", field: "total", msg: "Il totale del documento è zero." });

  // Date
  if (!clean(d.issueDate)) out.push({ level: "error", field: "issueDate", msg: "Indica la data di emissione." });
  if (clean(d.issueDate) && clean(d.dueDate) && d.dueDate < d.issueDate) out.push({ level: "error", field: "dueDate", msg: "La scadenza di pagamento è precedente alla data di emissione." });

  // Bollo: stessa regola già presente in folio.ts (forfettario, > 77,47 €).
  if (d.regime === "forfettario") {
    if (d.bollo && d.preBolloCents <= d.bolloThresholdCents) out.push({ level: "warn", field: "bollo", msg: "Il bollo da 2 € è spuntato ma l'importo non supera 77,47 €: di norma non è dovuto." });
    if (!d.bollo && d.preBolloCents > d.bolloThresholdCents) out.push({ level: "warn", field: "bollo", msg: "Importo oltre 77,47 € in regime forfettario: di norma è dovuto il bollo da 2 € (spunta \"Bollo virtuale\")." });
  }
  return out;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === "error");

// ---- Impostazioni emittente (Impostazioni fattura) ----
export interface IssuerSettingsInput {
  denominazione: string; vat: string; tax_code: string; address: string; city: string; cap: string; province: string; country: string; pec: string; sdi: string; regime: string;
}
export function validateIssuerSettings(s: IssuerSettingsInput): Issue[] {
  const out: Issue[] = [];
  const country = (clean(s.country) || "IT").toUpperCase();
  const it = country === "IT";
  if (!clean(s.denominazione)) out.push({ level: "warn", field: "denominazione", msg: "Manca la denominazione / ragione sociale: senza non si può emettere." });
  if (!clean(s.vat) && !clean(s.tax_code)) out.push({ level: "warn", field: "vat", msg: "Manca la Partita IVA o il codice fiscale: senza non si può emettere." });
  if (clean(s.vat) && it && !isValidPartitaIvaIT(s.vat)) out.push({ level: "error", field: "vat", msg: "La Partita IVA non è valida (11 cifre con cifra di controllo corretta)." });
  if (clean(s.tax_code) && it) {
    const r = checkCodiceFiscale(s.tax_code);
    if (!r.format) out.push({ level: "error", field: "tax_code", msg: "Il codice fiscale non ha un formato valido (16 caratteri, o 11 cifre per le società)." });
    else if (!r.checksum) out.push({ level: "warn", field: "tax_code", msg: "Il carattere di controllo del codice fiscale non torna: ricontrollalo." });
  }
  if (clean(s.cap) && it && !isValidCapIT(s.cap)) out.push({ level: "error", field: "cap", msg: "Il CAP deve avere 5 cifre." });
  if (clean(s.province) && it && !isValidProvinceIT(s.province)) out.push({ level: "error", field: "province", msg: "La provincia va indicata con la sigla di 2 lettere (es. SR)." });
  if (clean(s.pec) && !isValidPec(s.pec)) out.push({ level: "error", field: "pec", msg: "L'indirizzo PEC non è valido." });
  if (clean(s.sdi) && !isValidSdiCode(s.sdi)) out.push({ level: "error", field: "sdi", msg: "Il codice destinatario deve essere di 7 caratteri alfanumerici." });
  if (s.regime !== "non_imprenditoriale" && (!clean(s.address) || !clean(s.city) || !clean(s.cap))) out.push({ level: "warn", field: "address", msg: "Indirizzo, città e CAP sono richiesti dal tracciato della fattura elettronica." });
  return out;
}
