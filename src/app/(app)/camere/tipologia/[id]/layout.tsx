import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Tipologia camera", "Dettagli e configurazione della tipologia.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
