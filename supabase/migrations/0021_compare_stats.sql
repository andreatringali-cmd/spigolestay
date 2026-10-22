-- 0021 — Contatori del confronto «blocco contro tabelle» (Fase 3, passo 1), conservati nel database.
--
-- PERCHE': le differenze del confronto (SERVER_READ_ENTITIES=compare) finivano solo nei log di Vercel, che durano circa un'ora: impossibile contare
-- «7 giorni senza differenze». Qui ogni punto del server (label) registra, per giorno, quante letture sono andate bene (ok), quante hanno dato
-- differenze (diff) e quante errori (error), più l'ultimo dettaglio di una differenza. Il controllo notturno aggiunge la riga «verify:extra».
--
-- Solo aggiunte: una tabella e due funzioni. Nessun dato esistente viene toccato. Rollback: 0021_compare_stats_rollback.sql.

create table if not exists public.entities_compare_stats (
  day         date        not null,
  label       text        not null,
  ok          integer     not null default 0,
  diff        integer     not null default 0,
  error       integer     not null default 0,
  last_diff   jsonb,
  last_diff_at timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (day, label)
);
alter table public.entities_compare_stats enable row level security;       -- nessuna policy: solo service role
revoke all on public.entities_compare_stats from public, anon, authenticated;

-- Il server manda i contatori accumulati in memoria: [{label, ok, diff, error, detail?}, ...]. Il giorno è quello italiano.
create or replace function public.entities_compare_flush(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r jsonb; v_day date := (now() at time zone 'Europe/Rome')::date;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'label','') = '' then continue; end if;
    insert into public.entities_compare_stats as s (day, label, ok, diff, error, last_diff, last_diff_at)
    values (v_day, left(r->>'label', 120), greatest(0, coalesce((r->>'ok')::int, 0)), greatest(0, coalesce((r->>'diff')::int, 0)), greatest(0, coalesce((r->>'error')::int, 0)),
            case when coalesce((r->>'diff')::int, 0) > 0 then r->'detail' end,
            case when coalesce((r->>'diff')::int, 0) > 0 then now() end)
    on conflict (day, label) do update
      set ok = s.ok + excluded.ok, diff = s.diff + excluded.diff, error = s.error + excluded.error,
          last_diff = coalesce(excluded.last_diff, s.last_diff), last_diff_at = coalesce(excluded.last_diff_at, s.last_diff_at), updated_at = now();
  end loop;
  delete from public.entities_compare_stats where day < v_day - 90;   -- conserva 90 giorni
end $$;
revoke all on function public.entities_compare_flush(jsonb) from public, anon, authenticated;
grant execute on function public.entities_compare_flush(jsonb) to service_role;

-- Riepilogo per punto: giorni con dati dopo l'ultimo giorno con differenze o errori (serve al criterio «7 giorni puliti»), totali della finestra.
create or replace function public.entities_compare_summary(p_days int default 7)
returns table (label text, days_seen int, ok bigint, diff bigint, error bigint, clean_days int, last_diff_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (
    select * from public.entities_compare_stats
     where day >= (now() at time zone 'Europe/Rome')::date - greatest(p_days, 1) + 1
  ), lb as (
    select x.label, max(x.day) as last_bad from d x where x.diff > 0 or x.error > 0 group by x.label
  )
  select d.label, count(distinct d.day)::int, sum(d.ok)::bigint, sum(d.diff)::bigint, sum(d.error)::bigint,
         (count(distinct d.day) filter (where d.day > coalesce(lb.last_bad, date '1900-01-01')))::int,
         max(d.last_diff_at)
    from d left join lb on lb.label = d.label
   group by d.label, lb.last_bad
   order by d.label;
$$;
revoke all on function public.entities_compare_summary(int) from public, anon, authenticated;
grant execute on function public.entities_compare_summary(int) to service_role;
