import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Tariffe derivate", "Tariffe collegate a una tipologia (uso singola, non rimborsabile…).");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
