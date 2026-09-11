// ============================================================
//  LOADER MULTI-TENANT (sostituisce config.js)
//  Serve window.PROPERTY leggendo la guida della proprietà scelta con ?p=<idStruttura>.
//   1) Se la guida è già nel dispositivo (host che compila) → usa quella (localStorage).
//   2) Altrimenti (ospite) → la scarica dal server (Supabase) e ricarica una volta.
//  I codici serratura NON stanno qui: viaggiano nel link ospite (k=).
// ============================================================

(function () {
  // Chiavi PUBBLICHE del progetto Supabase (sola lettura per id via funzione get_public_guide).
  var SUPA_URL = "https://tuxxhquagtrsndtzopbo.supabase.co";
  var SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1eHhocXVhZ3Ryc25kdHpvcGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjA3NTQsImV4cCI6MjEwNDY5Njc1NH0.fj6fB6Fy-NkW1Ie88fClaOp6uGz3b_4tA1qOlnB8sdQ";

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

  // Il tenant arriva da ?p=. Ma il motore ripulisce l'URL dai parametri del link (per nascondere
  // i codici), quindi a ogni reload ?p= sparisce: in quel caso lo recuperiamo dal link ospite salvato.
  var pid = new URLSearchParams(location.search).get("p") || "";
  if (!pid) { try { pid = (JSON.parse(localStorage.getItem("spigole_guest") || "null") || {}).p || ""; } catch (e) {} }
  var guides = {};
  try { guides = JSON.parse(localStorage.getItem("spigolestay:guides") || "{}"); } catch (e) {}

  function apply(g) {
    // Fondo i campi mancanti col fallback, così il motore ha sempre tutto.
    window.PROPERTY = g ? Object.assign({}, FALLBACK, g, { social: Object.assign({}, FALLBACK.social, g.social || {}), sectionImages: Object.assign({}, FALLBACK.sectionImages, g.sectionImages || {}) }) : FALLBACK;
    window.PROPERTIES = {}; window.PROPERTIES[window.PROPERTY.id] = window.PROPERTY;
  }

  apply(guides[pid]); // sincrono: guida locale (host) o esempio (ospite senza dati)

  // Ospite (nessuna guida in locale per questo id) → scarica dal server e ricarica una volta.
  // Sul dispositivo dell'host la guida c'è già in locale, quindi NON la sovrascriviamo.
  if (pid && !guides[pid]) {
    var guard = "spigole_guide_fetched_" + pid;
    try {
      if (!sessionStorage.getItem(guard)) {
        fetch(SUPA_URL + "/rest/v1/rpc/get_public_guide", {
          method: "POST",
          headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ p_id: pid })
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            try { sessionStorage.setItem(guard, "1"); } catch (e) {}
            if (!data || typeof data !== "object") return; // nessuna guida pubblicata per questo id
            guides[pid] = data;
            try { localStorage.setItem("spigolestay:guides", JSON.stringify(guides)); } catch (e) {}
            location.reload(); // ricarica: ora la guida reale è in locale
          })
          .catch(function () {});
      }
    } catch (e) {}
  }
})();
