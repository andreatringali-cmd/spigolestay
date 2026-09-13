import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Tassa di soggiorno", "Calcolo e rendicontazione dell'imposta di soggiorno.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
