import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Housekeeping", "Planning pulizie giornaliero, camera per camera.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
