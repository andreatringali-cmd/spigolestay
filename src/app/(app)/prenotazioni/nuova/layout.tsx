import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Nuova prenotazione", "Crea una prenotazione in pochi passaggi.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
