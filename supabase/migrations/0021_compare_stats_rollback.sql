-- Rollback di 0021: toglie funzioni e tabella dei contatori (nessun dato dell'app viene toccato).
drop function if exists public.entities_compare_summary(int);
drop function if exists public.entities_compare_flush(jsonb);
drop table if exists public.entities_compare_stats;
