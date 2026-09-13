import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Assistente ricavi", "Suggerimenti per far crescere gli incassi.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
