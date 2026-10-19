import Link from "next/link";

// Pagina 404 in italiano (prima compariva quella inglese di Next, "404 This page could not be found.").
// Stesso stile della pagina «Sito non trovato» del Xenosite: farfalla, titolo, un solo pulsante per tornare indietro.
export default function NotFound() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#fff", color: "#1c1917", padding: 24, textAlign: "center", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/xenora-mark.png" alt="Xenora" width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain" }} />
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Pagina non trovata</h1>
      <p style={{ fontSize: 15, color: "#78716c", margin: 0, maxWidth: 420 }}>L&apos;indirizzo che hai aperto non esiste o non è più disponibile.</p>
      <Link href="/" style={{ marginTop: 6, borderRadius: 10, background: "#2f6bb0", color: "#fff", padding: "10px 18px", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>Torna alla home</Link>
    </div>
  );
}
