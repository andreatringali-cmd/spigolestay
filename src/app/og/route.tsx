import { ImageResponse } from "next/og";

export const runtime = "edge";

// Immagine Open Graph (anteprima link) generata al volo. Personalizzabile via query:
//   /og?t=Titolo&s=Sottotitolo&c=%230F6E56&n=NomeStruttura
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const brand = searchParams.get("n") || "Xenora";
  const title = searchParams.get("t") || "Il tuo soggiorno";
  const subtitle = searchParams.get("s") || "Guida, check-in online e info utili";
  const color = searchParams.get("c") || "#0F6E56";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "90px", background: color, color: "#ffffff", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, opacity: 0.9, marginBottom: 26 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 800 }}>{brand.slice(0, 1).toUpperCase()}</div>
          {brand}
        </div>
        <div style={{ fontSize: 82, fontWeight: 800, lineHeight: 1.04 }}>{title}</div>
        <div style={{ fontSize: 38, opacity: 0.92, marginTop: 24 }}>{subtitle}</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
