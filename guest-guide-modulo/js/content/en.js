// ============================================================
//  CONTENT IN ENGLISH
//  Placeholders like {whatsapp} are replaced automatically
//  with the values from config.js
// ============================================================

window.I18N = window.I18N || {};

window.I18N.en = {
  ui: {
    back: "Back",
    footer: "We wish you a wonderful stay!",
    copy: "Copy password",
    copied: "Password copied!",
    wifiNetwork: "Network",
    wifiPassword: "Password",
    quickWifi: "WiFi",
    quickWhatsapp: "WhatsApp",
    quickMap: "Map",
    quickEmergency: "Emergencies",
    codeSuffix: "+ the centre button",
    codeMissing: "The code comes with the personal link we send you before arrival. If you cannot find it, just message us.",
    footerSocial: "Follow us and stay in touch",
    wifiQrHint: "Swipe for the QR ›",
    wifiQrCaption: "Scan me"
  },

  home: {
    title: "Your guide",
    subtitle: "Everything you need, from arrival to departure.",
    welcomeTitle: "Welcome,",
    welcome: [
      "we are truly delighted to have you!",
      "This guide will help you discover the city and make the most of your stay. Our team is here for anything you need.",
      "Enjoy your stay!"
    ]
  },

  groups: [
    { title: "Your arrival", sections: ["checkin", "breakfast", "wifi"] },
    { title: "Discover Syracuse", sections: ["attractions", "restaurants", "excursions"] },
    { title: "Useful services", sections: ["taxi", "info", "faq", "extras", "contacts", "review"] }
  ],

  // Property-specific sections (override). Sections not listed here
  // stay shared (city content is the same for everyone).
  sectionsByProperty: {
    centralperk: {
      checkin: {
        id: "checkin", icon: "key",
        title: "Arrival & Self Check-in",
        sub: "How to get into B&B Central Perk",
        intro: "You can arrive at your leisure. Here is how to get into Central Perk.",
        steps: [
          { h: "Where we are", p: "Central Perk — Via Antioco 13, a side street off Corso Gelone, right by the UniCredit bank (Corso Gelone 30).", actions: [{ label: "Central Perk", href: "{mapsUrl}", icon: "pin" }] },
          { h: "Open the main door", p: "To the left of the main door there is a black and grey key safe: enter the code below, take the key and open the door. Then please put the key back in its place.", codeKey: "gateCode", codeAfter: "#" },
          { h: "Come up to the B&B", p: "Once inside, go up the stairs and turn right: at the end on the right you will find the entrance door of the B&B. Between the two doors there are two key safes." },
          { h: "Your keys — room 1", p: "Open the [[top]] key safe with the code below and take your set of keys. Your room, number 1, is right there.", codeKey: "doorCode", codeAfter: "#", onlyRooms: ["1"] },
          { h: "Your keys — rooms 2, 3 and 4", hPersonal: "Your keys — room {roomNums}", hPersonalPlural: "Your keys — rooms {roomNums}", p: "Open the [[bottom]] key safe with the code below, use the key to open the entrance door and then please put it back in the safe. Your set of keys is hanging on your room door: the key with the black grip is for the entrance door, the third one is for the main door downstairs.", pPersonal: "Open the [[bottom]] key safe with the code below, use the key to open the entrance door and then please put it back in the safe. Your room is number {roomNum}: your set of keys is hanging on its door. The key with the black grip is for the entrance door, the third one is for the main door downstairs.", pPersonalPlural: "Open the [[bottom]] key safe with the code below, use the key to open the entrance door and then please put it back in the safe. Your rooms are {roomNum}: each set of keys is hanging on the door of the matching room. The key with the black grip is for the entrance door, the third one is for the main door downstairs.", codeKey: "doorCode2", codeAfter: "#", exceptRooms: ["1"] },
          { h: "Let me know", p: "Send me a message when you get to your room and let me know that everything is fine. For anything you need, any request or information, write to me at any time, here on WhatsApp.", actions: [{ label: "Message us on WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ],
        amenitiesTitle: "Your room amenities",
        amenitiesIntro: "We have taken care of every detail to make your rest perfect.",
        amenities: [
          { icon: "snow", label: "Air conditioning" },
          { icon: "tv", label: "Smart TV" },
          { icon: "sparkle", label: "Courtesy set" },
          { icon: "wind", label: "Hairdryer" },
          { icon: "towel", label: "Fresh linen" },
          { icon: "balcony", label: "Private balcony" }, { icon: "coffee", label: "Coffee machine", onlyRooms: ["3", "4"] }
        ],
        gallery: true,
        items: [
          { h: "Shared kitchen and coffee", p: "In the hall you have a small shared kitchen, free for all our guests: fridge, kettle, microwave, a still and sparkling water dispenser and a coffee machine. The coffee is our own blend, do give it a try!" },
          { h: "Parking", p: "Parking is easy to find on the street near the B&B and it is free. Alternatively, 50 metres away there is a private paid car park, the \"Parcheggio Gelone\".", actions: [{ label: "Parcheggio Gelone", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Gelone+Siracusa", icon: "parking" }] },
          { h: "Documents", p: "For registration we need the documents of all guests: just a photo, front and back, on WhatsApp, even before arrival.", pIf: { docsUrl: "For registration we need the documents of all guests: you can [[upload them yourself]] on the portal, using the button below. It only takes a moment, even before you arrive, and there is nothing else to send us." }, actions: [{ label: "Upload your documents", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Send documents", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
          { h: "Check-out & tourist tax", p: "Check-out {checkoutTime}. The Syracuse tourist tax is 4% of the cost of the stay, up to a maximum of €5 per person per night and for the first 7 nights. Children under 14 do not pay: you can leave it in the room. Thank you!", pIf: { taxFixed: "Check-out {checkoutTime}. The Syracuse tourist tax is around €2 per person per night, for the first 7 nights. Children under 14 do not pay: you can leave it in the room. Thank you!" } },
          { h: "No smoking 🚭", p: "Smoking is not allowed inside the B&B or in the rooms. Thank you for your cooperation!" }
        ]
      },
      breakfast: {
        id: "breakfast", icon: "coffee",
        title: "Your breakfast",
        sub: "At the partner bars nearby, with vouchers",
        intro: "Breakfast is served at the partner bars nearby, from 7:00 am for as long as you like. You will find the vouchers on the desk or on the bedside table in your room.",
        steps: [
          { h: "Every day (except Saturday) — Milk and Coffee", p: "Corso Gelone 22, right below the building.", notice: { until: "2026-08-08", text: "🌴 Closed for holidays from 25 July to 8 August: during this period breakfast is at [[Bar Euripide]] (Piazza Euripide 25)." }, actions: [{ label: "Open in Google Maps", href: "https://www.google.com/maps/search/?api=1&query=Milk+and+Coffee+Corso+Gelone+Siracusa", icon: "pin" }] },
          { h: "Saturday — Bar Euripide", p: "Piazza Euripide 25, a three-minute walk away.", actions: [{ label: "Open in Google Maps", href: "https://www.google.com/maps/search/?api=1&query=Bar+Euripide+Piazza+Euripide+Siracusa", icon: "pin" }] }
        ]
      },
      contacts: {
        id: "contacts", icon: "phone",
        title: "Contacts",
        sub: "We are always here for you",
        items: [
          { h: "WhatsApp, Telegram, Viber", p: "The fastest way to reach us.", actions: [{ label: "Open WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
          { h: "Phone", p: "For urgent matters and quick messages.", actions: [{ label: "Stefano", href: "{phone}", type: "tel", icon: "phone" }, { label: "Greta", href: "{phoneGreta}", type: "tel", icon: "phone" }] },
          { h: "Email", p: "{email}", actions: [{ label: "Write an email", href: "{email}", type: "mail", icon: "info" }] },
          { h: "Come back and see us!", p: "Book directly for your next stays: returning guests always get the very best treatment we can offer.", actions: [{ label: "Book on WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ]
      }
    }
  },

  sections: [
    {
      id: "checkin", icon: "key",
      title: "Arrival & Self Check-in",
      sub: "How to reach us and get into your room",
      gallery: true,
      intro: "You can arrive at your leisure from 3.00 pm.",
      steps: [
        { h: "Where we are", p: "{address}. You will find us just after the church of Santa Rita, on the right (grey gate).", actions: [{ label: "B&B Spigolehouse", href: "{mapsUrl}", icon: "pin" }] },
        { h: "Parking", p: "You have a reserved parking space in the inner courtyard. To enter the courtyard, type the code on the keypad below the intercom and press the centre button. Spaces are not assigned: park wherever you like within the marked areas.", codeKey: "gateCode", parkOnly: true },
        { h: "Parking", p: "Your booking shows that you have not booked parking. If you need it, contact us to check availability: the cost is €6 per night.", actions: [{ label: "Contact us on WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }], noParkOnly: true },
        { h: "Pedestrian entrance", p: "To enter on foot, type the code on the keypad below the intercom and press the centre button.", codeKey: "doorCode", noParkOnly: true },
        { h: "Access to the floors", p: "For the inner door and the key box on your floor, type the code followed by the 2 side buttons.", codeKey: "doorCode", codeSuffix: "+ the 2 side buttons" },
        { h: "Welcome to your room!", p: "You will find the keys hanging right on your room door. Settle in and relax!", pPersonal: "Your room is number {roomNum}: you will find the keys hanging right on the door. Settle in and relax!", pPersonalPlural: "Your rooms are {roomNum}: you will find the keys hanging right on each door. Settle in and relax!" }
      ],
      amenitiesTitle: "Your room amenities",
      amenitiesIntro: "We have taken care of every detail to make your rest perfect.",
      amenities: [
        { icon: "snow", label: "Air conditioning" },
        { icon: "tv", label: "Smart TV" },
        { icon: "sparkle", label: "Courtesy set" },
        { icon: "coffee", label: "Coffee machine" },
        { icon: "wind", label: "Hairdryer" },
        { icon: "towel", label: "Fresh linen" },
        { icon: "iron", label: "Iron" },
        { icon: "balcony", label: "Private balcony" }
      ],
      items: [
        { h: "Breakfast and common area", p: "On your floor there is a common area with a fridge, water dispenser and coffee machine. On the desk you will find your breakfast vouchers: tap here to discover where and how.", actions: [{ label: "Go to breakfast", href: "#/breakfast", icon: "coffee" }] },
        { h: "Room servicing 🌿", p: "The room is tidied and the linen changed every two days: a choice made to avoid wasting water, a precious resource, and to respect the environment and the island hosting you. If your towels are still fine, hang them back up: we only change them when you leave them in the shower or the sink. And if you need something sooner — clean towels or an extra tidy-up — just message us, no problem at all. Thank you!", actions: [{ label: "Message us on WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Documents", p: "For registration we need the documents of all guests: just a photo, front and back, here on WhatsApp too, even before arrival.", pIf: { docsUrl: "For registration we need the documents of all guests: you can [[upload them yourself]] on the portal, using the button below. It only takes a moment, even before you arrive, and there is nothing else to send us." }, actions: [{ label: "Upload your documents", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Send documents", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
        { h: "Check-out & tourist tax", p: "Check-out {checkoutTime}: leave the keys hanging on the room door, just as you found them on arrival. The Syracuse tourist tax is 4% of the cost of the stay, up to a maximum of €5 per person per night and for the first 7 nights. Children under 14 do not pay. You can leave the amount on the desk. Thank you!", pIf: { taxFixed: "Check-out {checkoutTime}: leave the keys hanging on the room door, just as you found them on arrival. The Syracuse tourist tax is around €2 per person per night, for the first 7 nights. Children under 14 do not pay. You can leave the amount on the desk. Thank you!" } },
        { h: "No smoking 🚭", p: "Smoking is not allowed inside the B&B or in the rooms. Thank you for your cooperation!" }
      ]
    },
    {
      id: "wifi", icon: "wifi",
      title: "Free WiFi",
      sub: "Network and password",
      intro: "Select the network and connect in one tap. Copy the password below or scan the QR code.",
      items: []
    },
    {
      id: "breakfast", icon: "coffee",
      title: "Your breakfast",
      sub: "At the best bars nearby, with vouchers",
      intro: "Breakfast is served at the best bars nearby. Use the vouchers you will find on your room desk and freely choose one of the three partner bars, whichever you prefer each day — Monday to Sunday, from 7:30 am with no time limit.",
      steps: [
        { h: "Bar Ulma", p: "Via Giuseppe Testaferrata, 18 — just steps from us — [u]Closed on Sundays[/u]", actions: [{ label: "Open in Google Maps", href: "https://www.google.com/maps/place/Bar+Ulma/@37.0728936,15.2826342,17z/data=!3m1!4b1!4m6!3m5!1s0x1313ce9bea0ad7f9:0x27634dfbce8517a3!8m2!3d37.0728936!4d15.2826342!16s%2Fg%2F1tj70tqr", icon: "pin" }] },
        { h: "Bar Milano", p: "Via Giuseppe di Natale, 16 — gluten-free and lactose-free options available — [u]Closed on Sundays[/u]", actions: [{ label: "Open in Google Maps", href: "https://www.google.com/maps/place/Bar+Milano/@37.0722014,15.2836088,17z/data=!3m1!4b1!4m6!3m5!1s0x1313ce9be3177055:0x79dbcf2cb6326ec4!8m2!3d37.0722014!4d15.2836088!16s%2Fg%2F11b6j85d63", icon: "pin" }] },
        { h: "Blend | La Miscela del Gusto", p: "Corso Gelone, 77 — [u]Closed on Tuesdays[/u]", actions: [{ label: "Open in Google Maps", href: "https://www.google.com/maps/place/Blend+-+La+miscela+del+gusto/@37.0713338,15.2829346,17z/data=!3m1!4b1!4m6!3m5!1s0x1313cfb2a11c99cb:0xaec137875a966b3f!8m2!3d37.0713338!4d15.2829346!16s%2Fg%2F11r_x62945", icon: "pin" }] }
      ]
    },
    {
      id: "attractions", icon: "temple",
      title: "Explore Syracuse",
      sub: "History within easy reach",
      photos: [
        "assets/city/hero-ortigia.jpg",
        "assets/city/hero-fontana.jpg",
        "assets/city/hero-ristoranti.jpg",
        "assets/city/hero-eventi.jpg",
        "assets/city/hero-attrazioni.jpg"
      ],
      intro: "From B&B {guideName} history is within easy reach: here is what not to miss.",
      items: [
        { h: "Ortigia, the historic heart", p: "• [[Piazza Duomo e il Duomo di Siracusa]], built incorporating the ancient Greek temple of Athena\n• [[Fonte Aretusa]], a freshwater spring just metres from the sea\n• [[Tempio di Apollo]], among the oldest Greek remains on the island\n• [[Castello Maniace]], a Frederician fortress by the sea\n• [[Lungomare di Levante e di Ponente]], beautiful at sunset\n• [[Mercato di Ortigia]], perfect in the morning for street food, fish, fruit, spices and local produce\n\n[i]By car: the island is largely a limited-traffic zone, so to visit the old town at ease leave the car at the Talete car park (multi-storey, open 24h) or at Molo Sant'Antonio (a large car park served by convenient shuttles).[/i]", actions: [{ label: "Ortigia", href: "https://www.google.com/maps/place/Ponte+Umberto+I/@37.0646512,15.2886735,17z/data=!3m1!4b1!4m6!3m5!1s0x1313cc1fe67aa495:0x68b768548ca7a0fa!8m2!3d37.0646469!4d15.2912484!16s%2Fg%2F11cn5p5hyl", icon: "pin" }, { label: "Talete", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Talete+Siracusa", icon: "parking" }, { label: "Sant'Antonio", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Molo+Sant%27Antonio+Siracusa", icon: "parking" }] },
        { h: "Underground Ortigia", p: "Beneath the island lies a second city, one that hardly anyone gets to see.\n• [[Ipogeo di Piazza Duomo]], a maze of tunnels and cisterns carved into the rock, used as a shelter during the 1943 bombings: you go in from Piazza Duomo and come back out on the Lungomare Alfeo\n• [[Miqwè]], the Jewish ritual bath dug 18 metres below street level and fed by a natural spring: it is among the best preserved in Europe and can only be visited with a guide", actions: [{ label: "Ipogeo di Piazza Duomo", href: "https://www.google.com/maps/search/?api=1&query=Ipogeo+di+Piazza+Duomo+Siracusa", icon: "pin" }, { label: "Miqwè", href: "https://www.google.com/maps/search/?api=1&query=Miqwe+Bagno+Ebraico+Ortigia+Siracusa", icon: "pin" }] },
        { h: "Neapolis Archaeological Park", p: "Just a 5-minute walk away: one of the city's most important visits. It includes the [[Teatro Greco]], [[Anfiteatro Romano]], [[Latomie]], [[Orecchio di Dionisio]] and [[Ara di Ierone]]. In summer, go early in the morning.", actions: [{ label: "Open in Google Maps", href: "https://www.google.com/maps/search/?api=1&query=Parco+Archeologico+Neapolis+Siracusa", icon: "pin" }] },
        { h: "Events & performances", p: "From May to July the Greek Theatre hosts the classical INDA performances; in summer Ortigia comes alive with concerts and street artists.", actions: [{ label: "INDA programme", href: "https://www.indafondazione.org", icon: "calendar" }] },
        { h: "Museums & churches", p: "The [[Paolo Orsi]] Regional Archaeological Museum, excellent for Greek, Roman and prehistoric history; the striking [[Catacombe di San Giovanni]]; the [[Santuario della Madonna delle Lacrime]], a modern building and a landmark on the city skyline.\n\nIn Ortigia, the [[Galleria di Palazzo Bellomo]] is home to the Annunciation by Antonello da Messina.\n\nCaravaggio's [[Burial of Saint Lucy]] hangs in the [[Basilica di Santa Lucia al Sepolcro]], in the district just outside Ortigia. [i]Do note: many guidebooks still place it in the little church on Piazza Duomo, where it hung for years. Since 2020 it is no longer there.[/i]", actions: [{ label: "Paolo Orsi", href: "https://www.google.com/maps/search/?api=1&query=Museo+Archeologico+Paolo+Orsi+Siracusa", icon: "pin" }, { label: "Catacombe S. Giovanni", href: "https://www.google.com/maps/search/?api=1&query=Catacombe+di+San+Giovanni+Siracusa", icon: "pin" }, { label: "Madonna delle Lacrime", href: "https://www.google.com/maps/search/?api=1&query=Santuario+Madonna+delle+Lacrime+Siracusa", icon: "pin" }, { label: "Palazzo Bellomo", href: "https://www.google.com/maps/search/?api=1&query=Galleria+Regionale+Palazzo+Bellomo+Siracusa", icon: "pin" }, { label: "Caravaggio — S. Lucia al Sepolcro", href: "https://www.google.com/maps/search/?api=1&query=Basilica+Santa+Lucia+al+Sepolcro+Siracusa", icon: "pin" }] }
      ]
    },
    {
      id: "restaurants", icon: "pizza",
      title: "Where to eat & drink",
      sub: "The best spots, all walkable from here",
      intro: "Here are the best places within walking distance of Corso Gelone 93. Tip: at weekends, we suggest booking!",
      items: [
        { h: "🍕 Pizzerias", list: [{ n: "Piano B", sub: "Via Cairoli, 18 · Ortigia", tel: "+39 0931 66851" }, { n: "Era Ora", sub: "Riva Garibaldi, 10 · Ortigia", tel: "+39 327 0113454" }, { n: "Oleum", sub: "Via dei Candelai, 21 · Ortigia", tel: "+39 0931 1567295" }, { n: "Anima e Core", sub: "Via Claudio Mario Arezzo, 9 · Ortigia", tel: "+39 0931 66506" }, { n: "Il Nazionale", sub: "Cassibile, 20′ by car", tel: "+39 333 5724811" }, { n: "Il Matto", sub: "Via Francesco Crispi, 21", tel: "+39 0931 1852741" }, { n: "Meditè", sub: "Riva Porto Lachio", tel: "+39 351 6769819" }, { n: "Schiticchio", sub: "Via Cavour, 30 · Ortigia", tel: "+39 331 3343721" }] },
        { h: "🍽️ Restaurants", list: [{ n: "Agape", sub: "Corso Umberto I, 50", tel: "+39 376 2265068" }, { n: "aLevante", sub: "Largo della Gancia, 5 · Ortigia", tel: "+39 349 0763996" }, { n: "Ranieri", sub: "Piazza San Giuseppe, 8 · Ortigia", tel: "+39 328 2015715" }, { n: "Locanda Maniace", sub: "Via Castello Maniace, 52 · Ortigia", tel: "+39 0931 61308" }, { n: "Vin dell'Assassin", sub: "Via Roma, 115 · Ortigia", tel: "+39 0931 66159" }, { n: "Tavernetta da Piero", sub: "Via Cavour, 59 · Ortigia", tel: "+39 0931 1855291" }, { n: "Gusto", sub: "Corso Gelone, 33b", tel: "+39 0931 465080" }, { n: "Latteria Mamma Iabica", sub: "Via G.B. Perasso, 13", tel: "+39 333 1893176" }, { n: "Locanda Colibrì", sub: "Via Garigliano, 15", tel: "+39 0931 64797" }, { n: "City Life", sub: "Via Cairoli, 9 · Ortigia", tel: "+39 0931 62971" }, { n: "Time Out", sub: "Via Somalia, 10", tel: "+39 366 5494979" }, { n: "A Putia di Giugiò", sub: "Via Saverio Landolina, 21 · Ortigia", tel: "+39 329 7695764" }, { n: "A Putia", sub: "Via Roma, 8 · Ortigia", tel: "+39 334 3524585" }, { n: "Osteria Mariano", sub: "Vicolo Zuccalà, 9 · Ortigia", tel: "+39 0931 67444" }, { n: "MOON — Move Ortigia Out of Normality", sub: "Via Roma, 114 · Ortigia · 100% vegan", tel: "+39 334 257 1002" }] },
        { h: "🐟 Fish", list: [{ n: "Taverna Russo", sub: "Via Vittorio Veneto, 22 · Ortigia", tel: "+39 0931 314900" }, { n: "Astrattu", sub: "Via del Porto Grande, 6", tel: "+39 347 7740548" }, { n: "La Locandiera", sub: "Via Capodieci, 6 · Ortigia", tel: "+39 331 4954218" }, { n: "Fuori Ortigia", sub: "Via Tripoli, 6", tel: "+39 0931 093690" }, { n: "Il Tiranno", sub: "Viale Montedoro, 78", tel: "+39 0931 581528" }, { n: "La Lisca", sub: "Viale Montedoro, 95", tel: "+39 0931 1623944" }, { n: "Kaleido Terrace", sub: "Via Pompeo Picherali, 10 · Ortigia", tel: "+39 388 8336182" }, { n: "Area M", sub: "Riva Nazario Sauro, 6 · Ortigia", tel: "+39 0931 21367" }] },
        { h: "🥂 Aperitifs", list: [{ n: "Barcollo", sub: "Via Pompeo Picherali, 10 · Ortigia", tel: "+39 0931 24580" }, { n: "Boats", sub: "Via dell'Apollonion, 5 · Ortigia · overlooking the Temple of Apollo", tel: "+39 328 8818373" }, { n: "Cortile Verga", sub: "Via della Maestranza, 33 · Ortigia", tel: "+39 0931 61440" }, { n: "Sunset", sub: "Lungomare Alfeo · Ortigia", tel: "+39 392 6652014" }, { n: "Fratelli Burgio", sub: "Mercato di Ortigia", tel: "+39 0931 60069" }, { n: "AfC Atmosphere", sub: "Via Brenta, 26", tel: "+39 345 2797189" }, { n: "Moon Bar", sub: "Via Roma, 112 · Ortigia", tel: "+39 0931 449516" }, { n: "Kaleido Terrace", sub: "Via Pompeo Picherali, 10 · Ortigia", tel: "+39 388 8336182" }, { n: "Burgio Al Porto", sub: "Foro V. Emanuele II, 6 · Ortigia", tel: "+39 347 5392104" }] },
        { h: "🍰 Sweets & coffee", list: [{ n: "Caffè Apollo", sub: "Largo XXV Luglio, 13 · Ortigia", tel: "+39 327 8506419" }, { n: "Brancato", sub: "Via Grottasanta, 219", tel: "+39 0931 442702" }, { n: "Artale", sub: "Via Saverio Landolina, 32 · Ortigia", tel: "+39 0931 21829" }, { n: "Marciante", sub: "Via Saverio Landolina, 7 · Ortigia", tel: "+39 0931 67384" }, { n: "Uccello", sub: "Via Monte Pellegrino, 23", tel: "+39 0931 740784" }, { n: "Filingeri", sub: "Via Rosolini, 12", tel: "+39 0931 757833" }] }
      ]
    },
    {
      id: "excursions", icon: "beach",
      title: "Sea & excursions",
      sub: "From city coves to nature reserves",
      intro: "From city coves to nature reserves, here is how to enjoy the sea and the surroundings.",
      items: [
        { h: "Sea, rocks and lidos", p: "The Plemmirio, a protected marine area south of Syracuse, is perfect for rocks, snorkelling and clean sea. In Ortigia you can also swim from the rocks and the solariums along the Levante seafront, just steps from the centre.", list: [{ n: "Varco 23", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Varco+23+Plemmirio+Siracusa" }, { n: "Plemmirio Reserve", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Plemmirio+Reserve+Siracusa" }, { n: "Fly Beach", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Fly+Beach+Ortigia+Siracusa" }, { n: "Zefiro Solarium", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Zefiro+Solarium+Ortigia+Siracusa" }, { n: "Cala Rossa", sub: "Ortigia · rocks", map: "https://www.google.com/maps/search/?api=1&query=Cala+Rossa+Ortigia+Siracusa" }, { n: "Forte Vigliena", sub: "Ortigia · rocks", map: "https://www.google.com/maps/search/?api=1&query=Forte+Vigliena+Ortigia+Siracusa" }, { n: "Cala Zaffiro", sub: "Plemmirio · 25 min", map: "https://www.google.com/maps/search/?api=1&query=Cala+Zaffiro+Plemmirio+Siracusa" }] },
        { h: "Beaches and lidos", p: "The beaches of Arenella and Fontane Bianche are the handiest for a beach day: sand and services. The Vendicari Reserve, a bit further south, is recommended if you have a car and time.", list: [{ n: "Lido Arenella", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Arenella+Siracusa" }, { n: "Lido Le Nereidi", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Le+Nereidi+Siracusa" }, { n: "Kukua Beach", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Kukua+Beach+Fontane+Bianche+Siracusa" }, { n: "Lido Sayonara", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Lido+Sayonara+Fontane+Bianche+Siracusa" }, { n: "Agua Beach", sub: "San Lorenzo", map: "https://www.google.com/maps/search/?api=1&query=Agua+Beach+San+Lorenzo+Siracusa" }, { n: "Lido San Lorenzo", sub: "San Lorenzo · 50 min", map: "https://www.google.com/maps/search/?api=1&query=Lido+San+Lorenzo+Siracusa" }, { n: "Lido Camomilla", sub: "Fontane Bianche · 30 min", map: "https://www.google.com/maps/search/?api=1&query=Lido+Camomilla+Fontane+Bianche+Siracusa" }, { n: "Calamosche", sub: "reserve · 45 min", map: "https://www.google.com/maps/search/?api=1&query=Spiaggia+Calamosche+Vendicari" }, { n: "Vendicari", sub: "reserve · 50 min · recommended", map: "https://www.google.com/maps/search/?api=1&query=Riserva+Vendicari" }, { n: "Portopalo di Capopassero", sub: "1 hour · kitesurfing", map: "https://www.google.com/maps/search/?api=1&query=Portopalo+di+Capo+Passero" }] },
        { h: "Recommended surroundings", p: "The Pantalica Necropolis, a UNESCO site together with Syracuse, holds over 5,000 tombs carved into the rock and is about 40 km from the city. Noto, capital of Sicilian Baroque, is perfect for half a day. Marzamemi is a very scenic fishing village, more touristy but pleasant.", actions: [{ label: "Pantalica", href: "https://www.google.com/maps/search/?api=1&query=Necropoli+di+Pantalica", icon: "pin" }, { label: "Noto", href: "https://www.google.com/maps/search/?api=1&query=Noto+Siracusa", icon: "pin" }, { label: "Marzamemi", href: "https://www.google.com/maps/search/?api=1&query=Marzamemi", icon: "pin" }] },
        { h: "Excursions, boat and diving", p: "Boat trips, excursions and dives with local guides. You can also hire a dinghy, with or without a skipper.", actions: [{ label: "Excursions — Francesco Corbino", href: "+39 340 134 1244", type: "tel", icon: "phone" }, { label: "Boat trip — Papyrus", href: "+39 338 721 2142", type: "tel", icon: "phone" }, { label: "Diving and boats — Fabio Portella", href: "+39 333 132 4030", type: "tel", icon: "phone" }, { label: "Dinghy hire — Pietro Urzì", href: "+39 338 889 0866", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "taxi", icon: "taxi",
      title: "Taxi & transport",
      sub: "Getting around without a car",
      items: [
        { h: "Free city shuttles", p: "Three [[completely free]] shuttle lines connect car parks and the centre until late at night: super handy for reaching Ortigia with no parking hassle.\nMon–Sat 5:00 pm–2:00 am · Sunday 8:00 am–2:00 am (about every 20 minutes).\n\n🔴 Red Line «Teocrito» — from Von Platen car park to Ortigia, via [[Neapolis]] and the [[Museo Paolo Orsi]].\n[i]Von Platen → Viale Cadorna → Piazza della Vittoria → Corso Gelone → Piazzale Marconi → Via Malta → Piazza Pancali → Corso Umberto → Viale Teracati → Viale Teocrito → Von Platen.[/i]\n\n🔵 Blue Line «Elorina» — from Elorina car park to Ortigia, via the [[Foro Siracusano]].\n[i]Elorina → Piazzale Marconi → Via Malta → Ponte S. Lucia → Via Chindemi → Piazza Pancali → Ponte Umbertino → Corso Umberto → Foro Siracusano → Via Elorina → Elorina.[/i]\n\n🟢 Green Line «Ortigia» — a full loop around the island of [[Ortigia]].\n[i]Talete → Riva della Posta → Via dei Mille → Parcheggio Marina → Passeggio Aretusa → Castello Maniace → Lungomare di Levante → Largo della Gancia → Via Nizza → Belvedere S. Giacomo → Talete.[/i]", img: "assets/city/navette-mappa.png" },
        { h: "Taxi service", p: "[[Radio Taxi Siracusa]], available 24/7 across the city. Alternatively [[Enzo Salvi]], our trusted taxi driver (private hire too): kind and punctual, great for transfers to and from the airport. Another reliable contact is [[Pietro Gatto]].", actions: [{ label: "Radio Taxi", href: "{taxiPhone}", type: "tel", icon: "phone" }, { label: "Enzo Salvi", href: "+39 338 708 7223", type: "tel", icon: "phone" }, { label: "Pietro Gatto", href: "+39 340 753 1581", type: "tel", icon: "phone" }] },
        { h: "From Catania airport", p: "The handiest and cheapest option is the [[direct Interbus]] to Syracuse: about 55–70 minutes, ticket €4 to €8. The same bus takes you back to the airport when you leave. Alternatively a taxi or private transfer (ask us or Enzo Salvi). Below you will also find the timetables for Syracuse city buses.", actions: [{ label: "Buy your ticket (Interbus)", href: "https://www.interbus.it", icon: "info" }, { label: "City bus timetables", href: "https://www.saisautolinee.it/linee-urbane-sicilia/siracusa", icon: "info" }] },
        { h: "E-bikes and e-scooters", p: "With the [[ELERENT]] app you can rent electric bikes and scooters straight from your phone: a 100% electric fleet, with rates usually starting at €1 to unlock plus €0.25 per minute. It works in over 50 cities across Italy, Spain, Greece and Malta.", actions: [{ label: "ELERENT for iPhone", href: "https://apps.apple.com/it/app/elerent/id1518090808", icon: "info" }, { label: "ELERENT for Android", href: "https://play.google.com/store/apps/details?id=com.elerent.elerent", icon: "info" }] },
        { h: "Scooter and car rental", p: "Ortigia Rent Siracusa — scooter and car rental.", actions: [{ label: "Call", href: "+39 0931 962217", type: "tel", icon: "phone" }, { label: "Website", href: "https://www.ortigiarentsiracusa.it", icon: "info" }] }
      ]
    },
    {
      id: "info", icon: "info",
      title: "Useful information",
      sub: "Services and emergencies",
      items: [
        { h: "Groceries & water", p: "The handiest supermarket is Maxistore Decò, at Corso Gelone 29, a few minutes' walk away; for water and essentials the small neighbourhood markets are handy too.\n\nWhen the shops are closed, two vending points stay open [[24 hours a day]] for coffee and drinks:\n• [[Distributori Automatici H24]] — Via Senatore Giuseppe Maielli, 6\n• [[Oasi 24/7]] — Via Malta, 32", actions: [{ label: "Maxistore Decò", href: "https://www.google.com/maps/search/?api=1&query=Maxistore+Dec%C3%B2+Corso+Gelone+29+Siracusa", icon: "pin" }, { label: "Distributori H24", href: "https://www.google.com/maps/search/?api=1&query=Distributori+Automatici+H24+Via+Senatore+Giuseppe+Maielli+6+Siracusa", icon: "pin" }, { label: "Oasi 24/7", href: "https://www.google.com/maps/search/?api=1&query=Oasi+24%2F7+Via+Malta+32+Siracusa", icon: "pin" }] },
        { h: "ATM", p: "Several cash machines (ATMs) can be found on Corso Gelone and in Ortigia, a short distance away.", actions: [{ label: "Nearest ATM", href: "https://www.google.com/maps/search/bancomat+ATM+Corso+Gelone+Siracusa", icon: "pin" }] },
        { h: "Pharmacy & hospital", p: "Several pharmacies are a few minutes' walk away, on Corso Gelone and in Ortigia (at night and on holidays the on-duty rota is shown in the window, or just ask us). The A&E is at Umberto I Hospital, on Via Testaferrata.", actions: [{ label: "Pharmacy", href: "https://www.google.com/maps/search/farmacia+Corso+Gelone+Siracusa", icon: "pin" }, { label: "Umberto I Hospital", href: "https://www.google.com/maps/search/?api=1&query=Ospedale+Umberto+I+Siracusa", icon: "pin" }] },
        { h: "Emergency numbers", p: "[[112]] — Single European emergency number (police, ambulance, fire brigade)\n[[118]] — Medical emergency (ambulance)\n[[1530]] — Sea emergency (Coast Guard)", actions: [{ label: "112", href: "112", type: "tel", icon: "phone" }, { label: "118", href: "118", type: "tel", icon: "phone" }, { label: "1530", href: "1530", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "extras", icon: "sparkle",
      title: "Services & extras",
      sub: "Just ask us — we take care of everything",
      intro: "Would you like a tailor-made arrival or departure, a transfer or a day trip? Tap the service: the message reaches us ready to send, and we reply with availability and cost.",
      items: [
        { h: "Airport transfer", p: "We can arrange your transfer to and from Catania airport with a trusted driver, especially handy for very early or very late flights.", actions: [{ label: "Request a transfer", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Hi! I'd like to arrange a transfer to/from Catania airport. Here are my flight details:" }] },
        { h: "Late check-out", p: "Leaving in the afternoon? If the room stays free, we can let you keep it for a few extra hours.", actions: [{ label: "Ask for late check-out", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Hi! I'd like to ask for a late check-out, if possible. My departure is around:" }] },
        { h: "Early check-in & luggage storage", p: "Arriving early or leaving late? We can look after your luggage and, if the room is ready, let you in earlier.", actions: [{ label: "Ask for info", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Hi! I'd like an early check-in or to leave my luggage. I arrive/leave around:" }] },
        { h: "Excursions, boat and tours", p: "Boat trips, city tours and diving: we put you in touch with our trusted partners.", actions: [{ label: "Request an excursion", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Hi! I'd like some information about excursions, boat trips or tours." }] }
      ]
    },
    {
      id: "faq", icon: "info",
      title: "Frequently asked questions",
      sub: "The practical answers, close at hand",
      items: [
        { h: "Air conditioning", p: "The remote is in your room: feel free to switch it on while you are inside and off when you go out, so we use just the right amount. For any problem, just message us." },
        { h: "Hot water", p: "Hot water is available at all times. If you notice anything not quite right, let us know straight away and we will sort it out." },
        { h: "Waste sorting", p: "Syracuse has kerbside waste collection. We kindly ask you to separate your waste like this:\n• [[Food / organic waste]] — Monday, Wednesday, Friday\n• [[Plastic and metals]] — Tuesday\n• [[General waste]] — Thursday\n• [[Paper, cardboard and glass]] — Saturday\nFor where and at what time to put the bags out, just ask us: we are happy to help.", actions: [{ label: "Council calendar", href: "https://www.siracusadifferenzia.it", icon: "info" }] },
        { h: "Quiet hours", p: "After 11:00 pm we kindly ask you to keep the noise down, out of respect for the other guests and the neighbours. Thank you!" },
        { h: "Can't find something?", p: "Message us on WhatsApp at any time: we are here to help.", actions: [{ label: "Message us on WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "review", icon: "star",
      title: "Leave a review",
      sub: "Your support means a lot to us",
      items: [
        { h: "Did you enjoy your stay?", p: "If you had a good time, a Google review is incredibly valuable to us: we are a new management and we know the current rating does not reflect us. We are truly doing everything to make your stay unforgettable. Thank you so much! 💛", actions: [{ label: "Leave a Google review", href: "{reviewUrl}", icon: "star", style: "accent" }] },
        { h: "Something wrong?", p: "Tell us right away on WhatsApp, even at night: we would rather fix it on the spot than find out later.", actions: [{ label: "Message us on WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "contacts", icon: "phone",
      title: "Contacts",
      sub: "We are always here for you",
      items: [
        { h: "WhatsApp, Telegram, Viber", p: "The fastest way to reach us.", actions: [{ label: "Open WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Phone", p: "For urgent matters and quick messages.", actions: [{ label: "Greta", href: "{phoneGreta}", type: "tel", icon: "phone" }, { label: "Andrea", href: "{phone}", type: "tel", icon: "phone" }] },
        { h: "Email", p: "{email}", actions: [{ label: "Write an email", href: "{email}", type: "mail", icon: "info" }] },
        { h: "Come back and see us!", p: "Book directly for your next stays: returning guests always get the very best treatment we can offer.", actions: [{ label: "Book online", href: "{bookingUrl}", icon: "calplus" }, { label: "Book on WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat", style: "secondary" }] }
      ]
    }
  ]
};
