// Logica pura dell'avviso "L'ultimo invio automatico non è arrivato": decide se mostrarlo guardando il registro invii_log.
// Nessuna dipendenza da React/Supabase, così si testa da sola.
import { spiegaErroreWa } from "./invii-log";

export interface RigaInvio { at: string; job: string; channel: string; ok: boolean; detail?: string | null; ref?: string | null }
export interface Avviso { key: string; job: string; channel: string; at: string; titolo: string; motivo: string; href: string; linkLabel: string }

/** Job che generano l'avviso (gli altri, es. ota_msg, non riguardano questo controllo). */
export const JOB_AVVISO = ["pulizie", "messaggi", "checkin"] as const;
/** Finestra di osservazione: un errore più vecchio di 2 giorni non si segnala più. */
export const FINESTRA_MS = 2 * 24 * 3600 * 1000;
/** Intervallo minimo tra due richieste al server. */
export const INTERVALLO_RICHIESTA_MS = 5 * 60 * 1000;

const PAGINA: Record<string, { href: string; label: string; nome: string }> = {
  pulizie: { href: "/pulizie", label: "Apri Pulizie", nome: "il planning delle pulizie" },
  messaggi: { href: "/messaggi", label: "Apri Messaggi", nome: "il messaggio automatico agli ospiti" },
  checkin: { href: "/messaggi", label: "Apri Messaggi", nome: "il promemoria di check-in" },
};

/** true se si può fare una nuova richiesta al server (mai più di una ogni 5 minuti). */
export function puoRichiedere(ultimaRichiestaMs: number | null | undefined, adessoMs: number): boolean {
  if (!ultimaRichiestaMs || !Number.isFinite(ultimaRichiestaMs)) return true;
  if (ultimaRichiestaMs > adessoMs) return true; // orologio spostato indietro: meglio riprovare
  return adessoMs - ultimaRichiestaMs >= INTERVALLO_RICHIESTA_MS;
}

/** Chiave che identifica quel preciso errore: chiudere l'avviso la memorizza, un errore diverso ne ha un'altra. */
export const chiaveAvviso = (r: Pick<RigaInvio, "job" | "channel" | "at">): string => `${r.job}|${r.channel}|${r.at}`;

function motivoDi(r: RigaInvio): string {
  const spiegato = r.channel === "whatsapp" ? spiegaErroreWa(r.detail ?? "") : "";
  if (spiegato) return spiegato;
  const d = (r.detail ?? "").trim();
  if (!d) return "Il motivo non è stato registrato.";
  // I dettagli dei messaggi hanno la forma "modello → destinatario: errore": del motivo interessa la parte dopo l'ultimo ": ".
  const dopo = d.includes(": ") ? d.slice(d.lastIndexOf(": ") + 2) : d;
  return (dopo || d).slice(0, 200);
}

/**
 * Decide se mostrare l'avviso. Per ogni coppia (job, canale) conta solo l'ULTIMO invio entro 2 giorni:
 * se è riuscito, quel canale è a posto; se è fallito, è un problema. Tra i problemi si mostra il più recente.
 * `chiusa` è la chiave dell'avviso chiuso dall'utente: lo stesso errore non si ripropone.
 */
export function decidiAvviso(righe: RigaInvio[] | null | undefined, adessoMs: number, chiusa?: string | null): Avviso | null {
  const ultimi = new Map<string, RigaInvio & { t: number }>();
  for (const r of righe ?? []) {
    if (!r || !(JOB_AVVISO as readonly string[]).includes(r.job)) continue;
    const t = Date.parse(r.at);
    if (!Number.isFinite(t) || adessoMs - t > FINESTRA_MS) continue;
    const k = `${r.job}|${r.channel}`;
    const prev = ultimi.get(k);
    if (!prev || t > prev.t) ultimi.set(k, { ...r, t });
  }
  let peggiore: (RigaInvio & { t: number }) | null = null;
  for (const r of ultimi.values()) if (!r.ok && (!peggiore || r.t > peggiore.t)) peggiore = r;
  if (!peggiore) return null;
  const key = chiaveAvviso(peggiore);
  if (chiusa && chiusa === key) return null;
  const p = PAGINA[peggiore.job] ?? PAGINA.messaggi;
  return { key, job: peggiore.job, channel: peggiore.channel, at: peggiore.at, titolo: "L'ultimo invio automatico non è arrivato", motivo: `${p.nome[0].toUpperCase()}${p.nome.slice(1)}: ${motivoDi(peggiore)}`, href: p.href, linkLabel: p.label };
}
