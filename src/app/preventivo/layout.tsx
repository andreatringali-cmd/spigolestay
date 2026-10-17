import type { Metadata } from "next";

// Anteprima link (WhatsApp, iMessage…) e motori di ricerca: titolo neutro, nessun dato della prenotazione, pagina non indicizzata.
// Il layout principale ha un'anteprima "Xenora gestionale" che qui non c'entra: la sostituiamo con una miniatura piccola (come per il check-in).
const DESCRIPTION = "Rivedi il preventivo e conferma la prenotazione con il pagamento.";
const THUMB = { url: "/og-pagamento.png", width: 256, height: 256, alt: "Il tuo preventivo" };
export const metadata: Metadata = {
  title: "Il tuo preventivo",
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { title: "Il tuo preventivo", description: DESCRIPTION, images: [THUMB] },
  twitter: { card: "summary", title: "Il tuo preventivo", description: DESCRIPTION, images: [THUMB.url] },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
