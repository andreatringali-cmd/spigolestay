import type { Metadata } from "next";

// SEO + anteprima link (Open Graph) per il mini-sito pubblico.
// Nota: il titolo per struttura viene impostato lato client (document.title); l'anteprima
// condivisa (WhatsApp/Facebook) usa questi valori statici finché i dati non arriveranno dal server.
export const metadata: Metadata = {
  title: "Prenota direttamente · Miglior prezzo garantito",
  description: "Prenota direttamente la tua struttura: nessuna commissione, miglior prezzo garantito. Camere, servizi, check-in e contatti.",
  openGraph: {
    title: "Prenota direttamente · Miglior prezzo garantito",
    description: "Nessuna commissione, miglior prezzo garantito. Prenota direttamente la tua struttura.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Prenota direttamente · Miglior prezzo garantito",
    description: "Nessuna commissione, miglior prezzo garantito.",
  },
  robots: { index: true, follow: true },
};

export default function SitoWebLayout({ children }: { children: React.ReactNode }) {
  return children;
}
