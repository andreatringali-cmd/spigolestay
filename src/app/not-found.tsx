import { StatusScreen } from "@/components/PublicUi";
import PublicTheme from "@/components/PublicTheme";
import PublicThemeBoot from "@/components/PublicThemeBoot";

// Pagina 404 in italiano (prima compariva quella inglese di Next, "404 This page could not be found.").
// Stessa schermata di stato di tutte le pagine di accesso: marchio, titolo, spiegazione, un solo pulsante per tornare indietro.
export default function NotFound() {
  return (
    <>
      <PublicThemeBoot />
      <PublicTheme />
      <StatusScreen title="Pagina non trovata" text="L'indirizzo che hai aperto non esiste o non è più disponibile." action={{ href: "/", label: "Torna alla home" }} />
    </>
  );
}
