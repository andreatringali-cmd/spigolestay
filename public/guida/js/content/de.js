// ============================================================
//  INHALTE AUF DEUTSCH
//  Platzhalter wie {whatsapp} werden automatisch mit den
//  Werten aus config.js ersetzt
// ============================================================

window.I18N = window.I18N || {};

window.I18N.de = {
  ui: {
    back: "Zurück",
    footer: "Wir wünschen Ihnen einen wunderbaren Aufenthalt!",
    copy: "Passwort kopieren",
    copied: "Passwort kopiert!",
    wifiNetwork: "Netzwerk",
    wifiPassword: "Passwort",
    quickWifi: "WiFi",
    quickWhatsapp: "WhatsApp",
    quickMap: "Karte",
    quickEmergency: "Notfälle",
    codeSuffix: "+ die mittlere Taste",
    codeMissing: "Der Code kommt mit dem persönlichen Link, den wir Ihnen vor der Anreise senden. Falls Sie ihn nicht finden, schreiben Sie uns einfach.",
    footerSocial: "Folgen Sie uns und bleiben Sie in Kontakt",
    wifiQrHint: "Für den QR wischen ›",
    wifiQrCaption: "Scan me"
  },

  home: {
    title: "Ihr Guide",
    subtitle: "Alles, was Sie brauchen, von der Ankunft bis zur Abreise.",
    welcomeTitle: "Willkommen,",
    welcome: [
      "wir freuen uns sehr, Sie bei uns zu haben!",
      "Dieser Guide hilft Ihnen, die Stadt zu entdecken und Ihren Aufenthalt optimal zu genießen. Unser Team steht Ihnen für alles zur Verfügung.",
      "Schönen Aufenthalt!"
    ]
  },

  groups: [
    { title: "Ihre Ankunft", sections: ["checkin", "breakfast", "wifi"] },
    { title: "Syrakus entdecken", sections: ["attractions", "restaurants", "excursions"] },
    { title: "Nützliche Services", sections: ["taxi", "info", "faq", "extras", "contacts", "review"] }
  ],

  // Objektspezifische Abschnitte (Override). Nicht hier aufgeführte
  // Abschnitte bleiben gemeinsam (Stadtinhalte für alle gleich).
  sectionsByProperty: {
    centralperk: {
      checkin: {
        id: "checkin", icon: "key",
        title: "Ankunft & Self-Check-in",
        sub: "So gelangen Sie ins B&B Central Perk",
        intro: "Sie können ganz entspannt anreisen. So gelangen Sie ins Central Perk.",
        steps: [
          { h: "Wo wir sind", p: "Central Perk — Via Antioco 13, eine Seitenstraße des Corso Gelone, auf Höhe der UniCredit-Bank (Corso Gelone 30).", actions: [{ label: "Central Perk", href: "{mapsUrl}", icon: "pin" }] },
          { h: "Öffnen Sie das Tor", p: "Links neben dem Tor befindet sich ein schwarz-grauer Schlüsseltresor: Geben Sie den unten stehenden Code ein, nehmen Sie den Schlüssel und öffnen Sie das Tor. Legen Sie den Schlüssel danach bitte wieder an seinen Platz zurück.", codeKey: "gateCode", codeAfter: "#" },
          { h: "Hinauf zum B&B", p: "Sobald Sie drinnen sind, gehen Sie die Treppe hinauf und wenden sich nach rechts: Ganz hinten rechts befindet sich die Eingangstür des B&B. Zwischen den beiden Türen finden Sie zwei Schlüsseltresore." },
          { h: "Ihre Schlüssel — Zimmer 1", p: "Öffnen Sie den [[oberen]] Tresor mit dem unten stehenden Code und nehmen Sie Ihren Schlüsselbund heraus. Ihr Zimmer, die Nummer 1, ist genau dort.", codeKey: "doorCode", codeAfter: "#", onlyRooms: ["1"] },
          { h: "Ihre Schlüssel — Zimmer 2, 3 und 4", hPersonal: "Ihre Schlüssel — Zimmer {roomNums}", hPersonalPlural: "Ihre Schlüssel — Zimmer {roomNums}", p: "Öffnen Sie den [[unteren]] Tresor mit dem unten stehenden Code, öffnen Sie mit dem Schlüssel die Eingangstür und legen Sie ihn danach bitte wieder in den Tresor zurück. Ihr Schlüsselbund hängt an der Tür Ihres Zimmers: Der Schlüssel mit dem schwarzen Griff ist für die Eingangstür, der dritte für das Tor unten.", pPersonal: "Öffnen Sie den [[unteren]] Tresor mit dem unten stehenden Code, öffnen Sie mit dem Schlüssel die Eingangstür und legen Sie ihn danach bitte wieder in den Tresor zurück. Ihr Zimmer ist die Nummer {roomNum}: Ihr Schlüsselbund hängt an dessen Tür. Der Schlüssel mit dem schwarzen Griff ist für die Eingangstür, der dritte für das Tor unten.", pPersonalPlural: "Öffnen Sie den [[unteren]] Tresor mit dem unten stehenden Code, öffnen Sie mit dem Schlüssel die Eingangstür und legen Sie ihn danach bitte wieder in den Tresor zurück. Ihre Zimmer sind {roomNum}: Jeder Schlüsselbund hängt an der Tür des jeweiligen Zimmers. Der Schlüssel mit dem schwarzen Griff ist für die Eingangstür, der dritte für das Tor unten.", codeKey: "doorCode2", codeAfter: "#", exceptRooms: ["1"] },
          { h: "Geben Sie mir Bescheid", p: "Schreiben Sie mir eine Nachricht, sobald Sie im Zimmer angekommen sind, und sagen Sie mir, ob alles in Ordnung ist. Für jeden Wunsch, jede Frage oder Information schreiben Sie mir zu jeder Uhrzeit hier auf WhatsApp.", actions: [{ label: "Schreiben Sie uns per WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ],
        amenitiesTitle: "Die Ausstattung Ihres Zimmers",
        amenitiesIntro: "Wir haben jedes Detail bedacht, damit Ihre Erholung perfekt wird.",
        amenities: [
          { icon: "snow", label: "Klimaanlage" },
          { icon: "tv", label: "Smart TV" },
          { icon: "sparkle", label: "Kosmetikset" },
          { icon: "wind", label: "Haartrockner" },
          { icon: "towel", label: "Frische Wäsche" },
          { icon: "balcony", label: "Privater Balkon" }, { icon: "coffee", label: "Kaffeemaschine", onlyRooms: ["3", "4"] }
        ],
        gallery: true,
        items: [
          { h: "Gemeinschaftsküche und Kaffee", p: "In der Lobby steht allen Gästen eine kleine Gemeinschaftsküche zur Verfügung: Kühlschrank, Wasserkocher, Mikrowelle, ein Spender für stilles und sprudelndes Wasser und eine Kaffeemaschine. Der Kaffee stammt aus eigener Produktion — probieren Sie ihn gerne!" },
          { h: "Parken", p: "Parkplätze finden Sie problemlos und kostenlos auf der Straße in der Nähe des B&B. Alternativ gibt es 50 Meter entfernt einen privaten, kostenpflichtigen Parkplatz, den \"Parcheggio Gelone\".", actions: [{ label: "Parcheggio Gelone", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Gelone+Siracusa", icon: "parking" }] },
          { h: "Dokumente", p: "Für die Meldung benötigen wir die Ausweise aller Gäste: Ein Foto von Vorder- und Rückseite per WhatsApp genügt, gerne schon vor der Ankunft.", pIf: { docsUrl: "Für die Meldung benötigen wir die Ausweise aller Gäste: Sie können sie mit dem Button unten [[selbst hochladen]] – ganz einfach über unser Portal. Das geht im Handumdrehen, gerne schon vor der Ankunft, und Sie müssen uns sonst nichts mehr schicken." }, actions: [{ label: "Dokumente hochladen", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Dokumente senden", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
          { h: "Check-out und Kurtaxe", p: "Check-out {checkoutTime}. Die Kurtaxe von Syrakus beträgt 4 % der Aufenthaltskosten, mit maximal 5 € pro Person und Nacht und nur für die ersten 7 Nächte. Kinder unter 14 Jahren zahlen nicht: Sie können sie im Zimmer hinterlegen. Danke!", pIf: { taxFixed: "Check-out {checkoutTime}. Die Kurtaxe von Syrakus beträgt etwa 2 € pro Person und Nacht, für die ersten 7 Nächte. Kinder unter 14 Jahren zahlen nicht: Sie können sie im Zimmer hinterlegen. Danke!" } },
          { h: "Nichtraucher 🚭", p: "Das Rauchen ist im gesamten B&B und in den Zimmern untersagt. Danke für Ihr Verständnis!" }
        ]
      },
      breakfast: {
        id: "breakfast", icon: "coffee",
        title: "Ihr Frühstück",
        sub: "In den Partnerbars ganz in der Nähe, mit Gutscheinen",
        intro: "Das Frühstück wird in den Partnerbars ganz in der Nähe serviert, ab 7:00 Uhr und so lange Sie möchten. Die Gutscheine finden Sie auf dem Schreibtisch oder auf dem Nachttisch Ihres Zimmers.",
        steps: [
          { h: "Täglich (außer samstags) — Milk and Coffee", p: "Corso Gelone 22, direkt unterhalb der Unterkunft.", notice: { until: "2026-08-08", text: "🌴 Betriebsferien vom 25. Juli bis 8. August: In diesem Zeitraum gibt es das Frühstück im [[Bar Euripide]] (Piazza Euripide 25)." }, actions: [{ label: "Karte öffnen", href: "https://www.google.com/maps/search/?api=1&query=Milk+and+Coffee+Corso+Gelone+Siracusa", icon: "pin" }] },
          { h: "Samstags — Bar Euripide", p: "Piazza Euripide 25, drei Gehminuten entfernt.", actions: [{ label: "Karte öffnen", href: "https://www.google.com/maps/search/?api=1&query=Bar+Euripide+Piazza+Euripide+Siracusa", icon: "pin" }] }
        ]
      },
      contacts: {
        id: "contacts", icon: "phone",
        title: "Kontakt",
        sub: "Wir sind immer für Sie da",
        items: [
          { h: "WhatsApp, Telegram, Viber", p: "Der schnellste Weg, uns zu erreichen.", actions: [{ label: "WhatsApp öffnen", href: "{whatsapp}", type: "wa", icon: "chat" }] },
          { h: "Telefon", p: "Für Dringendes und schnelle Nachrichten.", actions: [{ label: "Anrufen", href: "{phone}", type: "tel", icon: "phone", onlyIf: "phone" }, { label: "Weitere Nummer", href: "{phoneGreta}", type: "tel", icon: "phone", onlyIf: "phoneGreta" }] },
          { h: "E-Mail", p: "{email}", actions: [{ label: "E-Mail schreiben", href: "{email}", type: "mail", icon: "info" }] },
          { h: "Kommen Sie wieder!", p: "Buchen Sie direkt für Ihre nächsten Aufenthalte: Wiederkehrenden Gästen bieten wir stets die bestmögliche Behandlung.", actions: [{ label: "Per WhatsApp buchen", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ]
      }
    }
  },

  sections: [
    {
      id: "checkin", icon: "key",
      title: "Ankunft & Self-Check-in",
      sub: "Wie Sie uns erreichen und in Ihr Zimmer gelangen",
      gallery: true,
      intro: "Sie können ab 15.00 Uhr ganz entspannt anreisen.",
      steps: [
        { h: "Wo wir sind", p: "{address}. Sie finden uns direkt nach der Kirche Santa Rita, auf der rechten Seite (graues Tor).", actions: [{ label: "B&B Spigolehouse", href: "{mapsUrl}", icon: "pin" }] },
        { h: "Parken", p: "Sie haben einen reservierten Parkplatz im Innenhof. Um in den Hof zu gelangen, geben Sie den Code auf dem Tastenfeld unter der Gegensprechanlage ein und drücken Sie die mittlere Taste. Die Plätze sind nicht zugewiesen: Parken Sie, wo Sie möchten, innerhalb der markierten Flächen.", codeKey: "gateCode", parkOnly: true },
        { h: "Parken", p: "Laut Ihrer Buchung haben Sie keinen Parkplatz reserviert. Falls Sie einen benötigen, kontaktieren Sie uns, um die Verfügbarkeit zu prüfen: Die Kosten betragen 6 € pro Nacht.", actions: [{ label: "Kontaktieren Sie uns per WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }], noParkOnly: true },
        { h: "Fußgängereingang", p: "Um zu Fuß einzutreten, geben Sie den Code auf dem Tastenfeld unter der Gegensprechanlage ein und drücken Sie die mittlere Taste.", codeKey: "doorCode", noParkOnly: true },
        { h: "Zugang zu den Etagen", p: "Für die Innentür und die Schlüsselbox auf Ihrer Etage geben Sie den Code gefolgt von den 2 seitlichen Tasten ein.", codeKey: "doorCode", codeSuffix: "+ die 2 seitlichen Tasten" },
        { h: "Willkommen in Ihrem Zimmer!", p: "Die Schlüssel finden Sie direkt an der Tür Ihres Zimmers. Machen Sie es sich gemütlich und entspannen Sie sich!", pPersonal: "Ihr Zimmer ist Nummer {roomNum}: Die Schlüssel finden Sie direkt an der Tür. Machen Sie es sich gemütlich und entspannen Sie sich!", pPersonalPlural: "Ihre Zimmer sind {roomNum}: Die Schlüssel finden Sie direkt an jeder Tür. Machen Sie es sich gemütlich und entspannen Sie sich!" }
      ],
      amenitiesTitle: "Die Ausstattung Ihres Zimmers",
      amenitiesIntro: "Wir haben jedes Detail bedacht, damit Ihre Erholung perfekt wird.",
      amenities: [
        { icon: "snow", label: "Klimaanlage" },
        { icon: "tv", label: "Smart TV" },
        { icon: "sparkle", label: "Kosmetikset" },
        { icon: "coffee", label: "Kaffeemaschine" },
        { icon: "wind", label: "Haartrockner" },
        { icon: "towel", label: "Frische Wäsche" },
        { icon: "iron", label: "Bügeleisen" },
        { icon: "balcony", label: "Privater Balkon" }
      ],
      items: [
        { h: "Frühstück und Gemeinschaftsbereich", p: "Auf Ihrer Etage steht Ihnen ein Gemeinschaftsbereich mit Kühlschrank, Wasserspender und Kaffeemaschine zur Verfügung. Auf dem Schreibtisch liegen die Gutscheine für Ihr Frühstück bereit: Tippen Sie hier, um zu erfahren, wo und wie.", actions: [{ label: "Zum Frühstück", href: "#/breakfast", icon: "coffee" }] },
        { h: "Zimmerreinigung 🌿", p: "Das Zimmer wird alle zwei Tage aufgeräumt und die Wäsche gewechselt: eine bewusste Entscheidung, um Wasser — ein kostbares Gut — nicht zu verschwenden und die Umwelt sowie die Insel, die Sie beherbergt, zu respektieren. Wenn Ihre Handtücher noch gut sind, hängen Sie sie wieder auf: Wir wechseln sie nur, wenn Sie sie in der Dusche oder im Waschbecken liegen lassen. Und wenn Sie vorher etwas brauchen — frische Handtücher oder ein zusätzliches Aufräumen — schreiben Sie uns einfach, kein Problem. Danke!", actions: [{ label: "Schreiben Sie uns per WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Dokumente", p: "Für die Meldung benötigen wir die Ausweise aller Gäste: Ein Foto von Vorder- und Rückseite genügt, auch hier per WhatsApp, gerne schon vor der Ankunft.", pIf: { docsUrl: "Für die Meldung benötigen wir die Ausweise aller Gäste: Sie können sie mit dem Button unten [[selbst hochladen]] – ganz einfach über unser Portal. Das geht im Handumdrehen, gerne schon vor der Ankunft, und Sie müssen uns sonst nichts mehr schicken." }, actions: [{ label: "Dokumente hochladen", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Dokumente senden", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
        { h: "Check-out und Kurtaxe", p: "Check-out {checkoutTime}: Lassen Sie die Schlüssel an der Zimmertür hängen, so wie Sie sie bei Ihrer Ankunft vorgefunden haben. Die Kurtaxe von Syrakus beträgt 4 % der Aufenthaltskosten, mit maximal 5 € pro Person und Nacht und nur für die ersten 7 Nächte. Kinder unter 14 Jahren zahlen nicht. Sie können den Betrag auf dem Schreibtisch hinterlegen. Danke!", pIf: { taxFixed: "Check-out {checkoutTime}: Lassen Sie die Schlüssel an der Zimmertür hängen, so wie Sie sie bei Ihrer Ankunft vorgefunden haben. Die Kurtaxe von Syrakus beträgt etwa 2 € pro Person und Nacht, für die ersten 7 Nächte. Kinder unter 14 Jahren zahlen nicht. Sie können den Betrag auf dem Schreibtisch hinterlegen. Danke!" } },
        { h: "Nichtraucher 🚭", p: "Das Rauchen ist im gesamten B&B und in den Zimmern untersagt. Danke für Ihr Verständnis!" }
      ]
    },
    {
      id: "wifi", icon: "wifi",
      title: "Kostenloses WiFi",
      sub: "Netzwerk und Passwort",
      intro: "Wählen Sie das Netzwerk und verbinden Sie sich mit einem Tipp. Kopieren Sie das Passwort unten oder scannen Sie den QR-Code.",
      items: []
    },
    {
      id: "breakfast", icon: "coffee",
      title: "Ihr Frühstück",
      sub: "In den besten Bars ganz in der Nähe, mit Gutscheinen",
      intro: "Das Frühstück wird in den besten Bars der Umgebung serviert. Nutzen Sie die Gutscheine, die Sie auf dem Schreibtisch Ihres Zimmers finden, und wählen Sie frei eine der drei Partnerbars, jeden Tag die, die Ihnen am besten gefällt — von Montag bis Sonntag, ab 07:30 Uhr und ohne Zeitbeschränkung.",
      steps: [
        { h: "Caffè Aurora", p: "Via dei Tigli, 3 — nur wenige Schritte von uns entfernt — [u]Sonntags geschlossen[/u]", actions: [{ label: "Karte öffnen", href: "https://www.google.com/maps/search/?api=1&query=bar+colazione", icon: "pin" }] },
        { h: "Bar Centrale", p: "Piazza Grande, 1 — glutenfreie und laktosefreie Optionen verfügbar — [u]Sonntags geschlossen[/u]", actions: [{ label: "Karte öffnen", href: "https://www.google.com/maps/search/?api=1&query=bar+colazione", icon: "pin" }] },
        { h: "Pasticceria Bella Epoca", p: "Corso Principale, 45 — [u]Dienstags geschlossen[/u]", actions: [{ label: "Karte öffnen", href: "https://www.google.com/maps/search/?api=1&query=pasticceria", icon: "pin" }] }
      ]
    },
    {
      id: "attractions", icon: "temple",
      title: "Syrakus erkunden",
      sub: "Geschichte zum Greifen nah",
      photos: [
        "assets/city/hero-ortigia.jpg",
        "assets/city/hero-fontana.jpg",
        "assets/city/hero-ristoranti.jpg",
        "assets/city/hero-eventi.jpg",
        "assets/city/hero-attrazioni.jpg"
      ],
      intro: "Vom B&B {guideName} ist die Geschichte zum Greifen nah: Das sollten Sie nicht verpassen.",
      items: [
        { h: "Ortigia, das historische Herz", p: "• [[Piazza Duomo e il Duomo di Siracusa]], erbaut unter Einbeziehung des antiken griechischen Athena-Tempels\n• [[Fonte Aretusa]], eine Süßwasserquelle nur wenige Meter vom Meer entfernt\n• [[Tempio di Apollo]], eines der ältesten griechischen Überreste der Insel\n• [[Castello Maniace]], eine staufische Festung am Meer\n• [[Lungomare di Levante e di Ponente]], wunderschön bei Sonnenuntergang\n• [[Mercato di Ortigia]], ideal am Morgen für Street Food, Fisch, Obst, Gewürze und lokale Produkte\n\n[i]Mit dem Auto: Die Insel ist größtenteils eine verkehrsbeschränkte Zone; um die Altstadt in Ruhe zu besichtigen, lassen Sie das Auto am Parkplatz Talete (Parkhaus, 24 Stunden geöffnet) oder am Molo Sant'Antonio (großer Parkplatz mit bequemen Shuttles).[/i]", actions: [{ label: "Ortigia", href: "https://www.google.com/maps/place/Ponte+Umberto+I/@37.0646512,15.2886735,17z/data=!3m1!4b1!4m6!3m5!1s0x1313cc1fe67aa495:0x68b768548ca7a0fa!8m2!3d37.0646469!4d15.2912484!16s%2Fg%2F11cn5p5hyl", icon: "pin" }, { label: "Talete", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Talete+Siracusa", icon: "parking" }, { label: "Sant'Antonio", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Molo+Sant%27Antonio+Siracusa", icon: "parking" }] },
        { h: "Unterirdisches Ortigia", p: "Unter der Insel liegt eine zweite Stadt, die fast niemand zu sehen bekommt.\n• [[Ipogeo di Piazza Duomo]], ein Labyrinth aus Gängen und Zisternen, in den Fels gehauen und während der Bombenangriffe von 1943 als Schutzraum genutzt: Der Eingang liegt an der Piazza Duomo, wieder ans Tageslicht kommen Sie am Lungomare Alfeo\n• [[Miqwè]], das jüdische Ritualbad, 18 Meter unter der Straße in den Fels gegraben und von einer Quelle gespeist: Es zählt zu den besterhaltenen Europas und kann nur mit Führung besichtigt werden", actions: [{ label: "Ipogeo di Piazza Duomo", href: "https://www.google.com/maps/search/?api=1&query=Ipogeo+di+Piazza+Duomo+Siracusa", icon: "pin" }, { label: "Miqwè", href: "https://www.google.com/maps/search/?api=1&query=Miqwe+Bagno+Ebraico+Ortigia+Siracusa", icon: "pin" }] },
        { h: "Archäologischer Park Neapolis", p: "Nur 5 Gehminuten entfernt: einer der wichtigsten Besuche der Stadt. Er umfasst das [[Teatro Greco]], das [[Anfiteatro Romano]], die [[Latomie]], das [[Orecchio di Dionisio]] und den [[Ara di Ierone]]. Im Sommer besser früh am Morgen.", actions: [{ label: "Karte öffnen", href: "https://www.google.com/maps/search/?api=1&query=Parco+Archeologico+Neapolis+Siracusa", icon: "pin" }] },
        { h: "Veranstaltungen & Aufführungen", p: "Von Mai bis Juli finden im Griechischen Theater die klassischen INDA-Aufführungen statt; im Sommer wird Ortigia mit Konzerten und Straßenkünstlern lebendig.", actions: [{ label: "INDA-Programm", href: "https://www.indafondazione.org", icon: "calendar" }] },
        { h: "Museen & Kirchen", p: "Das Regionale Archäologische Museum [[Paolo Orsi]], hervorragend für griechische, römische und prähistorische Geschichte; die eindrucksvollen [[Catacombe di San Giovanni]]; das [[Santuario della Madonna delle Lacrime]], ein modernes und sehr markantes Gebäude in der Stadtsilhouette.\n\nIn Ortigia bewahrt die [[Galleria di Palazzo Bellomo]] die Verkündigung von Antonello da Messina.\n\n[[Das Begräbnis der heiligen Lucia]] von Caravaggio hängt in der [[Basilica di Santa Lucia al Sepolcro]], in einem Viertel außerhalb von Ortigia. [i]Achtung: Viele Reiseführer verorten das Gemälde noch immer in der kleinen Kirche an der Piazza Duomo, wo es jahrelang zu sehen war. Seit 2020 ist es nicht mehr dort.[/i]", actions: [{ label: "Paolo Orsi", href: "https://www.google.com/maps/search/?api=1&query=Museo+Archeologico+Paolo+Orsi+Siracusa", icon: "pin" }, { label: "Catacombe S. Giovanni", href: "https://www.google.com/maps/search/?api=1&query=Catacombe+di+San+Giovanni+Siracusa", icon: "pin" }, { label: "Madonna delle Lacrime", href: "https://www.google.com/maps/search/?api=1&query=Santuario+Madonna+delle+Lacrime+Siracusa", icon: "pin" }, { label: "Palazzo Bellomo", href: "https://www.google.com/maps/search/?api=1&query=Galleria+Regionale+Palazzo+Bellomo+Siracusa", icon: "pin" }, { label: "Caravaggio — S. Lucia al Sepolcro", href: "https://www.google.com/maps/search/?api=1&query=Basilica+Santa+Lucia+al+Sepolcro+Siracusa", icon: "pin" }] }
      ]
    },
    {
      id: "restaurants", icon: "pizza",
      title: "Essen & Trinken",
      sub: "Die besten Adressen, alle zu Fuß erreichbar",
      intro: "Hier die besten Adressen, zu Fuß erreichbar vom Via dei Mandorli 12. Tipp: Am Wochenende empfehlen wir zu reservieren!",
      items: [
        { h: "🍕 Pizzerien", list: [{ n: "Pizzeria da Marco", sub: "Via dei Tigli, 5", tel: "+39 000 000 0000" }, { n: "La Forneria", sub: "Via delle Rose, 12", tel: "+39 000 000 0000" }, { n: "Forno Antico", sub: "Piazza Grande, 7", tel: "+39 000 000 0000" }] },
        { h: "🍽️ Restaurants", list: [{ n: "Trattoria del Borgo", sub: "Via del Mare, 8", tel: "+39 000 000 0000" }, { n: "Osteria Antica", sub: "Piazza Centrale, 3", tel: "+39 000 000 0000" }, { n: "Locanda dei Tigli", sub: "Via dei Tigli, 20", tel: "+39 000 000 0000" }] },
        { h: "🐟 Fisch", list: [{ n: "Il Pescatore", sub: "Via del Porto, 20", tel: "+39 000 000 0000" }, { n: "La Sirena", sub: "Lungomare, 2", tel: "+39 000 000 0000" }] },
        { h: "🥂 Aperitifs", list: [{ n: "Bar Centrale", sub: "Piazza Grande, 1", tel: "+39 000 000 0000" }, { n: "Terrazza Blu", sub: "Via Belvedere, 9", tel: "+39 000 000 0000" }] },
        { h: "🍰 Süßes & Kaffee", list: [{ n: "Caffè delle Palme", sub: "Corso Principale, 45", tel: "+39 000 000 0000" }, { n: "Forno Dolce", sub: "Via Roma, 30", tel: "+39 000 000 0000" }] }
      ]
    },
    {
      id: "excursions", icon: "beach",
      title: "Meer & Ausflüge",
      sub: "Von den städtischen Buchten bis zu den Naturschutzgebieten",
      intro: "Von den städtischen Buchten bis zu den Naturschutzgebieten: So genießen Sie das Meer und die Umgebung.",
      items: [
        { h: "Meer, Felsen und Strandbäder", p: "Das Plemmirio, ein Meeresschutzgebiet südlich von Siracusa, ist perfekt für Felsen, Schnorcheln und sauberes Meer. In Ortigia badet man auch von den Felsen und den Sonnenterrassen der Uferpromenade Levante, nur wenige Schritte vom Zentrum entfernt.", list: [{ n: "Varco 23", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Varco+23+Plemmirio+Siracusa" }, { n: "Plemmirio Reserve", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Plemmirio+Reserve+Siracusa" }, { n: "Fly Beach", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Fly+Beach+Ortigia+Siracusa" }, { n: "Zefiro Solarium", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Zefiro+Solarium+Ortigia+Siracusa" }, { n: "Cala Rossa", sub: "Ortigia · Felsen", map: "https://www.google.com/maps/search/?api=1&query=Cala+Rossa+Ortigia+Siracusa" }, { n: "Forte Vigliena", sub: "Ortigia · Felsen", map: "https://www.google.com/maps/search/?api=1&query=Forte+Vigliena+Ortigia+Siracusa" }, { n: "Cala Zaffiro", sub: "Plemmirio · 25 Min.", map: "https://www.google.com/maps/search/?api=1&query=Cala+Zaffiro+Plemmirio+Siracusa" }] },
        { h: "Strände und Strandbäder", p: "Die Strände von Arenella und Fontane Bianche sind am bequemsten für einen Strandtag: Sand und Service. Das Naturschutzgebiet Vendicari, etwas weiter südlich, ist empfehlenswert, wenn Sie Auto und Zeit haben.", list: [{ n: "Lido Arenella", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Arenella+Siracusa" }, { n: "Lido Le Nereidi", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Le+Nereidi+Siracusa" }, { n: "Kukua Beach", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Kukua+Beach+Fontane+Bianche+Siracusa" }, { n: "Lido Sayonara", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Lido+Sayonara+Fontane+Bianche+Siracusa" }, { n: "Agua Beach", sub: "San Lorenzo", map: "https://www.google.com/maps/search/?api=1&query=Agua+Beach+San+Lorenzo+Siracusa" }, { n: "Lido San Lorenzo", sub: "San Lorenzo · 50 Min.", map: "https://www.google.com/maps/search/?api=1&query=Lido+San+Lorenzo+Siracusa" }, { n: "Lido Camomilla", sub: "Fontane Bianche · 30 Min.", map: "https://www.google.com/maps/search/?api=1&query=Lido+Camomilla+Fontane+Bianche+Siracusa" }, { n: "Calamosche", sub: "Naturschutzgebiet · 45 Min.", map: "https://www.google.com/maps/search/?api=1&query=Spiaggia+Calamosche+Vendicari" }, { n: "Vendicari", sub: "Naturschutzgebiet · 50 Min. · empfohlen", map: "https://www.google.com/maps/search/?api=1&query=Riserva+Vendicari" }, { n: "Portopalo di Capopassero", sub: "1 Stunde · Kitesurfen", map: "https://www.google.com/maps/search/?api=1&query=Portopalo+di+Capo+Passero" }] },
        { h: "Empfohlene Umgebung", p: "Die Nekropole von Pantalica, zusammen mit Siracusa UNESCO-Welterbe, umfasst über 5.000 in den Fels gehauene Gräber und liegt etwa 40 km von der Stadt entfernt. Noto, Hauptstadt des sizilianischen Barocks, ist perfekt für einen halben Tag. Marzamemi ist ein sehr malerisches Fischerdorf, touristischer, aber angenehm.", actions: [{ label: "Pantalica", href: "https://www.google.com/maps/search/?api=1&query=Necropoli+di+Pantalica", icon: "pin" }, { label: "Noto", href: "https://www.google.com/maps/search/?api=1&query=Noto+Siracusa", icon: "pin" }, { label: "Marzamemi", href: "https://www.google.com/maps/search/?api=1&query=Marzamemi", icon: "pin" }] },
        { h: "Ausflüge, Boot und Tauchen", p: "Bootstouren, Ausflüge und Tauchgänge mit einheimischen Guides. Sie können auch ein Schlauchboot mieten, mit oder ohne Skipper.", actions: [{ label: "Ausflüge — Francesco Corbino", href: "+39 340 134 1244", type: "tel", icon: "phone" }, { label: "Bootstour — Papyrus", href: "+39 338 721 2142", type: "tel", icon: "phone" }, { label: "Tauchen und Boote — Fabio Portella", href: "+39 333 132 4030", type: "tel", icon: "phone" }, { label: "Schlauchboote — Pietro Urzì", href: "+39 338 889 0866", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "taxi", icon: "taxi",
      title: "Taxi & Transport",
      sub: "Unterwegs ohne Auto",
      items: [
        { h: "Kostenlose Stadt-Shuttles", p: "Drei [[völlig kostenlose]] Shuttle-Linien verbinden die Parkplätze und das Zentrum bis spät in die Nacht: super praktisch, um Ortigia ohne Parkplatzsorgen zu erreichen.\nMo–Sa 17:00–02:00 Uhr · Sonntag 08:00–02:00 Uhr (etwa alle 20 Minuten).\n\n🔴 Rote Linie «Teocrito» — vom Parkplatz Von Platen nach Ortigia, über die [[Neapolis]] und das [[Museo Paolo Orsi]].\n[i]Von Platen → Viale Cadorna → Piazza della Vittoria → Corso Gelone → Piazzale Marconi → Via Malta → Piazza Pancali → Corso Umberto → Viale Teracati → Viale Teocrito → Von Platen.[/i]\n\n🔵 Blaue Linie «Elorina» — vom Parkplatz Elorina nach Ortigia, über das [[Foro Siracusano]].\n[i]Elorina → Piazzale Marconi → Via Malta → Ponte S. Lucia → Via Chindemi → Piazza Pancali → Ponte Umbertino → Corso Umberto → Foro Siracusano → Via Elorina → Elorina.[/i]\n\n🟢 Grüne Linie «Ortigia» — eine komplette Runde um die Insel [[Ortigia]].\n[i]Talete → Riva della Posta → Via dei Mille → Parcheggio Marina → Passeggio Aretusa → Castello Maniace → Lungomare di Levante → Largo della Gancia → Via Nizza → Belvedere S. Giacomo → Talete.[/i]", img: "assets/city/navette-mappa.png" },
        { h: "Taxiservice", p: "[[Radio Taxi Siracusa]], rund um die Uhr in der ganzen Stadt verfügbar. Alternativ [[Enzo Salvi]], unser Taxifahrer des Vertrauens (auch als Mietwagen mit Fahrer): freundlich und pünktlich, ideal für Transfers von und zum Flughafen. Ein weiterer zuverlässiger Kontakt ist [[Pietro Gatto]].", actions: [{ label: "Radio Taxi", href: "{taxiPhone}", type: "tel", icon: "phone" }, { label: "Enzo Salvi", href: "+39 338 708 7223", type: "tel", icon: "phone" }, { label: "Pietro Gatto", href: "+39 340 753 1581", type: "tel", icon: "phone" }] },
        { h: "Vom Flughafen Catania", p: "Die bequemste und günstigste Option ist der [[Direktbus]] von Interbus nach Siracusa: etwa 55–70 Minuten, Ticket 4 bis 8 €. Derselbe Bus bringt Sie bei der Abreise zurück zum Flughafen. Alternativ Taxi oder privater Transfer (fragen Sie uns oder Enzo Salvi). Unten finden Sie auch die Fahrpläne der Stadtbusse von Siracusa.", actions: [{ label: "Ticket kaufen (Interbus)", href: "https://www.interbus.it", icon: "info" }, { label: "Fahrpläne Stadtbusse", href: "https://www.saisautolinee.it/linee-urbane-sicilia/siracusa", icon: "info" }] },
        { h: "E-Bikes und E-Scooter", p: "Mit der App [[ELERENT]] mieten Sie E-Bikes und E-Scooter direkt über Ihr Handy: eine 100% elektrische Flotte, die Tarife starten in der Regel bei 1 € Freischaltung plus 0,25 € pro Minute. Sie funktioniert in über 50 Städten in Italien, Spanien, Griechenland und Malta.", actions: [{ label: "ELERENT für iPhone", href: "https://apps.apple.com/it/app/elerent/id1518090808", icon: "info" }, { label: "ELERENT für Android", href: "https://play.google.com/store/apps/details?id=com.elerent.elerent", icon: "info" }] },
        { h: "Roller- und Autovermietung", p: "Ortigia Rent Siracusa — Roller- und Autovermietung.", actions: [{ label: "Anrufen", href: "+39 0931 962217", type: "tel", icon: "phone" }, { label: "Webseite", href: "https://www.ortigiarentsiracusa.it", icon: "info" }] }
      ]
    },
    {
      id: "info", icon: "info",
      title: "Nützliche Informationen",
      sub: "Services und Notfälle",
      items: [
        { h: "Einkaufen und Wasser", p: "Der praktischste Supermarkt ist der Maxistore Decò, im Corso Gelone 29, nur wenige Gehminuten entfernt; für Wasser und Dinge des täglichen Bedarfs sind auch die kleinen Läden im Viertel praktisch.\n\nWenn die Geschäfte geschlossen haben, bleiben zwei Automatenshops, [[rund um die Uhr]] geöffnet, für Kaffee und Getränke:\n• [[Distributori Automatici H24]] — Via Senatore Giuseppe Maielli, 6\n• [[Oasi 24/7]] — Via Malta, 32", actions: [{ label: "Maxistore Decò", href: "https://www.google.com/maps/search/?api=1&query=Maxistore+Dec%C3%B2+Corso+Gelone+29+Siracusa", icon: "pin" }, { label: "Distributori H24", href: "https://www.google.com/maps/search/?api=1&query=Distributori+Automatici+H24+Via+Senatore+Giuseppe+Maielli+6+Siracusa", icon: "pin" }, { label: "Oasi 24/7", href: "https://www.google.com/maps/search/?api=1&query=Oasi+24%2F7+Via+Malta+32+Siracusa", icon: "pin" }] },
        { h: "Geldautomat", p: "Mehrere Geldautomaten (ATM) befinden sich am Corso Gelone und in Ortigia, in kurzer Entfernung.", actions: [{ label: "Nächster Geldautomat", href: "https://www.google.com/maps/search/bancomat+ATM+Corso+Gelone+Siracusa", icon: "pin" }] },
        { h: "Apotheke und Krankenhaus", p: "Mehrere Apotheken sind wenige Gehminuten entfernt, am Corso Gelone und in Ortigia (nachts und an Feiertagen ist der Bereitschaftsdienst im Schaufenster ausgehängt, oder fragen Sie uns). Die Notaufnahme befindet sich im Ospedale Umberto I, in der Via Testaferrata.", actions: [{ label: "Apotheke", href: "https://www.google.com/maps/search/farmacia+Corso+Gelone+Siracusa", icon: "pin" }, { label: "Ospedale Umberto I", href: "https://www.google.com/maps/search/?api=1&query=Ospedale+Umberto+I+Siracusa", icon: "pin" }] },
        { h: "Notrufnummern", p: "[[112]] — Einheitliche europäische Notrufnummer (Polizei, Krankenwagen, Feuerwehr)\n[[118]] — Medizinischer Notfall (Krankenwagen)\n[[1530]] — Notfall auf See (Küstenwache)", actions: [{ label: "112", href: "112", type: "tel", icon: "phone" }, { label: "118", href: "118", type: "tel", icon: "phone" }, { label: "1530", href: "1530", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "extras", icon: "sparkle",
      title: "Services & Extras",
      sub: "Fragen Sie uns einfach, wir kümmern uns um alles",
      intro: "Wünschen Sie eine maßgeschneiderte An- oder Abreise, einen Transfer oder einen Ausflug? Tippen Sie auf den gewünschten Service: Die Nachricht erreicht uns bereits vorbereitet, und wir antworten Ihnen mit Verfügbarkeit und Preis.",
      items: [
        { h: "Transfer vom und zum Flughafen", p: "Wir organisieren für Sie den Transfer vom und zum Flughafen Catania mit einem Fahrer unseres Vertrauens – besonders praktisch bei sehr frühen oder sehr späten Flügen.", actions: [{ label: "Transfer anfragen", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Hallo! Ich möchte gerne einen Transfer vom/zum Flughafen Catania organisieren. Hier die Flugdaten:" }] },
        { h: "Später Check-out", p: "Reisen Sie erst am Nachmittag ab? Wenn das Zimmer frei bleibt, können wir es Ihnen ein paar Stunden länger überlassen.", actions: [{ label: "Späten Check-out anfragen", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Hallo! Ich möchte gerne einen späteren Check-out anfragen, falls möglich. Meine Abreise ist gegen:" }] },
        { h: "Früher Check-in und Gepäckaufbewahrung", p: "Kommen Sie früh an oder reisen Sie spät ab? Wir können Ihr Gepäck verwahren und Sie, wenn das Zimmer bereit ist, schon früher hineinlassen.", actions: [{ label: "Infos anfragen", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Hallo! Ich möchte gerne einen früheren Check-in oder mein Gepäck abstellen. Ich komme an/reise ab gegen:" }] },
        { h: "Ausflüge, Boot und Touren", p: "Bootsausflüge, Stadttouren und Tauchgänge: Wir bringen Sie mit unseren Partnern des Vertrauens in Kontakt.", actions: [{ label: "Ausflug anfragen", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Hallo! Ich hätte gerne Informationen zu Ausflügen, Bootstouren oder Touren." }] }
      ]
    },
    {
      id: "faq", icon: "info",
      title: "Häufige Fragen",
      sub: "Praktische Antworten, immer griffbereit",
      items: [
        { h: "Klimaanlage", p: "Die Fernbedienung liegt im Zimmer: Schalten Sie die Klimaanlage gerne ein, wenn Sie da sind, und aus, wenn Sie gehen, so verbrauchen wir nur das Nötige. Bei Problemen schreiben Sie uns einfach." },
        { h: "Warmwasser", p: "Warmwasser steht Ihnen jederzeit zur Verfügung. Sollte Ihnen etwas auffallen, sagen Sie uns sofort Bescheid, und wir kümmern uns darum." },
        { h: "Mülltrennung", p: "Syrakus sammelt den Müll direkt an der Haustür ab. Wir bitten Sie, den Abfall so zu trennen:\n• [[Bioabfall]] — Montag, Mittwoch, Freitag\n• [[Kunststoff und Metall]] — Dienstag\n• [[Restmüll]] — Donnerstag\n• [[Papier, Karton und Glas]] — Samstag\nWo und zu welcher Uhrzeit die Beutel bereitzustellen sind, fragen Sie uns einfach: Wir helfen Ihnen gerne.", actions: [{ label: "Gemeinde-Kalender", href: "https://www.siracusadifferenzia.it", icon: "info" }] },
        { h: "Ruhezeiten", p: "Nach 23:00 Uhr bitten wir Sie, den Lärm zu dämpfen, aus Rücksicht auf die anderen Gäste und die Nachbarn. Vielen Dank!" },
        { h: "Etwas nicht gefunden?", p: "Schreiben Sie uns zu jeder Uhrzeit per WhatsApp: Wir sind für Sie da.", actions: [{ label: "Schreiben Sie uns per WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "review", icon: "star",
      title: "Hinterlassen Sie eine Bewertung",
      sub: "Ihre Unterstützung ist uns wertvoll",
      items: [
        { h: "Hat es Ihnen gefallen?", p: "Wenn Sie sich wohlgefühlt haben, ist eine Google-Bewertung für uns sehr wertvoll: Wir sind eine neue Leitung und wissen, dass die aktuelle Bewertung uns nicht widerspiegelt. Wir tun wirklich alles, um Ihren Aufenthalt unvergesslich zu machen. Herzlichen Dank! 💛", actions: [{ label: "Google-Bewertung abgeben", href: "{reviewUrl}", icon: "star", style: "accent" }] },
        { h: "Stimmt etwas nicht?", p: "Sagen Sie es uns sofort per WhatsApp, auch nachts: Wir möchten es lieber gleich beheben, als es später zu erfahren.", actions: [{ label: "Schreiben Sie uns per WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "contacts", icon: "phone",
      title: "Kontakt",
      sub: "Wir sind immer für Sie da",
      items: [
        { h: "WhatsApp, Telegram, Viber", p: "Der schnellste Weg, uns zu erreichen.", actions: [{ label: "WhatsApp öffnen", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Telefon", p: "Für Dringendes und schnelle Nachrichten.", actions: [{ label: "Anrufen", href: "{phone}", type: "tel", icon: "phone", onlyIf: "phone" }, { label: "Weitere Nummer", href: "{phoneGreta}", type: "tel", icon: "phone", onlyIf: "phoneGreta" }] },
        { h: "E-Mail", p: "{email}", actions: [{ label: "E-Mail schreiben", href: "{email}", type: "mail", icon: "info" }] },
        { h: "Kommen Sie wieder!", p: "Buchen Sie direkt für Ihre nächsten Aufenthalte: Wiederkehrenden Gästen bieten wir stets die bestmögliche Behandlung.", actions: [{ label: "Online buchen", href: "{bookingUrl}", icon: "calplus" }, { label: "Per WhatsApp buchen", href: "{whatsapp}", type: "wa", icon: "chat", style: "secondary" }] }
      ]
    }
  ]
};
