// Cifratura delle credenziali dei portali PA (Questura/Alloggiati Web, ISTAT).
// SOLO lato server: usa la chiave segreta CRED_SECRET (impostata su Vercel) per
// derivare via SHA-256 una chiave AES-256, e cifra con AES-256-GCM.
//
// Formato del testo cifrato:  enc:v1:<iv base64>:<authTag base64>:<ciphertext base64>
// I valori legacy (plaintext, salvati prima della cifratura) NON hanno il prefisso
// "enc:v1:" e vengono restituiti invariati da decryptCred → nessuna migrazione forzata.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const secret = process.env.CRED_SECRET;
  if (!secret) return null;
  // SHA-256 del segreto → 32 byte esatti per AES-256.
  return createHash("sha256").update(secret, "utf8").digest();
}

/** true se la chiave di cifratura è configurata (CRED_SECRET presente). */
export function hasCredKey(): boolean {
  return !!process.env.CRED_SECRET;
}

/** true se il valore è già cifrato con questo schema. */
export function isEncrypted(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/**
 * Cifra una credenziale in chiaro. Se manca CRED_SECRET restituisce il testo
 * invariato (fallback: comportamento pre-cifratura, senza rompere il salvataggio).
 * Stringa vuota/undefined → "".
 */
export function encryptCred(plain: string | null | undefined): string {
  const text = (plain ?? "").toString();
  if (!text) return "";
  if (isEncrypted(text)) return text; // già cifrato, non ricifrare
  const k = key();
  if (!k) return text; // nessuna chiave: resta in chiaro (fallback)
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Decifra una credenziale. I valori legacy in chiaro (senza prefisso) tornano
 * invariati. Se il valore è cifrato ma manca la chiave / è corrotto → "".
 */
export function decryptCred(stored: string | null | undefined): string {
  const text = (stored ?? "").toString();
  if (!text) return "";
  if (!isEncrypted(text)) return text; // legacy plaintext
  const k = key();
  if (!k) return "";
  try {
    const [, , ivB64, tagB64, ctB64] = text.split(":");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ct = Buffer.from(ctB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
