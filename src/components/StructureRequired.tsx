import EmptyState from "@/components/EmptyState";

// Stato vuoto per le pagine che per natura riguardano UNA struttura sola (tariffe, widget, sito…)
// quando in alto a destra è selezionato «Tutte»: la struttura si sceglie solo da lì, niente selettori nella pagina.
export default function StructureRequired({ sub = "Questa pagina riguarda una struttura alla volta." }: { sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-sm">
      <EmptyState title="Scegli una struttura in alto a destra" sub={sub} />
    </div>
  );
}
