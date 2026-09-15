import { toISO } from "./dates";

// Domenica di Pasqua (algoritmo gregoriano anonimo).
function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const FIXED: [string, string][] = [
  ["01-01", "Capodanno"], ["01-06", "Epifania"], ["04-25", "Liberazione"], ["05-01", "Festa del lavoro"],
  ["06-02", "Festa della Repubblica"], ["08-15", "Ferragosto"], ["11-01", "Ognissanti"], ["12-08", "Immacolata"],
  ["12-25", "Natale"], ["12-26", "Santo Stefano"], ["12-31", "San Silvestro"],
];

// Patroni cittadini (chiave = città in minuscolo).
const PATRONS: Record<string, [string, string][]> = {
  siracusa: [["12-13", "Santa Lucia"]],
  catania: [["02-05", "Sant'Agata"]],
  palermo: [["07-15", "Santa Rosalia"]],
  roma: [["06-29", "Santi Pietro e Paolo"]],
  milano: [["12-07", "Sant'Ambrogio"]],
  napoli: [["09-19", "San Gennaro"]],
  venezia: [["04-25", "San Marco"]],
  firenze: [["06-24", "San Giovanni"]],
  torino: [["06-24", "San Giovanni"]],
  bologna: [["10-04", "San Petronio"]],
  bari: [["12-06", "San Nicola"]],
};

/** Festività italiane (nazionali + patrono della città) per gli anni indicati: ISO → nome. */
export function italianHolidays(years: number[], city = ""): Record<string, string> {
  const out: Record<string, string> = {};
  const patrons = PATRONS[city.trim().toLowerCase()] || [];
  for (const y of years) {
    for (const [md, name] of [...FIXED, ...patrons]) out[`${y}-${md}`] = out[`${y}-${md}`] ? `${out[`${y}-${md}`]} · ${name}` : name;
    const e = easter(y);
    out[toISO(e)] = "Pasqua";
    const pm = new Date(e); pm.setDate(pm.getDate() + 1);
    out[toISO(pm)] = "Pasquetta";
  }
  return out;
}

/** Ponti: giorni feriali tra un festivo e il weekend (festivo di martedì → lunedì, di giovedì → venerdì). ISO → nome festivo. */
export function italianBridges(holidays: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [iso, name] of Object.entries(holidays)) {
    const d = new Date(iso + "T00:00:00"), wd = d.getDay();
    const b = new Date(d);
    if (wd === 2) b.setDate(d.getDate() - 1);
    else if (wd === 4) b.setDate(d.getDate() + 1);
    else continue;
    const k = toISO(b);
    if (!holidays[k]) out[k] = name;
  }
  return out;
}
