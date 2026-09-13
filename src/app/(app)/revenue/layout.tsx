import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Revenue", "Prezzi dinamici in base a occupazione ed eventi.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
