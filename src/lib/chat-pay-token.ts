// Token FIRMATO del link di pagamento in chat (solo server, usa node:crypto).
//
// Il link inviato all'ospite NON è l'URL Stripe Checkout (scade dopo max 24 ore e l'ospite può
// leggere il messaggio giorni dopo): è un link stabile di Xenora che, aprendolo, crea al momento
// una sessione Checkout fresca. Il token lega il link a: tenant (chi ha creato il link),
// prenotazione, tipo, importo massimo e scadenza, e non è falsificabile (HMAC-SHA256).
// L'importo nel token è solo un TETTO: al click viene comunque ricontrollato sul residuo reale.
import { createHmac, timingSafeEqual } from "node:crypto";

export type PayKind = "saldo" | "tassa";

export interface PayTokenPayload {
  /** tenant (utente che ha creato il link): serve a ritrovare prenotazione e thread di chat */
  u: string;
  /** id prenotazione */
  b: string;
  k: PayKind;
  /** importo massimo in centesimi */
  c: number;
  /** scadenza (epoch secondi) */
  e: number;
}

export const PAY_TOKEN_TTL_DAYS = 45;

/** Segreto di firma: CHAT_PAY_SECRET se presente, altrimenti CRED_SECRET (già su Vercel). */
export function paySecret(): string | null {
  return process.env.CHAT_PAY_SECRET || process.env.CRED_SECRET || null;
}

const b64u = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const mac = (body: string, secret: string) => createHmac("sha256", secret).update(`chatpay.v1:${body}`).digest();

export function signPayToken(p: PayTokenPayload, secret: string): string {
  const body = b64u(JSON.stringify([p.u, p.b, p.k, p.c, p.e]));
  return `${body}.${b64u(mac(body, secret))}`;
}

export type VerifyResult = { ok: true; payload: PayTokenPayload } | { ok: false; error: "malformed" | "bad_signature" | "expired" };

export function verifyPayToken(token: string, secret: string, nowSec: number = Math.floor(Date.now() / 1000)): VerifyResult {
  const i = typeof token === "string" ? token.lastIndexOf(".") : -1;
  if (i <= 0) return { ok: false, error: "malformed" };
  const body = token.slice(0, i), sig = token.slice(i + 1);
  let given: Buffer;
  try { given = Buffer.from(sig, "base64url"); } catch { return { ok: false, error: "malformed" }; }
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, error: "bad_signature" };
  let arr: unknown;
  try { arr = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, error: "malformed" }; }
  if (!Array.isArray(arr) || arr.length !== 5) return { ok: false, error: "malformed" };
  const [u, b, k, c, e] = arr as [unknown, unknown, unknown, unknown, unknown];
  if (typeof u !== "string" || typeof b !== "string" || (k !== "saldo" && k !== "tassa") || typeof c !== "number" || typeof e !== "number" || !u || !b || !(c > 0)) return { ok: false, error: "malformed" };
  if (nowSec > e) return { ok: false, error: "expired" };
  return { ok: true, payload: { u, b, k, c, e } };
}
