-- 0018_daily_snapshots_rollback.sql
--
-- NON ANCORA APPLICATA. Annulla 0018: toglie la pianificazione, le due funzioni e le due tabelle delle copie giornaliere.
-- ATTENZIONE: cancella anche le copie giornaliere gia' fatte (non l'originale app_state/org_state e non lo storico a 30 versioni).
-- Se vuoi tenere le copie ma fermare solo la pianificazione, esegui soltanto il punto 1.
-- Da eseguire in una transazione (apply_migration / editor SQL). Idempotente.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- 1. pianificazione
do $rb$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'daily-snapshots';
end;
$rb$;

-- 2. funzioni
drop function if exists public.restore_flat_key_from_daily(uuid, date, text, boolean, text);
drop function if exists public.take_daily_snapshots(date, int, bigint, int, integer);

-- 3. tabelle (e con loro indici, RLS e commenti)
drop table if exists public.app_state_daily;
drop table if exists public.org_state_daily;
