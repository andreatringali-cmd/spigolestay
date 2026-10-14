-- Profilo del collaboratore compilato dal titolare (nome, telefono, permessi, strutture): al primo accesso diventa la sua scheda utente.
alter table public.access_allowlist add column if not exists profile jsonb;
