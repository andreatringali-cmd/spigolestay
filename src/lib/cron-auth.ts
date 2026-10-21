// Autorizzazione delle route cron: confronto del segreto a TEMPO COSTANTE (niente differenze di tempo da cui indovinare il segreto
// carattere per carattere). Modulo puro (nessun accesso a rete/DB), usato da tutte le route /api/cron/* e /api/channex/cron.
//
// Il comportamento resta quello storico: il segreto arriva in "Authorization: Bearer <CRON_SECRET>" (Vercel Cron) oppure, per la prova
// a mano, nel parametro ?secret= (o ?key= per /api/channex/cron). Senza CRON_SECRET configurato NESSUNA richiesta è autorizzata.
import { timingSafeEqual } from "node:crypto";

/** Confronto a tempo costante di due stringhe (lunghezze diverse → false senza lanciare). */
export function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Segreto presente nel Bearer dell'intestazione Authorization ("" se manca o non è Bearer). */
export function bearerOf(req: Request): string {
  const h = req.headers.get("authorization") || "";
  return /^Bearer\s/i.test(h) ? h.replace(/^Bearer\s+/i, "") : "";
}

/**
 * Vero se la richiesta porta il segreto giusto: Bearer oppure parametro di query (default "secret").
 * Falso se `secret` è vuoto/assente (cron non configurato: mai autorizzato).
 */
export function cronAuthorized(req: Request, secret: string | undefined, queryParams: string[] = ["secret"]): boolean {
  if (!secret) return false;
  if (safeEqualStr(bearerOf(req), secret)) return true;
  let url: URL | null = null;
  try { url = new URL(req.url); } catch { /* url non valido: solo Bearer */ }
  if (!url) return false;
  return queryParams.some((p) => safeEqualStr(url.searchParams.get(p) || "", secret));
}
