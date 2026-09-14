import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Piani tariffari", "La stessa camera, più modi di venderla: colazione, non rimborsabile, flessibile…");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
