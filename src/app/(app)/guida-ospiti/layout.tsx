import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Guida ospiti", "Guida digitale, check-in online e info utili per l'ospite.", "#0F6E56");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
