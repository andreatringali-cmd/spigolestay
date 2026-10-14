// Accesso reale a Xenora per un utente creato in "Utenti": invito (email con il link di registrazione, dove la persona sceglie LEI la password),
// condivisione delle strutture e permessi. Puro: nessun import di rete; le chiamate le fa il componente.

/** Link di registrazione con l'email già compilata: la persona imposta la propria password al primo accesso. */
export function signupLink(origin: string, email: string): string {
  return `${origin.replace(/\/+$/, "")}/login?mode=signup&email=${encodeURIComponent(email.trim())}`;
}

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/** Messaggio leggibile per un errore dell'API di invito/condivisione. */
export function humanInviteError(code?: string, message?: string): string {
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
