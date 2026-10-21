import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

// Tastiera virtuale: la pagina si ridimensiona invece di essere coperta (Chrome/Samsung); il colore della barra segue il brand.
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content", themeColor: "#2f6bb0" };

export const metadata: Metadata = {
  metadataBase: new URL("https://xenora.it"),
  title: "Xenora — Gestionale e Channel Manager per B&B",
  description: "Prenotazioni, canali, ospiti e incassi: tutta la tua struttura in un'unica piattaforma.",
  icons: { icon: "/icon.png", shortcut: "/icon.png", apple: "/apple-icon.png" },
  openGraph: {
    title: "Xenora",
    description: "Prenotazioni, canali, ospiti e incassi in un'unica piattaforma.",
    images: [{ url: "/og?t=Xenora&s=Gestionale%20per%20B%26B&c=%232f6bb0&n=Xenora", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/og?t=Xenora&s=Gestionale%20per%20B%26B&c=%232f6bb0&n=Xenora"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="it"
      suppressHydrationWarning /* la classe `dark` viene aggiunta dallo script anti-flash prima dell'idratazione */
      className={`${inter.variable} ${archivo.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
