-- Tipo di accesso: titolare (chiede l'accesso, approvato dall'admin) o collaboratore (invitato da un titolare a co-gestire la sua struttura).
alter table public.access_allowlist add column if not exists kind text not null default 'titolare';
update public.access_allowlist set kind = 'collaboratore' where note like 'Utente:%';
