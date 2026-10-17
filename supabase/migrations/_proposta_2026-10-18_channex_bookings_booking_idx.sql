-- PROPOSTA (NON applicata): indice per le letture di channex_bookings per id prenotazione Channex,
-- più recente per prima. Le usano /api/channex/threads (for_booking), /api/channex/revisions e /api/booking-timeline.
-- Da applicare a mano dopo revisione; è sicuro da rieseguire (if not exists).
create index if not exists channex_bookings_booking_idx on public.channex_bookings (booking_id, imported_at desc);
