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
  var c = (guides[pid] || {}).content;
  if (!c || !c.sections || !c.sections.length) return; // nessun contenuto host → resta l'esempio del pacchetto
  var i18n = (guides[pid] || {}).i18n || {}; // traduzioni automatiche per lingua (base = italiano)

  // Raggruppamento coerente col default, filtrato alle sezioni presenti.
  var ids = c.sections.map(function (s) { return s.id; });
  var has = function (id) { return ids.indexOf(id) >= 0; };
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
    var merged = src.sections.map(function (hs) {
      var pkg = byPid[hs.id] || baseSecs[hs.id];
      if (FUNC[hs.id] && pkg) {
        return Object.assign({}, pkg, {
          title: hs.title || pkg.title, sub: hs.sub || pkg.sub, intro: hs.intro != null ? hs.intro : pkg.intro,
          photos: (hs.photos && hs.photos.length) ? hs.photos : pkg.photos
        });
      }
      // Passaggi dell'host → forma del motore, col codice mappato su codeKey (mai nel DB pubblico).
      var steps = (hs.steps || []).map(function (st) {
        var o = { h: st.h, p: st.p, actions: st.actions };
        if (st.code && CODEKEY[st.code]) { o.codeKey = CODEKEY[st.code]; o.codeAfter = "#"; }
        return o;
      });
      return {
        id: hs.id, icon: hs.icon, title: hs.title, sub: hs.sub, intro: hs.intro, photos: hs.photos, items: hs.items,
        steps: steps, amenities: hs.amenities || [], amenitiesTitle: hs.amenitiesTitle, amenitiesIntro: hs.amenitiesIntro
      };
    });
    window.I18N[l] = { ui: base.ui, home: src.home || base.home, groups: groups, sections: merged, sectionsByProperty: {} };
  });
})();
