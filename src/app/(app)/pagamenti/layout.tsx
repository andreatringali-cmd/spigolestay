import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Incassi", "Pagamenti e incassi delle prenotazioni.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
