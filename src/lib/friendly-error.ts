// Errori "tecnici" → frasi chiare in italiano per chi usa l'app (titolari e collaboratori).
// Sul modello di lib/booking-errors.ts (che vale per l'ospite sul sito pubblico). Funzione pura: nessun accesso a rete/DB.
//
// Riconosce: codici delle nostre route API (supabase_not_configured, write_conflict, troppe_richieste, http_403, ...),
// errori di Supabase/PostgREST/Postgres (duplicate key, row-level security, invalid input syntax, JWT expired, codici 23505/42501/...),
// errori di rete del browser ("Failed to fetch", "Load failed", ...). Un messaggio già scritto in italiano per le persone passa invariato.
// Il dettaglio tecnico originale resta in console.error (per l'assistenza), mai a schermo.

const CONNECTION = "Connessione assente o instabile: controlla la rete e riprova.";
const SESSION = "La sessione è scaduta: accedi di nuovo e riprova.";
const PERMISSION = "Non hai il permesso di fare questa operazione.";
const TEMPORARY = "Si è verificato un problema temporaneo. Riprova tra qualche istante; se si ripete, contatta l'assistenza.";
const MISSING = "Mancano dei dati o non sono nel formato corretto: controlla i campi e riprova.";
const NOT_FOUND = "Non trovo l'elemento richiesto: potrebbe essere stato eliminato. Ricarica la pagina e riprova.";
const GENERIC = "Operazione non riuscita. Riprova tra poco; se il problema continua, contatta l'assistenza.";

/** Codici delle route API → frase. Chiavi in minuscolo. */
const CODES: Record<string, string> = {
  // configurazione / servizi non attivi
  supabase_not_configured: "Il collegamento al database non è configurato: contatta l'assistenza.",
  admin_not_configured: "Il collegamento al database non è configurato: contatta l'assistenza.",
  not_configured: "Questa funzione non è ancora configurata: completa prima le impostazioni oppure contatta l'assistenza.",
  stripe_not_configured: "I pagamenti con carta non sono ancora attivi: contatta l'assistenza.",
  stripe_not_connected: "Il conto Stripe non è ancora collegato: collegalo dalle impostazioni dei pagamenti e riprova.",
  stripe_not_active: "Il conto Stripe non è ancora attivo: completa la verifica su Stripe e riprova.",
  no_stripe_account: "Il conto Stripe non è ancora collegato: collegalo dalle impostazioni dei pagamenti e riprova.",
  stripe_error: "Il pagamento non è andato a buon fine. Riprova tra poco.",
  ai_not_configured: "L'assistente intelligente non è ancora attivo: contatta l'assistenza.",
  pay_link_not_configured: "Il link di pagamento non è ancora configurato per questa struttura.",
  meta_not_configured: "WhatsApp non è ancora collegato: completa il collegamento dalle impostazioni.",
  webhook_not_configured: "Il collegamento non è ancora configurato: contatta l'assistenza.",
  stt_not_configured: "La trascrizione vocale non è ancora attiva.",
  // accesso e permessi
  unauthorized: SESSION,
  auth_failed: "Autenticazione non riuscita: controlla le credenziali oppure accedi di nuovo.",
  forbidden: PERMISSION,
  non_autorizzato: PERMISSION,
  not_owner: "Questa operazione è riservata al titolare dell'account.",
  solo_titolare: "Questa operazione è riservata al titolare dell'account.",
  not_member: PERMISSION,
  invalid_signature: "Firma non valida: riapri il link ricevuto.",
  bad_signature: "Firma non valida: riapri il link ricevuto.",
  // conflitti e limiti
  write_conflict: "Questi dati sono stati modificati nel frattempo da un'altra persona o da un altro dispositivo. Ricarica la pagina e riprova.",
  troppe_richieste: "Troppi tentativi ravvicinati. Attendi un minuto e riprova.",
  too_large: "Il file è troppo grande.",
  invalid_file: "Il file non è valido o non è di un formato supportato.",
  // dati mancanti / non trovati
  missing_structure: "Seleziona prima la struttura.",
  missing_params: MISSING,
  missing_fields: MISSING,
  bad_request: MISSING,
  bad_action: MISSING,
  malformed: MISSING,
  empty: MISSING,
  no_json: MISSING,
  invalid_email: "L'indirizzo email non è valido.",
  bad_dates: "Le date indicate non sono valide: controlla arrivo e partenza.",
  not_found: NOT_FOUND,
  booking_not_found: "Prenotazione non trovata: potrebbe essere stata eliminata. Ricarica la pagina.",
  structure_not_found: "Struttura non trovata. Ricarica la pagina e riprova.",
  order_not_found: NOT_FOUND,
  not_paid: "Il pagamento non risulta ancora completato.",
  // errori generici del server
  server_error: TEMPORARY,
  read_error: TEMPORARY,
  write_error: TEMPORARY,
  save_failed: "Salvataggio non riuscito. Riprova tra poco.",
  db_error: TEMPORARY,
  db_failed: TEMPORARY,
  fetch_failed: CONNECTION,
  send_failed: "Invio non riuscito. Riprova tra poco.",
  sync_failed: "Sincronizzazione non riuscita. Riprova tra poco.",
  refund_failed: "Non è stato possibile completare il rimborso: controlla su Stripe e riprova.",
};

// HTTP: http_403, http_404, ... (le nostre route lo usano per le risposte dei servizi esterni)
function httpMessage(status: number): string {
  if (status === 400) return MISSING;
  if (status === 401) return SESSION;
  if (status === 403) return PERMISSION;
  if (status === 404) return NOT_FOUND;
  if (status === 408 || status === 504) return "Il servizio ha impiegato troppo tempo a rispondere. Riprova tra poco.";
  if (status === 409) return CODES.write_conflict;
  if (status === 413) return CODES.too_large;
  if (status === 429) return CODES.troppe_richieste;
  if (status >= 500) return TEMPORARY;
  return GENERIC;
}

/** Codici SQLSTATE / PostgREST. */
const PG_CODES: Record<string, string> = {
  "23505": "Esiste già un elemento con gli stessi dati (duplicato).",
  "23503": "Questo elemento è collegato ad altri dati: non si può completare l'operazione.",
  "23502": "Manca un dato obbligatorio.",
  "23514": "Un valore inserito non è ammesso.",
  "22p02": "Un valore inserito non è nel formato corretto.",
  "22001": "Un testo inserito è troppo lungo.",
  "42501": "Non hai il permesso di salvare o leggere questo dato.",
  "57014": "Il server ha impiegato troppo tempo. Riprova tra poco.",
  "pgrst301": SESSION,
  "pgrst302": SESSION,
  "pgrst116": NOT_FOUND,
};

/** Testi tipici degli errori inglesi (browser, Supabase/PostgREST, Postgres): [espressione, frase]. Il primo che combacia vince. */
const PATTERNS: [RegExp, string][] = [
  [/already been registered|email_exists|user already registered/i, "Esiste già un accesso con questo indirizzo: entra con la tua email e password, oppure con Google."],
  [/weak and easy to guess|known to be weak|pwned|leaked password|weak_password/i, "Questa password è troppo comune o è già comparsa in violazioni di dati: scegline un'altra, più lunga e solo tua (lettere, numeri e un simbolo)."],
  [/failed to fetch|load failed|networkerror|network request failed|network error|fetch failed|err_internet|err_network|the internet connection appears to be offline|aborterror|the operation was aborted|econnreset|etimedout|socket hang up/i, CONNECTION],
  [/jwt expired|invalid jwt|jwt malformed|token (is )?expired|session (has )?expired|not authenticated|refresh token/i, SESSION],
  // "Invalid token" da solo NON è la nostra sessione: può essere il token di un provider esterno (es. Fatture in Cloud) → messaggio generico.
  [/not allowed to modify|issued document|document (is )?(already )?issued/i, "Il documento è già stato emesso e non si può più modificare."],
  [/duplicate key|unique constraint|already exists/i, PG_CODES["23505"]],
  [/row-level security|row level security|violates row-level|new row violates/i, PG_CODES["42501"]],
  [/permission denied|insufficient privilege/i, PERMISSION],
  [/invalid input syntax|invalid input value|malformed (uuid|array|json)|cannot cast|invalid (date|time|timestamp)/i, PG_CODES["22p02"]],
  [/foreign key constraint|violates foreign key/i, PG_CODES["23503"]],
  [/not-null constraint|null value in column/i, PG_CODES["23502"]],
  [/check constraint/i, PG_CODES["23514"]],
  [/value too long|too long for type/i, PG_CODES["22001"]],
  [/statement timeout|timed out|timeout|canceling statement/i, PG_CODES["57014"]],
  [/could not find the table|relation .* does not exist|schema cache|could not find the .* column|column .* does not exist|function .* does not exist/i, "Questa funzione non è ancora attiva per il tuo account: contatta l'assistenza."],
  [/json object requested, multiple \(or no\) rows|no rows returned|0 rows/i, NOT_FOUND],
  [/unexpected token|unexpected end of json|is not valid json|in json at position/i, "Risposta inattesa dal server. Riprova tra poco."],
  [/rate limit|too many requests/i, CODES.troppe_richieste],
  [/internal server error|bad gateway|service unavailable|gateway time-?out/i, TEMPORARY],
  [/not found/i, NOT_FOUND],
  [/unauthori[sz]ed|unauthenticated/i, SESSION],
  [/forbidden/i, PERMISSION],
];

/** Estrae il testo grezzo da Error, stringhe, risposte API ({error, message}) ed errori Supabase ({message, code, details}). */
function rawOf(e: unknown): { text: string; code: string } {
  if (e == null) return { text: "", code: "" };
  if (typeof e === "string") return { text: e, code: "" };
  if (e instanceof Error) {
    const c = (e as unknown as { code?: unknown }).code;
    return { text: e.message || "", code: typeof c === "string" ? c : "" };
  }
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    const pick = (...ks: string[]) => { for (const k of ks) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim(); return ""; };
    return { text: pick("message", "error_description", "error", "msg", "details"), code: pick("code", "error_code") };
  }
  return { text: String(e), code: "" };
}

/** Il testo sembra già una frase italiana scritta per le persone? (non un codice, non inglese tecnico) */
function looksHuman(text: string): boolean {
  const s = text.trim();
  if (/^(error|errore)[: ]*$/i.test(s)) return false;
  // parole tipiche degli errori tecnici inglesi; una frase italiana non le contiene
  if (/\b(the|failed|failure|invalid|violates|cannot|could not|unexpected|undefined|exception|constraint|syntax|denied|not found|not allowed|error|unable|already|expired|must|please|rejected|validation|request|status code)\b/i.test(s)) return false;
  if (!/\s/.test(s)) {
    // una sola parola: di norma è un codice (sdi_rejected, write_error), ma una parola italiana scritta per le persone
    // ("Annullato", "Rifiutato") passa: iniziale maiuscola, solo lettere, finale in vocale italiana.
    return /^[A-ZÀ-Ý][a-zà-ÿ]{3,}$/.test(s) && /[aeiouàèéìòù]$/.test(s);
  }
  return true;
}

/**
 * Frase in italiano per un errore qualunque. `fallback` è usato quando non si riconosce nulla (di default una frase generica).
 * Il dettaglio tecnico va in console.error solo se il messaggio è stato sostituito.
 */
export function friendlyError(e: unknown, fallback: string = GENERIC): string {
  const { text, code } = rawOf(e);
  const t = text.trim();
  const c = code.trim().toLowerCase();
  const key = t.toLowerCase();
  const log = (msg: string) => {
    if (typeof console !== "undefined" && msg !== t) console.error("[errore]", { messaggio: t, codice: code || undefined, originale: e });
    return msg;
  };

  if (c && PG_CODES[c]) return log(PG_CODES[c]);
  if (CODES[c]) return log(CODES[c]);
  if (!t) return log(fallback);
  if (CODES[key]) return log(CODES[key]);
  const http = /^http[_ ]?(\d{3})$/.exec(key) ?? /^(?:http\s*)?status\s*(\d{3})$/.exec(key);
  if (http) return log(httpMessage(Number(http[1])));
  for (const [re, msg] of PATTERNS) if (re.test(t)) return log(msg);
  if (looksHuman(t)) return t; // già una frase per le persone (es. i messaggi italiani delle nostre route)
  // codice sconosciuto (tutto minuscolo con trattini bassi) o inglese tecnico non riconosciuto
  return log(fallback);
}
