// Regole PURE di fusione usate dalla sincronizzazione (src/lib/authsync.tsx). Nessun accesso a storage o rete: testabili da sole.
type Snap = Record<string, string>;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Chiavi PIATTE (stringhe JSON salvate per intero): regola a 3 vie al posto di "vince sempre il locale".
 *  - locale identico alla base e server cambiato rispetto alla base: questo dispositivo non ha toccato la chiave, quindi si adotta il valore del server
 *    (prima un dispositivo con dati vecchi riscriveva sul server impostazioni, utenti, piano, modelli… già aggiornati altrove);
 *  - locale diverso dalla base: vince il locale (modifica fatta qui), come prima;
 *  - base vuota o senza la chiave (prima idratazione): niente cambia, vince il locale.
 * `skip` esclude le chiavi che hanno già una regola propria (blob dati, Pulizie, chat, preventivi, foto, liste Cassa…) o che sono per-dispositivo.
 * Ritorna una copia di `merged` con le sole chiavi adottate dal server sostituite.
 */
export function adoptServerFlatKeys(
  merged: Snap,
  local: Snap,
  server: Snap | null | undefined,
  base: Snap | null | undefined,
  skip: (key: string) => boolean,
): Snap {
  if (!server || !base) return merged;
  let out = merged;
  for (const k of Object.keys(local)) {
    if (skip(k)) continue;
    const l = local[k], s = server[k], b = base[k];
    if (s === undefined || b === undefined) continue;       // senza server o senza base: resta la regola di prima
    if (l === b && s !== b) { if (out === merged) out = { ...merged }; out[k] = s; }
  }
  return out;
}

/**
 * Mappa chiave→valore (es. i prezzi forzati per giorno `rateOverrides`, "roomTypeId|AAAA-MM-GG" → prezzo) fusa chiave per chiave a 3 vie:
 *  - chiave non toccata qui (uguale alla base, anche se assente da entrambe): si adotta il server (valore nuovo, cambiato o rimosso altrove);
 *  - chiave toccata qui (aggiunta, cambiata o tolta): vince il locale;
 *  - base vuota: il locale vince sulle chiavi in comune e il server aggiunge le sue (come l'unione di prima).
 * Così una mappa vuota o vecchia (es. socio appena invitato) non cancella i prezzi già sul server.
 */
export function mergeRecord3(baseVal: unknown, localVal: unknown, serverVal: unknown): Record<string, unknown> {
  const base = isObj(baseVal) ? baseVal : {};
  const local = isObj(localVal) ? localVal : {};
  const server = isObj(serverVal) ? serverVal : {};
  const same = (a: unknown, b: unknown) => a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(server)])) {
    const untouchedHere = same(local[k], base[k]);
    const v = untouchedHere ? server[k] : local[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * ANTI-RACE della sincronizzazione. `snap` = fotografia presa PRIMA della rete, `fresh` = localStorage riletto a risultato pronto,
 * `result` = stato fuso da applicare al browser. Ciò che l'utente ha cambiato nel frattempo non deve essere cancellato dal ripristino:
 *  - chiavi piatte cambiate (o tolte) durante il ciclo: si tiene la versione fresca;
 *  - blocco dati (`dataKey`) cambiato durante il ciclo: NON si sovrascrive col risultato calcolato sulla vecchia fotografia, ma si rifonde
 *    la versione fresca (locale) col risultato del server usando la fotografia come base: la modifica appena fatta resta, le novità del server
 *    non si perdono (se si saltasse soltanto il ripristino, la base conterrebbe voci assenti dal locale e al ciclo dopo verrebbero cancellate dal server).
 * `mergeData(local, server, base)` è la fusione del blocco dati (la stessa usata da mergeSnapshots). Modifica e ritorna `result`.
 */
export function applyRaceChanges(
  snap: Snap,
  fresh: Snap,
  result: Snap,
  dataKey: string,
  mergeData: (local: string, server: string, base: string) => string,
): Snap {
  for (const k of Object.keys(fresh)) {
    if (k === dataKey) continue;
    if (fresh[k] !== snap[k]) result[k] = fresh[k];
  }
  for (const k of Object.keys(snap)) {
    if (k === dataKey) continue;
    if (!(k in fresh) && k in result) delete result[k];
  }
  const fd = fresh[dataKey], sd = snap[dataKey];
  if (fd !== undefined && fd !== sd) {
    const rd = result[dataKey];
    if (rd === undefined) result[dataKey] = fd;
    else if (rd !== fd) {
      try { result[dataKey] = mergeData(fd, rd, sd ?? ""); } catch { /* fusione impossibile: resta il risultato del server (la modifica fresca verrà ripresa al ciclo dopo se ancora nel locale) */ }
    }
  }
  return result;
}
