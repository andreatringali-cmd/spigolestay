// Shell unica delle email di Xenora (ospite e titolare) + piccoli blocchi riusabili.
// Solo funzioni pure (nessun accesso a rete/DB): le usano la route /api/email, i test e il server.
//
// Regole di compatibilità con i client di posta (Gmail, Outlook, Apple Mail, Yahoo):
//  - layout a TABELLE, larghezza 600px, niente display:flex/grid;
//  - stili inline, <meta charset/viewport>, <title> e preheader nascosto;
//  - immagini con width/height negli attributi HTML (+ max-width), nessun asset esterno oltre al logo della struttura;
//  - colore di accento con testo bianco o scuro scelto per contrasto (WCAG), anche sui pulsanti.
import { et, dateLocale } from "../email-i18n";
import { fmtDMY } from "../dates";
import type { GuestLang } from "../phone-country";

export type Lang = GuestLang;

export const esc = (s: unknown): string => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] || c));

// ── Colori ──────────────────────────────────────────────────────────────────
/** "#abc" / "#aabbcc" / "#aabbccdd" → [r,g,b] (0-255); non valido → null. */
export function hexToRgb(hex: string | undefined | null): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: [number, number, number]) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
/** Colore esadecimale valido a 6 cifre, altrimenti il ripiego. */
export function normHex(hex: string | undefined | null, fallback: string): string {
  const c = hexToRgb(hex);
  return c ? toHex(c) : fallback;
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrastRatio(a: string, b: string): number {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  if (!ca || !cb) return 1;
  const la = luminance(ca), lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export const INK = "#1f2430";
/** Colore del testo (bianco o scuro) con più contrasto sopra lo sfondo `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, INK) ? "#ffffff" : INK;
}
/** Colore d'accento usabile come TESTO su sfondo bianco (scurisce i colori troppo chiari, es. giallo). */
export function accentText(accent: string): string {
  let c = hexToRgb(accent);
  if (!c) return "#285f92";
  for (let i = 0; i < 12 && contrastRatio(toHex(c), "#ffffff") < 4.5; i++) c = [c[0] * 0.88, c[1] * 0.88, c[2] * 0.88];
  return toHex(c);
}
/** Miscela l'accento con il bianco (quota = parte di colore, 0..1): per sfondi tenui. */
export function tintOf(accent: string, share: number): string {
  const c = hexToRgb(accent) ?? [40, 95, 146];
  return toHex(c.map((v) => 255 * (1 - share) + v * share) as [number, number, number]);
}

// ── Date, numeri, plurali ───────────────────────────────────────────────────
/** gg.mm.aaaa da una data ISO (anche con orario: contano solo i primi 10 caratteri). Non valida → vuoto. */
export function fmtIso(iso?: string | null): string {
  const s = String(iso ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? fmtDMY(s.slice(0, 10)) : "";
}
/** "lun 01.01.2027" (giorno della settimana nella lingua dell'email + gg.mm.aaaa). */
export function fmtDay(iso: string | undefined | null, lang: Lang = "it"): string {
  const s = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return "";
  const d = s.slice(0, 10);
  try {
    const wd = new Date(d + "T00:00:00Z").toLocaleDateString(dateLocale(lang), { weekday: "short", timeZone: "UTC" }).replace(/\.$/, "");
    return `${wd} ${fmtDMY(d)}`;
  } catch { return fmtDMY(d); }
}
/** Importo con 2 decimali nel formato della lingua: "€ 1.234,50" (it). */
export function money(n: number | undefined | null, cur = "€", lang: Lang = "it"): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  // useGrouping "always": it/es non separano le migliaia sotto le 5 cifre (1234,50) ma gli importi italiani si scrivono 1.234,50.
  return `${cur} ${v.toLocaleString(dateLocale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" as unknown as boolean })}`;
}

type CountKind = "night" | "adult" | "child" | "person";
const COUNT_WORDS: Record<CountKind, Record<Lang, [string, string]>> = {
  night: { it: ["notte", "notti"], en: ["night", "nights"], fr: ["nuit", "nuits"], de: ["Nacht", "Nächte"], es: ["noche", "noches"] },
  adult: { it: ["adulto", "adulti"], en: ["adult", "adults"], fr: ["adulte", "adultes"], de: ["Erwachsener", "Erwachsene"], es: ["adulto", "adultos"] },
  child: { it: ["bambino", "bambini"], en: ["child", "children"], fr: ["enfant", "enfants"], de: ["Kind", "Kinder"], es: ["niño", "niños"] },
  person: { it: ["persona", "persone"], en: ["guest", "guests"], fr: ["personne", "personnes"], de: ["Person", "Personen"], es: ["persona", "personas"] },
};
/** "1 notte", "3 notti": plurale corretto nella lingua. */
export function countLabel(lang: Lang, kind: CountKind, n: number): string {
  const w = COUNT_WORDS[kind][lang] ?? COUNT_WORDS[kind].it;
  return `${n} ${n === 1 ? w[0] : w[1]}`;
}
/** "2 adulti, 1 bambino" (omette le voci a zero; senza ospiti noti → vuoto). */
export function peopleLabel(lang: Lang, adults?: number, children?: number): string {
  const a = Math.max(0, Math.round(adults ?? 0)), c = Math.max(0, Math.round(children ?? 0));
  return [a ? countLabel(lang, "adult", a) : "", c ? countLabel(lang, "child", c) : ""].filter(Boolean).join(", ");
}

const titleCase = (s: string) => s.toLocaleLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, p: string, ch: string) => p + ch.toLocaleUpperCase());
/**
 * Nome per il saluto. Con il nome di battesimo noto (scheda ospite) si usa quello; altrimenti la prima parola di un nome "Nome Cognome".
 * Un nome tutto MAIUSCOLO ("ROSSI MARIO", formato COGNOME NOME di alcune OTA) non si può spezzare con certezza: si saluta con il nome intero in maiuscolo/minuscolo corretto.
 */
export function greetingName(full?: string | null, first?: string | null): string {
  const f = String(first ?? "").replace(/\s+/g, " ").trim();
  if (f) return /^[^a-zà-ÿ]+$/u.test(f) && /\p{L}/u.test(f) ? titleCase(f) : f;
  const name = String(full ?? "").replace(/\s+/g, " ").trim();
  if (!name) return "";
  const allCaps = /\p{L}/u.test(name) && name === name.toLocaleUpperCase() && name !== name.toLocaleLowerCase();
  if (allCaps) return titleCase(name);
  return name.split(" ")[0];
}

// ── Canali (chip con i colori ufficiali, senza asset esterni) ───────────────
export interface ChipStyle { bg: string; fg: string; label: string }
/** Stile del chip del canale, dal codice interno ("booking") o dall'etichetta ("Booking.com"). */
export function channelChipStyle(channelOrLabel?: string | null): ChipStyle | null {
  const raw = String(channelOrLabel ?? "").trim();
  if (!raw) return null;
  const c = raw.toLowerCase();
  if (c.includes("booking.com") || c === "booking") return { bg: "#003580", fg: "#ffffff", label: "Booking.com" };
  if (c.includes("airbnb")) return { bg: "#FF5A5F", fg: "#ffffff", label: "Airbnb" };
  if (c.includes("expedia") || c.includes("vrbo")) return { bg: "#FFCB05", fg: "#00355F", label: raw.toLowerCase() === "expedia" ? "Expedia" : raw };
  if (c.includes("agoda")) return { bg: "#5A2D8C", fg: "#ffffff", label: "Agoda" };
  if (c.includes("bed-and-breakfast") || c.includes("bed and breakfast")) return { bg: "#E8731A", fg: "#ffffff", label: "bed-and-breakfast.it" };
  if (c.includes("google")) return { bg: "#4285F4", fg: "#ffffff", label: raw };
  if (c.includes("hotelbeds")) return { bg: "#D62828", fg: "#ffffff", label: "HotelBeds" };
  if (c === "direct" || c.startsWith("dirett") || c.startsWith("direct")) return { bg: "#2F9E6F", fg: "#ffffff", label: "Diretto" };
  return { bg: "#6E7B8B", fg: "#ffffff", label: raw };
}
export function channelChipHtml(channelOrLabel?: string | null): string {
  const s = channelChipStyle(channelOrLabel);
  if (!s) return "";
  return `<span style="display:inline-block;background:${s.bg};color:${s.fg};font:700 12px/1 Arial,Helvetica,sans-serif;padding:6px 11px;border-radius:99px;white-space:nowrap;">${esc(s.label)}</span>`;
}

// ── Badge evento ────────────────────────────────────────────────────────────
export type MailEvent = "newBooking" | "modified" | "cancel" | "payment" | "message" | "review" | "alert";
export const MAIL_EVENTS: readonly MailEvent[] = ["newBooking", "modified", "cancel", "payment", "message", "review", "alert"];
export const asMailEvent = (v: unknown): MailEvent | undefined => (MAIL_EVENTS as readonly string[]).includes(String(v)) ? (v as MailEvent) : undefined;
/** Colori del badge (testo scuro su fondo tenue: contrasto ≥ 4.5) e di un'eventuale linea d'accento. */
export const EVENT_STYLE: Record<MailEvent, { fg: string; bg: string; dot: string; label: string }> = {
  newBooking: { fg: "#0B6B3F", bg: "#DFF3E8", dot: "#16A05D", label: "Nuova prenotazione" },
  modified: { fg: "#8A4B00", bg: "#FFF0CC", dot: "#E39A00", label: "Prenotazione modificata" },
  cancel: { fg: "#A31D12", bg: "#FDE3E0", dot: "#D92D20", label: "Prenotazione cancellata" },
  payment: { fg: "#1741A6", bg: "#DEE8FD", dot: "#2563EB", label: "Pagamento ricevuto" },
  message: { fg: "#5B21B6", bg: "#EBE3FB", dot: "#7C3AED", label: "Nuovo messaggio" },
  review: { fg: "#7A5A00", bg: "#FBF0C4", dot: "#CA9A04", label: "Nuova recensione" },
  alert: { fg: "#8F2F0A", bg: "#FDE7D8", dot: "#EA580C", label: "Avviso" },
};
export function eventBadgeHtml(ev: MailEvent, label?: string): string {
  const s = EVENT_STYLE[ev];
  return `<span style="display:inline-block;background:${s.bg};color:${s.fg};font:700 11px/1 Arial,Helvetica,sans-serif;letter-spacing:.6px;text-transform:uppercase;padding:7px 12px;border-radius:99px;white-space:nowrap;"><span style="color:${s.dot};">&#9679;</span>&nbsp; ${esc(label || s.label)}</span>`;
}
/** Stato della prenotazione (voucher all'ospite) → colori del badge. */
export function statusBadgeHtml(kind: "confirmed" | "tentative" | "cancelled" | "no_show", label: string): string {
  const ev: MailEvent = kind === "confirmed" ? "newBooking" : kind === "cancelled" || kind === "no_show" ? "cancel" : "modified";
  return eventBadgeHtml(ev, label);
}

// ── Identità della struttura ────────────────────────────────────────────────
export interface Brand { name?: string; logo?: string; address?: string; phone?: string; email?: string; website?: string; accent?: string; cin?: string; vat?: string }

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function initialsOf(name?: string): string {
  return (name || "XN").replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "XN";
}
/** Logo 52x52 (se è un URL http(s) vero) oppure iniziali nel colore struttura con testo a contrasto. */
export function logoBlockHtml(brand: Brand | undefined, accent: string): string {
  if (brand?.logo && /^https?:\/\//i.test(brand.logo)) {
    return `<img src="${esc(brand.logo)}" alt="${esc(brand.name || "")}" width="52" height="52" style="display:block;width:52px;height:52px;max-width:52px;border:0;border-radius:12px;object-fit:contain;background:#ffffff;" />`;
  }
  return `<table role="presentation" width="52" height="52" cellpadding="0" cellspacing="0" border="0" style="width:52px;height:52px;"><tr><td align="center" valign="middle" width="52" height="52" bgcolor="${accent}" style="width:52px;height:52px;background:${accent};border-radius:12px;color:${readableOn(accent)};font:800 20px/52px Arial,Helvetica,sans-serif;text-align:center;">${esc(initialsOf(brand?.name))}</td></tr></table>`;
}

// ── Blocchi ─────────────────────────────────────────────────────────────────
/** Riga etichetta/valore (il valore è HTML già sicuro). */
export function kvRow(label: string, valueHtml: string, o: { bold?: boolean; color?: string } = {}): string {
  return `<tr><td valign="top" style="padding:7px 12px 7px 0;color:#6b7280;font:13px/1.4 ${FONT};">${esc(label)}</td><td align="right" valign="top" style="padding:7px 0;font:${o.bold === false ? "400" : "600"} 14px/1.4 ${FONT};color:${o.color || INK};">${valueHtml}</td></tr>`;
}
export const kvTable = (rows: string[]): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows.filter(Boolean).join("")}</table>`;
/** Titoletto di sezione. */
export const sectionTitle = (text: string): string =>
  `<div style="margin:22px 0 6px;font:700 11px/1.2 ${FONT};letter-spacing:.8px;text-transform:uppercase;color:#6b7280;">${esc(text)}</div>`;
/** Riquadro con fondo tenue. */
export function cardBox(innerHtml: string, o: { bg?: string; border?: string; pad?: string } = {}): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td style="background:${o.bg || "#f8f9fb"};border:1px solid ${o.border || "#eceef1"};border-radius:12px;padding:${o.pad || "12px 16px"};font-family:${FONT};">${innerHtml}</td></tr></table>`;
}
/** Pulsante principale (tabella: regge Outlook), testo a contrasto sull'accento. */
export function ctaButtonHtml(url: string, label: string, accent: string): string {
  const fg = readableOn(accent);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;"><tr><td align="center" bgcolor="${accent}" style="background:${accent};border-radius:10px;"><a href="${esc(url)}" target="_blank" style="display:block;padding:14px 18px;font:700 15px/1.3 ${FONT};color:${fg};text-decoration:none;border-radius:10px;">${esc(label)}</a></td></tr></table>`;
}
/** Pulsante secondario (contorno). */
export function ghostButtonHtml(url: string, label: string, accent: string): string {
  const t = accentText(accent);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 4px;"><tr><td align="center" style="border:1px solid ${t};border-radius:10px;background:#ffffff;"><a href="${esc(url)}" target="_blank" style="display:block;padding:12px 18px;font:700 14px/1.3 ${FONT};color:${t};text-decoration:none;">${esc(label)}</a></td></tr></table>`;
}
/**
 * A capo e spazi multipli di un testo GIA' passato da esc() → HTML. Si usano <br> e &nbsp; e non `white-space:pre-wrap`: Outlook (mobile e Windows) ignora quella regola
 * e unisce tutto in un blocco unico (preventivi illeggibili); i <br> li capiscono tutti i client.
 */
export const nl2brHtml = (escaped: string): string =>
  escaped.replace(/\r\n?/g, "\n").replace(/ {2,}/g, (m) => " " + "&nbsp;".repeat(m.length - 1)).replace(/\n/g, "<br>\n");
/** Testo libero (a capo preservati) in un paragrafo. */
// *testo* diventa grassetto (come su WhatsApp): i messaggi con titoli di sezione, es. il planning pulizie, restano leggibili anche in email.
export const textBlockHtml = (text: string): string =>
  `<div style="font:15px/1.6 ${FONT};color:${INK};">${nl2brHtml(esc(text).replace(/\*([^*\n]+)\*/g, "<b>$1</b>"))}</div>`;

// ── Shell ───────────────────────────────────────────────────────────────────
export interface ShellOptions {
  lang?: Lang;
  /** Contenuto di <title> (non si vede nel corpo). */
  title: string;
  /** Anteprima mostrata dalla casella di posta accanto all'oggetto. */
  preheader?: string;
  accent: string;
  brand?: Brand;
  /** Piccola scritta sotto il nome della struttura (es. "Conferma prenotazione"). */
  eyebrow?: string;
  bodyHtml: string;
}

export function emailShell(o: ShellOptions): string {
  const lang: Lang = o.lang ?? "it";
  const T = (s: string) => et(lang, s);
  const accent = normHex(o.accent, "#285f92");
  const bd = o.brand || {};
  const name = esc(bd.name || "");
  const aText = accentText(accent);
  const contacts = [bd.phone, bd.email, bd.website].filter(Boolean).map(esc).join(" · ");
  const legal = [bd.cin ? `CIN ${esc(bd.cin)}` : "", bd.vat ? `${esc(T("P.IVA"))} ${esc(bd.vat)}` : ""].filter(Boolean).join(" · ");
  const header = bd.name
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="66" valign="middle" style="width:66px;padding-right:14px;">${logoBlockHtml(bd, accent)}</td>
        <td valign="middle" style="font-family:${FONT};">
          <div style="font:800 19px/1.25 ${FONT};color:${INK};">${name}</div>
          ${bd.address ? `<div style="font:12px/1.4 ${FONT};color:#6b7280;margin-top:2px;">${esc(bd.address)}</div>` : ""}
          ${o.eyebrow ? `<div style="font:700 11px/1.3 ${FONT};letter-spacing:.6px;text-transform:uppercase;color:${aText};margin-top:5px;">${esc(o.eyebrow)}</div>` : ""}
        </td></tr></table>`
    : `<div style="font:700 13px/1.3 ${FONT};letter-spacing:.5px;text-transform:uppercase;color:${aText};">${esc(o.eyebrow || o.title)}</div>`;
  const footer = bd.name
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border-collapse:separate;"><tr><td style="background:#ffffff;border:1px solid #e6e8ec;border-radius:14px;padding:16px 20px;color:#6b7280;font:11px/1.6 ${FONT};">
         <div style="font-weight:700;color:#5b616c;">${name}</div>
         ${bd.address ? `<div>${esc(bd.address)}</div>` : ""}
         ${contacts ? `<div>${contacts}</div>` : ""}
         ${legal ? `<div>${legal}</div>` : ""}
       </td></tr></table>
       <div style="text-align:center;color:#5f6672;font:10px/1.4 ${FONT};margin-top:8px;">${esc(T("Inviato con Xenora"))}</div>`
    : `<div style="text-align:center;color:#5f6672;font:11px/1.4 ${FONT};margin-top:14px;">${esc(T("Inviato con Xenora"))} · Digital Solution</div>`;
  // Preheader: testo nascosto + riempitivo, così la casella non pesca altro testo dal corpo.
  const pre = o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f4f5f7;opacity:0;">${esc(o.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>` : "";
  return `<!doctype html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;-webkit-text-size-adjust:100%;">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f5f7" style="background:#f4f5f7;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td style="background:#ffffff;border:1px solid #e6e8ec;border-radius:16px;overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td height="6" bgcolor="${accent}" style="height:6px;line-height:6px;font-size:0;background:${accent};">&nbsp;</td></tr>
        <tr><td style="padding:20px 24px 16px;border-bottom:1px solid #f0f1f4;">${header}</td></tr>
        <tr><td style="padding:22px 24px 26px;font-family:${FONT};color:${INK};">${o.bodyHtml}</td></tr>
      </table>
    </td></tr>
    <tr><td>${footer}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
