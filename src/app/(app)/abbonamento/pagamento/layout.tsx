import type { ReactNode } from "react";
import { pageMeta } from "@/lib/pagemeta";

export const metadata = pageMeta("Informazioni pagamento", "Metodo di pagamento e dati di fatturazione.");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
