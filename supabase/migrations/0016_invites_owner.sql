-- 0016 — Inviti dei collaboratori fatti dal TITOLARE dell'account (NON APPLICATA: da eseguire a mano, quando vuoi).
--
-- Il codice nuovo (api/admin/allowlist, lib/invite-access.ts) funziona SENZA questa migrazione: usa solo le colonne già esistenti
-- di access_allowlist (email, kind, added_by, note, profile, created_at) e di org_invites (code, email, status, invited_by, created_at).
-- Qui ci sono solo INDICI, per tenere veloci le ricerche nuove quando i clienti saranno tanti. Sono tutti "if not exists" e non
-- cambiano nessun dato né nessuna policy: si possono applicare, e anche togliere, senza rischi.

-- Catena «invitato da»: ogni controllo risale added_by fino al titolare dell'account.
create index if not exists access_allowlist_added_by_idx on public.access_allowlist (lower(added_by));
create index if not exists access_allowlist_kind_idx on public.access_allowlist (kind);

-- Conteggio inviti in attesa, link «Rimanda invito» (codice più recente di chi invia) e «Annulla invito».
create index if not exists org_invites_email_status_idx on public.org_invites (lower(email), status);
create index if not exists org_invites_invited_by_status_idx on public.org_invites (invited_by, status);

-- FACOLTATIVO (non usato dal codice, lasciato commentato): data dell'ultimo invio salvata sul server, così «Invito inviato il …» è
-- identico su tutti i dispositivi. Oggi la data sta sulla scheda utente (invitedAt) con ripiego su access_allowlist.created_at.
-- alter table public.access_allowlist add column if not exists invite_sent_at timestamptz;
