-- SpigoleStay — Inventario. Decisione 1: tipologie (si vendono) ≠ unità (si assegnano).

create table property_groups (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,             -- es. "Spigole Rooms", "Central Perk"
  created_at timestamptz not null default now()
);
create index on property_groups (tenant_id);

create table properties (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  group_id   uuid references property_groups(id) on delete set null,
  name       text not null,
  address    text,
  city       text default 'Siracusa',
  cin        text,                       -- Codice Identificativo Nazionale (adempimenti)
  timezone   text not null default 'Europe/Rome',
  created_at timestamptz not null default now()
);
create index on properties (tenant_id);

create table room_types (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  property_id    uuid not null references properties(id) on delete cascade,
  name           text not null,          -- es. "Camera matrimoniale", "Appartamento"
  base_occupancy int not null default 2,
  max_occupancy  int not null default 2,
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);
create index on room_types (tenant_id);
create index on room_types (property_id);

create table units (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  property_id  uuid not null references properties(id) on delete cascade,
  room_type_id uuid not null references room_types(id) on delete restrict,
  name         text not null,            -- es. "Allegra", "Ortigia", "Loft Marina"
  status       unit_status not null default 'clean',
  active       boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index on units (tenant_id);
create index on units (room_type_id);

-- RLS: lettura a tutto il tenant (serve anche all'addetta pulizie per nomi/strutture),
-- scrittura riservata all'owner.
alter table property_groups enable row level security;
alter table properties      enable row level security;
alter table room_types      enable row level security;
alter table units           enable row level security;

create policy read_tenant on property_groups for select using (tenant_id = public.current_tenant_id());
create policy owner_write on property_groups for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');

create policy read_tenant on properties for select using (tenant_id = public.current_tenant_id());
create policy owner_write on properties for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');

create policy read_tenant on room_types for select using (tenant_id = public.current_tenant_id());
create policy owner_write on room_types for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');

create policy read_tenant on units for select using (tenant_id = public.current_tenant_id());
create policy owner_write on units for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
