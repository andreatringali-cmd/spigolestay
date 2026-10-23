// Guardia di scrittura sul localStorage (lato browser). La regola vera è in sync-owner.ts (pura e provata dai test): qui c'è solo il collegamento al browser.
//
// Una scheda "attiva" per l'account A (setActiveAccount) non può scrivere né togliere chiavi sincronizzate dal localStorage mentre il marcatore dei dati locali non è A:
// vuol dire che in un'altra scheda è entrato un altro account e il localStorage ora è SUO. Le scritture della scheda vecchia (impostazioni di A scritte dalle pagine ancora
// aperte) verrebbero spinte sul server dell'altro account. Le scritture ignorate sono sempre quelle di una scheda in pausa: si avvisa una sola volta (evento «xenora:other-account»).
import { LOCAL_OWNER_KEY } from "./sync-core";
import { readOwner, writeBlockReason } from "./sync-owner";

let activeUid: string | null = null;
let notified = false;
let installed = false;

/** Account per cui QUESTA scheda ha finito di idratare (null = nessuno: login/uscita in corso). */
export function setActiveAccount(uid: string | null): void { activeUid = uid; notified = false; }
export function activeAccount(): string | null { return activeUid; }
/** Il blocco è rientrato (il marcatore è tornato quello giusto): il prossimo blocco avviserà di nuovo. */
export function rearmOtherAccountNotice(): void { notified = false; }

function ownerNow(): string | null {
  try { return readOwner({ getItem: (k) => origGet ? origGet.call(window.localStorage, k) : window.localStorage.getItem(k) }); } catch { return null; }
}
let origGet: ((this: Storage, k: string) => string | null) | null = null;

/** Avvisa la scheda (banner bloccante «in pausa»). `reason`: "other" = c'è un altro account nel locale; "unknown" = il marcatore dei dati locali manca (altra scheda in ricostruzione, o dati ripuliti dal browser). */
export function notifyOtherAccount(reason: "other" | "unknown"): void {
  try { window.dispatchEvent(new CustomEvent("xenora:other-account", { detail: { reason } })); } catch { /* ambiente senza window */ }
}
/** Motivo corrente per l'account `uid` leggendo il marcatore adesso (per i punti che non passano da una scrittura). */
export function ownerReasonNow(): "other" | "unknown" { return ownerNow() === null ? "unknown" : "other"; }

/** true = la scrittura/rimozione di `key` va ignorata (vedi sopra). */
export function isWriteBlocked(key: string): boolean {
  if (!activeUid) return false;
  let reason: "other" | "unknown" | null = null;
  try { reason = writeBlockReason(key, ownerNow(), activeUid); } catch { return false; }
  if (reason && !notified) { notified = true; notifyOtherAccount(reason); }
  return reason !== null;
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
