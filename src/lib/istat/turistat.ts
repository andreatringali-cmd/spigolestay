// Connettore reale Osservatorio Turistico Regione Siciliana (Turist@t) — SCHELETRO.
// Documentazione: "Sistema Informativo Osservatorio Turistico — Protocollo PMS" (Regione Siciliana),
// scaricabile dalla sezione Documenti di https://osservatorioturistico.regione.sicilia.it
// Attivazione: account USER PMS (uno per struttura) richiesto a servizioturistico.ct@certmail.regione.sicilia.it.
//
// NB: l'endpoint e il tracciato ESATTI dei campi arrivano col documento tecnico fornito insieme
// all'account USER PMS. Finché non li abbiamo, questa funzione resta gated (ISTAT_LIVE) e, se manca
// la configurazione, lancia un errore chiaro invece di inviare dati potenzialmente errati.

export interface TuristatCreds { username?: string; password?: string }
export interface DailyGuest { permanenza: number; camera?: string; eta?: number; sesso?: "M" | "F"; cittadinanza?: string; luogoNascita?: string; luogoResidenza?: string }
export interface DailyMovement {
  day: string;            // YYYY-MM-DD (giornata dichiarata)
  arrivati: number;
  partiti: number;
  presenti: number;
  camereOccupate: number;
  camereTotali: number;
  ospiti: DailyGuest[];   // dettaglio movimento (anonimo) del giorno
}

// Invia la chiusura giornaliera al portale regionale.
// Ritorna { ok, message, ricevuta? }. Lancia se l'integrazione non è ancora configurata.
export async function sendDaily(creds: TuristatCreds, movement: DailyMovement): Promise<{ ok: boolean; message: string; ricevuta?: string }> {
  const endpoint = process.env.ISTAT_ENDPOINT; // es. https://osservatorioturistico.regione.sicilia.it/api/pms/...
  if (!endpoint) throw new Error("Endpoint Turist@t non configurato (ISTAT_ENDPOINT). Serve il tracciato del Protocollo PMS della Regione.");
  if (!creds.username || !creds.password) throw new Error("Credenziali USER PMS mancanti.");

  // TODO(istat-live): mappare 'movement' sul tracciato ufficiale del Protocollo PMS (campi/formato)
  // e usare il metodo/auth previsti. Placeholder REST HTTPS in attesa del documento tecnico:
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}` },
    body: JSON.stringify(movement),
  });
  const txt = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, message: `Portale Turist@t: HTTP ${res.status} ${txt.slice(0, 200)}` };
  // La ricevuta/identificativo va estratta dalla risposta secondo il tracciato reale.
  return { ok: true, message: "Movimento inviato al portale Turist@t.", ricevuta: undefined };
}
