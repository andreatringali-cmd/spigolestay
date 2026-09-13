import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Fatture", "Le fatture del tuo abbonamento Xenora.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
