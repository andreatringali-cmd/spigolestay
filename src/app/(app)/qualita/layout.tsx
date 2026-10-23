import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Qualità", "Punteggio, andamento e temi delle recensioni dei tuoi ospiti.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
