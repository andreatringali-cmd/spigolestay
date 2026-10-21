// Difese leggere per le richieste PUBBLICHE (anonime) che scrivono dati o fanno partire email: dimensione massima del corpo
// e limiti di frequenza AGGIUNTIVI a quelli per IP già presenti nelle route.
//
// Nota onesta sui limiti: sono in memoria, per istanza del server (come rateLimited in server-auth.ts). Su Vercel le istanze sono più
// di una e si azzerano a ogni avvio a freddo, quindi fermano i cicli impazziti e gli abusi semplici, NON un attacco distribuito.
// Per un limite vero serve uno stato condiviso (tabella o servizio esterno): vedi il report di sicurezza.

// Piccolo limitatore a finestra scorrevole, in memoria, SEPARATO da quello di server-auth.ts: non importa server-auth (che carica next/server)
// cosi si prova con i test di Node senza avviare Next, e le chiavi non si mescolano con quelle per IP delle route.
const hits = new Map<string, number[]>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) { for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k); }
  return false;
}

/** Vero se l'intestazione Content-Length dichiara già più di `maxBytes` (le richieste senza intestazione passano: le ferma il limite di piattaforma). */
export function declaredTooLarge(req: Request, maxBytes: number): boolean {
  const n = Number(req.headers.get("content-length") || 0);
  return Number.isFinite(n) && n > maxBytes;
}

/** Chiave del limite PER SITO pubblico (slug), da passare a rateLimited di server-auth: contiene l'abuso quando l'IP cambia di continuo. */
export const slugKey = (kind: string, slug: string): string => `${kind}:slug:${String(slug).slice(0, 80).toLowerCase()}`;

/** Finestra dei limiti per sito (10 minuti). */
export const SLUG_WINDOW_MS = 10 * 60_000;

/** Richiesta demo dal sito vetrina: poche per IP e un tetto globale orario (ogni richiesta manda una email al titolare). */
export function demoRequestLimited(ip: string): boolean {
  if (rateLimited("demo:ip:" + ip, 5, 10 * 60_000)) return true;
  return rateLimited("demo:all", 60, 60 * 60_000);
}

// Tetti usati dalle route (centralizzati qui per testarli e cambiarli in un posto solo).
export const LIMITS = {
  /** prenotazioni anonime dal sito per slug ogni 10 minuti (un sito vero ne riceve poche: oltre è abuso o un blocco di camere) */
  publicBookingPerSlug: 40,
  /** iscrizioni newsletter per slug ogni 10 minuti */
  publicLeadPerSlug: 60,
  /** dimensioni massime del corpo JSON (byte): un modulo reale è molto sotto */
  publicBookingBody: 64 * 1024,
  publicLeadBody: 8 * 1024,
  demoRequestBody: 16 * 1024,
} as const;
