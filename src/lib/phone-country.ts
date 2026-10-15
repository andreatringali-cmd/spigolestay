// Paese e lingua dell'ospite dal PREFISSO INTERNAZIONALE del telefono (+39, 0044, +1 809…).
// Puro, senza import: usato sia dal server (messaggi automatici) sia dal browser (pagine ospite).
//  - countryFromPhone: codice Paese ISO-2 ("IT", "GB"…) o null se non c'è un numero / il prefisso non è riconosciuto.
//  - langFromPhone: lingua dei messaggi (it · en · fr · de · es). Nessun numero → null; numero senza prefisso → italiano
//    (la struttura è in Italia: un numero scritto "333 1234567" è un numero italiano); prefisso sconosciuto → inglese.
// Il prefisso è di lunghezza variabile (+1, +7, +34, +351, +1809…): vince sempre il più lungo che combacia.

export type GuestLang = "it" | "en" | "fr" | "de" | "es";

// Prefisso (senza "+") → codice Paese. I prefissi NANP (+1) hanno il Paese nelle prime 3 cifre dopo l'1.
const DIAL: Record<string, string> = {};
function add(iso: string, codes: string) { for (const c of codes.split(" ")) DIAL[c] = iso; }

add("US", "1"); add("RU", "7"); add("KZ", "76 77");
add("EG", "20"); add("ZA", "27"); add("GR", "30"); add("NL", "31"); add("BE", "32"); add("FR", "33"); add("ES", "34"); add("HU", "36");
add("IT", "39"); add("RO", "40"); add("CH", "41"); add("AT", "43"); add("GB", "44"); add("DK", "45"); add("SE", "46"); add("NO", "47");
add("PL", "48"); add("DE", "49");
add("PE", "51"); add("MX", "52"); add("CU", "53"); add("AR", "54"); add("BR", "55"); add("CL", "56"); add("CO", "57"); add("VE", "58");
add("MY", "60"); add("AU", "61"); add("ID", "62"); add("PH", "63"); add("NZ", "64"); add("SG", "65"); add("TH", "66");
add("JP", "81"); add("KR", "82"); add("VN", "84"); add("CN", "86"); add("TR", "90"); add("IN", "91"); add("PK", "92"); add("AF", "93");
add("LK", "94"); add("MM", "95"); add("IR", "98");
// Nord America (+1 xxx)
add("BS", "1242"); add("BB", "1246"); add("AI", "1264"); add("AG", "1268"); add("VG", "1284"); add("VI", "1340"); add("KY", "1345");
add("BM", "1441"); add("GD", "1473"); add("TC", "1649"); add("MS", "1664"); add("GU", "1671"); add("AS", "1684"); add("SX", "1721");
add("LC", "1758"); add("DM", "1767"); add("VC", "1784"); add("PR", "1787 1939"); add("DO", "1809 1829 1849"); add("TT", "1868");
add("KN", "1869"); add("JM", "1876");
add("CA", "1204 1226 1236 1249 1250 1289 1306 1343 1365 1367 1403 1416 1418 1431 1437 1438 1450 1506 1514 1519 1548 1579 1581 1587 1604 1613 1639 1647 1672 1705 1709 1742 1778 1780 1807 1819 1825 1867 1873 1902 1905");
// Africa
add("SS", "211"); add("MA", "212"); add("DZ", "213"); add("TN", "216"); add("LY", "218"); add("GM", "220"); add("SN", "221"); add("MR", "222");
add("ML", "223"); add("GN", "224"); add("CI", "225"); add("BF", "226"); add("NE", "227"); add("TG", "228"); add("BJ", "229"); add("MU", "230");
add("LR", "231"); add("SL", "232"); add("GH", "233"); add("NG", "234"); add("TD", "235"); add("CF", "236"); add("CM", "237"); add("CV", "238");
add("ST", "239"); add("GQ", "240"); add("GA", "241"); add("CG", "242"); add("CD", "243"); add("AO", "244"); add("GW", "245"); add("SC", "248");
add("SD", "249"); add("RW", "250"); add("ET", "251"); add("SO", "252"); add("DJ", "253"); add("KE", "254"); add("TZ", "255"); add("UG", "256");
add("BI", "257"); add("MZ", "258"); add("ZM", "260"); add("MG", "261"); add("RE", "262"); add("ZW", "263"); add("NA", "264"); add("MW", "265");
add("LS", "266"); add("BW", "267"); add("SZ", "268"); add("KM", "269"); add("SH", "290"); add("ER", "291"); add("AW", "297"); add("FO", "298"); add("GL", "299");
// Europa
add("GI", "350"); add("PT", "351"); add("LU", "352"); add("IE", "353"); add("IS", "354"); add("AL", "355"); add("MT", "356"); add("CY", "357");
add("FI", "358"); add("BG", "359"); add("LT", "370"); add("LV", "371"); add("EE", "372"); add("MD", "373"); add("AM", "374"); add("BY", "375");
add("AD", "376"); add("MC", "377"); add("SM", "378"); add("VA", "379"); add("UA", "380"); add("RS", "381"); add("ME", "382"); add("XK", "383");
add("HR", "385"); add("SI", "386"); add("BA", "387"); add("MK", "389"); add("CZ", "420"); add("SK", "421"); add("LI", "423");
// America centro-sud e Caraibi
add("FK", "500"); add("BZ", "501"); add("GT", "502"); add("SV", "503"); add("HN", "504"); add("NI", "505"); add("CR", "506"); add("PA", "507");
add("PM", "508"); add("HT", "509"); add("GP", "590"); add("BO", "591"); add("GY", "592"); add("EC", "593"); add("GF", "594"); add("PY", "595");
add("MQ", "596"); add("SR", "597"); add("UY", "598"); add("CW", "599");
// Asia e Oceania
add("TL", "670"); add("BN", "673"); add("NR", "674"); add("PG", "675"); add("TO", "676"); add("SB", "677"); add("VU", "678"); add("FJ", "679");
add("PW", "680"); add("WF", "681"); add("CK", "682"); add("NU", "683"); add("WS", "685"); add("KI", "686"); add("NC", "687"); add("TV", "688");
add("PF", "689"); add("TK", "690"); add("FM", "691"); add("MH", "692"); add("KP", "850"); add("HK", "852"); add("MO", "853"); add("KH", "855");
add("LA", "856"); add("BD", "880"); add("TW", "886");
add("MV", "960"); add("LB", "961"); add("JO", "962"); add("SY", "963"); add("IQ", "964"); add("KW", "965"); add("SA", "966"); add("YE", "967");
add("OM", "968"); add("PS", "970"); add("AE", "971"); add("IL", "972"); add("BH", "973"); add("QA", "974"); add("BT", "975"); add("MN", "976");
add("NP", "977"); add("TJ", "992"); add("TM", "993"); add("AZ", "994"); add("GE", "995"); add("KG", "996"); add("UZ", "998");

const MAX_DIAL = Math.max(...Object.keys(DIAL).map((k) => k.length));

// Paese → lingua dei messaggi. Quel che non è qui sotto → inglese.
const COUNTRY_LANG: Record<string, GuestLang> = {};
function lang(l: GuestLang, countries: string) { for (const c of countries.split(" ")) COUNTRY_LANG[c] = l; }
lang("it", "IT SM VA");
lang("de", "DE AT LI CH");
lang("fr", "FR MC LU GP MQ GF RE PM PF NC WF HT SN CI ML BF NE TG BJ GA CG CD GN CF TD DJ MA DZ TN");
lang("es", "ES MX AR CO CL PE VE UY EC BO PY CR PA GT DO CU SV HN NI PR GQ");

/** Lingua dei messaggi per un Paese (codice ISO-2, qualunque maiuscole): non in elenco → inglese. */
export function langFromCountry(country?: string | null): GuestLang {
  const c = String(country ?? "").trim().toUpperCase();
  return COUNTRY_LANG[c] ?? "en";
}

export interface NormalizedPhone {
  /** Cifre senza "+", senza "00" iniziale e senza zero di trunk tra parentesi "(0)". */
  digits: string;
  /** Vero se il numero porta un prefisso internazionale esplicito ("+…" o "00…"). */
  international: boolean;
}

/** Ripulisce un numero scritto in qualunque modo: "+39 333-767.5693", "0039 333…", "whatsapp:+44 (0) 7700 900000"… */
export function normalizePhone(raw?: string | null): NormalizedPhone {
  let s = String(raw ?? "").trim();
  if (!s) return { digits: "", international: false };
  s = s.replace(/\(\s*0\s*\)/g, ""); // "+44 (0) 7700…": lo 0 tra parentesi non fa parte del numero internazionale
  const firstDigit = s.search(/\d/);
  if (firstDigit < 0) return { digits: "", international: false };
  const plus = s.slice(0, firstDigit).includes("+");
  let digits = s.replace(/\D/g, "");
  if (plus) return { digits, international: true };
  if (digits.startsWith("00") && digits.length > 2) return { digits: digits.slice(2), international: true };
  return { digits, international: false };
}

/** Prefisso più lungo che combacia con l'inizio delle cifre, o null. */
function matchDial(digits: string): string | null {
  for (let len = Math.min(MAX_DIAL, digits.length); len >= 1; len--) {
    const iso = DIAL[digits.slice(0, len)];
    if (iso) return iso;
  }
  return null;
}

/**
 * Paese ISO-2 del numero.
 *  - con prefisso internazionale ("+", "00"): dal prefisso (più lungo vince); sconosciuto → null
 *  - senza prefisso: numeri brevi o con lo 0 iniziale sono italiani (`defaultCountry`, "IT");
 *    numeri lunghi (≥ 11 cifre, mai italiani) scritti senza "+" ("393331234567", "447700900123") → si prova il prefisso
 *  - vuoto o senza cifre → null
 */
export function countryFromPhone(raw?: string | null, defaultCountry = "IT"): string | null {
  const { digits, international } = normalizePhone(raw);
  if (!digits) return null;
  if (international) return matchDial(digits);
  if (digits.startsWith("0") || digits.length <= 10) return defaultCountry;
  return matchDial(digits) ?? defaultCountry;
}

/** Lingua dei messaggi dal telefono: null se manca il numero; prefisso sconosciuto → inglese. */
export function langFromPhone(raw?: string | null, defaultCountry = "IT"): GuestLang | null {
  const { digits, international } = normalizePhone(raw);
  if (!digits) return null;
  const c = countryFromPhone(raw, defaultCountry);
  if (c) return langFromCountry(c);
  return international ? "en" : langFromCountry(defaultCountry);
}
