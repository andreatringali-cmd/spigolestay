import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false, // nasconde l'indicatore "N" di sviluppo di Next.js
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
