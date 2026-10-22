// Link personale di accesso per chi è stato invitato: UN solo clic dall'email e si sceglie la password (niente seconda email di conferma).
// Il link è firmato (HMAC) con lo stesso segreto del link di approvazione (ALLOWLIST_APPROVE_SECRET): chi non ha ricevuto l'email non può costruirlo,
// quindi riceverlo equivale a dimostrare di possedere quell'indirizzo. Vale 7 giorni. Senza segreto configurato la funzione resta spenta
// e si usa la vecchia registrazione (con la conferma di Supabase).
import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const secret = () => process.env.ALLOWLIST_APPROVE_SECRET || "";
export const accessLinkEnabled = () => !!secret();

const normEmail = (e: string) => String(e || "").trim().toLowerCase();

/** Solo percorsi interni dell'app: mai un indirizzo esterno (open redirect). */
export function safeNext(n: unknown): string {
  if (typeof n !== "string") return "/";
  if (!n.startsWith("/") || n.startsWith("//") || n.includes("\\") || n.length > 300) return "/";
  return n;
}

function sign(email: string, ts: string, next: string): string {
  return createHmac("sha256", secret()).update(`access|${normEmail(email)}|${ts}|${next}`).digest("hex");
}

/** Indirizzo del link (null se la firma non è configurata). `now` serve solo ai test. */
export function buildAccessUrl(origin: string, email: string, next: unknown = "/", now: number = Date.now()): string | null {
  if (!accessLinkEnabled()) return null;
  const ts = String(Math.floor(now / 1000));
  const n = safeNext(next);
  const q = new URLSearchParams({ e: normEmail(email), t: ts, n, s: sign(email, ts, n) });
  return `${origin.replace(/\/+$/, "")}/accesso?${q.toString()}`;
}

/** Verifica email + data + percorso + firma. Ritorna l'email normalizzata se valida e non scaduta, altrimenti null. */
export function verifyAccessToken(email: string, ts: string, next: string, sig: string, now: number = Date.now()): string | null {
  if (!accessLinkEnabled() || !email || !ts || !sig) return null;
  const age = Math.floor(now / 1000) - Number(ts);
  if (!Number.isFinite(age) || age < -60 || age > MAX_AGE_SECONDS) return null;
  if (safeNext(next) !== next) return null;
  let a: Buffer, b: Buffer;
  try { a = Buffer.from(sign(email, ts, next), "hex"); b = Buffer.from(sig, "hex"); } catch { return null; }
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return normEmail(email);
}

/**
 * Che cosa fare quando la persona sceglie la password dal link:
 *  - nessun accesso: lo si crea ("create"); accesso rimasto a metà, email mai confermata: lo si completa ("complete");
 *  - accesso già confermato (es. registrato con Google, tolto dall'elenco e invitato di nuovo): il link firmato prova che l'indirizzo è suo, come una
 *    email di reset, quindi può impostare la password ("reset") a patto che da quando il link è stato creato NON abbia fatto altri accessi: così il link
 *    si «consuma» da solo (appena entra, un link vecchio non vale più) e non si può riusare ("used").
 */
export function decideAccess(existing: { confirmed: boolean; lastSignInAt?: string | null } | null, tsSeconds: number): "create" | "complete" | "reset" | "used" {
  if (!existing) return "create";
  if (!existing.confirmed) return "complete";
  const last = existing.lastSignInAt ? Date.parse(existing.lastSignInAt) : NaN;
  if (Number.isFinite(last) && last >= tsSeconds * 1000) return "used";
  return "reset";
}
