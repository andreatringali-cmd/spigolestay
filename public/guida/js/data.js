// ============================================================
//  LOADER MULTI-TENANT (sostituisce config.js)
//  Serve window.PROPERTY leggendo la guida della proprietà scelta
//  con ?p=<idStruttura>. Nel prototipo la fonte è localStorage
//  ("spigolestay:guides", scritto dal pannello SpigoleStay);
//  in produzione qui arriverà una vera API/DB.
//  I codici serratura NON stanno qui: viaggiano nel link ospite (k=).
// ============================================================

(function () {
  // Guida di esempio (usata se la proprietà non ha ancora una guida salvata).
  var FALLBACK = {
    id: "demo",
    guideName: "Dimora Aurora",
    guideLogo: "assets/logo-placeholder.svg",
    name: "Dimora Aurora",
    city: "Siracusa",
    phone: "+39 000 000 0000",
    phoneGreta: "+39 000 000 0000",
    whatsapp: "+39 000 000 0000",
    email: "info@esempio.it",
    address: "Via dei Mandorli 12, 96100 Siracusa (SR)",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Siracusa",
    wifiNetwork: "WiFi Ospiti",
    wifiPassword: "benvenuti",
    wifiQr: "",
    checkinTime: "15:00 – 00:00",
    checkoutTime: "entro le 10:30",
    breakfastTime: "",
    reviewUrl: "https://www.google.com/maps/search/?api=1&query=Siracusa",
    bookingUrl: "",
    taxiPhone: "+39 0931 17977",
    gateCode: "0000", doorCode: "0000", doorCode2: "0000",
    roomTypes: { "1": "Deluxe", "2": "Family", "3": "Deluxe", "4": "Suite" },
    social: { instagram: "", facebook: "", website: "" },
    footerCredit: "",
    sectionImages: { attractions: "assets/city/hero-ortigia.jpg", events: "assets/city/hero-eventi.jpg", excursions: "assets/city/hero-spiagge.jpg", restaurants: "assets/city/hero-ristoranti.jpg" },
    roomPhotos: ["assets/rooms/room-6.jpg", "assets/rooms/room-3.jpg", "assets/rooms/room-2.jpg"]
  };

  // Il tenant arriva da ?p=. Ma il motore ripulisce l'URL dai parametri del link
  // (per nascondere i codici), quindi a ogni reload/rientro dell'ospite ?p= sparisce:
  // in quel caso lo recuperiamo dal link ospite salvato (spigole_guest.p).
  var pid = new URLSearchParams(location.search).get("p") || "";
  if (!pid) { try { pid = (JSON.parse(localStorage.getItem("spigole_guest") || "null") || {}).p || ""; } catch (e) {} }
  var guides = {};
  try { guides = JSON.parse(localStorage.getItem("spigolestay:guides") || "{}"); } catch (e) {}
  var g = guides[pid];
  // Fondo i campi mancanti col fallback, così il motore ha sempre tutto.
  window.PROPERTY = g ? Object.assign({}, FALLBACK, g, { social: Object.assign({}, FALLBACK.social, g.social || {}), sectionImages: Object.assign({}, FALLBACK.sectionImages, g.sectionImages || {}) }) : FALLBACK;
  window.PROPERTIES = {}; window.PROPERTIES[window.PROPERTY.id] = window.PROPERTY;
})();
