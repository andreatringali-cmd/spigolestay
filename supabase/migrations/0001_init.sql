-- SpigoleStay — Passo 1: fondamenta multi-tenant, helper RLS, enum condivisi.
-- File PRONTO DA APPLICARE (non ancora eseguito su Supabase).

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists btree_gist;  -- vincolo di esclusione unità/date

-- ─────────────────────────── Enum condivisi ───────────────────────────
create type app_role         as enum ('owner', 'cleaner');
create type booking_channel   as enum ('booking', 'airbnb', 'expedia', 'direct');
create type booking_status    as enum ('tentative', 'confirmed', 'cancelled', 'no_show');
create type unit_status       as enum ('clean', 'dirty', 'inspected');
create type housekeeping_type as enum ('checkout_clean', 'refresh');
create type task_status       as enum ('pending', 'in_progress', 'done');
create type sync_direction    as enum ('inbound', 'outbound');
create type channel_entity    as enum ('room_type', 'rate_plan');

-- ─────────────────────────── Tenancy ───────────────────────────
create table tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  full_name  text,
  role       app_role not null default 'owner',
  created_at timestamptz not null default now()
);
create index on profiles (tenant_id);

-- ───────── Helper RLS (SECURITY DEFINER per evitare ricorsione su profiles) ─────────
-- Legge il tenant dal claim JWT app_metadata.tenant_id (veloce), con fallback a profiles.
create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid,
    (select tenant_id from public.profiles where id = auth.uid())
  )
$$;

create or replace function public.current_app_role()
returns app_role
language sql stable security definer set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', '')::app_role,
    (select role from public.profiles where id = auth.uid()),
    'owner'::app_role
  )
$$;

-- ─────────────────────────── RLS ───────────────────────────
alter table tenants  enable row level security;
alter table profiles enable row level security;

-- Il proprio tenant è visibile; nessuna scrittura da client (gestita da service role).
create policy tenant_read on tenants
  for select using (id = public.current_tenant_id());

-- Ognuno vede il proprio profilo; l'owner vede i profili del suo tenant.
create policy profiles_self_read on profiles
  for select using (
    id = auth.uid()
    or (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  );
create policy profiles_owner_write on profiles
  for all using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
