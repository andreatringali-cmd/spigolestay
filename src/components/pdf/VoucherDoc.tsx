// Documento "carta intestata" del voucher/conferma prenotazione — stessa identica grammatica
// visiva del preventivo (QuoteDoc in preventivi/page.tsx): banda colore, logo/nome struttura a
// sinistra, codice a destra, righe etichetta/valore, riquadro totale, piè di pagina con contatti.
// Serve a generare l'ALLEGATO PDF come fotocopia di un'anteprima reale (html2canvas), invece del
// vecchio disegno a mano con pdf-lib che aveva uno stile diverso (banda piena, font diversi).
import { A4Page, tintWhite } from "./A4Page";

export interface VoucherDocProps {
  scale: number;
  accent: string; logo?: string; structureName: string; address: string; contacts: string; legal: string;
  code: string; guestName: string; guestEmail?: string;
  roomType: string; unitName?: string; checkIn: string; checkOut: string; checkInFrom?: string; checkOutBy?: string;
  adults: number; children: number; nights: number; ratePlan?: string;
  total?: string; cancelText: string;
}

export default function VoucherDoc(p: VoucherDocProps) {
  const muted = "#726b62", hair = "#ece7df";
  const row = { display: "flex", justifyContent: "space-between", padding: "9px 2px", borderBottom: `1px solid ${hair}`, fontSize: 14 } as const;
  return (
    <A4Page scale={p.scale} accent={p.accent}>
      <div style={{ padding: "28px 30px 0" }}>
        {/* Intestazione — identica al preventivo */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, borderBottom: `1px solid ${hair}`, paddingBottom: 20 }}>
          {p.logo
            ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={p.logo} alt="" style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 12, background: "#fff", border: `1px solid ${hair}` }} />)
            : <div style={{ width: 64, height: 64, borderRadius: 12, background: p.accent, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 30 }}>{(p.structureName || "S").slice(0, 1).toUpperCase()}</div>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.4px" }}>{p.structureName || "La tua struttura"}</div>
            {p.address && <div style={{ fontSize: 13, color: muted, marginTop: 3 }}>{p.address}</div>}
            {p.contacts && <div style={{ fontSize: 12, color: muted, marginTop: 1 }}>{p.contacts}</div>}
          </div>
          <div style={{ textAlign: "right", flex: "none" }}>
            <div style={{ fontSize: 11, letterSpacing: ".13em", color: muted, textTransform: "uppercase", fontWeight: 700 }}>Codice</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: p.accent }}>{p.code}</div>
          </div>
        </div>

        <div style={{ padding: "22px 0 30px" }}>
          <div style={{ fontSize: 11.5, letterSpacing: ".1em", color: muted, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Ospite</div>
          <p style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>{p.guestName || "—"}</p>
          {p.guestEmail && <p style={{ margin: "0 0 20px", fontSize: 13, color: muted }}>{p.guestEmail}</p>}

          {/* Periodo, come nel preventivo */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20, marginTop: p.guestEmail ? 0 : 16 }}>
            {[["Check-in", p.checkIn + (p.checkInFrom ? ` (dalle ${p.checkInFrom})` : "")], ["Check-out", p.checkOut + (p.checkOutBy ? ` (entro ${p.checkOutBy})` : "")], ["Durata", `${p.nights} nott${p.nights === 1 ? "e" : "i"}`]].map(([k, v], i) => (
              <div key={i} style={{ flex: 1, border: `1px solid ${hair}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 10.5, letterSpacing: ".08em", color: muted, textTransform: "uppercase", fontWeight: 700 }}>{k}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11.5, letterSpacing: ".1em", color: muted, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Sistemazione</div>
          <div style={row}><span>{[p.roomType, p.unitName].filter(Boolean).join(" · ")}</span></div>
          <div style={row}><span>Ospiti</span><span>{p.adults} adulti{p.children ? ` · ${p.children} bambini` : ""}</span></div>
          {p.ratePlan && <div style={row}><span>Tariffa</span><span>{p.ratePlan}</span></div>}

          {p.total && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 18px", marginTop: 14, background: tintWhite(p.accent, 0.09), borderRadius: 10 }}>
              <b style={{ fontSize: 13.5, letterSpacing: ".04em" }}>TOTALE SOGGIORNO</b><b style={{ fontSize: 22, color: p.accent }}>{p.total}</b>
            </div>
          )}

          <div style={{ fontSize: 11.5, letterSpacing: ".1em", color: muted, textTransform: "uppercase", fontWeight: 700, margin: "22px 0 6px" }}>Condizioni di cancellazione</div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: muted }}>{p.cancelText}</p>
        </div>

        {/* Piè di pagina fissato in fondo al foglio A4, come nel preventivo */}
        <div style={{ position: "absolute", left: 30, right: 30, bottom: 24, paddingTop: 12, borderTop: `1px solid ${hair}` }}>
          <div style={{ fontSize: 10.5, color: "#b3a99c", lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, color: muted }}>{p.structureName}</div>
            {p.address && <div>{p.address}</div>}
            {(p.contacts || p.legal) && <div>{[p.contacts, p.legal].filter(Boolean).join("  ·  ")}</div>}
          </div>
        </div>
      </div>
    </A4Page>
  );
}
