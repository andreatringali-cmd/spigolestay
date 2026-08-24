-- SpigoleStay — Pulizie (Passo 8). L'addetta (role=cleaner) vede solo questo + le unità.

create table housekeeping_tasks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  unit_id     uuid not null references units(id) on delete cascade,
  due_date    date not null default current_date,
  type        housekeeping_type not null default 'checkout_clean',
  status      task_status not null default 'pending',
  assigned_to uuid references profiles(id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now()
);
create index on housekeeping_tasks (tenant_id);
create index on housekeeping_tasks (unit_id, due_date);

alter table housekeeping_tasks enable row level security;

-- Owner: controllo completo. Cleaner: legge e aggiorna lo stato dei task del proprio tenant.
create policy owner_all on housekeeping_tasks for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
create policy cleaner_read on housekeeping_tasks for select
  using (tenant_id = public.current_tenant_id());
create policy cleaner_update on housekeeping_tasks for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
