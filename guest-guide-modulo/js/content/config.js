// ============================================================
//  DATI DELLE STRUTTURE — MODIFICA SOLO QUESTO FILE
//  Guida multi-struttura: si sceglie con ?p=<id> (default: spigolehouse).
//  I valori qui sotto vengono inseriti nei testi (dove trovi {nomeCampo}).
// ============================================================

window.PROPERTIES = {

  spigolehouse: {
    id: "spigolehouse",
    guideName: "Spigolehouse | Rooms",
    guideLogo: "assets/logo-trasparente.png",

    name: "B&B Spigolehouse & Spigolerooms",
    city: "Siracusa",

    phone: "+39 333 767 5693",            // Andrea
    phoneGreta: "+39 333 767 5693",       // Greta — stesso numero di Andrea (WhatsApp Business della struttura)
    whatsapp: "+39 333 767 5693",
    email: "info@spigolehouse.it",
    address: "Corso Gelone 93, 96100 Siracusa (SR)",

    mapsUrl: "https://www.google.com/maps/place/B%26b+Spigolehouse/@37.0723945,15.2796589,17z/data=!3m1!4b1!4m9!3m8!1s0x1313ce9b92f15555:0x1e63fedaaa95dca8!5m2!4m1!1i2!8m2!3d37.0723902!4d15.2822338!16s%2Fg%2F11g0mv9c6l",

    wifiNetwork: "Spigolehouse WiFi",
    wifiPassword: "Spigolehouse7@",
    wifiQr: "assets/wifi-qr.png",

    checkinTime: "15:00 – 00:00",
    checkoutTime: "entro le 10:30",
    breakfastTime: "",

    reviewUrl: "https://www.google.com/maps/place/B%26B+SPIGOLEHOUSE+%26+APARTMENT/@37.0723902,15.2822328,15z/",
    bookingUrl: "https://book.octorate.com/octobook/site/reservation/index.xhtml?codice=468354",

    taxiPhone: "+39 0931 17977",

    // ⚠️ NON rimettere qui i codici: questo file è pubblico su internet
    // (chiunque apre /js/content/config.js e li legge, senza alcun link).
    // I codici vivono in js/properties.js, che sta solo negli strumenti, e
    // viaggiano nel link personale dell'ospite (k=cancello-cassetta).
    gateCode: "",   // cancello del cortile — arriva dal link
    doorCode: "",   // portone principale + key box — arriva dal link

    roomTypes: {
      "1": "Deluxe", "2": "Family", "3": "Deluxe", "4": "Deluxe",
      "5": "Deluxe", "6": "Deluxe", "7": "Deluxe", "8": "Suite"
    },

    social: {
      instagram: "https://www.instagram.com/spigolehouse/",
      facebook: "https://www.facebook.com/spigolehouse",
      website: "https://www.spigolehouse.it"
    },

    footerCredit: "Legal for Digital © Copyright 2026 – Spigolehouse.it",

    sectionImages: {
      attractions: "assets/city/hero-ortigia.jpg",
      events: "assets/city/hero-eventi.jpg",
      excursions: "assets/city/hero-spiagge.jpg",
      restaurants: "assets/city/hero-ristoranti.jpg"
    },

    roomPhotos: [
      "assets/rooms/room-6.jpg",
      "assets/rooms/room-3.jpg",
      "assets/rooms/room-2.jpg",
      "assets/rooms/room-7.jpg",
      "assets/rooms/room-10.jpg",
      "assets/rooms/room-11.jpg",
      "assets/rooms/room-1.jpg"
    ]
  },

  // ---------------------------------------------------------
  //  CENTRAL PERK — 2ª struttura
  //  ⚠️ Diversi valori sono ancora da fornire (vedi TODO).
  // ---------------------------------------------------------
  centralperk: {
    id: "centralperk",
    guideName: "Central Perk",
    guideLogo: "assets/logo-centralperk-t.png",

    name: "B&B Central Perk",
    city: "Siracusa",

    phone: "+39 376 202 8700",      // Stefano
    phoneGreta: "+39 376 202 8700", // Greta — stesso numero di Stefano (WhatsApp Business del Central Perk)
    whatsapp: "+39 376 202 8700",
    email: "centralperk.sr@gmail.com",
    address: "Via Antioco 13, 96100 Siracusa (SR) — traversa di Corso Gelone, all'altezza di UniCredit (Corso Gelone 30)",

    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Via+Antioco+13+Siracusa",  // TODO: link Maps esatto

    wifiNetwork: "Central Perk",
    wifiPassword: "Centralperk7",
    wifiQr: "",

    checkinTime: "15:00 – 00:00",   // TODO: verificare
    checkoutTime: "entro le 10:30", // TODO: verificare
    breakfastTime: "",

    reviewUrl: "https://www.google.com/travel/hotels/entity/CgoIu8jk-Kzz2I0IEAE/reviews",
    bookingUrl: "",       // TODO

    taxiPhone: "+39 0931 17977",

    // ⚠️ Vedi la nota sopra: niente codici in questo file, è pubblico.
    gateCode: "",    // cassetta del portone (nera e grigia) — arriva dal link
    doorCode: "",    // cassetta in alto (camera 1) — arriva dal link
    doorCode2: "",   // cassetta in basso (camere 2, 3, 4) — arriva dal link

    roomTypes: { "1": "Standard", "2": "Standard", "3": "Deluxe", "4": "Deluxe" },

    roomPhotos: [
      "assets/rooms/centralperk-1.avif",
      "assets/rooms/centralperk-2.avif",
      "assets/rooms/centralperk-3.jpg",
      "assets/rooms/centralperk-4.jpg",
      "assets/rooms/centralperk-5.jpg"
    ],

    social: {
      instagram: "https://www.instagram.com/centralperk.sr",
      facebook: "https://www.facebook.com/p/Central-Perk-Siracusa-61567322520371/",
      website: "https://www.centralperksr.it"
    },

    footerCredit: ""
  }

};

// Sigle brevi per accorciare il link ospite: ?p=sh invece di ?p=spigolehouse.
// I nomi lunghi restano validi (li usano i link già inviati).
window.PROPERTY_ALIAS = { sh: "spigolehouse", cp: "centralperk" };

// Selezione struttura: ?p=<sigla|id>, altrimenti l'ultima salvata sul telefono, altrimenti spigolehouse
(function () {
  var pid = new URLSearchParams(location.search).get("p");
  if (!pid) {
    try { var g = JSON.parse(localStorage.getItem("spigole_guest") || "null"); if (g && g.p) pid = g.p; } catch (e) {}
  }
  pid = window.PROPERTY_ALIAS[pid] || pid;
  window.PROPERTY = window.PROPERTIES[pid] || window.PROPERTIES.spigolehouse;
})();
