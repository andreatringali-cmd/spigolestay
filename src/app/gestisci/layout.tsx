import type { Metadata } from "next";

// Anteprima link (WhatsApp, iMessage…) e motori di ricerca: titolo neutro, nessun dato della prenotazione, pagina non indicizzata.
// Il layout principale ha un'anteprima "Xenora gestionale" che qui non c'entra: la sostituiamo con una miniatura piccola (come per il check-in).
const DESCRIPTION = "Rivedi i dettagli, richiedi una modifica delle date o annulla la prenotazione.";
const THUMB = { url: "/og-pagamento.png", width: 256, height: 256, alt: "Gestisci la tua prenotazione" };
export const metadata: Metadata = {
  title: "Gestisci la tua prenotazione",
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { title: "Gestisci la tua prenotazione", description: DESCRIPTION, images: [THUMB] },
  twitter: { card: "summary", title: "Gestisci la tua prenotazione", description: DESCRIPTION, images: [THUMB.url] },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
