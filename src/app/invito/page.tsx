import type { Metadata } from "next";
import { pageMeta } from "@/lib/pagemeta";
import InvitoRedirect from "./InvitoRedirect";

// Anteprima link dedicata all'invito (descrizione "invita un amico").
export const metadata: Metadata = pageMeta(
  "Ti hanno invitato su Xenora",
  "Gestisci il tuo B&B con Xenora e ottieni 1 mese in regalo. Provalo gratis.",
  "#7b5cff",
);

export default async function InvitoPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const ref = (await searchParams)?.ref || "";
  return <InvitoRedirect refCode={ref} />;
}
