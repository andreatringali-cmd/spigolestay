"use client";

// Fascicolo fiscale — il pulsante "Esporta anno fiscale" chiesto dal titolare: un PDF unico, già
// pronto per il commercialista, con incassi per canale, tassa di soggiorno e fatture emesse
// dell'anno scelto. Riusa SOLO logica/dati già esistenti nel gestionale (nessun calcolo fiscale
// nuovo): commissionOf/nettoOf per i ricavi (src/lib/booking.ts, stessa matematica di Statistiche),
// cityTaxOf/cityTaxPayers per la tassa di soggiorno (stessa config per struttura usata da
// Preventivi/Fatture), tabella "documents" per le fatture emesse (stessa di /documenti).
import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/store";
import { useTenantId } from "@/lib/tenant";
import { cashScopeOf, scopeVisible } from "@/lib/cassa";
import { supabase } from "@/lib/supabase";
import { CHANNELS, type Channel } from "@/lib/types";
import { commissionOf, cityTaxOfBooking } from "@/lib/booking";
import { nights, toISO, fmtDate } from "@/lib/dates";
import { eur, num } from "@/lib/format";
import { captureA4ToPdfBlob } from "@/lib/pdf-capture";
import { PageHeader, Card, SectionTitle, StatCard } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { buildCsv, centsToCsv, downloadCsv } from "@/lib/invoicing/csv";
import FascicoloFiscaleDoc, { type ChannelRow } from "@/components/pdf/FascicoloFiscaleDoc";
import AccountantPackPanel from "@/components/AccountantPackPanel";
import { isTrialSend } from "@/lib/invoicing/sdi-status";
import type { PackPayment, PackPurchase } from "@/lib/accountant-pack";

const daysInYear = (yr: number) => ((yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0 ? 366 : 365);

interface DocRow {
  id: string; structure_id: string | null; doc_kind: string; stato: string;
  issue_date: string | null; created_at: string; number_label: string | null; counterpart: { name?: string; lastName?: string; vat?: string | null; tax_code?: string | null; country?: string } | null;
  taxable_cents: number; vat_cents: number; out_of_scope_cents: number; bollo_cents: number; total_cents: number;
  regime?: string | null; send_sdi?: boolean | null; related_document_id?: string | null; due_date?: string | null; // usati dal riepilogo per il commercialista
}
const ISSUED = new Set(["emessa", "inviata_intermediario", "consegnata"]);

export default function FascicoloFiscalePage() {
  const { t } = useLang();
  const tenantId = useTenantId(); // account di lavoro (per un collaboratore è quello del titolare)
  const { bookings, structures, units, allStructures, selectedStructureIds, getStructure } = useData();
  // Ambito dalla selezione vera (con 2+ strutture scelte `activeStructureId` resta "all"): "all" | id di una struttura | elenco di id.
  const scope = useMemo(() => cashScopeOf(selectedStructureIds, allStructures.map((x) => x.id)), [selectedStructureIds, allStructures]);
  const inScope = (sid: string | null | undefined) => scope === "all" || scopeVisible(sid, scope);
  const packStructureId = typeof scope === "string" ? scope : "all"; // il riepilogo per il commercialista filtra per id singolo: per un sottoinsieme gli passo già i dati filtrati
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [generating, setGenerating] = useState(false);

  // Prenotazioni attive nello scope struttura (stesso filtro di Statistiche/Tassa di soggiorno).
  const active = bookings.filter((b) => b.status !== "cancelled" && b.channel !== "blocked" && inScope(b.structureId));
  const scopedStructures = structures.filter((s) => inScope(s.id));
  const scopedUnits = units.filter((u) => !u.outOfService && inScope(u.structureId));
  const structureLabel = scope === "all" ? t("Tutte le strutture") : typeof scope === "string" ? (getStructure(scope)?.name ?? "") : scope.length <= 3 ? scope.map((id) => getStructure(id)?.name ?? "").filter(Boolean).join(", ") : `${scope.length} ${t("strutture")}`;

  // Anni disponibili: quelli con almeno una prenotazione, più l'anno corrente.
  const yearOptions = useMemo(() => {
    const ys = new Set<number>([currentYear]);
    active.forEach((b) => ys.add(Number(b.checkIn.slice(0, 4))));
    return [...ys].filter((n) => n >= 2000).sort((a, b) => b - a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, scope]);

  const yearFrom = `${year}-01-01`;
  const yearTo = `${year + 1}-01-01`;
  const yearBookings = active.filter((b) => b.checkIn >= yearFrom && b.checkIn < yearTo);

  // ---- Incassi per canale (stessa matematica di Statistiche: total = lordo, commissionOf = commissione) ----
  const channelRows: ChannelRow[] = (Object.keys(CHANNELS) as Channel[])
    .filter((c) => c !== "blocked")
    .map((c) => {
      const bks = yearBookings.filter((b) => b.channel === c);
      return {
        label: CHANNELS[c].label,
        count: bks.length,
        lordo: bks.reduce((a, b) => a + (b.total ?? 0), 0),
        commissioni: bks.reduce((a, b) => a + commissionOf(b), 0),
      };
    })
    .filter((r) => r.count > 0);

  const nottiVendute = yearBookings.reduce((a, b) => a + nights(b.checkIn, b.checkOut), 0);
  const occupazioneMedia = scopedUnits.length ? nottiVendute / (scopedUnits.length * daysInYear(year)) : 0;
  const ricaviLordi = yearBookings.reduce((a, b) => a + (b.total ?? 0), 0);
  const commissioniTotali = yearBookings.reduce((a, b) => a + commissionOf(b), 0);
  const ricaviNetti = ricaviLordi - commissioniTotali;

  // ---- Tassa di soggiorno (stessa logica di booking.ts: cityTaxOf/cityTaxPayers, config per struttura) ----
  const cityTaxEnabled = scopedStructures.some((s) => !!s.cityTax);
  let cityTaxDovuta = 0, cityTaxIncassata = 0;
  for (const b of yearBookings) {
    const st = getStructure(b.structureId);
    if (!st?.cityTax) continue;
    const tax = cityTaxOfBooking(st, b);
    cityTaxDovuta += tax;
    if (b.cityTaxPaid) cityTaxIncassata += tax;
  }
  const cityTaxDaIncassare = Math.max(0, cityTaxDovuta - cityTaxIncassata);

  // ---- Fatture emesse (stessa tabella "documents" di /documenti, lettura diretta via supabase/RLS) ----
  const [docRows, setDocRows] = useState<DocRow[]>([]);
  const [invoiceModuleReady, setInvoiceModuleReady] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docsErr, setDocsErr] = useState("");
  // Dati aggiuntivi per il riepilogo per il commercialista (pagamenti, invii in prova, fatture passive, provider).
  const [payRows, setPayRows] = useState<PackPayment[]>([]);
  const [trialIds, setTrialIds] = useState<Set<string>>(new Set());
  const [purchaseRows, setPurchaseRows] = useState<PackPurchase[]>([]);
  const [ficLinked, setFicLinked] = useState(false);
  const [packWarn, setPackWarn] = useState<string[]>([]);
  useEffect(() => {
    if (!supabase) { setLoadingDocs(false); return; }
    if (!tenantId) return; // un collaboratore aspetta di conoscere l'account di lavoro
    setLoadingDocs(true);
    Promise.all([
      supabase.from("documents").select("id, structure_id, doc_kind, stato, issue_date, created_at, number_label, counterpart, taxable_cents, vat_cents, out_of_scope_cents, bollo_cents, total_cents, regime, send_sdi, related_document_id, due_date"),
      supabase.from("tenant_invoice_settings").select("denominazione, vat, tax_code, default_provider").eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("document_payments").select("document_id, amount_cents, method, paid_at"),
      supabase.from("document_events").select("document_id, kind, message, meta, ts").eq("kind", "sent").order("ts", { ascending: false }),
      supabase.from("purchase_documents").select("id, structure_id, supplier_name, doc_number, doc_date, doc_type, category, taxable_cents, vat_cents, total_cents, due_date, paid, paid_at, payment_method"),
    ]).then(([docs, settings, pays, evs, purch]) => {
      if (docs.error) setDocsErr(docs.error.message); else setDocRows((docs.data ?? []) as DocRow[]);
      const s = settings.data as { denominazione?: string; vat?: string; tax_code?: string; default_provider?: string } | null;
      setInvoiceModuleReady(!!s && !!(s.denominazione || s.vat || s.tax_code));
      setFicLinked(s?.default_provider === "fattureincloud");
      setPayRows((pays.data ?? []) as PackPayment[]);
      setPurchaseRows((purch.data ?? []) as PackPurchase[]);
      // Per ogni documento vale l'ULTIMO invio (eventi già ordinati dal più recente): se creato in prova, non è stato trasmesso allo SdI.
      const seen = new Set<string>(); const trials = new Set<string>();
      for (const x of (evs.data ?? []) as { document_id: string; kind: string; message: string | null; meta: Record<string, unknown> | null }[]) {
        if (seen.has(x.document_id)) continue;
        seen.add(x.document_id);
        if (isTrialSend([x])) trials.add(x.document_id);
      }
      setTrialIds(trials);
      const w: string[] = [];
      if (pays.error) w.push("Pagamenti dei documenti non disponibili: incassi e fatture non incassate potrebbero essere incompleti.");
      if (evs.error) w.push("Stato di invio allo SdI non disponibile: i documenti in prova potrebbero non essere segnalati.");
      if (purch.error) w.push("Fatture passive non disponibili.");
      setPackWarn(w);
      setLoadingDocs(false);
    });
  }, [tenantId]);

  // Dati del riepilogo per il commercialista nell'ambito scelto (per un sottoinsieme di strutture si filtrano qui: il pannello filtra solo per una struttura o per tutte).
  const packDocs = useMemo(() => (typeof scope === "string" ? docRows : docRows.filter((r) => scopeVisible(r.structure_id, scope))), [docRows, scope]);
  const packPays = useMemo(() => { if (typeof scope === "string") return payRows; const ids = new Set(packDocs.map((d) => d.id)); return payRows.filter((p) => ids.has(p.document_id)); }, [payRows, packDocs, scope]);
  const packPurch = useMemo(() => (typeof scope === "string" ? purchaseRows : purchaseRows.filter((r) => scopeVisible(r.structure_id, scope))), [purchaseRows, scope]);

  // Anni selezionabili nel riepilogo per il commercialista: quelli con documenti/fatture passive, più quelli delle prenotazioni.
  const packYears = useMemo(() => {
    const ys = new Set<number>(yearOptions);
    packDocs.forEach((r) => ys.add(Number((r.issue_date ?? r.created_at ?? "").slice(0, 4))));
    packPurch.forEach((r) => ys.add(Number((r.doc_date ?? "").slice(0, 4))));
    return [...ys].filter((n) => n >= 2000).sort((a, b) => b - a);
  }, [yearOptions, packDocs, packPurch]);

  // Documenti dell'anno nello scope struttura (esclusi bozze e ricevute). "Emessi" = emessa/inviata/consegnata:
  // gli scartati dallo SdI non entrano nei totali (vengono solo contati e segnalati).
  const yearDocs = docRows.filter((r) => {
    if (r.stato === "bozza" || r.doc_kind === "ricevuta_non_fiscale") return false;
    if (!inScope(r.structure_id)) return false;
    const y = (r.issue_date ?? r.created_at ?? "").slice(0, 4);
    return y === String(year);
  });
  const yearInvoices = yearDocs.filter((r) => r.doc_kind === "fattura" && ISSUED.has(r.stato));
  const yearCreditNotes = yearDocs.filter((r) => r.doc_kind === "nota_di_credito" && ISSUED.has(r.stato));
  const rejectedCount = yearDocs.filter((r) => r.stato === "scartata").length;
  const invoiceCount = yearInvoices.length;
  const invoiceTaxable = yearInvoices.reduce((a, r) => a + (r.taxable_cents ?? 0), 0) / 100;
  const invoiceVat = yearInvoices.reduce((a, r) => a + (r.vat_cents ?? 0), 0) / 100;
  const invoiceTotal = yearInvoices.reduce((a, r) => a + (r.total_cents ?? 0), 0) / 100;
  const creditNoteCount = yearCreditNotes.length;
  const creditNoteTaxable = yearCreditNotes.reduce((a, r) => a + (r.taxable_cents ?? 0), 0) / 100;
  const creditNoteVat = yearCreditNotes.reduce((a, r) => a + (r.vat_cents ?? 0), 0) / 100;
  const creditNoteTotal = yearCreditNotes.reduce((a, r) => a + (r.total_cents ?? 0), 0) / 100;
  const bolloTotal = yearInvoices.reduce((a, r) => a + (r.bollo_cents ?? 0), 0) / 100;
  const netTaxable = invoiceTaxable - creditNoteTaxable, netVat = invoiceVat - creditNoteVat, netTotal = invoiceTotal - creditNoteTotal;

  // Esportazione CSV per il commercialista: l'elenco dei documenti emessi dell'anno (NC con segno negativo).
  const exportDocsCsv = () => {
    const rowsCsv = yearDocs.filter((r) => ISSUED.has(r.stato)).sort((a, b) => (a.issue_date ?? "").localeCompare(b.issue_date ?? "")).map((r) => {
      const sg = r.doc_kind === "nota_di_credito" ? -1 : 1;
      const cp = r.counterpart;
      return [
        r.issue_date ? fmtDate(r.issue_date) : "", getStructure(r.structure_id ?? "")?.name ?? "", r.doc_kind === "nota_di_credito" ? "Nota di credito" : "Fattura", r.number_label ?? "",
        `${cp?.name ?? ""} ${cp?.lastName ?? ""}`.trim(), cp?.vat ?? "", cp?.tax_code ?? "",
        centsToCsv(sg * r.taxable_cents), centsToCsv(sg * r.vat_cents), centsToCsv(sg * (r.out_of_scope_cents ?? 0)), centsToCsv(sg * (r.bollo_cents ?? 0)), centsToCsv(sg * r.total_cents),
      ];
    });
    downloadCsv(`documenti-emessi-${year}${scope !== "all" ? `-${structureLabel.replace(/[\s,]+/g, "-").toLowerCase()}` : ""}`,
      buildCsv(["Data", "Struttura", "Tipo", "Numero", "Cliente", "P.IVA", "Codice fiscale", "Imponibile", "IVA", "Fuori campo IVA", "Bollo", "Totale"], rowsCsv));
  };

  // ---- Generazione PDF: cattura l'anteprima reale fuori schermo (stessa tecnica di Planning pulizie/Preventivi) ----
  const pdfRef = useRef<HTMLDivElement>(null);
  const generatedLabel = `${t("generato da Xenora il")} ${fmtDate(new Date())}`;
  const docProps = {
    structureName: structureLabel, anno: year, generatedLabel,
    nottiVendute, occupazioneMedia, ricaviLordi, ricaviNetti,
    channels: channelRows,
    cityTaxEnabled, cityTaxDovuta, cityTaxIncassata, cityTaxDaIncassare,
    invoiceCount, invoiceTaxable, invoiceVat, invoiceTotal, invoiceModuleReady,
    creditNoteCount, creditNoteTaxable, creditNoteVat, creditNoteTotal, bolloTotal, rejectedCount,
  };

  const downloadPdf = async () => {
    if (!pdfRef.current) return;
    setGenerating(true);
    try {
      const blob = await captureA4ToPdfBlob([pdfRef.current]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `fascicolo-fiscale-${year}${scope !== "all" ? `-${structureLabel.replace(/[\s,]+/g, "-").toLowerCase()}` : ""}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setGenerating(false); }
  };

  const selCls = "rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus";

  return (
    <div>
      <PageHeader
        title={t("Fascicolo fiscale")}
        subtitle={t("Un unico PDF con incassi per canale, tassa di soggiorno e fatture emesse — pronto per il commercialista")}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportDocsCsv} disabled={loadingDocs || invoiceCount + creditNoteCount === 0} title="Elenco dei documenti emessi dell'anno (CSV per Excel; note di credito in negativo)" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-txt hover:bg-wash disabled:opacity-50">
              {t("Esporta documenti (CSV)")}
            </button>
            <button onClick={downloadPdf} disabled={generating || loadingDocs} className="rounded-lg bg-focus px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {generating ? t("Genero…") : t("Genera fascicolo fiscale (PDF)")}
            </button>
          </div>
        }
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-dim">{t("Anno")}
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={`mt-1 block ${selCls}`}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <div className="text-xs text-dim">{t("Struttura")}<div className="mt-1 rounded-lg border border-line bg-wash px-3 py-2 text-sm font-medium text-txt">{structureLabel}</div></div>
          <p className="ml-auto max-w-xs text-right text-[11px] text-faint">{t("La struttura segue il selettore in alto; cambialo lì per generare il fascicolo di una singola struttura o di tutte.")}</p>
        </div>
      </Card>

      {docsErr && <Card className="mb-4"><p className="text-sm text-[color:var(--err)]">{docsErr}</p></Card>}

      <AccountantPackPanel
        docs={packDocs} payments={packPays} trialIds={trialIds} purchases={packPurch} bookings={bookings} getStructure={getStructure}
        structureId={packStructureId} structureLabel={structureLabel} years={packYears} ficLinked={ficLinked} loading={loadingDocs} warnings={packWarn}
      />

      {/* Anteprima a schermo — stessi numeri del PDF */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("Notti vendute")} value={num(nottiVendute)} />
        <StatCard label={t("Occupazione media")} value={`${Math.round(occupazioneMedia * 100)}%`} />
        <StatCard label={t("Ricavi lordi")} value={eur(ricaviLordi)} />
        <StatCard label={t("Ricavi netti")} value={eur(ricaviNetti)} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div>
          <SectionTitle>{t("Incassi per canale")}</SectionTitle>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-3 py-2 font-semibold">{t("Canale")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Prenot.")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Lordo")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Commiss.")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("Netto")}</th>
                </tr>
              </thead>
              <tbody>
                {channelRows.map((c) => (
                  <tr key={c.label} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-txt">{c.label}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{c.count}</td>
                    <td className="px-3 py-2 text-right font-mono text-txt">{eur(c.lordo)}</td>
                    <td className="px-3 py-2 text-right font-mono text-dim">{c.commissioni ? `−${eur(c.commissioni)}` : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: "var(--ok)" }}>{eur(c.lordo - c.commissioni)}</td>
                  </tr>
                ))}
                {channelRows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-faint">{t("Nessun incasso nell'anno selezionato.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <SectionTitle>{t("Tassa di soggiorno")}</SectionTitle>
            <Card>
              {cityTaxEnabled ? (
                <div className="grid grid-cols-3 gap-3">
                  <div><div className="text-xs text-dim">{t("Dovuta")}</div><div className="font-mono text-lg font-bold text-txt">{eur(cityTaxDovuta)}</div></div>
                  <div><div className="text-xs text-dim">{t("Incassata")}</div><div className="font-mono text-lg font-bold" style={{ color: "var(--ok)" }}>{eur(cityTaxIncassata)}</div></div>
                  <div><div className="text-xs text-dim">{t("Da incassare")}</div><div className="font-mono text-lg font-bold" style={{ color: "var(--warn)" }}>{eur(cityTaxDaIncassare)}</div></div>
                </div>
              ) : (
                <p className="text-sm text-faint">{t("Tassa di soggiorno non configurata per questa struttura.")}</p>
              )}
            </Card>
          </div>

          <div>
            <SectionTitle>{t("Fatture emesse")}</SectionTitle>
            <Card>
              {loadingDocs ? (
                <p className="text-sm text-faint">{t("Caricamento…")}</p>
              ) : invoiceModuleReady ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><div className="text-xs text-dim">{t("N. fatture")}</div><div className="font-mono text-lg font-bold text-txt">{invoiceCount}</div></div>
                  <div><div className="text-xs text-dim">{t("Imponibile")}</div><div className="font-mono text-lg font-bold text-txt">{eur(invoiceTaxable)}</div></div>
                  <div><div className="text-xs text-dim">IVA</div><div className="font-mono text-lg font-bold text-txt">{eur(invoiceVat)}</div></div>
                  <div><div className="text-xs text-dim">{t("Totale")}</div><div className="font-mono text-lg font-bold text-txt">{eur(invoiceTotal)}</div></div>
                  {creditNoteCount > 0 && (<>
                    <div className="col-span-2 mt-1 border-t border-line pt-2 text-xs font-semibold uppercase tracking-wide text-faint sm:col-span-4">{t("Note di credito emesse")}</div>
                    <div><div className="text-xs text-dim">{t("N. NC")}</div><div className="font-mono text-lg font-bold text-txt">{creditNoteCount}</div></div>
                    <div><div className="text-xs text-dim">{t("Imponibile")}</div><div className="font-mono text-lg font-bold text-txt">−{eur(creditNoteTaxable)}</div></div>
                    <div><div className="text-xs text-dim">IVA</div><div className="font-mono text-lg font-bold text-txt">−{eur(creditNoteVat)}</div></div>
                    <div><div className="text-xs text-dim">{t("Totale al netto NC")}</div><div className="font-mono text-lg font-bold" style={{ color: "var(--ok)" }}>{eur(netTotal)}</div><div className="text-[10px] text-faint">imp. {eur(netTaxable)} · IVA {eur(netVat)}</div></div>
                  </>)}
                  {bolloTotal > 0 && <div className="col-span-2 text-[11px] text-dim sm:col-span-4">{t("Di cui bollo virtuale")}: <b className="font-mono text-txt">{eur(bolloTotal)}</b></div>}
                  {rejectedCount > 0 && <div className="col-span-2 text-[11px] font-medium text-[color:var(--warn)] sm:col-span-4">{rejectedCount} {t("documenti scartati dallo SdI esclusi dai totali: correggili e reinviali.")}</div>}
                </div>
              ) : (
                <p className="text-sm text-faint">{t("Fatturazione elettronica non ancora attiva (completa i dati emittente in Impostazioni fattura).")}</p>
              )}
            </Card>
          </div>
        </div>
      </div>

      <p className="mt-5 text-xs text-faint">{t("Documento generato automaticamente da Xenora a scopo di riepilogo; verificare sempre con il proprio commercialista prima dell'uso ufficiale.")}</p>

      {/* Contenitore fuori schermo (sempre montato) usato per catturare il PDF a piena risoluzione. */}
      <div aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0, width: 794, zIndex: -1, pointerEvents: "none" }}>
        <div ref={pdfRef}>
          <FascicoloFiscaleDoc {...docProps} />
        </div>
      </div>
    </div>
  );
}
