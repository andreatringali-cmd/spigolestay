// Revenue Autopilot — spiegazioni in linguaggio naturale.
// Trasforma i segnali REALI già calcolati da computeSuggestions (lib/autopilot.ts)
// in una frase italiana leggibile, del tipo:
//   "Ho alzato il prezzo di Doppia Vista Mare per venerdì 3 del 12% perché
//    l'occupazione è all'85% e il giorno è un weekend, tipicamente ad alta domanda."
//
// Regola: questa funzione NON introduce alcun segnale nuovo. Legge solo i campi che
// il motore prezzi ha davvero popolato (occupazione, giorno della settimana, pacing
// last-minute, buchi tra prenotazioni, festivi/ponti/eventi reali, benchmark di zona
// "Rete città" se attivo). Se un segnale non è disponibile, la relativa frase viene
// semplicemente omessa: meglio una spiegazione più corta che una inventata.
import { GUARDRAIL_LABEL, type Suggestion } from "./autopilot";
import { parseISO } from "./dates";

const WEEKDAY_LONG = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

function dayLabel(iso: string): string {
  const d = parseISO(iso);
  return `${WEEKDAY_LONG[d.getDay()]} ${d.getDate()}`;
}

// Unisce le frasi con la punteggiatura italiana ("a, b e c").
function joinIt(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

// Le frasi di zona (lib/market.ts → zoneMultiplier) sono già testo umano onesto
// (attivo solo con dati reali di rete): le rendiamo solo minuscole/discorsive.
// Se la Rete città includeva strutture demo, zoneMultiplier aggiunge un asterisco finale
// (" *") alla frase originale: lo togliamo dalla clausola e lo segnaliamo a parte, così
// anche il registro attività resta onesto su cosa è dato demo e cosa è mercato reale.
const DEMO_MARK = " *";
function zoneClause(rawReason: string): string {
  const r = rawReason.endsWith(DEMO_MARK) ? rawReason.slice(0, -DEMO_MARK.length) : rawReason;
  if (r.startsWith("Zona molto piena")) return "la Rete città segnala una zona molto piena rispetto alla tua occupazione";
  if (r.startsWith("Sotto l'ADR")) return `il tuo prezzo medio è sotto la media di zona (${r.match(/\+\d+%/)?.[0] ?? "sotto media"})`;
  if (r.startsWith("Sopra l'ADR")) return "il tuo prezzo medio è già sopra la media di zona";
  return r.charAt(0).toLowerCase() + r.slice(1);
}

// true se almeno una motivazione di zona porta l'asterisco demo (vedi DEMO_MARK sopra).
const hasDemoZone = (reasons: string[]): boolean => reasons.some((r) => r.endsWith(DEMO_MARK));
const DEMO_NOTE = "* la Rete città di zona include, per ora, anche strutture demo dimostrative insieme a quelle reali";

// Frase onesta sul guardrail che ha frenato la proposta (vuota se nessuno l'ha fatto).
const guardNote = (s: Suggestion): string => (s.limitedBy ? ` Limitato da: ${GUARDRAIL_LABEL[s.limitedBy]} (senza limiti il motore avrebbe proposto € ${s.rawSuggested}).` : "");

/**
 * Spiegazione completa (soggetto + giorno) di una proposta, pensata per il registro
 * attività o per un contesto senza altre colonne (es. "Autopilot ha applicato: ...").
 */
export function explainSuggestion(s: Suggestion): string {
  const { signals } = s;
  const day = dayLabel(s.iso);
  if (s.suggested === s.current) return `Nessuna variazione per ${s.typeName} di ${day}.`;
  const verb = s.suggested > s.current ? "alzato" : "abbassato";
  const pct = Math.abs(s.deltaPct);

  const clauses: string[] = [];
  if (signals.occBand === "alta") clauses.push(`l'occupazione di questa tipologia in quel giorno è all'${s.occ}%, un livello considerato di alta domanda`);
  else if (signals.occBand === "media-alta") clauses.push(`l'occupazione è al ${s.occ}%, in crescita`);
  else if (signals.occBand === "bassa") clauses.push(`l'occupazione è ferma al ${s.occ}%, per favorire nuove prenotazioni`);
  if (signals.weekend && (signals.occBand === "alta" || signals.occBand === "media-alta")) clauses.push("il giorno è un weekend, tipicamente ad alta domanda nel listino");
  if (signals.lastMinute) clauses.push("mancano pochi giorni al check-in e la tipologia è ancora in gran parte libera");
  if (signals.gap) clauses.push('è un giorno più libero di quelli immediatamente prima e dopo (un "buco" tra le prenotazioni)');
  if (signals.highDemandLabel) clauses.push(`è un giorno ad alta domanda (${signals.highDemandLabel})`);
  clauses.push(...signals.zoneReasons.map(zoneClause));

  const why = clauses.length ? joinIt(clauses) : "l'andamento delle prenotazioni rilevato dal motore prezzi";
  const note = hasDemoZone(signals.zoneReasons) ? ` (${DEMO_NOTE})` : "";
  return `Ho ${verb} il prezzo di ${s.typeName} per ${day} del ${pct}% perché ${why}${note}.${guardNote(s)}`;
}

/**
 * Variante compatta per una riga di tabella dove tipologia e giorno sono già mostrati
 * in colonne separate: evita ripetizioni e riporta solo il "perché".
 */
export function explainSuggestionCompact(s: Suggestion): string {
  const { signals } = s;
  if (s.suggested === s.current) return "Nessuna variazione.";
  const pct = Math.abs(s.deltaPct);
  const verb = s.suggested > s.current ? "alza" : "abbassa";

  const clauses: string[] = [];
  if (signals.occBand === "alta") clauses.push(`occupazione all'${s.occ}% (alta domanda)`);
  else if (signals.occBand === "media-alta") clauses.push(`occupazione al ${s.occ}%, in crescita`);
  else if (signals.occBand === "bassa") clauses.push(`occupazione ferma al ${s.occ}%`);
  if (signals.weekend && (signals.occBand === "alta" || signals.occBand === "media-alta")) clauses.push("weekend, giorno tipicamente forte");
  if (signals.lastMinute) clauses.push("last-minute ancora scarico");
  if (signals.gap) clauses.push("buco tra due prenotazioni");
  if (signals.highDemandLabel) clauses.push(signals.highDemandLabel);
  clauses.push(...signals.zoneReasons.map(zoneClause));

  const why = clauses.length ? joinIt(clauses) : "andamento prenotazioni";
  const note = hasDemoZone(signals.zoneReasons) ? ` (${DEMO_NOTE})` : "";
  return `${verb === "alza" ? "Alza" : "Abbassa"} del ${pct}% perché ${why}${note}.${guardNote(s)}`;
}

/**
 * Riepilogo per il registro attività quando l'autopilot applica più proposte insieme
 * (in blocco o in background): un paio di esempi concreti invece di un log per riga,
 * coerente con come altri moduli riassumono le azioni in blocco (es. "Camere aggiornate
 * in blocco · N").
 */
export function summarizeAppliedSuggestions(list: Suggestion[], sample = 2): string {
  if (!list.length) return "";
  const ranked = [...list].sort((a, b) => Math.abs(b.suggested - b.current) - Math.abs(a.suggested - a.current));
  const examples = ranked.slice(0, sample).map((s) => explainSuggestion(s));
  const rest = list.length - examples.length;
  return `${examples.join(" ")}${rest > 0 ? ` (+${rest} altre variazioni)` : ""}`;
}
