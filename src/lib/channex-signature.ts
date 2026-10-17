// Firma HMAC dei webhook Channex (https://docs.channex.io/api-v.1-documentation/webhook-collection#webhook-security).
// Channex firma ogni chiamata con una chiave (Signing Key) che solo noi conosciamo:
//   x-hmac-timestamp      secondi Unix usati per firmare
//   x-hmac-signature-256  una (o due, durante la rotazione della chiave) firme HEX minuscole separate da virgola
//   firma = hex( HMAC_SHA256(secret, "<timestamp>.<corpo grezzo>") )
// Il corpo da firmare è quello GREZZO (byte esatti, prima di qualsiasi JSON.parse). Modulo puro: nessuna rete.
import { createHmac, timingSafeEqual } from "node:crypto";

export const HMAC_TS_HEADER = "x-hmac-timestamp";
export const HMAC_SIG_HEADER = "x-hmac-signature-256";
/** Tolleranza sull'orologio (anti-replay): consigliata da Channex. */
export const HMAC_TOLERANCE_SEC = 300;

type Env = Record<string, string | undefined>;
type HeaderGetter = { get(name: string): string | null };

export type SignatureVerdict =
  | { state: "valid" }
  | { state: "invalid"; reason: "bad_signature" | "stale_timestamp" | "bad_timestamp" }
  | { state: "absent" }            // nessuna intestazione di firma nella richiesta
  | { state: "no_key" };           // la richiesta è firmata ma da noi non è configurata la chiave

/** Chiave di firma (mostrata da Channex una volta sola alla creazione): variabile CHANNEX_SIGNING_SECRET. */
export const signingSecret = (env: Env = process.env): string => (env.CHANNEX_SIGNING_SECRET || "").trim();

const hexEq = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Firma attesa per timestamp + corpo grezzo. */
export function expectedSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * Verifica la firma di una richiesta. `absent` = la richiesta non porta la firma (webhook non ancora firmato su Channex):
 * sta al chiamante decidere se accettarla con il vecchio segreto in intestazione.
 */
export function verifyChannexSignature(headers: HeaderGetter, rawBody: string, env: Env = process.env, nowSec: number = Math.floor(Date.now() / 1000)): SignatureVerdict {
  const sigHeader = headers.get(HMAC_SIG_HEADER);
  if (!sigHeader) return { state: "absent" };
  const secret = signingSecret(env);
  if (!secret) return { state: "no_key" };
  const ts = (headers.get(HMAC_TS_HEADER) || "").trim();
  if (!/^\d{9,12}$/.test(ts)) return { state: "invalid", reason: "bad_timestamp" };
  if (Math.abs(nowSec - Number(ts)) > HMAC_TOLERANCE_SEC) return { state: "invalid", reason: "stale_timestamp" };
  const expected = expectedSignature(secret, ts, rawBody);
  const ok = sigHeader.split(",").some((s) => { const v = s.trim().toLowerCase(); return v.length === expected.length && hexEq(v, expected); });
  return ok ? { state: "valid" } : { state: "invalid", reason: "bad_signature" };
}

export type HookDecision = { accept: boolean; reason: string; signed: boolean };

/**
 * Decisione finale per un webhook: la firma HMAC, se presente e verificabile, prevale; una firma presente ma SBAGLIATA o scaduta
 * respinge sempre (anche se il vecchio segreto in intestazione fosse giusto). Senza firma si ricade sul controllo storico
 * (`legacy`), a meno che CHANNEX_SIGNATURE_REQUIRED=1: allora una richiesta non firmata è rifiutata.
 */
export function decideHook(
  headers: HeaderGetter, rawBody: string, legacy: { accept: boolean; reason: string },
  env: Env = process.env, nowSec?: number,
): HookDecision {
  const v = verifyChannexSignature(headers, rawBody, env, nowSec);
  if (v.state === "valid") return { accept: true, reason: "signed", signed: true };
  if (v.state === "invalid") return { accept: false, reason: v.reason, signed: false };
  if (v.state === "absent" && env.CHANNEX_SIGNATURE_REQUIRED === "1") return { accept: false, reason: "missing_signature", signed: false };
  return { ...legacy, signed: false };
}
