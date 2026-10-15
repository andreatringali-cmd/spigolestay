// Avvisi (webhook) di Channex verso Xenora: uno per le prenotazioni e uno per i messaggi degli ospiti delle OTA, per ogni property collegata.
// Si registrano in modo idempotente. Prima si facevano solo aprendo la pagina Canali: una property senza avviso dei messaggi (nuova, o perso) non
// riceveva niente finché qualcuno non apriva Canali. Ora lo ripristina anche il controllo notturno (cron).
import { listWebhooks, createWebhook, updateWebhook } from "./channex";
import { messageHookSecret, bookingHookSecret } from "./channex-messages";

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
        if (!headers) return { created: false, alreadyActive: true, headerUpdated: false as boolean | undefined, error: undefined as string | undefined };
        const cur = Object.entries(hook.attributes?.headers ?? {}).find(([k]) => k.toLowerCase() === "x-xenora-secret")?.[1];
        if (cur === secret) return { created: false, alreadyActive: true, headerUpdated: false, error: undefined };
        const u = await updateWebhook(hook.id, { headers });
        return { created: false, alreadyActive: true, headerUpdated: u.ok, error: u.ok ? undefined : u.error };
      }
      const c = await createWebhook(pid, url, mask, headers);
      return { created: c.ok, alreadyActive: false, headerUpdated: c.ok && !!headers, error: c.ok ? undefined : c.error };
    };
    const m = await ensure(messagesUrl, "message", messageSecret);
    if (m.error) console.log("[channex hooks] webhook messaggi", pid, m.error);
    const b = await ensure(callbackUrl, "booking", bookingSecret);
    result.push({ propertyId: pid, created: b.created, alreadyActive: b.alreadyActive, headerUpdated: b.headerUpdated, messagesCreated: m.created, error: b.error ?? m.error });
  }
  return { callbackUrl, messagesUrl, result };
}
