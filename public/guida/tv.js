/* ============================================================
   Vista TV — fedele al design originale Spigolehouse, ma multi-tenant.
   Legge window.PROPERTY / window.I18N (stessi dati della guida mobile).
   Canvas 1280×720 scalato, navigabile col telecomando.
   ============================================================ */
(function () {
  "use strict";
  var P = window.PROPERTY || {};
  var I18N = window.I18N || {};
  var LANGS = ["it", "en", "fr", "de", "es"];
  var FLAG = { it: "🇮🇹", en: "🇬🇧", fr: "🇫🇷", de: "🇩🇪", es: "🇪🇸" };
  var TV = P.tv || {};
  var guest = null; try { guest = JSON.parse(localStorage.getItem("spigole_guest") || "null"); } catch (e) {}

  var lang = "it";
  try { var lp = new URLSearchParams(location.search).get("lang"); if (LANGS.indexOf(lp) >= 0) lang = lp; } catch (e) {}
  function L() { return I18N[lang] || I18N.it || { ui: {} }; }

  // Testi "cornice" della TV (non nei contenuti host): tradotti a mano nelle 5 lingue.
  var TVUI = {
    it: { kicker: "Guida ospiti", note: "Tutte le info di casa e città nella <b>Guida ospiti</b> — inquadra il QR.", scan: "Scan Wi-Fi", guide: "Guida sul<br>telefono", net: "Rete", pw: "Password", open: "apri", move: "sposta", back: "chiudi", rooms: "Camera", hello: "Benvenuti," },
    en: { kicker: "Guest guide", note: "Everything about the house and the city in the <b>Guest guide</b> — scan the QR.", scan: "Scan Wi-Fi", guide: "Guide on<br>your phone", net: "Network", pw: "Password", open: "open", move: "move", back: "close", rooms: "Room", hello: "Welcome," },
    fr: { kicker: "Guide voyageur", note: "Toutes les infos maison et ville dans le <b>Guide voyageur</b> — scannez le QR.", scan: "Scan Wi-Fi", guide: "Guide sur<br>le téléphone", net: "Réseau", pw: "Mot de passe", open: "ouvrir", move: "déplacer", back: "fermer", rooms: "Chambre", hello: "Bienvenue," },
    de: { kicker: "Gästeführer", note: "Alles zu Haus und Stadt im <b>Gästeführer</b> — QR scannen.", scan: "Wi-Fi scannen", guide: "Guide auf<br>dem Handy", net: "Netzwerk", pw: "Passwort", open: "öffnen", move: "bewegen", back: "schließen", rooms: "Zimmer", hello: "Willkommen," },
    es: { kicker: "Guía del huésped", note: "Toda la info de la casa y la ciudad en la <b>Guía del huésped</b> — escanea el QR.", scan: "Escanear Wi-Fi", guide: "Guía en<br>el móvil", net: "Red", pw: "Contraseña", open: "abrir", move: "mover", back: "cerrar", rooms: "Habitación", hello: "Bienvenidos," }
  };
  function T() { return TVUI[lang] || TVUI.it; }

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function interp(s) { return String(s == null ? "" : s).replace(/\{(\w+)\}/g, function (_, k) { return P[k] != null ? P[k] : ""; }); }
  function plain(s) { return interp(String(s == null ? "" : s)).replace(/\[\[|\]\]|\[\/?i\]|\[\/?u\]/g, "").replace(/\s*\n\s*/g, " · ").trim(); }

  // ---------- Icone (SVG linea) ----------
  var IC = {
    arrivo: '<circle cx="8" cy="8" r="4"/><path d="M11 11l8 8M16 16l2-2M18 18l2-2"/>',
    colazione: '<path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 9h2.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 2c-.6.8-.6 1.7 0 2.5M12 2c-.6.8-.6 1.7 0 2.5"/>',
    esplora: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
    mangiare: '<path d="M5 3v7a2 2 0 0 0 2 2h0v9M7 3v6M9 3v6"/><path d="M17 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4v9"/>',
    mare: '<path d="M2 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
    trasporti: '<rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 11h16M8 17v2M16 17v2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
    contatti: '<path d="M4 5c0 8 7 15 15 15l1-4-5-2-2 2c-2-1-4-3-5-5l2-2-2-5-4 1Z"/>',
    wifi: '<path d="M3 9c5-5 13-5 18 0M6.5 12.5c3.2-3.2 7.8-3.2 11 0M10 16a3.5 3.5 0 0 1 4 0"/><path d="M12 19.5h.01"/>',
    star: '<path d="M12 3l2.6 5.6 6 .7-4.4 4 1.2 6L12 16.9 6.6 19.3l1.2-6-4.4-4 6-.7L12 3Z"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>'
  };
  // Sezione della guida → icona TV
  var SEC_ICON = { checkin: "arrivo", breakfast: "colazione", attractions: "esplora", restaurants: "mangiare", excursions: "mare", taxi: "trasporti", info: "info", faq: "info", contacts: "contatti", review: "star", wifi: "wifi", extras: "sparkle" };
  var SEC_COLOR = { arrivo: "oklch(74% 0.1 90)", colazione: "oklch(74% 0.1 55)", esplora: "oklch(74% 0.1 130)", mangiare: "oklch(74% 0.1 25)", mare: "oklch(74% 0.1 200)", trasporti: "oklch(74% 0.1 250)", info: "oklch(74% 0.1 300)", contatti: "oklch(74% 0.1 165)", star: "oklch(78% 0.12 85)", wifi: "oklch(74% 0.1 210)", sparkle: "oklch(76% 0.11 320)" };
  function icsvg(k, s) { return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (IC[k] || IC.info) + "</svg>"; }
  function qrImg(text, size) { return '<img src="https://api.qrserver.com/v1/create-qr-code/?size=' + size + "x" + size + "&margin=0&data=" + encodeURIComponent(text) + '" alt="QR" onerror="this.style.display=\'none\'">'; }

  function getSection(id) {
    var byP = (L().sectionsByProperty || {})[P.id];
    if (byP && byP[id]) return byP[id];
    return (L().sections || []).filter(function (s) { return s.id === id; })[0];
  }
  function sectionImg(sec) {
    if (sec && sec.photos && sec.photos[0]) return sec.photos[0];
    if (sec && P.sectionImages && P.sectionImages[sec.id]) return P.sectionImages[sec.id];
    if (P.roomPhotos && P.roomPhotos[0]) return P.roomPhotos[0];
    return "";
  }
  // Quali sezioni mostrare nel dock (max 8): scelta del pannello TV, altrimenti dai gruppi.
  function shownIds() {
    var ids = [];
    if (TV.sections && TV.sections.length) ids = TV.sections.slice();
    else (L().groups || []).forEach(function (g) { (g.sections || []).forEach(function (id) { ids.push(id); }); });
    // solo sezioni esistenti e non "wifi" (il WiFi ha già la sua card)
    ids = ids.filter(function (id) { return id !== "wifi" && getSection(id); });
    return ids.slice(0, 8);
  }

  // Righe del pannello dettaglio a partire dalla sezione (passaggi + blocchi + servizi).
  function rowsFor(sec) {
    var out = [];
    (sec.steps || []).forEach(function (st) {
      var code = st.codeKey && P[st.codeKey] ? esc(P[st.codeKey]) + (st.codeAfter || "") : "";
      out.push({ b: plain(st.h), p: plain(st.p), code: code });
    });
    (sec.items || []).forEach(function (it) {
      var p = it.p ? plain(it.p) : "";
      if (it.list && it.list.length) {
        var names = it.list.map(function (r) { return typeof r === "string" ? r : (r.n + (r.sub ? " — " + r.sub : "")); }).join(" · ");
        p = p ? p + " · " + names : names;
      }
      out.push({ b: plain(it.h), p: p });
    });
    if (sec.amenities && sec.amenities.length) {
      out.push({ b: plain(sec.amenitiesTitle) || "Servizi", p: sec.amenities.map(function (a) { return a.label; }).join(" · ") });
    }
    return out.filter(function (r) { return r.b || r.p; });
  }

  // ---------- Fit ----------
  function fit() {
    var s = Math.min(innerWidth / 1280, innerHeight / 720);
    if (!isFinite(s) || s <= 0) { setTimeout(fit, 200); return; }
    document.getElementById("tv").style.transform = "translate(-50%,-50%) scale(" + s + ")";
  }
  addEventListener("resize", fit); addEventListener("load", fit); fit();
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement); else setInterval(fit, 1500);

  // ---------- Orologio ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var LOC = { it: "it-IT", en: "en-GB", fr: "fr-FR", de: "de-DE", es: "es-ES" };
  function tick() {
    var d = new Date();
    document.getElementById("clock").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes());
    var ds = d.toLocaleDateString(LOC[lang] || "it-IT", { weekday: "long", day: "numeric", month: "long" });
    document.getElementById("date").textContent = ds.charAt(0).toUpperCase() + ds.slice(1);
  }
  tick(); setInterval(tick, 10000);

  // ---------- Meteo (Open-Meteo, geocodifica dalla città) ----------
  var WICON = {
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4"/>',
    psun: '<path d="M7 15a4.5 4.5 0 1 1 8.4-2.2A3.6 3.6 0 0 1 15 20H8a3.6 3.6 0 0 1-1-7Z"/><path d="M15 6.5a3 3 0 0 1 3-2.5M19.5 9H21M17.6 4l1-1"/>',
    cloud: '<path d="M6.5 19a4.5 4.5 0 1 1 .6-8.96A5.5 5.5 0 0 1 17.6 12 3.5 3.5 0 0 1 17 19H6.5Z"/>',
    rain: '<path d="M6.5 15a4.5 4.5 0 1 1 .6-8.96A5.5 5.5 0 0 1 17.6 8 3.5 3.5 0 0 1 17 15H6.5Z"/><path d="M8 18l-1 2.5M12.5 18l-1 2.5M17 18l-1 2.5"/>',
    storm: '<path d="M6.5 14a4.5 4.5 0 1 1 .6-8.96A5.5 5.5 0 0 1 17.6 7 3.5 3.5 0 0 1 17 14H6.5Z"/><path d="M12.5 14 10 18h3l-2 4"/>',
    fog: '<path d="M4 10h16M6 14h14M4 18h13"/>'
  };
  function wcode(c) { if (c <= 1) return "sun"; if (c === 2) return "psun"; if (c === 45 || c === 48) return "fog"; if (c === 3) return "cloud"; if (c >= 95) return "storm"; if (c >= 51) return "rain"; return "cloud"; }
  function wxsvg(k) { return '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + WICON[k] + "</svg>"; }
  var DAYS = { it: ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], fr: ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"], de: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"], es: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] };
  var TODAY = { it: "Oggi", en: "Today", fr: "Auj.", de: "Heute", es: "Hoy" };
  function renderWx(list) { document.getElementById("wxrow").innerHTML = list.map(function (w) { return '<div class="wx"><div class="d">' + w.d + "</div>" + wxsvg(w.i) + '<div class="t">' + w.t + "</div></div>"; }).join(""); }
  (function () { var t = new Date(), ph = []; for (var i = 0; i < 3; i++) { var d = new Date(t); d.setDate(d.getDate() + i); ph.push({ d: i === 0 ? TODAY[lang] : (DAYS[lang] || DAYS.it)[d.getDay()], i: "sun", t: "—" }); } renderWx(ph); })();
  if (P.city) {
    fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(P.city) + "&count=1&language=" + lang)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var g = j && j.results && j.results[0]; if (!g) return;
        return fetch("https://api.open-meteo.com/v1/forecast?latitude=" + g.latitude + "&longitude=" + g.longitude + "&daily=weather_code,temperature_2m_max&timezone=auto&forecast_days=3")
          .then(function (r) { return r.json(); })
          .then(function (f) {
            var out = f.daily.time.map(function (t, i) { var d = new Date(t + "T12:00:00"); return { d: i === 0 ? TODAY[lang] : (DAYS[lang] || DAYS.it)[d.getDay()], i: wcode(f.daily.weather_code[i]), t: Math.round(f.daily.temperature_2m_max[i]) + "°" }; });
            renderWx(out);
          });
      }).catch(function () {});
  }

  // ---------- Branding + hero + wifi ----------
  function renderChrome() {
    var name = interp(P.guideName || P.name || "");
    document.getElementById("bname").innerHTML = esc(name);
    document.getElementById("medal").innerHTML = P.guideLogo ? '<img src="' + esc(P.guideLogo) + '" alt="">' : "";
    var roomline = (TV.showGuest !== false && guest && guest.room) ? (T().rooms + " " + esc(guest.room)) : (P.city ? esc(P.city) : "");
    document.getElementById("roomline").textContent = roomline;

    var home = L().home || {};
    document.getElementById("kicker").textContent = T().kicker;
    var hello = interp(home.welcomeTitle || T().hello);
    if (TV.showGuest !== false && guest && guest.name) hello = /[,–-]\s*$/.test(hello) ? hello + " " + guest.name : hello + ", " + guest.name;
    document.getElementById("welcome").innerHTML = esc(hello);
    var sub = TV.welcome || (home.welcome && home.welcome.join("<br>")) || "";
    document.getElementById("welcomesub").innerHTML = esc(interp(sub)).replace(/\n/g, "<br>");
    document.getElementById("heronote").innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="12" height="18" rx="2"/><path d="M8 3h4M10 18h.01"/><path d="M19 8l2 2-2 2"/></svg><span>' + T().note + "</span>";

    document.getElementById("wlNet").textContent = T().net;
    document.getElementById("wlPw").textContent = T().pw;
    document.getElementById("wifiScan").textContent = T().scan;
    document.getElementById("wvNet").textContent = P.wifiNetwork || "—";
    document.getElementById("wvPw").textContent = P.wifiPassword || "—";
    var wifiQr = document.getElementById("qrwifi");
    if (P.wifiNetwork) wifiQr.innerHTML = qrImg("WIFI:T:WPA;S:" + P.wifiNetwork + ";P:" + (P.wifiPassword || "") + ";;", 78);
    else wifiQr.innerHTML = "";

    // selettore lingua
    document.getElementById("langs").innerHTML = LANGS.map(function (l) { return '<button class="langbtn' + (l === lang ? " on" : "") + '" data-lang="' + l + '">' + FLAG[l] + "</button>"; }).join("");
    [].slice.call(document.querySelectorAll(".langbtn")).forEach(function (b) {
      b.onclick = function () { var u = new URL(location.href); u.searchParams.set("lang", b.getAttribute("data-lang")); location.href = u.toString(); };
    });
  }

  // ---------- Dock ----------
  var SEC = shownIds().map(function (id) { return getSection(id); }).filter(Boolean);
  function renderDock() {
    var dock = document.getElementById("dock");
    var mobileUrl = location.origin + "/guida/index.html?p=" + encodeURIComponent(P.id || "");
    dock.innerHTML = SEC.map(function (sec, i) {
      var ik = SEC_ICON[sec.id] || "info";
      return '<div class="chip" data-i="' + i + '"><span style="color:' + (SEC_COLOR[ik] || "#CBA662") + '">' + icsvg(ik, 24) + "</span><span>" + esc(interp(sec.title)) + "</span></div>";
    }).join("") + '<div class="guidecard" data-i="' + SEC.length + '"><div class="qrbox">' + qrImg(mobileUrl, 78) + '</div><span>' + T().guide + "</span></div>";
    items = [].slice.call(dock.children);
    items.forEach(function (el) { el.addEventListener("click", function () { setFocus(+el.dataset.i); openPanel(); }); });
    setFocus(Math.min(cur, items.length - 1));
  }

  // ---------- D-pad ----------
  var items = [], cur = 0, open = false;
  function setFocus(i) { if (!items.length) return; if (items[cur]) items[cur].classList.remove("foc"); cur = Math.max(0, Math.min(items.length - 1, i)); items[cur].classList.add("foc"); try { items[cur].focus(); } catch (e) {} }
  function move(dx, dy) {
    var n = SEC.length, gi = n, i = cur;
    if (i === gi) { if (dx === -1) i = Math.min(3, n - 1); else return; }
    else {
      var col = i % 4, row = (i / 4) | 0;
      if (dx === 1) { if (col === 3 || i === n - 1) i = gi; else i = Math.min(i + 1, n - 1); }
      else if (dx === -1) { if (col > 0) i -= 1; }
      else if (dy === 1) { if (i + 4 <= n - 1) i += 4; }
      else if (dy === -1) { if (row > 0) i -= 4; }
    }
    if (i !== cur) setFocus(i);
  }

  function openPanel() {
    if (cur >= SEC.length) return; // guidecard: solo QR
    var sec = SEC[cur]; var ik = SEC_ICON[sec.id] || "info";
    document.getElementById("pk").innerHTML = icsvg(ik, 18) + "<span>" + esc(interp(sec.title)) + "</span>";
    document.getElementById("ptitle").textContent = interp(sec.title);
    document.getElementById("plede").textContent = plain(sec.intro || sec.sub || "");
    var ph = document.getElementById("pphoto"); var img = sectionImg(sec);
    if (img) { ph.innerHTML = '<img src="' + esc(img) + '" alt="">'; ph.style.display = "block"; } else { ph.innerHTML = ""; ph.style.display = "none"; }
    document.getElementById("prows").innerHTML = rowsFor(sec).map(function (r) {
      return '<div class="row"><div class="dot"></div><div><b>' + esc(r.b) + "</b>" + (r.p ? "<p>" + esc(r.p) + "</p>" : "") + (r.code ? '<span class="code">' + r.code + "</span>" : "") + "</div></div>";
    }).join("");
    document.getElementById("phint").innerHTML = "<span><b>OK</b> " + T().open + "</span><span><b>←→↑↓</b> " + T().move + "</span><span><b>Back</b> " + T().back + "</span>";
    document.getElementById("tv").classList.add("open"); open = true;
  }
  function closePanel() { document.getElementById("tv").classList.remove("open"); open = false; }

  document.addEventListener("keydown", function (e) {
    var k = e.key, kc = e.keyCode;
    var isBack = k === "Escape" || k === "Backspace" || k === "GoBack" || k === "BrowserBack" || kc === 461 || kc === 10009;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].indexOf(k) >= 0 || isBack) e.preventDefault();
    if (open) { if (isBack || k === "Enter") closePanel(); return; }
    if (k === "ArrowLeft") move(-1, 0);
    else if (k === "ArrowRight") move(1, 0);
    else if (k === "ArrowUp") move(0, -1);
    else if (k === "ArrowDown") move(0, 1);
    else if (k === "Enter" || k === " ") openPanel();
  });

  // ---------- Sfondo ----------
  (function () {
    var photo = document.getElementById("photo");
    var bg = TV.bg || sectionImg(getSection("attractions") || {}) || (P.roomPhotos && P.roomPhotos[0]) || "";
    if (bg && /\.(mp4|webm)(\?|$)/i.test(bg)) photo.innerHTML = '<video src="' + esc(bg) + '" autoplay muted loop playsinline></video>';
    else if (bg) photo.innerHTML = '<img src="' + esc(bg) + '" alt="">';
  })();

  renderChrome();
  renderDock();
})();
