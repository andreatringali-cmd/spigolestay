import type { Metadata } from "next";

// OG dedicati al check-in ospite: niente card marketing. Senza un'immagine propria WhatsApp ripiega sull'icona del sito (502 px) e sul telefono
// la mostra enorme: qui si dà una miniatura piccola (256 px, sotto i 300), che WhatsApp mette come francobollo a sinistra del titolo.
const DESCRIPTION = "Bastano due minuti: inserisci i dati e il documento prima di arrivare.";
const THUMB = { url: "/og-checkin-v2.png", width: 256, height: 256, alt: "Check-in online" };
export const metadata: Metadata = {
  title: "Check-in online",
  description: DESCRIPTION,
  robots: { index: false, follow: false }, // pagina personale dell'ospite: mai nei motori di ricerca
  openGraph: { title: "Check-in online", description: DESCRIPTION, images: [THUMB] },
  twitter: { card: "summary", title: "Check-in online", description: DESCRIPTION, images: [THUMB.url] },
};

export default function CheckinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
