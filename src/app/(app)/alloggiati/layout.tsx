import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Alloggiati Web", "Invio delle schedine alloggiati alla Questura.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
