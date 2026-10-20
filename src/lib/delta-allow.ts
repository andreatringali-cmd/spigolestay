// Account abilitati alla «modalità veloce» (Fase 2) durante la prova: per ora solo il titolare. Un collaboratore o un altro cliente non vede l'interruttore, la
// modalità non si attiva mai e il server rifiuta le scritture a delta. Per allargare la prova si aggiunge l'uid qui.
export const DELTA_ALLOWED_UIDS: ReadonlySet<string> = new Set<string>(["285dccf2-726b-4120-9efa-88ab576a06f6"]);
export const deltaAllowedFor = (uid: string | null | undefined): boolean => !!uid && DELTA_ALLOWED_UIDS.has(uid);

// Modalità veloce ACCESA DI DEFAULT su ogni dispositivo degli account abilitati (decisione del titolare). Chiave locale `xn-delta-sync` (per dispositivo):
// assente o "1" = accesa; "0" = spenta ESPLICITAMENTE dall'utente (si ricorda). `failedUid` = marcatore di SESSIONE (sessionStorage `xn-delta-failed`): se la lettura a
// finestra è fallita in questa sessione (rete, server) la modalità resta normale fino alla chiusura della scheda, senza spegnere la scelta dell'utente per sempre
// e senza ritentare in loop a ogni ricaricamento. Per gli account non abilitati è sempre falsa.
export function deltaWantedFrom(uid: string | null | undefined, flag: string | null | undefined, failedUid: string | null | undefined): boolean {
  if (!deltaAllowedFor(uid)) return false;
  if (flag === "0") return false;
  if (failedUid && failedUid === uid) return false;
  return true;
}
