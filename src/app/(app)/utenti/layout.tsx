import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Utenti & permessi", "Team, ruoli e permessi di accesso.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
