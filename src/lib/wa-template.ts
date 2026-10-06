// Modelli WhatsApp (Meta): per scrivere PER PRIMI a un ospite (fuori dalle 24 ore dal suo ultimo messaggio) WhatsApp accetta solo modelli approvati.
// Un modello è un testo con variabili {{1}}, {{2}}… Qui si ricava, dal testo del messaggio automatico di Xenora, il testo da incollare in Meta
// e l'elenco dei valori da inviare, nello stesso ordine: i segnaposto ({ospite}, {struttura}, {link_guida}…) diventano le variabili in ordine di apparizione.

export interface WaTemplateDraft {
  body: string;        // testo da incollare in Meta, con {{1}}, {{2}}…
  tokens: string[];    // segnaposto di Xenora corrispondenti a {{1}}, {{2}}… (uno per variabile)
  warnings: string[];  // cose che Meta rifiuta di solito
}

export function waTemplateFrom(text: string): WaTemplateDraft {
  const tokens: string[] = [];
  const body = (text ?? "").replace(/\{([a-z_]+)\}/gi, (_m, k: string) => {
    const key = k.toLowerCase();
    let i = tokens.indexOf(key);
    if (i < 0) { tokens.push(key); i = tokens.length - 1; }
    return `{{${i + 1}}}`;
  }).trim();
  const warnings: string[] = [];
  if (/^\{\{\d+\}\}/.test(body)) warnings.push("Meta non accetta una variabile all'inizio del testo: inizia con una parola (es. «Buongiorno {ospite}»).");
  if (/\{\{\d+\}\}\s*$/.test(body)) warnings.push("Meta non accetta una variabile alla fine del testo: chiudi con una frase (es. «A presto!»).");
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) warnings.push("Due variabili attaccate non sono ammesse: separale con una parola.");
  if (/\n{3,}/.test(body)) warnings.push("Meta non accetta più di due a capo di fila.");
  if (body.length > 1024) warnings.push("Il testo supera i 1024 caratteri consentiti da Meta.");
  if (tokens.length > 0 && body.replace(/\{\{\d+\}\}/g, "").trim().length < tokens.length * 8) warnings.push("Troppe variabili rispetto al testo: Meta potrebbe rifiutarlo.");
  return { body, tokens, warnings };
}
