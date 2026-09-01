// Generatore Fattura Elettronica (FatturaPA 1.2.2, formato FPR12 per privati/B2C).
// Produce un XML strutturato conforme allo schema SdI a partire da prenotazione + struttura + ospite.
// NB: per l'invio reale allo SdI serve firma digitale e i dati fiscali completi della struttura.

import type { Booking, Structure, Guest } from "./types";

export interface InvoiceAmounts {
  accommodation: number; // soggiorno (lordo)
  cleaning: number;      // pulizia finale (lordo)
  cityTax: number;       // imposta di soggiorno (fuori campo IVA)
}

const esc = (v: string | undefined) => (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const n2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
const onlyNum = (s?: string) => (s ?? "").replace(/[^0-9A-Za-z]/g, "");

interface Line { desc: string; imponibile: number; aliquota: number; natura?: string; norma?: string }

export interface FatturaResult { xml: string; filename: string; warnings: string[] }

export function buildFatturaPA(booking: Booking, structure: Structure | undefined, guest: Guest | undefined, amt: InvoiceAmounts, invoiceNumber: string, progressivo: string): FatturaResult {
  const warnings: string[] = [];
  const forfettario = !structure?.vat;
  const sellerVat = onlyNum(structure?.vat);
  const sellerCf = onlyNum(structure?.taxCode) || sellerVat;
  const idCodice = sellerVat || sellerCf || "00000000000";
  if (!sellerVat) warnings.push("Manca la Partita IVA della struttura: inserita come bozza. Compilala nella scheda struttura per un file valido.");
  if (!structure?.address || !structure?.city) warnings.push("Indirizzo struttura incompleto (via/CAP/città/provincia).");

  // Righe fattura (imponibili). Forfettario: aliquota 0 con Natura N2.2. Ordinario: 10%.
  const lines: Line[] = [];
  const accImp = forfettario ? amt.accommodation : Math.round((amt.accommodation / 1.1) * 100) / 100;
  const cleanImp = forfettario ? amt.cleaning : Math.round((amt.cleaning / 1.1) * 100) / 100;
  const nn = Math.max(1, Math.round((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86400000));
  lines.push({ desc: `Soggiorno turistico dal ${booking.checkIn} al ${booking.checkOut} (${nn} notti)`, imponibile: accImp, aliquota: forfettario ? 0 : 10, natura: forfettario ? "N2.2" : undefined, norma: forfettario ? "Regime forfettario art.1 c.54-89 L.190/2014" : undefined });
  if (amt.cleaning > 0) lines.push({ desc: "Pulizia finale", imponibile: cleanImp, aliquota: forfettario ? 0 : 10, natura: forfettario ? "N2.2" : undefined, norma: forfettario ? "Regime forfettario art.1 c.54-89 L.190/2014" : undefined });
  if (amt.cityTax > 0) lines.push({ desc: `Imposta di soggiorno riscossa per conto del Comune di ${structure?.cityTaxComune || structure?.city || "—"}`, imponibile: amt.cityTax, aliquota: 0, natura: "N1", norma: "Escluse ex art.15 DPR 633/72 — riscossa per conto del Comune" });

  // Riepiloghi per (aliquota, natura).
  const groups = new Map<string, { aliquota: number; natura?: string; norma?: string; imp: number }>();
  for (const l of lines) {
    const key = `${l.aliquota}|${l.natura ?? ""}`;
    const g = groups.get(key) ?? { aliquota: l.aliquota, natura: l.natura, norma: l.norma, imp: 0 };
    g.imp += l.imponibile;
    groups.set(key, g);
  }
  const riepilogo = [...groups.values()];
  const totalDoc = riepilogo.reduce((a, g) => a + g.imp + Math.round(g.imp * g.aliquota) / 100, 0);

  // Cessionario (ospite): persona fisica. Nome/Cognome se disponibili.
  const cognome = guest?.lastName || (guest?.fullName?.split(" ").slice(1).join(" ")) || guest?.fullName || "Cliente";
  const nome = guest?.firstName || guest?.fullName?.split(" ")[0] || "";
  const buyerCountry = (guest?.country && /^[A-Z]{2}$/.test(guest.country)) ? guest.country : "IT";

  const sede = (indirizzo?: string, cap?: string, comune?: string, prov?: string, naz = "IT") =>
    `      <Indirizzo>${esc(indirizzo || "N/D")}</Indirizzo>\n` +
    `      <CAP>${esc((cap || "00000").replace(/\D/g, "").padStart(5, "0").slice(0, 5))}</CAP>\n` +
    `      <Comune>${esc(comune || "N/D")}</Comune>\n` +
    (prov && naz === "IT" ? `      <Provincia>${esc(prov.slice(0, 2).toUpperCase())}</Provincia>\n` : "") +
    `      <Nazione>${esc(naz)}</Nazione>`;

  const dettaglio = lines.map((l, i) => {
    const tot = l.imponibile;
    return `    <DettaglioLinee>\n` +
      `      <NumeroLinea>${i + 1}</NumeroLinea>\n` +
      `      <Descrizione>${esc(l.desc)}</Descrizione>\n` +
      `      <PrezzoUnitario>${n2(tot)}</PrezzoUnitario>\n` +
      `      <PrezzoTotale>${n2(tot)}</PrezzoTotale>\n` +
      `      <AliquotaIVA>${n2(l.aliquota)}</AliquotaIVA>\n` +
      (l.natura ? `      <Natura>${esc(l.natura)}</Natura>\n` : "") +
      `    </DettaglioLinee>`;
  }).join("\n");

  const riepiloghi = riepilogo.map((g) => {
    const imposta = Math.round(g.imp * g.aliquota) / 100;
    return `    <DatiRiepilogo>\n` +
      `      <AliquotaIVA>${n2(g.aliquota)}</AliquotaIVA>\n` +
      (g.natura ? `      <Natura>${esc(g.natura)}</Natura>\n` : "") +
      `      <ImponibileImporto>${n2(g.imp)}</ImponibileImporto>\n` +
      `      <Imposta>${n2(imposta)}</Imposta>\n` +
      `      <EsigibilitaIVA>I</EsigibilitaIVA>\n` +
      (g.norma ? `      <RiferimentoNormativo>${esc(g.norma)}</RiferimentoNormativo>\n` : "") +
      `    </DatiRiepilogo>`;
  }).join("\n");

  const today = new Date().toISOString().slice(0, 10);
  const regime = forfettario ? "RF19" : "RF01";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${esc(idCodice)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${esc(progressivo)}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>0000000</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
${sellerVat ? `        <IdFiscaleIVA>\n          <IdPaese>IT</IdPaese>\n          <IdCodice>${esc(sellerVat)}</IdCodice>\n        </IdFiscaleIVA>\n` : ""}${sellerCf ? `        <CodiceFiscale>${esc(sellerCf)}</CodiceFiscale>\n` : ""}        <Anagrafica>
          <Denominazione>${esc(structure?.businessName || structure?.name || "Xenora")}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>${regime}</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
${sede([structure?.address, structure?.streetNumber].filter(Boolean).join(" "), structure?.postalCode, structure?.city, structure?.province)}
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <Anagrafica>
          <Nome>${esc(nome || cognome)}</Nome>
          <Cognome>${esc(cognome)}</Cognome>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
${sede(guest?.address, undefined, guest?.country && buyerCountry === "IT" ? guest.country : "Estero", undefined, buyerCountry)}
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${today}</Data>
        <Numero>${esc(invoiceNumber)}</Numero>
        <ImportoTotaleDocumento>${n2(totalDoc)}</ImportoTotaleDocumento>
        <Causale>Soggiorno presso ${esc(structure?.name || "struttura")}</Causale>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
${dettaglio}
${riepiloghi}
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <ImportoPagamento>${n2(totalDoc)}</ImportoPagamento>
${structure?.iban ? `        <IBAN>${esc(onlyNum(structure.iban))}</IBAN>\n` : ""}      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;

  const filename = `IT${esc(idCodice)}_${esc(progressivo)}.xml`;
  return { xml, filename, warnings };
}
