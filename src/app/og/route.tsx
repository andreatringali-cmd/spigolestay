import { ImageResponse } from "next/og";

export const runtime = "edge";

// Immagine Open Graph (anteprima link) generata al volo, con il LOGO XENORA per intero.
// Personalizzabile via query:
//   /og?t=Titolo&s=Sottotitolo&c=%232f6bb0
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url);
  const title = searchParams.get("t") || "Xenora";
  const subtitle = searchParams.get("s") || "Gestionale per B&B";
  const color = searchParams.get("c") || "#2f6bb0";
  const logo = `${origin}/xenora-logo.png`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 26,
          padding: "80px 90px",
          background: "#ffffff",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Barra d'accento in alto, nel colore della pagina */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 14, background: color }} />

        {/* Logo intero */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={430} height={122} style={{ objectFit: "contain" }} alt="Xenora" />

        {/* Titolo + sottotitolo della pagina */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 800, color: "#171922", lineHeight: 1.05, letterSpacing: "-0.02em" }}>{title}</div>
          <div style={{ fontSize: 37, color: "#5b5f6b", marginTop: 18, lineHeight: 1.25 }}>{subtitle}</div>
        </div>

        {/* Dominio */}
        <div style={{ display: "flex", alignItems: "center", fontSize: 27, color: color, fontWeight: 700 }}>xenora.it</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
