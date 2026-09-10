// ============================================================
//  CONTENUTI IN ITALIANO
//  I segnaposto tipo {whatsapp} vengono sostituiti
//  automaticamente con i valori di config.js
// ============================================================

window.I18N = window.I18N || {};

window.I18N.it = {
  ui: {
    back: "Indietro",
    footer: "Vi auguriamo un meraviglioso soggiorno!",
    copy: "Copia password",
    copied: "Password copiata!",
    wifiNetwork: "Rete",
    wifiPassword: "Password",
    quickWifi: "WiFi",
    quickWhatsapp: "WhatsApp",
    quickMap: "Mappa",
    quickEmergency: "Emergenze",
    codeSuffix: "+ il tasto centrale",
    codeMissing: "Il codice arriva con il link personale che vi mandiamo prima dell'arrivo. Se non lo trovate, scriveteci pure.",
    footerSocial: "Seguiteci e rimanete in contatto con noi",
    wifiQrHint: "Scorri per il QR ›",
    wifiQrCaption: "Scan me"
  },

  home: {
    title: "La vostra guida",
    subtitle: "Tutto quello che vi serve, dall'arrivo alla partenza.",
    welcomeTitle: "Benvenuti,",
    welcome: [
      "siamo davvero felici di accogliervi!",
      "Questa guida vi aiuterà a scoprire la città e a vivere al meglio il vostro soggiorno. Il nostro team è a vostra disposizione per ogni necessità.",
      "Buona permanenza!"
    ]
  },

  groups: [
    { title: "Il vostro arrivo", sections: ["checkin", "breakfast", "wifi"] },
    { title: "Scoprire Siracusa", sections: ["attractions", "restaurants", "excursions"] },
    { title: "Servizi utili", sections: ["taxi", "info", "faq", "extras", "contacts", "review"] }
  ],

  // Sezioni specifiche per struttura (override). Le sezioni non elencate
  // qui restano condivise (contenuti città uguali per tutti).
  sectionsByProperty: {
    centralperk: {
      checkin: {
        id: "checkin", icon: "key",
        title: "Arrivo e Self Check-in",
        sub: "Come entrare al B&B Central Perk",
        intro: "Potete arrivare in piena libertà. Ecco come entrare al Central Perk.",
        steps: [
          { h: "Dove siamo", p: "Central Perk — Via Antioco 13, una traversa del Corso Gelone, all'altezza della banca UniCredit (Corso Gelone 30).", actions: [{ label: "Central Perk", href: "{mapsUrl}", icon: "pin" }] },
          { h: "Aprite il portone", p: "Alla sinistra del portone c'è una cassetta di sicurezza nera e grigia: digitate il codice qui sotto, prendete la chiave e aprite il portone. Poi rimettete la chiave al suo posto, per favore.", codeKey: "gateCode", codeAfter: "#" },
          { h: "Salite al B&B", p: "Una volta dentro, salite le scale e girate a destra: in fondo sulla destra c'è la porta d'ingresso del B&B. Tra le due porte trovate due cassette di sicurezza." },
          { h: "Le vostre chiavi — camera 1", p: "Aprite la cassetta [[in alto]] con il codice qui sotto e prendete il vostro mazzo di chiavi. La vostra camera, la numero 1, è proprio lì.", codeKey: "doorCode", codeAfter: "#", onlyRooms: ["1"] },
          { h: "Le vostre chiavi — camere 2, 3 e 4", hPersonal: "Le vostre chiavi — camera {roomNums}", hPersonalPlural: "Le vostre chiavi — camere {roomNums}", p: "Aprite la cassetta [[in basso]] con il codice qui sotto, usate la chiave per aprire la porta d'ingresso e poi rimettetela nella cassetta, per favore. Il vostro mazzo di chiavi è appeso alla porta della vostra camera: la chiave con l'impugnatura nera è per la porta d'ingresso, la terza per il portone di sotto.", pPersonal: "Aprite la cassetta [[in basso]] con il codice qui sotto, usate la chiave per aprire la porta d'ingresso e poi rimettetela nella cassetta, per favore. La vostra camera è la numero {roomNum}: il vostro mazzo di chiavi è appeso alla sua porta. La chiave con l'impugnatura nera è per la porta d'ingresso, la terza per il portone di sotto.", pPersonalPlural: "Aprite la cassetta [[in basso]] con il codice qui sotto, usate la chiave per aprire la porta d'ingresso e poi rimettetela nella cassetta, per favore. Le vostre camere sono {roomNum}: ogni mazzo di chiavi è appeso alla porta della camera corrispondente. La chiave con l'impugnatura nera è per la porta d'ingresso, la terza per il portone di sotto.", codeKey: "doorCode2", codeAfter: "#", exceptRooms: ["1"] },
          { h: "Fatemi sapere", p: "Mandatemi un messaggio quando arrivate in camera e ditemi se è tutto ok. Per qualsiasi necessità, richiesta o informazione scrivetemi a qualsiasi ora, qui su WhatsApp.", actions: [{ label: "Scrivici su WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ],
        amenitiesTitle: "I servizi della vostra camera",
        amenitiesIntro: "Abbiamo curato ogni dettaglio per rendere il vostro riposo perfetto.",
        amenities: [
          { icon: "snow", label: "Aria condizionata" },
          { icon: "tv", label: "Smart TV" },
          { icon: "sparkle", label: "Set di cortesia" },
          { icon: "wind", label: "Asciugacapelli" },
          { icon: "towel", label: "Biancheria fresca" },
          { icon: "balcony", label: "Balcone privato" }, { icon: "coffee", label: "Macchina del caffè", onlyRooms: ["3", "4"] }
        ],
        gallery: true,
        items: [
          { h: "Cucina comune e caffè", p: "Nella hall avete una piccola cucina comune, a disposizione di tutti: frigorifero, bollitore, forno a microonde, distributore d'acqua naturale e frizzante e una macchina del caffè. Il caffè è di nostra produzione, provatelo pure!" },
          { h: "Parcheggio", p: "Il parcheggio si trova facilmente in strada nei pressi del B&B ed è gratuito. In alternativa, a 50 metri c'è un parcheggio privato a pagamento, il \"Parcheggio Gelone\".", actions: [{ label: "Parcheggio Gelone", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Gelone+Siracusa", icon: "parking" }] },
          { h: "Documenti", p: "Per la registrazione ci servono i documenti di tutti gli ospiti: basta una foto fronte e retro su WhatsApp, anche prima dell'arrivo.", pIf: { docsUrl: "Per la registrazione ci servono i documenti di tutti gli ospiti: potete [[caricarli voi stessi]] sul portale, col pulsante qui sotto. Si fa in un attimo, anche prima dell'arrivo, e non dovete mandarci nient'altro." }, actions: [{ label: "Carica i documenti", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Invia i documenti", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
          { h: "Check-out e tassa di soggiorno", p: "Check-out {checkoutTime}. La tassa di soggiorno di Siracusa è pari al 4% del costo del soggiorno, con un massimo di 5 € a persona per notte e per le prime 7 notti. I minori di 14 anni non pagano: potete lasciarla in camera. Grazie!", pIf: { taxFixed: "Check-out {checkoutTime}. La tassa di soggiorno di Siracusa è di circa 2 € a persona per notte, per le prime 7 notti. I minori di 14 anni non pagano: potete lasciarla in camera. Grazie!" } },
          { h: "Non si fuma 🚭", p: "È vietato fumare all'interno del B&B e delle camere. Grazie per la collaborazione!" }
        ]
      },
      breakfast: {
        id: "breakfast", icon: "coffee",
        title: "La vostra colazione",
        sub: "Nei bar convenzionati qui vicino, con i voucher",
        intro: "La colazione è servita nei bar convenzionati qui vicino, dalle 7:00 fino a quando volete. Trovate i voucher sulla scrivania o sul comodino della vostra camera.",
        steps: [
          { h: "Tutti i giorni (tranne sabato) — Milk and Coffee", p: "Corso Gelone 22, esattamente sotto la struttura.", notice: { until: "2026-08-08", text: "🌴 Chiuso per ferie dal 25 luglio all'8 agosto: in questo periodo la colazione è al [[Bar Euripide]] (Piazza Euripide 25)." }, actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=Milk+and+Coffee+Corso+Gelone+Siracusa", icon: "pin" }] },
          { h: "Sabato — Bar Euripide", p: "Piazza Euripide 25, a tre minuti a piedi.", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=Bar+Euripide+Piazza+Euripide+Siracusa", icon: "pin" }] }
        ]
      },
      contacts: {
        id: "contacts", icon: "phone",
        title: "Contatti",
        sub: "Siamo sempre a disposizione",
        items: [
          { h: "WhatsApp, Telegram, Viber", p: "Il modo più veloce per raggiungerci.", actions: [{ label: "Apri WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
          { h: "Telefono", p: "Per urgenze e comunicazioni rapide.", actions: [{ label: "Chiama", href: "{phone}", type: "tel", icon: "phone", onlyIf: "phone" }, { label: "Altro numero", href: "{phoneGreta}", type: "tel", icon: "phone", onlyIf: "phoneGreta" }] },
          { h: "Email", p: "{email}", actions: [{ label: "Scrivi una email", href: "{email}", type: "mail", icon: "info" }] },
          { h: "Tornate a trovarci!", p: "Prenotate direttamente per i prossimi soggiorni: agli ospiti che ritornano riserviamo sempre il miglior trattamento possibile.", actions: [{ label: "Prenota su WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ]
      }
    }
  },

  sections: [
    {
      id: "checkin", icon: "key",
      title: "Arrivo e Self Check-in",
      sub: "Come raggiungerci ed entrare nella vostra camera",
      gallery: true,
      intro: "Potete arrivare in piena libertà a partire dalle 15.00.",
      steps: [
        { h: "Dove siamo", p: "{address}. Ci trovate subito dopo la chiesa di Santa Rita, sulla destra (cancello grigio).", actions: [{ label: "B&B Spigolehouse", href: "{mapsUrl}", icon: "pin" }] },
        { h: "Parcheggio", p: "Avete il posto auto riservato nel cortile interno. Per accedere al cortile digitate il codice sul tastierino sotto il citofono e premete il tasto centrale. I posti non sono assegnati: parcheggiate dove preferite negli spazi delimitati.", codeKey: "gateCode", parkOnly: true },
        { h: "Parcheggio", p: "Dalla vostra prenotazione risulta che non avete prenotato il parcheggio. Se vi serve, contattateci per verificare la disponibilità: il costo è di 6 € a notte.", actions: [{ label: "Contattaci su WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }], noParkOnly: true },
        { h: "Ingresso pedonale", p: "Per entrare a piedi, digitate il codice sul tastierino sotto il citofono e premete il tasto centrale.", codeKey: "doorCode", noParkOnly: true },
        { h: "Accesso ai piani", p: "Per il portone interno e il key box al vostro piano, digitate il codice seguito dai 2 tasti laterali.", codeKey: "doorCode", codeSuffix: "+ i 2 tasti laterali" },
        { h: "Benvenuti in camera!", p: "Troverete le chiavi appese direttamente alla porta della vostra camera. Sistematevi e rilassatevi!", pPersonal: "La vostra camera è la numero {roomNum}: troverete le chiavi appese direttamente alla porta. Sistematevi e rilassatevi!", pPersonalPlural: "Le vostre camere sono {roomNum}: troverete le chiavi appese direttamente a ciascuna porta. Sistematevi e rilassatevi!" }
      ],
      amenitiesTitle: "I servizi della vostra camera",
      amenitiesIntro: "Abbiamo curato ogni dettaglio per rendere il vostro riposo perfetto.",
      amenities: [
        { icon: "snow", label: "Aria condizionata" },
        { icon: "tv", label: "Smart TV" },
        { icon: "sparkle", label: "Set di cortesia" },
        { icon: "coffee", label: "Macchina del caffè" },
        { icon: "wind", label: "Asciugacapelli" },
        { icon: "towel", label: "Biancheria fresca" },
        { icon: "iron", label: "Ferro da stiro" },
        { icon: "balcony", label: "Balcone privato" }
      ],
      items: [
        { h: "Colazione e area comune", p: "Al piano avete un'area comune con frigo, dispenser d'acqua e macchina del caffè. Sulla scrivania vi attendono i voucher per la vostra colazione: toccate qui per scoprire dove e come.", actions: [{ label: "Vai alla colazione", href: "#/breakfast", icon: "coffee" }] },
        { h: "Riassetto della camera 🌿", p: "La camera viene riordinata e la biancheria cambiata ogni due giorni: una scelta pensata per non sprecare l'acqua, un bene prezioso, e per rispettare l'ambiente e l'isola che vi ospita. Se gli asciugamani vanno ancora bene, riappendeteli: li cambiamo solo quando li lasciate nella doccia o nel lavandino. E se prima vi serve qualcosa — asciugamani puliti o un riassetto extra — scriveteci pure, senza problemi. Grazie!", actions: [{ label: "Scrivici su WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Documenti", p: "Per la registrazione ci servono i documenti di tutti gli ospiti: basta una foto fronte e retro, anche qui su WhatsApp, pure prima dell'arrivo.", pIf: { docsUrl: "Per la registrazione ci servono i documenti di tutti gli ospiti: potete [[caricarli voi stessi]] sul portale, col pulsante qui sotto. Si fa in un attimo, anche prima dell'arrivo, e non dovete mandarci nient'altro." }, actions: [{ label: "Carica i documenti", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Invia i documenti", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
        { h: "Check-out e tassa di soggiorno", p: "Check-out {checkoutTime}: lasciate le chiavi appese alla porta della camera, come le avete trovate al vostro arrivo. La tassa di soggiorno di Siracusa è pari al 4% del costo del soggiorno, con un massimo di 5 € a persona per notte e per le prime 7 notti. I minori di 14 anni non pagano. Potete lasciare l'importo sulla scrivania. Grazie!", pIf: { taxFixed: "Check-out {checkoutTime}: lasciate le chiavi appese alla porta della camera, come le avete trovate al vostro arrivo. La tassa di soggiorno di Siracusa è di circa 2 € a persona per notte, per le prime 7 notti. I minori di 14 anni non pagano. Potete lasciare l'importo sulla scrivania. Grazie!" } },
        { h: "Non si fuma 🚭", p: "È vietato fumare all'interno del B&B e delle camere. Grazie per la collaborazione!" }
      ]
    },
    {
      id: "wifi", icon: "wifi",
      title: "WiFi gratuito",
      sub: "Rete e password",
      intro: "Seleziona la rete e connettiti in un tocco. Copia la password qui sotto oppure inquadra il QR code.",
      items: []
    },
    {
      id: "breakfast", icon: "coffee",
      title: "La vostra colazione",
      sub: "Nei migliori bar qui vicino, con i voucher",
      intro: "La colazione è servita nei migliori bar nelle vicinanze. Utilizzate i voucher che trovate sulla scrivania della vostra camera e scegliete liberamente uno dei tre bar convenzionati, ogni giorno quello che preferite — dal lunedì alla domenica, dalle 07:30 e senza limiti di orario.",
      steps: [
        { h: "Caffè Aurora", p: "Via dei Tigli, 3 — a soli due passi da noi — [u]Chiuso la domenica[/u]", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=bar+colazione", icon: "pin" }] },
        { h: "Bar Centrale", p: "Piazza Grande, 1 — disponibili opzioni senza glutine e senza lattosio — [u]Chiuso la domenica[/u]", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=bar+colazione", icon: "pin" }] },
        { h: "Pasticceria Bella Epoca", p: "Corso Principale, 45 — [u]Chiuso il martedì[/u]", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=pasticceria", icon: "pin" }] }
      ]
    },
    {
      id: "attractions", icon: "temple",
      title: "Esplorare Siracusa",
      sub: "La storia a portata di mano",
      photos: [
        "assets/city/hero-ortigia.jpg",
        "assets/city/hero-fontana.jpg",
        "assets/city/hero-ristoranti.jpg",
        "assets/city/hero-eventi.jpg",
        "assets/city/hero-attrazioni.jpg"
      ],
      intro: "Dal B&B {guideName} la storia è a portata di mano: ecco cosa non perdere.",
      items: [
        { h: "Ortigia, il cuore storico", p: "• [[Piazza Duomo e il Duomo di Siracusa]], costruito inglobando l'antico tempio greco di Atena\n• [[Fonte Aretusa]], sorgente d'acqua dolce a pochi metri dal mare\n• [[Tempio di Apollo]], tra i resti greci più antichi dell'isola\n• [[Castello Maniace]], fortezza federiciana sul mare\n• [[Lungomare di Levante e di Ponente]], bellissimi al tramonto\n• [[Mercato di Ortigia]], ideale al mattino per street food, pesce, frutta, spezie e prodotti locali\n\n[i]In auto: l'isola è in gran parte ZTL, quindi per visitare il centro storico in tranquillità lasciate l'auto al parcheggio Talete (multipiano, aperto 24 ore) o al Molo Sant'Antonio (ampio parcheggio servito da comode navette).[/i]", actions: [{ label: "Ortigia", href: "https://www.google.com/maps/place/Ponte+Umberto+I/@37.0646512,15.2886735,17z/data=!3m1!4b1!4m6!3m5!1s0x1313cc1fe67aa495:0x68b768548ca7a0fa!8m2!3d37.0646469!4d15.2912484!16s%2Fg%2F11cn5p5hyl", icon: "pin" }, { label: "Talete", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Talete+Siracusa", icon: "parking" }, { label: "Sant'Antonio", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Molo+Sant%27Antonio+Siracusa", icon: "parking" }] },
        { h: "Ortigia sotterranea", p: "Sotto l'isola c'è una seconda città, che quasi nessuno vede.\n• [[Ipogeo di Piazza Duomo]], un labirinto di gallerie e cisterne scavate nella roccia, usato come rifugio durante i bombardamenti del 1943: si entra da Piazza Duomo e si riemerge sul Lungomare Alfeo\n• [[Miqwè]], il bagno rituale ebraico scavato 18 metri sotto la strada e alimentato da acqua sorgiva: è tra i meglio conservati d'Europa e si visita solo accompagnati", actions: [{ label: "Ipogeo di Piazza Duomo", href: "https://www.google.com/maps/search/?api=1&query=Ipogeo+di+Piazza+Duomo+Siracusa", icon: "pin" }, { label: "Miqwè", href: "https://www.google.com/maps/search/?api=1&query=Miqwe+Bagno+Ebraico+Ortigia+Siracusa", icon: "pin" }] },
        { h: "Area archeologica della Neapolis", p: "A soli 5 minuti a piedi: una delle visite più importanti della città. Include [[Teatro Greco]], [[Anfiteatro Romano]], [[Latomie]], [[Orecchio di Dionisio]] e [[Ara di Ierone]]. In estate meglio andarci al mattino presto.", actions: [{ label: "Apri la mappa", href: "https://www.google.com/maps/search/?api=1&query=Parco+Archeologico+Neapolis+Siracusa", icon: "pin" }] },
        { h: "Eventi e spettacoli", p: "Da maggio a luglio il Teatro Greco ospita le rappresentazioni classiche dell'INDA; in estate Ortigia si anima con concerti e artisti di strada.", actions: [{ label: "Programma INDA", href: "https://www.indafondazione.org", icon: "calendar" }] },
        { h: "Musei e chiese", p: "Museo Archeologico Regionale [[Paolo Orsi]], ottimo per la storia greca, romana e preistorica; le suggestive [[Catacombe di San Giovanni]]; il [[Santuario della Madonna delle Lacrime]], edificio moderno e molto riconoscibile nello skyline cittadino.\n\nIn Ortigia, la [[Galleria di Palazzo Bellomo]] custodisce l'Annunciazione di Antonello da Messina.\n\nIl [[Seppellimento di Santa Lucia]] del Caravaggio si trova nella [[Basilica di Santa Lucia al Sepolcro]], nella borgata. [i]Attenzione: molte guide lo indicano ancora nella chiesetta in Piazza Duomo, dove è stato per anni. Dal 2020 non è più lì.[/i]", actions: [{ label: "Paolo Orsi", href: "https://www.google.com/maps/search/?api=1&query=Museo+Archeologico+Paolo+Orsi+Siracusa", icon: "pin" }, { label: "Catacombe S. Giovanni", href: "https://www.google.com/maps/search/?api=1&query=Catacombe+di+San+Giovanni+Siracusa", icon: "pin" }, { label: "Madonna delle Lacrime", href: "https://www.google.com/maps/search/?api=1&query=Santuario+Madonna+delle+Lacrime+Siracusa", icon: "pin" }, { label: "Palazzo Bellomo", href: "https://www.google.com/maps/search/?api=1&query=Galleria+Regionale+Palazzo+Bellomo+Siracusa", icon: "pin" }, { label: "Caravaggio — S. Lucia al Sepolcro", href: "https://www.google.com/maps/search/?api=1&query=Basilica+Santa+Lucia+al+Sepolcro+Siracusa", icon: "pin" }] }
      ]
    },
    {
      id: "restaurants", icon: "pizza",
      title: "Dove mangiare e bere",
      sub: "I migliori locali, tutti a piedi da qui",
      intro: "Ecco i migliori locali raggiungibili a piedi da Via dei Mandorli 12. Consiglio: nel weekend, vi suggeriamo di prenotare!",
      items: [
        { h: "🍕 Pizzerie", list: [{ n: "Pizzeria da Marco", sub: "Via dei Tigli, 5", tel: "+39 000 000 0000" }, { n: "La Forneria", sub: "Via delle Rose, 12", tel: "+39 000 000 0000" }, { n: "Forno Antico", sub: "Piazza Grande, 7", tel: "+39 000 000 0000" }] },
        { h: "🍽️ Ristoranti", list: [{ n: "Trattoria del Borgo", sub: "Via del Mare, 8", tel: "+39 000 000 0000" }, { n: "Osteria Antica", sub: "Piazza Centrale, 3", tel: "+39 000 000 0000" }, { n: "Locanda dei Tigli", sub: "Via dei Tigli, 20", tel: "+39 000 000 0000" }] },
        { h: "🐟 Pesce", list: [{ n: "Il Pescatore", sub: "Via del Porto, 20", tel: "+39 000 000 0000" }, { n: "La Sirena", sub: "Lungomare, 2", tel: "+39 000 000 0000" }] },
        { h: "🥂 Aperitivi", list: [{ n: "Bar Centrale", sub: "Piazza Grande, 1", tel: "+39 000 000 0000" }, { n: "Terrazza Blu", sub: "Via Belvedere, 9", tel: "+39 000 000 0000" }] },
        { h: "🍰 Dolci e caffè", list: [{ n: "Caffè delle Palme", sub: "Corso Principale, 45", tel: "+39 000 000 0000" }, { n: "Forno Dolce", sub: "Via Roma, 30", tel: "+39 000 000 0000" }] }
      ]
    },
    {
      id: "excursions", icon: "beach",
      title: "Mare ed escursioni",
      sub: "Dalle calette cittadine alle riserve naturali",
      intro: "Dalle calette cittadine alle riserve naturali, ecco come godersi il mare e i dintorni.",
      items: [
        { h: "Mare, scogli e lidi", p: "Il Plemmirio, area marina protetta a sud di Siracusa, è perfetto per scogli, snorkeling e mare pulito. A Ortigia si fa il bagno anche dagli scogli e dai solarium del lungomare di Levante, a due passi dal centro.", list: [{ n: "Varco 23", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Varco+23+Plemmirio+Siracusa" }, { n: "Plemmirio Reserve", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Plemmirio+Reserve+Siracusa" }, { n: "Fly Beach", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Fly+Beach+Ortigia+Siracusa" }, { n: "Zefiro Solarium", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Zefiro+Solarium+Ortigia+Siracusa" }, { n: "Cala Rossa", sub: "Ortigia · scogli", map: "https://www.google.com/maps/search/?api=1&query=Cala+Rossa+Ortigia+Siracusa" }, { n: "Forte Vigliena", sub: "Ortigia · scogli", map: "https://www.google.com/maps/search/?api=1&query=Forte+Vigliena+Ortigia+Siracusa" }, { n: "Cala Zaffiro", sub: "Plemmirio · 25 min", map: "https://www.google.com/maps/search/?api=1&query=Cala+Zaffiro+Plemmirio+Siracusa" }] },
        { h: "Spiagge e lidi", p: "Le spiagge dell'Arenella e di Fontane Bianche sono le più comode per una giornata balneare: sabbia e servizi. La Riserva di Vendicari, un po' più a sud, è consigliata se avete auto e tempo.", list: [{ n: "Lido Arenella", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Arenella+Siracusa" }, { n: "Lido Le Nereidi", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Le+Nereidi+Siracusa" }, { n: "Kukua Beach", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Kukua+Beach+Fontane+Bianche+Siracusa" }, { n: "Lido Sayonara", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Lido+Sayonara+Fontane+Bianche+Siracusa" }, { n: "Agua Beach", sub: "San Lorenzo", map: "https://www.google.com/maps/search/?api=1&query=Agua+Beach+San+Lorenzo+Siracusa" }, { n: "Lido San Lorenzo", sub: "San Lorenzo · 50 min", map: "https://www.google.com/maps/search/?api=1&query=Lido+San+Lorenzo+Siracusa" }, { n: "Lido Camomilla", sub: "Fontane Bianche · 30 min", map: "https://www.google.com/maps/search/?api=1&query=Lido+Camomilla+Fontane+Bianche+Siracusa" }, { n: "Calamosche", sub: "riserva · 45 min", map: "https://www.google.com/maps/search/?api=1&query=Spiaggia+Calamosche+Vendicari" }, { n: "Vendicari", sub: "riserva · 50 min · consigliato", map: "https://www.google.com/maps/search/?api=1&query=Riserva+Vendicari" }, { n: "Portopalo di Capopassero", sub: "1 ora · kitesurf", map: "https://www.google.com/maps/search/?api=1&query=Portopalo+di+Capo+Passero" }] },
        { h: "Dintorni consigliati", p: "La Necropoli di Pantalica, patrimonio UNESCO insieme a Siracusa, contiene oltre 5.000 tombe scavate nella roccia ed è a circa 40 km dalla città. Noto, capitale del barocco siciliano, è perfetta in mezza giornata. Marzamemi è un borgo marinaro molto scenografico, più turistico ma piacevole.", actions: [{ label: "Pantalica", href: "https://www.google.com/maps/search/?api=1&query=Necropoli+di+Pantalica", icon: "pin" }, { label: "Noto", href: "https://www.google.com/maps/search/?api=1&query=Noto+Siracusa", icon: "pin" }, { label: "Marzamemi", href: "https://www.google.com/maps/search/?api=1&query=Marzamemi", icon: "pin" }] },
        { h: "Escursioni, barca e diving", p: "Giri in barca, escursioni e immersioni con guide del posto. Potete anche noleggiare un gommone, con o senza skipper.", actions: [{ label: "Escursioni — Francesco Corbino", href: "+39 340 134 1244", type: "tel", icon: "phone" }, { label: "Giro in barca — Papyrus", href: "+39 338 721 2142", type: "tel", icon: "phone" }, { label: "Diving e barche — Fabio Portella", href: "+39 333 132 4030", type: "tel", icon: "phone" }, { label: "Gommoni — Pietro Urzì", href: "+39 338 889 0866", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "taxi", icon: "taxi",
      title: "Taxi e trasporti",
      sub: "Spostarsi senza auto",
      items: [
        { h: "Navette gratuite in città", p: "Tre linee di navette [[completamente gratuite]] collegano parcheggi e centro fino a tarda notte: comodissime per raggiungere Ortigia senza problemi di parcheggio.\nLun–Sab 17:00–02:00 · Domenica 08:00–02:00 (circa ogni 20 minuti).\n\n🔴 Linea Rossa «Teocrito» — dal Parcheggio Von Platen a Ortigia, via [[Neapolis]] e [[Museo Paolo Orsi]].\n[i]Von Platen → Viale Cadorna → Piazza della Vittoria → Corso Gelone → Piazzale Marconi → Via Malta → Piazza Pancali → Corso Umberto → Viale Teracati → Viale Teocrito → Von Platen.[/i]\n\n🔵 Linea Blu «Elorina» — dal Parcheggio Elorina a Ortigia, via [[Foro Siracusano]].\n[i]Elorina → Piazzale Marconi → Via Malta → Ponte S. Lucia → Via Chindemi → Piazza Pancali → Ponte Umbertino → Corso Umberto → Foro Siracusano → Via Elorina → Elorina.[/i]\n\n🟢 Linea Verde «Ortigia» — giro completo del perimetro dell'isola di [[Ortigia]].\n[i]Talete → Riva della Posta → Via dei Mille → Parcheggio Marina → Passeggio Aretusa → Castello Maniace → Lungomare di Levante → Largo della Gancia → Via Nizza → Belvedere S. Giacomo → Talete.[/i]", img: "assets/city/navette-mappa.png" },
        { h: "Servizio taxi", p: "[[Radio Taxi Siracusa]], attivo 24 ore su 24 in tutta la città. In alternativa [[Enzo Salvi]], il nostro taxista di fiducia (anche NCC): gentile e puntuale, ottimo per i transfer da e per l'aeroporto. Un altro contatto affidabile è [[Pietro Gatto]].", actions: [{ label: "Radio Taxi", href: "{taxiPhone}", type: "tel", icon: "phone" }, { label: "Enzo Salvi", href: "+39 338 708 7223", type: "tel", icon: "phone" }, { label: "Pietro Gatto", href: "+39 340 753 1581", type: "tel", icon: "phone" }] },
        { h: "Dall'aeroporto di Catania", p: "L'opzione più comoda ed economica è l'[[autobus diretto]] Interbus per Siracusa: circa 55–70 minuti, biglietto da 4 a 8 €. Lo stesso autobus vi riporta in aeroporto alla partenza. In alternativa taxi o transfer privato (chiedete a noi o a Enzo Salvi). Qui sotto trovate anche gli orari dei bus urbani di Siracusa.", actions: [{ label: "Compra il biglietto (Interbus)", href: "https://www.interbus.it", icon: "info" }, { label: "Orari bus città", href: "https://www.saisautolinee.it/linee-urbane-sicilia/siracusa", icon: "info" }] },
        { h: "Bici e monopattini elettrici", p: "Con l'app [[ELERENT]] noleggiate bici e monopattini elettrici direttamente dal telefono: flotta 100% elettrica, tariffe che partono in genere da 1 € di sblocco più 0,25 € al minuto. Funziona in oltre 50 città tra Italia, Spagna, Grecia e Malta.", actions: [{ label: "ELERENT per iPhone", href: "https://apps.apple.com/it/app/elerent/id1518090808", icon: "info" }, { label: "ELERENT per Android", href: "https://play.google.com/store/apps/details?id=com.elerent.elerent", icon: "info" }] },
        { h: "Noleggio scooter e auto", p: "Ortigia Rent Siracusa — noleggio scooter e auto.", actions: [{ label: "Chiama", href: "+39 0931 962217", type: "tel", icon: "phone" }, { label: "Sito web", href: "https://www.ortigiarentsiracusa.it", icon: "info" }] }
      ]
    },
    {
      id: "info", icon: "info",
      title: "Informazioni utili",
      sub: "Servizi ed emergenze",
      items: [
        { h: "Spesa e acqua", p: "Il supermercato più comodo è il Maxistore Decò, in Corso Gelone 29, a pochi minuti a piedi; per l'acqua e i generi di prima necessità sono comodi anche i piccoli market di quartiere.\n\nQuando i negozi sono chiusi restano due distributori automatici, aperti [[24 ore su 24]], per caffè e bevande:\n• [[Distributori Automatici H24]] — Via Senatore Giuseppe Maielli, 6\n• [[Oasi 24/7]] — Via Malta, 32", actions: [{ label: "Maxistore Decò", href: "https://www.google.com/maps/search/?api=1&query=Maxistore+Dec%C3%B2+Corso+Gelone+29+Siracusa", icon: "pin" }, { label: "Distributori H24", href: "https://www.google.com/maps/search/?api=1&query=Distributori+Automatici+H24+Via+Senatore+Giuseppe+Maielli+6+Siracusa", icon: "pin" }, { label: "Oasi 24/7", href: "https://www.google.com/maps/search/?api=1&query=Oasi+24%2F7+Via+Malta+32+Siracusa", icon: "pin" }] },
        { h: "Bancomat", p: "Diversi sportelli bancomat (ATM) si trovano su Corso Gelone e a Ortigia, a breve distanza.", actions: [{ label: "Bancomat più vicino", href: "https://www.google.com/maps/search/bancomat+ATM+Corso+Gelone+Siracusa", icon: "pin" }] },
        { h: "Farmacia e ospedale", p: "Diverse farmacie sono a pochi minuti a piedi, su Corso Gelone e a Ortigia (di notte e nei festivi il turno è esposto in vetrina, o chiedete a noi). Il pronto soccorso è all'Ospedale Umberto I, in via Testaferrata.", actions: [{ label: "Farmacia", href: "https://www.google.com/maps/search/farmacia+Corso+Gelone+Siracusa", icon: "pin" }, { label: "Ospedale Umberto I", href: "https://www.google.com/maps/search/?api=1&query=Ospedale+Umberto+I+Siracusa", icon: "pin" }] },
        { h: "Numeri di emergenza", p: "[[112]] — Emergenza unica europea (polizia, ambulanza, vigili del fuoco)\n[[118]] — Emergenza sanitaria (ambulanza)\n[[1530]] — Emergenza in mare (Guardia Costiera)", actions: [{ label: "112", href: "112", type: "tel", icon: "phone" }, { label: "118", href: "118", type: "tel", icon: "phone" }, { label: "1530", href: "1530", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "extras", icon: "sparkle",
      title: "Servizi ed extra",
      sub: "Chiedeteci pure, pensiamo a tutto noi",
      intro: "Volete un arrivo o una partenza su misura, un transfer o una gita? Toccate il servizio: ci arriva il messaggio già pronto e vi rispondiamo con disponibilità e costo.",
      items: [
        { h: "Transfer da e per l'aeroporto", p: "Vi organizziamo il transfer da e per l'aeroporto di Catania con un autista di fiducia, comodo soprattutto con i voli molto presto o molto tardi.", actions: [{ label: "Richiedi il transfer", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Ciao! Vorrei organizzare un transfer da/per l'aeroporto di Catania. Ecco i dettagli del volo:" }] },
        { h: "Check-out posticipato", p: "Partite nel pomeriggio? Se la camera resta libera, possiamo lasciarvela qualche ora in più.", actions: [{ label: "Chiedi il late check-out", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Ciao! Vorrei chiedere un check-out posticipato, se possibile. La mia partenza è verso le:" }] },
        { h: "Check-in anticipato e deposito bagagli", p: "Arrivate presto o ripartite tardi? Possiamo custodire i vostri bagagli e, se la camera è pronta, farvi entrare prima.", actions: [{ label: "Chiedi info", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Ciao! Vorrei un check-in anticipato o lasciare i bagagli. Arrivo/riparto verso le:" }] },
        { h: "Escursioni, barca e tour", p: "Gite in barca, tour della città e immersioni: vi mettiamo in contatto con i nostri partner di fiducia.", actions: [{ label: "Richiedi un'escursione", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Ciao! Vorrei informazioni su escursioni, gite in barca o tour." }] }
      ]
    },
    {
      id: "faq", icon: "info",
      title: "Domande frequenti",
      sub: "Le risposte pratiche, a portata di mano",
      items: [
        { h: "Aria condizionata", p: "Il telecomando è in camera: accendetela pure quando siete dentro e spegnetela quando uscite, così consumiamo il giusto. Per qualsiasi problema, scriveteci." },
        { h: "Acqua calda", p: "L'acqua calda è disponibile in ogni momento. Se notate qualcosa che non va, avvisateci subito e risolviamo." },
        { h: "Raccolta differenziata", p: "Siracusa fa la raccolta porta a porta. Vi chiediamo di separare i rifiuti così:\n• [[Umido / organico]] — lunedì, mercoledì, venerdì\n• [[Plastica e metalli]] — martedì\n• [[Indifferenziato]] — giovedì\n• [[Carta, cartone e vetro]] — sabato\nPer dove e a che ora esporre i sacchetti, chiedeteci pure: vi diamo una mano.", actions: [{ label: "Calendario del Comune", href: "https://www.siracusadifferenzia.it", icon: "info" }] },
        { h: "Orari di quiete", p: "Dopo le 23:00 vi chiediamo di moderare i rumori, per rispetto degli altri ospiti e dei vicini. Grazie!" },
        { h: "Non trovate qualcosa?", p: "Scriveteci su WhatsApp a qualsiasi ora: siamo qui per aiutarvi.", actions: [{ label: "Scrivici su WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "review", icon: "star",
      title: "Lasciate una recensione",
      sub: "Il vostro supporto per noi è prezioso",
      items: [
        { h: "Vi siete trovati bene?", p: "Se vi siete trovati bene, una recensione su Google è preziosissima per noi: siamo una nuova gestione e sappiamo che il punteggio attuale non ci rappresenta. Stiamo facendo davvero di tutto per rendere il vostro soggiorno indimenticabile. Grazie di cuore! 💛", actions: [{ label: "Lascia una recensione su Google", href: "{reviewUrl}", icon: "star", style: "accent" }] },
        { h: "Qualcosa non va?", p: "Ditecelo subito su WhatsApp, anche di notte: preferiamo rimediare al momento piuttosto che scoprirlo dopo.", actions: [{ label: "Scrivici su WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "contacts", icon: "phone",
      title: "Contatti",
      sub: "Siamo sempre a disposizione",
      items: [
        { h: "WhatsApp, Telegram, Viber", p: "Il modo più veloce per raggiungerci.", actions: [{ label: "Apri WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Telefono", p: "Per urgenze e comunicazioni rapide.", actions: [{ label: "Chiama", href: "{phone}", type: "tel", icon: "phone", onlyIf: "phone" }, { label: "Altro numero", href: "{phoneGreta}", type: "tel", icon: "phone", onlyIf: "phoneGreta" }] },
        { h: "Email", p: "{email}", actions: [{ label: "Scrivi una email", href: "{email}", type: "mail", icon: "info" }] },
        { h: "Tornate a trovarci!", p: "Prenotate direttamente per i prossimi soggiorni: agli ospiti che ritornano riserviamo sempre il miglior trattamento possibile.", actions: [{ label: "Prenota online", href: "{bookingUrl}", icon: "calplus" }, { label: "Prenota su WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat", style: "secondary" }] }
      ]
    }
  ]
};
