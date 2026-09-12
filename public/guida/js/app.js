/* ============================================================
   Spigole Guest Guide — logica dell'app (vanilla JS)
   ============================================================ */

(function () {
  "use strict";

  var LANGS = ["it", "en", "fr", "de", "es"];
  var P = window.PROPERTY || {};
  var I18N = window.I18N || {};

  // ---------- Link personalizzato per ospite ----------
  // L'host invia un link tipo ?camera=4&tipo=Deluxe&k=1111-2222
  // I dati vengono salvati sul telefono dell'ospite e l'URL viene
  // ripulito, così i codici non restano nella barra degli indirizzi.
  (function () {
    var params = new URLSearchParams(location.search);
    // Nomi brevi (c/pk) con i vecchi (camera/tipo/park) come ripiego:
    // i link già in mano agli ospiti devono continuare a funzionare.
    var hasGuest = ["c", "camera", "k", "kr", "pk", "park", "p", "d", "tax", "g"].some(function (x) { return params.has(x); });
    if (hasGuest) {
      var guest = {
        room: params.get("c") || params.get("camera") || "",
        type: params.get("tipo") || "",
        k: params.get("k") || "",
        kr: params.get("kr") || "", // codici PER CAMERA (prenotazioni di gruppo): JSON [{r,c:[{l,v}]}]
        park: params.has("pk") ? params.get("pk") : (params.has("park") ? params.get("park") : ""),
        p: params.get("p") || "",
        d: params.get("d") || "",    // portale documenti Octorate, uno per prenotazione
        tax: params.get("tax") || "", // "fixed" = testo tassa a 2 €/persona/notte invece del 4%
        name: (params.get("g") || "").slice(0, 40) // nome ospite (dalla prenotazione): saluto personalizzato
      };
      try { localStorage.setItem("spigole_guest", JSON.stringify(guest)); } catch (e) {}
      history.replaceState(null, "", location.pathname + location.hash);
    }
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("spigole_guest") || "null"); } catch (e) {}

    // Parcheggio prenotato? (default: sì, come nella guida base)
    P.parking = true;
    if (saved && saved.park !== undefined && saved.park !== "") {
      P.parking = !(saved.park === "0" || saved.park === "no" || saved.park === "false");
    }

    if (saved) {
      if (saved.room) {
        P.room = saved.room;        // solo come "flag" di personalizzazione
        P.roomType = saved.type || "";
        var lab = roomLabel(roomsList());
        P.roomNum = lab.listed;
        P.roomNums = lab.nums;
        P.roomPlural = lab.plural;
      }
      if (saved.name) P.guestName = String(saved.name).replace(/[<>&]/g, "");
      // Portale documenti: accetto solo http(s), così un link manomesso
      // non può infilare uno "javascript:" nel pulsante.
      if (saved.d && /^https?:\/\//i.test(saved.d)) P.docsUrl = saved.d;
      // Testo tassa: "fixed" mostra la variante a 2 €/persona/notte (via pIf.taxFixed)
      if (saved.tax === "fixed") P.taxFixed = true;
      if (saved.k) {
        // k = cancello-porta1-porta2 (le porte sono i codici delle cassette:
        // una struttura può averne più di una, es. Central Perk).
        var codes = String(saved.k).split(/[-.,;]/);
        if (codes[0]) P.gateCode = codes[0];
        if (codes[1]) P.doorCode = codes[1];
        if (codes[2]) P.doorCode2 = codes[2];
      }
      // kr = codici PER CAMERA (prenotazione di gruppo, 2+ camere in un unico link).
      if (saved.kr) {
        try { var rc = JSON.parse(saved.kr); if (Array.isArray(rc) && rc.length) P.roomCodesList = rc; } catch (e) {}
      }
    }
  })();

  // ---------- Icone (SVG inline, stile linea) ----------
  var ICONS = {
    key: '<path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3-3.5 3.5z"/>',
    wifi: '<path d="M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M2 9.5a15 15 0 0 1 20 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>',
    car: '<path d="M5 17h14M6 11l1.5-4.5A2 2 0 0 1 9.4 5h5.2a2 2 0 0 1 1.9 1.5L18 11m-12 0h12a2 2 0 0 1 2 2v4h-2m-12 0H4v-4a2 2 0 0 1 2-2z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
    coffee: '<path d="M17 8h1a3 3 0 0 1 0 6h-1M3 8h14v7a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8zM7 2v2m4-2v2"/>',
    bed: '<path d="M2 18v-7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v7M2 18h20M2 18v2m20-2v2M6 9V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 17V8h3.5a2.5 2.5 0 0 1 0 5H9"/>',
    temple: '<path d="M3 21h18M4 18h16M6 18v-8m4 8v-8m4 8v-8m4 8v-8M3 10h18L12 3 3 10z"/>',
    landmark: '<path d="M12 2l3 3-3 3-3-3 3-3zM5 10h14M6 10v8m6-8v8m6-8v8M4 18h16v3H4v-3z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18M9 15l2 2 4-4"/>',
    beach: '<path d="M2 21h20M12 21v-8m0 0a7 7 0 0 0-7-7c4-2 10-2 14 0a7 7 0 0 0-7 7zM12 6V4"/>',
    boat: '<path d="M4 15l8-2 8 2-2.5 5h-11L4 15zM12 13V4m0 0 6 7M12 4 6 11"/>',
    food: '<path d="M5 3v8m3-8v8M6.5 3v18M6.5 11H4a1 1 0 0 1-1-1M6.5 11H9a1 1 0 0 0 1-1M17 3c-2 0-3 2.5-3 5s1 4 3 4 3-1.5 3-4-1-5-3-5zm0 9v9"/>',
    pizza: '<path d="M12 21 4.6 6.8Q12 3.6 19.4 6.8Z"/><path d="M6.2 10q5.8-2.2 11.6 0"/><circle cx="10" cy="11.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.4" cy="12.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="11.6" cy="16" r="1" fill="currentColor" stroke="none"/>',
    taxi: '<path d="M5 16h14M6 10l1.2-3.6A2 2 0 0 1 9.1 5h5.8a2 2 0 0 1 1.9 1.4L18 10m-12 0h12a2 2 0 0 1 2 2v4h-2m-12 0H4v-4a2 2 0 0 1 2-2zM10 5V3h4v2"/><circle cx="7.5" cy="16" r="1.5"/><circle cx="16.5" cy="16" r="1.5"/>',
    laundry: '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M8 5h.01M11 5h.01M9 13a3 3 0 0 0 6 0"/>',
    pharmacy: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M12 11v6m-3-3h6"/>',
    alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4m0 3h.01"/>',
    star: '<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.5 5.8 21l1.4-7L2 9.3l7-.8L12 2z"/>',
    calplus: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18M12 13v6m-3-3h6"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/><path d="M9 11h.01M12 11h.01M15 11h.01"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14m6-12v14"/>',
    snow: '<path d="M12 2v20M3 7l18 10M21 7L3 17M12 6l-3-2m3 2 3-2m-3 12-3 2m3-2 3 2M6.5 9.5 5 6.5m1.5 3-3 .5m14 4 3-.5m-3 .5 1.5 3M6.5 14.5 3.5 14m3 .5-1.5 3M17.5 9.5l1.5-3m-1.5 3 3 .5"/>',
    tv: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M9 21h6"/>',
    wind: '<path d="M3 8h9a3 3 0 1 0-3-3M3 12h13a3 3 0 1 1-3 3M3 16h7"/>',
    towel: '<rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/>',
    fridge: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M6 10h12M15 5v3m0 5v4"/>',
    drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8L18 16z"/>',
    iron: '<path d="M3 16h11a6 6 0 0 0-6-6H7l-4 6zM3 16v3h11v-3M9 10V7a2 2 0 0 1 2-2h7"/>',
    balcony: '<path d="M4 21V11h16v10M3 11h18M8 15v6m4-6v6m4-6v6M7.5 8a4.5 4.5 0 0 1 9 0"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="3.5"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
    facebook: '<path d="M14 8.5V7a1.5 1.5 0 0 1 1.5-1.5H17V2.5h-2.5A4 4 0 0 0 10.5 6.5V8.5H8V12h2.5v9.5H14V12h2.5l.5-3.5H14z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>'
  };

  function icon(name, cls) {
    return '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.info) + "</svg>";
  }

  // Colore per ogni sezione: icona in tinta forte, quadrato in tinta soft
  var SECTION_COLORS = {
    checkin: "#C97B4A",
    wifi: "#4E8A97",
    breakfast: "#C0873F",
    attractions: "#B0704E",
    restaurants: "#B4553F",
    excursions: "#4A82A0",
    taxi: "#C6A03E",
    info: "#6E9A5E",
    contacts: "#4E8D8D",
    review: "#C39B3A"
  };

  function iconStyle(id) {
    var c = SECTION_COLORS[id] || "#B56953";
    return ' style="background:' + c + '22;color:' + c + '"';
  }

  // ---------- Utilità ----------
  function fill(text) {
    if (typeof text !== "string") return text;
    return text.replace(/\{(\w+)\}/g, function (m, k) {
      return P[k] !== undefined && P[k] !== "" ? P[k] : m;
    });
  }

  // Un avviso con data "until" è scaduto se oggi è oltre la fine di quel giorno.
  function expired(until) {
    if (!until) return false;
    return new Date() > new Date(until + "T23:59:59");
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function telHref(num) {
    return "tel:" + String(num).replace(/[^\d+]/g, "");
  }

  // --- Scelta mappa: Google Maps o Mappe di Apple ---
  function buildAppleMaps(googleUrl) {
    var coords = null, m;
    m = googleUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || googleUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) coords = m[1] + "," + m[2];
    var label = "";
    var mp = googleUrl.match(/\/maps\/place\/([^/@]+)/);
    if (mp) label = decodeURIComponent(mp[1].replace(/\+/g, " "));
    if (!label) {
      var mq = googleUrl.match(/[?&]query=([^&]+)/) || googleUrl.match(/\/maps\/search\/([^/?@]+)/);
      if (mq) { try { label = decodeURIComponent(mq[1].replace(/\+/g, " ")); } catch (e) { label = mq[1]; } }
    }
    if (coords) return "https://maps.apple.com/?ll=" + coords + "&q=" + encodeURIComponent(label || "Posizione");
    return "https://maps.apple.com/?q=" + encodeURIComponent(label || "");
  }

  function mapChooser(googleUrl) {
    var appleUrl = buildAppleMaps(googleUrl);
    var wrap = document.createElement("div");
    wrap.className = "map-sheet-backdrop";
    wrap.innerHTML =
      '<div class="map-sheet" role="dialog" aria-label="Apri la mappa">' +
        '<div class="map-sheet-title">Apri la mappa con…</div>' +
        '<a class="map-sheet-btn" href="' + esc(googleUrl) + '" target="_blank" rel="noopener">' + icon("pin") + "<span>Google Maps</span></a>" +
        '<a class="map-sheet-btn" href="' + esc(appleUrl) + '" target="_blank" rel="noopener">' + icon("pin") + "<span>Mappe di Apple</span></a>" +
        '<button type="button" class="map-sheet-cancel">Annulla</button>' +
      "</div>";
    document.body.appendChild(wrap);
    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    wrap.querySelector(".map-sheet-cancel").addEventListener("click", close);
    [].forEach.call(wrap.querySelectorAll("a"), function (a) { a.addEventListener("click", function () { setTimeout(close, 60); }); });
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a") : null;
    if (!a || a.closest(".map-sheet")) return;
    var href = a.getAttribute("href") || "";
    if (/google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo\.gl/i.test(href)) {
      e.preventDefault();
      mapChooser(a.href);
    }
  }, true);

  // Testo con marcatori: [[...]] → terracotta, [i]...[/i] → corsivo
  function richText(str) {
    return esc(fill(str))
      .replace(/\[\[(.+?)\]\]/g, '<span class="txt-accent">$1</span>')
      .replace(/\[i\]([\s\S]+?)\[\/i\]/g, "<em>$1</em>")
      .replace(/\[u\]([\s\S]+?)\[\/u\]/g, "<u>$1</u>");
  }

  function waHref(num, text) {
    var u = "https://wa.me/" + String(num).replace(/[^\d]/g, "");
    return text ? u + "?text=" + encodeURIComponent(text) : u;   // messaggio già pronto
  }

  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  // ---------- Stato ----------
  function getLang() {
    var l = localStorage.getItem("spigole_lang");
    return LANGS.indexOf(l) >= 0 ? l : null;
  }

  function setLang(l) {
    localStorage.setItem("spigole_lang", l);
    render();
  }

  // Sezioni della struttura corrente: quelle di base, con eventuali
  // override per-struttura (es. check-in/colazione di Central Perk).
  function sectionsFor(t) {
    var over = (t.sectionsByProperty && t.sectionsByProperty[P.id]) || null;
    if (!over) return t.sections;
    return t.sections.map(function (s) { return over[s.id] || s; });
  }

  // Camere dell'ospite, in ordine
  function roomsList() {
    return String(P.room || "").split(/[,;+]/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean)
      .sort(function (a, b) { return a - b; });
  }

  // Vero se almeno una camera dell'ospite è nell'elenco
  function roomIn(list) {
    return roomsList().some(function (x) { return list.indexOf(x) >= 0; });
  }
  // Vero se almeno una camera dell'ospite è fuori dall'elenco.
  // Serve per exceptRooms: chi prenota la 1 e la 2 insieme deve vedere
  // entrambi i passaggi, ognuno con la sua cassetta e il suo codice.
  function roomOut(list) {
    return roomsList().some(function (x) { return list.indexOf(x) < 0; });
  }

  // Le camere a cui si riferisce un singolo passaggio: se il passaggio vale
  // solo per certe camere, il testo deve citare quelle, non tutte.
  function stepRooms(st) {
    var r = roomsList();
    if (st.onlyRooms) return r.filter(function (x) { return st.onlyRooms.indexOf(x) >= 0; });
    if (st.exceptRooms) return r.filter(function (x) { return st.exceptRooms.indexOf(x) < 0; });
    return r;
  }

  // Etichetta camere: "3 (Deluxe)" oppure "la 1, 3 (Deluxe) e la 2 (Family)".
  // "nums" sono i soli numeri ("2, 3"), per i titoli e per le altre lingue:
  // niente tipologia e nessuna congiunzione da tradurre.
  function roomLabel(rooms) {
    if (!rooms.length) return { listed: "", nums: "", plural: false };
    var types = P.roomTypes || {};
    var typeOf = function (n) { return types[n] || (rooms.length === 1 ? P.roomType : "") || ""; };
    var nums = rooms.join(", ");
    if (rooms.length === 1) {
      var ty0 = typeOf(rooms[0]);
      // il template aggiunge "la numero" davanti → qui solo "3 (Family)"
      return { listed: rooms[0] + (ty0 ? " (" + ty0 + ")" : ""), nums: nums, plural: false };
    }
    // Raggruppo le camere per tipologia: "la 1, 3, 4 (Deluxe), la 8 (Suite) e la 2 (Family)"
    var order = [], byType = {};
    rooms.forEach(function (n) {
      var ty = typeOf(n), key = ty || "_";
      if (!byType[key]) { byType[key] = { ty: ty, nums: [] }; order.push(key); }
      byType[key].nums.push(n);
    });
    var groups = order.map(function (key) {
      var g = byType[key];
      return "la " + g.nums.join(", ") + (g.ty ? " (" + g.ty + ")" : "");
    });
    return {
      listed: groups.length > 1 ? groups.slice(0, -1).join(", ") + " e " + groups[groups.length - 1] : groups[0],
      nums: nums,
      plural: true
    };
  }

  // ---------- Rendering ----------
  var main = document.getElementById("main");

  function render() {
    var lang = getLang();
    var welcome = document.getElementById("welcome");
    var app = document.getElementById("app");

    if (!lang || !I18N[lang]) {
      welcome.classList.remove("hidden");
      app.classList.add("hidden");
      return;
    }

    welcome.classList.add("hidden");
    app.classList.remove("hidden");

    var t = I18N[lang];
    document.documentElement.lang = lang;
    renderLangSwitch(lang);
    renderFooter(t);

    var hash = location.hash.replace(/^#\/?/, "");
    var section = null;
    var _S = sectionsFor(t);
    for (var i = 0; i < _S.length; i++) {
      if (_S[i].id === hash) { section = _S[i]; break; }
    }

    // Barra in alto: logo sempre a sinistra. A destra, le lingue nella
    // home e la freccia "Indietro" nelle sezioni (al posto delle lingue).
    var back = document.getElementById("topbarBack");
    var lang = document.getElementById("langSwitch");
    var backLabel = document.getElementById("topbarBackLabel");
    if (backLabel) backLabel.textContent = t.ui.back;
    if (back) back.hidden = !section;
    if (lang) lang.style.display = section ? "none" : "";

    if (section) renderSection(t, section);
    else renderHome(t);

    window.scrollTo(0, 0);
    startGalleryAutoplay();
    startWifiDots();
  }

  // Puntini di paginazione del WiFi: si aggiornano allo scorrimento e sono cliccabili
  function startWifiDots() {
    var slider = document.querySelector(".wifi-slider");
    var dots = document.querySelectorAll(".wifi-dots .wdot");
    if (!slider || !dots.length) return;
    var update = function () {
      var idx = Math.round(slider.scrollLeft / slider.clientWidth);
      for (var i = 0; i < dots.length; i++) dots[i].classList.toggle("active", i === idx);
    };
    slider.addEventListener("scroll", update, { passive: true });
    for (var i = 0; i < dots.length; i++) {
      (function (n) {
        dots[n].addEventListener("click", function () {
          animateScrollLeft(slider, n * slider.clientWidth, 400);
        });
      })(i);
    }
    update();
  }

  // ---------- Carosello foto: scorrimento automatico ----------
  var galleryTimer = null;
  function animateScrollLeft(el, to, duration) {
    var start = el.scrollLeft;
    var change = to - start;
    if (Math.abs(change) < 1) { el.scrollLeft = to; return; }
    function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
    var stepMs = 16, elapsed = 0;
    var iv = setInterval(function () {
      elapsed += stepMs;
      var p = Math.min(elapsed / duration, 1);
      el.scrollLeft = start + change * ease(p);
      if (p >= 1) clearInterval(iv);
    }, stepMs);
  }

  function startGalleryAutoplay() {
    if (galleryTimer) { clearInterval(galleryTimer); galleryTimer = null; }
    var g = document.querySelector(".gallery");
    if (!g) return;
    var count = g.querySelectorAll("img").length; // foto originali
    if (count < 2) return;

    // Clono le foto in coda: dopo l'ultima ricompaiono le prime,
    // così lo scorrimento è continuo. Arrivati sui cloni, si resetta
    // in modo invisibile all'inizio (stessa immagine, nessun salto).
    var originals = Array.prototype.slice.call(g.querySelectorAll("img"));
    originals.forEach(function (im) {
      var c = im.cloneNode(true);
      c.setAttribute("aria-hidden", "true");
      g.appendChild(c);
    });
    var imgs = g.querySelectorAll("img");

    var idx = 0;
    var stop = function () {
      if (galleryTimer) { clearInterval(galleryTimer); galleryTimer = null; }
      // Rimuovo i cloni: da qui lo scorrimento manuale mostra solo le foto originali
      var clones = g.querySelectorAll('img[aria-hidden="true"]');
      for (var k = 0; k < clones.length; k++) clones[k].remove();
      g.removeEventListener("touchstart", stop);
      g.removeEventListener("pointerdown", stop);
      g.removeEventListener("wheel", stop);
    };
    // Appena l'ospite tocca/scorre, l'autoplay si ferma e prende il controllo
    g.addEventListener("touchstart", stop, { passive: true });
    g.addEventListener("pointerdown", stop);
    g.addEventListener("wheel", stop, { passive: true });

    galleryTimer = setInterval(function () {
      if (!document.body.contains(g)) { stop(); return; }
      idx += 1;
      animateScrollLeft(g, imgs[idx].offsetLeft, 600);
      if (idx >= count) {
        // finita la serie originale: reset invisibile all'inizio
        setTimeout(function () { g.scrollLeft = imgs[0].offsetLeft; idx = 0; }, 720);
      }
    }, 4000);
  }

  function renderLangSwitch(current) {
    var el = document.getElementById("langSwitch");
    el.innerHTML = LANGS.map(function (l) {
      return '<button class="lang-pill' + (l === current ? " active" : "") + '" data-lang="' + l + '">' + l.toUpperCase() + "</button>";
    }).join("");
  }

  function renderHome(t) {
    var html = "";

    var _wTitle = t.home.welcomeTitle && t.home.welcomeTitle.trim();
    var _wSub = t.home.welcomeSub && t.home.welcomeSub.trim();
    var _wBody = t.home.welcome && t.home.welcome.length && t.home.welcome.join("").trim();
    if (_wTitle || _wSub || _wBody) {
      // Messaggio di benvenuto: titolo dentro al box, niente titolone in cima
      html += '<div class="home-welcome">';
      if (_wTitle) {
        // Saluto personalizzato col nome ospite (dal link della prenotazione), se presente.
        var head = fill(t.home.welcomeTitle);
        if (P.guestName) head = /[,–-]\s*$/.test(head) ? head + " " + P.guestName : head + ", " + P.guestName;
        html += '<h2 class="welcome-heading">' + esc(head) + "</h2>";
      }
      if (_wSub) {
        html += '<p class="welcome-subheading">' + esc(fill(t.home.welcomeSub)) + "</p>";
      }
      (t.home.welcome || []).forEach(function (para, i) {
        html += "<p" + (i === 0 ? ' class="welcome-lead"' : "") + ">" + esc(fill(para)) + "</p>";
      });
      html += "</div>";
    } else if ((t.home.title && t.home.title.trim()) || (t.home.subtitle && t.home.subtitle.trim())) {
      html += '<div class="hero"><h2>' + esc(fill(t.home.title)) + "</h2><p>" + esc(fill(t.home.subtitle)) + "</p></div>";
    }

    // Le lingue non ancora aggiornate (hanno ancora la sezione
    // "emergency" separata) mantengono le azioni rapide
    var hasEmergency = sectionsFor(t).some(function (s) { return s.id === "emergency"; });
    if (hasEmergency) {
      html += '<div class="quick-row">';
      html += '<a class="quick-btn" href="' + esc(P.mapsUrl) + '" target="_blank" rel="noopener">' + icon("pin") + "<span>" + esc(t.ui.quickMap) + "</span></a>";
      html += quickBtn("#/wifi", "wifi", t.ui.quickWifi);
      html += '<a class="quick-btn" href="' + waHref(P.whatsapp) + '" target="_blank" rel="noopener">' + icon("chat") + "<span>" + esc(t.ui.quickWhatsapp) + "</span></a>";
      html += quickBtn("#/emergency", "alert", t.ui.quickEmergency);
      html += "</div>";
    }

    // Banner con foto della città
    var homeImg = (P.sectionImages || {}).home;
    if (homeImg) {
      html += '<div class="home-banner"><img src="' + esc(homeImg) + '" alt="' + esc(P.city) + '">' +
        '<span class="banner-caption">' + esc(P.city) + "</span></div>";
    }

    // Gruppi
    t.groups.forEach(function (g) {
      var tiles = "", cards = "";
      g.sections.forEach(function (id) {
        var s = null;
        var _S = sectionsFor(t);
        for (var i = 0; i < _S.length; i++) {
          if (_S[i].id === id) { s = _S[i]; break; }
        }
        if (!s) return;
        if (s.tile) {
          tiles += '<button class="tile" data-go="' + s.id + '" aria-label="' + esc(fill(s.title)) + '">' +
            '<span class="card-icon"' + iconStyle(s.id) + ">" + icon(s.icon) + "</span></button>";
        } else {
          cards += '<button class="card" data-go="' + s.id + '">' +
            '<span class="card-icon"' + iconStyle(s.id) + ">" + icon(s.icon) + "</span>" +
            "<span><h3>" + esc(fill(s.title)) + "</h3><p>" + esc(fill(s.sub || "")) + "</p></span>" +
            '<span class="chev">' + icon("chev") + "</span></button>";
        }
      });
      html += '<section class="group"><h3 class="group-title">' + esc(g.title) + "</h3>";
      if (tiles) html += '<div class="tiles">' + tiles + "</div>";
      if (cards) html += '<div class="cards">' + cards + "</div>";
      html += "</section>";
    });

    main.innerHTML = html;
  }

  function quickBtn(href, ic, label) {
    return '<a class="quick-btn" href="' + href + '">' + icon(ic) + "<span>" + esc(label) + "</span></a>";
  }

  function renderSection(t, s) {
    var html = '<div class="section-page">';
    if (s.watermark) html += '<img class="section-watermark" src="' + esc(s.watermark) + '" alt="" aria-hidden="true" onerror="this.style.display=\'none\'">';
    html += '<div class="section-head"><span class="card-icon"' + iconStyle(s.id) + ">" + icon(s.icon) + "</span>" +
      "<div><h2>" + esc(fill(s.title)) + "</h2>" + (s.sub ? "<p>" + esc(fill(s.sub)) + "</p>" : "") + "</div></div>";

    // Nel check-in le foto della camera vanno DOPO i passaggi (vedi sotto), non qui in alto.
    if (s.photos && s.photos.length && s.id !== "checkin") {
      html += renderPhotoGallery(s.photos, fill(s.title));
    } else if (!(s.photos && s.photos.length)) {
      var heroImg = (P.sectionImages || {})[s.id];
      if (heroImg && s.id !== "checkin") html += '<img class="section-hero" src="' + esc(heroImg) + '" alt="' + esc(fill(s.title)) + '" loading="lazy">';
    }

    if (s.intro) html += '<p class="section-intro">' + esc(fill(s.intro)) + "</p>";

    // Passaggi numerati (es. arrivo e self check-in)
    // Alcuni passaggi compaiono solo con/senza parcheggio prenotato
    var steps = (s.steps || []).filter(function (st) {
      if (st.parkOnly && !P.parking) return false;
      if (st.noParkOnly && P.parking) return false;
      if (st.onlyRooms && P.room && !roomIn(st.onlyRooms)) return false;
      if (st.exceptRooms && P.room && !roomOut(st.exceptRooms)) return false;
      return true;
    });
    if (steps.length) {
      html += '<ol class="steps">';
      steps.forEach(function (st, i) {
        // {roomNum} dentro un passaggio cita solo le camere di quel passaggio:
        // chi ha la 1 e la 2 legge "la numero 1" sulla cassetta in alto e
        // "la numero 2" su quella in basso. Ripristino subito dopo.
        var allNum = P.roomNum, allNums = P.roomNums, allPlural = P.roomPlural;
        if (P.room) {
          var lab = roomLabel(stepRooms(st));
          P.roomNum = lab.listed; P.roomNums = lab.nums; P.roomPlural = lab.plural;
        }
        var head = st.h;
        if (P.room) head = (P.roomPlural && st.hPersonalPlural) ? st.hPersonalPlural : (st.hPersonal || st.h);
        var body = st.p;
        if (P.room) body = (P.roomPlural && st.pPersonalPlural) ? st.pPersonalPlural : (st.pPersonal || st.p);
        html += '<li class="step"><span class="step-num">' + (i + 1) + "</span><div>" +
          "<h4>" + esc(fill(head)) + "</h4>" +
          "<p>" + richText(body) + "</p>";
        // Avviso temporaneo (es. chiusura per ferie): sparisce da solo dopo "until"
        if (st.notice && st.notice.text && !expired(st.notice.until)) {
          html += '<p class="step-notice">' + richText(fill(st.notice.text)) + "</p>";
        }
        if (st.codeKey) {
          if (P[st.codeKey]) {
            var codeText = esc(P[st.codeKey]) + (st.codeAfter ? esc(st.codeAfter) : "");
            html += '<span class="step-code">' + codeText + "</span>";
            var suffix = st.codeSuffix || (st.codeAfter ? "" : (t.ui.codeSuffix || "+ ●"));
            if (suffix) html += '<span class="step-code-suffix">' + esc(suffix) + "</span>";
          } else {
            // Codice assente: i codici non stanno più nel sito, arrivano solo
            // col link personale. Senza, il passaggio direbbe "il codice qui
            // sotto" senza nulla sotto: meglio spiegarlo.
            var fb = st.fallback || t.ui.codeMissing;
            if (fb) html += '<p class="step-note">' + esc(fill(fb)) + "</p>";
          }
        }
        html += renderActions(st.actions);
        html += "</div></li>";
        P.roomNum = allNum; P.roomNums = allNums; P.roomPlural = allPlural;
      });
      html += "</ol>";
    }

    // Codici PER CAMERA (prenotazione di gruppo, 2+ camere in un unico link): un riquadro con
    // i codici di ciascuna camera. Compare solo nella sezione Arrivo/Check-in.
    if (s.id === "checkin" && P.roomCodesList && P.roomCodesList.length) {
      var rcTitle = (t.ui && t.ui.roomCodesTitle) || "I codici delle vostre camere";
      var rcWord = (t.ui && t.ui.roomWord) || "Camera";
      html += '<div style="margin-top:18px;border:1px solid rgba(0,0,0,.08);border-radius:14px;padding:14px 16px;background:#fff">';
      html += '<div style="font-weight:700;margin-bottom:6px;font-size:15px">' + esc(rcTitle) + "</div>";
      P.roomCodesList.forEach(function (rc) {
        var codes = (rc.c || []).filter(function (x) { return x && x.v; });
        if (!codes.length) return;
        html += '<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid rgba(0,0,0,.06)">';
        html += '<span style="font-weight:700;min-width:70px;color:#B04A2C">' + esc(rcWord + " " + (rc.r || "")) + "</span>";
        html += '<span style="display:flex;flex-wrap:wrap;gap:6px">';
        html += codes.map(function (x) { return '<span style="display:inline-flex;gap:6px;align-items:baseline;background:#f4efe9;border-radius:8px;padding:3px 9px;font-size:15px"><span style="color:#8a8177;font-size:12px">' + esc(x.l || "") + "</span><b>" + esc(x.v) + "</b></span>"; }).join("");
        html += "</span></div>";
      });
      html += "</div>";
    }

    // Galleria foto subito dopo i passaggi (flag gallery = camere da PROPERTY.roomPhotos)
    if (s.gallery) html += renderGallery();
    // Check-in: le foto della camera caricate dall'host (s.photos) vanno qui, dopo i passaggi.
    if (s.id === "checkin" && s.photos && s.photos.length) html += renderPhotoGallery(s.photos, fill(s.title), "gallery-rooms");

    // Griglia di iconcine dei servizi (es. dotazioni camera)
    // Alcuni servizi ci sono solo in certe camere (es. la macchinetta del
    // caffè). Come per i passaggi, il filtro vale solo se so quali camere ha
    // l'ospite: su un link generico li mostro tutti.
    var amenities = (s.amenities || []).filter(function (a) {
      if (a.onlyRooms && P.room && !roomIn(a.onlyRooms)) return false;
      if (a.exceptRooms && P.room && !roomOut(a.exceptRooms)) return false;
      return true;
    });
    if (amenities.length) {
      if (s.amenitiesTitle) html += '<h3 class="amenities-title">' + esc(fill(s.amenitiesTitle)) + "</h3>";
      if (s.amenitiesIntro) html += '<p class="section-intro">' + esc(fill(s.amenitiesIntro)) + "</p>";
      html += '<div class="amenities">';
      amenities.forEach(function (a) {
        html += '<span class="amenity">' + icon(a.icon) + "<span>" + esc(fill(a.label)) + "</span></span>";
      });
      html += "</div>";
    }

    // Rendering speciali
    if (s.id === "wifi") html += renderWifi(t);
    if ((s.id === "map" || s.mapEmbed) && P.mapsUrl) {
      html += '<iframe class="map-embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=' +
        encodeURIComponent(P.address || "Ortigia Siracusa") + '&output=embed" title="Map"></iframe>';
    }

    (s.items || []).forEach(function (item) {
      if (item.tel) {
        html += '<div class="tel-row"><span class="tel-name">' + esc(fill(item.h)) +
          (item.p ? "<small>" + esc(fill(item.p)) + "</small>" : "") + "</span>" +
          '<a href="' + telHref(fill(item.tel)) + '">' + icon("phone") + esc(fill(item.tel)) + "</a></div>";
        return;
      }
      html += '<div class="info-block' + (item.watermark ? " has-watermark" : "") + '">';
      if (item.watermark) html += '<img class="block-watermark" src="' + esc(item.watermark) + '" alt="" aria-hidden="true" onerror="this.style.display=\'none\'">';
      if (item.h) html += "<h4>" + esc(fill(item.h)) + "</h4>";
      // pIf: testo alternativo quando l'ospite ha un certo dato nel link
      // (es. il portale documenti di Octorate, che cambia a ogni prenotazione)
      var body = item.p;
      if (item.pIf) Object.keys(item.pIf).forEach(function (k) { if (P[k]) body = item.pIf[k]; });
      if (body) html += "<p>" + richText(body) + "</p>";
      if (item.list) {
        html += '<ul class="info-list">';
        item.list.forEach(function (li) {
          var name = typeof li === "string" ? li : li.n;
          var sub = (typeof li === "object" && li && typeof li.sub === "string") ? ' <span class="li-sub">— ' + richText(li.sub) + "</span>" : "";
          var tel = (typeof li === "object" && li && li.tel) ? ' <span class="li-sub">—</span> <a class="li-tel" href="' + telHref(li.tel) + '" aria-label="Chiama ' + esc(name) + '">' + icon("phone") + "</a>" : "";
          var map = (typeof li === "object" && li && li.map) ? ' <a class="li-map" href="' + esc(li.map) + '" aria-label="Mappa ' + esc(name) + '">' + icon("pin") + "</a>" : "";
          html += "<li>" + richText(name) + sub + map + tel + "</li>";
        });
        html += "</ul>";
      }
      html += renderActions(item.actions);
      if (item.img) html += '<a class="info-map" href="' + esc(item.img) + '" target="_blank" rel="noopener"><img src="' + esc(item.img) + '" alt="' + esc(fill(item.h || "Mappa")) + '" loading="lazy" onerror="this.parentNode.style.display=\'none\'"></a>';
      html += "</div>";
    });

    // La galleria delle camere (sezione "camera" delle lingue non aggiornate)
    if (s.id === "room") html += renderGallery();

    html += "</div>";
    main.innerHTML = html;
  }

  function renderFooter(t) {
    var s = P.social || {};
    var links = [];
    if (s.instagram) links.push('<a class="social-btn" href="' + esc(s.instagram) + '" target="_blank" rel="noopener" aria-label="Instagram">' + icon("instagram") + "</a>");
    if (s.facebook) links.push('<a class="social-btn" href="' + esc(s.facebook) + '" target="_blank" rel="noopener" aria-label="Facebook">' + icon("facebook") + "</a>");
    if (s.website) links.push('<a class="social-btn" href="' + esc(s.website) + '" target="_blank" rel="noopener" aria-label="Sito web">' + icon("globe") + "</a>");

    var bar = document.getElementById("socialBar");
    if (bar) bar.innerHTML = links.join("");

    var credit = P.footerCredit || (P.name + " · " + P.city);
    var site = s.website || "https://www.spigolehouse.it";
    var creditHtml = esc(credit).replace(/Spigolehouse\.it/i, '<a class="footer-link" href="' + esc(site) + '" target="_blank" rel="noopener">Spigolehouse.it</a>');
    document.querySelector(".footer").innerHTML = '<p class="footer-name">' + creditHtml + "</p>";
  }

  function renderActions(actions) {
    if (!actions || !actions.length) return "";
    // onlyIf: il pulsante compare solo se quel dato è arrivato col link
    // (senza, resterebbe un href tipo "{docsUrl}" che non porta da nessuna parte)
    // exceptIf: il contrario — sparisce quando quel dato c'è
    actions = actions.filter(function (a) {
      if (a.onlyIf && !P[a.onlyIf]) return false;
      if (a.exceptIf && P[a.exceptIf]) return false;
      return true;
    });
    if (!actions.length) return "";
    var html = '<div class="block-actions">';
    actions.forEach(function (a) {
      var href = fill(a.href);
      if (a.type === "tel") href = telHref(href);
      if (a.type === "wa") href = waHref(href, a.waText ? fill(a.waText) : "");
      if (a.type === "mail") href = "mailto:" + href;
      var external = /^https?:/.test(href) ? ' target="_blank" rel="noopener"' : "";
      html += '<a class="action-btn ' + (a.style || "") + '" href="' + esc(href) + '"' + external + ">" +
        (a.icon ? icon(a.icon) : "") + esc(fill(a.label)) + "</a>";
    });
    return html + "</div>";
  }

  function renderWifi(t) {
    // Il QR viene generato e incorporato dall'editor (P.wifiQr). Se non c'è, mostriamo solo le
    // credenziali (niente immagine segnaposto): il pannello QR e i puntini appaiono solo col QR.
    var qr = P.wifiQr || "";
    var creds = '<div class="wifi-panel wifi-card">' +
        '<div class="wifi-title">wifi</div>' +
        '<div class="wifi-cols">' +
          '<div class="wifi-col"><div class="wifi-label">' + esc(t.ui.wifiNetwork) + "</div>" +
          '<div class="wifi-value">' + esc(P.wifiNetwork) + "</div></div>" +
          '<div class="wifi-col"><div class="wifi-label">' + esc(t.ui.wifiPassword) + "</div>" +
          '<div class="wifi-value">' + esc(P.wifiPassword) + "</div>" +
          '<button class="copy-btn" id="copyWifi">' + esc(t.ui.copy) + "</button></div>" +
        "</div>" +
      "</div>";
    if (!qr) return '<div class="wifi-slider">' + creds + "</div>";
    return '<div class="wifi-slider">' + creds +
      '<div class="wifi-panel wifi-qr">' +
        '<img src="' + esc(qr) + '" alt="QR WiFi">' +
        "<p>" + esc(t.ui.wifiQrCaption || "Scan me") + "</p>" +
      "</div>" +
    "</div>" +
    '<div class="wifi-dots"><span class="wdot"></span><span class="wdot"></span></div>';
  }

  function renderPhotoGallery(list, altBase, cls) {
    var html = '<div class="gallery' + (cls ? " " + cls : "") + '">';
    (list || []).forEach(function (src, i) {
      html += '<img src="' + esc(src) + '" alt="' + esc(altBase || "Foto") + " " + (i + 1) + '" loading="lazy">';
    });
    return html + "</div>";
  }

  function renderGallery() {
    return renderPhotoGallery(P.roomPhotos, "Camera", "gallery-rooms");
  }

  // ---------- Eventi ----------
  document.addEventListener("click", function (e) {
    var langBtn = e.target.closest("[data-lang]");
    if (langBtn) { setLang(langBtn.getAttribute("data-lang")); return; }

    var go = e.target.closest("[data-go]");
    if (go) {
      var id = go.getAttribute("data-go");
      if (id) location.hash = "#/" + id;
      else { location.hash = ""; render(); }
      return;
    }

    if (e.target.closest("#brandHome")) {
      // Il logo riporta alla schermata iniziale di scelta della lingua
      localStorage.removeItem("spigole_lang");
      location.hash = "";
      render();
      return;
    }

    if (e.target.closest("#copyWifi")) {
      var lang = getLang();
      var msg = (I18N[lang] && I18N[lang].ui.copied) || "OK";
      var pass = P.wifiPassword || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pass).then(function () { toast(msg); });
      } else {
        var ta = document.createElement("textarea");
        ta.value = pass;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); toast(msg); } catch (err) {}
        document.body.removeChild(ta);
      }
    }
  });

  window.addEventListener("hashchange", render);

  // Branding della struttura corrente (nome e logo su welcome + topbar)
  function applyBranding() {
    var name = P.guideName || P.name || "";
    var logo = P.guideLogo || "assets/logo-trasparente.png";
    var wn = document.querySelector(".welcome-name"); if (wn && name) wn.textContent = name;
    var ws = document.querySelector(".welcome-sub"); if (ws) ws.textContent = "Bed & Breakfast " + (P.city || "Siracusa");
    var wl = document.querySelector(".welcome-logo"); if (wl) wl.src = logo;
    var bl = document.querySelector(".brand-logo"); if (bl) bl.src = logo;
    document.documentElement.style.setProperty("--welcome-watermark", "url('/" + logo + "')");
    if (name) document.title = name + " · Guest Guide";
  }
  applyBranding();

  render();
})();
