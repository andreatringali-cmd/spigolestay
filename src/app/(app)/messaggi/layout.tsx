import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Messaggi & automazioni", "Messaggi automatici agli ospiti su WhatsApp ed email.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
