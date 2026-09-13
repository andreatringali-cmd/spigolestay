import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Scheda struttura", "Dettagli e impostazioni della struttura.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
