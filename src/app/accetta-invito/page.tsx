import type { Metadata } from "next";
import AccettaInvito from "./AccettaInvito";
import PublicThemeBoot from "@/components/PublicThemeBoot";

// Titolo della scheda del browser (il corpo è un componente client e non può esportare i metadati).
export const metadata: Metadata = { title: "Accetta l'invito · Xenora" };

export default function AccettaInvitoPage() {
  return <><PublicThemeBoot /><AccettaInvito /></>;
}
