// Controlli di PROPRIETÀ per le API Stripe: un utente può toccare solo il proprio cliente/abbonamento e il proprio conto collegato.
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { shadowStripeOwnership } from "@/lib/entities-shadow";

/** Il cliente Stripe appartiene all'utente? (stessa email, oppure un suo abbonamento Xenora con metadata.userId). */
export async function customerBelongsToUser(stripe: Stripe, customerId: string, userId: string, email: string): Promise<boolean> {
  try {
    const c = await stripe.customers.retrieve(customerId);
    if (!c || (c as Stripe.DeletedCustomer).deleted) return false;
    if (email && ((c as Stripe.Customer).email || "").toLowerCase() === email) return true;
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    return subs.data.some((s) => s.metadata?.userId === userId);
  } catch { return false; }
}

/** Il conto collegato (acct_…) è dell'utente? (creato da lui, oppure salvato in una sua struttura o in una struttura condivisa di cui è socio). */
export async function userOwnsStripeAccount(stripe: Stripe, admin: SupabaseClient, userId: string, acct: string): Promise<boolean> {
  if (!/^acct_[A-Za-z0-9]+$/.test(acct)) return false;
  // Se il conto è stato creato da Xenora porta il proprietario in metadata.uid: quello è l'unico dato non scrivibile dal chiamante.
  let metaUid = "";
  try {
    const a = await stripe.accounts.retrieve(acct);
    if (a.metadata?.uid === userId) return true;
    metaUid = a.metadata?.uid || "";
  } catch { /* conto non accessibile: si controlla nei dati */ }
  const hasAcct = (raw: unknown): boolean => {
    try {
      const d = JSON.parse(String((raw as Record<string, string> | null)?.["spigolestay:data:v1"] || "{}")) as { structures?: { stripeAccount?: string }[] };
      return (d.structures ?? []).some((s) => s.stripeAccount === acct);
    } catch { return false; }
  };
  let orgIds: string[] = [];
  const byData = async (): Promise<boolean> => {
    try {
      // Lo stato personale lo scrive il browser dell'utente: se il conto ha già un altro proprietario (metadata.uid), un acct_ scritto a mano nella propria struttura NON basta.
      if (!metaUid) {
        const { data: own } = await admin.from("app_state").select("data").eq("user_id", userId).maybeSingle();
        if (own && hasAcct(own.data)) return true;
      }
      const { data: mem } = await admin.from("memberships").select("org_id").eq("user_id", userId);
      orgIds = (mem ?? []).map((m: { org_id?: string }) => m.org_id).filter((x): x is string => !!x);
      if (orgIds.length) {
        const { data: orgs } = await admin.from("org_state").select("data").in("org_id", orgIds);
        if ((orgs ?? []).some((o: { data?: unknown }) => hasAcct(o.data))) return true;
      }
    } catch { /* nel dubbio: non è suo */ }
    return false;
  };
  const owned = await byData();
  // Fase 3, passo 1: con SERVER_READ_ENTITIES=compare la stessa decisione si ricalcola dalle tabelle e si confronta; vale SEMPRE il risultato del blocco.
  await shadowStripeOwnership(admin, userId, acct, { skipPersonal: !!metaUid, orgIds, fromBlock: owned });
  return owned;
}
