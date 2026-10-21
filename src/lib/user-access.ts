import type { User } from "./users";

// Accesso reale a Xenora per un utente creato in "Utenti": invito (email con il link di registrazione, dove la persona sceglie LEI la password),
// condivisione delle strutture e permessi. Puro: nessun import di rete; le chiamate le fa il componente.

/** Link di registrazione con l'email già compilata: la persona imposta la propria password al primo accesso. */
export function signupLink(origin: string, email: string): string {
  return `${origin.replace(/\/+$/, "")}/login?mode=signup&email=${encodeURIComponent(email.trim())}`;
}

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/** Messaggio leggibile per un errore dell'API di invito/condivisione. */
export function humanInviteError(code?: string, message?: string): string {
  // Errori dell'invito del collaboratore: il server manda già una frase completa in italiano (con l'indirizzo giusto).
  if (message && ["email_other_account", "already_member", "invite_limit", "missing_permission", "rate_limited", "invite_not_found"].includes(code ?? "")) return message;
  if (code === "not_owner") return "le strutture saranno condivise appena il titolare dell'account aprirà Xenora";
  if (code === "email_not_registered") return "non ha ancora completato la registrazione: appena si è registrata, riprova a condividere le strutture";
  if (code === "self_invite") return "è il tuo stesso account";
  if (code === "forbidden") return "solo il titolare può farlo";
  if (code === "unauthorized") return "sessione scaduta: esci e rientra";
  return message || "non riuscito";
}

/** Strutture da condividere: tutte se il profilo le abilita tutte, altrimenti solo quelle scelte (e che esistono). */
export function structuresToShare<T extends { id: string }>(all: T[], u: { allStructures?: boolean; structureIds?: string[] }): T[] {
  if (u.allStructures) return all;
  const ids = new Set(u.structureIds ?? []);
  return all.filter((s) => ids.has(s.id));
}

/** Permessi del profilo da applicare al co-gestore: solo i livelli noti (none/view/edit), niente chiavi vuote. */
export function permsForMember(perms: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(perms ?? {})) if (v === "none" || v === "view" || v === "edit") out[k] = v;
  return out;
}

/** Profilo di un collaboratore che viaggia con l'invito: solo i campi noti, con tipi e lunghezze controllati. */
export function sanitizeProfile(p: unknown): Record<string, unknown> | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const out: Record<string, unknown> = {};
  const fields: [string, number][] = [["id", 60], ["firstName", 80], ["lastName", 80], ["username", 60], ["phone", 40], ["language", 8], ["avatarColor", 20], ["templateKey", 30]];
  for (const [k, max] of fields) { const v = str(o[k], max); if (v !== undefined) out[k] = v; }
  if (o.perms && typeof o.perms === "object") out.perms = permsForMember(o.perms as Record<string, string>);
  if (typeof o.allStructures === "boolean") out.allStructures = o.allStructures;
  if (Array.isArray(o.structureIds)) out.structureIds = o.structureIds.filter((x) => typeof x === "string").slice(0, 100);
  return Object.keys(out).length ? out : null;
}

/** Frase per l'utente dopo una chiamata fallita a /api/admin/allowlist (mai un generico «solo dal titolare» quando lo si è). */
export function inviteFailureMessage(status: number, j: { error?: unknown; message?: unknown } | null | undefined): string {
  const msg = typeof j?.message === "string" ? j.message : "";
  if (msg) return msg;
  if (status === 401) return "Sessione scaduta: esci e rientra, poi riprova.";
  if (status === 403) return "Non hai il permesso di invitare utenti in questo account.";
  if (status === 429) return "Troppi inviti in poco tempo: riprova più tardi.";
  if (status === 503) return "Servizio momentaneamente non disponibile: riprova tra poco.";
  return "L'invito non è partito: riprova.";
}

/** Stato dell'invito di una scheda: null = non c'è un invito da mostrare (utente già entrato, sé stessi, nessuna email). */
export type InviteState = { kind: "sent"; at: string } | { kind: "mail-failed"; at: string } | { kind: "not-sent" };
export function inviteStateOf(u: User, opts: { selfEmail?: string; lastAccess?: string | null; serverDates?: Record<string, string> }): InviteState | null {
  const email = u.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || u.id === "u-owner") return null;
  if (opts.selfEmail && opts.selfEmail.trim().toLowerCase() === email) return null;
  if (opts.lastAccess) return null;
  const at = u.invitedAt || opts.serverDates?.[email] || "";
  if (!at) return { kind: "not-sent" };
  return u.inviteMailFailed ? { kind: "mail-failed", at } : { kind: "sent", at };
}
