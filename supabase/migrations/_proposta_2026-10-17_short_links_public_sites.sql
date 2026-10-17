-- PROPOSTA (NON APPLICATA) — 17/10/2026 — gruppo E (pagine ospite)
-- Da rivedere e applicare a mano, in due passi separati e DOPO il deploy del codice che la accompagna (vedi "Ordine" in fondo).
-- Il nome inizia con "_proposta_" apposta: non è nella sequenza 0001…00NN e nessuno strumento deve eseguirla da solo.
--
-- Nota: i tipi delle colonne (data jsonb, structure_id text, updated_at timestamptz) sono dedotti dal codice: verificarli con \d public.public_sites prima di applicare.
--
-- Problemi trovati:
--  1) short_links: la policy "short_links_select_all" (qual = true, ruolo anon) permette a CHIUNQUE di leggere TUTTA la tabella:
--     ogni riga ha `target` = link con id prenotazione, nome dell'ospite, codici d'ingresso (k=…), token di pagamento in chat.
--     L'unico lettore legittimo è la route /g/[code] (server): ora usa la chiave di servizio oppure la funzione get_short_link().
--  2) public_sites: la policy "public_sites_read" (qual = true) rende leggibili a chiunque anche user_id (id utente del proprietario)
--     e structure_id. Alle pagine pubbliche servono solo slug + snapshot `data` (+ nome struttura, data di aggiornamento).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) short_links: niente lettura anonima; si risolve un codice alla volta via funzione
-- ════════════════════════════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists short_links_select_all on public.short_links;
revoke select on public.short_links from anon;

-- Risolve UN codice (6+ caratteri casuali): restituisce il target oppure null. Nessuna enumerazione della tabella.
create or replace function public.get_short_link(p_code text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select target from public.short_links where code = p_code and length(p_code) between 4 and 16 limit 1;
$$;
revoke all on function public.get_short_link(text) from public;
grant execute on function public.get_short_link(text) to anon, authenticated, service_role;

-- L'inserimento resta com'è (i gestori loggati creano i link corti dal browser: shortenLink in lib/guestlink.ts).
commit;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) public_sites: user_id e structure_id non più leggibili da anon; il proprietario vede solo le sue righe
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ATTENZIONE: prima di applicare, il client deve smettere di leggere user_id / structure_id da anon:
--   - lib/publicdata.ts findAvailableSibling()/findNetworkSuggestions(): leggono user_id e poi le righe "sorelle" (stesso proprietario).
--     → sostituire con la funzione public_site_siblings(p_slug) qui sotto (security definer: restituisce solo slug, nome, snapshot).
--   - (app)/sito/page.tsx: controllo "slug già preso da un altro utente" legge user_id altrui
--     → sostituire con public.is_slug_taken(p_slug, p_structure_id) qui sotto.
--   - le pagine pubbliche che leggono `data` per slug (lib/publicdata.ts loadPublicSite) non cambiano.
begin;

drop policy if exists public_sites_read on public.public_sites;

-- Anonimo: SOLO le colonne pubbliche (privilegi di colonna: PostgREST rifiuta select di user_id / structure_id).
revoke select on public.public_sites from anon;
grant select (slug, structure_name, data, updated_at) on public.public_sites to anon;
create policy public_sites_read_anon on public.public_sites for select to anon using (true);

-- Utente loggato: vede le PROPRIE righe (user_id = auth.uid()); le altre non servono a nessuna schermata del gestionale
-- (sitemap e feed usano la chiave di servizio lato server).
create policy public_sites_read_owner on public.public_sites for select to authenticated using (user_id = auth.uid());
-- Un utente loggato che apre una pagina pubblica ha anche il ruolo "authenticated": per leggere lo snapshot altrui per slug
-- passa da questa funzione, che restituisce solo le colonne pubbliche.
create or replace function public.get_public_site(p_slug text)
returns table (slug text, structure_name text, data jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select s.slug, s.structure_name, s.data, s.updated_at from public.public_sites s where s.slug = p_slug limit 1;
$$;
revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated, service_role;

-- Strutture "sorelle" dello stesso proprietario (suggerimento "al completo → altra struttura"): senza esporre user_id.
create or replace function public.public_site_siblings(p_slug text)
returns table (slug text, structure_name text, data jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select o.slug, o.structure_name, o.data
  from public.public_sites me
  join public.public_sites o on o.user_id = me.user_id and o.slug <> me.slug
  where me.slug = p_slug
  limit 20;
$$;
revoke all on function public.public_site_siblings(text) from public;
grant execute on function public.public_site_siblings(text) to anon, authenticated, service_role;

-- Slug già usato da un'altra struttura? (per il form di pubblicazione: non rivela di chi è).
create or replace function public.is_slug_taken(p_slug text, p_structure_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.public_sites s where s.slug = p_slug and s.structure_id is distinct from p_structure_id);
$$;
revoke all on function public.is_slug_taken(text, text) from public;
grant execute on function public.is_slug_taken(text, text) to authenticated, service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Ordine consigliato
--   1. deploy del codice (già pronto: /g/[code] usa service role o get_short_link e ripiega sulla lettura diretta se la funzione non c'è);
--   2. applicare il blocco 1 (short_links) e provare un link /g/<codice> vero e uno inesistente;
--   3. portare il client a get_public_site / public_site_siblings / is_slug_taken, deploy, poi applicare il blocco 2;
--   4. verifica: con la chiave anon `select user_id from public_sites` deve dare errore di permesso; /<slug>, /prenota?site=<slug>, /embed/<slug> devono continuare a caricare.
-- Annullamento: ricreare le policy originali (using (true)) e `grant select on … to anon`.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
