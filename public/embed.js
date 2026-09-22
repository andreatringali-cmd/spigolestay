/*!
 * Xenora — widget di prenotazione incorporabile.
 *
 * Uso sul sito del gestore:
 *   <script src="https://xenora.it/embed.js" data-site="il-tuo-slug"></script>
 *
 * Attributi opzionali sul tag <script>:
 *   data-site        (obbligatorio) slug della struttura pubblicata su Xenora
 *   data-min-height  altezza minima in px prima che arrivi l'altezza reale (default 640)
 *   data-accent      colore accento in esadecimale, es. #B4531F (eredita dalla struttura se assente)
 *   data-target      id di un elemento in cui inserire il widget (default: subito dopo lo script)
 *
 * Lo script crea un <iframe> a larghezza 100% verso /embed/<slug> e ne adatta
 * l'altezza in automatico ascoltando i messaggi postMessage inviati dall'iframe.
 */
(function () {
  "use strict";

  // Tag <script> corrente (o l'ultimo caricato come fallback).
  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf("embed.js") !== -1) { script = all[i]; break; }
    }
  }
  if (!script) return;

  var site = script.getAttribute("data-site");
  if (!site) {
    // Niente slug: nulla da mostrare (avviso solo in console per il gestore).
    if (window.console) console.error("[Xenora embed] Attributo data-site mancante sul tag <script>.");
    return;
  }

  var minHeight = parseInt(script.getAttribute("data-min-height"), 10);
  if (!minHeight || minHeight < 200) minHeight = 640;
  var accent = script.getAttribute("data-accent") || "";

  // Origine di Xenora: derivata dal src dello script (così funziona anche su
  // domini/anteprime diversi da xenora.it).
  var origin = "https://xenora.it";
  try { origin = new URL(script.src).origin; } catch (e) {}

  // URL dell'iframe.
  var url = origin + "/embed/" + encodeURIComponent(site);
  var qs = [];
  if (accent) qs.push("accent=" + encodeURIComponent(accent));
  if (qs.length) url += "?" + qs.join("&");

  // Crea l'iframe.
  var iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.title = "Prenota";
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("allow", "payment");
  iframe.style.width = "100%";
  iframe.style.border = "0";
  iframe.style.display = "block";
  iframe.style.overflow = "hidden";
  iframe.style.minHeight = minHeight + "px";

  // Inserimento: in un contenitore indicato da data-target, altrimenti subito
  // dopo il tag <script>.
  var targetId = script.getAttribute("data-target");
  var target = targetId ? document.getElementById(targetId) : null;
  if (target) target.appendChild(iframe);
  else if (script.parentNode) script.parentNode.insertBefore(iframe, script.nextSibling);
  else document.body.appendChild(iframe);

  // Adatta l'altezza ai messaggi inviati dalla pagina embed.
  window.addEventListener("message", function (ev) {
    if (ev.origin !== origin) return;                 // accetta solo messaggi da Xenora
    var d = ev.data;
    if (!d || d.type !== "xenora-embed-height") return;
    var h = parseInt(d.height, 10);
    if (!h || h < 100) return;
    if (h < minHeight) h = minHeight;
    iframe.style.height = h + "px";
  });
})();
