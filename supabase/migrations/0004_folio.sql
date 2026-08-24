-- SpigoleStay — Folio: registro contabile. Decisioni 2, 3, 4, 5.
-- La semantica di ogni tipo di riga sta nei DATI (folio_line_types), non nel codice.

create table folio_line_types (
  code                  text primary key,
  label                 text not null,
  affects_guest_balance boolean not null default false, -- entra nel saldo dell'ospite
  is_revenue            boolean not null default false,  -- conta come ricavo (ADR/RevPAR)
  is_cost               boolean not null default false,  -- conta come costo (netto)
  is_tax_passthrough    boolean not null default false,  -- partita di giro (tassa soggiorno)
  is_withholding        boolean not null default false   -- acconto ritenuta (Airbnb 21%)
);

-- Dati di riferimento del sistema (struttura, non dati "finti").
insert into folio_line_types (code, label, affects_guest_balance, is_revenue, is_cost, is_tax_passthrough, is_withholding) values
  ('accommodation',      'Soggiorno',                 true,  true,  false, false, false),
  ('cleaning',           'Pulizia (addebito ospite)', true,  true,  false, false, false),
  ('extra',              'Extra',                     true,  true,  false, false, false),
  ('city_tax',           'Tassa di soggiorno',        true,  false, false, true,  false),
  ('channel_commission', 'Commissione canale',        false, false, true,  false, false),
  ('cleaning_cost',      'Costo pulizia',             false, false, true,  false, false),
  ('payment',            'Pagamento',                 true,  false, false, false, false),
  ('refund',             'Rimborso',                  true,  false, false, false, false),
  ('airbnb_withholding', 'Ritenuta Airbnb (acconto)', false, false, false, false, true);

create table folio_lines (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  booking_id  uuid not null references bookings(id) on delete cascade,
  type        text not null references folio_line_types(code),
  description text,
  -- Convenzione segni: addebiti positivi (l'ospite deve), pagamenti negativi, rimborsi positivi.
  -- Commissioni/costi/ritenuta: importo col proprio segno, fuori dal saldo ospite.
  quantity    numeric(12,3) not null default 1,
  unit_amount numeric(12,2) not null default 0,
  amount      numeric(12,2) generated always as (round(quantity * unit_amount, 2)) stored,
  currency    char(3) not null default 'EUR',
  occurred_on date not null default current_date,
  reversal_of uuid references folio_lines(id),  -- storno: correzione = nuova riga, mai UPDATE
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index on folio_lines (tenant_id);
create index on folio_lines (booking_id);

-- Immutabilità (Decisione 2): niente UPDATE/DELETE, solo righe di storno.
create or replace function public.folio_lines_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Le righe di folio sono immutabili: registra una riga di storno (reversal_of).';
end $$;
create trigger folio_lines_no_update before update on folio_lines
  for each row execute function public.folio_lines_immutable();
create trigger folio_lines_no_delete before delete on folio_lines
  for each row execute function public.folio_lines_immutable();

-- Regole tassa di soggiorno (Decisione 3): configurabili, non hardcodate.
-- Comune di Siracusa: max 3 notti consecutive per persona, minori esenti.
create table city_tax_rules (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id) on delete cascade,
  property_id             uuid references properties(id) on delete cascade, -- null = tutte le strutture
  amount_per_person_night numeric(6,2) not null,
  max_consecutive_nights  int not null default 3,
  children_exempt         boolean not null default true,
  active_from             date not null default current_date,
  active_to               date,
  created_at              timestamptz not null default now()
);
create index on city_tax_rules (tenant_id);

alter table folio_line_types enable row level security;
alter table folio_lines      enable row level security;
alter table city_tax_rules   enable row level security;

-- folio_line_types: riferimento globale, sola lettura per utenti autenticati.
create policy read_all on folio_line_types for select to authenticated using (true);

-- Folio e regole tasse: solo owner.
create policy owner_all on folio_lines for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
create policy owner_all on city_tax_rules for all
  using (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() = 'owner');
