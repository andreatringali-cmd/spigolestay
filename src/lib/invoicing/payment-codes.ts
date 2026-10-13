// Metodo di pagamento di una fattura elettronica: lo SdI vuole il CODICE (MP01…MP23), non il testo ("Bonifico bancario").
// Puro, senza import. Usato dall'XML interno (fatturapa.ts) e dal collegamento a Fatture in Cloud (provider.ts, campo ei_data.payment_method).

/** Codici ModalitaPagamento di FatturaPA (tabella ufficiale), solo quelli che Xenora offre o può incontrare. */
export const SDI_PAYMENT_CODES = {
  contanti: "MP01",
  assegno: "MP02",
  carta: "MP08",
  bonifico: "MP05",
  rid: "MP09",
  riba: "MP12",
  paypal: "MP08", // PayPal è un pagamento con carta/conto elettronico: MP08 (carta di pagamento) è la scelta più usata
  altro: "MP05",
} as const;

/** Da testo libero ("Bonifico bancario", "Carta", "Contanti"…) al codice MPxx. Un codice già valido (MP01…MP23) passa invariato; per il resto si ripiega sul bonifico. */
export function sdiPaymentCode(method?: string | null): string {
  const raw = (method ?? "").trim();
  if (/^MP(0[1-9]|1\d|2[0-3])$/i.test(raw)) return raw.toUpperCase();
  const m = raw.toLowerCase();
  if (/contant|cash/.test(m)) return SDI_PAYMENT_CODES.contanti;
  if (/assegn|cheque|check/.test(m)) return SDI_PAYMENT_CODES.assegno;
  if (/paypal/.test(m)) return SDI_PAYMENT_CODES.paypal;
  if (/carta|card|bancomat|pos|stripe/.test(m)) return SDI_PAYMENT_CODES.carta;
  if (/riba|ricevuta banc/.test(m)) return SDI_PAYMENT_CODES.riba;
  if (/\brid\b/.test(m)) return SDI_PAYMENT_CODES.rid;
  return SDI_PAYMENT_CODES.bonifico;
}
