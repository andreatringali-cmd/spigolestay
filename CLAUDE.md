# SpigoleStay — PMS + Channel Manager

> Memoria del progetto tra una sessione e l'altra. Tienilo aggiornato ad ogni passo.
> Brief originale completo: `C:\Users\pcimp\Desktop\prompt-claude-code.md`.

## Descrizione

PMS (Property Management System) con channel manager per affitti brevi a Siracusa.
Sostituisce Octorate. **5 strutture, ~12 unità**, due gruppi: **Spigole Rooms** e **Central Perk**.

- **Fase 1 (ora): solo per il proprietario.** Un tenant, un utente owner + una addetta alle pulizie con accesso limitato.
- **Fase 2 (~ago 2027): prodotto vendibile ad altri host italiani.** Per questo il DB è **multi-tenant dal giorno uno**: `tenant_id` ovunque + Row Level Security su Supabase, anche se per un anno la tabella `tenants` avrà una sola riga. Niente riscritture di schema dopo.

**Fuori scopo — non proporre:** fatturazione elettronica, SdI, documenti fiscali. Si registrano solo gli incassi; la fatturazione resta al commercialista.

L'utente non è sviluppatore ma capisce l'architettura: **spiegare le decisioni, non nasconderle.**

## Stack

- Next.js (App Router) + TypeScript
- Supabase: Postgres, Auth, RLS, Storage — **progetto Supabase NUOVO**, non riusare quello del gestionale Improving System
- Tailwind
- Stripe (pagamenti diretti + payment link) — chiavi in modalità test
- **Channex.io** come layer di connettività OTA (REST + webhook) — NON iCal grezzo
- Deploy su Vercel
- Connettore MCP Supabase attivo: usarlo per creare migration e verificare lo schema (non far copiare SQL a mano)

## Le sei decisioni di modello dati (NON rimetterle in discussione)

1. **Tipologie ≠ unità.** Si vendono tipologie (Camera matrimoniale, tripla, Appartamento); si assegnano unità fisiche (Allegra, Sette, Ortigia, Aretusa, Loft Marina, Studio Duomo, Maniace). Disponibilità OTA calcolata per tipologia; assegnazione unità interna e modificabile fino al check-in. Una prenotazione può esistere senza unità assegnata.
2. **Il conto è un registro contabile (folio), non un campo prezzo.** Righe: soggiorno/notte, pulizia, extra, tassa soggiorno, commissione canale, pagamenti, rimborsi. Il totale è sempre somma di righe. Ogni riga è **immutabile**: la correzione è una riga di storno, mai un UPDATE.
3. **Tassa di soggiorno = partita di giro, non ricavo.** Riga separata, esclusa da ADR/RevPAR e da ogni metrica di fatturato. Regole Comune di Siracusa: max 3 notti consecutive per persona, minori esenti, importo a persona/notte **configurabile in tabella** (non hardcodato).
4. **"Netto" = margine di contribuzione** = lordo − commissioni canale − costo pulizia. NON è utile fiscale. Etichettarlo così ovunque.
5. **Ritenuta Airbnb 21% = acconto, non costo.** Tracciata in un campo/riga suo, separata dalle commissioni.
6. **La verità è il mio database.** La disponibilità si ricalcola sempre dalle prenotazioni interne, mai da ciò che dice un canale. I canali ricevono, non dettano.

## Ordine di costruzione (non saltare; ogni passo usabile prima del successivo)

1. Schema DB completo + RLS + seed (strutture reali + dati finti realistici nel seed)
2. Tape chart (calendario a nastro) in sola lettura
3. Scheda prenotazione + folio (creazione/modifica manuale)
4. Drag & drop prenotazioni tra unità e date
5. Tariffe e restrizioni (striscia prezzi, modifica singola e in blocco)
6. Integrazione Channex (prima read-only su una struttura, poi bidirezionale)
7. Adempimenti (Alloggiati Web, tassa soggiorno, ISTAT, controllo CIN)
8. Pulizie (vista mobile per l'addetta, stati camera)
9. Messaggi (casella unificata, modelli, automazioni)
10. Motore di prenotazione diretto + Stripe

Fermarsi dopo ogni passo e far provare.

## Design token (replicare, non inventare)

**Colori**
```
--paper #FBFBFC  sfondo app     --white #FFFFFF superfici    --wash #F3F4F8 intestazioni/secondario
--line  #E9EBF1  bordi          --txt   #141926 testo 1      --dim  #6B7488 testo 2
--faint #98A0B0  testo 3        --focus #3F5BD9 accento/selezione
```
**Canali** — Booking `#1E5BD6` · Airbnb `#E85A61` · Expedia `#D99A24` · Diretto `#12A57C`
**Stati** — ok `#0B7256` · attenzione `#8A5A12` · errore `#B3383E` (ogni stato ha anche forma/etichetta, mai solo colore)
**Font** — Archivo (titoli/numeri grandi, 700/800, letter-spacing negativo) · Inter (testo) · JetBrains Mono (date, prezzi, codici). Numeri sempre `font-variant-numeric: tabular-nums`.

**Calendario**
- Colonna giorno 78px (compatta) / 112px (comoda); riga unità 44px / 70px. Densità = preferenza salvata per utente.
- Barre: arrotondamento 10px, ombra bassa, nome + notti + prezzo.
- ≤3 notti: niente riga prezzo. 1 notte: solo pastiglia quadrata con iniziali su colore pieno canale, niente testo.
- Tutti i dettagli nella scheda che si apre al tocco — comportamento identico per tutte le prenotazioni.
- Striscia tariffe e striscia disponibilità agganciate sotto le date, sticky allo scroll delle unità.
- Colonna oggi con bordo `--focus`; weekend sfondo leggermente più scuro.
- Rosso = "esaurito" e basta. Stop vendite = tratteggio grigio. Manutenzione = tratteggio ambra. Mai lo stesso colore per due significati (errore di Octorate).

**Drag & drop** — pointer events (desktop + touch). Durante: riga destinazione evidenziata, fantasma tratteggiato agganciato alla griglia, badge con destinazione/date sotto il cursore. Destinazione occupata o capienza insufficiente → fantasma rosso + badge col motivo. Al rilascio: toast con **Annulla** (lo spostamento fa ripartire la sync).

Niente librerie di componenti pesanti. Niente localStorage.

## Regole di lavoro

- **Niente codice prima del piano.** Per ogni passo: cosa costruisco, quali file tocco, quali decisioni restano aperte. Aspettare l'ok.
- **Una domanda alla volta** quando qualcosa non è chiaro.
- **Dire quando l'utente sbaglia** se una richiesta complica il sistema senza valore.
- **Niente dati finti nel codice di produzione.** I seed stanno in `supabase/seed.sql`, separati.
- **Commenti in italiano** per le regole di business (tassa soggiorno, disponibilità, adempimenti); il resto in inglese.

## Stato

- **2026-08-12 (prototipo UI)** — Su richiesta dell'utente costruito un PROTOTIPO front-end completo multi-pagina (dati finti in `src/lib/mock-data.ts` + store in memoria `src/lib/store.tsx`, NON Supabase). App multi-pagina App Router con route group `(app)` + `/login`. Shell con doppio layout (menu in alto / sidebar) e doppio tema (chiaro/scuro) via token CSS (`globals.css`), font Archivo/Inter/JetBrains. Sezioni fatte: Login, Dashboard, Calendario (tape chart: drag&drop sposta prenotazioni, mezza cella arrivi/partenze, striscia tariffa+disponibilità, fuori servizio, click→scheda), Prenotazioni (filtri+card+mini-grafico), Tariffe, Canali (mappatura OTA+prezzo per OTA), Statistiche (card+grafici), Ospiti, Pulizie (board), Messaggi (email+WhatsApp, template multilingua), Alloggiati, Tassa soggiorno, Strutture (aggiungi struttura/tipologia/unità), Utenti+permessi, Impostazioni, Abbonamento. Widget assistenza in basso a dx. Formato € manuale (ICU runtime non raggruppa). Gira in locale su :3000. DA FARE ancora (idee migliori CM): motore prenotazioni diretto, recensioni, report/export, check-in online, prezzi dinamici/smart pricing, casella messaggi unificata, personalizzazione calendario (densità/icone). Il tutto è UI: manca il backend reale (schema SQL già pronto in `supabase/`).
- **2026-08-12** — Ricevuto il brief. Creato questo CLAUDE.md. Schema DB (Passo 1) proposto e **approvato** (con le 3 raccomandazioni: RLS via claim JWT, ritenuta Airbnb come riga di folio con flag, `booking_guests` da subito). Progetto Supabase **non ancora creato** (utente ha scelto di aspettare; costo 10 $/mese). Migration + seed scritti come file pronti in `supabase/` (0001→0008 + `seed.sql`). Aperto: mappa reale delle 5 strutture/gruppi/tipologie/unità per finalizzare il seed (ora placeholder).
- Nota: esisteva un mock rapido "SpigoleStay" (calendario con dati finti in `src/lib/mock-data.ts` + `src/components/*`, `src/app/page.tsx`). **Superato** dal progetto reale; verrà rimosso quando si costruisce il tape chart (Passo 2). I dati finti NON andranno in produzione.
