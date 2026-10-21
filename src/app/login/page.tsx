import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import PublicThemeBoot from "@/components/PublicThemeBoot";

// Titolo della scheda del browser: "Accedi · Xenora" (il modulo è un componente client e non può esportare i metadati).
export const metadata: Metadata = { title: "Accedi · Xenora" };

export default function LoginPage() {
  return <><PublicThemeBoot /><LoginForm /></>;
}
