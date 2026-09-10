// ============================================================
//  CONTENIDO EN ESPAÑOL
//  Los marcadores como {whatsapp} se sustituyen automáticamente
//  con los valores de config.js
// ============================================================

window.I18N = window.I18N || {};

window.I18N.es = {
  ui: {
    back: "Atrás",
    footer: "¡Os deseamos una estancia maravillosa!",
    copy: "Copiar contraseña",
    copied: "¡Contraseña copiada!",
    wifiNetwork: "Red",
    wifiPassword: "Contraseña",
    quickWifi: "WiFi",
    quickWhatsapp: "WhatsApp",
    quickMap: "Mapa",
    quickEmergency: "Emergencias",
    codeSuffix: "+ el botón central",
    codeMissing: "El código llega con el enlace personal que os enviamos antes de la llegada. Si no lo encontráis, escribidnos.",
    footerSocial: "Seguidnos y mantened el contacto con nosotros",
    wifiQrHint: "Desliza para el QR ›",
    wifiQrCaption: "Escanéame"
  },

  home: {
    title: "Vuestra guía",
    subtitle: "Todo lo que necesitáis, de la llegada a la salida.",
    welcomeTitle: "Bienvenidos,",
    welcome: [
      "¡estamos muy felices de recibiros!",
      "Esta guía os ayudará a descubrir la ciudad y a disfrutar al máximo de vuestra estancia. Nuestro equipo está a vuestra disposición para lo que necesitéis.",
      "¡Feliz estancia!"
    ]
  },

  groups: [
    { title: "Vuestra llegada", sections: ["checkin", "breakfast", "wifi"] },
    { title: "Descubrir Siracusa", sections: ["attractions", "restaurants", "excursions"] },
    { title: "Servicios útiles", sections: ["taxi", "info", "faq", "extras", "contacts", "review"] }
  ],

  // Secciones específicas por estructura (override). Las secciones que no
  // aparecen aquí siguen siendo comunes (contenidos de ciudad iguales para todos).
  sectionsByProperty: {
    centralperk: {
      checkin: {
        id: "checkin", icon: "key",
        title: "Llegada y check-in autónomo",
        sub: "Cómo entrar en el B&B Central Perk",
        intro: "Podéis llegar con total libertad. Así es como se entra al Central Perk.",
        steps: [
          { h: "Dónde estamos", p: "Central Perk — Via Antioco 13, una bocacalle del Corso Gelone, a la altura del banco UniCredit (Corso Gelone 30).", actions: [{ label: "Central Perk", href: "{mapsUrl}", icon: "pin" }] },
          { h: "Abrid el portón", p: "A la izquierda del portón hay una caja de seguridad negra y gris: marcad el código de abajo, coged la llave y abrid el portón. Después volved a dejar la llave en su sitio, por favor.", codeKey: "gateCode", codeAfter: "#" },
          { h: "Subid al B&B", p: "Una vez dentro, subid las escaleras y girad a la derecha: al fondo, a la derecha, está la puerta de entrada del B&B. Entre las dos puertas encontraréis dos cajas de seguridad." },
          { h: "Vuestras llaves — habitación 1", p: "Abrid la caja [[de arriba]] con el código de abajo y coged vuestro juego de llaves. Vuestra habitación, la número 1, está justo ahí.", codeKey: "doorCode", codeAfter: "#", onlyRooms: ["1"] },
          { h: "Vuestras llaves — habitaciones 2, 3 y 4", hPersonal: "Vuestras llaves — habitación {roomNums}", hPersonalPlural: "Vuestras llaves — habitaciones {roomNums}", p: "Abrid la caja [[de abajo]] con el código de abajo, usad la llave para abrir la puerta de entrada y después volved a dejarla en la caja, por favor. Vuestro juego de llaves está colgado en la puerta de vuestra habitación: la llave con el mango negro es para la puerta de entrada, la tercera para el portón de abajo.", pPersonal: "Abrid la caja [[de abajo]] con el código de abajo, usad la llave para abrir la puerta de entrada y después volved a dejarla en la caja, por favor. Vuestra habitación es la número {roomNum}: vuestro juego de llaves está colgado en su puerta. La llave con el mango negro es para la puerta de entrada, la tercera para el portón de abajo.", pPersonalPlural: "Abrid la caja [[de abajo]] con el código de abajo, usad la llave para abrir la puerta de entrada y después volved a dejarla en la caja, por favor. Vuestras habitaciones son {roomNum}: cada juego de llaves está colgado en la puerta de la habitación correspondiente. La llave con el mango negro es para la puerta de entrada, la tercera para el portón de abajo.", codeKey: "doorCode2", codeAfter: "#", exceptRooms: ["1"] },
          { h: "Avisadme", p: "Mandadme un mensaje cuando lleguéis a la habitación y decidme si está todo bien. Para cualquier necesidad, petición o información escribidme a cualquier hora, aquí por WhatsApp.", actions: [{ label: "Escribidnos por WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ],
        amenitiesTitle: "Los servicios de vuestra habitación",
        amenitiesIntro: "Hemos cuidado cada detalle para que vuestro descanso sea perfecto.",
        amenities: [
          { icon: "snow", label: "Aire acondicionado" },
          { icon: "tv", label: "Smart TV" },
          { icon: "sparkle", label: "Set de cortesía" },
          { icon: "wind", label: "Secador de pelo" },
          { icon: "towel", label: "Ropa de cama limpia" },
          { icon: "balcony", label: "Balcón privado" }, { icon: "coffee", label: "Cafetera", onlyRooms: ["3", "4"] }
        ],
        gallery: true,
        items: [
          { h: "Cocina común y café", p: "En el hall tenéis una pequeña cocina común, a disposición de todos: nevera, hervidor, microondas, dispensador de agua natural y con gas y una cafetera. El café es de producción propia, ¡probadlo!" },
          { h: "Aparcamiento", p: "Se aparca fácilmente en la calle cerca del B&B y es gratuito. Como alternativa, a 50 metros hay un aparcamiento privado de pago, el \"Parcheggio Gelone\".", actions: [{ label: "Parcheggio Gelone", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Gelone+Siracusa", icon: "parking" }] },
          { h: "Documentos", p: "Para el registro necesitamos los documentos de todos los huéspedes: basta una foto por delante y por detrás por WhatsApp, incluso antes de la llegada.", pIf: { docsUrl: "Para el registro necesitamos los documentos de todos los huéspedes: podéis [[subirlos vosotros mismos]] al portal, con el botón de abajo. Se hace en un momento, incluso antes de la llegada, y no tenéis que enviarnos nada más." }, actions: [{ label: "Subir los documentos", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Enviar los documentos", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
          { h: "Check-out y tasa turística", p: "Check-out {checkoutTime}. La tasa turística de Siracusa es el 4% del coste de la estancia, con un máximo de 5 € por persona y noche y solo para las primeras 7 noches. Los menores de 14 años no pagan: podéis dejarla en la habitación. ¡Gracias!", pIf: { taxFixed: "Check-out {checkoutTime}. La tasa turística de Siracusa es de unos 2 € por persona y noche, durante las primeras 7 noches. Los menores de 14 años no pagan: podéis dejarla en la habitación. ¡Gracias!" } },
          { h: "No se fuma 🚭", p: "Está prohibido fumar dentro del B&B y de las habitaciones. ¡Gracias por vuestra colaboración!" }
        ]
      },
      breakfast: {
        id: "breakfast", icon: "coffee",
        title: "Vuestro desayuno",
        sub: "En los bares asociados aquí cerca, con los vales",
        intro: "El desayuno se sirve en los bares asociados aquí cerca, desde las 7:00 hasta cuando queráis. Encontraréis los vales en el escritorio o en la mesilla de vuestra habitación.",
        steps: [
          { h: "Todos los días (excepto el sábado) — Milk and Coffee", p: "Corso Gelone 22, justo debajo del alojamiento.", notice: { until: "2026-08-08", text: "🌴 Cerrado por vacaciones del 25 de julio al 8 de agosto: en este periodo el desayuno se sirve en el [[Bar Euripide]] (Piazza Euripide 25)." }, actions: [{ label: "Abrir el mapa", href: "https://www.google.com/maps/search/?api=1&query=Milk+and+Coffee+Corso+Gelone+Siracusa", icon: "pin" }] },
          { h: "Sábado — Bar Euripide", p: "Piazza Euripide 25, a tres minutos a pie.", actions: [{ label: "Abrir el mapa", href: "https://www.google.com/maps/search/?api=1&query=Bar+Euripide+Piazza+Euripide+Siracusa", icon: "pin" }] }
        ]
      },
      contacts: {
        id: "contacts", icon: "phone",
        title: "Contacto",
        sub: "Siempre estamos a vuestra disposición",
        items: [
          { h: "WhatsApp, Telegram, Viber", p: "La forma más rápida de contactarnos.", actions: [{ label: "Abrir WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
          { h: "Teléfono", p: "Para urgencias y mensajes rápidos.", actions: [{ label: "Llamar", href: "{phone}", type: "tel", icon: "phone", onlyIf: "phone" }, { label: "Otro número", href: "{phoneGreta}", type: "tel", icon: "phone", onlyIf: "phoneGreta" }] },
          { h: "Email", p: "{email}", actions: [{ label: "Escribir un email", href: "{email}", type: "mail", icon: "info" }] },
          { h: "¡Volved a visitarnos!", p: "Reservad directamente para vuestras próximas estancias: a los huéspedes que vuelven les reservamos siempre el mejor trato posible.", actions: [{ label: "Reservar por WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
        ]
      }
    }
  },

  sections: [
    {
      id: "checkin", icon: "key",
      title: "Llegada y check-in autónomo",
      sub: "Cómo llegar y entrar en vuestra habitación",
      gallery: true,
      intro: "Podéis llegar con total libertad a partir de las 15:00.",
      steps: [
        { h: "Dónde estamos", p: "{address}.", actions: [{ label: "{name}", href: "{mapsUrl}", icon: "pin" }] },
        { h: "Aparcamiento", p: "Tenéis una plaza de aparcamiento reservada en el patio interior. Para acceder al patio, marcad el código en el teclado bajo el portero automático y pulsad el botón central. Las plazas no están asignadas: aparcad donde prefiráis dentro de las zonas delimitadas.", codeKey: "gateCode", parkOnly: true },
        { h: "Aparcamiento", p: "Según vuestra reserva, no habéis reservado el aparcamiento. Si lo necesitáis, contactadnos para comprobar la disponibilidad: el coste es de 6 € por noche.", actions: [{ label: "Contactadnos por WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }], noParkOnly: true },
        { h: "Entrada peatonal", p: "Para entrar a pie, marcad el código en el teclado bajo el portero automático y pulsad el botón central.", codeKey: "doorCode", noParkOnly: true },
        { h: "Acceso a las plantas", p: "Para el portón interior y la caja de llaves de vuestra planta, marcad el código seguido de los 2 botones laterales.", codeKey: "doorCode", codeSuffix: "+ los 2 botones laterales" },
        { h: "¡Bienvenidos a vuestra habitación!", p: "Encontraréis las llaves colgadas directamente en la puerta de vuestra habitación. ¡Instalaos y relajaos!", pPersonal: "Vuestra habitación es la número {roomNum}: encontraréis las llaves colgadas directamente en la puerta. ¡Instalaos y relajaos!", pPersonalPlural: "Vuestras habitaciones son {roomNum}: encontraréis las llaves colgadas directamente en cada puerta. ¡Instalaos y relajaos!" }
      ],
      amenitiesTitle: "Los servicios de vuestra habitación",
      amenitiesIntro: "Hemos cuidado cada detalle para que vuestro descanso sea perfecto.",
      amenities: [
        { icon: "snow", label: "Aire acondicionado" },
        { icon: "tv", label: "Smart TV" },
        { icon: "sparkle", label: "Set de cortesía" },
        { icon: "coffee", label: "Cafetera" },
        { icon: "wind", label: "Secador de pelo" },
        { icon: "towel", label: "Ropa de cama limpia" },
        { icon: "iron", label: "Plancha" },
        { icon: "balcony", label: "Balcón privado" }
      ],
      items: [
        { h: "Desayuno y zona común", p: "En vuestra planta tenéis una zona común con nevera, dispensador de agua y cafetera. En el escritorio os esperan los vales para vuestro desayuno: tocad aquí para descubrir dónde y cómo.", actions: [{ label: "Ir al desayuno", href: "#/breakfast", icon: "coffee" }] },
        { h: "Arreglo de la habitación 🌿", p: "La habitación se ordena y la ropa de cama se cambia cada dos días: una decisión pensada para no desperdiciar el agua, un bien precioso, y para respetar el medio ambiente y la isla que os acoge. Si las toallas todavía están bien, volvedlas a colgar: solo las cambiamos cuando las dejáis en la ducha o en el lavabo. Y si antes necesitáis algo — toallas limpias o un arreglo extra — escribidnos sin problema. ¡Gracias!", actions: [{ label: "Escribidnos por WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Documentos", p: "Para el registro necesitamos los documentos de todos los huéspedes: basta una foto por delante y por detrás, también aquí por WhatsApp, incluso antes de la llegada.", pIf: { docsUrl: "Para el registro necesitamos los documentos de todos los huéspedes: podéis [[subirlos vosotros mismos]] al portal, con el botón de abajo. Se hace en un momento, incluso antes de la llegada, y no tenéis que enviarnos nada más." }, actions: [{ label: "Subir los documentos", href: "{docsUrl}", icon: "info", style: "accent", onlyIf: "docsUrl" }, { label: "Enviar los documentos", href: "{whatsapp}", type: "wa", icon: "chat", exceptIf: "docsUrl" }] },
        { h: "Check-out y tasa turística", p: "Check-out {checkoutTime}: dejad las llaves colgadas en la puerta de la habitación, tal como las encontrasteis a vuestra llegada. La tasa turística de Siracusa es el 4% del coste de la estancia, con un máximo de 5 € por persona y noche y solo para las primeras 7 noches. Los menores de 14 años no pagan. Podéis dejar el importe sobre el escritorio. ¡Gracias!", pIf: { taxFixed: "Check-out {checkoutTime}: dejad las llaves colgadas en la puerta de la habitación, tal como las encontrasteis a vuestra llegada. La tasa turística de Siracusa es de unos 2 € por persona y noche, durante las primeras 7 noches. Los menores de 14 años no pagan. Podéis dejar el importe sobre el escritorio. ¡Gracias!" } },
        { h: "No se fuma 🚭", p: "Está prohibido fumar dentro del B&B y de las habitaciones. ¡Gracias por vuestra colaboración!" }
      ]
    },
    {
      id: "wifi", icon: "wifi",
      title: "WiFi gratuito",
      sub: "Red y contraseña",
      intro: "Seleccionad la red y conectaos con un toque. Copiad la contraseña de abajo o escanead el código QR.",
      items: []
    },
    {
      id: "breakfast", icon: "coffee",
      title: "Vuestro desayuno",
      sub: "En los mejores bares aquí cerca, con los vales",
      intro: "El desayuno se sirve en los mejores bares de los alrededores. Usad los vales que encontráis en el escritorio de vuestra habitación y elegid libremente uno de los tres bares asociados, cada día el que prefiráis — de lunes a domingo, desde las 07:30 y sin límite de horario.",
      steps: [
        { h: "Caffè Aurora", p: "Via dei Tigli, 3 — a dos pasos de nosotros — [u]Cerrado los domingos[/u]", actions: [{ label: "Abrir el mapa", href: "https://www.google.com/maps/search/?api=1&query=bar+colazione", icon: "pin" }] },
        { h: "Bar Centrale", p: "Piazza Grande, 1 — opciones sin gluten y sin lactosa disponibles — [u]Cerrado los domingos[/u]", actions: [{ label: "Abrir el mapa", href: "https://www.google.com/maps/search/?api=1&query=bar+colazione", icon: "pin" }] },
        { h: "Pasticceria Bella Epoca", p: "Corso Principale, 45 — [u]Cerrado los martes[/u]", actions: [{ label: "Abrir el mapa", href: "https://www.google.com/maps/search/?api=1&query=pasticceria", icon: "pin" }] }
      ]
    },
    {
      id: "attractions", icon: "temple",
      title: "Explorar Siracusa",
      sub: "La historia al alcance de la mano",
      photos: [
        "assets/city/hero-ortigia.jpg",
        "assets/city/hero-fontana.jpg",
        "assets/city/hero-ristoranti.jpg",
        "assets/city/hero-eventi.jpg",
        "assets/city/hero-attrazioni.jpg"
      ],
      intro: "Desde el B&B {guideName} la historia está al alcance de la mano: esto es lo que no os podéis perder.",
      items: [
        { h: "Ortigia, el corazón histórico", p: "• [[Piazza Duomo e il Duomo di Siracusa]], construido incorporando el antiguo templo griego de Atenea\n• [[Fonte Aretusa]], un manantial de agua dulce a pocos metros del mar\n• [[Tempio di Apollo]], entre los restos griegos más antiguos de la isla\n• [[Castello Maniace]], fortaleza de Federico II junto al mar\n• [[Lungomare di Levante e di Ponente]], preciosos al atardecer\n• [[Mercato di Ortigia]], ideal por la mañana para street food, pescado, fruta, especias y productos locales\n\n[i]En coche: la isla es en gran parte zona de tráfico limitado, así que para visitar el centro histórico con tranquilidad dejad el coche en el aparcamiento Talete (de varias plantas, abierto 24 horas) o en el Molo Sant'Antonio (amplio aparcamiento con cómodas lanzaderas).[/i]", actions: [{ label: "Ortigia", href: "https://www.google.com/maps/place/Ponte+Umberto+I/@37.0646512,15.2886735,17z/data=!3m1!4b1!4m6!3m5!1s0x1313cc1fe67aa495:0x68b768548ca7a0fa!8m2!3d37.0646469!4d15.2912484!16s%2Fg%2F11cn5p5hyl", icon: "pin" }, { label: "Talete", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Talete+Siracusa", icon: "parking" }, { label: "Sant'Antonio", href: "https://www.google.com/maps/search/?api=1&query=Parcheggio+Molo+Sant%27Antonio+Siracusa", icon: "parking" }] },
        { h: "Ortigia subterránea", p: "Bajo la isla hay una segunda ciudad, que casi nadie ve.\n• [[Ipogeo di Piazza Duomo]], un laberinto de galerías y cisternas excavadas en la roca, usado como refugio durante los bombardeos de 1943: se entra desde Piazza Duomo y se sale de nuevo al Lungomare Alfeo\n• [[Miqwè]], el baño ritual judío excavado 18 metros bajo la calle y alimentado por agua de manantial: es uno de los mejor conservados de Europa y solo se visita acompañados", actions: [{ label: "Ipogeo di Piazza Duomo", href: "https://www.google.com/maps/search/?api=1&query=Ipogeo+di+Piazza+Duomo+Siracusa", icon: "pin" }, { label: "Miqwè", href: "https://www.google.com/maps/search/?api=1&query=Miqwe+Bagno+Ebraico+Ortigia+Siracusa", icon: "pin" }] },
        { h: "Parque arqueológico de la Neapolis", p: "A solo 5 minutos a pie: una de las visitas más importantes de la ciudad. Incluye el [[Teatro Greco]], el [[Anfiteatro Romano]], las [[Latomie]], el [[Orecchio di Dionisio]] y el [[Ara di Ierone]]. En verano, mejor ir temprano por la mañana.", actions: [{ label: "Abrir el mapa", href: "https://www.google.com/maps/search/?api=1&query=Parco+Archeologico+Neapolis+Siracusa", icon: "pin" }] },
        { h: "Eventos y espectáculos", p: "De mayo a julio el Teatro Griego acoge las representaciones clásicas del INDA; en verano Ortigia se anima con conciertos y artistas callejeros.", actions: [{ label: "Programa INDA", href: "https://www.indafondazione.org", icon: "calendar" }] },
        { h: "Museos e iglesias", p: "Museo Arqueológico Regional [[Paolo Orsi]], excelente para la historia griega, romana y prehistórica; las impresionantes [[Catacombe di San Giovanni]]; el [[Santuario della Madonna delle Lacrime]], edificio moderno y muy reconocible en el skyline de la ciudad.\n\nEn Ortigia, la [[Galleria di Palazzo Bellomo]] custodia la Anunciación de Antonello da Messina.\n\nEl [[Entierro de Santa Lucía]] de Caravaggio se encuentra en la [[Basilica di Santa Lucia al Sepolcro]], en un barrio fuera de Ortigia. [i]Atención: muchas guías todavía lo sitúan en la pequeña iglesia de Piazza Duomo, donde estuvo durante años. Desde 2020 ya no está allí.[/i]", actions: [{ label: "Paolo Orsi", href: "https://www.google.com/maps/search/?api=1&query=Museo+Archeologico+Paolo+Orsi+Siracusa", icon: "pin" }, { label: "Catacombe S. Giovanni", href: "https://www.google.com/maps/search/?api=1&query=Catacombe+di+San+Giovanni+Siracusa", icon: "pin" }, { label: "Madonna delle Lacrime", href: "https://www.google.com/maps/search/?api=1&query=Santuario+Madonna+delle+Lacrime+Siracusa", icon: "pin" }, { label: "Palazzo Bellomo", href: "https://www.google.com/maps/search/?api=1&query=Galleria+Regionale+Palazzo+Bellomo+Siracusa", icon: "pin" }, { label: "Caravaggio — S. Lucia al Sepolcro", href: "https://www.google.com/maps/search/?api=1&query=Basilica+Santa+Lucia+al+Sepolcro+Siracusa", icon: "pin" }] }
      ]
    },
    {
      id: "restaurants", icon: "pizza",
      title: "Dónde comer y beber",
      sub: "Los mejores locales, todos a pie desde aquí",
      intro: "Estos son los mejores locales a los que se llega a pie desde el Via dei Mandorli 12. Consejo: ¡los fines de semana os recomendamos reservar!",
      items: [
        { h: "🍕 Pizzerías", list: [{ n: "Pizzeria da Marco", sub: "Via dei Tigli, 5", tel: "+39 000 000 0000" }, { n: "La Forneria", sub: "Via delle Rose, 12", tel: "+39 000 000 0000" }, { n: "Forno Antico", sub: "Piazza Grande, 7", tel: "+39 000 000 0000" }] },
        { h: "🍽️ Restaurantes", list: [{ n: "Trattoria del Borgo", sub: "Via del Mare, 8", tel: "+39 000 000 0000" }, { n: "Osteria Antica", sub: "Piazza Centrale, 3", tel: "+39 000 000 0000" }, { n: "Locanda dei Tigli", sub: "Via dei Tigli, 20", tel: "+39 000 000 0000" }] },
        { h: "🐟 Pescado", list: [{ n: "Il Pescatore", sub: "Via del Porto, 20", tel: "+39 000 000 0000" }, { n: "La Sirena", sub: "Lungomare, 2", tel: "+39 000 000 0000" }] },
        { h: "🥂 Aperitivos", list: [{ n: "Bar Centrale", sub: "Piazza Grande, 1", tel: "+39 000 000 0000" }, { n: "Terrazza Blu", sub: "Via Belvedere, 9", tel: "+39 000 000 0000" }] },
        { h: "🍰 Dulces y café", list: [{ n: "Caffè delle Palme", sub: "Corso Principale, 45", tel: "+39 000 000 0000" }, { n: "Forno Dolce", sub: "Via Roma, 30", tel: "+39 000 000 0000" }] }
      ]
    },
    {
      id: "excursions", icon: "beach",
      title: "Mar y excursiones",
      sub: "De las calas urbanas a las reservas naturales",
      intro: "De las calas urbanas a las reservas naturales, así podéis disfrutar del mar y de los alrededores.",
      items: [
        { h: "Mar, rocas y clubes de playa", p: "El Plemmirio, área marina protegida al sur de Siracusa, es perfecto para rocas, snorkel y mar limpio. En Ortigia también podéis bañaros desde las rocas y los solariums del paseo marítimo de Levante, a dos pasos del centro.", list: [{ n: "Varco 23", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Varco+23+Plemmirio+Siracusa" }, { n: "Plemmirio Reserve", sub: "Plemmirio", map: "https://www.google.com/maps/search/?api=1&query=Plemmirio+Reserve+Siracusa" }, { n: "Fly Beach", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Fly+Beach+Ortigia+Siracusa" }, { n: "Zefiro Solarium", sub: "Ortigia", map: "https://www.google.com/maps/search/?api=1&query=Zefiro+Solarium+Ortigia+Siracusa" }, { n: "Cala Rossa", sub: "Ortigia · rocas", map: "https://www.google.com/maps/search/?api=1&query=Cala+Rossa+Ortigia+Siracusa" }, { n: "Forte Vigliena", sub: "Ortigia · rocas", map: "https://www.google.com/maps/search/?api=1&query=Forte+Vigliena+Ortigia+Siracusa" }, { n: "Cala Zaffiro", sub: "Plemmirio · 25 min", map: "https://www.google.com/maps/search/?api=1&query=Cala+Zaffiro+Plemmirio+Siracusa" }] },
        { h: "Playas y clubes de playa", p: "Las playas de Arenella y de Fontane Bianche son las más cómodas para un día de playa: arena y servicios. La Riserva di Vendicari, un poco más al sur, es recomendable si tenéis coche y tiempo.", list: [{ n: "Lido Arenella", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Arenella+Siracusa" }, { n: "Lido Le Nereidi", sub: "Arenella", map: "https://www.google.com/maps/search/?api=1&query=Lido+Le+Nereidi+Siracusa" }, { n: "Kukua Beach", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Kukua+Beach+Fontane+Bianche+Siracusa" }, { n: "Lido Sayonara", sub: "Fontane Bianche", map: "https://www.google.com/maps/search/?api=1&query=Lido+Sayonara+Fontane+Bianche+Siracusa" }, { n: "Agua Beach", sub: "San Lorenzo", map: "https://www.google.com/maps/search/?api=1&query=Agua+Beach+San+Lorenzo+Siracusa" }, { n: "Lido San Lorenzo", sub: "San Lorenzo · 50 min", map: "https://www.google.com/maps/search/?api=1&query=Lido+San+Lorenzo+Siracusa" }, { n: "Lido Camomilla", sub: "Fontane Bianche · 30 min", map: "https://www.google.com/maps/search/?api=1&query=Lido+Camomilla+Fontane+Bianche+Siracusa" }, { n: "Calamosche", sub: "reserva · 45 min", map: "https://www.google.com/maps/search/?api=1&query=Spiaggia+Calamosche+Vendicari" }, { n: "Vendicari", sub: "reserva · 50 min · recomendado", map: "https://www.google.com/maps/search/?api=1&query=Riserva+Vendicari" }, { n: "Portopalo di Capopassero", sub: "1 hora · kitesurf", map: "https://www.google.com/maps/search/?api=1&query=Portopalo+di+Capo+Passero" }] },
        { h: "Alrededores recomendados", p: "La Necrópolis de Pantalica, patrimonio de la UNESCO junto con Siracusa, contiene más de 5.000 tumbas excavadas en la roca y está a unos 40 km de la ciudad. Noto, capital del barroco siciliano, es perfecta para media jornada. Marzamemi es un pueblo marinero muy pintoresco, más turístico pero agradable.", actions: [{ label: "Pantalica", href: "https://www.google.com/maps/search/?api=1&query=Necropoli+di+Pantalica", icon: "pin" }, { label: "Noto", href: "https://www.google.com/maps/search/?api=1&query=Noto+Siracusa", icon: "pin" }, { label: "Marzamemi", href: "https://www.google.com/maps/search/?api=1&query=Marzamemi", icon: "pin" }] },
        { h: "Excursiones, barco y buceo", p: "Paseos en barco, excursiones e inmersiones con guías locales. También podéis alquilar una neumática, con o sin patrón.", actions: [{ label: "Excursiones — Francesco Corbino", href: "+39 340 134 1244", type: "tel", icon: "phone" }, { label: "Paseo en barco — Papyrus", href: "+39 338 721 2142", type: "tel", icon: "phone" }, { label: "Buceo y barcos — Fabio Portella", href: "+39 333 132 4030", type: "tel", icon: "phone" }, { label: "Neumáticas — Pietro Urzì", href: "+39 338 889 0866", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "taxi", icon: "taxi",
      title: "Taxi y transporte",
      sub: "Moverse sin coche",
      items: [
        { h: "Lanzaderas gratuitas en la ciudad", p: "Tres líneas de lanzaderas [[totalmente gratuitas]] conectan los aparcamientos y el centro hasta bien entrada la noche: comodísimas para llegar a Ortigia sin problemas de aparcamiento.\nLun–Sáb 17:00–02:00 · Domingo 08:00–02:00 (aproximadamente cada 20 minutos).\n\n🔴 Línea Roja «Teocrito» — del Parcheggio Von Platen a Ortigia, pasando por la [[Neapolis]] y el [[Museo Paolo Orsi]].\n[i]Von Platen → Viale Cadorna → Piazza della Vittoria → Corso Gelone → Piazzale Marconi → Via Malta → Piazza Pancali → Corso Umberto → Viale Teracati → Viale Teocrito → Von Platen.[/i]\n\n🔵 Línea Azul «Elorina» — del Parcheggio Elorina a Ortigia, pasando por el [[Foro Siracusano]].\n[i]Elorina → Piazzale Marconi → Via Malta → Ponte S. Lucia → Via Chindemi → Piazza Pancali → Ponte Umbertino → Corso Umberto → Foro Siracusano → Via Elorina → Elorina.[/i]\n\n🟢 Línea Verde «Ortigia» — una vuelta completa al perímetro de la isla de [[Ortigia]].\n[i]Talete → Riva della Posta → Via dei Mille → Parcheggio Marina → Passeggio Aretusa → Castello Maniace → Lungomare di Levante → Largo della Gancia → Via Nizza → Belvedere S. Giacomo → Talete.[/i]", img: "assets/city/navette-mappa.png" },
        { h: "Servicio de taxi", p: "[[Radio Taxi Siracusa]], disponible 24 horas en toda la ciudad. Como alternativa [[Enzo Salvi]], nuestro taxista de confianza (también VTC): amable y puntual, ideal para los traslados al aeropuerto y desde el aeropuerto. Otro contacto fiable es [[Pietro Gatto]].", actions: [{ label: "Radio Taxi", href: "{taxiPhone}", type: "tel", icon: "phone" }, { label: "Enzo Salvi", href: "+39 338 708 7223", type: "tel", icon: "phone" }, { label: "Pietro Gatto", href: "+39 340 753 1581", type: "tel", icon: "phone" }] },
        { h: "Desde el aeropuerto de Catania", p: "La opción más cómoda y económica es el [[autobús directo]] de Interbus a Siracusa: unos 55–70 minutos, billete de 4 a 8 €. El mismo autobús os lleva de vuelta al aeropuerto a la salida. Como alternativa, taxi o traslado privado (preguntadnos a nosotros o a Enzo Salvi). Abajo encontraréis también los horarios de los autobuses urbanos de Siracusa.", actions: [{ label: "Comprar el billete (Interbus)", href: "https://www.interbus.it", icon: "info" }, { label: "Horarios bus ciudad", href: "https://www.saisautolinee.it/linee-urbane-sicilia/siracusa", icon: "info" }] },
        { h: "Bicis y patinetes eléctricos", p: "Con la app [[ELERENT]] podéis alquilar bicis y patinetes eléctricos directamente desde el móvil: flota 100% eléctrica, con tarifas que suelen partir de 1 € de desbloqueo más 0,25 € por minuto. Funciona en más de 50 ciudades entre Italia, España, Grecia y Malta.", actions: [{ label: "ELERENT para iPhone", href: "https://apps.apple.com/it/app/elerent/id1518090808", icon: "info" }, { label: "ELERENT para Android", href: "https://play.google.com/store/apps/details?id=com.elerent.elerent", icon: "info" }] },
        { h: "Alquiler de scooters y coches", p: "Ortigia Rent Siracusa — alquiler de scooters y coches.", actions: [{ label: "Llamar", href: "+39 0931 962217", type: "tel", icon: "phone" }, { label: "Sitio web", href: "https://www.ortigiarentsiracusa.it", icon: "info" }] }
      ]
    },
    {
      id: "info", icon: "info",
      title: "Información útil",
      sub: "Servicios y emergencias",
      items: [
        { h: "Compra y agua", p: "El supermercado más cómodo es el Maxistore Decò, en Corso Gelone 29, a pocos minutos a pie; para el agua y lo de primera necesidad, también son cómodos los pequeños mercados de barrio.\n\nCuando las tiendas están cerradas quedan dos máquinas expendedoras, abiertas [[24 horas al día]], para café y bebidas:\n• [[Distributori Automatici H24]] — Via Senatore Giuseppe Maielli, 6\n• [[Oasi 24/7]] — Via Malta, 32", actions: [{ label: "Maxistore Decò", href: "https://www.google.com/maps/search/?api=1&query=Maxistore+Dec%C3%B2+Corso+Gelone+29+Siracusa", icon: "pin" }, { label: "Distributori H24", href: "https://www.google.com/maps/search/?api=1&query=Distributori+Automatici+H24+Via+Senatore+Giuseppe+Maielli+6+Siracusa", icon: "pin" }, { label: "Oasi 24/7", href: "https://www.google.com/maps/search/?api=1&query=Oasi+24%2F7+Via+Malta+32+Siracusa", icon: "pin" }] },
        { h: "Cajero (ATM)", p: "Varios cajeros automáticos (ATM) se encuentran en el Corso Gelone y en Ortigia, a poca distancia.", actions: [{ label: "Cajero más cercano", href: "https://www.google.com/maps/search/bancomat+ATM+Corso+Gelone+Siracusa", icon: "pin" }] },
        { h: "Farmacia y hospital", p: "Varias farmacias están a pocos minutos a pie, en el Corso Gelone y en Ortigia (de noche y en festivos el turno de guardia se expone en el escaparate, o preguntadnos). Las urgencias están en el Ospedale Umberto I, en Via Testaferrata.", actions: [{ label: "Farmacia", href: "https://www.google.com/maps/search/farmacia+Corso+Gelone+Siracusa", icon: "pin" }, { label: "Ospedale Umberto I", href: "https://www.google.com/maps/search/?api=1&query=Ospedale+Umberto+I+Siracusa", icon: "pin" }] },
        { h: "Números de emergencia", p: "[[112]] — Número único europeo de emergencias (policía, ambulancia, bomberos)\n[[118]] — Emergencia sanitaria (ambulancia)\n[[1530]] — Emergencia en el mar (Guardia Costera)", actions: [{ label: "112", href: "112", type: "tel", icon: "phone" }, { label: "118", href: "118", type: "tel", icon: "phone" }, { label: "1530", href: "1530", type: "tel", icon: "phone" }] }
      ]
    },
    {
      id: "extras", icon: "sparkle",
      title: "Servicios y extras",
      sub: "Pedidnos lo que sea, nosotros nos encargamos de todo",
      intro: "¿Queréis una llegada o una salida a medida, un traslado o una excursión? Tocad el servicio: nos llega el mensaje ya listo y os respondemos con disponibilidad y precio.",
      items: [
        { h: "Traslado desde y hacia el aeropuerto", p: "Os organizamos el traslado desde y hacia el aeropuerto de Catania con un conductor de confianza, muy cómodo sobre todo con los vuelos muy temprano o muy tarde.", actions: [{ label: "Solicitar el traslado", href: "{whatsapp}", type: "wa", icon: "chat", waText: "¡Hola! Me gustaría organizar un traslado desde/hacia el aeropuerto de Catania. Estos son los detalles del vuelo:" }] },
        { h: "Check-out tardío", p: "¿Salís por la tarde? Si la habitación queda libre, podemos dejárosla algunas horas más.", actions: [{ label: "Pedir el late check-out", href: "{whatsapp}", type: "wa", icon: "chat", waText: "¡Hola! Me gustaría pedir un check-out tardío, si es posible. Mi salida es hacia las:" }] },
        { h: "Check-in anticipado y consigna de equipaje", p: "¿Llegáis pronto o salís tarde? Podemos guardar vuestro equipaje y, si la habitación está lista, dejaros entrar antes.", actions: [{ label: "Pedir info", href: "{whatsapp}", type: "wa", icon: "chat", waText: "¡Hola! Me gustaría un check-in anticipado o dejar el equipaje. Llego/salgo hacia las:" }] },
        { h: "Excursiones, barco y tours", p: "Paseos en barco, tours de la ciudad e inmersiones: os ponemos en contacto con nuestros partners de confianza.", actions: [{ label: "Solicitar una excursión", href: "{whatsapp}", type: "wa", icon: "chat", waText: "¡Hola! Me gustaría información sobre excursiones, paseos en barco o tours." }] }
      ]
    },
    {
      id: "faq", icon: "info",
      title: "Preguntas frecuentes",
      sub: "Las respuestas prácticas, a mano",
      items: [
        { h: "Aire acondicionado", p: "El mando está en la habitación: encendedlo cuando estéis dentro y apagadlo al salir, así consumimos lo justo. Ante cualquier problema, escribidnos." },
        { h: "Agua caliente", p: "El agua caliente está disponible en todo momento. Si notáis algo que no va bien, avisadnos enseguida y lo solucionamos." },
        { h: "Recogida selectiva de residuos", p: "Siracusa hace la recogida puerta a puerta. Os pedimos que separéis los residuos así:\n• [[Orgánico]] — lunes, miércoles, viernes\n• [[Plástico y metales]] — martes\n• [[Resto / no reciclable]] — jueves\n• [[Papel, cartón y vidrio]] — sábado\nPara saber dónde y a qué hora sacar las bolsas, preguntadnos: os echamos una mano.", actions: [{ label: "Calendario del Ayuntamiento", href: "https://www.siracusadifferenzia.it", icon: "info" }] },
        { h: "Horas de silencio", p: "Después de las 23:00 os pedimos que moderéis los ruidos, por respeto a los demás huéspedes y a los vecinos. ¡Gracias!" },
        { h: "¿No encontráis algo?", p: "Escribidnos por WhatsApp a cualquier hora: estamos aquí para ayudaros.", actions: [{ label: "Escribidnos por WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "review", icon: "star",
      title: "Dejad una reseña",
      sub: "Vuestro apoyo es muy valioso para nosotros",
      items: [
        { h: "¿Os habéis sentido a gusto?", p: "Si os habéis sentido a gusto, una reseña en Google es valiosísima para nosotros: somos una nueva gestión y sabemos que la puntuación actual no nos representa. Estamos haciendo de verdad todo lo posible para que vuestra estancia sea inolvidable. ¡Mil gracias! 💛", actions: [{ label: "Dejar una reseña en Google", href: "{reviewUrl}", icon: "star", style: "accent" }] },
        { h: "¿Algo no va bien?", p: "Decídnoslo enseguida por WhatsApp, incluso de noche: preferimos solucionarlo en el momento antes que descubrirlo después.", actions: [{ label: "Escribidnos por WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] }
      ]
    },
    {
      id: "contacts", icon: "phone",
      title: "Contacto",
      sub: "Siempre estamos a vuestra disposición",
      items: [
        { h: "WhatsApp, Telegram, Viber", p: "La forma más rápida de contactarnos.", actions: [{ label: "Abrir WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat" }] },
        { h: "Teléfono", p: "Para urgencias y mensajes rápidos.", actions: [{ label: "Llamar", href: "{phone}", type: "tel", icon: "phone", onlyIf: "phone" }, { label: "Otro número", href: "{phoneGreta}", type: "tel", icon: "phone", onlyIf: "phoneGreta" }] },
        { h: "Email", p: "{email}", actions: [{ label: "Escribir un email", href: "{email}", type: "mail", icon: "info" }] },
        { h: "¡Volved a visitarnos!", p: "Reservad directamente para vuestras próximas estancias: a los huéspedes que vuelven les reservamos siempre el mejor trato posible.", actions: [{ label: "Reservar online", href: "{bookingUrl}", icon: "calplus" }, { label: "Reservar por WhatsApp", href: "{whatsapp}", type: "wa", icon: "chat", style: "secondary" }] }
      ]
    }
  ]
};
