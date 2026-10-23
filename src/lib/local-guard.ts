// Guardia di scrittura sul localStorage (lato browser). La regola vera è in sync-owner.ts (pura e provata dai test): qui c'è solo il collegamento al browser.
//
// Una scheda "attiva" per l'account A (setActiveAccount) non può scrivere né togliere chiavi sincronizzate dal localStorage mentre il marcatore dei dati locali non è A:
// vuol dire che in un'altra scheda è entrato un altro account e il localStorage ora è SUO. Le scritture della scheda vecchia (impostazioni di A scritte dalle pagine ancora
// aperte) verrebbero spinte sul server dell'altro account. Le scritture ignorate sono sempre quelle di una scheda in pausa: si avvisa una sola volta (evento «xenora:other-account»).
import { LOCAL_OWNER_KEY } from "./sync-core";
import { readOwner, shouldBlockLocalWrite } from "./sync-owner";

let activeUid: string | null = null;
let notified = false;
let installed = false;

/** Account per cui QUESTA scheda ha finito di idratare (null = nessuno: login/uscita in corso). */
export function setActiveAccount(uid: string | null): void { activeUid = uid; notified = false; }
export function activeAccount(): string | null { return activeUid; }

function ownerNow(): string | null {
  try { return readOwner({ getItem: (k) => origGet ? origGet.call(window.localStorage, k) : window.localStorage.getItem(k) }); } catch { return null; }
}
let origGet: ((this: Storage, k: string) => string | null) | null = null;

/** true = la scrittura/rimozione di `key` va ignorata (vedi sopra). */
export function isWriteBlocked(key: string): boolean {
  if (!activeUid) return false;
  let blocked = false;
  try { blocked = shouldBlockLocalWrite(key, ownerNow(), activeUid); } catch { return false; }
  if (blocked && !notified) { notified = true; try { window.dispatchEvent(new Event("xenora:other-account")); } catch { /* ambiente senza window */ } }
  return blocked;
}

/** Installa (una sola volta) il controllo su localStorage.setItem / removeItem. Sicuro: in caso di dubbio la scrittura passa. */
export function installLocalWriteGuard(): void {
  if (installed || typeof window === "undefined" || typeof Storage === "undefined") return;
  installed = true;
  try {
    const proto = Storage.prototype;
    const set = proto.setItem, remove = proto.removeItem;
    origGet = proto.getItem;
    proto.setItem = function (this: Storage, key: string, value: string) {
      try { if (this === window.localStorage && key !== LOCAL_OWNER_KEY && isWriteBlocked(String(key))) return; } catch { /* nel dubbio passa */ }
      return set.call(this, key, value);
    };
    proto.removeItem = function (this: Storage, key: string) {
      try { if (this === window.localStorage && key !== LOCAL_OWNER_KEY && isWriteBlocked(String(key))) return; } catch { /* nel dubbio passa */ }
      return remove.call(this, key);
    };
  } catch { /* browser che non permette di sostituire i metodi: restano le altre difese */ }
}
