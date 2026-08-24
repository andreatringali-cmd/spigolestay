# Modulo Guida Ospiti — codice pronto da integrare in SpigoleStay

Questa cartella contiene una **guida ospiti multilingua completa e già in produzione**
(HTML + JavaScript vanilla + CSS, nessun framework). Il motore di rendering è
collaudato: **non va riscritto**. Va riusato e reso multi-tenant.

## Cosa c'è qui

| File | Cos'è | Come usarlo in SpigoleStay |
|---|---|---|
| `js/app.js` | **Il motore.** Rendering sezioni, multilingua, link ospite personalizzato, mappe con scelta Google/Apple, avvisi a scadenza, testo ricco (`[[evidenziato]]`, `[i]corsivo[/i]`, `[u]sottolineato[/u]`), filtri per camera. | **Riusa quasi as-is.** Legge da due globali: `window.PROPERTY` (dati struttura) e `window.I18N` (contenuti per lingua). Oggi arrivano da file statici; nel channel manager vanno popolati da API/DB. |
| `css/styles.css` | **Lo stile completo.** Mobile-first, tema chiaro. | Riusa as-is. |
| `index.html` | Struttura pagina + PWA (welcome/scelta lingua, contenitore). | Usa come template della pagina pubblica della guida. |
| `js/content/{it,en,fr,de,es}.js` | **Contenuti reali (ATSV/Siracusa) in 5 lingue.** Sono l'**esempio concreto dello schema dati** + le **stringhe UI tradotte** (etichette "Indietro", "WiFi", "Emergenze"…). | Le stringhe UI (`ui:`) sono riusabili in ogni guida. I contenuti città sono l'esempio: nel prodotto diventano dati inseriti dall'host. |
| `js/content/config.js` | Configurazione delle 2 strutture (nome, WiFi, codici, foto, tipologie camere…). | **Da sostituire:** è ciò che nel multi-tenant diventa un record "guida" per proprietà, letto dal DB. |
| `assets/` | Loghi, icone, foto d'esempio. | Le foto sono esempi (dati dell'host); i loghi/icone sono template. |

## Come funziona (per capire cosa riusare)

- La pagina carica `config.js` → `content/*.js` → `app.js`. `app.js` costruisce la
  guida leggendo `window.PROPERTY` (la struttura scelta) e `window.I18N[lingua]`.
- **Link ospite personalizzato:** `?p=<idStruttura>&c=<camera>&k=<codici>&pk=<parcheggio>&d=<linkEsterno>&tax=<metodo>`.
  All'apertura, `app.js` salva questi dati su `localStorage` e ripulisce l'URL (i
  codici delle serrature non restano nella barra indirizzi). Vedi l'IIFE in cima ad `app.js`.
- I codici d'ingresso **viaggiano nel link, non nel database pubblico** — importante per
  la sicurezza: la guida generica non deve mai esporre i codici.
- Personalizzazioni per camera già implementate: numero camera nei testi, codice giusto
  per la cassetta della camera, servizi mostrati solo per certe camere (es. macchina caffè),
  avvisi temporanei con `notice:{ until, text }` che spariscono da soli dopo la data.

## Schema dati (il modello per DB + pannello di personalizzazione)

Una **guida** = una **proprietà** con:

```
proprietà: {
  id, nome, logo, città, indirizzo,
  contatti: { telefono, whatsapp, email },
  reviewUrl, social: { instagram, facebook, website },
  wifi: { rete, password, qr? },
  checkin: {
    orari: { checkin, checkout },
    passi: [ { titolo, testo, codiceCassetta?, azioni?[{etichetta, tipo, href, icona}], soloCamere?, eccettoCamere? } ],
    serviziCamera: [ { icona, etichetta, soloCamere? } ],
    fotoCamere: [ url ]
  },
  colazione: { testo, locali?[{nome, indirizzo, mappa, giorniChiusura}] },
  sezioniCittà: [                       // inserite dall'host, per la SUA città
    { id, titolo, testo?, voci?[{ nome, indirizzo, telefono, mappa }], azioni? }
  ],                                    // ristoranti, attrazioni, trasporti, info utili
  extra: [ { titolo, waText } ],        // upsell: pulsanti WhatsApp precompilati (facoltativo)
  faq: [ { domanda, risposta } ],
  avvisi: [ { testo, until } ]          // temporanei, spariscono dopo la data
}
```

I **contenuti multilingua**: oggi sono 5 file tradotti a mano. Per un prodotto dove
l'host crea la guida, valuta la **traduzione automatica** dei contenuti dell'host
(le stringhe UI restano pre-tradotte, vedi `ui:` nei file content).

## Cosa costruire ATTORNO (la parte nuova)

1. **Persistenza multi-tenant:** una guida per proprietà nel DB del channel manager,
   legata all'utente. Ogni host vede solo le sue.
2. **Pannello di personalizzazione** (back-end): form che compila lo schema sopra, con
   anteprima live. Sostituisce `config.js`/`content` con dati editabili.
3. **API che serve i dati alla guida pubblica:** invece dei file statici, `app.js` riceve
   `window.PROPERTY` e `window.I18N` da un endpoint (per `?p=<idProprietà>`).
4. **Generatore di link ospite** (già esistente come logica: vedi come si compone `k=` per
   i codici e i filtri camera): dato camera/e → produce il link da inviare.
5. **Anteprima social lato server:** meta tag per proprietà, così il link condiviso su
   WhatsApp mostra nome e foto della struttura giusta.

## Cosa NON portare

Pulizie, preventivi/conferme, archivio, contabilità: non fanno parte di questo modulo.
Qui c'è **solo la guida**.
