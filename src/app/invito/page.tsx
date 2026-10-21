import type { Metadata } from "next";
import { pageMeta } from "@/lib/pagemeta";
import InvitoRedirect from "./InvitoRedirect";
import PublicThemeBoot from "@/components/PublicThemeBoot";

// Anteprima link dedicata all'invito (descrizione "invita un amico").
export const metadata: Metadata = pageMeta(
  "Ti hanno invitato su Xenora",
  "Gestisci il tuo B&B con Xenora e ottieni 1 mese in regalo. Provalo gratis.",
); // colore predefinito del prodotto (prima era un viola a sé)

export default async function InvitoPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const ref = (await searchParams)?.ref || "";
  return <><PublicThemeBoot /><InvitoRedirect refCode={ref} /></>;
}
