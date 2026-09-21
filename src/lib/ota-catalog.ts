// Catalogo dei portali/OTA collegabili (elenco Channex/Octorate).
// L'utente può aggiungere qualsiasi canale da un menu a tendina nel Channel Manager.
// I "big" hanno dominio (per il logo) e commissione tipica; gli altri usano un colore
// derivato dal nome e il fallback a iniziale.

export interface OtaDef {
  key: string;        // slug stabile
  label: string;      // nome mostrato
  category?: string;  // "OTA" | "Strumento esterno"
  domain?: string;    // per il favicon/logo
  color?: string;     // colore brand (fallback: derivato dal nome)
  commission?: number;// commissione tipica %
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "canale";
}

// Colore stabile derivato dal nome (per i portali senza brand color noto).
export function otaColor(def: { color?: string; key?: string; label?: string }): string {
  if (def.color) return def.color;
  const s = def.key || def.label || "x";
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 42%)`;
}

// Portali principali con metadati completi (logo + commissione tipica).
const MAJORS: OtaDef[] = [
  { key: "booking", label: "Booking.com", color: "#003580", commission: 15, domain: "booking.com" },
  { key: "airbnb", label: "Airbnb", color: "#FF5A5F", commission: 15, domain: "airbnb.com" },
  { key: "expedia", label: "Expedia", color: "#FFC72C", commission: 18, domain: "expedia.com" },
  { key: "vrbo", label: "Vrbo (HomeAway)", color: "#1668E3", commission: 8, domain: "vrbo.com" },
  { key: "agoda", label: "Agoda", color: "#5A2D8C", commission: 17, domain: "agoda.com" },
  { key: "hotels-com", label: "Hotels.com", color: "#D32F2F", commission: 15, domain: "hotels.com" },
  { key: "trip-com", label: "Trip.com", color: "#2577E3", commission: 15, domain: "trip.com" },
  { key: "hostelworld", label: "Hostelworld", color: "#F5822A", commission: 12, domain: "hostelworld.com" },
  { key: "lastminute-com", label: "lastminute.com", color: "#E5007D", commission: 15, domain: "lastminute.com" },
  { key: "hrs", label: "HRS", color: "#005CA9", commission: 15, domain: "hrs.com" },
  { key: "google", label: "Google (Hotel Ads)", color: "#4285F4", commission: 0, domain: "google.com" },
  { key: "holidu", label: "Holidu", color: "#0A9D8E", commission: 15, domain: "holidu.com" },
  { key: "hometogo", label: "HomeToGo", color: "#00A0DF", commission: 15, domain: "hometogo.com" },
  { key: "traveloka", label: "Traveloka", color: "#1B9CFC", commission: 15, domain: "traveloka.com" },
  { key: "marriott-homes-villas", label: "Marriott Homes & Villas", color: "#8B0000", commission: 12, domain: "homes-and-villas.marriott.com" },
];

// Elenco Channex (nomi come compaiono nel pannello). Molti sono di nicchia:
// vengono resi con colore derivato e logo a iniziale.
const CHANNEX_NAMES: string[] = [
  "123booking", "Acamporatravel (Netstorming)", "Albatravel", "Alliance Resaux", "Yesalps",
  "Alpitour World", "AlwaysOnVacation", "Amadeus", "Arena Tourist (Netstorming)", "As_a_guest_koedia",
  "Atel", "Atrapalo", "Atraveo", "Avoris", "Bakuun", "BedandBreakfast.com", "Bedandbreakfast.eu",
  "Bedandbreakfast.nl", "Bedandbreakfastroma", "Bedycasa (only availability)", "Bestday",
  "Bestholidays (Netstorming)", "BluePillow", "Bookingay", "Bookingfor", "BookOn", "Bookonlinenow",
  "Bookvisit", "Campingitalia", "CasasRurales.net", "Charmingitaly_New", "chiavistello",
  "Chic Retreats", "Cisalpina", "Cityzenbooking", "ClickBeds", "DayBreakHotels", "Delphinet",
  "Despegar_xml", "Destination Florence", "Discoveroom", "Djoca - Koedia",
  "Dolomiti.it (Destination S.r.l.)", "Dorms", "EasyToBook", "ELLOHA", "Escapio",
  "Mon sejour en Montagne", "Fastpayhotels", "Feratel", "Traum-Ferienwohnungen.de", "fisheyes_json",
  "Fisheyes_xml", "Flexhotel - The booking engine", "FREEGOO", "Gardapass FederAlberghi",
  "Gites De France", "Globekey", "Gomio", "GreeenSoft", "Gta", "Hashnap (Netstorming)", "hihostels",
  "Hiporesa", "Holidaylettings (only availability)", "Holidaylettings - Flipkey - Housetrip",
  "Hopper", "Hostel Hop", "HostelsClub", "Hostels_com", "HostPal", "Hotelbonanza", "HotelDe",
  "EasyConsulting", "Hoteliers", "hotelOnline_fr", "Hotelclick", "Hotelscorse",
  "hotelsdirects - Koedia (HDA)", "hotelspecials.nl", "hoteltonight", "hoteltravel",
  "HotelsCombined / Revato", "Hotel-inn", "Web Hotel", "Hotel_nl", "Keytel - Hotusa", "Hyperguestxml",
  "icastelli", "iCloud", "Imperatore (Opentur)", "Imperatore Travel World (Netstorming)",
  "Imperatore iVector", "in-italia.dk", "Inhores", "Instant World Booking", "Interrias", "Italcamel",
  "Italyhotels", "IVH Travel", "Ixpira", "Jumbo", "Juniper", "Laterooms", "LoveVDA", "Makemytrip",
  "Metglobal", "Mirai", "MrandMrsSmith", "Myitalyselection", "Natural Booking", "NeoBooking",
  "Newhotelsoftware", "NiceHospitality", "Nice Hospitality (Netstorming)", "9flats (only Availability)",
  "Niumba", "OdigeoConnect", "Oh-Barcelona", "Oktogo", "OmegaHotels", "Oneuptravel",
  "onlyapartments_xml", "ONTIME (Netstorming)", "Othyssia", "Outlook", "Plumguide", "Prestigia",
  "Rakuten Travel Xchange", "Rate Match", "ratebotai", "Recoline", "Rhn", "Riad_fr", "Roiback",
  "Roomorama (only Availability)", "Sabre Holdings", "Sejouring", "Sharebooking", "Sidetours",
  "Simplebooking", "Sinky.co", "Sireontours", "BookingExpert", "SleepingRome", "Smartbox",
  "smartmember", "Softwell HMS", "spaghetti_apartments", "Special Tours", "Splendia", "Sunhotels",
  "Super-bed", "Tablet", "tablethotels_xml", "Tiket", "Titanka_MrPreno", "Tobook", "touricoholidays",
  "Transhotel", "Travco", "TravelEurope", "Travel Friends (Netstorming)", "TravelgateX", "travelledia",
  "Travelocity", "TravelRepublic", "travelontime", "Trip Rental", "TUI (Netstorming)", "Ultranet",
  "Unitravel", "Vertical_Booking", "VesuvioTour", "ViaggiareWeb (only Availability)", "Viajesparati",
  "Vivafirenze.it", "Webbooking", "Weekendesk", "Welcomebeds", "WeSuite", "WHL",
  "Wimdu (only availabilities)", "Wotif", "Xenia", "Xenia DS (Netstorming)", "Yourspainhostel", "ZUJI",
];

// Strumenti esterni (non OTA): serrature, PMS/interfacce, calendari.
const TOOLS: string[] = [
  "Brainy", "Customer Alliance", "D-Edge", "Google Drive Spreadsheet Synch", "GoogleCal",
  "Interface HN", "Logis", "Nuki", "omnitec", "Roommatik", "Salto", "Travelclick", "Travel Software",
];

function buildCatalog(): OtaDef[] {
  const seen = new Set<string>();
  const out: OtaDef[] = [];
  const add = (d: OtaDef) => { if (!seen.has(d.key)) { seen.add(d.key); out.push(d); } };
  MAJORS.forEach(add);
  CHANNEX_NAMES.forEach((n) => add({ key: slugify(n), label: n, category: "OTA", commission: 15 }));
  TOOLS.forEach((n) => add({ key: slugify(n), label: n, category: "Strumento esterno" }));
  return out.sort((a, b) => a.label.localeCompare(b.label, "it"));
}

export const OTA_CATALOG: OtaDef[] = buildCatalog();

export function findOta(key: string): OtaDef | undefined {
  return OTA_CATALOG.find((o) => o.key === key);
}
