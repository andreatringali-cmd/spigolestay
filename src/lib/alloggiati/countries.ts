// Stati: nomi italiani (come nella tabella Luoghi di Alloggiati Web), inglesi, codici ISO e demonimi.
// Serve a tradurre quello che l'ospite scrive nel modulo ("Germany", "USA", "American", "Deutschland", "DE"…)
// nel NOME ITALIANO dello Stato, da cercare poi nella tabella dei codici. File PURO e senza dipendenze:
// lo importa sia il server (codes.ts) sia la pagina di check-in (elenco per l'autocompletamento).

/** Normalizza per il confronto: maiuscolo, senza accenti, solo A-Z0-9 e spazi singoli. (Copia di norm() in codes.ts: qui non si importa nulla.) */
export function normText(s: string | undefined | null): string {
  return (s ?? "")
    .toString()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// [nome italiano (visualizzato), nome inglese, ISO2, ISO3, altri nomi italiani possibili nella tabella, sinonimi/demonimi separati da "|"]
type Row = [string, string, string, string, string[], string];
const ROWS: Row[] = [
  ["Italia", "Italy", "IT", "ITA", [], "Italian|Italiana|Italiano|Italiani|Italiane|Repubblica Italiana|Italie|Italien|Italienisch|Italiano/a"],
  ["Germania", "Germany", "DE", "DEU", [], "GER|German|Deutschland|Deutsch|Deutsche|Tedesca|Tedesco|Allemagne|Allemand|Alemania|Aleman|Bundesrepublik Deutschland|Federal Republic of Germany"],
  ["Francia", "France", "FR", "FRA", [], "French|Francese|Francais|Francaise|Frankreich|Franzosisch|Französisch|Francia"],
  ["Spagna", "Spain", "ES", "ESP", [], "Spanish|Spagnola|Spagnolo|Espana|Espanol|Espanola|Espagne|Spanien|Spanisch|Reino de Espana"],
  ["Regno Unito", "United Kingdom", "GB", "GBR", ["Gran Bretagna"], "UK|U K|Great Britain|Britain|British|British Citizen|England|English|Scotland|Scottish|Wales|Welsh|Northern Ireland|Inglese|Britannica|Britannico|Gran Bretagna|Inghilterra|Scozia|Galles|Irlanda del Nord|Royaume Uni|Vereinigtes Konigreich|Reino Unido|United Kingdom of Great Britain and Northern Ireland|Grossbritannien"],
  ["Stati Uniti d'America", "United States", "US", "USA", ["Stati Uniti"], "United States of America|America|American|Americans|U S A|U S|Statunitense|Americana|Americano|Stati Uniti|Etats Unis|Estados Unidos|Vereinigte Staaten|USA Citizen"],
  ["Svizzera", "Switzerland", "CH", "CHE", [], "Swiss|Svizzero|Suisse|Schweiz|Suiza|Confederazione Elvetica|Svizzera"],
  ["Austria", "Austria", "AT", "AUT", [], "Austrian|Austriaca|Austriaco|Osterreich|Oesterreich|Autriche|Österreich"],
  ["Paesi Bassi", "Netherlands", "NL", "NLD", ["Olanda"], "The Netherlands|Holland|Dutch|Olanda|Olandese|Nederland|Nederlands|Nederlandse|Pays Bas|Holanda|Paesi Bassi"],
  ["Belgio", "Belgium", "BE", "BEL", [], "Belgian|Belga|Belgique|Belgie|Belgica|Belgien"],
  ["Portogallo", "Portugal", "PT", "PRT", [], "Portuguese|Portoghese|Portugues"],
  ["Polonia", "Poland", "PL", "POL", [], "Polish|Polacca|Polacco|Polska|Pologne|Polen"],
  ["Romania", "Romania", "RO", "ROU", [], "Romanian|Rumena|Rumeno|Romena|Romeno|Roumanie|Rumanien"],
  ["Grecia", "Greece", "GR", "GRC", [], "Greek|Greca|Greco|Hellas|Ellada|Grece"],
  ["Svezia", "Sweden", "SE", "SWE", [], "Swedish|Svedese|Sverige|Suede"],
  ["Norvegia", "Norway", "NO", "NOR", [], "Norwegian|Norvegese|Norge|Norvege"],
  ["Danimarca", "Denmark", "DK", "DNK", [], "Danish|Danese|Danmark"],
  ["Finlandia", "Finland", "FI", "FIN", [], "Finnish|Finlandese|Suomi"],
  ["Irlanda", "Ireland", "IE", "IRL", [], "Irish|Irlandese|Eire"],
  ["Repubblica Ceca", "Czech Republic", "CZ", "CZE", ["Ceca, Repubblica", "Cechia", "Ceca"], "Czechia|Czech|Ceca|Ceska Republika|Tchequie"],
  ["Slovacchia", "Slovakia", "SK", "SVK", ["Slovacca, Repubblica", "Repubblica Slovacca"], "Slovak|Slovacca|Slovenska Republika"],
  ["Ungheria", "Hungary", "HU", "HUN", [], "Hungarian|Ungherese|Magyarorszag"],
  ["Bulgaria", "Bulgaria", "BG", "BGR", [], "Bulgarian|Bulgara"],
  ["Croazia", "Croatia", "HR", "HRV", [], "Croatian|Croata|Hrvatska"],
  ["Slovenia", "Slovenia", "SI", "SVN", [], "Slovenian|Slovena|Sloveno|Slovene"],
  ["Serbia", "Serbia", "RS", "SRB", [], "Serbian|Serba|Serbo"],
  ["Ucraina", "Ukraine", "UA", "UKR", [], "Ukrainian|Ucraino|Ucraina"],
  ["Russia", "Russia", "RU", "RUS", ["Federazione Russa"], "Russian|Russa|Russo|Russian Federation|Rossiya|Russie"],
  ["Turchia", "Turkey", "TR", "TUR", [], "Turkish|Turca|Turco|Turkiye|Türkiye|Turquie"],
  ["Israele", "Israel", "IL", "ISR", [], "Israeli|Israeliana|Israeliano"],
  ["Canada", "Canada", "CA", "CAN", [], "Canadian|Canadese"],
  ["Australia", "Australia", "AU", "AUS", [], "Australian|Australiana|Australiano"],
  ["Nuova Zelanda", "New Zealand", "NZ", "NZL", [], "Zelandese|New Zealander|Neozelandese"],
  ["Giappone", "Japan", "JP", "JPN", [], "Japanese|Giapponese"],
  ["Cina", "China", "CN", "CHN", ["Cina, Repubblica Popolare", "Repubblica Popolare Cinese"], "Chinese|Cinese|Peoples Republic of China|PRC"],
  ["Corea del Sud", "South Korea", "KR", "KOR", ["Corea, Repubblica di", "Corea", "Repubblica di Corea"], "Korea|Korean|Republic of Korea|Coreana|Coreano|Corea del Sud"],
  ["India", "India", "IN", "IND", [], "Indian|Indiana|Indiano"],
  ["Brasile", "Brazil", "BR", "BRA", [], "Brazilian|Brasiliana|Brasiliano|Brasil"],
  ["Argentina", "Argentina", "AR", "ARG", [], "Argentine|Argentinian|Argentino"],
  ["Messico", "Mexico", "MX", "MEX", [], "Mexican|Messicana|Messicano"],
  ["Cile", "Chile", "CL", "CHL", [], "Chilean|Cilena|Cileno"],
  ["Colombia", "Colombia", "CO", "COL", [], "Colombian|Colombiana|Colombiano"],
  ["Perù", "Peru", "PE", "PER", ["Peru"], "Peruvian|Peruviana|Peruviano"],
  ["Venezuela", "Venezuela", "VE", "VEN", [], "Venezuelan|Venezuelana"],
  ["Ecuador", "Ecuador", "EC", "ECU", [], "Ecuadorian|Ecuadoriana"],
  ["Uruguay", "Uruguay", "UY", "URY", [], "Uruguayan"],
  ["Cuba", "Cuba", "CU", "CUB", [], "Cuban|Cubana|Cubano"],
  ["Egitto", "Egypt", "EG", "EGY", [], "Egyptian|Egiziana|Egiziano"],
  ["Marocco", "Morocco", "MA", "MAR", [], "Moroccan|Marocchina|Marocchino|Maroc"],
  ["Tunisia", "Tunisia", "TN", "TUN", [], "Tunisian|Tunisina|Tunisino"],
  ["Algeria", "Algeria", "DZ", "DZA", [], "Algerian|Algerina|Algerino"],
  ["Sudafrica", "South Africa", "ZA", "ZAF", ["Sud Africa"], "South African|Sudafricana|Sud Africa"],
  ["Nigeria", "Nigeria", "NG", "NGA", [], "Nigerian|Nigeriana"],
  ["Senegal", "Senegal", "SN", "SEN", [], "Senegalese"],
  ["Ghana", "Ghana", "GH", "GHA", [], "Ghanaian|Ghanese"],
  ["Lussemburgo", "Luxembourg", "LU", "LUX", [], "Luxembourgish|Luxemburg|Lussemburghese"],
  ["Islanda", "Iceland", "IS", "ISL", [], "Icelandic|Islandese"],
  ["Malta", "Malta", "MT", "MLT", [], "Maltese|Maltese"],
  ["Cipro", "Cyprus", "CY", "CYP", [], "Cypriot|Cipriota"],
  ["Lituania", "Lithuania", "LT", "LTU", [], "Lithuanian|Lituana"],
  ["Lettonia", "Latvia", "LV", "LVA", [], "Latvian|Lettone"],
  ["Estonia", "Estonia", "EE", "EST", [], "Estonian|Estone"],
  ["Albania", "Albania", "AL", "ALB", [], "Albanian|Albanese|Shqiperia"],
  ["Bosnia ed Erzegovina", "Bosnia and Herzegovina", "BA", "BIH", ["Bosnia-Erzegovina", "Bosnia Erzegovina"], "Bosnia|Bosnian|Bosniaca"],
  ["Macedonia del Nord", "North Macedonia", "MK", "MKD", ["Macedonia"], "Macedonia|Macedone"],
  ["Montenegro", "Montenegro", "ME", "MNE", [], "Montenegrin|Montenegrina"],
  ["Kosovo", "Kosovo", "XK", "XKX", [], "Kosovar"],
  ["Moldavia", "Moldova", "MD", "MDA", ["Moldova"], "Moldavian|Moldova|Moldava"],
  ["Bielorussia", "Belarus", "BY", "BLR", ["Belarus"], "Belarusian|Bielorussa|Belarus"],
  ["Georgia", "Georgia", "GE", "GEO", [], "Georgian|Georgiana"],
  ["Armenia", "Armenia", "AM", "ARM", [], "Armenian|Armena"],
  ["Azerbaigian", "Azerbaijan", "AZ", "AZE", ["Azerbaijan"], "Azerbaijani|Azera"],
  ["Kazakistan", "Kazakhstan", "KZ", "KAZ", [], "Kazakh"],
  ["Thailandia", "Thailand", "TH", "THA", ["Tailandia"], "Thai|Thailandese|Tailandese"],
  ["Singapore", "Singapore", "SG", "SGP", [], "Singaporean"],
  ["Filippine", "Philippines", "PH", "PHL", [], "Philippine|Filipino|Filippina|Filippino"],
  ["Vietnam", "Vietnam", "VN", "VNM", [], "Vietnamese|Viet Nam|Vietnamita"],
  ["Indonesia", "Indonesia", "ID", "IDN", [], "Indonesian|Indonesiana"],
  ["Malesia", "Malaysia", "MY", "MYS", ["Malaysia"], "Malaysian|Malese"],
  ["Emirati Arabi Uniti", "United Arab Emirates", "AE", "ARE", [], "UAE|Emirati"],
  ["Arabia Saudita", "Saudi Arabia", "SA", "SAU", [], "Saudi|Saudita"],
  ["Libano", "Lebanon", "LB", "LBN", [], "Lebanese|Libanese"],
  ["Iran", "Iran", "IR", "IRN", ["Iran, Repubblica Islamica del"], "Iranian|Iraniana|Iraniano"],
  ["Iraq", "Iraq", "IQ", "IRQ", [], "Iraqi|Irachena"],
  ["Pakistan", "Pakistan", "PK", "PAK", [], "Pakistani|Pakistana"],
  ["Bangladesh", "Bangladesh", "BD", "BGD", [], "Bangladeshi"],
  ["Sri Lanka", "Sri Lanka", "LK", "LKA", ["Sri Lanka Ceylon", "Ceylon"], "Sri Lankan|Cingalese"],
  ["Nepal", "Nepal", "NP", "NPL", [], "Nepalese|Nepalese"],
  ["San Marino", "San Marino", "SM", "SMR", [], "Sammarinese"],
  ["Città del Vaticano", "Vatican City", "VA", "VAT", ["Vaticano", "Santa Sede", "Citta del Vaticano", "Stato della Citta del Vaticano"], "Holy See|Vatican|Vaticana"],
  ["Principato di Monaco", "Monaco", "MC", "MCO", ["Monaco", "Monaco, Principato di"], "Monegasque|Monegasca"],
  ["Liechtenstein", "Liechtenstein", "LI", "LIE", [], ""],
  ["Andorra", "Andorra", "AD", "AND", [], "Andorran"],
  ["Costa Rica", "Costa Rica", "CR", "CRI", [], "Costaricana"],
  ["Panama", "Panama", "PA", "PAN", [], "Panamense"],
  ["Repubblica Dominicana", "Dominican Republic", "DO", "DOM", ["Dominicana, Repubblica"], "Dominican|Dominicana"],
  // Altri Stati presenti nella tabella Luoghi di Alloggiati Web (nomi italiani come nella tabella reale).
  ["Giordania","Jordan","JO","JOR",[],"Jordanian|Giordana|Giordano"],
  ["Siria","Syria","SY","SYR",[],"Syrian|Siriana|Siriano|Syrie|Syrien"],
  ["Cambogia","Cambodia","KH","KHM",[],"Cambodian|Cambogiana|Cambogiano|Khmer"],
  ["Corea del Nord","North Korea","KP","PRK",["Corea, Repubblica Popolare Democratica"],"Korea North|Korea Democratic People's Republic|North Korean|DPRK|Democratic People's Republic of Korea|Nordcoreana|Nordcoreano"],
  ["Afghanistan","Afghanistan","AF","AFG",[],"Afghan|Afghana|Afgano"],
  ["Angola","Angola","AO","AGO",[],"Angolan|Angolana"],
  ["Bahamas","Bahamas","BS","BHS",[],"Bahamian|The Bahamas"],
  ["Bahrein","Bahrain","BH","BHR",[],"Bahraini|Bahreinita"],
  ["Barbados","Barbados","BB","BRB",[],"Barbadian"],
  ["Belize","Belize","BZ","BLZ",[],""],
  ["Benin","Benin","BJ","BEN",[],"Beninese"],
  ["Bhutan","Bhutan","BT","BTN",[],"Bhutanese|Butan"],
  ["Bolivia","Bolivia","BO","BOL",[],"Bolivian|Boliviana|Boliviano"],
  ["Botswana","Botswana","BW","BWA",[],"Botswanan"],
  ["Brunei Darussalam","Brunei","BN","BRN",[],"Bruneian"],
  ["Burkina Faso","Burkina Faso","BF","BFA",[],"Burkinabe"],
  ["Burundi","Burundi","BI","BDI",[],"Burundian"],
  ["Camerun","Cameroon","CM","CMR",[],"Cameroonian|Camerunese|Cameroun"],
  ["Capo Verde","Cape Verde","CV","CPV",[],"Cabo Verde|Capoverdiana|Capoverdiano"],
  ["Ciad","Chad","TD","TCD",[],"Chadian|Tchad"],
  ["Comore","Comoros","KM","COM",[],"Comorian"],
  ["Congo","Republic of the Congo","CG","COG",[],"Congo Brazzaville|Congolese|Congolese Republic"],
  ["Repubblica Democratica del Congo","Democratic Republic of the Congo","CD","COD",["Congo, Repubblica Democratica del","Congo Kinshasa"],"DR Congo|DRC|Congo Kinshasa|Zaire"],
  ["Costa d'Avorio","Ivory Coast","CI","CIV",[],"Cote d'Ivoire|Cote dIvoire|Ivorian|Ivoriana|Ivoriano"],
  ["Dominica","Dominica","DM","DMA",[],""],
  ["El Salvador","El Salvador","SV","SLV",[],"Salvadoran|Salvadorena|Salvadoregna"],
  ["Eritrea","Eritrea","ER","ERI",[],"Eritrean"],
  ["Etiopia","Ethiopia","ET","ETH",[],"Ethiopian|Etiope"],
  ["Figi","Fiji","FJ","FJI",[],"Fijian|Fiji Islands"],
  ["Gabon","Gabon","GA","GAB",[],"Gabonese|Gabonese Republic"],
  ["Gambia","Gambia","GM","GMB",[],"The Gambia|Gambian"],
  ["Giamaica","Jamaica","JM","JAM",[],"Jamaican|Giamaicana"],
  ["Gibuti","Djibouti","DJ","DJI",[],"Djiboutian"],
  ["Grenada","Grenada","GD","GRD",[],"Grenadian"],
  ["Guatemala","Guatemala","GT","GTM",[],"Guatemalan|Guatemalteca"],
  ["Guinea","Guinea","GN","GIN",[],"Guinean"],
  ["Guinea Bissau","Guinea-Bissau","GW","GNB",[],"Guinea Bissau"],
  ["Guyana","Guyana","GY","GUY",[],"Guyanese"],
  ["Haiti","Haiti","HT","HTI",[],"Haitian|Haitiana"],
  ["Honduras","Honduras","HN","HND",[],"Honduran"],
  ["Kenya","Kenya","KE","KEN",[],"Kenyan|Keniota"],
  ["Kirghizistan","Kyrgyzstan","KG","KGZ",[],"Kyrgyz|Kirghiza|Kirghizia"],
  ["Kuwait","Kuwait","KW","KWT",[],"Kuwaiti"],
  ["Laos","Laos","LA","LAO",[],"Lao|Laotian|Lao People's Democratic Republic"],
  ["Lesotho","Lesotho","LS","LSO",[],"Basotho"],
  ["Liberia","Liberia","LR","LBR",[],"Liberian"],
  ["Libia","Libya","LY","LBY",[],"Libyan|Libica|Libico"],
  ["Madagascar","Madagascar","MG","MDG",[],"Malagasy"],
  ["Malawi","Malawi","MW","MWI",[],"Malawian"],
  ["Maldive","Maldives","MV","MDV",[],"Maldivian|Maldiviana"],
  ["Mali","Mali","ML","MLI",[],"Malian"],
  ["Mauritania","Mauritania","MR","MRT",[],"Mauritanian"],
  ["Maurizio","Mauritius","MU","MUS",[],"Mauritian|Mauriziana"],
  ["Mongolia","Mongolia","MN","MNG",[],"Mongolian|Mongola"],
  ["Mozambico","Mozambique","MZ","MOZ",[],"Mozambican"],
  ["Myanmar Birmania","Myanmar","MM","MMR",["Myanmar","Birmania"],"Burma|Burmese|Birmana"],
  ["Namibia","Namibia","NA","NAM",[],"Namibian"],
  ["Nicaragua","Nicaragua","NI","NIC",[],"Nicaraguan|Nicaraguense"],
  ["Niger","Niger","NE","NER",[],"Nigerien"],
  ["Oman","Oman","OM","OMN",[],"Omani"],
  ["Paraguay","Paraguay","PY","PRY",[],"Paraguayan|Paraguaiana"],
  ["Qatar","Qatar","QA","QAT",[],"Qatari"],
  ["Repubblica Centrafricana","Central African Republic","CF","CAF",[],"Centrafricana"],
  ["Ruanda","Rwanda","RW","RWA",[],"Rwandan"],
  ["Somalia","Somalia","SO","SOM",[],"Somali|Somala"],
  ["Sudan","Sudan","SD","SDN",[],"Sudanese|Sudanese Republic"],
  ["Sud Sudan","South Sudan","SS","SSD",[],"South Sudanese"],
  ["Suriname","Suriname","SR","SUR",[],"Surinamese"],
  ["Swaziland","Eswatini","SZ","SWZ",[],"Swazi"],
  ["Tagikistan","Tajikistan","TJ","TJK",[],"Tajik"],
  ["Taiwan","Taiwan","TW","TWN",[],"Taiwanese|Taiwanese Republic|Republic of China|Taipei"],
  ["Tanzania","Tanzania","TZ","TZA",[],"Tanzanian"],
  ["Turkmenistan","Turkmenistan","TM","TKM",[],"Turkmen"],
  ["Uganda","Uganda","UG","UGA",[],"Ugandan"],
  ["Uzbekistan","Uzbekistan","UZ","UZB",[],"Uzbek"],
  ["Zambia","Zambia","ZM","ZMB",[],"Zambian"],
  ["Zimbabwe","Zimbabwe","ZW","ZWE",[],"Zimbabwean"],
  ["Togo","Togo","TG","TGO",[],"Togolese"],
  ["Tonga","Tonga","TO","TON",[],"Tongan"],
  ["Trinidad e Tobago","Trinidad and Tobago","TT","TTO",[],"Trinidad|Trinidadian"],
  ["Yemen","Yemen","YE","YEM",[],"Yemeni"],
  ["Sierra Leone","Sierra Leone","SL","SLE",[],"Sierra Leonean"],
  ["Seychelles","Seychelles","SC","SYC",[],"Seychellois"],
  ["Samoa","Samoa","WS","WSM",[],"Samoan"],
  ["Saint Lucia","Saint Lucia","LC","LCA",[],"St Lucia|Santa Lucia"],
  ["Antigua e Barbuda","Antigua and Barbuda","AG","ATG",[],"Antigua|Antiguan"],
];

export interface CountryOption { it: string; en: string }
/** Elenco per l'autocompletamento della cittadinanza (valore = nome italiano, etichetta = nome inglese). */
export const COUNTRY_OPTIONS: CountryOption[] = (() => {
  const seen = new Set<string>();
  const out: CountryOption[] = [];
  for (const r of ROWS) { if (seen.has(r[0])) continue; seen.add(r[0]); out.push({ it: r[0], en: r[1] }); }
  return out.sort((a, b) => a.it.localeCompare(b.it, "it"));
})();

interface CountryEntry { names: string[] /* nomi italiani (norm) da cercare nella tabella, in ordine di preferenza */; iso: boolean }
// alias (norm) → paese. Gli ISO a 2/3 lettere sono marcati: in contesto "luogo" (comune) non vanno usati, perché "PA" è anche Palermo.
const BY_ALIAS = new Map<string, { entry: CountryEntry; iso: boolean }>();
{
  const add = (alias: string, entry: CountryEntry, iso: boolean) => {
    const k = normText(alias);
    if (!k) return;
    if (!BY_ALIAS.has(k)) BY_ALIAS.set(k, { entry, iso });
  };
  for (const [it, en, iso2, iso3, alts, aliases] of ROWS) {
    const entry: CountryEntry = { names: Array.from(new Set([it, ...alts].map(normText))), iso: false };
    add(it, entry, false); add(en, entry, false);
    for (const a of alts) add(a, entry, false);
    add(iso2, entry, true); add(iso3, entry, true);
    for (const a of aliases.split("|")) add(a, entry, a.trim().length <= 3 && /^[A-Za-z. ]+$/.test(a.trim()) && a.trim().length > 0 && a === a.toUpperCase());
  }
}

/**
 * Nomi italiani (norm) con cui cercare lo Stato nella tabella Luoghi, dato quello che l'ospite ha scritto (già normalizzato con normText).
 * `allowIso`: ammette i codici ISO a 2/3 lettere ("DE", "USA"): sì per la cittadinanza, no per i comuni.
 */
export function countryNames(nv: string, allowIso = true): string[] | null {
  const hit = BY_ALIAS.get(nv);
  if (!hit) return null;
  if (hit.iso && !allowIso) return null;
  return hit.entry.names;
}
