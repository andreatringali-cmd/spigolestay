import type { Metadata } from "next";
import LoginForm from "./LoginForm";

// Titolo della scheda del browser: "Accedi · Xenora" (il modulo è un componente client e non può esportare i metadati).
// La pagina di accesso resta sempre chiara (sfondo con le onde, logo completo): nessun tema scuro qui.
export const metadata: Metadata = { title: "Accedi · Xenora" };

export default function LoginPage() {
  return <LoginForm />;
}
