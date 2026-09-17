// Generatore XML FatturaPA 1.2.2 (formato FPR12, privati/imprese) dal payload
// normalizzato di Xenora. Openapi.it accetta l'XML su POST /invoices; qui lo
// costruiamo in modo deterministico. Copre i casi B&B: fattura (TD01) e nota di
// credito (TD04), regime ordinario o forfettario (con Natura es. N2.2), bollo.
import type { EInvoicePayload } from "./provider";

const esc = (s: string | null | undefined) =>
  (s ?? "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (cents: number) => (cents / 100).toFixed(2);       // importi 2 decimali
const rate = (r: number) => r.toFixed(2);                       // aliquote 2 decimali
const ymd = (iso: string) => (iso || "").slice(0, 10);         // AAAA-MM-GG
// ProgressivoInvio alfanumerico (max 10): base36 dal docId/tempo.
const progressivo = (seed: string) => (parseInt(seed.replace(/\D/g, "").slice(0, 12) || "0", 10) || Date.now()).toString(36).toUpperCase().slice(0, 10);

const tipoDoc = (kind: string, sdiType?: string) => sdiType || (kind === "nota_di_credito" ? "TD04" : "TD01");

function anagraficaCliente(c: EInvoicePayload["cliente"]): string {
  // Privato → Nome/Cognome se possibile; altrimenti Denominazione.
  if (c.kind === "privato") {
    const parts = (c.name || "").trim().split(/\s+/);
    if (parts.length >= 2) {
      const nome = parts.shift()!; const cognome = parts.join(" ");
      return `<Nome>${esc(nome)}</Nome><Cognome>${esc(cognome)}</Cognome>`;
    }
  }
  return `<Denominazione>${esc((c.name || "Cliente").slice(0, 80))}</Denominazione>`;
}

function idFiscaleIva(paese: string, codice?: string | null): string {
  return `<IdFiscaleIVA><IdPaese>${esc(paese)}</IdPaese><IdCodice>${esc(codice || "")}</IdCodice></IdFiscaleIVA>`;
}

function sede(a: { address?: string | null; cap?: string | null; city?: string | null; province?: string | null; country?: string }): string {
  return `<Sede>` +
    `<Indirizzo>${esc((a.address || "-").slice(0, 60))}</Indirizzo>` +
    `<CAP>${esc((a.cap || "00000").replace(/\D/g, "").padStart(5, "0").slice(0, 5))}</CAP>` +
    `<Comune>${esc((a.city || "-").slice(0, 60))}</Comune>` +
    (a.province ? `<Provincia>${esc(a.province.slice(0, 2).toUpperCase())}</Provincia>` : "") +
    `<Nazione>${esc(a.country || "IT")}</Nazione>` +
    `</Sede>`;
}

// Raggruppa i riepiloghi IVA per (aliquota, natura).
function riepiloghi(p: EInvoicePayload): string {
  const groups = new Map<string, { aliquota: number; natura: string | null; imponibile: number; imposta: number }>();
  for (const l of p.lines) {
    const key = `${l.vatRate}|${l.vatNature ?? ""}`;
    const g = groups.get(key) ?? { aliquota: l.vatRate, natura: l.vatNature ?? null, imponibile: 0, imposta: 0 };
    g.imponibile += l.lineTotalCents;
    g.imposta += Math.round(l.lineTotalCents * (l.vatRate / 100));
    groups.set(key, g);
  }
  return Array.from(groups.values()).map((g) =>
    `<DatiRiepilogo>` +
    `<AliquotaIVA>${rate(g.aliquota)}</AliquotaIVA>` +
    (g.natura ? `<Natura>${esc(g.natura)}</Natura>` : "") +
    `<ImponibileImporto>${eur(g.imponibile)}</ImponibileImporto>` +
    `<Imposta>${eur(g.imposta)}</Imposta>` +
    `<EsigibilitaIVA>I</EsigibilitaIVA>` +
    `</DatiRiepilogo>`
  ).join("");
}

function dettaglioLinee(p: EInvoicePayload): string {
  return p.lines.map((l, i) =>
    `<DettaglioLinee>` +
    `<NumeroLinea>${i + 1}</NumeroLinea>` +
    `<Descrizione>${esc((l.description || "Servizio").slice(0, 1000))}</Descrizione>` +
    `<Quantita>${l.qty.toFixed(2)}</Quantita>` +
    `<PrezzoUnitario>${eur(l.unitPriceCents)}</PrezzoUnitario>` +
    `<PrezzoTotale>${eur(l.lineTotalCents)}</PrezzoTotale>` +
    `<AliquotaIVA>${rate(l.vatRate)}</AliquotaIVA>` +
    (l.vatNature ? `<Natura>${esc(l.vatNature)}</Natura>` : "") +
    `</DettaglioLinee>`
  ).join("");
}

export function buildFatturaPaXml(p: EInvoicePayload): string {
  const em = p.emittente;
  const cl = p.cliente;
  const codDest = (cl.sdiCode && cl.sdiCode.trim()) ? cl.sdiCode.trim().toUpperCase() : "0000000";
  const pecDest = codDest === "0000000" && cl.pec ? `<PECDestinatario>${esc(cl.pec)}</PECDestinatario>` : "";
  const bollo = p.totals.bolloCents > 0 ? `<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>${eur(p.totals.bolloCents)}</ImportoBollo></DatiBollo>` : "";
  const collegate = p.docKind === "nota_di_credito" && p.relatedNumberLabel
    ? `<DatiFattureCollegate><IdDocumento>${esc(p.relatedNumberLabel)}</IdDocumento></DatiFattureCollegate>` : "";
  const pagamento = p.payment?.method
    ? `<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento>` +
      `<ModalitaPagamento>${esc(p.payment.method)}</ModalitaPagamento>` +
      (p.payment.dueDate ? `<DataScadenzaPagamento>${ymd(p.payment.dueDate)}</DataScadenzaPagamento>` : "") +
      `<ImportoPagamento>${eur(p.totals.totalCents)}</ImportoPagamento>` +
      `</DettaglioPagamento></DatiPagamento>` : "";
  const causale = p.notes ? `<Causale>${esc(p.notes.slice(0, 200))}</Causale>` : "";

  const header =
    `<FatturaElettronicaHeader>` +
    `<DatiTrasmissione>` +
    `<IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${esc(em.vat || em.taxCode || "")}</IdCodice></IdTrasmittente>` +
    `<ProgressivoInvio>${esc(progressivo(p.docId))}</ProgressivoInvio>` +
    `<FormatoTrasmissione>FPR12</FormatoTrasmissione>` +
    `<CodiceDestinatario>${esc(codDest)}</CodiceDestinatario>` +
    pecDest +
    `</DatiTrasmissione>` +
    `<CedentePrestatore>` +
    `<DatiAnagrafici>` +
    idFiscaleIva(em.country || "IT", em.vat) +
    (em.taxCode ? `<CodiceFiscale>${esc(em.taxCode)}</CodiceFiscale>` : "") +
    `<Anagrafica><Denominazione>${esc((em.denominazione || "").slice(0, 80))}</Denominazione></Anagrafica>` +
    `<RegimeFiscale>${esc(em.regimeFiscale || "RF01")}</RegimeFiscale>` +
    `</DatiAnagrafici>` +
    sede({ address: em.address, cap: em.cap, city: em.city, province: em.province, country: em.country }) +
    `</CedentePrestatore>` +
    `<CessionarioCommittente>` +
    `<DatiAnagrafici>` +
    (cl.vat ? idFiscaleIva(cl.country || "IT", cl.vat) : "") +
    (cl.taxCode ? `<CodiceFiscale>${esc(cl.taxCode)}</CodiceFiscale>` : "") +
    `<Anagrafica>${anagraficaCliente(cl)}</Anagrafica>` +
    `</DatiAnagrafici>` +
    sede({ address: cl.address, cap: cl.cap, city: cl.city, province: cl.province, country: cl.country || "IT" }) +
    `</CessionarioCommittente>` +
    `</FatturaElettronicaHeader>`;

  const body =
    `<FatturaElettronicaBody>` +
    `<DatiGenerali><DatiGeneraliDocumento>` +
    `<TipoDocumento>${tipoDoc(p.docKind, p.sdiType)}</TipoDocumento>` +
    `<Divisa>${esc(p.currency || "EUR")}</Divisa>` +
    `<Data>${ymd(p.issueDate)}</Data>` +
    `<Numero>${esc(p.numberLabel || "1")}</Numero>` +
    bollo +
    `<ImportoTotaleDocumento>${eur(p.totals.totalCents)}</ImportoTotaleDocumento>` +
    causale +
    `</DatiGeneraliDocumento>` + collegate + `</DatiGenerali>` +
    `<DatiBeniServizi>` + dettaglioLinee(p) + riepiloghi(p) + `</DatiBeniServizi>` +
    pagamento +
    `</FatturaElettronicaBody>`;

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    header + body +
    `</p:FatturaElettronica>`;
}

// Nome file conforme: IT<idcodice>_<progressivo> (max 5 char progressivo lato SdI;
// qui usiamo un base36 breve). Openapi può rigenerarlo, ma lo forniamo.
export function fatturaPaFileName(p: EInvoicePayload): string {
  const id = (p.emittente.vat || p.emittente.taxCode || "00000000000").replace(/[^A-Za-z0-9]/g, "");
  return `IT${id}_${progressivo(p.docId).slice(0, 5).padStart(5, "0")}.xml`;
}
