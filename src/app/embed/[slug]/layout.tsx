import type { Metadata } from "next";

// L'embed vive dentro un iframe di un altro sito: non deve essere indibbato come
// pagina a sé (il contenuto è già indicizzato via /<slug> e /prenota).
export const metadata: Metadata = {
  title: "Prenota",
  robots: { index: false, follow: false },
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
