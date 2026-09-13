import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Scheda utente", "Permessi e attività dell'utente.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
