// Chi possiede i dati locali? Logica PURA (niente browser né rete) per proteggere gli account dallo scambio di dati tra schede.
//
// PROBLEMA: il localStorage è condiviso tra TUTTE le schede dello stesso browser, la sessione di accesso anche. Se in una scheda si entra con un altro account (B),
// la scheda che era rimasta su A (in secondo piano, sospesa dal telefono, aperta da ore) continua a vivere: il suo timer di sincronizzazione ripristina i dati di A nel
// localStorage che ora contiene i dati di B, e/o le sue pagine continuano a scrivere impostazioni di A nelle stesse chiavi. La scheda di B vede un localStorage "cambiato" e
// lo spinge sul server di B: è così che impostazioni (pulizie, registro invii, cassa, guida…) di un account sono finite nell'altro.
//
// DIFESA, a tre livelli (tutti si appoggiano su LOCAL_OWNER_KEY, il marcatore «di chi sono i dati locali», scritto solo da chi ha finito di idratare):
//  1) la scheda NON legge dal localStorage per spingere sul server se il marcatore non è il suo (isLocalForeign);
//  2) la scheda NON riscrive nel localStorage ciò che ha scaricato dal server se il marcatore non è il suo;
//  3) una scheda "attiva" per l'account A NON può nemmeno scrivere chiavi sincronizzate nel localStorage finché il marcatore non è A (shouldBlockLocalWrite):
//     così le sue pagine non possono sporcare i dati dell'altro account.
// Un marcatore ASSENTE vale come «non sicuro» (un altro account sta svuotando/ricostruendo il locale): si aspetta, non si scambia nulla.
import { isSyncKey, LOCAL_OWNER_KEY, SYNCBASE_KEY } from "./sync-core";

/** Qualcosa che sa leggere una chiave (localStorage, o una finta nei test). */
export interface OwnerReader { getItem(key: string): string | null }

/** Marcatore corrente (null se assente o storage non disponibile). */
export function readOwner(store: OwnerReader): string | null {
  try { return store.getItem(LOCAL_OWNER_KEY); } catch { return null; }
}

/** true = i dati locali NON sono (con certezza) di `uid`: non vanno né letti per il server né sovrascritti. Storage non disponibile → false (come prima: niente da proteggere). */
export function isLocalForeign(store: OwnerReader, uid: string): boolean {
  try { return store.getItem(LOCAL_OWNER_KEY) !== uid; } catch { return false; }
}

/**
 * Una scrittura su `key` va ignorata? Solo se la scheda ha un account attivo (`activeUid`), la chiave è sincronizzata e il marcatore non è quello dell'account attivo.
 * Una scheda senza account attivo (login, idratazione in corso, uscita) scrive liberamente: è lei che costruisce il locale.
 */
export function shouldBlockLocalWrite(key: string, owner: string | null, activeUid: string | null): boolean {
  if (!activeUid) return false;
  if (!isSyncKey(key)) return false;
  return owner !== activeUid;
}

/** Ordine con cui si svuota il locale di un account: PRIMA il marcatore e la base (così le altre schede capiscono subito che il locale non è più sicuro), poi le chiavi. */
export function wipeOrder(allKeys: readonly string[]): string[] {
  return [LOCAL_OWNER_KEY, SYNCBASE_KEY, ...allKeys.filter((k) => isSyncKey(k))];
}
