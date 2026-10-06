"use client";

// Contatti da correggere: gli ospiti in arrivo il cui numero o la cui email non permette ai messaggi automatici di partire.
// Si avvisa con anticipo (entro 10 giorni è urgente) perché ci sia ancora tempo di correggere il dato, chiedere il contatto
// all'ospite (anche dalla chat dell'OTA) o trovare un'alternativa. Una riga per ospite, con la correzione proposta a un clic.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { toISO, parseISO } from "@/lib/dates";
import { CHANNELS } from "@/lib/types";
import { contactReportCached, isRelayEmail } from "@/lib/contacts-check";
import { upcomingContactIssues, URGENT_DAYS, type UpcomingIssue } from "@/lib/contacts-upcoming";

const OTA = new Set(["booking", "airbnb", "expedia", "hotelbeds"]);
const LIMIT = 6;

const whenLabel = (days: number, iso: string) => {
  const d = parseISO(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  return days === 0 ? "arriva oggi" : days === 1 ? "arriva domani" : `arriva tra ${days} giorni (${d})`;
};

// Messaggio da mandare all'ospite per farsi dare un contatto valido, nella sua lingua.
const ASK: Record<string, (name: string, place: string) => string> = {
  it: (n, p) => `Gentile ${n}, per mandarle le istruzioni di arrivo${p} ci serve un suo numero WhatsApp valido (con il prefisso internazionale, es. +39…) oppure un indirizzo email. Può rispondere a questo messaggio? Grazie!`,
  en: (n, p) => `Dear ${n}, to send you the arrival instructions${p} we need a valid WhatsApp number (with the country code, e.g. +44…) or an email address. Could you reply to this message? Thank you!`,
  fr: (n, p) => `Bonjour ${n}, pour vous envoyer les instructions d'arrivée${p} nous avons besoin d'un numéro WhatsApp valide (avec l'indicatif du pays, ex. +33…) ou d'une adresse e-mail. Pouvez-vous répondre à ce message ? Merci !`,
  de: (n, p) => `Guten Tag ${n}, um Ihnen die Anreiseinformationen${p} zu senden, benötigen wir eine gültige WhatsApp-Nummer (mit Ländervorwahl, z. B. +49…) oder eine E-Mail-Adresse. Könnten Sie auf diese Nachricht antworten? Vielen Dank!`,
  es: (n, p) => `Estimado/a ${n}, para enviarle las instrucciones de llegada${p} necesitamos un número de WhatsApp válido (con el prefijo del país, p. ej. +34…) o un correo electrónico. ¿Puede responder a este mensaje? ¡Gracias!`,
};

export default function ContattiDaCorreggere() {
  const { guests, bookings, activeStructureId, updateGuest, getStructure } = useData();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const today = toISO(new Date());

  const list = useMemo(() => upcomingContactIssues(
    bookings.filter((b) => activeStructureId === "all" || b.structureId === activeStructureId),
    guests, today, contactReportCached,
  ), [bookings, guests, activeStructureId, today]);

  // Numeri validi scritti in modo diverso dal formato internazionale (es. 3473824353 o 39-335-6314360-): si riscrivono in un clic.
  const tidy = useMemo(() => list.filter((x) => x.report.phone.pretty && x.guest.phone && x.guest.phone !== x.report.phone.pretty), [list]);
  const urgent = list.filter((x) => x.urgent).length;
  if (list.length === 0) return null;

  const shown = open ? list : list.slice(0, LIMIT);
  const apply = (x: UpcomingIssue, field: "phone" | "email", value: string) => updateGuest(x.guest.id, { [field]: value });
  const copy = async (x: UpcomingIssue) => {
    const lang = (x.guest as { language?: string }).language ?? "it";
    const first = (x.guest.fullName || "").split(/[ ,]+/).filter(Boolean)[0] ?? "";
    const place = getStructure(x.booking.structureId)?.name ? ` a ${getStructure(x.booking.structureId)!.name}` : "";
    try { await navigator.clipboard.writeText((ASK[lang] ?? ASK.it)(first || "ospite", place)); setCopied(x.guest.id); setTimeout(() => setCopied((c) => (c === x.guest.id ? null : c)), 2500); } catch { /* clipboard non disponibile */ }
  };

  return (
    <section className="mb-4 rounded-xl border bg-surface p-3 shadow-sm" style={{ borderColor: urgent ? "color-mix(in srgb, var(--err) 45%, var(--line))" : "color-mix(in srgb, var(--warn) 45%, var(--line))" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-display text-base font-bold text-txt">Contatti da correggere</h2>
        <span className="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums" style={{ color: urgent ? "var(--err)" : "var(--warn)", background: `color-mix(in srgb, ${urgent ? "var(--err)" : "var(--warn)"} 14%, transparent)` }}>{list.length}</span>
        {urgent > 0 && <span className="text-xs font-semibold" style={{ color: "var(--err)" }}>{urgent} {urgent === 1 ? "arriva" : "arrivano"} entro {URGENT_DAYS} giorni</span>}
        {tidy.length > 0 && (
          <button onClick={() => tidy.forEach((x) => apply(x, "phone", x.report.phone.pretty!))} title="Riscrive i numeri validi in formato internazionale (+39 347 382 4353)" className="ml-auto rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash">
            Sistema il formato di {tidy.length} {tidy.length === 1 ? "numero" : "numeri"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-dim">I messaggi automatici partono solo con un numero valido o un&apos;email. Correggi il dato adesso, chiedilo all&apos;ospite o cerca un&apos;alternativa mentre c&apos;è ancora tempo.</p>

      <ul className="mt-2.5 flex flex-col divide-y divide-line">
        {shown.map((x) => {
          const ch = CHANNELS[x.booking.channel as keyof typeof CHANNELS]?.label ?? x.booking.channel;
          const fixes = x.report.issues.map((i) => i.fix).filter(Boolean) as NonNullable<UpcomingIssue["report"]["issues"][number]["fix"]>[];
          return (
            <li key={x.guest.id} className="flex flex-col gap-2 py-2.5 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 md:w-64 md:shrink-0">
                <Link href={`/ospiti/${x.guest.id}`} className="block truncate text-sm font-semibold text-txt hover:text-focus hover:underline">{x.guest.fullName || "Ospite"}</Link>
                <div className="text-[11px]" style={{ color: x.urgent ? "var(--err)" : "var(--dim)" }}>{whenLabel(x.days, x.booking.checkIn)} · {ch}</div>
              </div>
              <div className="min-w-0 flex-1 text-xs">
                {x.report.issues.map((i) => (
                  <div key={i.key} className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-semibold" style={{ color: i.level === "err" ? "var(--err)" : "var(--warn)" }}>{i.label}</span>
                    {i.detail && <span className="text-dim">{i.detail}</span>}
                  </div>
                ))}
                <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{[x.guest.phone || "nessun telefono", x.guest.email ? (isRelayEmail(x.guest.email) ? "email OTA" : x.guest.email) : "nessuna email"].join(" · ")}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                {fixes.map((f) => <button key={f.field + f.value} onClick={() => apply(x, f.field, f.value)} className="rounded-lg bg-focus px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90">{f.label}</button>)}
                <button onClick={() => copy(x)} title={OTA.has(x.booking.channel) ? `Copia un messaggio per chiedere il contatto: incollalo nella chat di ${ch}` : "Copia un messaggio per chiedere il contatto all'ospite"} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash">{copied === x.guest.id ? "Copiato ✓" : OTA.has(x.booking.channel) ? `Chiedi su ${ch}` : "Chiedi il contatto"}</button>
                <Link href={`/ospiti/${x.guest.id}`} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-txt hover:bg-wash">Correggi</Link>
              </div>
            </li>
          );
        })}
      </ul>
      {list.length > LIMIT && <button onClick={() => setOpen((v) => !v)} className="mt-1 w-full rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-focus hover:bg-wash">{open ? "Mostra meno" : `Mostra tutti i ${list.length}`}</button>}
      <p className="mt-2 text-[11px] text-faint">Un numero può essere valido ma senza WhatsApp: non è possibile saperlo in anticipo, lo si scopre al primo invio.</p>
    </section>
  );
}
