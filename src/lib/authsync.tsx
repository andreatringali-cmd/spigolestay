"use client";

// Autenticazione reale (Supabase) + sincronizzazione dello stato dell'account sul server.
//
// Strategia "rapida": tutto ciò che l'app salva nel browser (chiavi localStorage con prefisso
// spigolestay: / xenora:) viene rispecchiato come un unico blocco JSON nella tabella `app_state`,
// una riga per utente. Al login si scarica il blocco dal server e si reidrata il browser; ad ogni
// modifica (ogni pochi secondi, se qualcosa è cambiato) si ricarica sul server. Nessuna pagina
// esistente va riscritta: continuano a leggere/scrivere localStorage come prima.
//
// SICUREZZA DATI (anti-perdita), a più livelli:
//  1) Database: un trigger rifiuta qualsiasi scrittura che azzererebbe dati reali (mai un wipe).
//  2) Fusione a 3 vie: prima di salvare, lo stato locale viene FUSO con quello sul server
//     (unione di strutture/camere/prenotazioni/ospiti per id), usando l'ultimo stato sincronizzato
//     come "base" per capire cosa è stato davvero aggiunto/cancellato qui. Una copia vecchia non
//     può quindi cancellare le prenotazioni di una più nuova: nel dubbio, i dati si sommano.
//  3) Lucchetto di versione (rev): si scrive solo se sul server c'è ancora la versione che avevamo
//     letto; altrimenti si rilegge e si rifonde al ciclo successivo (niente sovrascritture cieche).

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { initBigStore, kvGet, kvSet, kvRemove, kvKeys, kvFlush, kvVersion } from "./bigstore";
import { useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseEnabled } from "./supabase";
import MfaChallenge from "@/components/MfaChallenge";

// Prefissi delle chiavi che rappresentano lo stato dell'account (da sincronizzare).
const SYNC_PREFIXES = ["spigolestay:", "xenora:"];
// Chiavi legate al singolo dispositivo/sessione: NON vanno sincronizzate.
const SKIP_KEYS = new Set<string>([
  "spigolestay:loginlogged",  // marcatore "accesso già loggato" per sessione tab
  "spigolestay:hydrated-for", // marcatore interno di reidratazione
  "spigolestay:channex-arisnapshot", // cache per-dispositivo dell'ultimo ARI inviato (centinaia di KB): non si sincronizza, vive in sessionStorage
]);
// Pulizia una tantum: la vecchia copia nel localStorage occupava ~400 KB di una quota di ~5 MB.
if (typeof window !== "undefined") { try { localStorage.removeItem("spigolestay:channex-arisnapshot"); } catch { /* storage non disponibile */ } }

const MAX_TOMBS = 3000;

function isSyncKey(k: string): boolean {
  if (SKIP_KEYS.has(k)) return false;
  return SYNC_PREFIXES.some((p) => k.startsWith(p));
}

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const k of kvKeys()) if (isSyncKey(k)) out[k] = kvGet(k) ?? "";
  } catch {}
  return out;
}

// Ritorna false se il browser non ha spazio per scrivere tutto (quota ~5 MB): in quel caso NON si cancella nulla,
// così restano i dati vecchi invece di un archivio a metà.
function restore(data: Record<string, string>): boolean {
  let ok = true;
  try {
    // Prima si scrivono le chiavi arrivate dal server…
    for (const [k, v] of Object.entries(data)) {
      if (!isSyncKey(k)) continue;
      try { kvSet(k, v); } catch { ok = false; }
    }
    // …e solo se è andato tutto bene si tolgono quelle che non esistono più.
    if (ok) {
      kvKeys().filter((k) => isSyncKey(k) && !(k in data)).forEach((k) => kvRemove(k));
    }
  } catch { ok = false; }
  if (!ok) { try { window.dispatchEvent(new Event("xenora:storage-full")); } catch { /* ambiente senza window */ } }
  return ok;
}

function wipeLocalAccount() {
  try {
    kvKeys().filter(isSyncKey).forEach((k) => kvRemove(k));
    sessionStorage.removeItem("spigolestay:loginlogged");
  } catch {}
}

// A chi appartengono i dati ora salvati in locale (uid). Senza questo, un dispositivo/browser
// riusato da un account DIVERSO (demo, test, PC condiviso) con il server ancora vuoto per il
// nuovo account faceva "vincere il locale" e copiava sul server del nuovo utente i dati del
// precedente — un vero incidente di sicurezza/isolamento dati, non solo un fastidio nei test.
const LOCAL_OWNER_KEY = "spigolestay:localowner";
function markLocalOwner(uid: string) { try { localStorage.setItem(LOCAL_OWNER_KEY, uid); } catch {} }
// Ci si fida del locale SOLO con conferma positiva che è di questo uid — non il contrario
// ("sospetto solo se so che è di un altro"). Un dispositivo già contaminato PRIMA che questo
// controllo esistesse non ha ancora nessun marcatore: deve comunque essere trattato come
// estraneo, non come "non so, quindi va bene". Si autocorregge dal primo accesso in poi.
function localBelongsToOther(uid: string): boolean {
  try { return localStorage.getItem(LOCAL_OWNER_KEY) !== uid; } catch { return true; }
}

// Ricarica la pagina in modo SICURO: applica gli aggiornamenti scaricati dal server
// (rimettendo in sync l'app in memoria con il localStorage appena aggiornato) SENZA poter
// entrare in un loop di refresh. Guardia anti-loop a FINESTRA MOBILE: se ci sono stati
// troppi reload negli ultimi 60s (segno di firma instabile) ci si ferma e si aggiorna in
// silenzio; altrimenti si ricarica normalmente — così gli aggiornamenti legittimi e distanziati
// (es. il socio aggiunge prenotazioni durante la giornata) continuano a comparire.
function safeReload(): boolean {
  try {
    const now = Date.now();
    let times: number[] = [];
    try { times = JSON.parse(sessionStorage.getItem("xn-reloads") || "[]"); } catch { times = []; }
    times = (Array.isArray(times) ? times : []).filter((t) => typeof t === "number" && now - t < 60000);
    if (times.length >= 5) return false; // >5 reload in 60s = loop: stop (aggiornamento silenzioso)
    times.push(now);
    sessionStorage.setItem("xn-reloads", JSON.stringify(times));
  } catch { /* sessionStorage non disponibile: evita comunque il reload */ return false; }
  // Prima di ricaricare si aspetta che i dati grandi siano stati scritti su IndexedDB (scrittura differita).
  try { void kvFlush().then(() => { try { window.location.reload(); } catch { /* ambiente senza window */ } }); return true; } catch { return false; }
}

// Uno stato contiene DATI REALI se ha almeno una struttura/prenotazione/ospite.
function hasRealData(obj: Record<string, string> | null | undefined): boolean {
  try {
    const raw = obj?.["spigolestay:data:v1"];
    if (!raw) return false;
    const d = JSON.parse(raw);
    return (Array.isArray(d.structures) && d.structures.length > 0)
      || (Array.isArray(d.bookings) && d.bookings.length > 0)
      || (Array.isArray(d.guests) && d.guests.length > 0);
  } catch { return false; }
}

// Serializzazione canonica (chiavi ordinate) per confrontare due stati per CONTENUTO e non per
// come sono scritti: due JSON con le stesse informazioni ma chiavi in ordine diverso risultano uguali.
// Serve per evitare reload/riscritture inutili quando l'app salva lo stesso contenuto in altro ordine.
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}
// Preferenze SOLO di vista/dispositivo: non guidano scritture/reload né si sincronizzano tra
// dispositivi (ognuno tiene la propria vista). TUTTO il resto è dato d'account e va salvato.
const SIG_SKIP = new Set<string>([
  "spigolestay:activestruct", "spigolestay:calview:v2", "spigolestay:piani:view",
  "spigolestay:camere:collapsed:v1", "spigolestay:activityseen",
  // Preferenze "quali grafici/viste mostrare": per-dispositivo, non devono sincronizzarsi.
  "spigolestay:prenchart:v2", "spigolestay:prenchartorder", "spigolestay:camere:aperte:v2",
  "spigolestay:dashcharts:v6", "spigolestay:statscharts:on", "spigolestay:cassacharts:on",
]);
// Firma "per contenuto" di TUTTO lo stato d'account (tutte le chiavi sincronizzabili, non solo
// alcune): così QUALSIASI modifica (PEC, codice fiscale, pagamenti, disponibilità, impostazioni…)
// viene rilevata e quindi salvata sul server, e non più persa al ricaricamento.
function contentSig(obj: Record<string, string> | null | undefined): string {
  if (!obj) return "";
  const keys = Object.keys(obj).filter((k) => isSyncKey(k) && !SIG_SKIP.has(k)).sort();
  return keys.map((k) => {
    const raw = obj[k];
    if (raw == null || raw === "") return `${k}=`;
    try { return `${k}=${stableStringify(JSON.parse(raw))}`; } catch { return `${k}=${raw}`; }
  }).join(" ");
}

// Collezioni "entità" dove perdere un elemento = perdere dati reali dell'utente.
// (roomTypes incluso così tariffe/piani si fondono per id invece di sovrascriversi in blocco.)
// directReviews incluso così le recensioni dirette (aggiunte dal server via /api/public-review
// e le risposte del gestore) si fondono per id invece di sovrascriversi in blocco.
// events incluso così la cancellazione di un evento è tombstonata e rispettata dalla fusione:
// senza, l'array eventi si sovrascriveva in blocco e un evento eliminato poteva "risorgere".
const ENTITY_COLLECTIONS = ["structures", "roomTypes", "units", "bookings", "guests", "directReviews", "events"];

// Chiavi "piatte" (fuori dal blob dati:v1) che contengono ARRAY di entità con id + updatedAt:
// scorte, ordini e segnalazioni delle Pulizie. Vanno FUSE per elemento (last-write-wins per id),
// NON con il "vince il locale" in blocco: senza, un secondo dispositivo/scheda con una copia
// STANTÌA dell'array (es. il telefono resta aperto mentre segni sul desktop, o la signora delle
// pulizie) sovrascriveva sul server le modifiche appena fatte altrove — è la causa per cui lo
// stato "Disponibile" dei prodotti "tornava indietro". Le cancellazioni sono soft-delete
// (_deleted:true con updatedAt più recente) così non risorgono.
const FLAT_ENTITY_KEYS = ["spigolestay:pulizie:stock", "spigolestay:pulizie:orders", "spigolestay:pulizie:issues"];
const THREADS_KEY = "spigolestay:threads:v1";
// Preventivi (array piatto, id ma senza updatedAt): vedi mergePreventivi più sotto. Scritta anche dal
// server (conferma dopo pagamento Stripe, src/app/api/stripe/quote/confirm/route.ts).
const PREVENTIVI_KEY = "spigolestay:preventivi";

type WithId = { id?: unknown };
function idOf(it: unknown): string | null {
  if (it && typeof it === "object") {
    const id = (it as WithId).id;
    if (id !== undefined && id !== null && id !== "") return String(id);
  }
  return null;
}

// Timbro di ultima-modifica di un'entità (epoch ms). Assente = 0 (mai timbrata).
function tsOf(it: unknown): number {
  const t = (it as { updatedAt?: unknown })?.updatedAt;
  return typeof t === "number" && isFinite(t) ? t : 0;
}

// Fusione per-elemento (id + updatedAt LAST-WRITE-WINS) di un array salvato in una chiave piatta
// (scorte/ordini/segnalazioni Pulizie). Unione per id: se lo stesso id è in locale e sul server
// vince quello con updatedAt più recente (a parità, il locale); i soft-delete (_deleted:true)
// partecipano come qualsiasi altro elemento, quindi una cancellazione recente vince e non risorge.
function mergeFlatEntityArray(localRaw: string | undefined, serverRaw: string | undefined): string | null {
  let local: unknown[];
  let server: unknown[];
  try { const p = JSON.parse(localRaw ?? "[]"); if (!Array.isArray(p)) return null; local = p; } catch { return null; }
  try { const p = JSON.parse(serverRaw ?? "[]"); server = Array.isArray(p) ? p : []; } catch { server = []; }
  const byId = new Map<string, unknown>();
  const put = (it: unknown) => {
    const id = idOf(it);
    const key = id ?? `#${JSON.stringify(it)}`; // elementi senza id: identità per contenuto
    const cur = byId.get(key);
    if (cur === undefined || tsOf(it) >= tsOf(cur)) byId.set(key, it); // >= : a parità vince il locale
  };
  for (const it of server) put(it); // prima il server…
  for (const it of local) put(it);  // …poi il locale (vince a parità di timbro)
  // Ordine deterministico per id: evita riscritture/loop inutili quando il contenuto è identico.
  const out = [...byId.values()].sort((a, b) => { const ia = idOf(a) ?? "", ib = idOf(b) ?? ""; return ia < ib ? -1 : ia > ib ? 1 : 0; });
  return JSON.stringify(out);
}

// Fusione delle conversazioni WhatsApp/chat (Record<guestId, Msg[]>): unione per id dentro ogni
// thread, MAI "vince il locale" in blocco. Senza, un messaggio in arrivo appena salvato dal
// webhook (/api/whatsapp/webhook) veniva cancellato pochi istanti dopo dal primo salvataggio
// automatico della pagina Messaggi aperta nel browser, che non sa nulla del nuovo arrivo e
// risalva la sua copia più vecchia sopra. I messaggi sono immutabili (mai modificati dopo la
// creazione), quindi basta l'unione per id, ordinata per data.
function mergeThreads(localRaw: string | undefined, serverRaw: string | undefined): string | null {
  let local: Record<string, unknown[]>;
  let server: Record<string, unknown[]>;
  try { const p = JSON.parse(localRaw ?? "{}"); if (!p || typeof p !== "object" || Array.isArray(p)) return null; local = p as Record<string, unknown[]>; } catch { return null; }
  try { const p = JSON.parse(serverRaw ?? "{}"); server = (p && typeof p === "object" && !Array.isArray(p)) ? (p as Record<string, unknown[]>) : {}; } catch { server = {}; }
  const out: Record<string, unknown[]> = {};
  for (const key of new Set([...Object.keys(server), ...Object.keys(local)])) {
    const byId = new Map<string, unknown>();
    // Stesso messaggio su entrambi i lati: si tiene lo stato di consegna più avanzato (inviato <
    // consegnato < letto), scritto dal webhook di WhatsApp; la copia locale senza stato non lo cancella.
    const RANK: Record<string, number> = { sent: 1, failed: 1.5, delivered: 2, read: 3 };
    const put = (m: unknown) => {
      const id = idOf(m); const k = id ?? `#${JSON.stringify(m)}`;
      const cur = byId.get(k) as { st?: string; wid?: string } | undefined;
      if (!cur) { byId.set(k, m); return; }
      const nx = m as { st?: string; wid?: string };
      const st = (RANK[nx.st ?? ""] ?? 0) >= (RANK[cur.st ?? ""] ?? 0) ? nx.st : cur.st;
      byId.set(k, { ...cur, ...(m as object), ...(st ? { st } : {}), ...((nx.wid ?? cur.wid) ? { wid: nx.wid ?? cur.wid } : {}) });
    };
    for (const m of (Array.isArray(server[key]) ? server[key] : [])) put(m);
    for (const m of (Array.isArray(local[key]) ? local[key] : [])) put(m);
    const tsOfMsg = (m: unknown) => { const t = (m as { ts?: unknown })?.ts; return typeof t === "number" && isFinite(t) ? t : 0; };
    out[key] = [...byId.values()].sort((a, b) => tsOfMsg(a) - tsOfMsg(b));
  }
  return JSON.stringify(out);
}

// Fusione del REGISTRO ATTIVITÀ (campo "activities" dentro spigolestay:data:v1): unione per id,
// MAI "vince il locale" in blocco. L'import prenotazioni Channex (lato server, vedi pushActivity in
// src/lib/channex-inbound.ts) aggiunge voci al registro scrivendo DIRETTAMENTE su app_state/org_state;
// "activities" non è tra le ENTITY_COLLECTIONS fuse per id, quindi senza questa unione la voce appena
// aggiunta dal server spariva al primo autosalvataggio di un browser con la copia locale ancora senza
// quella voce — stesso bug architetturale di mergeThreads, qui su un campo del blob dati invece che su
// una chiave separata. Le attività sono immutabili (mai modificate dopo la creazione): basta l'unione
// per id, più recenti prima (stesso ordine con cui vengono inserite), tetto a 500 come la sorgente.
function mergeActivities(localVal: unknown, serverVal: unknown): unknown[] {
  const local = Array.isArray(localVal) ? localVal : [];
  const server = Array.isArray(serverVal) ? serverVal : [];
  const byId = new Map<string, unknown>();
  const put = (it: unknown) => { const id = idOf(it); byId.set(id ?? `#${JSON.stringify(it)}`, it); };
  for (const it of server) put(it);
  for (const it of local) put(it);
  const tsOfAct = (it: unknown) => { const t = (it as { ts?: unknown })?.ts; return typeof t === "number" && isFinite(t) ? t : 0; };
  return [...byId.values()].sort((a, b) => tsOfAct(b) - tsOfAct(a)).slice(0, 500);
}

// Fusione dei PREVENTIVI (spigolestay:preventivi, array piatto con "id" ma SENZA "updatedAt"): parte
// SEMPRE dall'array locale (stessa semantica di prima: una cancellazione locale resta valida, non la
// si reintroduce), ma se il server ha marcato un preventivo "confermato" — scritto DIRETTAMENTE dal
// server dopo un pagamento Stripe riuscito, vedi src/app/api/stripe/quote/confirm/route.ts — quello
// stato vince sempre sul locale "inviato": senza, una scheda Preventivi aperta in un altro tab con la
// copia ancora "inviato" lo risalvava sopra al sync successivo, cancellando silenziosamente la
// conferma (stesso bug di mergeThreads/mergeFlatEntityArray). Non essendoci un updatedAt per il LWW
// generico, la regola è sullo STATO (che può solo avanzare da "inviato" a "confermato", mai tornare
// indietro), non sul tempo.
function mergePreventivi(localRaw: string | undefined, serverRaw: string | undefined): string | null {
  let local: unknown[];
  let server: unknown[];
  try { const p = JSON.parse(localRaw ?? "[]"); if (!Array.isArray(p)) return null; local = p; } catch { return null; }
  try { const p = JSON.parse(serverRaw ?? "[]"); server = Array.isArray(p) ? p : []; } catch { server = []; }
  const serverById = new Map<string, { status?: unknown; bookingId?: unknown }>();
  for (const it of server) { const id = idOf(it); if (id) serverById.set(id, it as { status?: unknown; bookingId?: unknown }); }
  const out = local.map((it) => {
    const id = idOf(it);
    const s = id ? serverById.get(id) : undefined;
    if (s && s.status === "confermato" && (it as { status?: unknown })?.status !== "confermato") {
      return { ...(it as Record<string, unknown>), status: s.status, bookingId: s.bookingId };
    }
    return it;
  });
  return JSON.stringify(out);
}

// Chiavi di CONTATTO (email/telefono normalizzati) per riconoscere un iscritto newsletter / lead.
function leadContactKeys(g: unknown): string[] {
  const o = (g && typeof g === "object") ? (g as { email?: unknown; phone?: unknown }) : {};
  const keys: string[] = [];
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
  if (email) keys.push("email:" + email);
  const phone = typeof o.phone === "string" ? o.phone.replace(/[\s+()./-]/g, "") : "";
  if (phone.length >= 6) keys.push("tel:" + phone);
  return keys;
}
// Un contatto è un "lead newsletter" se arriva dal sito pubblico o è taggato newsletter.
function isNewsletterLead(g: unknown): boolean {
  const o = (g && typeof g === "object") ? (g as { source?: unknown; tags?: unknown }) : {};
  if (o.source === "sito") return true;
  return Array.isArray(o.tags) && (o.tags as unknown[]).includes("newsletter");
}

// Fusione a 3 vie di una collezione di entità:
//  - base   = elenco all'ultima sincronizzazione (cosa "sapevamo" prima)
//  - locale = elenco attuale in questo browser
//  - server = elenco attuale sul server
// Regole (priorità: non perdere dati reali):
//  - per un'entità presente sia in locale sia sul server vince la copia con `updatedAt` PIÙ RECENTE
//    (LAST-WRITE-WINS a livello di entità): così una copia stantìa di un client non può più
//    sovrascrivere un campo aggiornato di recente altrove (es. l'account Stripe della struttura).
//  - aggiungo le entità presenti sul server ma non in locale SOLO se sono nuove rispetto alla base
//    (aggiunte altrove). Se erano nella base e non sono più in locale => cancellate qui: non le reintroduco.
function merge3(baseArr: unknown[], localArr: unknown[], serverArr: unknown[]): unknown[] {
  const base = Array.isArray(baseArr) ? baseArr : [];
  const local = Array.isArray(localArr) ? localArr : [];
  const server = Array.isArray(serverArr) ? serverArr : [];
  const baseIds = new Set<string>();
  for (const it of base) { const id = idOf(it); if (id) baseIds.add(id); }
  const serverById = new Map<string, unknown>();
  for (const it of server) { const id = idOf(it); if (id) serverById.set(id, it); }
  const localIds = new Set<string>();
  const out: unknown[] = [];
  for (const it of local) {
    const id = idOf(it);
    if (id === null) { out.push(it); continue; }   // entità locale senza id: la tengo
    localIds.add(id);
    const s = serverById.get(id);
    // presente in entrambi: vince il timbro più recente (a parità, il locale).
    out.push(s && tsOf(s) > tsOf(it) ? s : it);
  }
  for (const it of server) {
    const id = idOf(it);
    if (id === null) continue;            // entità server senza id: la ignoro (evito duplicati)
    if (localIds.has(id)) continue;       // già gestita sopra (LWW)
    if (baseIds.has(id)) continue;        // c'era prima e ora non è in locale => cancellata qui
    out.push(it);                          // nuova sul server => la aggiungo
  }
  return out;
}

// Firma STABILE per decidere se RICARICARE la pagina: basata sugli INSIEMI di id delle
// entità (ordine-indipendente) + poche chiavi chiave. Evita il loop di reload quando la
// fusione produce lo stesso contenuto ma con liste in ordine diverso.
// Firma delle sole chiavi che l'app legge all'apertura e non aggiorna da sola (utenti e permessi, piano, moduli):
// solo se cambiano (da un altro dispositivo) serve ricaricare la pagina. Tutto il resto (prenotazioni, ospiti, camere…) si aggiorna sul posto.
function settingsSig(obj: Record<string, string> | null | undefined): string {
  if (!obj) return "";
  let sig = "";
  for (const k of ["spigolestay:users", "spigolestay:plan", "spigolestay:modules"]) {
    const raw = obj[k];
    if (raw) { try { sig += `${k}=${stableStringify(JSON.parse(raw))}`; } catch { sig += `${k}=${raw}`; } }
  }
  return sig;
}

function reloadSig(obj: Record<string, string> | null | undefined): string {
  if (!obj) return "";
  let sig = "";
  try {
    const d = JSON.parse(obj["spigolestay:data:v1"] || "{}") as Record<string, unknown>;
    for (const k of ENTITY_COLLECTIONS) {
      const ids = (Array.isArray(d[k]) ? d[k] : []).map(idOf).filter(Boolean).sort();
      sig += `${k}:${ids.join(",")};`;
    }
    const del = (d._deleted ?? {}) as Record<string, unknown>;
    for (const k of ENTITY_COLLECTIONS) { const t = (arr(del[k]) as string[]).slice().sort(); if (t.length) sig += `x${k}:${t.join(",")};`; }
  } catch { /* blob non valido */ }
  for (const k of ["spigolestay:users", "spigolestay:plan", "spigolestay:modules"]) {
    const raw = obj[k]; if (raw) { try { sig += `${k}=${stableStringify(JSON.parse(raw))}`; } catch { sig += `${k}=${raw}`; } }
  }
  return sig;
}

// Fonde lo stato locale con quello del server usando la base (ultimo stato sincronizzato).
// - chiavi solo sul server -> mantenute; chiavi in comune -> vince il locale;
// - strutture/camere/prenotazioni/ospiti -> fusione a 3 vie (aggiunte tenute, cancellazioni rispettate).
function mergeSnapshots(
  local: Record<string, string>,
  server: Record<string, string> | null | undefined,
  base: Record<string, string> | null | undefined,
): Record<string, string> {
  const merged: Record<string, string> = { ...(server ?? {}), ...local };
  try {
    const lRaw = local["spigolestay:data:v1"];
    const sRaw = server?.["spigolestay:data:v1"];
    if (lRaw && sRaw) {
      const l = JSON.parse(lRaw) as Record<string, unknown>;
      const s = JSON.parse(sRaw) as Record<string, unknown>;
      let b: Record<string, unknown> = {};
      try { const bRaw = base?.["spigolestay:data:v1"]; if (bRaw) b = JSON.parse(bRaw) as Record<string, unknown>; } catch {}
      const out: Record<string, unknown> = { ...s, ...l }; // vince il locale sui campi in comune
      // Lapidi (tombstone): una cancellazione non deve "risorgere".
      //  - Lapidi dal SERVER = AUTORITATIVE: se un'altra sessione/socio ha cancellato un'entità
      //    condivisa, va rimossa anche qui ANCHE se è ancora nel mio locale non sincronizzato
      //    (è la causa per cui prima le camere/tipologie eliminate ricomparivano).
      //  - Lapidi locali/base = "revivibili": se l'entità è di nuovo nel locale (ripristino da
      //    backup) tolgo la lapide locale, così torna viva.
      const delB = (b._deleted ?? {}) as Record<string, unknown>;
      const delL = (l._deleted ?? {}) as Record<string, unknown>;
      const delS = (s._deleted ?? {}) as Record<string, unknown>;
      const outDeleted: Record<string, string[]> = {};
      for (const key of ENTITY_COLLECTIONS) {
        const mergedColl = merge3(b[key] as unknown[], l[key] as unknown[], s[key] as unknown[]);
        const authoritative = new Set<string>(arr(delS[key]) as string[]);       // server: sempre valide
        const revivable = new Set<string>([...(arr(delB[key]) as string[]), ...(arr(delL[key]) as string[])]);
        for (const it of arr(l[key])) { const id = idOf(it); if (id) revivable.delete(id); } // ripristino da backup
        const tomb = new Set<string>([...authoritative, ...revivable]);
        out[key] = mergedColl.filter((it) => { const id = idOf(it); return !(id && tomb.has(id)); });
        // Le lapidi crescono per sempre e pesano nel localStorage (quota ~5 MB): si tengono solo le ultime MAX_TOMBS.
        if (tomb.size) outDeleted[key] = tomb.size > MAX_TOMBS ? [...tomb].slice(-MAX_TOMBS) : [...tomb];
      }
      out._deleted = outDeleted;

      // Anti-resurrezione degli ISCRITTI NEWSLETTER (lead): il sito pubblico (/api/public-lead) può
      // re-inserire un contatto cancellato con un NUOVO id, che il tombstone per-id non intercetta.
      // Teniamo perciò un elenco di CONTATTI cancellati (email/telefono normalizzati): un lead sul
      // server che corrisponde a un contatto cancellato e NON ha prenotazioni viene rimosso, così
      // non "riappare dopo la sync". Gli ospiti veri (con prenotazioni) non vengono mai toccati.
      const leadsB = arr((b as { _deletedLeads?: unknown })._deletedLeads) as unknown[];
      const leadsL = arr((l as { _deletedLeads?: unknown })._deletedLeads) as unknown[];
      const leadsS = arr((s as { _deletedLeads?: unknown })._deletedLeads) as unknown[];
      const deletedLeads = new Set<string>([...leadsB, ...leadsL, ...leadsS].filter((x): x is string => typeof x === "string"));
      if (deletedLeads.size) {
        const bookedGuestIds = new Set<string>();
        for (const bk of arr(out.bookings) as { guestId?: unknown }[]) { const gid = bk?.guestId; if (typeof gid === "string" && gid) bookedGuestIds.add(gid); }
        out.guests = (arr(out.guests) as unknown[]).filter((g) => {
          if (!isNewsletterLead(g)) return true;                        // non è un lead: mai rimosso
          const id = idOf(g); if (id && bookedGuestIds.has(id)) return true; // ha prenotazioni: è un ospite vero
          return !leadContactKeys(g).some((k) => deletedLeads.has(k));  // lead con contatto cancellato → via
        });
      }
      out._deletedLeads = [...deletedLeads];

      // Registro attività: unione per id (vedi mergeActivities), MAI "vince il locale" come il resto
      // dei campi non-ENTITY_COLLECTIONS di questo blob — l'import Channex lo scrive anche dal server.
      out.activities = mergeActivities(l.activities, s.activities);

      merged["spigolestay:data:v1"] = JSON.stringify(out);
    }
  } catch { /* JSON non valido: resta il merge a livello di chiavi */ }

  // Fusione per-elemento delle collezioni PIATTE delle Pulizie (scorte/ordini/segnalazioni):
  // LWW per id, così una copia stantìa non riporta indietro i cambi fatti altrove. Il merge a
  // livello di chiavi qui sopra le trattava come "vince il locale" in blocco (causa del reset).
  for (const key of FLAT_ENTITY_KEYS) {
    const lRaw = local[key];
    const sRaw = server?.[key];
    if (lRaw === undefined && sRaw === undefined) continue;
    const m = mergeFlatEntityArray(lRaw, sRaw);
    if (m !== null) merged[key] = m;
  }

  const lThreads = local[THREADS_KEY];
  const sThreads = server?.[THREADS_KEY];
  if (lThreads !== undefined || sThreads !== undefined) {
    const m = mergeThreads(lThreads, sThreads);
    if (m !== null) merged[THREADS_KEY] = m;
  }

  // Preventivi: vedi mergePreventivi — protegge solo lo stato "confermato" scritto dal server.
  const lPrev = local[PREVENTIVI_KEY];
  const sPrev = server?.[PREVENTIVI_KEY];
  if (lPrev !== undefined || sPrev !== undefined) {
    const m = mergePreventivi(lPrev, sPrev);
    if (m !== null) merged[PREVENTIVI_KEY] = m;
  }
  return merged;
}

type SbClient = NonNullable<typeof supabase>;
type ServerRow = { data: Record<string, string> | null; rev: number | null };

async function readServer(client: SbClient, userId: string): Promise<ServerRow> {
  const { data, error } = await client.from("app_state").select("data, rev").eq("user_id", userId).maybeSingle();
  if (error) throw error; // un errore NON è "nessun dato": altrimenti un account esistente sembrerebbe nuovo
  const row = data as { data?: Record<string, string> | null; rev?: number | null } | null;
  return { data: row?.data ?? null, rev: (typeof row?.rev === "number" ? row.rev : null) };
}

// Scrive lo stato fuso applicando il lucchetto di versione.
// Ritorna il nuovo rev se la scrittura è andata a buon fine, altrimenti null (conflitto: ritentare).
async function writeWithLock(
  client: SbClient,
  userId: string,
  merged: Record<string, string>,
  expectedRev: number | null,
): Promise<number | null> {
  if (expectedRev === null) {
    // Nessuna riga sul server: primo salvataggio.
    const { data, error } = await client.from("app_state").insert({ user_id: userId, data: merged }).select("rev").maybeSingle();
    if (error) return null; // corsa: qualcun altro ha inserito nel frattempo -> ritenta
    const r = (data as { rev?: number } | null)?.rev;
    return typeof r === "number" ? r : 0;
  }
  const { data, error } = await client
    .from("app_state")
    .update({ data: merged, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("rev", expectedRev)
    .select("rev");
  if (error) return null;
  const rows = (data as { rev?: number }[] | null) ?? [];
  if (rows.length === 0) return null; // rev cambiata altrove -> conflitto
  const r = rows[0]?.rev;
  return typeof r === "number" ? r : expectedRev + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// STRUTTURE CONDIVISE (org): lo store legge un unico blob (personale ∪ org); qui
// lo dividiamo per destinazione (app_state personale vs org_state condiviso) e lo
// ricombiniamo dopo la fusione. Se l'utente non è in nessuna org, tutto resta
// personale e il comportamento è identico a prima (nessun rischio per chi non condivide).
// ─────────────────────────────────────────────────────────────────────────────
type DataObj = Record<string, unknown>;
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const EMPTY_ORG_DATA = (): DataObj => ({ structures: [], roomTypes: [], units: [], bookings: [], guests: [], rateOverrides: {} });

// Divide il blob dati per organizzazione. Ritorna il sottoinsieme personale + una mappa orgId→sottoinsieme.
function splitByOrg(d: DataObj): { personal: DataObj; orgs: Map<string, DataObj> } {
  const orgByStruct = new Map<string, string>();
  for (const s of arr(d.structures) as { id?: string; orgId?: string }[]) if (s?.id && s.orgId) orgByStruct.set(s.id, s.orgId);
  const structByRt = new Map<string, string>();
  for (const rt of arr(d.roomTypes) as { id?: string; structureId?: string }[]) if (rt?.id && rt.structureId) structByRt.set(rt.id, rt.structureId);
  const orgOfStruct = (sid?: string | null) => (sid && orgByStruct.get(sid)) || null;
  const orgOfRt = (rtId?: string | null) => orgOfStruct(rtId ? structByRt.get(rtId) : null);

  const personal: DataObj = { ...d, structures: [], roomTypes: [], units: [], bookings: [], guests: [], rateOverrides: {} };
  const orgs = new Map<string, DataObj>();
  const orgOf = (o: string | null): DataObj => { if (!o) return personal; if (!orgs.has(o)) orgs.set(o, EMPTY_ORG_DATA()); return orgs.get(o)!; };

  for (const s of arr(d.structures) as { orgId?: string }[]) (orgOf(s?.orgId || null).structures as unknown[]).push(s);
  for (const rt of arr(d.roomTypes) as { structureId?: string }[]) (orgOf(orgOfStruct(rt?.structureId)).roomTypes as unknown[]).push(rt);
  for (const u of arr(d.units) as { structureId?: string }[]) (orgOf(orgOfStruct(u?.structureId)).units as unknown[]).push(u);
  // prenotazioni per struttura; raccogli gli ospiti citati dalle prenotazioni condivise
  const orgGuestIds = new Map<string, Set<string>>();
  for (const b of arr(d.bookings) as { structureId?: string; guestId?: string }[]) {
    const o = orgOfStruct(b?.structureId);
    (orgOf(o).bookings as unknown[]).push(b);
    if (o && b?.guestId) { if (!orgGuestIds.has(o)) orgGuestIds.set(o, new Set()); orgGuestIds.get(o)!.add(b.guestId); }
  }
  // ospiti: TUTTI restano nel personale; quelli citati da prenotazioni org vengono ANCHE copiati nell'org (nome visibile all'altro socio)
  personal.guests = arr(d.guests);
  const guestsById = new Map<string, unknown>();
  for (const g of arr(d.guests) as { id?: string }[]) if (g?.id) guestsById.set(g.id, g);
  for (const [o, ids] of orgGuestIds) { const gl: unknown[] = []; for (const id of ids) { const g = guestsById.get(id); if (g) gl.push(g); } (orgs.get(o) ?? orgOf(o)).guests = gl; }
  // rateOverrides: chiave "roomTypeId|ISO" → org del roomType; chiavi senza "|" → personale
  const ro = (d.rateOverrides && typeof d.rateOverrides === "object") ? d.rateOverrides as Record<string, number> : {};
  for (const [k, v] of Object.entries(ro)) {
    const rtId = k.includes("|") ? k.split("|")[0] : "";
    const o = rtId ? orgOfRt(rtId) : null;
    (orgOf(o).rateOverrides as Record<string, number>)[k] = v;
  }
  // Propaga le lapidi di cancellazione a OGNI org: così cancellare una prenotazione/ospite
  // condiviso viene scritto anche in org_state e non "risorge" dalla copia dell'organizzazione.
  const del = (d._deleted && typeof d._deleted === "object") ? d._deleted : {};
  for (const od of orgs.values()) od._deleted = del;
  return { personal, orgs };
}

// Ricombina personale + dati org in un unico blob per il locale (dedup per id; le copie org, che portano orgId, vincono sulle strutture).
function combineData(personal: DataObj, orgDatas: DataObj[]): DataObj {
  const out: DataObj = { ...personal };
  const mergeColl = (key: string) => {
    const map = new Map<string, unknown>();
    const add = (a: unknown[]) => { for (const it of a) { const id = (it && typeof it === "object") ? (it as { id?: unknown }).id : undefined; map.set(id != null && id !== "" ? String(id) : JSON.stringify(it), it); } };
    add(arr(personal[key]));            // prima il personale…
    for (const od of orgDatas) add(arr(od[key])); // …poi le copie org sovrascrivono gli id in comune
    out[key] = [...map.values()];
  };
  mergeColl("structures"); mergeColl("roomTypes"); mergeColl("units"); mergeColl("bookings"); mergeColl("guests");
  const ro: Record<string, number> = { ...((personal.rateOverrides as Record<string, number>) || {}) };
  for (const od of orgDatas) Object.assign(ro, (od.rateOverrides as Record<string, number>) || {});
  out.rateOverrides = ro;
  return out;
}

// Legge una riga di stato da una tabella qualsiasi (app_state per user, org_state per org).
async function readRow(client: SbClient, table: string, idCol: string, idVal: string): Promise<ServerRow> {
  const { data, error } = await client.from(table).select("data, rev").eq(idCol, idVal).maybeSingle();
  if (error) throw error;
  const row = data as { data?: Record<string, string> | null; rev?: number | null } | null;
  return { data: row?.data ?? null, rev: (typeof row?.rev === "number" ? row.rev : null) };
}
async function writeRowWithLock(client: SbClient, table: string, idCol: string, idVal: string, merged: Record<string, string>, expectedRev: number | null): Promise<number | null> {
  if (expectedRev === null) {
    const { data, error } = await client.from(table).insert({ [idCol]: idVal, data: merged }).select("rev").maybeSingle();
    if (error) return null;
    const r = (data as { rev?: number } | null)?.rev;
    return typeof r === "number" ? r : 0;
  }
  const { data, error } = await client.from(table).update({ data: merged, updated_at: new Date().toISOString() }).eq(idCol, idVal).eq("rev", expectedRev).select("rev");
  if (error) return null;
  const rows = (data as { rev?: number }[] | null) ?? [];
  if (rows.length === 0) return null;
  const r = rows[0]?.rev;
  return typeof r === "number" ? r : expectedRev + 1;
}

type SyncRef = { rev: number; last: Record<string, string> };
// Salva un singolo store (personale o org) con fusione 3 vie + lucchetto. Aggiorna ref. Ritorna il merge.
async function saveOne(client: SbClient, table: string, idCol: string, idVal: string, snap: Record<string, string>, ref: SyncRef): Promise<{ merged: Record<string, string>; wrote: boolean }> {
  const { data: serverData, rev: serverRev } = await readRow(client, table, idCol, idVal);
  const merged = mergeSnapshots(snap, serverData, ref.last);
  const changedServer = contentSig(merged) !== contentSig(serverData ?? {});
  if (changedServer) {
    const nr = await writeRowWithLock(client, table, idCol, idVal, merged, serverRev);
    if (nr === null) return { merged, wrote: false }; // conflitto: ritenta al ciclo dopo
    ref.rev = nr; ref.last = merged; return { merged, wrote: true };
  }
  if (serverRev !== null) ref.rev = serverRev;
  ref.last = merged;
  return { merged, wrote: false };
}

async function fetchOrgIds(client: SbClient, uid: string): Promise<string[]> {
  const { data, error } = await client.from("memberships").select("org_id").eq("user_id", uid);
  if (error) throw error; // senza l'elenco delle strutture condivise non si sincronizza (non si fa sparire nulla)
  return ((data as { org_id?: string }[] | null) ?? []).map((r) => r.org_id).filter((x): x is string => !!x);
}

// Sincronizzazione completa (personale + eventuali org). Degrada a "solo personale" se non ci sono org.
async function syncOnce(
  client: SbClient,
  uid: string,
  revRef: { current: number },
  lastSynced: { current: Record<string, string> },
  orgRefs: { current: Record<string, SyncRef> },
): Promise<{ changedLocal: boolean; newBlob?: Record<string, string>; wrote: boolean }> {
  const snap = snapshot();
  if (!("spigolestay:data:v1" in snap)) return { changedLocal: false, wrote: false };
  let fullData: DataObj;
  try { fullData = JSON.parse(snap["spigolestay:data:v1"]) as DataObj; } catch { return { changedLocal: false, wrote: false }; }

  const orgIds = await fetchOrgIds(client, uid);
  const { personal, orgs } = splitByOrg(fullData);

  // 1) salva il personale (le chiavi non-dati, es. impostazioni, viaggiano col personale)
  const personalSnap = { ...snap, "spigolestay:data:v1": JSON.stringify(personal) };
  const personalRef: SyncRef = { rev: revRef.current, last: lastSynced.current };
  const pRes = await saveOne(client, "app_state", "user_id", uid, personalSnap, personalRef);
  revRef.current = personalRef.rev; lastSynced.current = personalRef.last;

  // 2) salva ogni org di cui sono membro
  const orgMergedDatas: DataObj[] = [];
  for (const orgId of orgIds) {
    if (!orgRefs.current[orgId]) orgRefs.current[orgId] = { rev: -1, last: {} };
    const localOrg = orgs.get(orgId) ?? EMPTY_ORG_DATA();
    const orgSnap = { "spigolestay:data:v1": JSON.stringify(localOrg) };
    const r = await saveOne(client, "org_state", "org_id", orgId, orgSnap, orgRefs.current[orgId]);
    try { orgMergedDatas.push(JSON.parse(r.merged["spigolestay:data:v1"] || "{}") as DataObj); } catch { /* salta */ }
  }
  for (const k of Object.keys(orgRefs.current)) if (!orgIds.includes(k)) delete orgRefs.current[k]; // pulizia org non più membro

  // 3) ricombina il locale con i risultati (personale + org) e segnala se il locale va aggiornato
  let mergedPersonal: DataObj;
  try { mergedPersonal = JSON.parse(pRes.merged["spigolestay:data:v1"] || "{}") as DataObj; } catch { mergedPersonal = personal; }
  const combined = combineData(mergedPersonal, orgMergedDatas);
  const newBlob: Record<string, string> = { ...pRes.merged, "spigolestay:data:v1": JSON.stringify(combined) };

  // ANTI-RACE: la sincronizzazione fotografa il localStorage all'inizio, poi fa round-trip di
  // rete, poi restore() riscrive. Se l'utente SALVA durante il round-trip, restore lo cancellerebbe.
  // Qui preserviamo le chiavi "piatte" (non il blob dati) modificate DURANTE il ciclo, rileggendo
  // il localStorage attuale: così un salvataggio appena fatto (es. spigolestay:billing) non va perso.
  try {
    const fresh = snapshot();
    for (const k of Object.keys(fresh)) {
      if (k === "spigolestay:data:v1") continue;
      if (fresh[k] !== snap[k]) newBlob[k] = fresh[k]; // modificata in locale durante il ciclo → tieni il fresco
    }
    for (const k of Object.keys(snap)) {
      if (k === "spigolestay:data:v1") continue;
      if (!(k in fresh) && k in newBlob) delete newBlob[k]; // rimossa in locale durante il ciclo
    }
  } catch { /* localStorage non disponibile: nessun ritocco */ }

  // Rileva QUALSIASI cambiamento di contenuto (anche di un singolo campo, es. webCheckin,
  // co-ospiti, pagamenti), non solo l'insieme degli ID: altrimenti un check-in completato sul
  // server non veniva mai adottato dal browser (restava "da fare" finché non ricaricavi).
  // Il reload della pagina resta gated su reloadSig (id-set) più avanti, così non introduce loop.
  const changedLocal = contentSig(newBlob) !== contentSig(snap);
  return { changedLocal, newBlob, wrote: pRes.wrote };
}

// Firma LEGGERA dello stato locale: contatore delle scritture sul blocco grande + checksum delle chiavi piccole (nessun parse JSON).
function cheapLocalSig(): string {
  let h = 0, n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !isSyncKey(k)) continue;
      const v = localStorage.getItem(k) ?? "";
      for (let j = 0; j < k.length; j++) h = (h * 31 + k.charCodeAt(j)) | 0;
      for (let j = 0; j < v.length; j++) h = (h * 31 + v.charCodeAt(j)) | 0;
      n++;
    }
  } catch { /* storage non disponibile */ }
  return kvVersion() + ":" + n + ":" + h;
}
// Firma LEGGERA del server: solo i numeri di versione (rev) dello stato personale e delle strutture condivise.
async function remoteSyncSig(client: SbClient, uid: string): Promise<string | null> {
  try {
    const { data, error } = await client.from("app_state").select("rev").eq("user_id", uid).maybeSingle();
    if (error) return null;
    let sig = String((data as { rev?: number } | null)?.rev ?? "x");
    const orgIds = (await fetchOrgIds(client, uid)).sort();
    for (const id of orgIds) {
      const { data: o, error: e2 } = await client.from("org_state").select("rev").eq("org_id", id).maybeSingle();
      if (e2) return null;
      sig += "|" + id + ":" + String((o as { rev?: number } | null)?.rev ?? "x");
    }
    return sig;
  } catch { return null; }
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  enabled: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function Splash({ label }: { label: string }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
      {/* Solo la farfalla Xenora che pulsa durante il caricamento */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/xenora-mark.png" alt={label || "Xenora"} width={72} height={72} style={{ width: 72, height: 72, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
      <style>{`@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [storageFull, setStorageFull] = useState(false); // il browser non ha più spazio: i dati non si salvano in locale
  // Il browser allega da solo il token di accesso a ogni chiamata alle nostre API (/api/*): così le API possono pretendere il login
  // senza riscrivere ogni punto che le chiama. Il token non esce mai verso altri domini.
  useEffect(() => {
    if (!supabaseEnabled || !supabase || typeof window === "undefined") return;
    const sb = supabase;
    const orig = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("/api/") || url.startsWith(window.location.origin + "/api/")) {
          const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? (input as Request).headers : undefined));
          if (!headers.has("authorization")) {
            const tok = (await sb.auth.getSession()).data.session?.access_token;
            if (tok) headers.set("authorization", "Bearer " + tok);
          }
          return orig(input, { ...init, headers });
        }
      } catch { /* si prosegue senza token */ }
      return orig(input, init);
    };
    return () => { window.fetch = orig; };
  }, []);
  const [bigReady, setBigReady] = useState(false); // archivio dei dati grandi (IndexedDB) caricato in memoria
  useEffect(() => { void initBigStore().finally(() => setBigReady(true)); }, []);
  const [hydrateError, setHydrateError] = useState(false); // impossibile leggere i dati dal server (e nessuna copia locale)
  useEffect(() => { const h = () => setStorageFull(true); window.addEventListener("xenora:storage-full", h); return () => window.removeEventListener("xenora:storage-full", h); }, []);
  const [mfaChecked, setMfaChecked] = useState(false); // AAL verificato per la sessione corrente
  const [mfaNeeded, setMfaNeeded] = useState(false);    // il 2FA è attivo ma la sessione è a un fattore
  const [accessAllowed, setAccessAllowed] = useState<boolean | null>(null); // cancello accesso su invito (null = in verifica)
  const pushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSynced = useRef<Record<string, string>>({}); // ultimo stato sincronizzato col server (base per la fusione)
  const revRef = useRef<number>(-1); // versione (rev) dell'ultimo stato letto dal server (-1 = sconosciuta)
  const orgRefs = useRef<Record<string, SyncRef>>({}); // rev/base per ogni struttura condivisa (org_state)
  const focusSyncRef = useRef<(() => void) | null>(null); // sync immediato al ritorno sulla scheda
  const lastSigRef = useRef(""); // firma (server + locale) dell'ultima sincronizzazione riuscita: se non cambia, non si rifà nulla
  const lastFullRef = useRef(0);   // quando è stata fatta l'ultima sincronizzazione completa
  const syncingRef = useRef(false); // guardia anti-rientro: evita run concorrenti (intervallo + focus)

  const stopPush = () => {
    if (pushTimer.current) { clearInterval(pushTimer.current); pushTimer.current = null; }
    if (focusSyncRef.current) {
      try { window.removeEventListener("focus", focusSyncRef.current); document.removeEventListener("visibilitychange", focusSyncRef.current); } catch {}
      focusSyncRef.current = null;
    }
  };

  // 1) Sessione corrente + ascolto dei cambiamenti (login/logout/refresh token).
  useEffect(() => {
    if (!supabaseEnabled || !supabase) { setLoading(false); setHydrated(true); return; }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setLoading(false); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { setSession(s); setLoading(false); });
    return () => { mounted = false; sub.subscription.unsubscribe(); stopPush(); };
  }, []);

  // 2) Reindirizza al login se non autenticato.
  useEffect(() => {
    if (!supabaseEnabled) return;
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // 2b) Livello di sicurezza (2FA): se l'account ha il 2FA attivo e la sessione è ancora a un fattore,
  // va richiesto il secondo fattore. In caso di errore non blocchiamo (fail-open, evita lockout).
  useEffect(() => {
    if (!supabaseEnabled || !supabase) { setMfaChecked(true); setMfaNeeded(false); return; }
    if (!session) { setMfaChecked(true); setMfaNeeded(false); return; }
    let cancelled = false;
    setMfaChecked(false);
    (async () => {
      try {
        const { data, error } = await supabase!.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        setMfaNeeded(!error && !!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2");
      } catch { if (!cancelled) setMfaNeeded(false); }
      finally { if (!cancelled) setMfaChecked(true); }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // 2c) Cancello di accesso "SU INVITO": Xenora non è a registrazione aperta. Dopo il login
  // chiediamo al server se l'utente è abilitato (owner, utente esistente, membro, invitato o in
  // allowlist). Se non lo è, lo disconnettiamo e la pagina di login mostra "accesso su invito".
  // Fail-open su errore tecnico: non blocchiamo clienti legittimi per un problema transitorio
  // (i dati restano comunque isolati da RLS).
  useEffect(() => {
    if (!supabaseEnabled || !supabase) { setAccessAllowed(true); return; }
    if (!session) { setAccessAllowed(null); return; }
    if (!mfaChecked || mfaNeeded) return; // prima la verifica 2FA
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/access/status", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const j = await res.json().catch(() => null) as { allowed?: boolean } | null;
        if (cancelled) return;
        if (j && j.allowed === false) {
          setAccessAllowed(false);
          try { localStorage.setItem("xn-access-denied", "1"); } catch {}
          await supabase!.auth.signOut();
        } else {
          setAccessAllowed(true);
          try { localStorage.removeItem("xn-access-denied"); } catch {}
        }
      } catch {
        if (!cancelled) setAccessAllowed(true); // fail-open: nessun lockout su errore di rete
      }
    })();
    return () => { cancelled = true; };
  }, [session, mfaChecked, mfaNeeded]);

  // 3) Al login: scarica lo stato dal server e reidrata una sola volta per questo utente/tab.
  useEffect(() => {
    if (!supabaseEnabled || !supabase) return;
    if (!bigReady) return; // prima si carica l'archivio locale dei dati
    const uid = session?.user?.id;
    if (!uid) { setHydrated(false); return; }
    if (!mfaChecked || mfaNeeded) return; // attendi la verifica 2FA prima di reidratare
    if (accessAllowed !== true) return; // attendi il via libera del cancello accesso (no workspace per non-abilitati)
    let cancelled = false;
    const flagKey = "spigolestay:hydrated-for";
    const authUser = session?.user;

    // Registro clienti: aggiorna la scheda del cliente (email, telefono, struttura/e, piano…)
    // sulla tabella `profiles`. Riempimento automatico a ogni accesso/aggiornamento.
    const syncProfile = async (userId: string) => {
      if (!supabase) return;
      try {
        let plan = "", structNames = "", stripeCustomer = "";
        let structCount = 0, roomsCount = 0;
        try { plan = localStorage.getItem("spigolestay:plan") || localStorage.getItem("spigolestay:tier") || ""; } catch {}
        try { stripeCustomer = localStorage.getItem("spigolestay:stripecustomer") || ""; } catch {}
        try {
          const raw = kvGet("spigolestay:data:v1");
          if (raw) {
            const d = JSON.parse(raw);
            if (Array.isArray(d.structures)) {
              structCount = d.structures.length;
              structNames = d.structures.map((s: { name?: string }) => s.name).filter(Boolean).join(", ");
            }
            if (Array.isArray(d.units)) roomsCount = d.units.filter((u: { outOfService?: boolean }) => !u.outOfService).length;
          }
        } catch {}
        // IMPORTANTE: i metadati della sessione in cache possono essere VECCHI (es. subito dopo
        // aver cambiato il nome in Impostazioni). Leggo l'utente FRESCO dal server per non
        // sovrascrivere il nome appena salvato con quello iniziale (bug "il nome torna indietro").
        let md = (authUser?.user_metadata ?? {}) as Record<string, unknown>;
        try { const { data: fresh } = await supabase.auth.getUser(); if (fresh?.user?.user_metadata) md = fresh.user.user_metadata as Record<string, unknown>; } catch {}
        const fullName = (md.full_name as string) || "";
        const phone = (md.phone as string) || "";
        // Campi operativi sempre aggiornati; nome/telefono solo se presenti (non azzerarli mai).
        const patch: Record<string, unknown> = {
          user_id: userId,
          email: authUser?.email ?? null,
          plan: plan || null,
          structures_count: structCount,
          rooms_count: roomsCount,
          structure_names: structNames || null,
          stripe_customer_id: stripeCustomer || null,
          last_active: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (fullName) patch.full_name = fullName;
        if (phone) patch.phone = phone;
        await supabase.from("profiles").upsert(patch);
      } catch {}
    };

    const startPush = (userId: string) => {
      stopPush();
      const runSync = async () => {
        if (syncingRef.current) return; // già in corso: evita run concorrenti (intervallo + focus)
        syncingRef.current = true;
        let syncOk = false;
        try {
          // Niente di nuovo né sul server né qui (e sincronizzato da meno di 45 s): non si scarica e non si fonde 4 MB per niente.
          const sigNow = await remoteSyncSig(supabase!, userId);
          const fullSig = sigNow ? sigNow + "#" + cheapLocalSig() : "";
          if (fullSig && fullSig === lastSigRef.current && Date.now() - lastFullRef.current < 45000) return;
          // Sincronizzazione completa: personale (app_state) + eventuali strutture condivise (org_state),
          // con fusione 3 vie + lucchetto. Se non sei in nessuna org, è identico a prima.
          const { newBlob, changedLocal, wrote } = await syncOnce(supabase!, userId, revRef, lastSynced, orgRefs);
          syncOk = true;
          if (changedLocal && newBlob) {
            // Il server (o una struttura condivisa) aveva novità: aggiorno SEMPRE il browser…
            const settingsBefore = settingsSig(snapshot()); // com'erano utenti/piano/moduli PRIMA di applicare gli aggiornamenti
            if (!restore(newBlob)) return; // niente spazio: si avvisa l'utente (banner) e non si prosegue
            // …e avviso lo store di ri-leggere in-place (riflette anche i cambi di singolo campo,
            // es. check-in completato/pagamento, senza dover ricaricare la pagina).
            try { window.dispatchEvent(new Event("spigolestay:datasync")); } catch {}
            // …e NON si ricarica la pagina per prenotazioni, ospiti, camere ecc.: prima ogni novità dal server (altra scheda, Channex, un
            // collega) faceva ricomparire la farfalla per diversi secondi, anche mentre si scorreva un elenco. Si ricarica solo se è cambiato
            // qualcosa che si legge soltanto all'apertura (utenti e permessi, piano, moduli) e mai in mezzo a un'operazione.
            const sig = settingsSig(newBlob);
            let lastSig = "", lastTs = 0;
            try { lastSig = sessionStorage.getItem("xn-reloadsig") || ""; lastTs = Number(sessionStorage.getItem("xn-reloadts") || "0"); } catch {}
            const tooSoon = Date.now() - lastTs < 30000; // massimo un reload automatico ogni 30s
            // Non ricaricare mentre l'utente sta scrivendo/modificando: i dati freschi sono già
            // nel localStorage e compariranno al prossimo momento utile (evita di perdere l'input).
            let typing = false;
            try {
              const el = document.activeElement as HTMLElement | null;
              const tag = el?.tagName?.toLowerCase();
              typing = tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable === true;
            } catch {}
            if (sig !== settingsBefore && sig !== lastSig && !tooSoon && !typing) {
              try { sessionStorage.setItem("xn-reloadsig", sig); sessionStorage.setItem("xn-reloadts", String(Date.now())); } catch {}
              safeReload();
            }
            return;
          }
          if (wrote) void syncProfile(userId);
        } catch {} finally {
          if (syncOk) {
            // Ricorda com'è lo stato DOPO la sincronizzazione (compresi gli aggiornamenti scritti qui): il prossimo giro parte dal confronto leggero.
            lastFullRef.current = Date.now();
            try { const q2 = await remoteSyncSig(supabase!, userId); lastSigRef.current = q2 ? q2 + "#" + cheapLocalSig() : ""; } catch { lastSigRef.current = ""; }
          }
          syncingRef.current = false;
        }
      };
      pushTimer.current = setInterval(runSync, 4000);
      // Sync IMMEDIATO quando torni sulla scheda: così un check-in/pagamento fatto in un altro
      // tab si riflette subito (la riga/azione sparisce appena rientri), senza aspettare i 4s.
      const onFocus = () => { void runSync(); };
      focusSyncRef.current = onFocus;
      try { window.addEventListener("focus", onFocus); document.addEventListener("visibilitychange", onFocus); } catch {}
    };

    (async () => {
      try {
        // Scorciatoia "già reidratato in questa scheda": valida SOLO se il localStorage ha ancora i
        // dati. Se il flag è rimasto ma il locale è vuoto (es. sessione scaduta / logout senza reset),
        // NON usare la scorciatoia — prosegui col caricamento completo dal server qui sotto, altrimenti
        // syncOnce esce subito (locale vuoto) e la pagina resta VUOTA.
        let localHasData = false;
        try { localHasData = !!(kvGet("spigolestay:data:v1")); } catch {}
        if (sessionStorage.getItem(flagKey) === uid && localHasData) {
          try {
            const res = await syncOnce(supabase!, uid, revRef, lastSynced, orgRefs);
            if (res.changedLocal && res.newBlob) restore(res.newBlob); // l'app non è ancora montata: parte già con i dati aggiornati
          } catch { /* rete assente: riproverà il push periodico */ }
          void syncProfile(uid);
          markLocalOwner(uid);
          setHydrated(true);
          startPush(uid);
          return;
        }
        // Il locale appartiene a UN ALTRO account (dispositivo/browser riusato, es. test o PC
        // condiviso): lo svuotiamo PRIMA di leggere/confrontare, così non può in nessun caso
        // essere scambiato per dati "non ancora sincronizzati" di questo utente.
        if (localBelongsToOther(uid)) wipeLocalAccount();
        const { data: serverData, rev: serverRev } = await readServer(supabase!, uid);
        if (cancelled) return;
        const serverReal = hasRealData(serverData);
        let localReal = false;
        try { localReal = hasRealData({ "spigolestay:data:v1": kvGet("spigolestay:data:v1") ?? "" }); } catch {}

        if (serverReal) {
          // Il server ha DATI REALI. Fondo con l'eventuale locale (per non perdere modifiche fatte
          // offline su questo dispositivo) e reidrato dal risultato.
          const snap = snapshot();
          const merged = ("spigolestay:data:v1" in snap)
            ? mergeSnapshots(snap, serverData, {}) // prima idratazione: base vuota => unione
            : serverData!;
          const okR = restore(merged);
          lastSynced.current = merged;
          revRef.current = serverRev ?? 0;
          // Se la fusione ha aggiunto qualcosa al server, riallineo il server.
          if (contentSig(merged) !== contentSig(serverData ?? {})) {
            const nr = await writeWithLock(supabase!, uid, merged, serverRev);
            if (nr !== null) revRef.current = nr;
          }
          sessionStorage.setItem(flagKey, uid); markLocalOwner(uid);
          void syncProfile(uid);
          setHydrated(true);
          if (okR) startPush(uid); // senza spazio nel browser non si spinge nulla (sarebbe uno stato vecchio)
          return;
        }
        // Il server NON ha dati reali. Se il browser ne ha, il LOCALE vince (mai sovrascriverlo con
        // uno stato vuoto arrivato dal server): salviamo il locale sul server e proseguiamo.
        if (localReal) {
          const snap = snapshot();
          const merged = mergeSnapshots(snap, serverData, {});
          const nr = await writeWithLock(supabase!, uid, merged, serverRev);
          revRef.current = nr ?? (serverRev ?? 0);
          lastSynced.current = merged;
          void syncProfile(uid);
          sessionStorage.setItem(flagKey, uid); markLocalOwner(uid);
          setHydrated(true);
          startPush(uid);
          return;
        }
        if (serverData && Object.keys(serverData).length > 0) {
          // Né server né browser hanno dati reali, ma il server ha impostazioni/onboarding salvati:
          // ripristinali così com'è (comportamento normale per un account senza prenotazioni).
          const okS = restore(serverData);
          lastSynced.current = serverData;
          revRef.current = serverRev ?? 0;
          sessionStorage.setItem(flagKey, uid); markLocalOwner(uid);
          setHydrated(true);
          if (okS) startPush(uid);
          return;
        }
        // Socio invitato: nessun dato personale, ma è membro di una struttura CONDIVISA (org).
        // Non è un account nuovo: salta l'onboarding e lascia che il sync periodico scarichi la
        // struttura condivisa da org_state (entro pochi secondi) e ricarichi per mostrarla.
        const orgIds0 = await fetchOrgIds(supabase!, uid);
        if (orgIds0.length > 0) {
          try {
            localStorage.setItem("spigolestay:forcereset:v1", "1");
            localStorage.setItem("spigolestay:zeroprices:v1", "1");
            localStorage.setItem("spigolestay:onboarded", "1"); // niente wizard: ha già una struttura (condivisa)
          } catch {}
          lastSynced.current = {};
          void syncProfile(uid);
          sessionStorage.setItem(flagKey, uid); markLocalOwner(uid);
          setHydrated(true);
          startPush(uid);
          return;
        }
        // Account realmente nuovo (nessun dato né sul server né nel browser): procedura guidata.
        wipeLocalAccount();
        try {
          localStorage.setItem("spigolestay:forcereset:v1", "1"); // evita il wipe+reload automatico dello store
          localStorage.setItem("spigolestay:zeroprices:v1", "1");  // evita migrazioni sui dati demo
          localStorage.setItem("spigolestay:onboarded", "0");      // attiva la procedura guidata (struttura, camere…)
        } catch {}
        const snap = snapshot();
        const nr = await writeWithLock(supabase!, uid, snap, serverRev);
        revRef.current = nr ?? (serverRev ?? 0);
        lastSynced.current = snap;
        await syncProfile(uid);
        sessionStorage.setItem(flagKey, uid); markLocalOwner(uid);
        setHydrated(true);
        startPush(uid);
        return;
      } catch {
        // Errore di rete/server: se il browser ha già i dati si lavora in locale (il sync riprende da solo);
        // se è vuoto NON si entra (sembrerebbe un account nuovo e partirebbe l'onboarding): schermata con "Riprova".
        let localHas = false;
        try { localHas = !!kvGet("spigolestay:data:v1"); } catch { /* storage non disponibile */ }
        if (localHas) { setHydrated(true); startPush(uid); } else setHydrateError(true);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, mfaChecked, mfaNeeded, accessAllowed, bigReady]);

  const signOut = async () => {
    stopPush();
    let saved = false;
    const uid = session?.user?.id;
    try {
      if (supabase && uid) {
        // Salvataggio finale prima di uscire: sempre tramite fusione + lucchetto, così non si
        // sovrascrive uno stato del server più recente e non si perde nulla.
        const snap = snapshot();
        if ("spigolestay:data:v1" in snap) {
          // Salvataggio finale completo (personale + org). Se non lancia, i dati sono al sicuro sul server.
          await syncOnce(supabase, uid, revRef, lastSynced, orgRefs);
          // Controllo reale: il server deve avere ora lo stesso contenuto dell'ultimo stato sincronizzato.
          const chk = await readServer(supabase, uid);
          saved = !!chk.data && contentSig(chk.data) === contentSig(lastSynced.current);
        }
      }
    } catch { /* salvataggio finale fallito: saved resta false, il locale non si cancella */ }
    try { if (supabase) await supabase.auth.signOut(); } catch { /* si esce comunque */ }
    try { sessionStorage.removeItem("spigolestay:hydrated-for"); } catch {}
    // Svuota i dati locali SOLO se sono stati salvati sul server, altrimenti li perderei
    // (es. tabella app_state non ancora creata / rete assente).
    if (saved) wipeLocalAccount();
    router.replace("/login");
  };

  const value: AuthCtx = { user: session?.user ?? null, session, enabled: supabaseEnabled, signOut };

  // Modalità solo-locale (variabili non configurate): nessun gate.
  if (!bigReady) return <Splash label="Avvio…" />;
  if (!supabaseEnabled) return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  if (loading) return <Splash label="Avvio…" />;
  if (!session) return <Splash label="Reindirizzamento all'accesso…" />;
  if (!mfaChecked) return <Splash label="Verifica sicurezza…" />;
  if (mfaNeeded) return <MfaChallenge onVerified={() => setMfaNeeded(false)} onSignOut={signOut} />;
  if (accessAllowed === null) return <Splash label="Verifica accesso…" />;
  if (accessAllowed === false) return <Splash label="Accesso su invito — reindirizzamento…" />;
  if (hydrateError) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center", background: "#ffffff", color: "#1a1a1a", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Non riesco a collegarmi ai tuoi dati</div>
      <div style={{ maxWidth: 360, fontSize: 14, color: "#555" }}>I dati sono al sicuro sul server. Controlla la connessione e riprova: non serve rifare nulla.</div>
      <button onClick={() => window.location.reload()} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#111", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Riprova</button>
    </div>
  );
  if (!hydrated) return <Splash label="Carico i tuoi dati…" />;
  return (
    <Ctx.Provider value={value}>
      {storageFull && (
        <div role="alert" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, padding: "10px 16px", background: "#b42318", color: "#fff", fontSize: 14, textAlign: "center" }}>
          Spazio del browser esaurito: le ultime modifiche potrebbero non essere salvate su questo dispositivo. Svuota i dati del sito xenora.it dalle impostazioni del browser e riaccedi (i dati restano sul server), oppure scrivici.
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return { user: null, session: null, enabled: false, signOut: async () => {} };
  return ctx;
}
