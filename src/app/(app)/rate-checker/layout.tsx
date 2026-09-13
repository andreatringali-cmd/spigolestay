import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Rate checker", "Confronta le tue tariffe con i competitor.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
