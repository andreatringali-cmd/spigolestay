// Documento "Planning pulizie" — stile "Minimale" scelto dall'utente tra 10 varianti esplorate
// (vedi artifact di design). Catturato con html2canvas+jsPDF (captureA4ToPdfBlob), come gli altri
// documenti dell'app: il PDF è una fotocopia esatta di questa anteprima, mai un disegno separato.
// Dimensioni fisse 794×1123 (A4 a 96dpi) richieste da captureA4ToPdfBlob.
export interface PulizieRow {
  camera: string;
  azione: string;
  ospite: string;
  subline?: string; // check-in → check-out e persone, sotto il nome ospite
  note: string;
  dim?: boolean; // riga "Niente/vuota": tutto in grigio
  danger?: boolean; // riga "Fuori servizio": camera/azione/nota in rosso
}

export interface PulizieDocProps {
  structureName: string;
  structureCity?: string;
  dateLabel: string; // es. "Mercoledì 30 settembre 2026"
  camere: number;
  daPulire: number;
  arrivi: number;
  fuoriServizio: number;
  rows: PulizieRow[];
  biancheriaLine: string;
  generatedLabel: string; // es. "generato da Xenora il 30 settembre 2026"
  pageIndex: number;
  pageTotal: number;
}

const INK = "#1B1A17";
const DIM = "#55524A";
const FAINT = "#8A8577";
const LINE = "#E3E0D6";
const DANGER = "#B23B3B";

const stat = (label: string, value: number) => (
  <div key={label}>
    <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: FAINT }}>{label}</div>
    <div style={{ marginTop: 4, fontSize: 22, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", fontVariantNumeric: "tabular-nums" }}>{value}</div>
  </div>
);

export default function PulizieDoc(p: PulizieDocProps) {
  return (
    <div style={{ width: 794, height: 1123, boxSizing: "border-box", padding: "64px 60px", background: "#FCFBF8", fontFamily: "'IBM Plex Sans', sans-serif", color: INK, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: `1px solid ${INK}`, paddingBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: FAINT }}>Xenora · Planning pulizie</span>
        <span style={{ fontSize: 13, color: DIM }}>{[p.structureName, p.structureCity].filter(Boolean).join(" · ")}</span>
      </div>

      <div style={{ marginTop: 26 }}>
        <h1 style={{ margin: 0, fontFamily: "'Source Serif 4', serif", fontWeight: 600, fontSize: 44, letterSpacing: "-0.01em" }}>Pulizie di oggi</h1>
        <p style={{ margin: "6px 0 0", fontSize: 15, color: DIM }}>{p.dateLabel}</p>
      </div>

      <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 24, padding: "20px 0", borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
        {stat("Camere", p.camere)}
        {stat("Da pulire", p.daPulire)}
        {stat("Arrivi", p.arrivi)}
        {stat("Fuori servizio", p.fuoriServizio)}
      </div>

      <table style={{ marginTop: 32, width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${INK}` }}>
            <th style={{ textAlign: "left", fontWeight: 600, padding: "0 8px 10px 0", color: DIM, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>Camera</th>
            <th style={{ textAlign: "left", fontWeight: 600, padding: "0 8px 10px", color: DIM, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>Da fare</th>
            <th style={{ textAlign: "left", fontWeight: 600, padding: "0 8px 10px", color: DIM, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>Ospite</th>
            <th style={{ textAlign: "left", fontWeight: 600, padding: "0 0 10px 8px", color: DIM, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>Note</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r, i) => {
            const main = r.danger ? DANGER : r.dim ? FAINT : INK;
            const last = i === p.rows.length - 1;
            return (
              <tr key={i} style={last ? undefined : { borderBottom: `1px solid ${LINE}` }}>
                <td style={{ padding: "14px 8px 14px 0", fontWeight: 600, color: main }}>{r.camera}</td>
                <td style={{ padding: "14px 8px", color: main }}>{r.azione}</td>
                <td style={{ padding: "14px 8px", color: r.dim || r.danger ? FAINT : INK }}>
                  <div>{r.ospite}</div>
                  {r.subline && <div style={{ marginTop: 2, fontSize: 11, color: FAINT }}>{r.subline}</div>}
                </td>
                <td style={{ padding: "14px 0 14px 8px", color: r.danger ? DANGER : "#77705F" }}>{r.note || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: "auto", paddingTop: 24, borderTop: `1px solid ${INK}`, display: "flex", justifyContent: "space-between", fontSize: 11, color: FAINT }}>
        <span>{p.biancheriaLine} — {p.generatedLabel}</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontVariantNumeric: "tabular-nums" }}>{p.pageIndex} / {p.pageTotal}</span>
      </div>
    </div>
  );
}
