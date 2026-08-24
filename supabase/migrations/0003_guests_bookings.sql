-- SpigoleStay — Ospiti e prenotazioni. Decisione 6: la verità è il DB.

create table guests (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  full_name  text not null,
  email      text,
  phone      text,
  country    text,
  language   text,
  created_at timestamptz not null default now()
);
create index on guests (tenant_id);

create table bookings (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  property_id              uuid not null references properties(id) on delete restrict,
  room_type_id             uuid not null references room_types(id) on delete restrict,
  unit_id                  uuid references units(id) on delete set null,  -- assegnata fino al check-in
  guest_id                 uuid references guests(id) on delete set null,
  channel                  booking_channel not null default 'direct',
  channel_reservation_code text,
  status                   booking_status  not null default 'confirmed',
  check_in                 date not null,
  check_out                date not null,
  adults                   int not null default 2,
  children                 int not null default 0,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  cancelled_at             timestamptz,
  constraint dates_valid check (check_out > check_in)
);
create index on bookings (tenant_id);
create index on bookings (room_type_id, check_in, check_out);
create index on bookings (unit_id);

-- Integrità (Decisione 1 + 6): la stessa unità non può ospitare due prenotazioni sovrapposte.
-- Intervallo semiaperto [check_in, check_out): il giorno di partenza libera l'unità.
alter table bookings add constraint bookings_no_unit_overlap
  exclude using gist (
    unit_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (unit_id is not null and status in ('tentative', 'confirmed'));

-- Occupanti aggiuntivi (per Alloggiati Web, Passo 7). Vuota fino ad allora.
create table booking_guests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  booking_id      uuid not null references bookings(id) on delete cascade,
  full_name       text not null,
  birth_date      date,
  citizenship     text,
  document_type   text,
  document_number text,
  is_lead         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index on booking_guests (booking_id);

-- Ospiti e prenotazioni contengono dati personali/economici: solo owner.
alter table guests         enable row level security;
alter table bookings       enable row level security;
alter table booking_guests enable row level security;

create policy owner_all on guests for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
create policy owner_all on bookings for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
create policy owner_all on booking_guests for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
