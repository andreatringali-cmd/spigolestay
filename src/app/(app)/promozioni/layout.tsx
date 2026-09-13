import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Promozioni", "Campagne e offerte per riempire le camere.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
