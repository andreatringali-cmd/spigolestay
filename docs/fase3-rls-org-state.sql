-- ============================================================================
-- Xenora · Fase 3 — Blindatura permessi co-gestore LATO SERVER (RLS su org_state)
-- ============================================================================
-- Obiettivo: impedire, a livello di DATABASE, che un co-gestore con permesso di
-- sola lettura ("viewer") modifichi i dati di una struttura condivisa scrivendo
-- direttamente su org_state (oggi il controllo è solo lato client).
--
-- Cosa fa questa migrazione:
--   • SELECT su org_state: consentita a QUALSIASI membro attivo dell'org.
--   • UPDATE/INSERT su org_state: consentita SOLO a owner e a membri con livello
--     "operator"/"manager". I "viewer" diventano SOLA LETTURA anche via API/devtools.
--
-- Limite noto (accettato): l'RLS è a livello di RIGA (l'intero blob org_state), quindi
-- NON può distinguere il permesso per singolo modulo (es. "operator" può toccare il
-- calendario ma non i prezzi). Quel controllo fine resta lato client. L'RLS qui
-- garantisce comunque il confine più importante: viewer = read-only reale.
--
-- ⚠️ PRIMA DI ESEGUIRE IN PRODUZIONE:
--   1) Testare su un BRANCH/ambiente di staging Supabase.
--   2) Verificare il TIPO della colonna org_state.org_id (uuid o text) e allinearlo
--      nella funzione sotto (qui assunto uuid; se è text, togliere il cast ::uuid).
--   3) Assicurarsi che il motore di sync (authsync.tsx) continui a leggere/scrivere:
--      l'owner e gli operator/manager devono poter salvare; i viewer no.
--   4) Fare un backup (export .json da Impostazioni) prima di applicare.
-- ============================================================================

-- 1) Funzione helper: il chiamante può SCRIVERE su questa org?
create or replace function public.can_write_org(oid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = oid
      and m.user_id = auth.uid()
      and coalesce(m.active, true) = true
      and (
        m.role = 'owner'
        or coalesce(m.permissions->>'_level', 'manager') in ('manager', 'operator')
      )
  );
$$;

-- 2) Funzione helper: il chiamante è MEMBRO (può LEGGERE) di questa org?
create or replace function public.is_org_member(oid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = oid
      and m.user_id = auth.uid()
      and coalesce(m.active, true) = true
  );
$$;

-- 3) Abilita RLS e definisci le policy su org_state.
alter table public.org_state enable row level security;

-- Lettura: tutti i membri attivi dell'org.
drop policy if exists org_state_select on public.org_state;
create policy org_state_select on public.org_state
  for select
  using (public.is_org_member(org_id));

-- Aggiornamento: solo owner + operator/manager.
drop policy if exists org_state_update on public.org_state;
create policy org_state_update on public.org_state
  for update
  using (public.can_write_org(org_id))
  with check (public.can_write_org(org_id));

-- Inserimento: solo owner + operator/manager (di norma la riga esiste già).
drop policy if exists org_state_insert on public.org_state;
create policy org_state_insert on public.org_state
  for insert
  with check (public.can_write_org(org_id));

-- NB: le operazioni server con SERVICE ROLE (invite/members/unshare/accept) bypassano
-- l'RLS by-design e restano protette dai controlli owner già presenti nelle route API.
--
-- Rollback (se necessario):
--   drop policy if exists org_state_select on public.org_state;
--   drop policy if exists org_state_update on public.org_state;
--   drop policy if exists org_state_insert on public.org_state;
--   -- (valutare se ripristinare eventuali policy preesistenti / disabilitare RLS)
