-- PROVE della migrazione 0017b (eseguite il 22/10/2026 notte, dentro UNA transazione chiusa con ROLLBACK).
-- Come si usa: begin;  <0017 (senza i due CREATE TRIGGER su entities)>  <0017b (senza i due CREATE TRIGGER su app_state/org_state)>  <questo file>  rollback;
-- Per non bloccare le scritture vere (CREATE TRIGGER su una tabella viva prende un lock) i trigger vengono creati su TABELLE TEMPORANEE
-- (app_state_t / org_state_t) con le funzioni VERE; gli owner sono INVENTATI (uuid f0f0f0f0-...). Le parti "su dati veri" sono SOLO LETTURE
-- (confronto del risultato delle funzioni prima/dopo la modifica). L'ultimo select restituisce l'esito di ogni prova.

create temp table res (n serial, t text, ok boolean, detail text) on commit drop;

-- ------------------------------------------------------------------ R0: fotografia PRIMA delle funzioni nuove (sui dati veri, sola lettura)
-- (questo blocco va eseguito PRIMA del testo di 0017b: nel comando completo e' la prima cosa dopo 0017)
-- create temp table v_before  on commit drop as select * from public.entities_verify();
-- create temp table vx_before on commit drop as select * from public.entities_verify_extra();

-- ------------------------------------------------------------------ R1: dopo 0017b, senza righe 'table' tutto e' IDENTICO a prima
do $r1$
declare d1 int; d2 int; d3 int; d4 int; n_bad int;
begin
  select count(*) into d1 from (select * from v_before except select * from public.entities_verify()) x;
  select count(*) into d2 from (select * from public.entities_verify() except select * from v_before) x;
  select count(*) into d3 from (select * from vx_before except select * from public.entities_verify_extra()) x;
  select count(*) into d4 from (select * from public.entities_verify_extra() except select * from vx_before) x;
  insert into res (t, ok, detail) values ('R1a entities_verify identica a prima (nessuna autorita impostata)', d1 = 0 and d2 = 0, 'righe diverse ' || d1 || '/' || d2 || ' su ' || (select count(*) from v_before));
  insert into res (t, ok, detail) values ('R1b entities_verify_extra identica a prima', d3 = 0 and d4 = 0, 'righe diverse ' || d3 || '/' || d4 || ' su ' || (select count(*) from vx_before));
  select count(*) into n_bad from (select 'u' ot, user_id oid, data from public.app_state union all select 'o', org_id, data from public.org_state) s
   where public.app_state_realcount_owner(s.ot, s.oid, s.data) is distinct from public.app_state_realcount(s.data);
  insert into res (t, ok, detail) values ('R1c app_state_realcount_owner == app_state_realcount su tutti i proprietari veri', n_bad = 0,
    'diversi ' || n_bad || ' su ' || ((select count(*) from public.app_state) + (select count(*) from public.org_state)));
end
$r1$;

-- ------------------------------------------------------------------ R2: verify salta i tipi 'table' (su un proprietario VERO, solo dentro la transazione)
do $r2$
declare o uuid; k_rows_before int; k_rows_after int; x_before int; x_after int;
begin
  select user_id into o from public.app_state where user_id::text like '8178d3c2%';
  select count(*) into k_rows_before from public.entities_verify() v where v.owner_id = o and v.kind = 'guests';
  select count(*) into x_before from public.entities_verify_extra() v where v.owner_id = o and v.kind = 'rates';
  insert into public.entity_authority (owner_type, owner_id, kind, authority) values ('u', o, 'guests', 'table'), ('u', o, 'rates', 'table');
  select count(*) into k_rows_after from public.entities_verify() v where v.owner_id = o and v.kind = 'guests';
  select count(*) into x_after from public.entities_verify_extra() v where v.owner_id = o and v.kind = 'rates';
  insert into res (t, ok, detail) values ('R2a entities_verify: con guests=table la riga guests sparisce (altri tipi invariati)',
    k_rows_before = 1 and k_rows_after = 0 and (select count(*) from public.entities_verify() v where v.owner_id = o and v.kind = 'bookings') = 1, k_rows_before || '->' || k_rows_after);
  insert into res (t, ok, detail) values ('R2b entities_verify_extra: con rates=table la riga rates sparisce', x_before = 1 and x_after = 0, x_before || '->' || x_after);
  -- il conteggio "dati reali" cresce delle righe di entities dei tipi 'table' (guests)
  insert into res (t, ok, detail) values ('R2c app_state_realcount_owner conta anche le righe-tabella degli ospiti',
    public.app_state_realcount_owner('u', o, (select data from public.app_state where user_id = o)) =
    public.app_state_realcount((select data from public.app_state where user_id = o)) + (select count(*) from public.entities where owner_id = o and kind = 'guests')::int, null);
  delete from public.entity_authority where owner_id = o;
end
$r2$;

-- ------------------------------------------------------------------ tabelle finte con i VERI trigger (stesso nome e stesso ordine di quelli di produzione)
create temp table app_state_t (like public.app_state including defaults);
create trigger a_xn_authority_guard before update on app_state_t for each row execute function public.xn_authority_guard_app();
create trigger trg_snapshot_app_state before update on app_state_t for each row execute function public.snapshot_app_state();
create trigger entities_sync_app after insert or update of data on app_state_t for each row execute function public.entities_trg_app();

-- ------------------------------------------------------------------ S: scenari su un proprietario finto X
do $s$
declare
  x uuid := 'f0f0f0f0-0000-4000-8000-0000000000a1';
  y uuid := 'f0f0f0f0-0000-4000-8000-0000000000a2';
  v1 jsonb; v1b jsonb; exp jsonb; n int; h0 int; h1 int; r0 bigint; r1 bigint; bad int; wipe_kept boolean;
  put text := 'spigolestay:data:v1';
begin
  v1 := jsonb_build_object(
    'structures', jsonb_build_array(jsonb_build_object('id', 's1', 'name', 'Casa', 'order', 1)),
    'roomTypes',  jsonb_build_array(jsonb_build_object('id', 'rt1', 'structureId', 's1')),
    'units',      jsonb_build_array(jsonb_build_object('id', 'u1', 'structureId', 's1', 'roomTypeId', 'rt1')),
    'bookings',   (select jsonb_agg(jsonb_build_object('id', 'b' || g, 'structureId', 's1', 'unitId', 'u1', 'guestId', 'g' || g, 'checkIn', '2026-11-0' || g, 'checkOut', '2026-11-0' || (g + 1), 'status', 'confirmed')) from generate_series(1, 3) g),
    'guests',     (select jsonb_agg(jsonb_build_object('id', 'g' || g, 'name', 'Ospite ' || g)) from generate_series(1, 5) g),
    'rateOverrides', jsonb_build_object('rt1|2026-11-01', 100, 'rt1|2026-11-02', 110),
    'activities', '[]'::jsonb, '_deleted', jsonb_build_object('guests', jsonb_build_array('old1')), '_deletedLeads', '[]'::jsonb);

  insert into app_state_t (user_id, data) values (x, jsonb_build_object(put, v1::text, 'spigolestay:threads:v1', '[]'));
  select count(*) into n from public.entities where owner_id = x;
  insert into res (t, ok, detail) values ('S0 inserimento: il mirror popola entities (1+1+1+3+5 + 2 rates + 1 tomb = 14)', n = 14, n::text);

  -- S1: nessuna autorita: tutto come oggi (rev sale, storico salvato)
  update app_state_t set data = jsonb_set(data, '{spigolestay:threads:v1}', '"[1]"') where user_id = x;
  select count(*) into h0 from public.app_state_history where user_id = x;
  insert into res (t, ok, detail) values ('S1 senza autorita: scrittura chiave piatta ok, rev=1, storico salvato',
    (select rev from app_state_t where user_id = x) = 1 and h0 = 1, 'rev ' || (select rev from app_state_t where user_id = x) || ', storico ' || h0);

  -- S2: bookings passa a 'table' (ricetta: export==blocco, authority, svuota il campo nel blocco)
  select count(*) filter (where missing > 0 or extra > 0 or different > 0) into bad from public.entities_export_check('u', x, (select (data ->> put)::jsonb from app_state_t where user_id = x)) where field = 'bookings';
  insert into res (t, ok, detail) values ('S2a prima di passare a table: export == blocco per bookings', bad = 0, null);
  insert into public.entity_authority (owner_type, owner_id, kind, authority) values ('u', x, 'bookings', 'table');
  update app_state_t set data = jsonb_set(data, array[put], to_jsonb((((data ->> put)::jsonb) || '{"bookings":[]}'::jsonb)::text)) where user_id = x;
  select count(*) into n from public.entities where owner_id = x and kind = 'bookings';
  insert into res (t, ok, detail) values ('S2b blocco svuotato di bookings, ma entities le conserva (3): il mirror le salta', n = 3, n::text);

  -- S3: un vecchio client rimette 4 prenotazioni nel blocco: RIFIUTATO, tutto invariato
  v1b := ((select (data ->> put)::jsonb from app_state_t where user_id = x)) || jsonb_build_object('bookings', jsonb_build_array(jsonb_build_object('id', 'zz1', 'checkIn', '2026-12-01')));
  r0 := (select rev from app_state_t where user_id = x);
  begin
    update app_state_t set data = jsonb_set(data, array[put], to_jsonb(v1b::text)) where user_id = x;
    insert into res (t, ok, detail) values ('S3 vecchio client con prenotazioni nel blocco: rifiutato (XN002)', false, 'nessun errore');
  exception when sqlstate 'XN002' then
    insert into res (t, ok, detail) values ('S3 vecchio client con prenotazioni nel blocco: rifiutato (XN002)',
      (select rev from app_state_t where user_id = x) = r0 and (select count(*) from public.entities where owner_id = x and kind = 'bookings') = 3, left(sqlerrm, 80));
  end;

  -- S4: lo stesso client senza prenotazioni (campo vuoto) ma con un ospite in piu': passa; entities: ospiti +1, prenotazioni invariate
  v1b := ((select (data ->> put)::jsonb from app_state_t where user_id = x)) || jsonb_build_object('guests', (select (data ->> put)::jsonb -> 'guests' from app_state_t where user_id = x) || jsonb_build_array(jsonb_build_object('id', 'g6', 'name', 'Nuovo')));
  update app_state_t set data = jsonb_set(data, array[put], to_jsonb(v1b::text)) where user_id = x;
  insert into res (t, ok, detail) values ('S4 scrittura senza il tipo table: passa, ospiti 6, prenotazioni ancora 3',
    (select count(*) from public.entities where owner_id = x and kind = 'guests') = 6 and (select count(*) from public.entities where owner_id = x and kind = 'bookings') = 3, null);

  -- S5: anche structures e guests a 'table' (blocco svuotato): una scrittura di sole chiavi piatte passa e lo storico continua
  insert into public.entity_authority (owner_type, owner_id, kind, authority) values ('u', x, 'structures', 'table'), ('u', x, 'guests', 'table');
  update app_state_t set data = jsonb_set(data, array[put], to_jsonb((((data ->> put)::jsonb) || '{"structures":[],"guests":[]}'::jsonb)::text)) where user_id = x;
  select count(*) into h0 from public.app_state_history where user_id = x;
  r0 := (select rev from app_state_t where user_id = x);
  update app_state_t set data = jsonb_set(data, '{spigolestay:threads:v1}', '"[1,2]"') where user_id = x;
  select count(*) into h1 from public.app_state_history where user_id = x;
  r1 := (select rev from app_state_t where user_id = x);
  insert into res (t, ok, detail) values ('S5a blocco senza entita ma righe-tabella: chiave piatta passa (rev +1) e lo storico continua (+1)',
    r1 = r0 + 1 and h1 = h0 + 1, 'rev ' || r0 || '->' || r1 || ', storico ' || h0 || '->' || h1);
  insert into res (t, ok, detail) values ('S5b ... mentre il conteggio vecchio (solo blocco) sarebbe 0',
    public.app_state_realcount((select data from app_state_t where user_id = x)) = 0 and public.app_state_realcount_owner('u', x, (select data from app_state_t where user_id = x)) = 1 + 6 + 3, 'nuovo ' || public.app_state_realcount_owner('u', x, (select data from app_state_t where user_id = x)));

  -- S6: anti-svuotamento: proprietario senza autorita (Y): svuotare dati reali e' ancora scartato
  insert into app_state_t (user_id, data) values (y, jsonb_build_object(put, (jsonb_build_object('guests', jsonb_build_array(jsonb_build_object('id', 'a', 'name', 'A')), 'bookings', '[]'::jsonb, 'structures', '[]'::jsonb))::text));
  update app_state_t set data = jsonb_build_object(put, '{"guests":[],"bookings":[],"structures":[]}'::text) where user_id = y;
  select (data -> put) <> to_jsonb('{"guests":[],"bookings":[],"structures":[]}'::text) into wipe_kept from app_state_t where user_id = y;
  insert into res (t, ok, detail) values ('S6 anti-svuotamento ancora attivo per chi non ha autorita (update scartato)', wipe_kept and (select rev from app_state_t where user_id = y) = 0, null);

  -- S7: prima di svuotare la tabella del proprietario X... : se le entita in tabella sparissero e il blocco e' vuoto, l'anti-svuotamento riscatta (old_c>0, new_c=0)?
  --     (qui NON succede: new_c conta le righe-tabella, che restano) -> verificato in S5a.

  -- S8: rollback per tipo (table -> blocco) per bookings: ricetta del piano
  perform set_config('xenora.authority_maintenance', 'on', true);
  exp := public.entities_export_to_blob('u', x);
  delete from public.entity_authority where owner_type = 'u' and owner_id = x and kind = 'bookings';
  update app_state_t set data = jsonb_set(data, array[put], to_jsonb((((data ->> put)::jsonb) || jsonb_build_object('bookings', exp -> 'bookings'))::text)) where user_id = x;
  perform set_config('xenora.authority_maintenance', 'off', true);
  select count(*) filter (where missing > 0 or extra > 0 or different > 0) into bad
    from public.entities_export_check('u', x, (select (data ->> put)::jsonb from app_state_t where user_id = x)) where field = 'bookings';
  insert into res (t, ok, detail) values ('S8a rollback bookings table->blocco: il blocco ha di nuovo le 3 prenotazioni, export==blocco',
    bad = 0 and jsonb_array_length((select (data ->> put)::jsonb -> 'bookings' from app_state_t where user_id = x)) = 3 and (select count(*) from public.entities where owner_id = x and kind = 'bookings') = 3,
    'bad ' || bad);
  insert into res (t, ok, detail) values ('S8b ... e ora il blocco con prenotazioni non e'' piu'' rifiutato', public.entity_authority_of('u', x, 'bookings') = 'blob', null);

  -- S9: mirror salta anche gli extra: rates a 'table', il blocco cambia i prezzi (col flag di manutenzione per superare il blocco): entities.rates invariata
  insert into public.entity_authority (owner_type, owner_id, kind, authority) values ('u', x, 'rates', 'table');
  perform set_config('xenora.authority_maintenance', 'on', true);
  update app_state_t set data = jsonb_set(data, array[put], to_jsonb((((data ->> put)::jsonb) || '{"rateOverrides":{"rt1|2026-11-01":999}}'::jsonb)::text)) where user_id = x;
  perform set_config('xenora.authority_maintenance', 'off', true);
  insert into res (t, ok, detail) values ('S9 rates=table: il mirror non tocca le righe rates (restano 2 con i valori vecchi)',
    (select count(*) from public.entities where owner_id = x and kind = 'rates') = 2 and (select data from public.entities where owner_id = x and kind = 'rates' and id = 'rt1|2026-11-01') = '100'::jsonb, null);
  -- ... e un client che rimanda prezzi non vuoti senza il flag e' rifiutato
  begin
    update app_state_t set data = jsonb_set(data, array[put], to_jsonb((((data ->> put)::jsonb) || '{"rateOverrides":{"rt1|2026-11-01":777}}'::jsonb)::text)) where user_id = x;
    insert into res (t, ok, detail) values ('S9b vecchio client con prezzi nel blocco (rates=table): rifiutato', false, 'nessun errore');
  exception when sqlstate 'XN002' then
    insert into res (t, ok, detail) values ('S9b vecchio client con prezzi nel blocco (rates=table): rifiutato', true, null);
  end;
end
$s$;

-- ------------------------------------------------------------------ T: il trigger non e' un costo per chi non ha autorita
do $t$
declare t0 timestamptz; ms numeric; i int;
begin
  t0 := clock_timestamp();
  for i in 1..2000 loop perform public._xn_authority_blob_check('u', 'f0f0f0f0-0000-4000-8000-0000000000ff', '{}'::jsonb, '{}'::jsonb); end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  insert into res (t, ok, detail) values ('T1 costo del controllo per un proprietario senza autorita (2000 chiamate)', ms < 2000, round(ms)::text || ' ms totali, ' || round(ms / 2000, 3)::text || ' ms a chiamata');
end
$t$;

select n, t, ok, detail from res order by n;
