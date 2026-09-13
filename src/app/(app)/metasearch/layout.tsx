import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Meta Search", "Connessione a Google, Trivago e altri metasearch.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
