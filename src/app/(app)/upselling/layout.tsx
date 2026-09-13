import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Upselling & Extra", "Proponi servizi extra e aumenta i ricavi.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
