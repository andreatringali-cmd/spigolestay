// Profilo di un collaboratore invitato: i dati che il titolare compila in "Utenti" viaggiano con l'invito (access_allowlist.profile) e al primo
// accesso diventano la scheda utente DI LEI, con permessi e strutture. Puro (la parte che tocca localStorage è in fondo).
import { blankUser, type User } from "./users";

const PERSONAL = ["firstName", "lastName", "username", "phone", "language", "avatarColor"] as const;
const ACCESS = ["templateKey", "perms", "allStructures", "structureIds"] as const; // decide il titolare: si aggiornano a ogni accesso

const pick = (profile: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => profile[k] !== undefined).map((k) => [k, profile[k]]));

/** Aggiunge/aggiorna la scheda dell'utente collegato. Prima volta: dati personali + accesso. Dopo: solo permessi e strutture (i dati personali sono suoi). */
export function mergeAdoptedProfile(existing: User[] | null, profile: Record<string, unknown>, email: string): { list: User[]; id: string } {
  const em = email.trim().toLowerCase();
  const list = Array.isArray(existing) ? existing.slice() : [];
  const i = list.findIndex((u) => (u.email || "").trim().toLowerCase() === em);
  if (i >= 0) {
    list[i] = { ...list[i], ...pick(profile, ACCESS) } as User;
    return { list, id: list[i].id };
  }
  const base = blankUser();
  const me = {
    ...base,
    ...pick(profile, PERSONAL),
    ...pick(profile, ACCESS),
    id: typeof profile.id === "string" && profile.id ? profile.id : base.id,
    email: email.trim(),
    status: "Attivo" as const,
    active: true,
  } as User;
  // il segnaposto vuoto creato dall'app (nessuna email) lascia il posto alla sua scheda
  return { list: [me, ...list.filter((u) => (u.email || "").trim() !== "")], id: me.id };
}

const USERS_KEY = "spigolestay:users";
const CUR_KEY = "spigolestay:currentuser";

/** Applica il profilo ricevuto dal server al browser di chi è appena entrato. Ritorna true se qualcosa è cambiato. */
export function adoptProfile(profile: Record<string, unknown> | null | undefined, email: string): boolean {
  if (!profile || !email) return false;
  try {
    let existing: User[] | null = null;
    try { const raw = JSON.parse(localStorage.getItem(USERS_KEY) || "null"); if (Array.isArray(raw)) existing = raw as User[]; } catch { /* lista assente o rovinata */ }
    const { list, id } = mergeAdoptedProfile(existing, profile, email);
    const before = JSON.stringify(existing);
    const after = JSON.stringify(list);
    localStorage.setItem(USERS_KEY, after);
    localStorage.setItem(CUR_KEY, id);
    try { window.dispatchEvent(new Event("spigolestay:users")); } catch { /* niente */ }
    return before !== after;
  } catch { return false; }
}
