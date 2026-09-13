import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Calendario", "Disponibilità, arrivi e partenze in un colpo d'occhio.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
