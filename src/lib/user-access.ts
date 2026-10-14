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
