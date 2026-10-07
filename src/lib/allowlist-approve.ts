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
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Avvisa via email chi ha fatto richiesta che il suo accesso è stato approvato. Usata sia dal
 * click sul link nell'email, sia dall'approvazione manuale da Accessi. Non blocca il chiamante
 * se l'invio fallisce (manca RESEND_API_KEY o errore di rete): ritorna semplicemente false.
 * È quasi sempre la PRIMA email che la persona riceve da Xenora: curata come un vero benvenuto,
 * non come una notifica di sistema — logo, tono caldo, un accenno di cosa trova dentro. */
export async function notifyAccessApproved(email: string): Promise<boolean> {
  if (!RESEND) return false;
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
  <div style="max-width:540px;margin:0 auto;padding:40px 16px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${APP_URL}/xenora-logo.png" alt="Xenora" height="34" style="height:34px;width:auto;" />
    </div>
    <div style="background:#ffffff;border-radius:20px;box-shadow:0 1px 3px rgba(20,24,33,.06),0 8px 28px rgba(20,24,33,.07);overflow:hidden;">
      <div style="background:linear-gradient(135deg,#2bd4e0 0%,#3b6fe0 55%,#7b5ce0 100%);padding:36px 32px 32px;text-align:center;">
        <div style="font-size:38px;line-height:1;margin-bottom:10px;">🎉</div>
        <div style="color:#fff;font-size:21px;font-weight:700;letter-spacing:-.01em;">Benvenuto in Xenora</div>
      </div>
      <div style="padding:30px 32px 8px;font-size:15px;line-height:1.65;">
        <p style="margin:0 0 16px;">Il tuo accesso è stato approvato: puoi entrare subito con il login Google su questo indirizzo (<b>${esc(email)}</b>).</p>
        <p style="margin:0 0 24px;color:#5b6472;">Xenora è il gestionale che unisce PMS, Channel Manager e revenue in un unico posto: al primo accesso ti guidiamo passo passo nella configurazione della tua struttura.</p>
        <div style="margin:0 0 8px;">
          <a href="${APP_URL}/login?auto=google" style="display:block;text-align:center;background:#1f2430;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:15px;border-radius:12px;">Accedi a Xenora →</a>
        </div>
      </div>
      <div style="padding:18px 32px 28px;border-top:1px solid #eef0f3;margin-top:18px;">
        <p style="margin:0;font-size:12.5px;color:#9aa1ac;">Hai ricevuto questa email perché hai richiesto una demo di Xenora. Se hai domande, rispondi pure a questa email.</p>
      </div>
    </div>
    <div style="text-align:center;color:#9aa1ac;font-size:11.5px;margin-top:22px;">Xenora · Digital Solution</div>
  </div></body></html>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Xenora <${FROM}>`, to: [email], subject: "Benvenuto in Xenora — il tuo accesso è pronto", html }),
    });
    return r.ok;
  } catch { return false; }
}
