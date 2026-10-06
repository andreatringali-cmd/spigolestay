// Controllo dei contatti dell'ospite (telefono ed email): serve a capire IN TEMPO se i messaggi automatici arriveranno davvero.
// Funzione pura, nessuna chiamata di rete. Cosa si può sapere e cosa no:
//  · numero: si controlla che sia un numero reale per il suo Paese (lunghezza, prefisso, cifre mancanti o di troppo), lo si riscrive in formato internazionale
//    e si capisce se è un fisso (di solito senza WhatsApp). Se WhatsApp esista su quel numero NON si può sapere prima di scrivere: lo dice solo il primo invio.
//  · email: si controlla la forma, gli errori di battitura più comuni (gmial.com…) e si riconoscono gli indirizzi "ponte" delle OTA (Booking, Airbnb, Expedia),
//    che sono validi: il messaggio passa dall'OTA fino all'ospite.
import { parsePhoneNumberFromString, validatePhoneNumberLength, type CountryCode } from "libphonenumber-js/max";

export type PhoneStatus = "missing" | "ok" | "landline" | "invalid";
export interface PhoneFix { value: string; reason: string }
export interface PhoneCheck {
  status: PhoneStatus;
  e164?: string;        // +393473824353
  pretty?: string;      // +39 347 382 4353
  assumed?: boolean;    // il prefisso del Paese non c'era ed è stato dedotto
  reason?: string;      // perché non va
  fix?: PhoneFix;       // correzione probabile (da confermare)
}

const cc = (c?: string): CountryCode | undefined => (c && /^[A-Za-z]{2}$/.test(c.trim()) ? (c.trim().toUpperCase() as CountryCode) : undefined);

const lengthReason = (s: string, country?: CountryCode): string => {
  const r = validatePhoneNumberLength(s, country);
  if (r === "TOO_SHORT") return "troppo corto: manca qualche cifra";
  if (r === "TOO_LONG") return "troppo lungo: c'è una cifra in più";
  if (r === "INVALID_COUNTRY") return "prefisso del Paese non riconosciuto";
  if (r === "NOT_A_NUMBER") return "non è un numero di telefono";
  return "numero non valido per il suo Paese";
};

export function checkPhone(raw?: string, o: { country?: string; defaultCountry?: string } = {}): PhoneCheck {
  const original = (raw ?? "").trim();
  if (!original) return { status: "missing" };
  const guestCountry = cc(o.country), fallbackCountry = cc(o.defaultCountry ?? "IT");

  const done = (p: NonNullable<ReturnType<typeof parsePhoneNumberFromString>>, assumed: boolean): PhoneCheck => ({
    status: p.getType() === "FIXED_LINE" ? "landline" : "ok", e164: p.number, pretty: p.formatInternational(), assumed: assumed || undefined,
    ...(p.getType() === "FIXED_LINE" ? { reason: "numero fisso: di solito non ha WhatsApp" } : {}),
  });
  const tries = [...new Set([guestCountry, fallbackCountry].filter(Boolean))] as CountryCode[];

  let s = original;
  // Formato delle OTA "44-3-308225121-" / "39--3934335777-" / "0-0-18574458226-": prefisso-zona-numero-. A volte la zona è vuota o è già dentro il numero.
  const ota = /^(\d{1,3})-(\d{0,5})-(\d{3,})-$/.exec(original);
  if (ota) {
    const [, c, area, num] = ota;
    const cands = c !== "0" ? [`+${c}${area}${num}`, `+${c}${num}`] : [`+${num}`];
    for (const cand of cands) { const q = parsePhoneNumberFromString(cand); if (q?.isValid()) return done(q, false); }
    if (c === "0") for (const cn of tries) { const q = parsePhoneNumberFromString(num, cn); if (q?.isValid()) return done(q, true); }
    s = cands[0];
  }
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  s = s.replace(/(?!^)\+/g, "");
  if (!/\d/.test(s)) return { status: "invalid", reason: "non è un numero di telefono" };

  if (s.startsWith("+")) {
    const p = parsePhoneNumberFromString(s);
    if (p?.isValid()) return done(p, false);
    // Prefisso sbagliato rispetto al Paese dell'ospite (es. "+1 0651964616" per un olandese): si prova il numero come nazionale del suo Paese.
    const national = p?.nationalNumber ?? "";
    for (const c of [guestCountry, fallbackCountry]) {
      if (!c || !national || (p && p.country === c)) continue;
      for (const cand of [national, "0" + national]) {
        const q = parsePhoneNumberFromString(cand, c);
        if (q?.isValid()) return { status: "invalid", reason: p ? lengthReason(s) : "numero non valido", fix: { value: q.formatInternational(), reason: `forse è un numero ${c} scritto col prefisso sbagliato` } };
      }
    }
    return { status: "invalid", reason: lengthReason(s) };
  }

  // Senza "+": prima il Paese dell'ospite, poi quello della struttura, poi come se avesse già il prefisso internazionale (es. "442036847925").
  for (const c of tries) {
    const p = parsePhoneNumberFromString(s, c);
    if (p?.isValid()) return done(p, true);
  }
  const intl = parsePhoneNumberFromString("+" + s);
  if (intl?.isValid()) return done(intl, true);
  return { status: "invalid", reason: guestCountry ? lengthReason(s, guestCountry) : `${lengthReason(s, tries[0])} (senza prefisso del Paese)` };
}

// ─────────────────────────────── Email ───────────────────────────────

export type EmailStatus = "missing" | "ok" | "relay" | "typo" | "invalid";
export interface EmailCheck { status: EmailStatus; clean?: string; suggestion?: string; reason?: string }

// Indirizzi "ponte" delle OTA: validi, il messaggio arriva all'ospite passando dall'OTA.
const RELAY = /@(guest\.booking\.com|m\.airbnb\.com|guest\.airbnb\.com|(?:[a-z0-9-]+\.)?expediapartnercentral\.com|guest\.expedia\.com|reply\.agoda\.com|relay\.hotelbeds\.com|(?:[a-z0-9-]+\.)?guest\.trip\.com)$/i;
export const isRelayEmail = (e?: string) => !!e && RELAY.test(e.trim());

const PROVIDERS = ["gmail.com", "hotmail.com", "hotmail.it", "outlook.com", "outlook.it", "yahoo.com", "yahoo.it", "libero.it", "icloud.com", "live.com", "live.it", "virgilio.it", "tiscali.it", "alice.it", "tin.it", "fastwebnet.it", "aruba.it", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "gmx.at", "gmx.net", "web.de", "t-online.de", "orange.fr", "free.fr", "wanadoo.fr", "sfr.fr", "yahoo.fr", "yahoo.co.uk", "yahoo.de", "btinternet.com", "me.com", "msn.com", "aol.com", "mail.com", "yandex.ru", "mail.ru", "wp.pl", "o2.pl", "onet.pl", "seznam.cz", "bluewin.ch", "hotmail.fr", "hotmail.de", "hotmail.es", "hotmail.co.uk", "outlook.fr", "outlook.de", "outlook.es", "yahoo.es", "telenet.be", "skynet.be", "ziggo.nl", "kpnmail.nl", "hotmail.nl"];
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.con": "gmail.com", "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmail.ocm": "gmail.com", "gmil.com": "gmail.com", "gmal.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com", "gmail.it": "gmail.com", "gmail.cim": "gmail.com", "gmail.vom": "gmail.com", "gmail.coom": "gmail.com", "gemail.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmai.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmil.com": "hotmail.com", "hotmaill.com": "hotmail.com", "hotmail.cm": "hotmail.com", "hotnail.com": "hotmail.com",
  "outlok.com": "outlook.com", "outlook.con": "outlook.com", "outllok.com": "outlook.com", "outlook.co": "outlook.com", "outook.com": "outlook.com", "outlool.com": "outlook.com",
  "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com", "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com", "yahoo.co": "yahoo.com", "yaoo.com": "yahoo.com", "yahoo.cm": "yahoo.com",
  "libero.com": "libero.it", "libero.co": "libero.it", "liberio.it": "libero.it", "libero.i": "libero.it", "libro.it": "libero.it", "libeo.it": "libero.it",
  "icloud.con": "icloud.com", "iclod.com": "icloud.com", "icloud.co": "icloud.com", "iclould.com": "icloud.com",
  "virgilio.com": "virgilio.it", "tiscali.com": "tiscali.it", "alice.com": "alice.it",
};

// Distanza di modifica (con scambio di lettere vicine): "gmial" → "gmail" = 1.
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

function suggestDomain(domain: string): string | undefined {
  if (PROVIDERS.includes(domain)) return undefined;
  if (TYPOS[domain]) return TYPOS[domain];
  // Stesso suffisso e nome del provider a una lettera di distanza (gmial.com, libeoro.it…). Nomi corti troppo ambigui: non si propongono.
  const [label, ...rest] = domain.split(".");
  const tld = rest.join(".");
  if (label.length < 5) return undefined;
  const near = PROVIDERS.filter((p) => { const [pl, ...pr] = p.split("."); return pr.join(".") === tld && pl.length >= 5 && distance(label, pl) === 1; });
  return near.length === 1 ? near[0] : undefined;
}

export function checkEmail(raw?: string): EmailCheck {
  let s = (raw ?? "").trim();
  if (!s) return { status: "missing" };
  s = s.replace(/^mailto:/i, "").replace(/\s+/g, "").replace(/[.,;:]+$/, "").replace(/^<|>$/g, "").replace(/[.,;:]+$/, "").toLowerCase();
  if (!s) return { status: "invalid", reason: "indirizzo vuoto" };
  const at = s.split("@");
  if (at.length < 2) return { status: "invalid", clean: s, reason: "manca la @" };
  if (at.length > 2) return { status: "invalid", clean: s, reason: "c'è più di una @" };
  const [local, domain] = at;
  if (!local) return { status: "invalid", clean: s, reason: "manca la parte prima della @" };
  if (!domain) return { status: "invalid", clean: s, reason: "manca il dominio dopo la @ (es. gmail.com)" };
  // "gmail,com" / "gmail com": virgola al posto del punto
  const fixedDomain = domain.replace(/,/g, ".");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(fixedDomain) || !/\.[a-z]{2,}$/.test(fixedDomain)) {
    return { status: "invalid", clean: s, reason: !fixedDomain.includes(".") ? "al dominio manca il punto (es. gmail.com)" : "dominio non valido" };
  }
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return { status: "invalid", clean: s, reason: "la parte prima della @ contiene caratteri non validi" };
  const clean = `${local}@${fixedDomain}`;
  if (RELAY.test(clean)) return { status: "relay", clean };
  const sug = suggestDomain(fixedDomain);
  if (sug) return { status: "typo", clean, suggestion: `${local}@${sug}`, reason: `forse volevi scrivere ${sug}` };
  return { status: "ok", clean };
}

// ─────────────────────────── Riepilogo ospite ───────────────────────────

export interface ContactIssue {
  key: "no_contact" | "phone_invalid" | "phone_landline" | "email_typo" | "email_invalid";
  level: "err" | "warn";
  label: string;
  detail?: string;
  fix?: { field: "phone" | "email"; value: string; label: string };
}
export interface ContactReport {
  phone: PhoneCheck; email: EmailCheck;
  whatsapp: boolean;   // il numero è valido e mobile: WhatsApp è probabile (da confermare al primo invio)
  mail: boolean;       // l'email è valida (anche ponte OTA)
  reachable: boolean;  // c'è almeno una strada per raggiungere l'ospite
  issues: ContactIssue[];
}

export function contactReport(g: { phone?: string; email?: string; country?: string }, o: { defaultCountry?: string } = {}): ContactReport {
  const phone = checkPhone(g.phone, { country: g.country, defaultCountry: o.defaultCountry });
  const email = checkEmail(g.email);
  const whatsapp = phone.status === "ok";
  const mail = email.status === "ok" || email.status === "relay";
  const issues: ContactIssue[] = [];
  const phoneFix = phone.fix ? { field: "phone" as const, value: phone.fix.value, label: `Usa ${phone.fix.value}` } : undefined;
  const emailFix = email.suggestion ? { field: "email" as const, value: email.suggestion, label: `Usa ${email.suggestion}` } : undefined;

  if (!whatsapp && !mail) {
    const parts: string[] = [];
    if (phone.status === "missing") parts.push("telefono mancante"); else if (phone.reason) parts.push(`telefono: ${phone.reason}`);
    if (email.status === "missing") parts.push("email mancante"); else if (email.reason) parts.push(`email: ${email.reason}`);
    issues.push({ key: "no_contact", level: "err", label: phone.status === "missing" && email.status === "missing" ? "Nessun contatto: i messaggi automatici non partono" : "Nessun contatto utilizzabile: i messaggi automatici non partono", detail: parts.join(" · "), fix: phoneFix ?? emailFix });
  } else {
    if (phone.status === "invalid") issues.push({ key: "phone_invalid", level: "warn", label: "Numero di telefono non valido", detail: phone.reason, fix: phoneFix });
    if (phone.status === "landline") issues.push({ key: "phone_landline", level: "warn", label: "Numero fisso: probabilmente senza WhatsApp", detail: phone.reason });
    if (email.status === "typo") issues.push({ key: "email_typo", level: "warn", label: "Email da controllare", detail: email.reason, fix: emailFix });
    if (email.status === "invalid") issues.push({ key: "email_invalid", level: "warn", label: "Email non valida", detail: email.reason });
  }
  // Email o numero con un probabile errore, anche se l'altro canale funziona: segnala (e proponi la correzione)
  if (whatsapp && email.status === "typo" && !issues.some((i) => i.key === "email_typo")) issues.push({ key: "email_typo", level: "warn", label: "Email da controllare", detail: email.reason, fix: emailFix });
  return { phone, email, whatsapp, mail, reachable: whatsapp || mail || phone.status === "landline", issues };
}

/** Giorni da oggi (locale, "AAAA-MM-GG") a una data. */
export const daysUntil = (iso: string, today: string) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);

/** Numero pronto per WhatsApp (solo cifre, con prefisso del Paese): se è valido lo riscrive in formato internazionale, altrimenti lascia le sole cifre. */
export function waDigits(raw?: string, country?: string): string {
  const p = checkPhone(raw, { country });
  return (p.e164 ?? raw ?? "").replace(/\D/g, "");
}

// Memoria dei controlli già fatti: le schede si ridisegnano spesso, il risultato dipende solo da telefono, email e Paese.
const reportCache = new Map<string, ContactReport>();
export function contactReportCached(g: { phone?: string; email?: string; country?: string }): ContactReport {
  const k = `${g.phone ?? ""}|${g.email ?? ""}|${g.country ?? ""}`;
  let r = reportCache.get(k);
  if (!r) { r = contactReport(g); if (reportCache.size > 5000) reportCache.clear(); reportCache.set(k, r); }
  return r;
}
