-- 0018 — Copia giornaliera di ogni account/organizzazione + ripristino di UNA chiave (NON APPLICATA: da eseguire quando decidi).
--
-- PERCHE': lo storico app_state_history / org_state_history tiene solo le ultime 30 VERSIONI per account (trigger snapshot_app_state /
-- snapshot_org_state). Con molti salvataggi in una giornata le 30 versioni si consumano in poche ore e il lavoro del giorno prima
-- (es. una guida ospiti) non e' piu' recuperabile. Qui si aggiunge una copia PER GIORNO, conservata 30 GIORNI, indipendente dal numero
-- di salvataggi. Lo storico a 30 versioni NON viene toccato: le due protezioni si sommano.
--
-- COSA FA:
--  1. tabelle app_state_daily (una riga per utente e giorno) e org_state_daily (una per organizzazione e giorno);
--  2. take_daily_snapshots(): copia, e' idempotente (due esecuzioni nello stesso giorno = una sola copia), toglie le copie piu' vecchie di
--     30 giorni e rispetta un tetto di spazio;
--  3. pianificazione pg_cron «daily-snapshots» ogni notte alle 01:10 UTC (03:10 ora italiana in estate, 02:10 in inverno);
--  4. restore_flat_key_from_daily(): rimette UNA chiave piatta di app_state (o una sola voce al suo interno, es. la guida di una struttura)
--     da una copia giornaliera. Solo service role. Con dry_run (predefinito) dice soltanto cosa cambierebbe.
--
-- SCELTA «prima copia del giorno» (ON CONFLICT DO NOTHING) E ORARIO NOTTURNO:
--  - la copia gira di notte, quindi fotografa lo stato a FINE giornata: contiene tutto il lavoro del giorno appena concluso. Il giorno di
--    riferimento e' quello italiano di (adesso - 4 ore): alle 03:10 la copia si chiama col giorno PRECEDENTE («copia del 21/10» = com'era
--    l'app nella notte tra il 21 e il 22, con tutto il lavoro del 21).
--  - se la funzione viene rilanciata (a mano o per errore) la copia gia' presente NON viene sostituita: vince la PRIMA. Cosi' un rilancio
--    fatto dopo un danno non puo' mai sovrascrivere una copia buona con una copia rovinata.
--
-- SPAZIO (misurato in sola lettura il 21/10/2026): app_state 6 righe, 2,0 MB compressi (4,8 MB di testo); org_state 3 righe, 1,75 MB
-- compressi (4,4 MB di testo). Una giornata = circa 3,8 MB compressi (9,1 MB di testo). A 30 giorni: circa 113 MB compressi (273 MB se
-- non comprimesse). Tetto qui sotto: 250 MB di dati effettivamente memorizzati (p_max_bytes). Oltre il tetto si eliminano i giorni piu'
-- vecchi, mantenendo sempre almeno gli ultimi 7. Una singola riga oltre 32 MB di testo non viene copiata (e si segnala con un WARNING):
-- i blocchi reali sono 0,5-2,5 MB.
--
-- SICUREZZA: RLS attiva e NESSUNA policy sulle due tabelle (anon e authenticated non vedono nulla, privilegi revocati anche a livello di
-- tabella). Le funzioni sono eseguibili solo dal service role; il client dell'app non le raggiunge.
--
-- ROLLBACK: 0018_daily_snapshots_rollback.sql.
-- Eseguire in una transazione unica (apply_migration / editor SQL). NON usare `supabase db push` senza controllare i prefissi dei file.

set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── 1. Tabelle ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.app_state_daily (
  user_id   uuid        not null,
  day       date        not null,                    -- giorno italiano a cui si riferisce la copia
  data      jsonb       not null,                    -- copia integrale di app_state.data
  bytes     integer     not null,                    -- dimensione del testo JSON, in byte (per l'elenco e le stime)
  rev       bigint      not null,                    -- app_state.rev al momento della copia
  taken_at  timestamptz not null default now(),
  primary key (user_id, day)
);
create table if not exists public.org_state_daily (
  org_id    uuid        not null,
  day       date        not null,
  data      jsonb       not null,
  bytes     integer     not null,
  rev       bigint      not null,
  taken_at  timestamptz not null default now(),
  primary key (org_id, day)
);
create index if not exists app_state_daily_day_idx on public.app_state_daily (day);
create index if not exists org_state_daily_day_idx on public.org_state_daily (day);

alter table public.app_state_daily enable row level security;
alter table public.org_state_daily enable row level security;
-- nessuna policy: nessun accesso per anon/authenticated. Revoca esplicita (cintura e bretelle).
revoke all on public.app_state_daily from public, anon, authenticated;
revoke all on public.org_state_daily from public, anon, authenticated;
grant select on public.app_state_daily to service_role;   -- l'elenco admin legge (senza la colonna data) e il ripristino legge
grant select on public.org_state_daily to service_role;

comment on table public.app_state_daily is 'Copia giornaliera di app_state (30 giorni). Migrazione 0018. Solo service role.';
comment on table public.org_state_daily is 'Copia giornaliera di org_state (30 giorni). Migrazione 0018. Solo service role.';

-- ── 2. Copia giornaliera ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.take_daily_snapshots(
  p_day            date    default null,
  p_retention_days int     default 30,
  p_max_bytes      bigint  default 262144000,   -- 250 MiB di dati memorizzati (compressi) per le due tabelle insieme
  p_min_keep_days  int     default 7,           -- il tetto non elimina mai gli ultimi N giorni
  p_max_row_bytes  integer default 33554432     -- una riga piu' grande di 32 MiB di testo non viene copiata
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_day        date := coalesce(p_day, ((now() at time zone 'Europe/Rome') - interval '4 hours')::date);
  v_app_ins    int := 0;
  v_org_ins    int := 0;
  v_big        int := 0;
  v_big_org    int := 0;
  v_expired    int := 0;
  v_cap_days   int := 0;
  v_total      bigint;
  v_oldest     date;
  v_n          int;
  v_guard      int := 0;
begin
  if p_retention_days < 1 or p_retention_days > 365 then raise exception 'take_daily_snapshots: p_retention_days fuori range (1-365)'; end if;
  if p_min_keep_days  < 1 or p_min_keep_days  > p_retention_days then raise exception 'take_daily_snapshots: p_min_keep_days fuori range'; end if;
  if p_max_bytes < 1048576 then raise exception 'take_daily_snapshots: p_max_bytes troppo basso (< 1 MiB)'; end if;

  -- (a) copia. La PRIMA copia del giorno vince: un rilancio non sostituisce nulla.
  with src as (
    select user_id, data, rev, octet_length(data::text) as b from public.app_state
  ), ins as (
    insert into public.app_state_daily (user_id, day, data, bytes, rev)
    select user_id, v_day, data, b, rev from src where b <= p_max_row_bytes
    on conflict (user_id, day) do nothing
    returning 1
  ) select count(*) into v_app_ins from ins;
  select count(*) into v_big from public.app_state where octet_length(data::text) > p_max_row_bytes;

  with src as (
    select org_id, data, rev, octet_length(data::text) as b from public.org_state
  ), ins as (
    insert into public.org_state_daily (org_id, day, data, bytes, rev)
    select org_id, v_day, data, b, rev from src where b <= p_max_row_bytes
    on conflict (org_id, day) do nothing
    returning 1
  ) select count(*) into v_org_ins from ins;
  select count(*) into v_big_org from public.org_state where octet_length(data::text) > p_max_row_bytes;

  if v_big + v_big_org > 0 then
    raise warning 'take_daily_snapshots: % righe oltre il limite di % byte NON copiate (app_state: %, org_state: %)', v_big + v_big_org, p_max_row_bytes, v_big, v_big_org;
  end if;

  -- (b) retention: via le copie piu' vecchie di p_retention_days giorni (si tengono v_day-(N-1) .. v_day)
  delete from public.app_state_daily where day <= v_day - p_retention_days;
  get diagnostics v_n = row_count; v_expired := v_expired + v_n;
  delete from public.org_state_daily where day <= v_day - p_retention_days;
  get diagnostics v_n = row_count; v_expired := v_expired + v_n;

  -- (c) tetto di spazio: spazio effettivamente occupato dai dati (pg_column_size = compressi). Si eliminano i giorni piu' vecchi, uno alla volta,
  --     ma mai gli ultimi p_min_keep_days.
  loop
    select coalesce((select sum(pg_column_size(data)) from public.app_state_daily), 0)
         + coalesce((select sum(pg_column_size(data)) from public.org_state_daily), 0) into v_total;
    exit when v_total <= p_max_bytes;
    select least((select min(day) from public.app_state_daily), (select min(day) from public.org_state_daily)) into v_oldest;
    exit when v_oldest is null or v_oldest > v_day - p_min_keep_days;
    delete from public.app_state_daily where day = v_oldest;
    delete from public.org_state_daily where day = v_oldest;
    v_cap_days := v_cap_days + 1;
    v_guard := v_guard + 1;
    exit when v_guard > 400;
  end loop;
  if v_cap_days > 0 then
    raise warning 'take_daily_snapshots: tetto di spazio superato, eliminati % giorni piu'' vecchi', v_cap_days;
  end if;
  if v_total > p_max_bytes then
    raise warning 'take_daily_snapshots: sopra il tetto (% byte) ma restano solo gli ultimi % giorni', v_total, p_min_keep_days;
  end if;

  return jsonb_build_object(
    'day', v_day, 'app_inserted', v_app_ins, 'org_inserted', v_org_ins,
    'skipped_too_big', v_big + v_big_org, 'deleted_expired', v_expired, 'deleted_for_cap_days', v_cap_days,
    'stored_bytes', v_total, 'max_bytes', p_max_bytes
  );
end;
$fn$;
revoke all on function public.take_daily_snapshots(date, int, bigint, int, integer) from public, anon, authenticated;
grant execute on function public.take_daily_snapshots(date, int, bigint, int, integer) to service_role;

-- ── 3. Ripristino di UNA chiave piatta di app_state ──────────────────────────────────────────────────────────────────────────────────
-- Le chiavi piatte di app_state.data hanno per valore una STRINGA (il JSON della chiave serializzato), es. 'spigolestay:guides'.
-- p_subkey (facoltativo): se la chiave contiene un oggetto (es. le guide, indicizzate per id struttura), rimette SOLO quella voce e lascia
-- intatte tutte le altre (comprese le modifiche fatte dopo la copia sulle altre strutture).
-- La scrittura e' un normale UPDATE di app_state: scattano i trigger di sempre (snapshot nello storico a 30 versioni -> il ripristino stesso
-- e' annullabile; rev + 1 -> gli altri dispositivi se ne accorgono; entities_sync_app).
-- NON ripristina mai 'spigolestay:data:v1' (il blocco principale: prenotazioni, ospiti, strutture; ha le sue regole e le tabelle entities).
-- NON cancella mai chiavi. NON crea la riga dell'account. Usabile solo da service role (o postgres).
create or replace function public.restore_flat_key_from_daily(
  p_user_id uuid,
  p_day     date,
  p_key     text,
  p_dry_run boolean default true,
  p_subkey  text    default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_snap_row   public.app_state_daily%rowtype;
  v_cur_data   jsonb;
  v_snap_val   jsonb;      -- valore della chiave nella copia
  v_cur_val    jsonb;      -- valore attuale
  v_snap_txt   text;
  v_cur_txt    text;
  v_new_txt    text;
  v_snap_obj   jsonb;
  v_cur_obj    jsonb;
  v_new_obj    jsonb;
  v_rows       int;
  v_only_snap  jsonb;
  v_only_cur   jsonb;
  v_changed    boolean;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'restore_flat_key_from_daily: riservata al service role';
  end if;
  if p_user_id is null or p_day is null or coalesce(p_key, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'parametri_mancanti');
  end if;
  if p_key = 'spigolestay:data:v1' then
    return jsonb_build_object('ok', false, 'reason', 'chiave_non_piatta', 'detail', 'Il blocco principale (data:v1) non si ripristina da qui.');
  end if;

  select * into v_snap_row from public.app_state_daily where user_id = p_user_id and day = p_day;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'copia_non_trovata', 'user_id', p_user_id, 'day', p_day);
  end if;
  v_snap_val := v_snap_row.data -> p_key;
  if v_snap_val is null then
    return jsonb_build_object('ok', false, 'reason', 'chiave_assente_nella_copia', 'key', p_key, 'day', p_day);
  end if;
  if jsonb_typeof(v_snap_val) <> 'string' then
    return jsonb_build_object('ok', false, 'reason', 'chiave_non_piatta', 'detail', 'Nella copia il valore non e'' una stringa JSON.');
  end if;
  v_snap_txt := v_snap_val #>> '{}';

  -- riga attuale: in scrittura la si blocca (nessun salvataggio nel mezzo); in dry_run solo lettura
  if p_dry_run then
    select data into v_cur_data from public.app_state where user_id = p_user_id;
  else
    select data into v_cur_data from public.app_state where user_id = p_user_id for update;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account_non_trovato', 'user_id', p_user_id);
  end if;
  v_cur_val := v_cur_data -> p_key;
  if v_cur_val is not null and jsonb_typeof(v_cur_val) <> 'string' then
    return jsonb_build_object('ok', false, 'reason', 'chiave_non_piatta', 'detail', 'Nel database il valore attuale non e'' una stringa JSON.');
  end if;
  v_cur_txt := v_cur_val #>> '{}';

  if p_subkey is null then
    -- ── Sostituzione dell'intera chiave ───────────────────────────────────────────────────────────────────────────────────────────
    v_new_txt := v_snap_txt;
    v_changed := v_cur_txt is distinct from v_new_txt;
    -- per chiavi che contengono un oggetto: quali voci si perderebbero / tornerebbero (solo informativo)
    begin
      v_snap_obj := v_snap_txt::jsonb; v_cur_obj := v_cur_txt::jsonb;
      if jsonb_typeof(v_snap_obj) = 'object' and jsonb_typeof(v_cur_obj) = 'object' then
        select coalesce(jsonb_agg(k order by k), '[]') into v_only_snap from jsonb_object_keys(v_snap_obj) k where not jsonb_exists(v_cur_obj, k);
        select coalesce(jsonb_agg(k order by k), '[]') into v_only_cur  from jsonb_object_keys(v_cur_obj)  k where not jsonb_exists(v_snap_obj, k);
      end if;
    exception when others then null; end;
  else
    -- ── Una sola voce dentro un oggetto ───────────────────────────────────────────────────────────────────────────────────────────
    begin
      v_snap_obj := v_snap_txt::jsonb;
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'valore_non_json', 'detail', 'La copia non contiene JSON valido: usare la sostituzione dell''intera chiave.');
    end;
    if jsonb_typeof(v_snap_obj) <> 'object' or not jsonb_exists(v_snap_obj, p_subkey) then
      return jsonb_build_object('ok', false, 'reason', 'voce_assente_nella_copia', 'key', p_key, 'subkey', p_subkey);
    end if;
    begin
      v_cur_obj := coalesce(v_cur_txt::jsonb, '{}'::jsonb);
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'valore_attuale_non_json');
    end;
    if jsonb_typeof(v_cur_obj) <> 'object' then
      return jsonb_build_object('ok', false, 'reason', 'valore_attuale_non_oggetto');
    end if;
    v_new_obj := v_cur_obj || jsonb_build_object(p_subkey, v_snap_obj -> p_subkey);
    v_new_txt := v_new_obj::text;
    v_changed := (v_cur_obj -> p_subkey) is distinct from (v_snap_obj -> p_subkey);
    v_only_snap := case when jsonb_exists(v_cur_obj, p_subkey) then '[]'::jsonb else jsonb_build_array(p_subkey) end;
    v_only_cur  := '[]'::jsonb;
  end if;

  if not v_changed then
    return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'would_change', false, 'applied', false,
                              'reason', 'nessuna_differenza', 'key', p_key, 'subkey', p_subkey, 'day', p_day);
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dry_run', true, 'would_change', true, 'applied', false,
      'user_id', p_user_id, 'day', p_day, 'key', p_key, 'subkey', p_subkey,
      'key_present_now', v_cur_val is not null,
      'current_bytes', coalesce(octet_length(v_cur_txt), 0), 'restored_bytes', octet_length(v_new_txt),
      'current_md5', md5(coalesce(v_cur_txt, '')), 'restored_md5', md5(v_new_txt),
      'entries_coming_back', coalesce(v_only_snap, '[]'::jsonb),
      'entries_that_would_be_lost', coalesce(v_only_cur, '[]'::jsonb)
    );
  end if;

  -- scrittura: UN solo UPDATE, UNA sola chiave, tramite i trigger normali
  update public.app_state
     set data = data || jsonb_build_object(p_key, v_new_txt),
         updated_at = now()
   where user_id = p_user_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- un trigger (es. anti-svuotamento) ha scartato l'aggiornamento
    return jsonb_build_object('ok', false, 'reason', 'scrittura_bloccata_da_trigger', 'rows', v_rows);
  elsif v_rows > 1 then
    raise exception 'restore_flat_key_from_daily: % righe toccate per lo stesso utente (atteso 1): annullato', v_rows;
  end if;
  return jsonb_build_object(
    'ok', true, 'dry_run', false, 'would_change', true, 'applied', true,
    'user_id', p_user_id, 'day', p_day, 'key', p_key, 'subkey', p_subkey,
    'current_bytes_before', coalesce(octet_length(v_cur_txt), 0), 'restored_bytes', octet_length(v_new_txt),
    'entries_coming_back', coalesce(v_only_snap, '[]'::jsonb),
    'entries_lost', coalesce(v_only_cur, '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.restore_flat_key_from_daily(uuid, date, text, boolean, text) from public, anon, authenticated;
grant execute on function public.restore_flat_key_from_daily(uuid, date, text, boolean, text) to service_role;

-- ── 4. Pianificazione pg_cron ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Letto dal database il 21/10/2026: pg_cron 1.6.4 e pg_net 0.20.4 installati; un solo job esistente («pulizie-plan-10min», */10 4-20, che chiama
-- l'app con net.http_get). Gli altri cron notturni (entities-verify 03:15, alloggiati-auto, sdi-status, ecc.) sono cron di VERCEL (vercel.json),
-- non pg_cron. Questo job NON chiama l'app: esegue la funzione direttamente nel database (nessuna rete, nessun token).
-- 01:10 UTC: lontano da entities-verify (03:15 UTC) e dai job delle pulizie (04-20 UTC).
do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'daily-snapshots';   -- idempotente: nessun doppione se la migrazione si ripete
  perform cron.schedule('daily-snapshots', '10 1 * * *', 'select public.take_daily_snapshots()');
end;
$cron$;
