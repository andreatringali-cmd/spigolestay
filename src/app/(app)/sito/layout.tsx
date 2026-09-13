import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Sito web", "Il mini-sito della struttura con motore prenotazioni.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
