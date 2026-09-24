-- ============================================================================
-- Xenora · FASE 3 — Enforcement LATO SERVER dei permessi del co-gestore/socio
-- ============================================================================
-- STATO: PROPOSTA. NON ANCORA APPLICATA. NON eseguire in produzione così com'è.
-- Questo file va REVISIONATO e TESTATO su un BRANCH Supabase prima della prod.
-- Il DB di produzione è LIVE e condiviso tra soci: una policy sbagliata può
-- bloccare l'accesso all'utente E al socio (lockout). Vedere la sezione TEST.
--
-- ----------------------------------------------------------------------------
-- CONTESTO / MODELLO ATTUALE (ricavato dal codice, set. 2026)
-- ----------------------------------------------------------------------------
--  • I dati di una struttura CONDIVISA vivono in UNA riga `org_state` per org,
--    colonna `data` jsonb del tipo { "spigolestay:data:v1": "<json>" }, con
--    colonna `rev bigint` (lucchetto ottimistico) e trigger `snapshot_org_state`
--    (anti-svuotamento + storico).
--  • La SCRITTURA normale (prenotazioni, camere, prezzi, cassa, impostazioni) NON
--    passa da nessuna route server: il CLIENT (`src/lib/authsync.tsx`,
--    `writeRowWithLock`) fa `supabase.from("org_state").update()/insert()`
--    DIRETTAMENTE, con il JWT dell'utente (ruolo `authenticated`) → quindi è
--    soggetta a RLS. => L'UNICO punto di enforcement server-side per i permessi
--    del co-gestore è la RLS su `org_state` (+ `memberships`).
--  • I permessi del co-gestore sono in `memberships.permissions` (jsonb): mappa
--    { "_level": "viewer|operator|manager", "<modulo>": "none|view|edit", ... }
--    generata da `src/lib/comanager.ts` (coManagerPerms). Oggi applicati SOLO
--    lato client in `src/lib/access.tsx` (limita view/edit quando la struttura
--    attiva è di un'org di cui sei `member`). Limite noto: il client scarica
--    comunque tutto il blob → un utente tecnico vede via devtools ciò che la UI
--    nasconde, e potrebbe TENTARE scritture non consentite.
--  • Le route server che scrivono org_state (public-booking, stripe/book(+confirm),
--    manage-booking cancel/modify, checkin, channex-inbound, cron) usano la
--    SERVICE ROLE (bypassano la RLS): sono azioni di OSPITE / OTA / SISTEMA, NON
--    del co-gestore, quindi NON vanno limitate dai permessi di membership.
--  • Le route amministrative org (invite/accept/members/leave/unshare) usano già
--    la service role e verificano il ruolo `owner` lato route: restano valide.
--  • NESSUN client scrive `memberships` direttamente: TUTTE le scritture su
--    memberships avvengono nelle route service-role sopra (verificato via grep).
--    => si possono negare del tutto le scritture client su memberships senza
--    rischio di lockout (l'owner gestisce i soci solo via /api/org/members).
--
-- ----------------------------------------------------------------------------
-- COSA FA QUESTA PROPOSTA
-- ----------------------------------------------------------------------------
--  [A] org_state: SELECT per ogni membro attivo; UPDATE/INSERT solo per owner e
--      membri con livello operator/manager. => "viewer" (Sola lettura) diventa
--      SOLA LETTURA REALE anche via API/devtools.
--  [B] memberships: SELECT per i membri dell'org; NESSUNA scrittura da client
--      (solo service role). => un socio non può auto-promuoversi cambiando il
--      proprio `permissions`/`role`/`active` dal browser.
--  [C] (OPZIONALE, avanzato, NON per subito) trigger per-campo che impedisce a un
--      "operator" di modificare prezzi/incassi dentro il blob. Vedi sezione [C]:
--      resta commentata perché fragile e a rischio lockout; da valutare dopo.
--
-- LIMITE STRUTTURALE ACCETTATO: org_state è UN unico blob jsonb per riga. La RLS
-- decide sull'INTERA riga (leggo/scrivo sì o no), NON sui singoli campi. Quindi
-- la distinzione fine "operator può toccare il calendario ma non i prezzi" NON è
-- esprimibile con la sola RLS: o resta lato client (come oggi), o serve il
-- trigger della sezione [C], o (soluzione pulita futura) spezzare org_state in
-- più righe/tabelle per dominio. Il confine PIÙ IMPORTANTE — viewer=read-only,
-- membro in pausa/rimosso=niente scrittura, non-membro=niente — è invece
-- garantito in modo solido dalle policy [A]/[B].
--
-- ⚠️ RISCHIO LOCKOUT — LEGGERE PRIMA DI APPLICARE (dettagli in fondo):
--   1) Le funzioni helper DEVONO avere GRANT EXECUTE a `authenticated`. In
--      passato un `is_org_member` senza questo GRANT ha causato lockout SILENZIOSO
--      (le policy fallivano, la sync org tornava vuota). Vedi GRANT più sotto.
--   2) Le policy RLS sono PERMISSIVE e in OR: se su org_state esiste GIÀ una
--      policy larga (es. "membri: ALL"), le nuove NON restringono nulla finché
--      quella non viene RIMOSSA. VEDI STEP 0 (censimento + drop) — CRUCIALE.
--   3) L'owner e i membri con permessi pieni NON devono mai essere bloccati:
--      il ramo `role='owner'` e il default fail-open `coalesce(_level,'manager')`
--      garantiscono che un permesso assente/nullo = pieno (mai read-only per caso).
-- ============================================================================


-- ============================================================================
-- STEP 0 — CENSIMENTO (SOLO LETTURA) — eseguire e INCOLLARE l'output in revisione
-- ============================================================================
-- Serve a sapere che RLS/policy esistono OGGI su queste tabelle, per non lasciare
-- attiva una vecchia policy larga che vanificherebbe le nuove (punto 2 sopra) e
-- per verificare il TIPO di org_id.

-- 0.1  Policy attualmente presenti (nome, comando, USING/CHECK):
--   select schemaname, tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where tablename in ('org_state','memberships')
--   order by tablename, policyname;

-- 0.2  RLS abilitata? (relrowsecurity/relforcerowsecurity)
--   select relname, relrowsecurity, relforcerowsecurity
--   from pg_class
--   where relname in ('org_state','memberships');

-- 0.3  Tipo delle colonne chiave (per decidere se org_id è uuid o text):
--   select table_name, column_name, data_type
--   from information_schema.columns
--   where table_name in ('org_state','memberships')
--     and column_name in ('org_id','user_id','role','active','permissions','rev','data');

-- 0.4  Grant attuali sulle funzioni helper (verifica del punto lockout #1):
--   select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_exec
--   from pg_proc p
--   cross join (values ('authenticated'),('anon'),('service_role')) as r(rolname)
--   where p.proname in ('is_org_member','can_write_org')
--     and p.pronamespace = 'public'::regnamespace;

-- >>> ASSUNZIONE DI QUESTO FILE: org_state.org_id e memberships.org_id sono UUID.
--     Se lo STEP 0.3 dice `text`, RIMUOVERE i cast `::uuid` più sotto (o adattare
--     la firma delle funzioni a `oid text`). NON procedere senza aver verificato.


-- ============================================================================
-- STEP 1 — FUNZIONI HELPER (SECURITY DEFINER) + GRANT
-- ============================================================================
-- Nota: `is_org_member` esiste già in produzione. La ridefiniamo in modo
-- identico nel comportamento (idempotente) SOLO per completezza; l'importante è
-- che i GRANT EXECUTE restino/venga-ri-applicati (vedi lockout #1). Se preferisci
-- non toccarla, salta la sua create-or-replace ma ESEGUI comunque il GRANT.

create or replace function public.is_org_member(oid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = oid
      and m.user_id = auth.uid()
      and coalesce(m.active, true) = true
  );
$$;

-- Può SCRIVERE su questa org? owner sempre; member solo se operator/manager.
-- fail-open sul livello: permissions assenti/null => trattato come 'manager'
-- (pieno) per NON bloccare mai per errore un membro a cui non è stato ancora
-- assegnato un livello. Solo il valore esplicito 'viewer' toglie la scrittura.
create or replace function public.can_write_org(oid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = oid
      and m.user_id = auth.uid()
      and coalesce(m.active, true) = true
      and (
        m.role = 'owner'
        or coalesce(nullif(m.permissions->>'_level',''), 'manager') in ('manager','operator')
      )
  );
$$;

-- CRUCIALE contro il lockout silenzioso: gli utenti loggati devono poter ESEGUIRE
-- gli helper usati dentro le policy. (Storicamente la mancanza di questo GRANT su
-- is_org_member ha reso invisibili le strutture condivise.)
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.can_write_org(uuid) to authenticated;
-- (facoltativo, innocuo) anche a service_role, che comunque bypassa la RLS:
grant execute on function public.is_org_member(uuid) to service_role;
grant execute on function public.can_write_org(uuid) to service_role;


-- ============================================================================
-- STEP 2 — org_state: RLS (lettura membri, scrittura owner/operator/manager)
-- ============================================================================
-- ⚠️ PRIMA: eliminare eventuali policy LARGHE emerse nello STEP 0.1 che
-- concedono scrittura ai soli "membri" (altrimenti, essendo le policy in OR, un
-- viewer continuerebbe a scrivere). Esempi tipici da rimuovere se presenti — DA
-- CONFERMARE COL NOME REALE trovato nello STEP 0.1, NON eseguire alla cieca:
--   drop policy if exists org_state_all       on public.org_state;
--   drop policy if exists org_state_rw        on public.org_state;
--   drop policy if exists "org members all"   on public.org_state;
--   drop policy if exists org_state_member_all on public.org_state;

alter table public.org_state enable row level security;

-- SELECT: qualunque membro attivo dell'org.
drop policy if exists org_state_select on public.org_state;
create policy org_state_select on public.org_state
  for select
  using (public.is_org_member(org_id));

-- UPDATE: solo owner + operator/manager.
drop policy if exists org_state_update on public.org_state;
create policy org_state_update on public.org_state
  for update
  using (public.can_write_org(org_id))
  with check (public.can_write_org(org_id));

-- INSERT: solo owner + operator/manager (di norma la riga org esiste già).
drop policy if exists org_state_insert on public.org_state;
create policy org_state_insert on public.org_state
  for insert
  with check (public.can_write_org(org_id));

-- DELETE: nessuno da client (la riga org_state non va mai cancellata dal client;
-- unshare la gestisce via service role). Non creiamo policy DELETE => negato.
drop policy if exists org_state_delete on public.org_state;


-- ============================================================================
-- STEP 3 — memberships: RLS (lettura membri; scrittura SOLO service role)
-- ============================================================================
-- Impedisce a un socio di auto-promuoversi cambiando dal browser il proprio
-- permissions/role/active. Tutte le scritture legittime passano dalle route
-- service-role (invite/accept/members/leave/unshare), che bypassano la RLS.
-- ⚠️ Anche qui: rimuovere prima eventuali policy larghe di scrittura trovate
-- nello STEP 0.1 (es. una "for all" ai membri).

alter table public.memberships enable row level security;

-- SELECT: i membri dell'org vedono le membership dell'org (serve al client per
-- fetchOrgIds e alla UI "co-gestori"). Ci si auto-vede sempre (utile se, per
-- qualsiasi motivo, is_org_member non risolvesse).
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select
  using (
    user_id = auth.uid()
    or public.is_org_member(org_id)
  );

-- NESSUNA policy INSERT/UPDATE/DELETE per client => negate di default.
-- (Le scritture avvengono solo con service role, che ignora la RLS.)
drop policy if exists memberships_insert on public.memberships;
drop policy if exists memberships_update on public.memberships;
drop policy if exists memberships_delete on public.memberships;
-- ATTENZIONE: se lo STEP 0.1 mostra una policy "for all" preesistente sui membri,
-- va DROPPATA esplicitamente col suo nome reale, altrimenti resta attiva.


-- ============================================================================
-- STEP 4 (OPZIONALE, AVANZATO — NON PER SUBITO) — enforcement PER-CAMPO
-- ============================================================================
-- Obiettivo desiderato ma NON coperto dalla RLS: impedire a un "operator" di
-- cambiare PREZZI/INCASSI pur potendo gestire calendario/prenotazioni. Poiché il
-- blob è unico, servirebbe un trigger BEFORE UPDATE che confronta OLD.data e
-- NEW.data e rifiuta le modifiche ai campi protetti quando chi scrive è operator.
--
-- ⚠️ Perché resta COMMENTATO (rischi reali):
--   • Fragilità: i "prezzi/incassi" sono sparsi nel JSON (roomTypes[].basePrice,
--     rateOverrides{"rtId|ISO"}, bookings[].total/paid, ecc.). Una path dimenticata
--     = falso senso di sicurezza; una troppo aggressiva = blocca modifiche legittime.
--   • Lockout/regressioni: un confronto sbagliato può far fallire OGNI salvataggio
--     dell'operator, o peggio bloccare l'owner se le guardie non sono perfette.
--   • Va sviluppato con TEST dedicati su branch prima di anche solo pensarci in prod.
--
-- Scheletro guardato (da rifinire e testare a parte). Guardie di sicurezza:
--   - se auth.uid() IS NULL  => è la SERVICE ROLE (route ospite/OTA/sistema): NON toccare.
--   - se owner o manager     => nessun vincolo.
--   - solo per operator      => confronta i campi protetti.
--
-- create or replace function public.org_state_field_guard()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   uid   uuid := auth.uid();
--   lvl   text;
--   old_j jsonb := (OLD.data->>'spigolestay:data:v1')::jsonb;
--   new_j jsonb := (NEW.data->>'spigolestay:data:v1')::jsonb;
-- begin
--   -- Service role / contesti senza utente: lascia passare (bookings ospiti, OTA, cron).
--   if uid is null then return NEW; end if;
--
--   select coalesce(nullif(m.permissions->>'_level',''),'manager')
--     into lvl
--   from public.memberships m
--   where m.org_id = NEW.org_id and m.user_id = uid and coalesce(m.active,true)=true;
--
--   -- owner (lvl null perché non-member? no: qui è member) o manager: nessun vincolo.
--   if lvl is null or lvl in ('manager') then return NEW; end if;
--   -- viewer non arriva qui (bloccato dalla policy UPDATE). Resta 'operator':
--   if lvl = 'operator' then
--     -- Esempio: vieta modifiche a rateOverrides (prezzi) e ai totali/pagato prenotazione.
--     if (old_j->'rateOverrides') is distinct from (new_j->'rateOverrides') then
--       raise exception 'operator_cannot_change_prices';
--     end if;
--     -- (aggiungere qui gli altri confronti mirati: roomTypes[].basePrice, bookings[].paid, ...)
--   end if;
--   return NEW;
-- end;
-- $$;
-- -- drop trigger if exists trg_org_state_field_guard on public.org_state;
-- -- create trigger trg_org_state_field_guard
-- --   before update on public.org_state
-- --   for each row execute function public.org_state_field_guard();


-- ============================================================================
-- COME TESTARE SU UN BRANCH SUPABASE (obbligatorio prima della prod)
-- ============================================================================
-- 1) Crea un BRANCH Supabase (ambiente isolato con copia schema) e applica lì
--    QUESTO file (STEP 1→3). Non toccare la prod.
-- 2) Recupera 3 utenti di test dallo schema del branch: un OWNER, un MEMBER
--    'operator' e un MEMBER 'viewer' della STESSA org (id in memberships).
-- 3) Simula ogni utente impostando il claim JWT nella sessione SQL, poi prova
--    lettura/scrittura su org_state (sostituendo <ORG> e <UID_*>):
--
--    -- come VIEWER (deve LEGGERE ma NON scrivere):
--    set local role authenticated;
--    set local request.jwt.claims = '{"sub":"<UID_VIEWER>","role":"authenticated"}';
--    select count(*) from org_state where org_id = '<ORG>';                 -- atteso: 1 (legge)
--    update org_state set updated_at = now() where org_id = '<ORG>';         -- atteso: 0 righe (negato)
--    reset role;
--
--    -- come OPERATOR e come OWNER: ripeti; l'UPDATE deve toccare 1 riga (consentito).
--    -- come NON-MEMBRO: select deve dare 0 righe.
--
-- 4) VERIFICA ANTI-LOCKOUT (la parte più importante):
--    • L'owner riesce a salvare (update org_state → 1 riga). Se NO, STOP: c'è un
--      problema nei GRANT o nei cast org_id (rivedi STEP 0.3/STEP 1).
--    • L'operator/manager riesce a salvare.
--    • Un membro con permissions NULL/senza `_level` riesce comunque a salvare
--      (fail-open): inserisci un caso di test con permissions=null.
--    • Nessuna vecchia policy larga è rimasta (ri-esegui STEP 0.1: devono esserci
--      solo org_state_select/update/insert e memberships_select).
-- 5) Fai un BACKUP (Impostazioni → Backup & dati → Esporta .json) e solo allora,
--    dopo la mia revisione, valuta il merge del branch in prod.
--
-- ============================================================================
-- ROLLBACK (se qualcosa va storto in staging/prod)
-- ============================================================================
--   drop policy if exists org_state_select on public.org_state;
--   drop policy if exists org_state_update on public.org_state;
--   drop policy if exists org_state_insert on public.org_state;
--   drop policy if exists memberships_select on public.memberships;
--   -- BREAK-GLASS temporaneo (riapre tutto ai membri, ripristina il comportamento
--   -- pre-Fase-3 finché non si indaga; NON lasciare attivo a lungo):
--   --   create policy org_state_tmp_all on public.org_state
--   --     for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
--   -- In ultima istanza (solo se necessario a sbloccare):
--   --   alter table public.org_state disable row level security;
-- ============================================================================
