-- Registro degli invii automatici (planning pulizie, messaggi agli ospiti): esito per canale, con l'errore se è fallito.
-- Solo il server vi scrive e lo legge (service role): nessuna policy per gli utenti.
create table if not exists public.invii_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  tenant_id uuid not null,
  job text not null,
  ref text,
  channel text not null,
  ok boolean not null,
  detail text
);
create index if not exists invii_log_tenant_at on public.invii_log (tenant_id, at desc);
alter table public.invii_log enable row level security;

-- id del messaggio WhatsApp: serve a collegare l'esito di consegna che Meta manda dopo ("non consegnato", motivo)
alter table public.invii_log add column if not exists wamid text;
create index if not exists invii_log_wamid on public.invii_log (wamid) where wamid is not null;
