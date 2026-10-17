import type { Metadata } from "next";

// Anteprima link (WhatsApp, iMessage…) e motori di ricerca: titolo neutro, nessun dato della prenotazione, pagina non indicizzata.
// Il layout principale ha un'anteprima "Xenora gestionale" che qui non c'entra: la sostituiamo con una miniatura piccola (come per il check-in).
const DESCRIPTION = "Verifica la disponibilità e prenota direttamente dalla struttura.";
const THUMB = { url: "/og-pagamento.png", width: 256, height: 256, alt: "Prenota online" };
export const metadata: Metadata = {
  title: "Prenota online",
  description: DESCRIPTION,
  robots: { index: false, follow: true }, // la pagina vera di ogni struttura è xenora.it/<slug>: qui non si indicizza il motore con i parametri
  openGraph: { title: "Prenota online", description: DESCRIPTION, images: [THUMB] },
  twitter: { card: "summary", title: "Prenota online", description: DESCRIPTION, images: [THUMB.url] },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
