import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Abbonamento", "Piano, moduli e prezzi del tuo account Xenora.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
