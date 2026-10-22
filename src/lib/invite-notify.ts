// Email di invito a un COLLABORATORE (mandata da un titolare, non dall'amministratore di piattaforma).
// Contiene il link a /accetta-invito (se è già pronta la condivisione di una struttura: stesso codice di org_invites) e il link di
// registrazione con l'email già compilata. Costruzione pura e testabile; l'invio usa Resend come le altre email di Xenora.
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export interface InviteEmailInput { origin: string; email: string; inviter: string; code?: string | null; accessLink?: string | null; reissue?: boolean }
export interface InviteEmail { subject: string; html: string; acceptLink: string | null; signupLink: string }

export function buildInviteEmail(i: InviteEmailInput): InviteEmail {
  const origin = i.origin.replace(/\/+$/, "");
  const signupLink = `${origin}/login?mode=signup&email=${encodeURIComponent(i.email.trim())}`;
  const acceptLink = i.code ? `${origin}/accetta-invito?code=${encodeURIComponent(i.code)}` : null;
  // Con il link personale (accessLink) basta UN clic: si sceglie la password ed è fatta, senza email di conferma. Senza, resta la vecchia registrazione.
  const main = i.accessLink ?? acceptLink ?? signupLink;
  const mainLabel = i.accessLink ? "Scegli la password ed entra →" : acceptLink ? "Accetta l'invito →" : "Crea il tuo accesso →";
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
    <div style="background:#ffffff;border-radius:16px;border:1px solid #e6e8ec;overflow:hidden;">
      <div style="background:#285f92;padding:20px 24px;color:#fff;font-weight:700;">${i.reissue ? "Il tuo link per entrare in Xenora" : "Sei stato invitato su Xenora"}</div>
      <div style="padding:24px;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 12px;">${i.reissue ? "Ecco il tuo nuovo link per entrare in <b>Xenora</b>, il gestionale per le strutture ricettive." : `<b>${esc(i.inviter)}</b> ti ha invitato a lavorare su Xenora, il gestionale per le strutture ricettive.`}</p>
        <p style="margin:0 0 18px;color:#4b5563;">L&#39;invito vale solo per questo indirizzo (<b>${esc(i.email)}</b>): accedi o registrati con la stessa email. Troverai le strutture e i permessi scelti da chi ti ha invitato.</p>
        <div style="margin:22px 0 10px;"><a href="${esc(main)}" style="display:block;text-align:center;background:#285f92;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:10px;">${mainLabel}</a></div>
        ${acceptLink && !i.accessLink ? `<p style="margin:0 0 6px;font-size:13px;color:#4b5563;">Non hai ancora un account? <a href="${esc(signupLink)}" style="color:#285f92;font-weight:600;">Creane uno con questa email</a>, poi riapri il link qui sopra.</p>` : ""}
        <p style="margin:14px 0 0;font-size:12px;color:#9aa1ac;">Se non ti aspettavi questo invito, ignora questa email: senza accedere non succede nulla.</p>
      </div>
    </div>
    <div style="text-align:center;color:#9aa1ac;font-size:11px;margin-top:14px;">Inviato con Xenora · Digital Solution</div>
  </div></body></html>`;
  return { subject: i.reissue ? "Il tuo link per entrare in Xenora" : `${i.inviter} ti ha invitato su Xenora`, html, acceptLink, signupLink };
}

/** Invia l'email. Ritorna false (senza lanciare) se manca la chiave Resend o l'invio fallisce: l'invito resta valido, si può rimandare. */
export async function sendInviteEmail(i: InviteEmailInput & { replyTo?: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY || "";
  if (!key) return false;
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  const m = buildInviteEmail(i);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Xenora <${from}>`, to: [i.email], subject: m.subject, html: m.html, ...(i.replyTo ? { reply_to: i.replyTo } : {}) }),
    });
    return r.ok;
  } catch { return false; }
}
