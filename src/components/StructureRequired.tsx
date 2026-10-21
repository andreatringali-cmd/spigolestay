import EmptyState from "@/components/EmptyState";
import { Card } from "@/components/ui";

// Stato vuoto per le pagine che per natura riguardano UNA struttura sola (tariffe, widget, sito…)
// quando in alto a destra è selezionato «Tutte»: la struttura si sceglie solo da lì, niente selettori nella pagina.
export default function StructureRequired({ sub = "Questa pagina riguarda una struttura alla volta." }: { sub?: string }) {
  return (
    <Card padding="none" animate={false}>
      <EmptyState title="Scegli una struttura in alto a destra" sub={sub} />
    </Card>
  );
}
