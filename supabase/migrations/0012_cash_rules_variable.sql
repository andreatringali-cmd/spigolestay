-- Importo variabile: la regola ha una stima (usata per la previsione); alla scadenza si registra l'importo reale.
alter table public.cash_rules add column if not exists variable boolean not null default false;
