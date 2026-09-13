import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Recensioni", "Raccogli e gestisci le recensioni degli ospiti.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
