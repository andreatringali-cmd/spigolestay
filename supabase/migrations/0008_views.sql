-- SpigoleStay — Metriche derivate (Decisioni 3, 4, 5). Calcolate, mai salvate.
-- security_invoker: le viste rispettano la RLS di chi interroga.

-- Riepilogo economico per prenotazione.
create or replace view v_booking_folio with (security_invoker = true) as
select
  b.id        as booking_id,
  b.tenant_id,
  -- Saldo dovuto dall'ospite (addebiti − pagamenti).
  coalesce(sum(fl.amount) filter (where t.affects_guest_balance), 0)      as guest_balance,
  -- Ricavi (esclusa tassa di soggiorno, Decisione 3).
  coalesce(sum(fl.amount) filter (where t.is_revenue), 0)                 as revenue,
  coalesce(sum(fl.amount) filter (where fl.type = 'accommodation'), 0)    as room_revenue,
  coalesce(sum(fl.amount) filter (where t.is_cost), 0)                    as costs,
  coalesce(sum(fl.amount) filter (where t.is_tax_passthrough), 0)         as city_tax,
  coalesce(sum(fl.amount) filter (where t.is_withholding), 0)             as airbnb_withholding,
  -- Netto = ricavi − costi (commissioni + costo pulizia). Margine di contribuzione (Decisione 4).
  coalesce(sum(fl.amount) filter (where t.is_revenue), 0)
    - coalesce(sum(fl.amount) filter (where t.is_cost), 0)                as net_contribution
from bookings b
left join folio_lines fl      on fl.booking_id = b.id
left join folio_line_types t  on t.code = fl.type
group by b.id, b.tenant_id;

-- Metriche per prenotazione. ADR sul solo soggiorno; tassa e ritenuta escluse.
create or replace view v_booking_metrics with (security_invoker = true) as
select
  b.id        as booking_id,
  b.tenant_id,
  (b.check_out - b.check_in) as nights,
  vf.room_revenue,
  case when (b.check_out - b.check_in) > 0
       then round(vf.room_revenue / (b.check_out - b.check_in), 2) end as adr
from bookings b
join v_booking_folio vf on vf.booking_id = b.id;
