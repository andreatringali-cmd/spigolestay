# Inviti in Xenora: flusso e controlli di sicurezza

Xenora è «accesso su invito»: chi non è in `access_allowlist`, membro di un'organizzazione o con un invito in attesa viene espulso dopo il login (`api/access/status`, `isUserAllowed`).

## Due cose diverse

**(a) Collaboratore dello STESSO account** (Utenti → «Nuovo utente»). Una persona che entra con la propria email e vede i dati del titolare, con i permessi e le strutture scelti nella scheda.
1. `POST /api/admin/allowlist` `{email, profile, notify:false}`: crea la riga `access_allowlist` (`kind=collaboratore`, `added_by` = chi invita, `profile` = scheda).
2. `POST /api/org/invite` `{structureId, email, silent:true}` per ogni struttura scelta: crea (se serve) l'organizzazione, la persona diventa membro e si genera un codice in `org_invites`.
3. `POST /api/admin/allowlist` `{email, resend:true}`: manda l'email con il link `/accetta-invito?code=…` (se c'è il codice) e quello di registrazione `/login?mode=signup&email=…`.
4. Al primo accesso `POST /api/org/access` accetta gli inviti in attesa sulla sua email; il suo profilo diventa la sua scheda; i permessi per struttura li applica `CollaboratorSync` sul browser del titolare.

**(b) Socio che co-gestisce UNA struttura** (Strutture → Condivisione): `api/org/invite` senza `silent`, il socio deve avere già un account; `api/org/accept` con il codice. Non cambia.

## Chi può cosa (`api/admin/allowlist`)
| Chiamante | Elenco | Invita / rimanda / profilo | Annulla invito |
|---|---|---|---|
| Amministratore (`ADMIN_EMAILS`) | tutto | come sempre, nessun limite | qualunque (non gli admin) |
| Titolare dell'account | solo il suo account | sì | solo suoi, non ancora registrati |
| Collaboratore con «Utenti» = modifica | solo il suo account | sì, con i limiti sotto | come il titolare |
| Collaboratore con «Utenti» = vista | solo il suo account | no (403 `missing_permission`) | no |
| Altri | no | no | no |

## Controlli (tutti sul server, `lib/invite-access.ts`)
- **Identità dal token Supabase** (`auth.getUser`). Mai dai campi del corpo: `added_by` e il ruolo sono ricavati dal DB. Un chiamante non ammesso (`isUserAllowed`) riceve 403.
- **Account = titolare radice**: risalendo `added_by` da un collaboratore si arriva al titolare (max 6 passi, cicli = nessun permesso).
- **`kind` e `note` li decide il server**: un titolare crea solo collaboratori, mai altri titolari (quelli passano dall'approvazione dell'amministratore).
- **Nessun account altrui**: se l'email è già un titolare, un collaboratore di un altro account, un utente con un proprio account (dati o strutture) o un amministratore → 409 `email_other_account`, nessuna riga toccata. Vale anche per aggiornare il profilo e per annullare.
- **Email già registrata nel tuo account** → 409 `already_member` («… fa già parte del tuo account»).
- **Nessuna escalation**: i permessi di chi è invitato da un collaboratore non superano i suoi; «Utenti» in modifica lo delega solo il titolare; mai il modello «Titolare»; le strutture solo tra quelle che chi invita vede.
- **Tetto**: 20 inviti in attesa (non ancora registrati) per account → 409 `invite_limit`. Rimandare un invito esistente non conta.
- **Limite orario**: 30 inviti/rinvii all'ora per utente (`rateLimited`, in memoria per istanza: è un freno, l'argine vero è il tetto sul DB).
- **`api/org/invite` con `silent`**: un indirizzo solo «abilitato» (non ancora registrato) si aggancia a una struttura solo se appartiene allo stesso account di chi invita (`sameAccount`); l'amministratore resta libero. La proprietà della struttura è verificata come prima.
- **Annulla invito** toglie la riga e le condivisioni in attesa fatte da chi annulla; se la persona si è già registrata non si può (per togliere l'accesso alle strutture: scheda struttura → Co-gestori).
- Il token dell'invito è quello esistente (`org_invites.code`, link `/accetta-invito`); l'accettazione richiede di entrare con **la stessa email** invitata (`api/org/accept`).

## Limiti noti
- Un collaboratore con «Utenti» non è proprietario delle strutture: la condivisione (`api/org/invite`) risponde `not_owner`; la completa il titolare appena apre Xenora (`CollaboratorSync`).
- «Invito inviato il …» sta sulla scheda utente (`invitedAt`) con ripiego su `access_allowlist.created_at`; vedi la migrazione facoltativa `0016_invites_owner.sql`.
- Test: `tests/invite-owner.test.ts`.
