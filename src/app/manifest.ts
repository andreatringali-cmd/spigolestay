import type { MetadataRoute } from "next";

// Manifest dell'app (aggiungi alla schermata Home): nome, colori e icone. Le icone hanno la farfalla più piccola e centrata su fondo bianco,
// così la schermata di avvio di Android non la mostra enorme.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Xenora",
    short_name: "Xenora",
    description: "Gestionale e channel manager per B&B",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2f6bb0",
    lang: "it",
    icons: [
      { src: "/icons/icon-v2-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-v2-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-v2-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
