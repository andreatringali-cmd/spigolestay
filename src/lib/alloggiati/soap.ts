// Client SOAP reale del Web Service Alloggiati Web (Polizia di Stato).
// Endpoint ufficiale + metodi come da "Documento di Descrizione WS_ALLOGGIATI"
// (Centro Elettronico Nazionale, Rev. 01 del 13/01/2022):
//   - GenerateToken(Utente, Password, WsKey) -> { issued, expires, token }
//   - Authentication_Test(Utente, token)
//   - Test(Utente, token, ElencoSchedine[])      controllo preliminare
//   - Send(Utente, token, ElencoSchedine[])      invio effettivo
//   - Ricevuta(Utente, token, Data)              PDF ricevuta (base64)
//   - Tabella(Utente, token, tipo)               CSV tabelle di codifica
// SOAP 1.1: Content-Type text/xml, header SOAPAction, namespace "AlloggiatiService".
// Nessuna dipendenza esterna: costruzione/parsing XML via stringhe/regex.

export const ALLOGGIATI_ENDPOINT = "https://alloggiatiweb.poliziadistato.it/service/service.asmx";
const NS = "AlloggiatiService";

export interface EsitoOperazione { esito: boolean; errorCod: string; errorDes: string; errorDettaglio: string }
export interface TokenInfo { issued: string; expires: string; token: string }
export interface SchedinaEsito { esito: boolean; errorCod: string; errorDes: string; errorDettaglio: string }
export interface ElencoEsito { schedineValide: number; dettaglio: SchedinaEsito[] }

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xmlUnescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string): string => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].trim() : "";
};
const selfOrTag = (xml: string, name: string): string => {
  // Gestisce sia <Tag/> (vuoto) sia <Tag>valore</Tag>.
  if (new RegExp(`<${name}\\s*/>`, "i").test(xml)) return "";
  return tag(xml, name);
};

async function soapCall(method: string, innerXml: string): Promise<string> {
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><${method} xmlns="${NS}">${innerXml}</${method}></soap:Body></soap:Envelope>`;
  const res = await fetch(ALLOGGIATI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${NS}/${method}"` },
    body: envelope,
  });
  const text = await res.text();
  const fault = tag(text, "faultstring");
  if (fault) throw new Error(`SOAP fault: ${fault}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} dal servizio Alloggiati`);
  return text;
}

function parseEsito(xml: string, resultTag: string): EsitoOperazione {
  const block = tag(xml, resultTag) || xml;
  return {
    esito: /<esito>\s*true\s*<\/esito>/i.test(block),
    errorCod: selfOrTag(block, "ErroreCod"),
    errorDes: selfOrTag(block, "ErroreDes"),
    errorDettaglio: selfOrTag(block, "ErroreDettaglio"),
  };
}

function parseElencoEsito(xml: string): ElencoEsito {
  const result = tag(xml, "result");
  const schedineValide = parseInt(tag(result, "SchedineValide") || "0", 10) || 0;
  const dettaglio: SchedinaEsito[] = [];
  const dett = tag(result, "Dettaglio");
  const re = /<EsitoOperazioneServizio>([\s\S]*?)<\/EsitoOperazioneServizio>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dett))) {
    const b = m[1];
    dettaglio.push({
      esito: /<esito>\s*true\s*<\/esito>/i.test(b),
      errorCod: selfOrTag(b, "ErroreCod"),
      errorDes: selfOrTag(b, "ErroreDes"),
      errorDettaglio: selfOrTag(b, "ErroreDettaglio"),
    });
  }
  return { schedineValide, dettaglio };
}

const schedineXml = (records: string[]) =>
  `<ElencoSchedine>${records.map((r) => `<string>${xmlEscape(r)}</string>`).join("")}</ElencoSchedine>`;

// --- Metodi ---

export async function generateToken(utente: string, password: string, wsKey: string): Promise<{ result: EsitoOperazione; token: TokenInfo }> {
  const xml = await soapCall("GenerateToken",
    `<Utente>${xmlEscape(utente)}</Utente><Password>${xmlEscape(password)}</Password><WsKey>${xmlEscape(wsKey)}</WsKey>`);
  const tokenBlock = tag(xml, "GenerateTokenResult");
  return {
    result: parseEsito(xml, "result"),
    token: { issued: tag(tokenBlock, "issued"), expires: tag(tokenBlock, "expires"), token: tag(tokenBlock, "token") },
  };
}

export async function authenticationTest(utente: string, token: string): Promise<EsitoOperazione> {
  const xml = await soapCall("Authentication_Test", `<Utente>${xmlEscape(utente)}</Utente><token>${xmlEscape(token)}</token>`);
  return parseEsito(xml, "Authentication_TestResult");
}

export async function testSchedine(utente: string, token: string, records: string[]): Promise<{ result: EsitoOperazione; elenco: ElencoEsito }> {
  const xml = await soapCall("Test", `<Utente>${xmlEscape(utente)}</Utente><token>${xmlEscape(token)}</token>${schedineXml(records)}`);
  return { result: parseEsito(xml, "TestResult"), elenco: parseElencoEsito(xml) };
}

export async function sendSchedine(utente: string, token: string, records: string[]): Promise<{ result: EsitoOperazione; elenco: ElencoEsito }> {
  const xml = await soapCall("Send", `<Utente>${xmlEscape(utente)}</Utente><token>${xmlEscape(token)}</token>${schedineXml(records)}`);
  return { result: parseEsito(xml, "SendResult"), elenco: parseElencoEsito(xml) };
}

// Data formato DateTime (yyyy-mm-ddT00:00:00). Ricevuta disponibile per gli ultimi 30gg (escluso oggi).
export async function ricevuta(utente: string, token: string, isoDate: string): Promise<{ result: EsitoOperazione; pdfBase64: string }> {
  const data = `${isoDate.slice(0, 10)}T00:00:00`;
  const xml = await soapCall("Ricevuta", `<Utente>${xmlEscape(utente)}</Utente><token>${xmlEscape(token)}</token><Data>${data}</Data>`);
  return { result: parseEsito(xml, "RicevutaResult"), pdfBase64: tag(xml, "PDF") };
}

// tipo: "Luoghi" | "Tipi_Documento" | "Tipi_Alloggiato" | "TipoErrore" | "ListaAppartamenti" (TipoTabella).
export async function tabella(utente: string, token: string, tipo: string): Promise<{ result: EsitoOperazione; csv: string }> {
  const xml = await soapCall("Tabella", `<Utente>${xmlEscape(utente)}</Utente><token>${xmlEscape(token)}</token><tipo>${tipo}</tipo>`);
  return { result: parseEsito(xml, "TabellaResult"), csv: xmlUnescape(tag(xml, "CSV")) };
}
