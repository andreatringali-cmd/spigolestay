import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Impostazioni", "Configurazione generale del gestionale.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
