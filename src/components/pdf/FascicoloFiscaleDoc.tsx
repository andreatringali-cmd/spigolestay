// Documento "Fascicolo fiscale" — riepilogo annuale (incassi per canale, tassa di soggiorno,
// fatture emesse) pronto da consegnare al commercialista. Stessa tecnica degli altri documenti
// dell'app (Planning pulizie, Preventivi): componente React renderizzato off-screen in formato A4
// e catturato con html2canvas+jsPDF (captureA4ToPdfBlob) — il PDF è una fotocopia esatta di questa
// anteprima, mai un disegno ricostruito a parte. Dimensioni fisse 794×1123 (A4 a 96dpi).
export interface ChannelRow {
  label: string;
  count: number;
  lordo: number;
  commissioni: number;
}

export interface FascicoloFiscaleDocProps {
  structureName: string; // nome struttura o "Tutte le strutture"
  anno: number;
  generatedLabel: string; // es. "generato da Xenora il 2 ottobre 2026"
  // KPI di sintesi
  nottiVendute: number;
  occupazioneMedia: number; // 0..1
  ricaviLordi: number;
  ricaviNetti: number;
  // Incassi per canale
  channels: ChannelRow[];
  // Tassa di soggiorno
  cityTaxEnabled: boolean; // la struttura (o almeno una, in "tutte") ha la tassa configurata
  cityTaxDovuta: number;
  cityTaxIncassata: number;
  cityTaxDaIncassare: number;
  // Fatture emesse (fatturazione elettronica)
  invoiceCount: number;
  invoiceTaxable: number;
  invoiceVat: number;
  invoiceTotal: number;
  invoiceModuleReady: boolean; // dati emittente (P.IVA/ragione sociale) configurati in Impostazioni fattura
}

const INK = "#1B1A17";
const DIM = "#55524A";
const FAINT = "#8A8577";
const LINE = "#E3E0D6";
const money = (n: number) => "€ " + Math.round(n).toLocaleString("it-IT");

const stat = (label: string, value: string) => (
  <div key={label}>
    <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: FAINT }}>{label}</div>
    <div style={{ marginTop: 4, fontSize: 20, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", fontVariantNumeric: "tabular-nums" }}>{value}</div>
  </div>
);

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: DIM, borderBottom: `1px solid ${INK}`, paddingBottom: 6 }}>{children}</h2>;
}

export default function FascicoloFiscaleDoc(p: FascicoloFiscaleDocProps) {
  const totChannels = p.channels.reduce((a, c) => ({ count: a.count + c.count, lordo: a.lordo + c.lordo, commissioni: a.commissioni + c.commissioni }), { count: 0, lordo: 0, commissioni: 0 });
  return (
    <div style={{ width: 794, height: 1123, boxSizing: "border-box", padding: "60px 56px", background: "#FCFBF8", fontFamily: "'IBM Plex Sans', sans-serif", color: INK, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: `1px solid ${INK}`, paddingBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: FAINT }}>Xenora · Fascicolo fiscale</span>
        <span style={{ fontSize: 13, color: DIM }}>{p.structureName}</span>
      </div>

      <div style={{ marginTop: 22 }}>
        <h1 style={{ margin: 0, fontFamily: "'Source Serif 4', serif", fontWeight: 600, fontSize: 38, letterSpacing: "-0.01em" }}>Fascicolo fiscale {p.anno}</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: DIM }}>Anno solare 1 gennaio – 31 dicembre {p.anno} · {p.structureName}</p>
      </div>

      <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 20, padding: "16px 0", borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
        {stat("Notti vendute", String(p.nottiVendute))}
        {stat("Occupazione media", `${Math.round(p.occupazioneMedia * 100)}%`)}
        {stat("Ricavi lordi", money(p.ricaviLordi))}
        {stat("Ricavi netti", money(p.ricaviNetti))}
      </div>

      {/* Incassi per canale */}
      <div style={{ marginTop: 22 }}>
        <SectionTitle>Incassi per canale</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${INK}` }}>
              <th style={{ textAlign: "left", fontWeight: 600, padding: "0 8px 8px 0", color: DIM, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em" }}>Canale</th>
              <th style={{ textAlign: "right", fontWeight: 600, padding: "0 8px 8px", color: DIM, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em" }}>Prenotazioni</th>
              <th style={{ textAlign: "right", fontWeight: 600, padding: "0 8px 8px", color: DIM, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em" }}>Lordo</th>
              <th style={{ textAlign: "right", fontWeight: 600, padding: "0 8px 8px", color: DIM, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em" }}>Commissioni</th>
              <th style={{ textAlign: "right", fontWeight: 600, padding: "0 0 8px 8px", color: DIM, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em" }}>Netto</th>
            </tr>
          </thead>
          <tbody>
            {p.channels.map((c) => (
              <tr key={c.label} style={{ borderBottom: `1px solid ${LINE}` }}>
                <td style={{ padding: "9px 8px 9px 0", fontWeight: 600 }}>{c.label}</td>
                <td style={{ padding: "9px 8px", textAlign: "right", color: DIM, fontFamily: "'IBM Plex Mono', monospace" }}>{c.count}</td>
                <td style={{ padding: "9px 8px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace" }}>{money(c.lordo)}</td>
                <td style={{ padding: "9px 8px", textAlign: "right", color: DIM, fontFamily: "'IBM Plex Mono', monospace" }}>{c.commissioni ? `−${money(c.commissioni)}` : "—"}</td>
                <td style={{ padding: "9px 0 9px 8px", textAlign: "right", fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>{money(c.lordo - c.commissioni)}</td>
              </tr>
            ))}
            {p.channels.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "14px 0", textAlign: "center", color: FAINT, fontSize: 12 }}>Nessun incasso nell&apos;anno selezionato.</td></tr>
            )}
          </tbody>
          {p.channels.length > 0 && (
            <tfoot>
              <tr>
                <td style={{ padding: "10px 8px 0 0", fontWeight: 700 }}>Totale</td>
                <td style={{ padding: "10px 8px 0", textAlign: "right", fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{totChannels.count}</td>
                <td style={{ padding: "10px 8px 0", textAlign: "right", fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{money(totChannels.lordo)}</td>
                <td style={{ padding: "10px 8px 0", textAlign: "right", fontWeight: 700, color: DIM, fontFamily: "'IBM Plex Mono', monospace" }}>{totChannels.commissioni ? `−${money(totChannels.commissioni)}` : "—"}</td>
                <td style={{ padding: "10px 0 0 8px", textAlign: "right", fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{money(totChannels.lordo - totChannels.commissioni)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Tassa di soggiorno */}
      <div style={{ marginTop: 24 }}>
        <SectionTitle>Tassa di soggiorno</SectionTitle>
        {p.cityTaxEnabled ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 20 }}>
            {stat("Dovuta nell'anno", money(p.cityTaxDovuta))}
            {stat("Incassata", money(p.cityTaxIncassata))}
            {stat("Da incassare", money(p.cityTaxDaIncassare))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: FAINT }}>Tassa di soggiorno non configurata per questa struttura (nessun importo da riepilogare).</p>
        )}
        {p.cityTaxEnabled && <p style={{ margin: "8px 0 0", fontSize: 10.5, color: FAINT }}>&quot;Incassata&quot; = prenotazioni marcate come riscosse in Xenora. Il versamento al Comune non è tracciato dal gestionale: verificare gli estremi del bollettino con il proprio commercialista.</p>}
      </div>

      {/* Fatture emesse */}
      <div style={{ marginTop: 24 }}>
        <SectionTitle>Fatture emesse (fatturazione elettronica)</SectionTitle>
        {p.invoiceModuleReady ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 20 }}>
            {stat("N. fatture", String(p.invoiceCount))}
            {stat("Imponibile", money(p.invoiceTaxable))}
            {stat("IVA", money(p.invoiceVat))}
            {stat("Totale", money(p.invoiceTotal))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: FAINT }}>Fatturazione elettronica non ancora attiva (dati emittente da completare in Impostazioni fattura).</p>
        )}
        {p.invoiceModuleReady && p.invoiceCount === 0 && <p style={{ margin: "8px 0 0", fontSize: 10.5, color: FAINT }}>Nessuna fattura emessa nell&apos;anno selezionato.</p>}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 20, borderTop: `1px solid ${INK}` }}>
        <p style={{ margin: 0, fontSize: 10, color: FAINT, lineHeight: 1.5 }}>Documento generato automaticamente da Xenora a scopo di riepilogo; verificare sempre con il proprio commercialista prima dell&apos;uso ufficiale.</p>
        <p style={{ margin: "4px 0 0", fontSize: 10, color: FAINT }}>{p.generatedLabel}</p>
      </div>
    </div>
  );
}
