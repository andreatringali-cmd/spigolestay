// Foglio A4 con banda colore in alto, usato come base per i documenti "carta intestata"
// (preventivi, voucher/conferma prenotazione). Duplicato intenzionalmente da preventivi/page.tsx
// invece di essere importato da lì: quel file genera il PDF già approvato dall'utente ("fotocopia
// esatta") e non va toccato per evitare qualsiasi rischio di regressione. Se in futuro si vuole
// un'unica fonte, si può far migrare preventivi/page.tsx a importare da qui.
import type { ReactNode } from "react";

// Usato al posto di CSS color-mix() perché html2canvas (cattura PDF) non sa interpretare color-mix.
export function tintWhite(hex: string, pct: number): string {
  const h = (hex || "#000000").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(n.slice(0, 6) || "000000", 16);
  const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
  const mix = (c: number) => Math.round(255 * (1 - pct) + c * pct);
  const to2 = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

export function A4Page({ scale, accent, children }: { scale: number; accent: string; children: ReactNode }) {
  return (
    <div style={{ width: "100%", aspectRatio: "794 / 1123", overflow: "hidden", borderRadius: 10, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.08), 0 12px 30px -14px rgba(0,0,0,.2)", marginBottom: 14 }}>
      <div style={{ width: 794, height: 1123, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative", overflow: "hidden", fontFamily: "Arial, Helvetica, sans-serif", color: "#2b2b2b" }}>
        <div style={{ height: 6, background: accent }} />
        {children}
      </div>
    </div>
  );
}
