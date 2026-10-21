# Dati dell'azienda: cosa manca e dove si inserisce

Stato: l'azienda del titolare **non è ancora stata aperta**. Per questo nel codice non c'è nessun dato inventato: dove serve un dato aziendale compare un segnaposto uniforme `[DA COMPLETARE: …]`, visibile a chi apre la pagina.

## Come si compila (5 minuti)

Tutti i dati vivono in UN SOLO file: **`src/lib/azienda.ts`** (oggetto `AZIENDA`). Sostituire i valori `DA_COMPLETARE("…")` con i dati veri e ripubblicare. Termini, Privacy, Cookie, footer delle pagine legali, footer di Prezzi e footer del Login li leggono tutti da lì: nessun'altra modifica ai testi.

Controllo finale: cercare nel codice `DA COMPLETARE` (deve restare solo il DPA nella Privacy, vedi tabella) e aprire `/termini`, `/privacy`, `/cookie`, `/prezzi`, `/login`.

## Tabella da compilare

| Campo (`AZIENDA.…`) | Valore da inserire | Dove compare oggi (file) | Testo con il segnaposto |
|---|---|---|---|
| `denominazione` | Denominazione sociale con forma giuridica: __________ | `src/app/termini/page.tsx` r.10 e r.37; `src/app/privacy/page.tsx` r.10 e r.13; `src/app/cookie/page.tsx` r.10; `src/components/LegalShell.tsx` r.37 (footer pagine legali); `src/app/prezzi/page.tsx` r.256 (footer Prezzi); `src/app/login/LoginForm.tsx` r.329 (footer Login) | `[DA COMPLETARE: denominazione sociale]` |
| `partitaIva` | P.IVA: __________ | Termini r.37; Privacy r.13; Cookie r.10; footer Prezzi r.256 | `[DA COMPLETARE: partita IVA]` |
| `codiceFiscale` | C.F.: __________ | Termini r.37; Privacy r.13 | `[DA COMPLETARE: codice fiscale]` |
| `sede` | Sede legale (via, n., CAP, città, prov.): __________ | Termini r.37; Privacy r.13; Cookie r.10 | `[DA COMPLETARE: sede legale]` |
| `pec` | Indirizzo PEC: __________ | Termini r.37; Privacy r.13 | `[DA COMPLETARE: indirizzo PEC]` |
| `emailPrivacy` | Oggi `info@xenora.it` (casella già attiva). Cambiare solo se si vuole un indirizzo dedicato (es. privacy@): __________ | Privacy r.13 e r.39; Cookie r.30 | non è un segnaposto: è l'indirizzo già in uso |
| `emailContatti` | Oggi `info@xenora.it` (casella generale, già attiva) | Termini r.38. Nota: la stessa casella è scritta anche in `src/app/prezzi/data.ts` (`CONTACT_EMAIL`) e `src/app/(app)/abbonamento/page.tsx` (modulo «su misura» e testo di supporto): se cambia, aggiornare anche lì | — |
| (testo, non in `AZIENDA`) DPA | Accordo di nomina a responsabile (art. 28 GDPR) da **predisporre** e poi dichiarare disponibile: sì/no __________ | `src/app/privacy/page.tsx` r.30 | `[DA COMPLETARE: da predisporre prima di dichiararlo disponibile]` |
| (facoltativo) REA / capitale sociale / registro imprese | Se l'azienda è una società di capitali sono richiesti sul sito: __________ | non presenti: da aggiungere in `azienda.ts` e nel blocco «Chi siamo» dei Termini | — |

Le date «Ultimo aggiornamento: Settembre 2026» sulle tre pagine legali vanno aggiornate quando il testo viene rivisto e approvato. Il riquadro «Bozza — in fase di revisione legale» (`src/components/LegalShell.tsx`) va tolto solo dopo la revisione di un legale.

## Affermazioni nei testi pubblici da far verificare (non sono dati, ma devono essere vere)

1. **Privacy §4, DPA**: il testo non afferma più che esista un DPA; c'è il segnaposto. Prima di dichiararlo, serve un modello di accordo da far firmare/accettare agli utenti.
2. **Privacy §6, fornitori**: prima c'era «tutti vincolati contrattualmente e conformi al GDPR». Rimosso perché non verificabile; ora «regolati dai rispettivi accordi sul trattamento dei dati». Un legale dovrebbe elencare i fornitori (hosting, database, email, pagamenti, Channex) e gli eventuali trasferimenti fuori UE.
3. **Prezzi, FAQ «Dove sono i miei dati»**: «database nell'Unione Europea (Francoforte)»: verificato (progetto Supabase `xenora-prod` in regione eu-central-1). «Backup giornalieri»: **da verificare** sul piano Supabase in uso (i backup giornalieri automatici dipendono dal piano); in alternativa la copia giornaliera per account è in preparazione (agente C della notte).
4. **Prezzi, FAQ «assistenza»**: «giorni feriali dalle 9 alle 18» è un impegno di servizio: confermare o togliere.
5. **Prezzi, FAQ «prova gratuita»**: numeri (5 giorni, 6 camere, 4 € per camera, −20%) verificati su `src/lib/plans.ts`; le FAQ li scrivono a mano in `src/app/prezzi/data.ts` e dovrebbero leggerli da lì per non divergere in futuro.
6. **Privacy §5**: «le immagini dei documenti vengono rimosse dopo l'invio della schedina»: coerente con `src/lib/alloggiati/purge.ts`; resta vero solo se la rimozione è attiva in produzione (ALLOGGIATI_LIVE).
7. **Check-in ospite** (`src/app/checkin/page.tsx` r.882) rimanda alla stessa `/privacy` di Xenora: per l'ospite il titolare è la struttura, non Xenora. Da decidere con il legale se serve un'informativa dedicata per gli ospiti (la pagina Prenota supporta già un `privacyUrl` per struttura).
8. **Tre indirizzi email diversi nel prodotto**: `info@xenora.it` (Prezzi, legali, Abbonamento), `amministrazione@xenoradigitalsolutions.com` (widget assistenza in `src/components/SupportWidget.tsx`, fuori dalla mia area), `prenotazioni@xenora.it` (mittente). Scegliere quali restano.

## Cosa fare dopo l'apertura dell'azienda (elenco semplice)

Nessuno di questi punti è stato toccato dal codice.

1. Compilare `src/lib/azienda.ts`, pubblicare, riaprire le 5 pagine pubbliche (vedi sopra).
2. **Stripe**: aggiornare la ragione sociale, la sede, la P.IVA e il conto bancario nell'account della piattaforma; verificare il nome che compare sull'estratto conto del cliente (statement descriptor) e le impostazioni delle fatture/ricevute Stripe; rivedere il questionario Connect con i dati aziendali.
3. **Fatture**: impostare l'anagrafica cedente (dati azienda, regime IVA, regime fiscale) dove si emettono le fatture dell'abbonamento ai clienti; decidere se emetterle da Stripe o da Fatture in Cloud.
4. **SDI / fatturazione elettronica**: richiesta del codice destinatario o indirizzo PEC dell'azienda; abilitazione al canale (provider scelto); prove in modalità sandbox prima dell'invio reale.
5. **Condizioni**: far rivedere a un legale Termini, Privacy, Cookie e predisporre il DPA; poi togliere il riquadro «Bozza».
6. **Email**: creare le caselle aziendali (PEC, privacy, amministrazione) e allineare gli indirizzi nel prodotto (punto 8 sopra); verificare il dominio mittente (SPF/DKIM) con la ragione sociale reale.
7. **Google / Channex / portali PA**: aggiornare l'intestatario dove richiesto (Google Business, account Channex, referente Alloggiati/ISTAT per l'azienda), quando serve.
8. **Banca e contabilità**: conto aziendale, collegamento a Stripe per i payout, commercialista per la contabilità dell'abbonamento (IVA 22%, gli importi in app sono IVA inclusa).
9. **Registro dei trattamenti e nomina DPO** solo se applicabile; registrare il marchio «Xenora» se si vuole proteggerlo.
10. Dopo tutto, aggiornare le date «Ultimo aggiornamento» delle tre pagine legali.
