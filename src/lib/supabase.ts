// Client Supabase (browser). Le chiavi sono pubbliche (publishable/anon): possono stare nel frontend,
// la sicurezza vera è nelle policy RLS lato database. Se le variabili non ci sono, l'app resta in
// modalità solo-locale (localStorage) senza rompersi.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseEnabled = Boolean(url && key);

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url as string, key as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
