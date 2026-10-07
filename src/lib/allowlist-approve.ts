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

const FROM = process.env.RESEND_FROM || "onboarding@resend.dev";
const RESEND = process.env.RESEND_API_KEY || "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://xenora.it";

/** Avvisa via email chi ha fatto richiesta che il suo accesso è stato approvato. Usata sia dal
 * click sul link nell'email, sia dall'approvazione manuale da Accessi. Non blocca il chiamante
 * se l'invio fallisce (manca RESEND_API_KEY o errore di rete): ritorna semplicemente false. */
export async function notifyAccessApproved(email: string): Promise<boolean> {
  if (!RESEND) return false;
  const html = `<!doctype html><html lang="it"><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:16px;border:1px solid #e6e8ec;overflow:hidden;">
      <div style="background:#285f92;padding:20px 24px;color:#fff;font-weight:700;">Accesso approvato · Xenora</div>
      <div style="padding:24px;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 18px;">La tua richiesta demo è stata approvata: puoi accedere subito a Xenora con il login Google su questo indirizzo.</p>
        <div style="margin:22px 0 6px;"><a href="${APP_URL}/login" style="display:block;text-align:center;background:#285f92;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:10px;">Accedi a Xenora →</a></div>
      </div>
    </div>
    <div style="text-align:center;color:#9aa1ac;font-size:11px;margin-top:14px;">Inviato con Xenora · Digital Solution</div>
  </div></body></html>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Xenora <${FROM}>`, to: [email], subject: "Il tuo accesso a Xenora è stato approvato", html }),
    });
    return r.ok;
  } catch { return false; }
}
