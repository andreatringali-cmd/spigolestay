// Link di approvazione accesso firmato (cliccabile dall'email di richiesta demo), così il
// titolare può leggere la richiesta e approvarla con un click, senza aprire Accessi e ricopiare l'email.
// Protetto da firma HMAC con ALLOWLIST_APPROVE_SECRET (impostata su Vercel): senza quella chiave
// il link non si può falsificare. Se il segreto non è configurato la feature resta disattiva
// (demo-request non include il pulsante).
import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // link valido 30 giorni

export function allowlistApproveEnabled(): boolean {
  return !!process.env.ALLOWLIST_APPROVE_SECRET;
}

function sign(email: string, ts: string): string {
  const secret = process.env.ALLOWLIST_APPROVE_SECRET || "";
  return createHmac("sha256", secret).update(`${email}|${ts}`).digest("hex");
}

/** Costruisce i parametri firmati per il link di approvazione (null se il segreto non è configurato). */
export function buildApprovalToken(email: string): { e: string; t: string; s: string } | null {
  if (!allowlistApproveEnabled()) return null;
  const ts = String(Math.floor(Date.now() / 1000));
  return { e: email, t: ts, s: sign(email, ts) };
}

/** Verifica email+ts+firma. Ritorna l'email se valida e non scaduta, altrimenti null. */
export function verifyApprovalToken(email: string, ts: string, sig: string): string | null {
  if (!allowlistApproveEnabled() || !email || !ts || !sig) return null;
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_SECONDS) return null;
  const expected = sign(email, ts);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return email;
}
