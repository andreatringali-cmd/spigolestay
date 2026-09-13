import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Preventivi", "Offerte e preventivi personalizzati per i tuoi ospiti.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
