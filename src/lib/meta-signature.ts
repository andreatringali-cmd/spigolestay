// Verifica della firma dei webhook Meta (WhatsApp Cloud API): intestazione "X-Hub-Signature-256" = "sha256=" + HMAC-SHA256
// del CORPO GREZZO della richiesta, con chiave META_APP_SECRET (il "segreto app" dell'app Meta). Modulo puro (nessun accesso a rete/DB).
import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export type MetaSigReason = "ok" | "no_secret" | "no_secret_strict" | "missing_signature" | "bad_signature";
export interface MetaSigVerdict { accept: boolean; reason: MetaSigReason }

/** Confronto a tempo costante di due stringhe (lunghezze diverse → false senza lanciare). */
export function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Firma attesa ("sha256=<hex>") per il corpo grezzo e il segreto dati. */
export function metaSignature(rawBody: string | Buffer, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Decide se accettare una chiamata al webhook WhatsApp.
 * - Segreto presente: la firma deve esserci ed essere corretta, altrimenti rifiuto (sempre).
 * - Segreto assente: si ACCETTA (fail-open, il chiamante deve loggare un avviso) finché non si imposta WHATSAPP_WEBHOOK_STRICT=1;
 *   in modalità strict, senza segreto si rifiuta.
 * In modalità strict con segreto assente, anche una firma presente non può essere verificata → rifiuto.
 */
export function verifyMetaSignature(rawBody: string | Buffer, header: string | null | undefined, env: Env = process.env): MetaSigVerdict {
  const strict = env.WHATSAPP_WEBHOOK_STRICT === "1";
  const secret = (env.META_APP_SECRET || "").trim();
  if (!secret) return strict ? { accept: false, reason: "no_secret_strict" } : { accept: true, reason: "no_secret" };
  const provided = (header || "").trim();
  if (!provided) return { accept: false, reason: "missing_signature" };
  return safeEqualStr(provided.toLowerCase(), metaSignature(rawBody, secret))
    ? { accept: true, reason: "ok" }
    : { accept: false, reason: "bad_signature" };
}
