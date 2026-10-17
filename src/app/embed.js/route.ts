// Script di embed per il widget di prenotazione (xenora.it/embed.js).
//
// Uso sul sito del gestore:
//   <script src="https://xenora.it/embed.js" data-site="<slug>" data-min-height="640" data-accent="#RRGGBB" data-target="<id elemento, facoltativo>"></script>
// (Questa route è la versione servita in produzione; il vecchio public/embed.js statico non veniva mai usato e non esiste più.)
//
// Cosa fa: crea al posto dello script un <iframe> verso /embed/<slug>, lo ridimensiona
// da solo (ascolta i postMessage di altezza inviati dalla pagina embed) e inoltra alla
// pagina i parametri di deep link (?checkin&checkout&rt) se presenti nell'URL del sito
// ospite — è così che un click da Metasearch, atterrato sul sito ufficiale del gestore,
// arriva al motore con le date/camera già preselezionate.
import { NextResponse } from "next/server";

export const runtime = "edge";

const JS = `(function () {
  var cur = document.currentScript;
  if (!cur) return;
  var site = cur.getAttribute("data-site");
  if (!site) return;
  var minH = parseInt(cur.getAttribute("data-min-height") || "640", 10) || 640;
  var accent = cur.getAttribute("data-accent");
  var origin = (function () { var s = cur.src || ""; var m = s.match(/^(https?:\\/\\/[^/]+)/); return m ? m[1] : "https://xenora.it"; })();

  var params = new URLSearchParams();
  try {
    var pageParams = new URLSearchParams(window.location.search);
    ["checkin", "checkout", "rt", "ci", "co"].forEach(function (k) {
      var v = pageParams.get(k);
      if (v) params.set(k, v);
    });
  } catch (e) {}
  if (accent) params.set("accent", accent);

  var qs = params.toString();
  var src = origin + "/embed/" + encodeURIComponent(site) + (qs ? "?" + qs : "");

  var iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.style.width = "100%";
  iframe.style.border = "0";
  iframe.style.display = "block";
  iframe.style.minHeight = minH + "px";
  iframe.setAttribute("title", "Prenota");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("allow", "payment");

  // data-target (facoltativo): id di un elemento in cui inserire il widget; altrimenti subito prima dello script.
  var targetId = cur.getAttribute("data-target");
  var target = targetId ? document.getElementById(targetId) : null;
  if (target) target.appendChild(iframe);
  else if (cur.parentNode) cur.parentNode.insertBefore(iframe, cur);
  else document.body.appendChild(iframe);

  window.addEventListener("message", function (ev) {
    if (ev.source !== iframe.contentWindow) return; // solo i messaggi del nostro iframe
    if (!ev.data || ev.data.xenoraEmbedSite !== site || typeof ev.data.xenoraEmbedHeight !== "number") return;
    iframe.style.height = Math.max(minH, ev.data.xenoraEmbedHeight) + "px";
  });
})();`;

export function GET() {
  return new NextResponse(JS, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
