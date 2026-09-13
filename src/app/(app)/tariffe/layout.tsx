import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Tariffe", "Prezzi, piani tariffari e restrizioni.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
