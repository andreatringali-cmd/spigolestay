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

  // Guida di ESEMPIO: solo per l'anteprima esplicita (?p=__esempio__). Mai mostrata agli ospiti al posto di un link sbagliato.
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

  // Base NEUTRA per le guide vere: completa solo i campi strutturali mancanti, senza dati di contatto, WiFi, codici, foto o logo finti
  // (altrimenti una guida con un campo assente mostrerebbe i dati della guida di esempio: numero taxi reale di Siracusa, foto demo, logo segnaposto).
  var BASE = Object.assign({}, FALLBACK, {
    id: "", guideName: "", name: "", city: "", phone: "", phoneGreta: "", whatsapp: "", email: "", address: "", mapsUrl: "",
    wifiNetwork: "", wifiPassword: "", wifiQr: "", checkinTime: "", checkoutTime: "", breakfastTime: "", reviewUrl: "", bookingUrl: "",
    gateCode: "", doorCode: "", doorCode2: "", roomTypes: {},
    taxiPhone: "", guideLogo: "", roomPhotos: [], sectionImages: {}
  });

  // Il tenant arriva da ?p=. Ma il motore ripulisce l'URL dai parametri del link (per nascondere
  // i codici), quindi a ogni reload ?p= sparisce: in quel caso lo recuperiamo dal link ospite salvato.
  var pid = new URLSearchParams(location.search).get("p") || "";
  if (!pid) { try { pid = (JSON.parse(localStorage.getItem("spigole_guest") || "null") || {}).p || ""; } catch (e) {} }
  var guides = {};
  try { guides = JSON.parse(localStorage.getItem("spigolestay:guides") || "{}"); } catch (e) {}
  // Se il dispositivo non permette di salvare (navigazione privata), la guida scaricata resta per la sola sessione.
  var tmpKey = "spigole_guide_tmp_" + pid;
  if (pid && !guides[pid]) { try { var tmp = JSON.parse(sessionStorage.getItem(tmpKey) || "null"); if (tmp && typeof tmp === "object") guides[pid] = tmp; } catch (e) {} }

  // Stato della guida: "ok" = guida vera (o esempio esplicito), "loading" = la sto scaricando dal server,
  // "invalid" = link sbagliato/scaduto/guida non pubblicata. app.js mostra il messaggio "Link non valido" per "invalid"
  // e una schermata neutra per "loading": mai la guida demo agli ospiti.
  window.GUIDE_STATE = "ok";
  var INVALID_MSG = {
    it: { t: "Link non valido o scaduto", p: "Questo link non è più valido. Contatta la struttura per ricevere il link corretto.", r: "Riprova" },
    en: { t: "Link invalid or expired", p: "This link is no longer valid. Please contact your host to get the correct link.", r: "Try again" },
    de: { t: "Link ungültig oder abgelaufen", p: "Dieser Link ist nicht mehr gültig. Bitte kontaktieren Sie die Unterkunft, um den richtigen Link zu erhalten.", r: "Erneut versuchen" },
    fr: { t: "Lien invalide ou expiré", p: "Ce lien n'est plus valide. Veuillez contacter l'établissement pour recevoir le bon lien.", r: "Réessayer" },
    es: { t: "Enlace no válido o caducado", p: "Este enlace ya no es válido. Ponte en contacto con el alojamiento para recibir el enlace correcto.", r: "Reintentar" }
  };
  function guestLang() {
    var l = "";
    try { l = (new URLSearchParams(location.search).get("lang") || "").slice(0, 2).toLowerCase(); } catch (e) {}
    if (!INVALID_MSG[l]) { try { l = localStorage.getItem("spigole_lang") || ""; } catch (e) {} }
    if (!INVALID_MSG[l]) { l = ((navigator.language || "it") + "").slice(0, 2).toLowerCase(); }
    return INVALID_MSG[l] ? l : "en";
  }
  // Schermata a tutto schermo sopra la guida: "caricamento" neutro oppure "Link non valido" (niente guida demo, niente flash).
  function showOverlay(st) {
    function build() {
      var el = document.getElementById("guideStateOverlay");
      if (!el) { el = document.createElement("div"); el.id = "guideStateOverlay"; (document.body || document.documentElement).appendChild(el); }
      el.setAttribute("style", "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:#f6f4ef;color:#2b2b2b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center");
      if (st === "loading") {
        el.innerHTML = '<div style="width:34px;height:34px;border-radius:50%;border:3px solid #d9d4c8;border-top-color:#14424F;animation:gsspin .8s linear infinite"></div><style>@keyframes gsspin{to{transform:rotate(360deg)}}</style>';
      } else {
        var m = INVALID_MSG[guestLang()];
        el.innerHTML = '<div style="max-width:340px"><div style="font-size:42px;line-height:1;margin-bottom:14px" aria-hidden="true">&#128279;</div><h1 style="font-size:20px;margin:0 0 10px;font-weight:700">' + m.t + '</h1><p style="font-size:15px;line-height:1.5;margin:0 0 18px;color:#555">' + m.p + '</p><button type="button" id="guideStateRetry" style="font:inherit;font-size:14px;padding:10px 22px;border-radius:999px;border:1px solid #14424F;background:#fff;color:#14424F;cursor:pointer">' + m.r + '</button></div>';
        var rb = document.getElementById("guideStateRetry");
        if (rb) rb.addEventListener("click", function () { try { sessionStorage.removeItem("spigole_guide_fetched_" + pid); } catch (e) {} location.reload(); });
        try { document.title = m.t; } catch (e) {}
      }
    }
    if (document.body) build(); else document.addEventListener("DOMContentLoaded", build);
  }
  function setState(st) {
    window.GUIDE_STATE = st;
    if (st !== "ok") showOverlay(st);
    try { window.dispatchEvent(new Event("guidestate")); } catch (e) {}
  }

  function apply(g) {
    // Fondo i campi mancanti con la base neutra, così il motore ha sempre la struttura completa.
    window.PROPERTY = Object.assign({}, BASE, g, { social: Object.assign({}, BASE.social, (g && g.social) || {}), sectionImages: Object.assign({}, BASE.sectionImages, (g && g.sectionImages) || {}) });
    window.PROPERTIES = {}; window.PROPERTIES[window.PROPERTY.id] = window.PROPERTY;
  }

  if (pid === "__esempio__") {
    // Anteprima di esempio richiesta esplicitamente dall'host (pagina Guida ospiti).
    window.PROPERTY = FALLBACK; window.PROPERTIES = { demo: FALLBACK };
  } else if (!pid) {
    // Nessuna struttura nel link: link non valido (non mostro la guida demo).
    apply({}); setState("invalid");
  } else if (guides[pid]) {
    apply(guides[pid]); // guida locale (host che compila, o ospite che l'ha già scaricata)
  } else {
    // Ospite senza guida in locale: la scarico dal server e ricarico una volta; nel frattempo schermata neutra.
    apply({}); setState("loading");
    var guard = "spigole_guide_fetched_" + pid;
    var already = false;
    try { already = !!sessionStorage.getItem(guard); } catch (e) {}
    if (already) {
      setState("invalid"); // già provato in questa sessione e il server non ha una guida pubblicata
    } else {
      fetch(SUPA_URL + "/rest/v1/rpc/get_public_guide", {
        method: "POST",
        headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_id: pid })
      })
        .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (data) {
          try { sessionStorage.setItem(guard, "1"); } catch (e) {}
          if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) { setState("invalid"); return; } // nessuna guida pubblicata per questo id (anche {} = vuota)
          guides[pid] = data;
          var saved = false;
          try { localStorage.setItem("spigolestay:guides", JSON.stringify(guides)); saved = true; } catch (e) {}
          if (!saved) { try { sessionStorage.setItem(tmpKey, JSON.stringify(data)); saved = true; } catch (e) {} }
          if (saved) location.reload(); // ricarico: ora la guida reale è disponibile in locale
          else setState("invalid");
        })
        .catch(function () { setState("invalid"); }); // rete assente/errore server: stesso messaggio, l'ospite può riprovare ricaricando
    }
  }
})();
