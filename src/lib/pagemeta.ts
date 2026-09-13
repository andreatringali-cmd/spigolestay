import type { Metadata } from "next";

// Genera i metadati (titolo + descrizione + anteprima Open Graph) di una singola pagina.
// Ogni rotta ha così una descrizione DIVERSA nell'anteprima dei link (WhatsApp, ecc.).
export function pageMeta(title: string, description: string, color = "#2f6bb0"): Metadata {
  const og = `/og?t=${encodeURIComponent(title)}&s=${encodeURIComponent(description)}&c=${encodeURIComponent(color)}&n=Xenora`;
  return {
    title: `${title} · Xenora`,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: og, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description, images: [og] },
  };
}
