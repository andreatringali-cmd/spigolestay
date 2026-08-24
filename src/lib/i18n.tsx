"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "it" | "en" | "es" | "fr" | "de";
export const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: "it", flag: "🇮🇹", label: "Italiano" },
  { code: "en", flag: "🇬🇧", label: "English" },
  { code: "es", flag: "🇪🇸", label: "Español" },
  { code: "fr", flag: "🇫🇷", label: "Français" },
  { code: "de", flag: "🇩🇪", label: "Deutsch" },
];

// Dizionario: chiave = testo italiano di partenza → traduzioni.
// Wrappando le stringhe con t(), l'italiano resta il fallback naturale.
const DICT: Record<string, Partial<Record<Lang, string>>> = {
  // Gruppi menu
  "Operatività": { en: "Operations", es: "Operativa", fr: "Opérations", de: "Betrieb" },
  "Vendita": { en: "Sales", es: "Ventas", fr: "Ventes", de: "Verkauf" },
  "Report": { en: "Reports", es: "Informes", fr: "Rapports", de: "Berichte" },
  "Amministrazione": { en: "Administration", es: "Administración", fr: "Administration", de: "Verwaltung" },
  "Anagrafiche": { en: "Records", es: "Registros", fr: "Fiches", de: "Stammdaten" },
  "Configurazione": { en: "Configuration", es: "Configuración", fr: "Configuration", de: "Konfiguration" },
  // Voci di menu
  "Dashboard": { es: "Panel", fr: "Tableau de bord" },
  "Prenotazioni": { en: "Bookings", es: "Reservas", fr: "Réservations", de: "Buchungen" },
  "Calendario": { en: "Calendar", fr: "Calendrier", de: "Kalender" },
  "Pulizie": { en: "Housekeeping", es: "Limpieza", fr: "Ménage", de: "Reinigung" },
  "Centro messaggi": { en: "Message center", es: "Centro de mensajes", fr: "Centre de messages", de: "Nachrichten" },
  "Conversazioni": { en: "Conversations", es: "Conversaciones", fr: "Conversations", de: "Unterhaltungen" },
  "Preventivi": { en: "Quotes", es: "Presupuestos", fr: "Devis", de: "Angebote" },
  "Widget sito": { en: "Site widget", es: "Widget web", fr: "Widget site", de: "Website-Widget" },
  "Sito web": { en: "Website", es: "Sitio web", fr: "Site web", de: "Website" },
  "Tariffe": { en: "Rates", es: "Tarifas", fr: "Tarifs", de: "Preise" },
  "Canali": { en: "Channels", es: "Canales", fr: "Canaux", de: "Kanäle" },
  "Meta Search": {},
  "Statistiche": { en: "Statistics", es: "Estadísticas", fr: "Statistiques", de: "Statistiken" },
  "Revenue": {},
  "Rate checker": { es: "Comparador de tarifas", fr: "Comparateur de tarifs", de: "Preisvergleich" },
  "Cassa · Prima Nota": { en: "Cash · Journal", es: "Caja · Libro diario", fr: "Caisse · Journal", de: "Kasse · Journal" },
  "Incassi": { en: "Payments", es: "Cobros", fr: "Encaissements", de: "Zahlungen" },
  "Ospiti": { en: "Guests", es: "Huéspedes", fr: "Clients", de: "Gäste" },
  "Alloggiati": { en: "Police report", es: "Registro policial", fr: "Fiches police", de: "Meldeschein" },
  "Tassa soggiorno": { en: "City tax", es: "Tasa turística", fr: "Taxe de séjour", de: "Kurtaxe" },
  "Strutture": { en: "Properties", es: "Alojamientos", fr: "Établissements", de: "Unterkünfte" },
  "Camere": { en: "Rooms", es: "Habitaciones", fr: "Chambres", de: "Zimmer" },
  "Modelli & automazioni": { en: "Templates & automations", es: "Plantillas y automatizaciones", fr: "Modèles et automatisations", de: "Vorlagen & Automatisierungen" },
  "Utenti": { en: "Users", es: "Usuarios", fr: "Utilisateurs", de: "Benutzer" },
  "Impostazioni": { en: "Settings", es: "Ajustes", fr: "Paramètres", de: "Einstellungen" },
  "Abbonamento": { en: "Subscription", es: "Suscripción", fr: "Abonnement", de: "Abonnement" },
  // Comuni / topbar
  "Tutte le strutture": { en: "All properties", es: "Todos los alojamientos", fr: "Tous les établissements", de: "Alle Unterkünfte" },
  "Chiedimi qualsiasi cosa…": { en: "Ask me anything…", es: "Pregúntame lo que sea…", fr: "Demandez-moi n'importe quoi…", de: "Frag mich etwas…" },
  "Nuova prenotazione": { en: "New booking", es: "Nueva reserva", fr: "Nouvelle réservation", de: "Neue Buchung" },
};

import { EXTRA_DICT } from "./i18n-dict";

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string }>({ lang: "it", setLang: () => {}, t: (s) => s });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("it");
  useEffect(() => { try { const c = localStorage.getItem("spigolestay:lang"); if (c && LANGS.some((l) => l.code === c)) setLangState(c as Lang); } catch {} }, []);
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem("spigolestay:lang", l); } catch {} };
  const t = (s: string) => (lang === "it" ? s : DICT[s]?.[lang] ?? EXTRA_DICT[s]?.[lang] ?? s);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);
