import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Booking Engine", "Prenotazioni dirette dal tuo sito, senza commissioni.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
