import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Prenotazioni", "Tutte le prenotazioni della struttura, sempre aggiornate.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
