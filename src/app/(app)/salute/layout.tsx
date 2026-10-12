import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Salute del sistema", "Un colpo d'occhio per sapere se invii, portali e collegamenti funzionano.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
