// ============================================================
//  CONTENU EN FRANÇAIS
//  Les balises comme {whatsapp} sont remplacées automatiquement
//  par les valeurs de config.js
// ============================================================

window.I18N = window.I18N || {};

window.I18N.fr = {
  ui: {
    back: "Retour",
    footer: "Nous vous souhaitons un merveilleux séjour !",
    copy: "Copier le mot de passe",
    copied: "Mot de passe copié !",
    wifiNetwork: "Réseau",
    wifiPassword: "Mot de passe",
    quickWifi: "WiFi",
    quickWhatsapp: "WhatsApp",
    quickMap: "Carte",
    quickEmergency: "Urgences",
    codeSuffix: "+ le bouton central",
    codeMissing: "Le code arrive avec le lien personnel que nous vous envoyons avant votre arrivée. Si vous ne le trouvez pas, écrivez-nous.",
    footerSocial: "Suivez-nous et restez en contact",
    wifiQrHint: "Faites défiler pour le QR ›",
    wifiQrCaption: "Scannez-moi"
  },

  home: {
    title: "Votre guide",
    subtitle: "Tout ce dont vous avez besoin, de l'arrivée au départ.",
    welcomeTitle: "Bienvenue,",
    welcome: [
      "nous sommes vraiment heureux de vous accueillir !",
      "Ce guide vous aidera à découvrir la ville et à profiter au mieux de votre séjour. Notre équipe est à votre disposition pour tout besoin.",
      "Bon séjour !"
    ]
  },

  groups: [
    { title: "Votre arrivée", sections: ["checkin", "breakfast", "wifi"] },
    { title: "Découvrir Syracuse", sections: ["attractions", "restaurants", "excursions"] },
    { title: "Services utiles", sections: ["taxi", "info", "faq", "extras", "contacts", "review"] }
  ],

  // Sections spécifiques par structure (override). Les sections non listées
  // ici restent partagées (contenus ville identiques pour tous).
  sectionsByProperty: {
    centralperk: {
      checkin: {
        id: "checkin", icon: "key",
        title: "Arrivée et check-in autonome",
        sub: "Comment entrer au B&B Central Perk",
        intro: "Vous pouvez arriver en toute liberté. Voici comment entrer au Central Perk.",
        steps: [
          { h: "Où nous sommes", p: "Central Perk — Via Antioco 13, une rue perpendiculaire au Corso Gelone, à hauteur de la banque UniCredit (Corso Gelone 30).", actions: [{ label: "Central Perk", href: "{mapsUrl}", icon: "pin" }] },
          { h: "Ouvrez le portail", p: "À gauche du portail se trouve une boîte à clés noire et grise : tapez le code ci-dessous, prenez la clé et ouvrez le portail. Ensuite, remettez la clé à sa place, s'il vous plaît.", codeKey: "gateCode", codeAfter: "#" },
          { h: "Montez au B&B", p: "Une fois à l'intérieur, montez les escaliers et tournez à droite : tout au fond sur la droite se trouve la porte d'entrée du B&B. Entre les deux portes, vous trouverez deux boîtes à clés." },
          { h: "Vos clés — chambre 1", p: "Ouvrez la boîte [[du haut]] avec le code ci-dessous et prenez votre trousseau de clés. Votre chambre, la numéro 1, est juste là.", codeKey: "doorCode", codeAfter: "#", onlyRooms: ["1"] },
          { h: "Vos clés — chambres 2, 3 et 4", hPersonal: "Vos clés — chambre {roomNums}", hPersonalPlural: "Vos clés — chambres {roomNums}", p: "Ouvrez la boîte [[du bas]] avec le code ci-dessous, utilisez la clé pour ouvrir la porte d'entrée puis remettez-la dans la boîte, s'il vous plaît. Votre trousseau de clés est accroché à la porte de votre chambre : la clé à poignée noire est pour la porte d'entrée, la troisième pour le portail du bas.", pPersonal: "Ouvrez la boîte [[du bas]] avec le code ci-dessous, utilisez la clé pour ouvrir la porte d'entrée puis remettez-la dans la boîte, s'il vous plaît. Votre chambre est la numéro {roomNum} : votre trousseau de clés est accroché à sa porte. La clé à poignée noire est pour la porte d'entrée, la troisième pour le portail du bas.", pPersonalPlural: "Ouvrez la boîte [[du bas]] avec le code ci-dessous, utilisez la clé pour ouvrir la porte d'entrée puis remettez-la dans la boîte, s'il vous plaît. Vos chambres sont les {roomNum} : chaque trousseau de clés est accroché à la porte de la chambre correspondante. La clé à poignée noire est pour la porte d'entrée, la troisième pour le portail du bas.", codeKey: "doorCode2", codeAfter: "#", exceptRooms: ["1"] },
          { h: "Tenez-moi au courant", p: "Envoyez-moi un message dès que vous arrivez dans la chambre et dites-moi si tout va bien. Pour toute nécessité, demande ou information, écrivez-moi à n'importe quelle heure, ici sur WhatsApp.", actions: [{ label: "Écrivez-nous sur WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ],
        amenitiesTitle: "Les équipements de votre chambre",
        amenitiesIntro: "Nous avons soigné chaque détail pour rendre votre repos parfait.",
        amenities: [
          { icon: "snow", label: "Climatisation" },
          { icon: "tv", label: "Smart TV" },
          { icon: "sparkle", label: "Kit de courtoisie" },
          { icon: "wind", label: "Sèche-cheveux" },
          { icon: "towel", label: "Linge frais" },
          { icon: "balcony", label: "Balcon privé" }, { icon: "coffee", label: "Machine à café", onlyRooms: ["3", "4"] }
        ],
        gallery: true,
        items: [
          { h: "Cuisine commune et café", p: "Dans le hall, vous disposez d'une petite cuisine commune, à la disposition de tous : réfrigérateur, bouilloire, four à micro-ondes, distributeur d'eau plate et pétillante et une machine à café. Le café est de notre propre production, goûtez-le !" },
          { h: "Parking", p: "Le stationnement se trouve facilement dans la rue près du B&B et il est gratuit. Sinon, à 50 mètres, il y a un parking privé payant, le \"Parcheggio Gelone\".", actions: [{ label: "Parcheggio Gelone", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Gelone+Siracusa", icon: "parking" }] },
          { h: "Documents", p: "Pour l'enregistrement, il nous faut les documents de tous les hôtes : une simple photo recto-verso sur WhatsApp suffit, même avant l'arrivée.", pIf: { docsUrl: "Pour l'enregistrement, il nous faut les documents de tous les hôtes : vous pouvez [[les télécharger vous-mêmes]] sur le portail, avec le bouton ci-dessous. Cela ne prend qu'un instant, même avant l'arrivée, et vous n'avez rien d'autre à nous envoyer." }, actions: [{ label: "Télécharger vos documents", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Envoyer les documents", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
          { h: "Check-out et taxe de séjour", p: "Check-out {checkoutTime}. La taxe de séjour de Syracuse s'élève à 4 % du coût du séjour, avec un maximum de 5 € par personne et par nuit, pour les 7 premières nuits. Les enfants de moins de 14 ans ne paient pas : vous pouvez la laisser dans la chambre. Merci !", pIf: { taxFixed: "Check-out {checkoutTime}. La taxe de séjour de Syracuse est d'environ 2 € par personne et par nuit, pour les 7 premières nuits. Les enfants de moins de 14 ans ne paient pas : vous pouvez la laisser dans la chambre. Merci !" } },
          { h: "Non-fumeurs 🚭", p: "Il est interdit de fumer à l'intérieur du B&B et des chambres. Merci de votre collaboration !" }
        ]
      },
      breakfast: {
        id: "breakfast", icon: "coffee",
        title: "Votre petit-déjeuner",
        sub: "Dans les bars partenaires tout près, avec les bons",
        intro: "Le petit-déjeuner est servi dans les bars partenaires tout près, à partir de 7h00 et aussi tard que vous le souhaitez. Vous trouverez les bons sur le bureau ou sur la table de nuit de votre chambre.",
        steps: [
          { h: "Tous les jours (sauf le samedi) — Milk and Coffee", p: "Corso Gelone 22, exactement en bas de la structure.", notice: { until: "2026-08-08", text: "🌴 Fermé pour congés du 25 juillet au 8 août : pendant cette période, le petit-déjeuner est servi au [[Bar Euripide]] (Piazza Euripide 25)." }, actions: [{ label: "Ouvrir la carte", href: "https://www.google.com/maps/search/?api=1&query=Milk+and+Coffee+Corso+Gelone+Siracusa", icon: "pin" }] },
          { h: "Samedi — Bar Euripide", p: "Piazza Euripide 25, à trois minutes à pied.", actions: [{ label: "Ouvrir la carte", href: "https://www.google.com/maps/search/?api=1&query=Bar+Euripide+Piazza+Euripide+Siracusa", icon: "pin" }] }
        ]
      },
      contacts: {
        id: "contacts", icon: "phone",
        title: "Contacts",
        sub: "Nous sommes toujours à votre disposition",
        items: [
          { h: "WhatsApp, Telegram, Viber", p: "Le moyen le plus rapide de nous joindre.", actions: [{ label: "Ouvrir WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
          { h: "Téléphone", p: "Pour les urgences et les communications rapides.", actions: [{ label: "Appeler", href: "{phone}", type: "tel", icon: "phone", onlyIf: "phone" }, { label: "Autre numéro", href: "{phoneGreta}", type: "tel", icon: "phone", onlyIf: "phoneGreta" }] },
          { h: "Email", p: "{email}", actions: [{ label: "Écrire un email", href: "{email}", type: "mail", icon: "info" }] },
          { h: "Revenez nous voir !", p: "Réservez directement pour vos prochains séjours : aux hôtes qui reviennent, nous réservons toujours le meilleur traitement possible.", actions: [{ label: "Réserver sur WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ]
      }
    }
  },

  sections: [
    {
      id: "checkin", icon: "key",
      title: "Arrivée et check-in autonome",
      sub: "Comment nous rejoindre et entrer dans votre chambre",
      gallery: true,
      intro: "Vous pouvez arriver en toute liberté à partir de 15h00.",
      steps: [
        { h: "Où nous sommes", p: "{address}.", actions: [{ label: "{name}", href: "{mapsUrl}", icon: "pin" }] },
        { h: "Parking", p: "Vous avez une place de parking réservée dans la cour intérieure. Pour entrer dans la cour, tapez le code sur le clavier sous l'interphone et appuyez sur le bouton central. Les places ne sont pas attribuées : garez-vous où vous préférez dans les zones délimitées.", codeKey: "gateCode", parkOnly: true },
        { h: "Parking", p: "Selon votre réservation, vous n'avez pas réservé le parking. Si vous en avez besoin, contactez-nous pour vérifier la disponibilité : le coût est de 6 € par nuit.", actions: [{ label: "Contactez-nous sur WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }], noParkOnly: true },
        { h: "Entrée piétonne", p: "Pour entrer à pied, tapez le code sur le clavier sous l'interphone et appuyez sur le bouton central.", codeKey: "doorCode", noParkOnly: true },
        { h: "Accès aux étages", p: "Pour la porte intérieure et la boîte à clés à votre étage, tapez le code suivi des 2 boutons latéraux.", codeKey: "doorCode", codeSuffix: "+ les 2 boutons latéraux" },
        { h: "Bienvenue dans votre chambre !", p: "Vous trouverez les clés accrochées directement à la porte de votre chambre. Installez-vous et détendez-vous !", pPersonal: "Votre chambre est la numéro {roomNum} : vous trouverez les clés accrochées directement à la porte. Installez-vous et détendez-vous !", pPersonalPlural: "Vos chambres sont {roomNum} : vous trouverez les clés accrochées directement à chaque porte. Installez-vous et détendez-vous !" }
      ],
      amenitiesTitle: "Les équipements de votre chambre",
      amenitiesIntro: "Nous avons soigné chaque détail pour rendre votre repos parfait.",
      amenities: [
        { icon: "snow", label: "Climatisation" },
        { icon: "tv", label: "Smart TV" },
        { icon: "sparkle", label: "Kit de courtoisie" },
        { icon: "coffee", label: "Machine à café" },
        { icon: "wind", label: "Sèche-cheveux" },
        { icon: "towel", label: "Linge frais" },
        { icon: "iron", label: "Fer à repasser" },
        { icon: "balcony", label: "Balcon privé" }
      ],
      items: [
        { h: "Petit-déjeuner et espace commun", p: "À votre étage, vous disposez d'un espace commun avec réfrigérateur, distributeur d'eau et machine à café. Sur le bureau vous attendent les bons pour votre petit-déjeuner : touchez ici pour découvrir où et comment.", actions: [{ label: "Aller au petit-déjeuner", href: "#/breakfast", icon: "coffee" }] },
        { h: "Rangement de la chambre 🌿", p: "La chambre est rangée et le linge changé tous les deux jours : un choix pensé pour ne pas gaspiller l'eau, un bien précieux, et pour respecter l'environnement et l'île qui vous accueille. Si vos serviettes sont encore bonnes, raccrochez-les : nous ne les changeons que lorsque vous les laissez dans la douche ou le lavabo. Et si vous avez besoin de quelque chose avant — des serviettes propres ou un rangement supplémentaire — écrivez-nous, sans problème. Merci !", actions: [{ label: "Écrivez-nous sur WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Documents", p: "Pour l'enregistrement, il nous faut les documents de tous les hôtes : une simple photo recto-verso, ici aussi sur WhatsApp, même avant l'arrivée.", pIf: { docsUrl: "Pour l'enregistrement, il nous faut les documents de tous les hôtes : vous pouvez [[les télécharger vous-mêmes]] sur le portail, avec le bouton ci-dessous. Cela ne prend qu'un instant, même avant l'arrivée, et vous n'avez rien d'autre à nous envoyer." }, actions: [{ label: "Télécharger vos documents", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Envoyer les documents", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
        { h: "Check-out et taxe de séjour", p: "Check-out {checkoutTime} : laissez les clés accrochées à la porte de la chambre, comme vous les avez trouvées à votre arrivée. La taxe de séjour de Syracuse s'élève à 4 % du coût du séjour, avec un maximum de 5 € par personne et par nuit, pour les 7 premières nuits. Les enfants de moins de 14 ans ne paient pas. Vous pouvez laisser le montant sur le bureau. Merci !", pIf: { taxFixed: "Check-out {checkoutTime} : laissez les clés accrochées à la porte de la chambre, comme vous les avez trouvées à votre arrivée. La taxe de séjour de Syracuse est d'environ 2 € par personne et par nuit, pour les 7 premières nuits. Les enfants de moins de 14 ans ne paient pas. Vous pouvez laisser le montant sur le bureau. Merci !" } },
        { h: "Non-fumeurs 🚭", p: "Il est interdit de fumer à l'intérieur du B&B et des chambres. Merci de votre collaboration !" }
      ]
    },
    {
      id: "wifi", icon: "wifi",
      title: "WiFi gratuit",
      sub: "Réseau et mot de passe",
      intro: "Sélectionnez le réseau et connectez-vous en un geste. Copiez le mot de passe ci-dessous ou scannez le QR code.",
      items: []
    },
    {
      id: "breakfast", icon: "coffee",
      title: "Votre petit-déjeuner",
      sub: "Dans les meilleurs bars tout près, avec les bons",
      intro: "Le petit-déjeuner est servi dans les meilleurs bars des environs. Utilisez les bons que vous trouvez sur le bureau de votre chambre et choisissez librement l'un des trois bars partenaires, celui que vous préférez chaque jour — du lundi au dimanche, à partir de 7h30 et sans limite d'horaire.",
      steps: [
        { h: "Caffè Aurora", p: "Via dei Tigli, 3 — à deux pas de chez nous — [u]Fermé le dimanche[/u]", actions: [{ label: "Ouvrir la carte", href: "https://www.google.com/maps/search/?api=1&query=bar+colazione", icon: "pin" }] },
        { h: "Bar Centrale", p: "Piazza Grande, 1 — options sans gluten et sans lactose disponibles — [u]Fermé le dimanche[/u]", actions: [{ label: "Ouvrir la carte", href: "https://www.google.com/maps/search/?api=1&query=bar+colazione", icon: "pin" }] },
        { h: "Pasticceria Bella Epoca", p: "Corso Principale, 45 — [u]Fermé le mardi[/u]", actions: [{ label: "Ouvrir la carte", href: "https://www.google.com/maps/search/?api=1&query=pasticceria", icon: "pin" }] }
      ]
    },
    {
      id: "attractions", icon: "temple",
      title: "Explorer Syracuse",
      sub: "L'histoire à portée de main",
      photos: [
        "assets/city/hero-ortigia.jpg",
        "assets/city/hero-fontana.jpg",
        "assets/city/hero-ristoranti.jpg",
        "assets/city/hero-eventi.jpg",
        "assets/city/hero-attrazioni.jpg"
      ],
      intro: "Depuis le B&B {guideName}, l'histoire est à portée de main : voici ce qu'il ne faut pas manquer.",
      items: [
        { h: "Ortigia, le cœur historique", p: "• [[Piazza Duomo e il Duomo di Siracusa]], construit en intégrant l'ancien temple grec d'Athéna\n• [[Fonte Aretusa]], source d'eau douce à quelques mètres de la mer\n• [[Tempio di Apollo]], parmi les plus anciens vestiges grecs de l'île\n• [[Castello Maniace]], forteresse de Frédéric II au bord de la mer\n• [[Lungomare di Levante e di Ponente]], magnifiques au coucher du soleil\n• [[Mercato di Ortigia]], idéal le matin pour la street food, le poisson, les fruits, les épices et les produits locaux\n\n[i]En voiture : l'île est en grande partie une zone à circulation limitée ; pour visiter le centre historique tranquillement, laissez la voiture au parking Talete (couvert, ouvert 24h/24) ou au Molo Sant'Antonio (grand parking desservi par des navettes pratiques).[/i]", actions: [{ label: "Ortigia", href: "https://www.google.com/maps/place/Ponte+Umberto+I/@37.0646512,15.2886735,17z/data=!3m1!4b1!4m6!3m5!1s0x1313cc1fe67aa495:0x68b768548ca7a0fa!8m2!3d37.0646469!4d15.2912484!16s%2Fg%2F11cn5p5hyl", icon: "pin" }, { label: "Talete", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Talete+Siracusa", icon: "parking" }, { label: "Sant'Antonio", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Molo+Sant%27Antonio+Siracusa", icon: "parking" }] },
        { h: "Ortigia souterraine", p: "Sous l'île se cache une seconde ville, que presque personne ne voit.\n• [[Ipogeo di Piazza Duomo]], un labyrinthe de galeries et de citernes creusées dans la roche, utilisé comme abri pendant les bombardements de 1943 : on y entre depuis la Piazza Duomo et on ressort sur le Lungomare Alfeo\n• [[Miqwè]], le bain rituel juif creusé à 18 mètres sous la rue et alimenté par une source naturelle : il est parmi les mieux conservés d'Europe et ne se visite qu'accompagné", actions: [{ label: "Ipogeo di Piazza Duomo", href: "https://www.google.com/maps/search/?api=1&query=Ipogeo+di+Piazza+Duomo+Siracusa", icon: "pin" }, { label: "Miqwè", href: "https://www.google.com/maps/search/?api=1&query=Miqwe+Bagno+Ebraico+Ortigia+Siracusa", icon: "pin" }] },
        { h: "Parc archéologique de la Neapolis", p: "À seulement 5 minutes à pied : l'une des visites les plus importantes de la ville. Il comprend le [[Teatro Greco]], l'[[Anfiteatro Romano]], les [[Latomie]], l'[[Orecchio di Dionisio]] et l'[[Ara di Ierone]]. En été, mieux vaut y aller tôt le matin.", actions: [{ label: "Ouvrir la carte", href: "https://www.google.com/maps/search/?api=1&query=Parco+Archeologico+Neapolis+Siracusa", icon: "pin" }] },
        { h: "Événements et spectacles", p: "De mai à juillet, le Théâtre grec accueille les représentations classiques de l'INDA ; en été, Ortigia s'anime avec des concerts et des artistes de rue.", actions: [{ label: "Programme INDA", href: "https://www.indafondazione.org", icon: "calendar" }] },
        { h: "Musées et églises", p: "Le Musée archéologique régional [[Paolo Orsi]], excellent pour l'histoire grecque, romaine et préhistorique ; les impressionnantes [[Catacombe di San Giovanni]] ; le [[Santuario della Madonna delle Lacrime]], édifice moderne et très reconnaissable dans le paysage urbain.\n\nÀ Ortigia, la [[Galleria di Palazzo Bellomo]] conserve l'Annonciation d'Antonello da Messina.\n\nL'[[Enterrement de sainte Lucie]] de Caravaggio se trouve dans la [[Basilica di Santa Lucia al Sepolcro]], dans un quartier en dehors d'Ortigia. [i]Attention : de nombreux guides l'indiquent encore dans la petite église de la Piazza Duomo, où il est resté pendant des années. Depuis 2020, il ne s'y trouve plus.[/i]", actions: [{ label: "Paolo Orsi", href: "https://www.google.com/maps/search/?api=1&query=Museo+Archeologico+Paolo+Orsi+Siracusa", icon: "pin" }, { label: "Catacombe S. Giovanni", href: "https://www.google.com/maps/search/?api=1&query=Catacombe+di+San+Giovanni+Siracusa", icon: "pin" }, { label: "Madonna delle Lacrime", href: "https://www.google.com/maps/search/?api=1&query=Santuario+Madonna+delle+Lacrime+Siracusa", icon: "pin" }, { label: "Palazzo Bellomo", href: "https://www.google.com/maps/search/?api=1&query=Galleria+Regionale+Palazzo+Bellomo+Siracusa", icon: "pin" }, { label: "Caravaggio — S. Lucia al Sepolcro", href: "https://www.google.com/maps/search/?api=1&query=Basilica+Santa+Lucia+al+Sepolcro+Siracusa", icon: "pin" }] }
      ]
    },
    {
      id: "restaurants", icon: "pizza",
      title: "Où manger et boire",
      sub: "Les meilleures adresses, toutes accessibles à pied",
      intro: "Voici les meilleures adresses accessibles à pied depuis le Via dei Mandorli 12. Conseil : le week-end, nous vous suggérons de réserver !",
      items: [
        { h: "🍕 Pizzerias", list: [{ n: "Pizzeria da Marco", sub: "Via dei Tigli, 5", tel: "+39 000 000 0000" }, { n: "La Forneria", sub: "Via delle Rose, 12", tel: "+39 000 000 0000" }, { n: "Forno Antico", sub: "Piazza Grande, 7", tel: "+39 000 000 0000" }] },
        { h: "🍽️ Restaurants", list: [{ n: "Trattoria del Borgo", sub: "Via del Mare, 8", tel: "+39 000 000 0000" }, { n: "Osteria Antica", sub: "Piazza Centrale, 3", tel: "+39 000 000 0000" }, { n: "Locanda dei Tigli", sub: "Via dei Tigli, 20", tel: "+39 000 000 0000" }] },
        { h: "🐟 Poisson", list: [{ n: "Il Pescatore", sub: "Via del Porto, 20", tel: "+39 000 000 0000" }, { n: "La Sirena", sub: "Lungomare, 2", tel: "+39 000 000 0000" }] },
        { h: "🥂 Apéritifs", list: [{ n: "Bar Centrale", sub: "Piazza Grande, 1", tel: "+39 000 000 0000" }, { n: "Terrazza Blu", sub: "Via Belvedere, 9", tel: "+39 000 000 0000" }] },
        { h: "🍰 Desserts et café", list: [{ n: "Caffè delle Palme", sub: "Corso Principale, 45", tel: "+39 000 000 0000" }, { n: "Forno Dolce", sub: "Via Roma, 30", tel: "+39 000 000 0000" }] }
      ]
    },
    {
      id: "excursions", icon: "beach",
      title: "Mer et excursions",
      sub: "Des criques urbaines aux réserves naturelles",
      intro: "Des criques urbaines aux réserves naturelles, voici comment profiter de la mer et des environs.",
      items: [
        { h: "Mer, rochers et plages privées", p: "Le Plemmirio, aire marine protégée au sud de Syracuse, est parfait pour les rochers, le snorkeling et une mer propre. À Ortigia, on se baigne aussi depuis les rochers et les solariums du bord de mer de Levante, à deux pas du centre.", list: [{ n: "Varco 23", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Varco+23+Plemmirio+Siracusa" }, { n: "Plemmirio Reserve", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Plemmirio+Reserve+Siracusa" }, { n: "Fly Beach", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Fly+Beach+Ortigia+Siracusa" }, { n: "Zefiro Solarium", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Zefiro+Solarium+Ortigia+Siracusa" }, { n: "Cala Rossa", sub: "Ortigia · rochers", map: "https://www.google.com/maps/search/?api=1&query=Cala+Rossa+Ortigia+Siracusa" }, { n: "Forte Vigliena", sub: "Ortigia · rochers", map: "https://www.google.com/maps/search/?api=1&query=Forte+Vigliena+Ortigia+Siracusa" }, { n: "Cala Zaffiro", sub: "Plemmirio · 25 min", map: "https://www.google.com/maps/search/?api=1&query=Cala+Zaffiro+Plemmirio+Siracusa" }] },
        { h: "Plages et lidos", p: "Les plages de l'Arenella et de Fontane Bianche sont les plus pratiques pour une journée à la mer : sable et services. La Réserve de Vendicari, un peu plus au sud, est conseillée si vous avez une voiture et du temps.", list: [{ n: "Lido Arenella", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Arenella+Siracusa" }, { n: "Lido Le Nereidi", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Le+Nereidi+Siracusa" }, { n: "Kukua Beach", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Kukua+Beach+Fontane+Bianche+Siracusa" }, { n: "Lido Sayonara", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Lido+Sayonara+Fontane+Bianche+Siracusa" }, { n: "Agua Beach", sub: "San Lorenzo", map: "https://www.google.com/maps/search/?api=1&query=Agua+Beach+San+Lorenzo+Siracusa" }, { n: "Lido San Lorenzo", sub: "San Lorenzo · 50 min", map: "https://www.google.com/maps/search/?api=1&query=Lido+San+Lorenzo+Siracusa" }, { n: "Lido Camomilla", sub: "Fontane Bianche · 30 min", map: "https://www.google.com/maps/search/?api=1&query=Lido+Camomilla+Fontane+Bianche+Siracusa" }, { n: "Calamosche", sub: "réserve · 45 min", map: "https://www.google.com/maps/search/?api=1&query=Spiaggia+Calamosche+Vendicari" }, { n: "Vendicari", sub: "réserve · 50 min · conseillé", map: "https://www.google.com/maps/search/?api=1&query=Riserva+Vendicari" }, { n: "Portopalo di Capopassero", sub: "1 heure · kitesurf", map: "https://www.google.com/maps/search/?api=1&query=Portopalo+di+Capo+Passero" }] },
        { h: "Alentours conseillés", p: "La Nécropole de Pantalica, patrimoine UNESCO avec Syracuse, compte plus de 5 000 tombes creusées dans la roche et se trouve à environ 40 km de la ville. Noto, capitale du baroque sicilien, est parfaite pour une demi-journée. Marzamemi est un village de pêcheurs très pittoresque, plus touristique mais agréable.", actions: [{ label: "Pantalica", href: "https://www.google.com/maps/search/?api=1&query=Necropoli+di+Pantalica", icon: "pin" }, { label: "Noto", href: "https://www.google.com/maps/search/?api=1&query=Noto+Siracusa", icon: "pin" }, { label: "Marzamemi", href: "https://www.google.com/maps/search/?api=1&query=Marzamemi", icon: "pin" }] },
        { h: "Excursions, bateau et plongée", p: "Sorties en bateau, excursions et plongées avec des guides locaux. Vous pouvez aussi louer un semi-rigide, avec ou sans skipper.", actions: [{ label: "Excursions — Francesco Corbino", href: "+39 340 134 1244", type: "tel", icon: "phone" }, { label: "Sortie en bateau — Papyrus", href: "+39 338 721 2142", type: "tel", icon: "phone" }, { label: "Plongée et bateaux — Fabio Portella", href: "+39 333 132 4030", type: "tel", icon: "phone" }, { label: "Semi-rigides — Pietro Urzì", href: "+39 338 889 0866", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "taxi", icon: "taxi",
      title: "Taxi et transports",
      sub: "Se déplacer sans voiture",
      items: [
        { h: "Navettes gratuites en ville", p: "Trois lignes de navettes [[entièrement gratuites]] relient les parkings et le centre jusque tard dans la nuit : très pratiques pour rejoindre Ortigia sans souci de stationnement.\nLun–Sam 17h00–02h00 · Dimanche 08h00–02h00 (environ toutes les 20 minutes).\n\n🔴 Ligne Rouge « Teocrito » — du parking Von Platen à Ortigia, via la [[Neapolis]] et le [[Museo Paolo Orsi]].\n[i]Von Platen → Viale Cadorna → Piazza della Vittoria → Corso Gelone → Piazzale Marconi → Via Malta → Piazza Pancali → Corso Umberto → Viale Teracati → Viale Teocrito → Von Platen.[/i]\n\n🔵 Ligne Bleue « Elorina » — du parking Elorina à Ortigia, via le [[Foro Siracusano]].\n[i]Elorina → Piazzale Marconi → Via Malta → Ponte S. Lucia → Via Chindemi → Piazza Pancali → Ponte Umbertino → Corso Umberto → Foro Siracusano → Via Elorina → Elorina.[/i]\n\n🟢 Ligne Verte « Ortigia » — un tour complet du périmètre de l'île d'[[Ortigia]].\n[i]Talete → Riva della Posta → Via dei Mille → Parcheggio Marina → Passeggio Aretusa → Castello Maniace → Lungomare di Levante → Largo della Gancia → Via Nizza → Belvedere S. Giacomo → Talete.[/i]", img: "assets/city/navette-mappa.png" },
        { h: "Service taxi", p: "[[Radio Taxi Siracusa]], disponible 24h/24 dans toute la ville. Ou bien [[Enzo Salvi]], notre chauffeur de taxi de confiance (également VTC) : aimable et ponctuel, parfait pour les transferts depuis et vers l'aéroport. Un autre contact fiable est [[Pietro Gatto]].", actions: [{ label: "Radio Taxi", href: "{taxiPhone}", type: "tel", icon: "phone" }, { label: "Enzo Salvi", href: "+39 338 708 7223", type: "tel", icon: "phone" }, { label: "Pietro Gatto", href: "+39 340 753 1581", type: "tel", icon: "phone" }] },
        { h: "Depuis l'aéroport de Catane", p: "L'option la plus pratique et économique est le [[bus direct]] Interbus pour Syracuse : environ 55–70 minutes, billet de 4 à 8 €. Le même bus vous ramène à l'aéroport au départ. Sinon, taxi ou transfert privé (demandez-nous ou à Enzo Salvi). Vous trouverez ci-dessous aussi les horaires des bus urbains de Syracuse.", actions: [{ label: "Acheter le billet (Interbus)", href: "https://www.interbus.it", icon: "info" }, { label: "Horaires bus ville", href: "https://www.saisautolinee.it/linee-urbane-sicilia/siracusa", icon: "info" }] },
        { h: "Vélos et trottinettes électriques", p: "Avec l'application [[ELERENT]], louez vélos et trottinettes électriques directement depuis votre téléphone : une flotte 100% électrique, avec des tarifs qui démarrent en général à 1 € de déverrouillage plus 0,25 € la minute. Elle fonctionne dans plus de 50 villes en Italie, Espagne, Grèce et Malte.", actions: [{ label: "ELERENT pour iPhone", href: "https://apps.apple.com/it/app/elerent/id1518090808", icon: "info" }, { label: "ELERENT pour Android", href: "https://play.google.com/store/apps/details?id=com.elerent.elerent", icon: "info" }] },
        { h: "Location de scooters et voitures", p: "Ortigia Rent Siracusa — location de scooters et de voitures.", actions: [{ label: "Appeler", href: "+39 0931 962217", type: "tel", icon: "phone" }, { label: "Site web", href: "https://www.ortigiarentsiracusa.it", icon: "info" }] }
      ]
    },
    {
      id: "info", icon: "info",
      title: "Informations utiles",
      sub: "Services et urgences",
      items: [
        { h: "Courses et eau", p: "Le supermarché le plus pratique est le Maxistore Decò, Corso Gelone 29, à quelques minutes à pied ; pour l'eau et les produits de première nécessité, les petits commerces de quartier sont pratiques aussi.\n\nQuand les magasins sont fermés, il reste deux distributeurs automatiques, ouverts [[24 heures sur 24]], pour le café et les boissons :\n• [[Distributori Automatici H24]] — Via Senatore Giuseppe Maielli, 6\n• [[Oasi 24/7]] — Via Malta, 32", actions: [{ label: "Maxistore Decò", href: "https://www.google.com/maps/search/?api=1&query=Maxistore+Dec%C3%B2+Corso+Gelone+29+Siracusa", icon: "pin" }, { label: "Distributori H24", href: "https://www.google.com/maps/search/?api=1&query=Distributori+Automatici+H24+Via+Senatore+Giuseppe+Maielli+6+Siracusa", icon: "pin" }, { label: "Oasi 24/7", href: "https://www.google.com/maps/search/?api=1&query=Oasi+24%2F7+Via+Malta+32+Siracusa", icon: "pin" }] },
        { h: "Distributeur (ATM)", p: "Plusieurs distributeurs automatiques de billets (ATM) se trouvent sur le Corso Gelone et à Ortigia, à courte distance.", actions: [{ label: "Distributeur le plus proche", href: "https://www.google.com/maps/search/bancomat+ATM+Corso+Gelone+Siracusa", icon: "pin" }] },
        { h: "Pharmacie et hôpital", p: "Plusieurs pharmacies sont à quelques minutes à pied, sur le Corso Gelone et à Ortigia (la nuit et les jours fériés, le tour de garde est affiché en vitrine, ou demandez-nous). Les urgences se trouvent à l'Hôpital Umberto I, via Testaferrata.", actions: [{ label: "Pharmacie", href: "https://www.google.com/maps/search/farmacia+Corso+Gelone+Siracusa", icon: "pin" }, { label: "Hôpital Umberto I", href: "https://www.google.com/maps/search/?api=1&query=Ospedale+Umberto+I+Siracusa", icon: "pin" }] },
        { h: "Numéros d'urgence", p: "[[112]] — Numéro d'urgence européen unique (police, ambulance, pompiers)\n[[118]] — Urgence médicale (ambulance)\n[[1530]] — Urgence en mer (garde-côtes)", actions: [{ label: "112", href: "112", type: "tel", icon: "phone" }, { label: "118", href: "118", type: "tel", icon: "phone" }, { label: "1530", href: "1530", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "faq", icon: "info",
      title: "Questions fréquentes",
      sub: "Les réponses pratiques, à portée de main",
      items: [
        { h: "Climatisation", p: "La télécommande se trouve dans la chambre : allumez-la quand vous êtes présents et éteignez-la en sortant, pour une consommation raisonnable. Pour tout problème, écrivez-nous." },
        { h: "Eau chaude", p: "L'eau chaude est disponible à tout moment. Si vous remarquez quelque chose qui ne va pas, prévenez-nous aussitôt et nous réglons cela." },
        { h: "Tri sélectif", p: "Syracuse pratique la collecte en porte-à-porte. Nous vous demandons de trier les déchets ainsi :\n• [[Déchets alimentaires / organiques]] — lundi, mercredi, vendredi\n• [[Plastique et métaux]] — mardi\n• [[Ordures ménagères]] — jeudi\n• [[Papier, carton et verre]] — samedi\nPour savoir où et à quelle heure sortir les sacs, n'hésitez pas à nous demander : nous vous donnons un coup de main.", actions: [{ label: "Calendrier municipal", href: "https://www.siracusadifferenzia.it", icon: "info" }] },
        { h: "Heures de silence", p: "Après 23h00, nous vous demandons de modérer les bruits, par respect pour les autres hôtes et le voisinage. Merci !" },
        { h: "Vous ne trouvez pas quelque chose ?", p: "Écrivez-nous sur WhatsApp à toute heure : nous sommes là pour vous aider.", actions: [{ label: "Écrivez-nous sur WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "extras", icon: "sparkle",
      title: "Services et extras",
      sub: "N'hésitez pas à demander, nous nous occupons de tout",
      intro: "Vous souhaitez une arrivée ou un départ sur mesure, un transfert ou une excursion ? Touchez le service : le message nous arrive déjà prêt et nous vous répondons avec la disponibilité et le prix.",
      items: [
        { h: "Transfert depuis et vers l'aéroport", p: "Nous vous organisons le transfert depuis et vers l'aéroport de Catane avec un chauffeur de confiance, pratique surtout pour les vols très tôt ou très tard.", actions: [{ label: "Demander le transfert", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Bonjour ! Je voudrais organiser un transfert depuis/vers l'aéroport de Catane. Voici les détails du vol :" }] },
        { h: "Check-out tardif", p: "Vous partez dans l'après-midi ? Si la chambre reste libre, nous pouvons vous la laisser quelques heures de plus.", actions: [{ label: "Demander un check-out tardif", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Bonjour ! Je voudrais demander un check-out tardif, si possible. Mon départ est prévu vers :" }] },
        { h: "Check-in anticipé et consigne à bagages", p: "Vous arrivez tôt ou repartez tard ? Nous pouvons garder vos bagages et, si la chambre est prête, vous faire entrer plus tôt.", actions: [{ label: "Demander des informations", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Bonjour ! Je voudrais un check-in anticipé ou déposer mes bagages. J'arrive/je repars vers :" }] },
        { h: "Excursions, bateau et visites", p: "Sorties en bateau, visites de la ville et plongées : nous vous mettons en contact avec nos partenaires de confiance.", actions: [{ label: "Demander une excursion", href: "{whatsapp}", type: "wa", icon: "chat", waText: "Bonjour ! Je voudrais des informations sur les excursions, les sorties en bateau ou les visites." }] }
      ]
    },
    {
      id: "review", icon: "star",
      title: "Laissez un avis",
      sub: "Votre soutien nous est précieux",
      items: [
        { h: "Vous avez passé un bon séjour ?", p: "Si vous vous êtes bien plu, un avis sur Google est très précieux pour nous : nous sommes une nouvelle gestion et nous savons que la note actuelle ne nous représente pas. Nous faisons vraiment tout pour rendre votre séjour inoubliable. Merci de tout cœur ! 💛", actions: [{ label: "Laisser un avis sur Google", href: "{reviewUrl}", icon: "star", style: "accent" }] },
        { h: "Quelque chose ne va pas ?", p: "Dites-le-nous tout de suite sur WhatsApp, même la nuit : nous préférons y remédier sur le moment plutôt que de le découvrir après.", actions: [{ label: "Écrivez-nous sur WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "contacts", icon: "phone",
      title: "Contacts",
      sub: "Nous sommes toujours à votre disposition",
      items: [
        { h: "WhatsApp, Telegram, Viber", p: "Le moyen le plus rapide de nous joindre.", actions: [{ label: "Ouvrir WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Téléphone", p: "Pour les urgences et les communications rapides.", actions: [{ label: "Appeler", href: "{phone}", type: "tel", icon: "phone", onlyIf: "phone" }, { label: "Autre numéro", href: "{phoneGreta}", type: "tel", icon: "phone", onlyIf: "phoneGreta" }] },
        { h: "Email", p: "{email}", actions: [{ label: "Écrire un email", href: "{email}", type: "mail", icon: "info" }] },
        { h: "Revenez nous voir !", p: "Réservez directement pour vos prochains séjours : aux hôtes qui reviennent, nous réservons toujours le meilleur traitement possible.", actions: [{ label: "Réserver en ligne", href: "{bookingUrl}", icon: "calplus" }, { label: "Réserver sur WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat", style: "secondary" }] }
      ]
    }
  ]
};
