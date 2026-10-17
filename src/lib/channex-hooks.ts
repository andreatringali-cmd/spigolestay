// Avvisi (webhook) di Channex verso Xenora: uno per le prenotazioni e uno per i messaggi degli ospiti delle OTA, per ogni property collegata.
// Si registrano in modo idempotente. Prima si facevano solo aprendo la pagina Canali: una property senza avviso dei messaggi (nuova, o perso) non
// riceveva niente finché qualcuno non apriva Canali. Ora lo ripristina anche il controllo notturno (cron).
import { listWebhooks, createWebhook, updateWebhook } from "./channex";
import { messageHookSecret, bookingHookSecret } from "./channex-messages";

/** Eventi del webhook dei messaggi: `message` (chat con prenotazione) e `inquiry` (Airbnb: richiesta di informazioni senza prenotazione). Separatore ufficiale Channex: «;». */
export const MESSAGE_EVENT_MASK = "message;inquiry";

/** La maschera registrata copre tutti gli eventi richiesti? («*» = tutti). Ordine e spazi indifferenti. */
export function maskCovers(current: string | undefined, wanted: string): boolean {
  const have = new Set((current ?? "").split(/[;,]/).map((x) => x.trim()).filter(Boolean));
  if (have.has("*")) return true;
  return wanted.split(";").every((e) => have.has(e));
}

export interface HookResult { propertyId: string; created: boolean; alreadyActive: boolean; headerUpdated?: boolean; messagesCreated?: boolean; error?: string }

export async function ensureChannexHooks(propertyIds: string[]): Promise<{ callbackUrl: string; messagesUrl: string; result: HookResult[] }> {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://xenora.it";
  const callbackUrl = `${base}/api/channex/webhook`;
  const messagesUrl = `${base}/api/channex/webhook-messages`;
  const bookingSecret = bookingHookSecret();
  const messageSecret = messageHookSecret();
  const result: HookResult[] = [];
  for (const pid of Array.from(new Set(propertyIds.filter(Boolean)))) {
    const existing = await listWebhooks(pid);
    const hooks = existing.data?.data ?? [];
    const find = (url: string) => hooks.find((h) => (h.attributes?.callback_url || "").replace(/\/$/, "") === url.replace(/\/$/, ""));
    // Registra il webhook, oppure (se esiste già) gli applica l'intestazione col segreto condiviso: i webhook registrati prima non l'avevano.
    const ensure = async (url: string, mask: string, secret: string) => {
      const hook = find(url);
      const headers = secret ? { "X-Xenora-Secret": secret } : undefined;
      if (hook) {
        // Maschera degli eventi: i webhook messaggi registrati prima avevano solo «message» (niente `inquiry` di Airbnb). Si aggiorna lo stesso webhook, senza crearne un secondo.
        // Solo per il webhook dei messaggi: quello delle prenotazioni non si tocca (ha una maschera sua).
        const needMask = url === messagesUrl && !maskCovers(hook.attributes?.event_mask, mask);
        const cur = Object.entries(hook.attributes?.headers ?? {}).find(([k]) => k.toLowerCase() === "x-xenora-secret")?.[1];
        const needHeaders = !!headers && cur !== secret;
        if (!needMask && !needHeaders) return { created: false, alreadyActive: true, headerUpdated: false as boolean | undefined, error: undefined as string | undefined };
        const u = await updateWebhook(hook.id, { ...(needHeaders ? { headers } : {}), ...(needMask ? { event_mask: mask } : {}) });
        return { created: false, alreadyActive: true, headerUpdated: needHeaders ? u.ok : false, error: u.ok ? undefined : u.error };
      }
      const c = await createWebhook(pid, url, mask, headers);
      return { created: c.ok, alreadyActive: false, headerUpdated: c.ok && !!headers, error: c.ok ? undefined : c.error };
    };
    const m = await ensure(messagesUrl, MESSAGE_EVENT_MASK, messageSecret);
    if (m.error) console.log("[channex hooks] webhook messaggi", pid, m.error);
    const b = await ensure(callbackUrl, "booking", bookingSecret);
    result.push({ propertyId: pid, created: b.created, alreadyActive: b.alreadyActive, headerUpdated: b.headerUpdated, messagesCreated: m.created, error: b.error ?? m.error });
  }
  return { callbackUrl, messagesUrl, result };
}
