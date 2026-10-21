-- 0015c_collaudo.sql  (Fase 3, passo 0: collaudo SOLO LETTURA dopo 0015 + popolamento + 0015b)
--
-- NON e' una migrazione: non va registrata ne' applicata con `db push`. Si eseguono le query una per volta
-- (execute_sql / editor SQL). Nessuna scrive nulla.
-- Le query 2 e 3 contano le chiavi del blocco con SQL indipendente da entities_extra_rows, cosi' il confronto non
-- verifica la funzione con se stessa.

-- 1. Colonne e indici presenti e validi (atteso: 5 colonne, 5 indici con valido = true)
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'entities' and column_name in ('unit_id', 'guest_id', 'group_id', 'ota_code', 'ext_id')
 order by 1;

select c.relname as indice, i.indisvalid as valido, i.indisready as pronto, pg_size_pretty(pg_relation_size(c.oid)) as dimensione
  from pg_index i join pg_class c on c.oid = i.indexrelid
 where i.indrelid = 'public.entities'::regclass and c.relname like 'entities_bk_%_idx'
 order by 1;

-- 2. Per ogni proprietario e kind: righe in tabella contro chiavi del blocco.
--    scopo = 'NUOVI' -> le differenze devono essere 0 (righe vuote = collaudo superato)
--    scopo = 'ESISTENTI' -> solo informativo (ospiti duplicati personale/org e simili possono differire; il controllo
--                           ufficiale dei kind esistenti resta entities_verify)
with b as (
  select 'u'::char(1) as ot, a.user_id as oid, public._entities_parse_v1(a.data -> 'spigolestay:data:v1') as v from public.app_state a
  union all
  select 'o'::char(1), s.org_id, public._entities_parse_v1(s.data -> 'spigolestay:data:v1') from public.org_state s
), k (kind, fld, typ, scopo) as (
  values ('structures', 'structures', 'arr', 'ESISTENTI'), ('roomTypes', 'roomTypes', 'arr', 'ESISTENTI'),
         ('units', 'units', 'arr', 'ESISTENTI'), ('bookings', 'bookings', 'arr', 'ESISTENTI'),
         ('guests', 'guests', 'arr', 'ESISTENTI'), ('directReviews', 'directReviews', 'arr', 'ESISTENTI'),
         ('events', 'events', 'arr', 'ESISTENTI'),
         ('rates', 'rateOverrides', 'obj', 'NUOVI'), ('activities', 'activities', 'arr', 'NUOVI'),
         ('tombs', '_deleted', 'tomb', 'NUOVI'), ('leadtombs', '_deletedLeads', 'lead', 'NUOVI')
), bn as (
  select b.ot, b.oid, k.kind, k.scopo,
         case k.typ
           when 'arr' then (select count(distinct x.value ->> 'id')
                              from jsonb_array_elements(case when jsonb_typeof(b.v -> k.fld) = 'array' then b.v -> k.fld else '[]'::jsonb end) x)
           when 'obj' then (select count(*)
                              from jsonb_object_keys(case when jsonb_typeof(b.v -> k.fld) = 'object' then b.v -> k.fld else '{}'::jsonb end))
           when 'tomb' then (select count(distinct c.key || ':' || t.value)
                               from jsonb_each(case when jsonb_typeof(b.v -> k.fld) = 'object' then b.v -> k.fld else '{}'::jsonb end) c
                               cross join lateral jsonb_array_elements_text(case when jsonb_typeof(c.value) = 'array' then c.value else '[]'::jsonb end) t)
           when 'lead' then (select count(distinct s.value)
                               from jsonb_array_elements_text(case when jsonb_typeof(b.v -> k.fld) = 'array' then b.v -> k.fld else '[]'::jsonb end) s)
         end as n
    from b cross join k
   where b.v is not null
), tn as (
  select e.owner_type as ot, e.owner_id as oid, e.kind, count(*) as n from public.entities e group by 1, 2, 3
)
select coalesce(bn.scopo, case when tn.kind in ('rates', 'activities', 'tombs', 'leadtombs') then 'NUOVI' else 'ESISTENTI' end) as scopo,
       coalesce(bn.ot, tn.ot) as owner_type, coalesce(bn.oid, tn.oid) as owner_id, coalesce(bn.kind, tn.kind) as kind,
       coalesce(bn.n, 0) as chiavi_nel_blocco, coalesce(tn.n, 0) as righe_in_tabella,
       coalesce(tn.n, 0) - coalesce(bn.n, 0) as differenza
  from bn full join tn on tn.ot = bn.ot and tn.oid = bn.oid and tn.kind = bn.kind
 where coalesce(bn.n, 0) <> coalesce(tn.n, 0)
 order by 1, 2, 3, 4;

-- 3. Riepilogo per proprietario e kind NUOVI (anche quando coincidono, per vedere le dimensioni)
select e.owner_type, e.owner_id, e.kind, count(*) as righe
  from public.entities e
 where e.kind in ('rates', 'activities', 'tombs', 'leadtombs')
 group by 1, 2, 3
 order by 1, 2, 3;

-- 4. Verifica completa con la funzione nuova (contenuto, non solo conteggi). Atteso: nessuna riga.
select * from public.entities_verify_extra()
 where coalesce(missing, 0) <> 0 or coalesce(extra, 0) <> 0 or coalesce(different, 0) <> 0 or kind = 'parse_error';

-- 5. Colonne derivate delle prenotazioni: righe dove non coincidono con data (atteso: 0)
select count(*) as prenotazioni_da_allineare
  from public.entities e
 where e.kind = 'bookings'
   and (   e.unit_id  is distinct from nullif(e.data ->> 'unitId', '')
        or e.guest_id is distinct from nullif(e.data ->> 'guestId', '')
        or e.group_id is distinct from nullif(e.data ->> 'groupId', '')
        or e.ota_code is distinct from nullif(btrim(e.data ->> 'code'), '')
        or e.ext_id   is distinct from nullif(e.data ->> 'extId', ''));

-- 6. Errori (atteso: nessuna riga in entrambe)
select * from public.entities_extra_errors order by id desc limit 50;
select * from public.entities_sync_errors order by 1 desc limit 50;   -- se l'ordinamento per la prima colonna non ha senso, togliere "order by"

-- 7. Copertura delle prenotazioni: quante hanno unit_id / ota_code / ext_id valorizzati (informativo)
select count(*) as prenotazioni,
       count(unit_id) as con_unit_id, count(guest_id) as con_guest_id, count(group_id) as con_group_id,
       count(ota_code) as con_ota_code, count(ext_id) as con_ext_id
  from public.entities where kind = 'bookings';

-- 8. Il piano dell'indice sulle disponibilita' viene davvero usato (cambiare uuid e unita' con valori reali)
-- explain (analyze, buffers)
-- select id from public.entities
--  where kind = 'bookings' and owner_type = 'u' and owner_id = '00000000-0000-0000-0000-000000000000'
--    and unit_id = 'UNIT_ID' and check_in < date '2027-01-10' and check_out > date '2027-01-03';
