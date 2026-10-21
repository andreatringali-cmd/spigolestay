-- PROVE della migrazione 0017 (eseguite il 21/10/2026 notte, dentro UNA transazione chiusa con ROLLBACK, owner finti).
-- Come si usa: begin;  <contenuto di 0017_entity_authority.sql senza la riga "set local ..." iniziale>  <questo file>  rollback;
-- Tutto cio' che segue lavora su proprietari INVENTATI (uuid f0f0f0f0-...) e su tabelle temporanee: nessun dato vero viene scritto.
-- L'ultimo select restituisce l'esito di ogni prova (ok = true/false).

set local lock_timeout = '3s';
create temp table res (n serial, t text, ok boolean, detail text) on commit drop;

-- ------------------------------------------------------------------ P1: andata e ritorno blocco -> entities -> export
do $p1$
declare
  o  uuid := 'f0f0f0f0-0000-4000-8000-0000000000a1';
  b1 jsonb; b2 jsonb; bad int; ex jsonb;
begin
  b1 := $j$ {
    "structures":[{"id":"s2","name":"B","order":2,"updatedAt":1700000000100},{"id":"s1","name":"A","order":1,"updatedAt":1700000000200}],
    "roomTypes":[{"id":"rt1","structureId":"s1","name":"Doppia"},{"id":"rt2","structureId":"s2","name":"Tripla"}],
    "units":[{"id":"u1","structureId":"s1","roomTypeId":"rt1"},{"id":"u2","structureId":"s1","roomTypeId":"rt1"},{"id":"u3","structureId":"s2","roomTypeId":"rt2"}],
    "bookings":[
      {"id":"b1","structureId":"s1","unitId":"u1","guestId":"g1","checkIn":"2026-11-01","checkOut":"2026-11-03","status":"confirmed","channel":"Booking","code":"123456","updatedAt":1700000001000},
      {"id":"b2","structureId":"s1","unitId":"u2","guestId":"g2","checkIn":"2026-11-05","checkOut":"2026-11-06","status":"cancelled","channel":"Direct","code":"XEN-2026-1","groupId":"grp1","updatedAt":"1700000002000.5"},
      {"id":"b3","structureId":"s2","unitId":"u3","guestId":"g3","checkIn":"non-una-data","checkOut":"2026-12-06","status":"confirmed","extId":"channex:abc"}],
    "guests":[{"id":"g1","name":"Mario Rossi","email":"a@b.it"},{"id":"g2","name":"Anna","updatedAt":5},{"id":"g3","name":"è ñ ù \"virgolette\" \\ barra"}],
    "directReviews":[{"id":"r1","structureId":"s1","rating":5}],
    "events":[{"id":"e1","structureId":"s1","title":"Manutenzione"}],
    "rateOverrides":{"rt1|2026-11-01":120,"rt2|2026-11-02":99.5,"2026-12-25":200},
    "activities":[{"id":"a1","ts":1700000000300,"structureId":"s1","text":"x"},{"id":"a2","ts":1700000000500},{"id":"a3","ts":1700000000100}],
    "_deleted":{"bookings":["old1","old2"],"guests":["oldg"]},
    "_deletedLeads":["email:x@y.it","tel:3331234567"]
  } $j$::jsonb;

  perform public.entities_sync_row(o, 'u', b1, null);              -- la VERA funzione di mirroring (INSERT di app_state)
  select count(*) filter (where missing > 0 or extra > 0 or different > 0) into bad from public.entities_export_check('u', o, b1);
  insert into res (t, ok, detail) values ('P1a insert: export == blocco (11 campi)', bad = 0,
    (select string_agg(field || ':' || blob_n || '/' || export_n || '/m' || missing || '/x' || extra || '/d' || different, ' ') from public.entities_export_check('u', o, b1)));

  ex := public.entities_export_to_blob('u', o);
  insert into res (t, ok, detail) values ('P1b ordine: struttura order=1 per prima',
    ex #>> '{structures,0,id}' = 's1', ex #>> '{structures,0,id}');
  insert into res (t, ok, detail) values ('P1c activities: la piu recente (ts) per prima',
    ex #>> '{activities,0,id}' = 'a2', ex #>> '{activities,0,id}');
  insert into res (t, ok, detail) values ('P1d _deleted e _deletedLeads ricostruiti',
    ex -> '_deleted' = '{"bookings":["old1","old2"],"guests":["oldg"]}'::jsonb and ex -> '_deletedLeads' = '["email:x@y.it","tel:3331234567"]'::jsonb,
    (ex -> '_deleted')::text || ' ' || (ex -> '_deletedLeads')::text);
  insert into res (t, ok, detail) values ('P1e rateOverrides ricostruiti', ex -> 'rateOverrides' = b1 -> 'rateOverrides', (ex -> 'rateOverrides')::text);
  insert into res (t, ok, detail) values ('P1f guest con caratteri speciali identico',
    (select e.value from jsonb_array_elements(ex -> 'guests') e where e.value ->> 'id' = 'g3') = (select e.value from jsonb_array_elements(b1 -> 'guests') e where e.value ->> 'id' = 'g3'), null);
  insert into res (t, ok, detail) values ('P1g colonne prenotazione derivate (trigger 0015)',
    (select unit_id = 'u1' and ota_code = '123456' from public.entities where owner_id = o and kind = 'bookings' and id = 'b1')
    and (select ext_id = 'channex:abc' and check_in is null from public.entities where owner_id = o and kind = 'bookings' and id = 'b3'), null);

  -- aggiornamento incrementale: togli b3 e g3, un prezzo, un'attivita'; aggiungi una lapide e un contatto cancellato
  b2 := jsonb_set(b1, '{bookings}', (select jsonb_agg(e.value) from jsonb_array_elements(b1 -> 'bookings') e where e.value ->> 'id' <> 'b3'));
  b2 := jsonb_set(b2, '{guests}', (select jsonb_agg(e.value) from jsonb_array_elements(b2 -> 'guests') e where e.value ->> 'id' <> 'g3'));
  b2 := jsonb_set(b2, '{rateOverrides}', (b2 -> 'rateOverrides') - '2026-12-25');
  b2 := jsonb_set(b2, '{activities}', (select jsonb_agg(e.value) from jsonb_array_elements(b2 -> 'activities') e where e.value ->> 'id' <> 'a3'));
  b2 := jsonb_set(b2, '{_deleted,bookings}', '["old1","old2","b3"]'::jsonb);
  b2 := jsonb_set(b2, '{_deletedLeads}', '["email:x@y.it","tel:3331234567","email:z@y.it"]'::jsonb);
  perform public.entities_sync_row(o, 'u', b2, b1);                -- UPDATE di app_state
  select count(*) filter (where missing > 0 or extra > 0 or different > 0) into bad from public.entities_export_check('u', o, b2);
  insert into res (t, ok, detail) values ('P1h update: export == nuovo blocco', bad = 0,
    (select string_agg(field || ':' || blob_n || '/' || export_n || '/m' || missing || '/x' || extra || '/d' || different, ' ') from public.entities_export_check('u', o, b2) where missing > 0 or extra > 0 or different > 0));
  select count(*) filter (where missing > 0 or extra > 0 or different > 0) into bad from public.entities_export_check('u', o, b1);
  insert into res (t, ok, detail) values ('P1i controllo non e'' cieco: export != vecchio blocco', bad > 0, bad::text);
end
$p1$;

-- ------------------------------------------------------------------ P2: proprietario vuoto / non valido
do $p2$
declare ex jsonb; o uuid := 'f0f0f0f0-0000-4000-8000-0000000000b2';
begin
  ex := public.entities_export_to_blob('o', o);
  insert into res (t, ok, detail) values ('P2a export vuoto: 11 chiavi',
    (select count(*) from jsonb_object_keys(ex)) = 11 and ex -> 'structures' = '[]'::jsonb and ex -> 'rateOverrides' = '{}'::jsonb and ex -> '_deletedLeads' = '[]'::jsonb, (select string_agg(k, ',') from jsonb_object_keys(ex) k));
  begin
    perform public.entities_export_to_blob('x', o);
    insert into res (t, ok, detail) values ('P2b tipo proprietario non valido rifiutato', false, 'nessun errore');
  exception when others then
    insert into res (t, ok, detail) values ('P2b tipo proprietario non valido rifiutato', true, sqlerrm);
  end;
end
$p2$;

-- ------------------------------------------------------------------ P3: interruttore di autorita'
do $p3$
declare o uuid := 'f0f0f0f0-0000-4000-8000-0000000000c3';
begin
  insert into res (t, ok, detail) values ('P3a default = blob', public.entity_authority_of('u', o, 'bookings') = 'blob', null);
  insert into public.entity_authority (owner_type, owner_id, kind, authority) values ('u', o, 'bookings', 'table');
  insert into res (t, ok, detail) values ('P3b dopo l''inserimento = table (solo quel tipo)',
    public.entity_authority_of('u', o, 'bookings') = 'table' and public.entity_authority_of('u', o, 'guests') = 'blob', null);
  update public.entity_authority set authority = 'blob' where owner_id = o and kind = 'bookings';
  insert into res (t, ok, detail) values ('P3c registro cambi: 2 righe (insert + update)',
    (select count(*) from public.entity_authority_log where owner_id = o) = 2,
    (select string_agg(coalesce(old_authority, '-') || '>' || new_authority, ', ' order by id) from public.entity_authority_log where owner_id = o));
  begin
    insert into public.entity_authority (owner_type, owner_id, kind, authority) values ('u', o, 'kind_inventato', 'table');
    insert into res (t, ok, detail) values ('P3d kind non valido rifiutato', false, 'nessun errore');
  exception when check_violation then
    insert into res (t, ok, detail) values ('P3d kind non valido rifiutato', true, null);
  end;
  begin
    insert into public.entity_authority (owner_type, owner_id, kind, authority) values ('u', o, 'guests', 'forse');
    insert into res (t, ok, detail) values ('P3e authority non valida rifiutata', false, 'nessun errore');
  exception when check_violation then
    insert into res (t, ok, detail) values ('P3e authority non valida rifiutata', true, null);
  end;
end
$p3$;

-- ------------------------------------------------------------------ P4: guardia anti-cancellazione di massa (DELETE diretta)
do $p4$
declare
  o uuid := 'f0f0f0f0-0000-4000-8000-0000000000d4'; n int;
begin
  insert into public.entities (owner_type, owner_id, kind, id, data, updated_ms)
    select 'u', o, 'guests', 'gx' || g, '{}'::jsonb, 0 from generate_series(1, 60) g;
  insert into public.entities (owner_type, owner_id, kind, id, data, updated_ms)
    select 'u', o, 'bookings', 'bx' || g, '{}'::jsonb, 0 from generate_series(1, 60) g;
  insert into public.entities (owner_type, owner_id, kind, id, data, updated_ms)
    select 'u', o, 'tombs', 'bookings:t' || g, jsonb_build_object('coll', 'bookings', 'id', 't' || g), 0 from generate_series(1, 100) g;

  -- 1 solo ospite: lecito
  delete from public.entities where owner_id = o and kind = 'guests' and id = 'gx1';
  select count(*) into n from public.entities where owner_id = o and kind = 'guests';
  insert into res (t, ok, detail) values ('P4a cancellare 1 ospite: ok', n = 59, n::text);

  -- 25 ospiti (= soglia): lecito
  delete from public.entities where owner_id = o and kind = 'guests' and id in (select 'gx' || g from generate_series(2, 26) g);
  select count(*) into n from public.entities where owner_id = o and kind = 'guests';
  insert into res (t, ok, detail) values ('P4b cancellare 25 ospiti (soglia): ok', n = 34, n::text);

  -- 26 ospiti (> soglia): rifiutato e NIENTE viene tolto
  begin
    delete from public.entities where owner_id = o and kind = 'guests' and id in (select 'gx' || g from generate_series(27, 52) g);
    insert into res (t, ok, detail) values ('P4c cancellare 26 ospiti: rifiutato', false, 'nessun errore');
  exception when sqlstate 'XN001' then
    select count(*) into n from public.entities where owner_id = o and kind = 'guests';
    insert into res (t, ok, detail) values ('P4c cancellare 26 ospiti: rifiutato', n = 34, 'righe rimaste ' || n || ' / ' || left(sqlerrm, 90));
  end;

  -- prenotazioni: soglia 40
  delete from public.entities where owner_id = o and kind = 'bookings' and id in (select 'bx' || g from generate_series(1, 40) g);
  select count(*) into n from public.entities where owner_id = o and kind = 'bookings';
  insert into res (t, ok, detail) values ('P4d cancellare 40 prenotazioni (soglia): ok', n = 20, n::text);
  insert into public.entities (owner_type, owner_id, kind, id, data, updated_ms)
    select 'u', o, 'bookings', 'by' || g, '{}'::jsonb, 0 from generate_series(1, 45) g;
  begin
    delete from public.entities where owner_id = o and kind = 'bookings' and id like 'by%';
    insert into res (t, ok, detail) values ('P4e cancellare 45 prenotazioni: rifiutato', false, 'nessun errore');
  exception when sqlstate 'XN001' then
    insert into res (t, ok, detail) values ('P4e cancellare 45 prenotazioni: rifiutato', true, null);
  end;

  -- esenti: lapidi
  delete from public.entities where owner_id = o and kind = 'tombs';
  select count(*) into n from public.entities where owner_id = o and kind = 'tombs';
  insert into res (t, ok, detail) values ('P4f lapidi (100) cancellabili senza limiti', n = 0, n::text);

  -- flag di manutenzione: consente e registra
  perform set_config('xenora.allow_mass_delete', 'on', true);
  delete from public.entities where owner_id = o and kind = 'guests';
  perform set_config('xenora.allow_mass_delete', 'off', true);
  select count(*) into n from public.entities where owner_id = o and kind = 'guests';
  insert into res (t, ok, detail) values ('P4g con flag: 34 ospiti cancellati', n = 0, n::text);
  insert into res (t, ok, detail) values ('P4h il flag e'' registrato nel log',
    exists (select 1 from public.entities_guard_log where owner_id = o and kind = 'guests' and outcome = 'allowed_flag' and deleted_n = 34), null);

  -- dopo il flag torna a proteggere
  begin
    delete from public.entities where owner_id = o and kind = 'bookings';
    insert into res (t, ok, detail) values ('P4i flag spento: protezione di nuovo attiva', false, 'nessun errore');
  exception when sqlstate 'XN001' then
    insert into res (t, ok, detail) values ('P4i flag spento: protezione di nuovo attiva', true, null);
  end;
end
$p4$;

-- ------------------------------------------------------------------ P4j: TRUNCATE (su una tabella temporanea con lo STESSO trigger: la vera entities non si tocca)
create temp table ent_t (like public.entities including defaults);
create trigger ent_t_guard before truncate on ent_t for each statement execute function public.entities_guard_truncate();
insert into ent_t (owner_type, owner_id, kind, id, data, updated_ms) values ('u', 'f0f0f0f0-0000-4000-8000-0000000000e5', 'guests', 'x', '{}', 0);
do $p4j$
begin
  begin
    truncate ent_t;
    insert into res (t, ok, detail) values ('P4j TRUNCATE senza flag rifiutato', false, 'nessun errore');
  exception when sqlstate 'XN001' then
    insert into res (t, ok, detail) values ('P4j TRUNCATE senza flag rifiutato', (select count(*) from ent_t) = 1, null);
  end;
  perform set_config('xenora.allow_mass_delete', 'on', true);
  truncate ent_t;
  perform set_config('xenora.allow_mass_delete', 'off', true);
  insert into res (t, ok, detail) values ('P4k TRUNCATE col flag permesso', (select count(*) from ent_t) = 0, null);
end
$p4j$;

-- ------------------------------------------------------------------ P5: cancellazione da sync blocco->tabella (trigger annidato). app_state finta = tabella temporanea con il VERO trigger entities_trg_app
create temp table app_state_t (like public.app_state including defaults);
create trigger t_mirror after insert or update of data on app_state_t for each row execute function public.entities_trg_app();

do $p5$
declare
  o uuid := 'f0f0f0f0-0000-4000-8000-0000000000f6'; n int; v60 text; v5 text; v1 text; err int;
begin
  v60 := (jsonb_build_object('guests', (select jsonb_agg(jsonb_build_object('id', 'm' || g, 'name', 'n' || g)) from generate_series(1, 60) g)))::text;
  v5  := (jsonb_build_object('guests', (select jsonb_agg(jsonb_build_object('id', 'm' || g, 'name', 'n' || g)) from generate_series(1, 5) g)))::text;
  v1  := (jsonb_build_object('guests', '[]'::jsonb, 'bookings', '[]'::jsonb))::text;

  insert into app_state_t (user_id, data) values (o, jsonb_build_object('spigolestay:data:v1', v60));
  select count(*) into n from public.entities where owner_id = o and kind = 'guests';
  insert into res (t, ok, detail) values ('P5a sync INSERT: 60 ospiti in entities', n = 60, n::text);

  -- modalita' log (default): 60 -> 5 = 55 cancellazioni annidate: la sync passa, resta traccia
  update app_state_t set data = jsonb_build_object('spigolestay:data:v1', v5) where user_id = o;
  select count(*) into n from public.entities where owner_id = o and kind = 'guests';
  insert into res (t, ok, detail) values ('P5b modalita'' log: la sync passa (60 -> 5)', n = 5, n::text);
  insert into res (t, ok, detail) values ('P5c ... e il log ha la riga "logged" nested',
    exists (select 1 from public.entities_guard_log where owner_id = o and outcome = 'logged' and nested and deleted_n = 55), null);

  -- modalita' enforce: la sync annidata viene rifiutata, ma il trigger principale NON fallisce e entities resta com'era
  update public.entities_guard_config set value = 'enforce' where key = 'mirror_mode';
  update app_state_t set data = jsonb_build_object('spigolestay:data:v1', v60) where user_id = o;      -- risale a 60 (inserimenti, nessuna cancellazione)
  select count(*) into n from public.entities where owner_id = o and kind = 'guests';
  insert into res (t, ok, detail) values ('P5d enforce: risalita a 60 senza cancellazioni ok', n = 60, n::text);
  update app_state_t set data = jsonb_build_object('spigolestay:data:v1', v5) where user_id = o;       -- 55 cancellazioni annidate -> rifiutate
  select count(*) into n from public.entities where owner_id = o and kind = 'guests';
  select count(*) into err from public.entities_sync_errors where owner_id = o and detail like '%XN-GUARD%';
  insert into res (t, ok, detail) values ('P5e enforce: la sync annidata rifiuta (restano 60) e lo scrive in entities_sync_errors', n = 60 and err >= 1, 'righe ' || n || ', errori ' || err);
  insert into res (t, ok, detail) values ('P5f ... la scrittura del blocco (app_state finta) e'' comunque riuscita',
    (select (data ->> 'spigolestay:data:v1') = v5 from app_state_t where user_id = o), null);
  update public.entities_guard_config set value = 'log' where key = 'mirror_mode';

  -- una cancellazione piccola in modalita' enforce passa
  update public.entities_guard_config set value = 'enforce' where key = 'mirror_mode';
  update app_state_t set data = jsonb_build_object('spigolestay:data:v1', (jsonb_build_object('guests', (select jsonb_agg(jsonb_build_object('id', 'm' || g, 'name', 'n' || g)) from generate_series(1, 58) g)))::text) where user_id = o;
  select count(*) into n from public.entities where owner_id = o and kind = 'guests';
  insert into res (t, ok, detail) values ('P5g enforce: cancellare 2 ospiti (lecito, come "un'ospite") passa', n = 58, n::text);
  update public.entities_guard_config set value = 'log' where key = 'mirror_mode';
end
$p5$;

-- ------------------------------------------------------------------ P6: le funzioni esistenti non sono cambiate (stesso testo di oggi)
insert into res (t, ok, detail)
select 'P6 firme/proprieta'' invariate: entities_sync_row ancora involucro di _core',
       (select position('entities_sync_row_core' in prosrc) > 0 and position('entity_authority' in prosrc) = 0
          from pg_proc where proname = 'entities_sync_row' and pronamespace = 'public'::regnamespace), null;

select n, t, ok, detail from res order by n;
