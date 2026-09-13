import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Strutture", "Le tue strutture ricettive.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
