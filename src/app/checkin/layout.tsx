import type { Metadata } from "next";

// OG dedicati al check-in ospite: niente immagine marketing nell'anteprima dei link
// (WhatsApp/Email mostrano solo titolo + descrizione, non la card di Xenora).
export const metadata: Metadata = {
  title: "Check-in online",
  description: "Completa il check-in online per il tuo soggiorno: dati e documento in due minuti.",
  openGraph: {
    title: "Check-in online",
    description: "Completa il check-in online per il tuo soggiorno: dati e documento in due minuti.",
    images: [],
  },
  twitter: { card: "summary", images: [] },
};

export default function CheckinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
