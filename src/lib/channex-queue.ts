// ============================================================
//  Coda + throttling + retry per le chiamate API Channex
//  Requisiti di CERTIFICAZIONE:
//   - Rate limit: max 20 richieste ARI al minuto verso Channex.
//   - Resilienza: retry con backoff esponenziale + jitter su 429 e 5xx,
//     rispettando l'header Retry-After. Nessun retry su 4xx != 429.
//
//  NOTA sullo stato in memoria:
//   Coda e finestra vivono nella memoria del modulo (variabili a livello di
//   modulo). Va bene per il runtime Node di Vercel finché l'istanza resta calda.
//   Tra invocazioni serverless SEPARATE (cold start / istanze diverse) lo stato
//   NON è condiviso: ogni istanza ha la propria finestra da 20/min. È un limite
//   noto e accettabile: per la certificazione conta che una singola istanza non
//   superi mai il limite, e i picchi reali passano tutti dalla stessa istanza calda.
// ============================================================

// ── Parametri di throttling ─────────────────────────────────
// Scelta: SLIDING WINDOW (finestra scorrevole).
// Teniamo i timestamp delle ultime richieste PARTITE; prima di lanciarne una
// nuova contiamo quante sono cadute negli ultimi 60s. Se sono già 20, aspettiamo
// finché la più vecchia esce dalla finestra. La finestra scorrevole è più precisa
// del token bucket a rifornimento fisso perché non concede "burst" al confine dei
// minuti: garantisce che in QUALSIASI intervallo di 60s non ci siano più di 20 richieste.
const MAX_REQUESTS = 20; // massimo richieste per finestra
const WINDOW_MS = 60_000; // ampiezza finestra: 60 secondi

// ── Parametri di retry/backoff ──────────────────────────────
const MAX_ATTEMPTS = 5; // ~5 tentativi totali (1 iniziale + 4 retry)
// Ritardi base del backoff esponenziale (ms): 500, 1000, 2000, 4000, 8000.
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8_000; // tetto al ritardo base (prima del jitter)
const RETRY_AFTER_CAP_MS = 60_000; // tetto di sicurezza al rispetto di Retry-After

// Timestamp (ms) delle richieste già partite, in ordine crescente.
const requestTimes: number[] = [];

// Coda dei job in attesa di uno slot. Li serviamo in ordine FIFO tramite un
// "pump" che gira uno alla volta: così il conteggio della finestra resta coerente.
type Job = () => void;
const waiters: Job[] = [];
let pumping = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

// Rimuove dalla finestra i timestamp più vecchi di 60s rispetto a "now".
function pruneWindow(now: number) {
  while (requestTimes.length > 0 && now - requestTimes[0] >= WINDOW_MS) {
    requestTimes.shift();
  }
}

// Acquisisce uno slot rispettando il limite 20/min. Risolve quando è lecito
// partire; a quel punto registra il timestamp della richiesta nella finestra.
function acquireSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
    void pump();
  });
}

// Serve i waiter uno per volta: se c'è slot libero parte subito, altrimenti
// aspetta che la richiesta più vecchia esca dalla finestra, poi riprova.
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (waiters.length > 0) {
      const now = Date.now();
      pruneWindow(now);
      if (requestTimes.length < MAX_REQUESTS) {
        // C'è spazio: registriamo la partenza e sblocchiamo il prossimo job.
        requestTimes.push(now);
        const next = waiters.shift();
        next?.();
      } else {
        // Finestra piena: attendiamo che la richiesta più vecchia scada.
        const waitMs = WINDOW_MS - (now - requestTimes[0]);
        await sleep(waitMs);
      }
    }
  } finally {
    pumping = false;
  }
}

// Calcola il ritardo di backoff per il tentativo dato (0-based), con jitter.
// Esponenziale: 500 * 2^attempt, con tetto BACKOFF_MAX_MS, più jitter fino al 100%
// del ritardo base (full jitter) per evitare il "thundering herd".
function backoffDelay(attempt: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
  const jitter = Math.random() * base;
  return base + jitter;
}

// Interpreta l'header Retry-After: può essere un numero di secondi oppure una
// data HTTP. Ritorna i millisecondi da attendere, oppure null se assente/illeggibile.
function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) {
    return Math.min(Math.max(0, secs * 1000), RETRY_AFTER_CAP_MS);
  }
  const when = Date.parse(raw);
  if (Number.isFinite(when)) {
    return Math.min(Math.max(0, when - Date.now()), RETRY_AFTER_CAP_MS);
  }
  return null;
}

// Decide se lo status merita un retry: solo 429 e 5xx. 4xx (diversi da 429) no.
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

// ============================================================
//  channexFetch: drop-in di fetch con coda + throttle + retry.
//  Ritorna la Response GREZZA (senza fare parsing) dopo eventuali retry,
//  così channex() continua a leggerla esattamente come prima.
// ============================================================
export async function channexFetch(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Ogni tentativo occupa uno slot della finestra 20/min (i retry contano
    // come richieste reali verso Channex, quindi rispettano anch'essi il limite).
    await acquireSlot();

    try {
      const res = await fetch(url, init);

      // Successo o errore non ritentabile: ritorna subito la Response.
      if (!isRetryableStatus(res.status)) {
        return res;
      }

      // Status ritentabile (429 / 5xx): se abbiamo ancora tentativi, aspetta e riprova.
      const isLast = attempt === MAX_ATTEMPTS - 1;
      if (isLast) {
        // Esauriti i tentativi: ritorna comunque l'ultima Response (429/5xx),
        // così channex() la trasforma in { ok:false, status, error } come sempre.
        return res;
      }

      // Priorità a Retry-After se presente, altrimenti backoff esponenziale + jitter.
      const retryAfter = parseRetryAfter(res);
      const delay = retryAfter != null ? retryAfter : backoffDelay(attempt);
      // Consumiamo il corpo per non lasciare connessioni sospese prima del retry.
      try { await res.arrayBuffer(); } catch { /* ignora */ }
      await sleep(delay);
    } catch (e) {
      // Errore di rete: ritentiamo con backoff finché restano tentativi.
      lastError = e;
      const isLast = attempt === MAX_ATTEMPTS - 1;
      if (isLast) throw e;
      await sleep(backoffDelay(attempt));
    }
  }

  // Non dovremmo mai arrivare qui, ma per sicurezza rilanciamo l'ultimo errore.
  throw lastError instanceof Error ? lastError : new Error("channexFetch: tentativi esauriti");
}
