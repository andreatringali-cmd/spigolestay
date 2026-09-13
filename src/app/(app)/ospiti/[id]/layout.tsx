import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Scheda ospite", "Dettagli e storico dell'ospite.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
