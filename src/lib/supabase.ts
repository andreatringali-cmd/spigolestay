// Client Supabase (browser). Le chiavi sono pubbliche (publishable/anon): possono stare nel frontend,
// la sicurezza vera è nelle policy RLS lato database. Se le variabili non ci sono, l'app resta in
// modalità solo-locale (localStorage) senza rompersi.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// NEXT_PUBLIC_LOCAL_ONLY=1 (solo in sviluppo, mai impostata in produzione) tiene l'app in modalità solo-locale, senza accesso: serve per provare le schermate in locale con dati di esempio.
export const supabaseEnabled = Boolean(url && key) && process.env.NEXT_PUBLIC_LOCAL_ONLY !== "1";

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url as string, key as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
