import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Messaggi", "Conversazioni con gli ospiti delle OTA e modelli di messaggio.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
