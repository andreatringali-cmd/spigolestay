import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Statistiche & BI", "Report e andamento della tua struttura.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
