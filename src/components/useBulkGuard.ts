"use client";

// Conferma forte + copia di sicurezza per le cancellazioni di massa (20 o più elementi).
// Uso, nel punto in cui parte la cancellazione (la pagina, mai il metodo singolo del provider dati):
//   const guard = useBulkGuard();
//   if (needsBulkGuard(n) && !(await guard({ kind: "ospiti", items, noun: "ospiti" }))) return;
// Il download parte SOLO dopo che l'utente ha scritto ELIMINA e PRIMA della cancellazione: se il browser lo blocca,
// si procede comunque ma si avvisa con un messaggio.
import { useConfirm } from "@/components/ConfirmProvider";
import { useToast } from "@/components/ToastProvider";
import { downloadBackup } from "@/lib/bulk-download";

export interface BulkGuardOptions {
  kind: string;              // usato nel nome del file: "ospiti", "prenotazioni"…
  items: unknown[];          // copia JSON degli elementi che stanno per essere cancellati
  noun: string;              // etichetta sotto il numero: "ospiti", "prenotazioni importate"…
  title?: string;
  message?: string;
  confirmLabel?: string;
}

export function useBulkGuard() {
  const ask = useConfirm();
  const toast = useToast();
  return async (o: BulkGuardOptions): Promise<boolean> => {
    const ok = await ask({
      title: o.title ?? "Eliminare molti elementi?",
      message: o.message ?? `Stai per eliminare ${o.items.length.toLocaleString("it-IT")} ${o.noun}. L'operazione non si può annullare. Prima di procedere scaricherò automaticamente una copia di sicurezza in formato JSON.`,
      danger: true,
      typeToConfirm: true,
      count: o.items.length,
      countLabel: o.noun,
      confirmLabel: o.confirmLabel ?? "Scarica copia ed elimina",
    });
    if (!ok) return false;
    if (downloadBackup(o.kind, o.items)) toast("Copia di sicurezza scaricata: la trovi nella cartella Download.", "info");
    else toast("Non sono riuscito a scaricare la copia di sicurezza (il browser potrebbe averla bloccata). Procedo comunque con l'eliminazione.", "error");
    return true;
  };
}
