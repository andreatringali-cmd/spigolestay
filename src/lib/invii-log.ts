// Registro degli invii automatici: ogni tentativo lascia una riga con l'esito, così un messaggio non arrivato ha sempre una spiegazione.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface InvioLog { job: "pulizie" | "messaggi" | "ota_msg" | "ota_msg_skip" | "checkin"; ref?: string; channel: "whatsapp" | "email" | "channex"; ok: boolean; detail?: string; wamid?: string }

/** Scrive l'esito di un invio. Non solleva mai errori: il registro non deve rompere l'invio. */
export async function logInvio(admin: SupabaseClient, tenantId: string, e: InvioLog): Promise<void> {
  try { await admin.from("invii_log").insert({ tenant_id: tenantId, job: e.job, ref: e.ref ?? null, channel: e.channel, ok: e.ok, detail: (e.detail ?? "").slice(0, 500) || null, wamid: e.wamid ?? null }); } catch { /* registro non disponibile */ }
}

/**
 * Anti-doppioni: c'è già un invio RIUSCITO per questo riferimento nelle ultime `ore` ore?
 * Se la lettura del registro fallisce NON blocca nulla: restituisce già=false e il motivo in `errore`, così il chiamante invia comunque e lo segnala.
 */
export async function giaInviato(admin: SupabaseClient, tenantId: string, job: InvioLog["job"], ref: string, ore: number, channel?: InvioLog["channel"], adessoMs: number = Date.now()): Promise<{ gia: boolean; errore?: string }> {
  try {
    const da = new Date(adessoMs - ore * 3600 * 1000).toISOString();
    let q = admin.from("invii_log").select("id").eq("tenant_id", tenantId).eq("job", job).eq("ref", ref).eq("ok", true).gte("at", da);
    if (channel) q = q.eq("channel", channel);
    const { data, error } = await q.limit(1);
    if (error) return { gia: false, errore: error.message };
    return { gia: !!data && data.length > 0 };
  } catch (e) { return { gia: false, errore: e instanceof Error ? e.message : "registro non leggibile" }; }
}

/** Spiegazione in italiano degli errori più comuni di WhatsApp. */
export function spiegaErroreWa(detail?: string): string {
  const d = (detail ?? "").toLowerCase();
  if (!d) return "";
  if (/131047|24 ?hour|re-?engagement|outside the allowed window/.test(d)) return "Meta non consente il testo libero se il destinatario non ha scritto nelle ultime 24 ore: serve un modello approvato.";
  if (/132001|template.*(does not exist|not found)|does not exist in the translation/.test(d)) return "Il modello di messaggio non esiste o non è approvato su WhatsApp Business.";
  if (/132000|132005|132007|132012|132015|132016|parameter/.test(d)) return "Il modello è stato rifiutato: numero o formato delle variabili non corretto.";
  if (/131026|not a valid whatsapp|undeliverable/.test(d)) return "Il numero non risulta su WhatsApp o non è raggiungibile.";
  if (/131049|ecosystem|marketing/.test(d)) return "Meta ha limitato l'invio di questo modello a questo numero (troppi messaggi promozionali).";
  // Codice 190 (token scaduto/non valido) SOLO come numero a sé: un numero di telefono o un id che contiene «190» non è un token scaduto.
  if (/(^|[^\d])190([^\d]|$)|oauth|access token|invalid token|token.*(expired|invalid)|session has expired/.test(d)) return "Il collegamento WhatsApp non è più valido: va ricollegato.";
  if (/131030|not in allowed list/.test(d)) return "Il numero non è tra quelli autorizzati.";
  return "";
}
