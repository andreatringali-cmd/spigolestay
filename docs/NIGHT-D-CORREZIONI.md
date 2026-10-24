# Night D: correzioni dopo la revisione indipendente

Branch `agent/d-fixes` = `main` (8e372c07) + `night/D` (d325be32) + le correzioni qui sotto. Tutte le deduzioni del revisore sono state verificate nel codice prima di correggere.

## Esito punto per punto

### D1 (guida: campi della struttura vuoti svuotano la guida) - CONFERMATO, CORRETTO
- Causa: nella pagina Guida ospiti `Object.keys(structFields)` contiene sempre tutte le chiavi, anche con valore `""`: con la struttura esistente ma con i campi vuoti ogni chiave era «esplicita» e `protectGuideWrite` non proteggeva nulla.
- Fatto: nuova funzione pura `structExplicitKeys()` in `src/lib/guide-protect.ts` (chiavi con valore non vuoto; per `social` solo le sotto-chiavi piene, es. `social.instagram`). La pagina la usa al posto di `Object.keys(structFields)`.
- Effetto: un dato struttura pieno continua a seguire le Impostazioni struttura (anche se cambia); un dato struttura vuoto NON svuota più il campo pieno della guida.
- Test (`tests/guide-protect.test.ts`): struttura con tutti i campi vuoti + guida piena (`restored` contiene phone, email, mapsUrl...; il vecchio calcolo viene dimostrato difettoso nello stesso test); struttura con campi misti; controllo sul testo della pagina.
- Cosa resta / effetto collaterale accettato: se il titolare toglie DI PROPOSITO il telefono (o email, social...) nelle Impostazioni struttura, quel campo nella guida non si svuota da solo (va tolto dalla pagina Guida). È il compromesso voluto: «mai pieno -> vuoto senza azione esplicita».

### D2 (logout con marcatore assente non svuota il locale) - CONFERMATO, CORRETTO
- Causa: `!(uid && localIsForeign(uid))`; `localIsForeign` è vero anche a marcatore assente.
- Fatto: `shouldWipeOnSignOut(owner, uid)` in `src/lib/sync-owner.ts`: salta lo svuotamento SOLO se il marcatore è di un ALTRO uid non nullo (`ownedByOther`). `signOut` in `authsync.tsx` la usa.
- Test (`tests/sync-two-tabs.test.ts`): nella scheda finta il logout con marcatore assente prima non svuotava (modo «start»), ora sì; con marcatore di B non svuota in nessuno dei due; con marcatore proprio svuota; tabella di verità della funzione. Aggiornato anche il controllo sul testo in `tests/owner-guards.test.ts`.
- Rischio residuo minimo (documentato): se il logout di A avviene proprio nella breve finestra in cui B ha svuotato il locale ma non ha ancora scritto il marcatore, lo svuotamento di A toglie le chiavi che B stava ricostruendo; B le riscrive comunque dal server (e il marcatore lo mette B dopo).

### D3 (restore dopo la sincronizzazione iniziale senza ricontrollo) - CONFERMATO, CORRETTO
- Causa: in idratazione la guardia di scrittura è spenta; `deltaStartupSync`, `prepareDeltaMode` (e, dello stesso tipo, la scorciatoia non-delta di `authsync.tsx`) chiamavano `restore(newBlob)` e `commitSyncBase` dopo `await syncOnce` senza ricontrollare il proprietario.
- Fatto:
  - `restore(data, uid?)`: con `uid` esce (false, senza avviso «spazio esaurito») se `localIsForeign(uid)`; avvisa la scheda («in pausa»).
  - nuova `commitSyncBaseIfMine(uid, last)`: non scrive la base se il locale non è più di `uid`.
  - `deltaStartupSync`, `prepareDeltaMode`, scorciatoia: ricontrollo `r.foreign || localIsForeign(uid)` dopo il sync e prima di restore/base.
  - Se il locale è passato a un altro account durante la sincronizzazione iniziale, l'idratazione NON prosegue (né mostra l'app sui dati altrui): scheda in pausa con avviso bloccante (vedi D5). In particolare dopo `prepareDeltaMode`, se il marcatore è di un altro account (`localOwnedByOtherNow`), il flusso si ferma prima di `readServer`/fusione: altrimenti la fusione avrebbe preso lo snapshot del locale di B e lo avrebbe scritto sul server di A.
- Test: metodo `startupSync` della scheda finta con `enter()` dell'altro account durante la rete. Senza ricontrollo (modo «start») i dati di A finiscono nel locale di B, la base persistente di B è sovrascritta e poi i dati di A arrivano sul server di B; con il ricontrollo (modo «full») nulla di tutto ciò. Più controlli sul testo di `authsync.tsx` (`tests/owner-guards.test.ts`).
- Limite: `authsync.tsx` (componente React con rete) non è eseguibile nei test unitari; la logica è provata con la scheda finta che ripete i passi e con controlli sul testo del sorgente. Vedi prove manuali.
- Non coperto (prima c'era già, fuori dal perimetro del revisore): i molti `await` del flusso di idratazione completa (`readServer`, `writeWithLock`) tra `wipeLocalAccount` e `markLocalOwner`; la finestra con marcatore assente resta quella.

### D4 (coda write-behind di IndexedDB scaricata dopo lo scambio di account) - CONFERMATO, CORRETTO
- Fatto: in `src/lib/bigstore.ts` `runFlush` chiama `dropBlocked()` prima di ogni `idbWrite` (anche nel secondo tentativo): rivaluta `writeGuard` chiave per chiave e scarta dalla coda le voci (scritture e cancellazioni) bloccate.
- Test vero (`tests/bigstore-guard.test.ts`, nuovo): IndexedDB finto condiviso; scrittura in coda con guardia aperta, poi la guardia scatta e «un'altra scheda» scrive i suoi dati; dopo `kvFlush()` i dati dell'altro account sono intatti. Idem per una cancellazione in coda. Verificato che i due test falliscono togliendo la correzione. Più un test che dopo la riapertura della guardia le nuove scritture passano.

### D5 (scheda in pausa usabile; marcatore nullo) - CORREZIONE PARZIALE (la parte sicura)
- Fatto:
  - Il banner non bloccante è sostituito da una finestra modale a tutto schermo (`OtherAccountOverlay`, `role="alertdialog"`, `aria-modal`, unico pulsante «Ricarica la pagina»). Compare anche se l'idratazione è stata interrotta (prima dell'app). Si toglie da sola se il marcatore torna quello giusto (`runSync` ogni 4 s).
  - Il messaggio distingue i due casi tramite `writeBlockReason()` (`"other"` = marcatore di un altro account; `"unknown"` = marcatore assente: testo neutro che parla di dati non più collegati all'account, senza accusare «un altro account»). L'evento `xenora:other-account` porta il motivo (`CustomEvent`).
- NON fatto, di proposito: «con marcatore nullo non bloccare e riscrivere il marcatore». Il marcatore nullo è anche la finestra in cui un'altra scheda (B) ha svuotato il locale e lo sta ricostruendo (`restore` -> eventuale `writeWithLock` -> `markLocalOwner`). Se la scheda di A riscrivesse il marcatore come proprio in quel momento, il suo `runSync` fotograferebbe i dati di B appena ripristinati e li porterebbe sul server di A (è proprio la perdita tra account che D vuole evitare). La scheda con marcatore nullo quindi resta in pausa, ma ora con un avviso chiaro e una sola azione che risolve (ricarica: `decideEntry` con marcatore assente + flag di sessione prende la scorciatoia e ripristina il marcatore in modo sicuro).
- Cosa resta: il caso «eviction del localStorage» costringe a una ricarica invece di proseguire in silenzio. Per eliminarla davvero servirebbe poter distinguere con certezza «ripulito dal browser» da «altra scheda in ricostruzione» (es. un contatore/heartbeat condiviso scritto dall'idratazione di B), da valutare come lavoro a parte. L'overlay blocca le interazioni ma non salva le modifiche già fatte prima dell'avviso (quelle scritte con guardia attiva sono già state scartate).

### D6 (limiti noti, solo annotati)
- Il merge delle guide non permette di ELIMINARE o SVUOTARE una guida da un secondo dispositivo: un campo pieno non diventa vuoto per fusione (3+ campi, `content` o `i18n` vengono rimessi dal perdente). Per cancellare/azzerare serve farlo dallo stesso dispositivo, oppure aggiungere in futuro un'azione esplicita con «lapide» sincronizzata.
- `content` di due schede (stessa guida modificata in contemporanea da due dispositivi) si sovrascrive in blocco: vince una delle due, l'altra è persa (protetto solo dal «mai pieno -> vuoto»).

## Prove MANUALI a due schede (da fare prima di pubblicare)
Stesso browser, due schede, due account di prova (A e B), account non di produzione se possibile.
1. Entra con A in scheda 1, lasciala aperta e in secondo piano. In scheda 2 esci e accedi con B. Torna in scheda 1: deve comparire la finestra «Questa scheda è in pausa» che copre la pagina; dopo «Ricarica la pagina» si deve vedere il login/account corretto. Verifica che in scheda 2 (B) non compaiano impostazioni di A (pulizie, registro invii, cassa, guida).
2. Come 1, ma in scheda 1 prima di cambiare account apri Guida ospiti e fai una modifica; poi cambia account in scheda 2: la modifica di A non deve comparire nei dati di B (ne' nel server di B: controllare dopo qualche minuto da un altro dispositivo con B).
3. (D3) Con A, chiudi tutto, riapri l'app e MENTRE carica («Carico i tuoi dati…»; meglio con rete lenta dalle DevTools: throttling) accedi con B in un'altra scheda. La scheda di A deve fermarsi con l'avviso di pausa, non mostrare i dati di B come se fossero di A; B deve vedere solo i suoi dati. Ripetere con la modalità veloce accesa e spenta (account in allowlist).
4. (D4) Con A modifica una prenotazione e, entro 1 secondo, cambia account in un'altra scheda con B (scrittura in coda). Ricarica B: i dati di B (prenotazioni) devono essere quelli di B, intatti.
5. (D2) Con A esci dall'app (logout) dopo aver cancellato a mano la chiave `spigolestay:localowner` (DevTools -> Application -> Local Storage): dopo l'uscita il locale (chiavi `spigolestay:*`) deve essere vuoto. Poi con A esci mentre in un'altra scheda è entrato B: i dati di B devono restare.
6. (D5) Con A cancella a mano la chiave del marcatore in Local Storage mentre l'app è aperta e prova a modificare qualcosa: compare la finestra con il testo neutro («non risultano più collegati al tuo account»), «Ricarica» riporta all'app con i dati di A.
7. (D1) Guida ospiti di una struttura con telefono, email, Instagram, link mappa pieni: svuota nelle Impostazioni struttura telefono ed email, ricarica la pagina Guida: i campi della guida devono restare pieni (e nell'anteprima / link pubblico).
8. Stesso account in due schede: nessun avviso, modifiche fatte in una compaiono nell'altra dopo la sincronizzazione.

## Test
`node --test "tests/**/*.test.ts"`: 2103 test, 2100 passati, 0 falliti, 3 «todo» (stessi di prima); `npx tsc --noEmit` pulito (dopo `npx next typegen` nel worktree). Baseline main+D: 2090. Nuovi: +3 guide-protect, +4 bigstore-guard, +4 sync-two-tabs, +2 owner-guards.
