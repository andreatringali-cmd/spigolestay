// Solleciti di pagamento: testo pronto (italiano) + link WhatsApp / email. Puro, senza import.
// Nessun invio automatico: il testo si apre in WhatsApp (wa.me) o nel client di posta, o si copia.

export interface ReminderInput {
  customerName: string;
  docLabel: string;            // es. "fattura 12/2026"
  issueDate: string | null;    // ISO
  dueDate: string | null;      // ISO
  residuoCents: number;
  daysLate: number;            // 0 = non ancora scaduto
  senderName: string;          // struttura / emittente
  bookingCode?: string | null;
}

const eurIt = (cents: number) => {
  const [i, d] = (Math.abs(cents) / 100).toFixed(2).split(".");
  return `€ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`;
};
const dmy = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export function reminderSubject(r: ReminderInput): string {
  return r.daysLate > 0 ? `Promemoria di pagamento – ${r.docLabel}` : `Scadenza in arrivo – ${r.docLabel}`;
}

export function reminderText(r: ReminderInput): string {
  const hi = `Gentile ${r.customerName.trim() || "cliente"},`;
  const what = `${r.docLabel}${r.issueDate ? ` del ${dmy(r.issueDate)}` : ""}${r.bookingCode ? ` (prenotazione ${r.bookingCode})` : ""}`;
  const amount = eurIt(r.residuoCents);
  const sign = r.senderName ? `\nCordiali saluti,\n${r.senderName}` : "\nCordiali saluti";
  let body: string;
  if (r.daysLate <= 0) {
    body = `le ricordiamo che ${what} ha un importo ancora da saldare di ${amount}${r.dueDate ? `, con scadenza il ${dmy(r.dueDate)}` : ""}.\nSe ha già provveduto, la preghiamo di ignorare questo messaggio.`;
  } else if (r.daysLate <= 30) {
    body = `dai nostri registri risulta ancora aperto ${what}, scaduto il ${dmy(r.dueDate)}, per un importo di ${amount}.\nSe ha già provveduto al pagamento, la preghiamo di ignorare questo messaggio; in caso contrario le saremmo grati se potesse saldarlo a breve.`;
  } else {
    body = `a oggi risulta ancora insoluto ${what}, scaduto il ${dmy(r.dueDate)} (${r.daysLate} giorni fa), per un importo di ${amount}.\nLa preghiamo di provvedere al saldo il prima possibile o di contattarci per concordare le modalità.`;
  }
  return `${hi}\n${body}${sign}`;
}

// Numero per wa.me: solo cifre; "00xx" → "xx"; un cellulare italiano a 10 cifre che inizia per 3 → prefisso 39.
export function waDigits(phone: string | null | undefined): string {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.length === 10 && d.startsWith("3")) d = "39" + d;
  return d;
}
export function waReminderLink(phone: string | null | undefined, text: string): string {
  const d = waDigits(phone);
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : "";
}
export function mailReminderLink(email: string | null | undefined, subject: string, text: string): string {
  const e = String(email ?? "").trim();
  return e ? `mailto:${e}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : "";
}
