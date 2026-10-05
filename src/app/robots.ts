// robots.txt: i siti pubblici delle strutture (e le loro interfacce per gli assistenti AI) sono aperti a motori di ricerca e AI;
// l'area riservata, le pagine ospite con codice e le API interne no.
import type { MetadataRoute } from "next";

const ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://xenora.it").replace(/\/+$/, "");

export default function robots(): MetadataRoute.Robots {
  const privatePaths = ["/api/", "/admin", "/checkin", "/gestisci", "/invito", "/accetta-invito", "/preventivo", "/g/", "/login"];
  const open = ["/", "/api/ai/", "/api/metasearch/feed/"];
  // Crawler e agenti degli assistenti AI e dei motori di ricerca, nominati apertamente: la presenza nelle risposte AI porta prenotazioni dirette.
  const bots = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "PerplexityBot", "Perplexity-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "Google-Extended", "Applebot-Extended", "Bingbot", "Googlebot"];
  return {
    rules: [
      { userAgent: "*", allow: open, disallow: privatePaths },
      { userAgent: bots, allow: open, disallow: privatePaths },
    ],
    sitemap: `${ORIGIN}/sitemap.xml`,
    host: ORIGIN,
  };
}
