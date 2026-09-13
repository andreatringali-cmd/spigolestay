import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Ospiti", "Anagrafica ospiti e storico soggiorni.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
