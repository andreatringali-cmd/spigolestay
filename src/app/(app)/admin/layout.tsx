import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Back-office", "Monitoraggio utenti, piani, incassi e scadenze.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
