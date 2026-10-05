// Archivio locale per i dati GRANDI.
// Il browser concede a localStorage solo ~5 MB per sito: il blocco principale (prenotazioni, ospiti, camere…) li ha
// raggiunti e l'app smetteva di salvare. Il blocco grande vive ora in IndexedDB (centinaia di MB); tutto il resto
// (impostazioni, chat, piccole chiavi) resta in localStorage come prima.
//
// L'app legge e scrive in modo SINCRONO, quindi i valori grandi sono tenuti in memoria (caricati una volta all'avvio:
// initBigStore) e scritti su IndexedDB in differita (write-behind). kvFlush() aspetta che la scrittura sia completata:
// va chiamato prima di ricaricare/cambiare pagina.
// Se IndexedDB non è disponibile (navigazione privata, browser vecchi) tutto funziona come prima, su localStorage.

const BIG_KEYS = new Set<string>(["spigolestay:data:v1"]);
const DB_NAME = "xenora-kv";
const STORE = "kv";
const MIGRATED_FLAG = "xn-bigstore-migrated"; // fuori dal prefisso sincronizzato: resta solo su questo dispositivo

let enabled = false;
const mem = new Map<string, string>();
const pending = new Map<string, string | null>(); // null = da cancellare
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> = Promise.resolve();
let db: IDBDatabase | null = null;
let initPromise: Promise<void> | null = null;

const isBig = (k: string) => enabled && BIG_KEYS.has(k);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("indexeddb blocked"));
  });
}
function idbGet(key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const r = db!.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(typeof r.result === "string" ? r.result : undefined);
    r.onerror = () => reject(r.error);
  });
}
function idbWrite(entries: [string, string | null][]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db!.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    for (const [k, v] of entries) { if (v === null) os.delete(k); else os.put(v, k); }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reportFull() { try { window.dispatchEvent(new Event("xenora:storage-full")); } catch { /* ambiente senza window */ } }

function runFlush(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  flushing = flushing.then(async () => {
    if (!pending.size || !db) return;
    const batch = [...pending.entries()];
    batch.forEach(([k, v]) => { if (pending.get(k) === v) pending.delete(k); }); // se nel frattempo cambia, resta in coda
    try { await idbWrite(batch); } catch { batch.forEach(([k, v]) => { if (!pending.has(k)) pending.set(k, v); }); reportFull(); }
  });
  return flushing;
}
const schedule = () => { if (!timer) timer = setTimeout(() => { void runFlush(); }, 150); };

/** Aspetta che tutte le scritture differite siano state salvate (da chiamare prima di ricaricare la pagina). */
export function kvFlush(): Promise<void> { return enabled ? runFlush().catch(() => undefined) : Promise.resolve(); }

/** Da chiamare UNA volta all'avvio, prima di leggere i dati: carica i valori grandi in memoria e migra quelli vecchi. */
export function initBigStore(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
    try {
      db = await openDb();
      let migrated = false;
      try { migrated = localStorage.getItem(MIGRATED_FLAG) === "1"; } catch { /* storage non disponibile */ }
      for (const key of BIG_KEYS) {
        const idbVal = await idbGet(key);
        let lsVal: string | null = null;
        try { lsVal = localStorage.getItem(key); } catch { /* storage non disponibile */ }
        let val: string | null = idbVal ?? null;
        if (lsVal != null && !migrated) {
          // Prima volta: la copia in localStorage (scritta dalla versione precedente) è quella buona. Si sposta in IndexedDB
          // e si cancella da localStorage SOLO dopo aver riletto la copia nuova.
          await idbWrite([[key, lsVal]]);
          if ((await idbGet(key)) === lsVal) { val = lsVal; try { localStorage.removeItem(key); } catch { /* resta anche lì */ } }
          else val = lsVal;
        } else if (lsVal != null && migrated) {
          try { localStorage.removeItem(key); } catch { /* ignora */ } // copia vecchia rimasta: IndexedDB è la fonte
        }
        if (val != null) mem.set(key, val);
      }
      try { localStorage.setItem(MIGRATED_FLAG, "1"); } catch { /* ignora */ }
      enabled = true;
      const onHide = () => { void runFlush(); };
      window.addEventListener("pagehide", onHide);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") onHide(); });
    } catch {
      enabled = false; mem.clear(); db = null; // IndexedDB inutilizzabile: si resta su localStorage
    }
  })();
  return initPromise;
}

export function kvGet(key: string): string | null {
  if (isBig(key)) return mem.get(key) ?? null;
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Scrive. Per le chiavi normali può lanciare (quota localStorage) come localStorage.setItem. */
export function kvSet(key: string, value: string): void {
  if (isBig(key)) { mem.set(key, value); pending.set(key, value); schedule(); return; }
  localStorage.setItem(key, value);
}

export function kvRemove(key: string): void {
  if (isBig(key)) { mem.delete(key); pending.set(key, null); schedule(); return; }
  try { localStorage.removeItem(key); } catch { /* ignora */ }
}

/** Tutte le chiavi presenti: quelle di localStorage più i valori grandi tenuti in memoria. */
export function kvKeys(): string[] {
  const out: string[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } } catch { /* ignora */ }
  if (enabled) for (const k of mem.keys()) if (!out.includes(k)) out.push(k);
  return out;
}

/** Solo per i test. */
export function __resetBigStoreForTests() { enabled = false; mem.clear(); pending.clear(); db = null; initPromise = null; timer = null; }
