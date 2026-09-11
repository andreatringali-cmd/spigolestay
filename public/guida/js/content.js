// ============================================================
//  OVERRIDE CONTENUTI PERSONALIZZATI (fase 2)
//  Se la guida della proprietà ha contenuti propri (scritti dall'host
//  nel pannello SpigoleStay), sostituiscono i contenuti d'esempio del
//  pacchetto. Le stringhe UI (ui:) restano quelle pre-tradotte.
//  Carica DOPO i file it/en/fr/de/es e PRIMA di app.js.
//  Traduzione automatica dei testi host: fase successiva → per ora i
//  contenuti host valgono per tutte le lingue (in lingua dell'host).
// ============================================================
(function () {
  var LANGS = ["it", "en", "fr", "de", "es"];
  var guides = {};
  try { guides = JSON.parse(localStorage.getItem("spigolestay:guides") || "{}"); } catch (e) { return; }
  var pid = new URLSearchParams(location.search).get("p") || "";
  if (!pid) { try { pid = (JSON.parse(localStorage.getItem("spigole_guest") || "null") || {}).p || ""; } catch (e) {} }
  var rec = guides[pid];
  // Se la struttura NON ha una guida salvata (es. il telefono "Esempio" con p=__esempio__),
  // resta l'esempio del pacchetto Siracusa. Se invece la guida esiste, mostriamo SOLO i contenuti
  // dell'host: le sezioni non compilate spariscono, così la guida si riempie man mano che l'host compila.
  if (!rec) return;
  var c = rec.content && rec.content.sections ? rec.content : { home: null, sections: [] };
  var i18n = rec.i18n || {}; // traduzioni automatiche per lingua (base = italiano)

  // Raggruppamento coerente col default, filtrato alle sezioni presenti.
  // Visibilità: l'host può nascondere una sezione (hidden), e le sezioni non compilate
  // spariscono da sole. Le operative (wifi/contatti/recensione) prendono i dati dalla
  // struttura, quindi non contano mai come "vuote".
  var nzTop = function (x) { return !!(x && String(x).trim()); };
  var WELCOME = { it: "Benvenuti", en: "Welcome", fr: "Bienvenue", de: "Willkommen", es: "Bienvenidos" };
  var homeFilled = function (h) { return h && !h.hidden && (nzTop(h.welcomeTitle) || nzTop(h.welcomeSub) || (h.welcome && h.welcome.join && nzTop(h.welcome.join("")))); };
  var FUNCSEC = { wifi: 1, contacts: 1, review: 1 };
  function secFilled(s) {
    if (s.hidden) return false;
    // Operative: visibili SOLO se hanno i loro dati (wifi = rete/password, contatti = telefono/WhatsApp,
    // recensione = link). Senza dati spariscono, come le altre sezioni non compilate.
    if (s.id === "wifi") { if (rec.wifiNetwork || rec.wifiPassword) return true; }
    else if (s.id === "contacts") { if (rec.phone || rec.whatsapp || rec.phoneGreta) return true; }
    else if (s.id === "review") { if (rec.reviewUrl) return true; }
    if (s.intro && String(s.intro).trim()) return true;
    if (s.photos && s.photos.length) return true;
    if (s.amenities && s.amenities.length) return true;
    if (s.steps && s.steps.some(function (st) { return (st.h && String(st.h).trim()) || (st.p && String(st.p).trim()); })) return true;
    if (s.items && s.items.some(function (it) { return (it.h && String(it.h).trim()) || (it.p && String(it.p).trim()) || (it.list && it.list.length); })) return true;
    return false;
  }
  var visibleIds = {};
  c.sections.forEach(function (s) { if (secFilled(s)) visibleIds[s.id] = 1; });
  var ids = c.sections.map(function (s) { return s.id; }).filter(function (id) { return visibleIds[id]; });
  var has = function (id) { return !!visibleIds[id]; };
  var GROUPS = [
    { title: "Il vostro arrivo", ids: ["checkin", "breakfast", "wifi"] },
    { title: "Esplorare " + ((window.PROPERTY && window.PROPERTY.city) || ""), ids: ["attractions", "restaurants", "excursions"] },
    { title: "Servizi utili", ids: ["taxi", "info", "faq", "extras", "contacts", "review"] }
  ];
  var groups = GROUPS.map(function (g) { return { title: g.title, sections: g.ids.filter(has) }; }).filter(function (g) { return g.sections.length; });
  // Sezioni non previste nei gruppi standard → gruppo finale.
  var known = groups.reduce(function (a, g) { return a.concat(g.sections); }, []);
  var rest = ids.filter(function (id) { return known.indexOf(id) < 0; });
  if (rest.length) groups.push({ title: "Altro", sections: rest });

  // Operative "pure": credenziali/contatti automatici → si tiene il pacchetto, si sovrascrivono solo i testi.
  var FUNC = { wifi: 1, contacts: 1, review: 1 };
  // Il codice scelto dall'host (gate/door/door2) diventa la chiave che il motore riempie dal link ospite.
  var CODEKEY = { gate: "gateCode", door: "doorCode", door2: "doorCode2" };
  LANGS.forEach(function (l) {
    var base = window.I18N[l] || window.I18N.it || { ui: {} };
    var baseSecs = {}; (base.sections || []).forEach(function (s) { baseSecs[s.id] = s; });
    var byPid = (base.sectionsByProperty || {})[pid] || {};
    var src = i18n[l] || c; // testi nella lingua l se tradotti, altrimenti l'italiano dell'host
    var merged = src.sections.filter(function (hs) { return visibleIds[hs.id]; }).map(function (hs) {
      var pkg = byPid[hs.id] || baseSecs[hs.id];
      if (FUNC[hs.id] && pkg) {
        return Object.assign({}, pkg, {
          title: hs.title || pkg.title, sub: hs.sub || pkg.sub, intro: hs.intro != null ? hs.intro : pkg.intro,
          photos: (hs.photos && hs.photos.length) ? hs.photos : pkg.photos
        });
      }
      var nz = function (x) { return !!(x && String(x).trim()); };
      // Passaggi dell'host → forma del motore, col codice mappato su codeKey (mai nel DB pubblico).
      // Salto i passaggi vuoti (le righe di esempio non compilate non devono comparire).
      var steps = (hs.steps || []).filter(function (st) { return nz(st.h) || nz(st.p); }).map(function (st) {
        var o = { h: st.h, p: st.p, actions: st.actions };
        if (st.code && CODEKEY[st.code]) {
          o.codeKey = CODEKEY[st.code];
          // Se l'host ha scritto una nota, compare dopo il codice (e sostituisce il "#" automatico).
          if (st.codeNote && String(st.codeNote).trim()) { o.codeAfter = ""; o.codeSuffix = st.codeNote; }
          else { o.codeAfter = "#"; }
        }
        return o;
      });
      // Blocchi dell'host: ripulisco gli elenchi dalle righe vuote e salto i blocchi del tutto vuoti.
      var items = (hs.items || []).map(function (it) {
        var list = (it.list || []).filter(function (r) { return nz(r.n) || nz(r.sub); });
        return Object.assign({}, it, { list: list });
      }).filter(function (it) { return nz(it.h) || nz(it.p) || (it.list && it.list.length) || (it.actions && it.actions.length); });
      var amenities = (hs.amenities || []).filter(function (a) { return nz(a.label); });
      var out = { id: hs.id, icon: hs.icon, title: hs.title, sub: hs.sub, intro: hs.intro, photos: hs.photos, items: items, steps: steps, amenities: amenities };
      // Titolo/intro dei servizi camera solo se ci sono davvero servizi (altrimenti niente blocco vuoto).
      if (amenities.length) { out.amenitiesTitle = hs.amenitiesTitle; out.amenitiesIntro = hs.amenitiesIntro; }
      return out;
    });
    // Home: se l'host non ha scritto il benvenuto, resta VUOTA (niente fallback "Benvenuti · nome").
    // Solo ciò che l'host compila qui compare: i dati della struttura vivono nelle loro sezioni.
    var homeOut = homeFilled(src.home) ? src.home : { welcomeTitle: "", welcomeSub: "", welcome: [] };
    window.I18N[l] = { ui: base.ui, home: homeOut, groups: groups, sections: merged, sectionsByProperty: {} };
  });
})();
