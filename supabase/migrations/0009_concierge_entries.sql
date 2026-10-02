-- Base di conoscenza del Concierge: voci condivise (area) e per struttura, bilingui, con voci AUTO
-- che si compilano dalla prenotazione (codice accesso, tassa di soggiorno, orari). Già applicata in produzione.
create table if not exists public.concierge_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth.uid(),
  level text not null check (level in ('shared','property')),
  property_id text null,
  category text not null check (category in ('accesso','arrivo','checkin','regole','servizi','wifi','colazione','pagamenti','contatti','mare','cibo','cultura','dintorni','escursioni','recensioni')),
  field_type text not null default 'editorial' check (field_type in ('editorial','auto')),
  auto_source text null check (auto_source is null or auto_source in ('access_code','city_tax','checkin_time','checkout_time')),
  title text not null,
  body text not null default '',
  lang text not null default 'it' check (lang in ('it','en')),
  sort_order integer not null default 0,
  phone text null,
  address text null,
  map_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concierge_entries_level_property check ((level = 'shared' and property_id is null) or (level = 'property' and property_id is not null)),
  constraint concierge_entries_auto_source check ((field_type = 'auto' and auto_source is not null) or (field_type = 'editorial' and auto_source is null))
);
create index if not exists concierge_entries_lookup on public.concierge_entries (tenant_id, level, property_id, category, lang, sort_order);
alter table public.concierge_entries enable row level security;
drop policy if exists concierge_entries_own on public.concierge_entries;
create policy concierge_entries_own on public.concierge_entries for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
