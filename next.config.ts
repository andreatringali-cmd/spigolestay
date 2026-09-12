import type { NextConfig } from "next";

// Header di sicurezza applicati a tutte le pagine (protezione dati/utente):
// - HSTS: forza HTTPS (niente downgrade)
// - X-Frame-Options SAMEORIGIN: niente incorporamento del gestionale in siti terzi (anti-clickjacking);
//   consente l'anteprima della guida (iframe same-origin) dentro l'app.
// - X-Content-Type-Options nosniff: niente sniffing del MIME
// - Referrer-Policy: non trapelare URL completi ai siti esterni
// - Permissions-Policy: disattiva microfono e geolocalizzazione (la fotocamera resta per il check-in)
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(), geolocation=(), browsing-topics=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  devIndicators: false, // nasconde l'indicatore "N" di sviluppo di Next.js
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Le vecchie aree Concierge/Conversazioni sono confluite in un'unica pagina Messaggi (a tab):
  // reindirizzo i vecchi link così non danno 404.
  async redirects() {
    return [
      { source: "/concierge", destination: "/messaggi", permanent: true },
      { source: "/conversazioni", destination: "/messaggi", permanent: true },
      { source: "/modelli", destination: "/messaggi?tab=modelli", permanent: true },
    ];
  },
};

export default nextConfig;
