-- SpigoleStay — Tariffe e restrizioni (Passo 5, schema pronto da subito).

create table rate_plans (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  property_id  uuid not null references properties(id) on delete cascade,
  room_type_id uuid not null references room_types(id) on delete cascade,
  name         text not null,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index on rate_plans (tenant_id);

-- Striscia prezzi + restrizioni: una riga per (piano tariffario, data).
create table rate_calendar (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  rate_plan_id        uuid not null references rate_plans(id) on delete cascade,
  room_type_id        uuid not null references room_types(id) on delete cascade,
  date                date not null,
  price               numeric(10,2),
  min_stay            int not null default 1,
  max_stay            int,
  closed_to_arrival   boolean not null default false,
  closed_to_departure boolean not null default false,
  stop_sell           boolean not null default false,
  unique (rate_plan_id, date)
);
create index on rate_calendar (tenant_id);
create index on rate_calendar (room_type_id, date);

alter table rate_plans    enable row level security;
alter table rate_calendar enable row level security;
create policy owner_all on rate_plans for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
create policy owner_all on rate_calendar for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
