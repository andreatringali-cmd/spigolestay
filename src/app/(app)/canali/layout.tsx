import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Channel Manager", "Booking, Airbnb ed Expedia sempre sincronizzati.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
