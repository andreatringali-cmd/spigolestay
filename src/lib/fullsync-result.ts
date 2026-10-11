// Esito di un "Full sync" verso Channex, in parole per l'utente. Logica pura (testabile).
export interface FullSyncEsito { ok: boolean; message: string }
export interface FullSyncDettaglio { availOk: boolean; restrOk: boolean; availError?: string; restrError?: string; error?: string }

/** Evento emesso da ChannexAutoSync quando termina un invio completo (detail: { sid } & FullSyncDettaglio). */
export const FULLSYNC_RESULT_EVENT = "spigolestay:channex-fullsync-result";
/** Attesa massima dell'esito: 4 s di debounce + invio dei 500 giorni. Oltre, si dice che non è stato confermato. */
export const FULLSYNC_TIMEOUT_MS = 60000;

export function esitoFullSync(d: FullSyncDettaglio): FullSyncEsito {
  if (d.availOk && d.restrOk) return { ok: true, message: "Full sync completato: disponibilità e restrizioni/prezzi accettate da Channex." };
  const parti: string[] = [];
  if (!d.availOk) parti.push(`disponibilità non accettata${d.availError ? ` (${d.availError})` : ""}`);
  if (!d.restrOk) parti.push(`restrizioni/prezzi non accettati${d.restrError ? ` (${d.restrError})` : ""}`);
  if (d.error) parti.push(d.error);
  return { ok: false, message: `Full sync non riuscito: ${parti.join("; ")}. Si riproverà al prossimo aggiornamento.` };
}

export const ESITO_NON_CONFERMATO: FullSyncEsito = { ok: false, message: "Invio avviato ma non confermato: controlla lo stato in Canali (nessuna risposta da Channex entro un minuto, oppure nulla da inviare)." };
