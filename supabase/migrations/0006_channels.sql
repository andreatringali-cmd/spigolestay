-- SpigoleStay — Connettività Channex.io (Passo 6). I canali ricevono, non dettano (Decisione 6).

create table channel_connections (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  property_id         uuid not null references properties(id) on delete cascade,
  channex_property_id text,
  status              text not null default 'disconnected',
  created_at          timestamptz not null default now()
);
create index on channel_connections (tenant_id);

-- Mappa entità locali ↔ id Channex (tipologie, piani tariffari).
create table channel_mappings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  entity_type channel_entity not null,
  local_id    uuid not null,
  channex_id  text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, entity_type, local_id)
);
create index on channel_mappings (tenant_id);

-- Log di sync (webhook in ingresso + push in uscita), per debug e audit.
create table sync_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  direction  sync_direction not null,
  event_type text,
  payload    jsonb,
  status     text,
  error      text,
  created_at timestamptz not null default now()
);
create index on sync_events (tenant_id);
create index on sync_events (created_at);

alter table channel_connections enable row level security;
alter table channel_mappings    enable row level security;
alter table sync_events         enable row level security;
create policy owner_all on channel_connections for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
create policy owner_all on channel_mappings for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
create policy owner_all on sync_events for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
