import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Registro attività", "Storico delle azioni svolte nel gestionale.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
