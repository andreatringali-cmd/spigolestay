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

const idOfItem = (it: unknown): string | null => {
  if (it && typeof it === "object") { const id = (it as { id?: unknown }).id; if (id !== undefined && id !== null && id !== "") return String(id); }
  return null;
};

/**
 * PREVENTIVI (array piatto con "id", senza updatedAt). Parte dall'array locale (una cancellazione locale resta valida) e:
 *  - lo stato "confermato" scritto dal server (pagamento Stripe) vince sul locale "inviato";
 *  - i preventivi presenti SOLO sul server si aggiungono se non erano già nella base (creati altrove); se erano nella base e ora non sono
 *    nel locale, sono stati cancellati qui e non si reintroducono. Voci del server senza id: ignorate. Base assente (prima idratazione): si aggiungono tutte.
 * Ritorna null se il locale non è un array valido.
 */
export function mergePreventivi3(baseRaw: string | undefined, localRaw: string | undefined, serverRaw: string | undefined): string | null {
  let local: unknown[];
  let server: unknown[];
  let base: unknown[] = [];
  try { const p = JSON.parse(localRaw ?? "[]"); if (!Array.isArray(p)) return null; local = p; } catch { return null; }
  try { const p = JSON.parse(serverRaw ?? "[]"); server = Array.isArray(p) ? p : []; } catch { server = []; }
  try { const p = JSON.parse(baseRaw ?? "[]"); base = Array.isArray(p) ? p : []; } catch { base = []; }
  const serverById = new Map<string, { status?: unknown; bookingId?: unknown }>();
  for (const it of server) { const id = idOfItem(it); if (id) serverById.set(id, it as { status?: unknown; bookingId?: unknown }); }
  const baseIds = new Set<string>();
  for (const it of base) { const id = idOfItem(it); if (id) baseIds.add(id); }
  const localIds = new Set<string>();
  const out: unknown[] = local.map((it) => {
    const id = idOfItem(it);
    if (id) localIds.add(id);
    const s = id ? serverById.get(id) : undefined;
    if (s && s.status === "confermato" && (it as { status?: unknown })?.status !== "confermato") {
      return { ...(it as Record<string, unknown>), status: s.status, bookingId: s.bookingId };
    }
    return it;
  });
  for (const it of server) {
    const id = idOfItem(it);
    if (!id || localIds.has(id) || baseIds.has(id)) continue;
    out.push(it);
  }
  return JSON.stringify(out);
}

/**
 * Mappe JSON salvate per intero (es. segni di Pulizie "unitId:data" → ISO): fusione per chiave a 3 vie con mergeRecord3.
 * Ritorna null se locale e server sono entrambi assenti.
 */
export function mergeRecordJson(baseRaw: string | undefined, localRaw: string | undefined, serverRaw: string | undefined): string | null {
  if (localRaw === undefined && serverRaw === undefined) return null;
  let bad = false;
  const parse = (r: string | undefined): unknown => {
    if (!r) return {};
    try { const v = JSON.parse(r); if (isObj(v)) return v; } catch { /* non valido */ }
    bad = true; return {};
  };
  const b = parse(baseRaw), l = parse(localRaw), s = parse(serverRaw);
  if (bad) return null; // contenuto non valido: resta la regola di prima, non si rischia di svuotare la mappa
  return JSON.stringify(mergeRecord3(b, l, s));
}

/** Utenti senza i campi puramente informativi che cambiano a ogni accesso (lastLogin, sessions): servono per la firma di "ricarica la pagina". */
export function stripVolatileUsers(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v.map((u) => {
    if (!u || typeof u !== "object" || Array.isArray(u)) return u;
    const { lastLogin: _l, sessions: _s, ...rest } = u as Record<string, unknown>;
    void _l; void _s;
    return rest;
  });
}

/**
 * REGISTRO INVII (`spigolestay:msgsent`, array di { key, guest, tpl, via, ts } con la più recente per prima). Lo scrive anche il cron dei messaggi automatici
 * (auto-trace.ts) direttamente sul server: se il browser ha aggiunto una voce nel frattempo, vincere "il locale" in blocco faceva sparire quella del cron e la riga
 * tornava «da inviare» (doppio invio all'ospite). Unione per `key`: parte dal locale (una voce tolta qui, ad es. «Pulisci», resta tolta) e aggiunge le voci
 * presenti SOLO sul server se non erano già nella base. Più recenti prima, tetto 200 come la sorgente. Ritorna null se il locale non è un array valido.
 */
export function mergeSentLog(baseRaw: string | undefined, localRaw: string | undefined, serverRaw: string | undefined): string | null {
  const parse = (r: string | undefined): unknown[] | null => { try { const p = JSON.parse(r ?? "[]"); return Array.isArray(p) ? p : null; } catch { return null; } };
  const local = parse(localRaw);
  if (!local) return null;
  const server = parse(serverRaw) ?? [];
  const base = parse(baseRaw) ?? [];
  const keyOf = (e: unknown): string | null => { const k = e && typeof e === "object" ? (e as { key?: unknown }).key : undefined; return typeof k === "string" && k ? k : null; };
  const tsOf = (e: unknown) => { const t = (e as { ts?: unknown } | null)?.ts; return typeof t === "number" && isFinite(t) ? t : 0; };
  const baseKeys = new Set<string>();
  for (const e of base) { const k = keyOf(e); if (k) baseKeys.add(k); }
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const e of local) { const k = keyOf(e); if (k) { if (seen.has(k)) continue; seen.add(k); } out.push(e); }
  for (const e of server) { const k = keyOf(e); if (!k || seen.has(k) || baseKeys.has(k)) continue; seen.add(k); out.push(e); }
  out.sort((a, b) => tsOf(b) - tsOf(a));
  return JSON.stringify(out.slice(0, 200));
}
