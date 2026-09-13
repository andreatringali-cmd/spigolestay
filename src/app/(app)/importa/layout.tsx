import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Importa dati", "Importa prenotazioni e anagrafiche da altri sistemi.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
