import test from "node:test";
import assert from "node:assert/strict";
import { friendlyError } from "../src/lib/friendly-error.ts";

// I test non devono sporcare l'output con i console.error di dettaglio tecnico.
const origErr = console.error;
test.before(() => { console.error = () => {}; });
test.after(() => { console.error = origErr; });

const RAW = /supabase_not_configured|write_conflict|troppe_richieste|stripe_not_connected|http_\d|auth_failed|not_configured|Failed to fetch|Load failed|duplicate key|row-level|JWT|invalid input syntax/i;

test("codici delle route API → frasi italiane, mai il codice grezzo", () => {
  for (const code of ["supabase_not_configured", "write_conflict", "troppe_richieste", "stripe_not_connected", "http_403", "http_404", "http_500", "auth_failed", "not_configured", "server_error", "unauthorized", "forbidden", "missing_params", "stripe_error"]) {
    const m = friendlyError(new Error(code));
    assert.ok(m.length > 20 && !RAW.test(m) && /[a-zàèéìòù]/.test(m) && m.endsWith("."), `${code} → ${m}`);
  }
  assert.match(friendlyError("write_conflict"), /modificat/);
  assert.match(friendlyError("troppe_richieste"), /Troppi tentativi/);
  assert.match(friendlyError("http_403"), /permesso/);
  assert.match(friendlyError("http_404"), /Non trovo/);
  assert.match(friendlyError("http_503"), /problema temporaneo/);
  assert.match(friendlyError("stripe_not_connected"), /Stripe/);
});

test("errori di rete del browser", () => {
  for (const m of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "network request failed"]) {
    assert.match(friendlyError(new TypeError(m)), /Connessione assente o instabile/, m);
  }
});

test("errori Supabase / PostgREST (anche come oggetto, non solo Error)", () => {
  assert.match(friendlyError({ message: 'duplicate key value violates unique constraint "documents_pkey"', code: "23505" }), /duplicato/);
  assert.match(friendlyError({ message: 'new row violates row-level security policy for table "documents"' }), /permesso/);
  assert.match(friendlyError({ message: 'invalid input syntax for type uuid: "abc"', code: "22P02" }), /formato corretto/);
  assert.match(friendlyError({ message: "JWT expired", code: "PGRST301" }), /sessione è scaduta/);
  assert.match(friendlyError({ message: "foreign key", code: "23503" }), /collegato/);
  assert.match(friendlyError({ message: "null value in column \"x\" violates not-null constraint" }), /obbligatorio/);
  assert.match(friendlyError({ message: "Could not find the table 'public.foo' in the schema cache" }), /non è ancora attiva/);
});

test("un messaggio già italiano per le persone passa invariato", () => {
  assert.equal(friendlyError(new Error("Devi essere connesso")), "Devi essere connesso");
  assert.equal(friendlyError("Prezzo mancante: imposta l'importo del soggiorno."), "Prezzo mancante: imposta l'importo del soggiorno.");
});

test("codici sconosciuti e inglese tecnico → frase generica o il ripiego indicato; nessun codice a schermo", () => {
  assert.match(friendlyError("some_weird_code"), /Operazione non riuscita/);
  assert.equal(friendlyError("some_weird_code", "Errore sconosciuto"), "Errore sconosciuto");
  assert.equal(friendlyError(undefined, "—"), "—");
  assert.match(friendlyError(new Error("Unexpected failure in the handler")), /Operazione non riuscita/);
  assert.equal(friendlyError({ error: "write_conflict", message: "" }).includes("write_conflict"), false);
});

test("il dettaglio tecnico va in console.error solo quando il messaggio viene sostituito", () => {
  const calls: unknown[][] = [];
  console.error = (...a: unknown[]) => { calls.push(a); };
  friendlyError("Failed to fetch");
  assert.equal(calls.length, 1);
  friendlyError("Devi essere connesso");
  assert.equal(calls.length, 1);
  console.error = () => {};
});

test("errori di provider esterni: non diventano frasi fuorvianti", () => {
  // "Invalid token" può essere il token di Fatture in Cloud, non la sessione dell'utente
  assert.doesNotMatch(friendlyError("Invalid token"), /sessione/);
  assert.match(friendlyError("Invalid token"), /Operazione non riuscita/);
  // "Not allowed to modify issued document" non è un problema di permessi dell'utente
  assert.doesNotMatch(friendlyError("Not allowed to modify issued document"), /Non hai il permesso/);
  assert.match(friendlyError("Not allowed to modify issued document"), /già stato emesso/);
  assert.match(friendlyError("Validation failed: vat_number is invalid"), /Operazione non riuscita/);
  assert.match(friendlyError("Request failed with status code 422"), /Operazione non riuscita/);
  assert.match(friendlyError("sdi_rejected"), /Operazione non riuscita/);
  // JWT scaduto resta "sessione scaduta"
  assert.match(friendlyError("JWT expired"), /sessione è scaduta/);
  assert.match(friendlyError("invalid JWT: unable to parse"), /sessione è scaduta/);
});

test("messaggi italiani di una parola passano; i codici no", () => {
  assert.equal(friendlyError(new Error("Annullato")), "Annullato");
  assert.equal(friendlyError("Rifiutato"), "Rifiutato");
  assert.match(friendlyError("write_error"), /problema temporaneo/);
  assert.match(friendlyError("sdi_rejected"), /Operazione non riuscita/);
  assert.match(friendlyError("Error"), /Operazione non riuscita/);
});
