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
import { initBigStore, kvGet, kvSet, kvRemove, kvKeys, kvFlush, kvVersion, lastIdbError } from "./bigstore";
import { useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseEnabled } from "./supabase";
import MfaChallenge from "@/components/MfaChallenge";
import DeltaBar from "@/components/DeltaBar";
import { combineData } from "./org-combine";
import { orgStructureSets, extractOrgCassaConfig, applyOrgCassaConfig, extractOrgPoolConfig, applyOrgPoolConfig } from "./org-cassa-config";
import { buildDelta, isEmptyDelta } from "./sync-delta";
import { flatHash as flatHashOf } from "./sync-flat";
import { deltaAllowedFor, deltaWantedFrom } from "./delta-allow";
import { applyRaceChanges } from "./sync-merge";
import { isSyncKey, LOCAL_OWNER_KEY, SYNCBASE_KEY, decideEntry, syncBaseText, readSyncBase, contentSig, settingsSig, mergeSnapshots, stableStringify } from "./sync-core";
import { pruneLocalToStructures } from "./sync-window";
import { HOME_PREF_KEY, HOME_APPLIED_KEY, START_HINT_KEY, sortStructures, resolveSelection, selectionIds, startRequest } from "./home-struct";
import { setDeltaScopeActive, initRequested, requestedParam, requestedIds, requestedSnapshot, addRequested, markLoaded, structureLoaded, noteCodeMax, registerLoader } from "./struct-load";

// Pulizia una tantum: la vecchia copia nel localStorage occupava ~400 KB di una quota di ~5 MB.
if (typeof window !== "undefined") { try { localStorage.removeItem("spigolestay:channex-arisnapshot"); } catch { /* storage non disponibile */ } }

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
    sessionStorage.removeItem("spigolestay:hydrated-for");
    // Marcatore dei dati locali e base persistente non sono chiavi sincronizzate (SKIP_KEYS): restano dopo il wipe e vanno tolti a mano. A locale vuoto non c'è nulla da proteggere.
    try { localStorage.removeItem(LOCAL_OWNER_KEY); localStorage.removeItem(SYNCBASE_KEY); } catch {}
    // Marcatori "una volta per sessione" dell'account precedente (ultimo accesso già registrato): per il nuovo account vanno rifatti.
    try { Object.keys(sessionStorage).filter((k) => k.startsWith("spigolestay:stamped:")).forEach((k) => sessionStorage.removeItem(k)); } catch {}
  } catch {}
}

// BASE PERSISTENTE della sincronizzazione (per dispositivo): impronte (non i contenuti) delle chiavi piatte all'ultima sync riuscita, legate all'uid.
// Serve alla fusione a 3 vie delle chiavi piatte (sync-flat.ts) anche dopo un ricaricamento, quando la base in memoria è vuota. Se l'uid è diverso o manca si scarta.
// Si scrive SOLO dopo che il server ha lo stato fuso e il locale è stato aggiornato (restore riuscito): mai una base che dica "sincronizzato" per ciò che non lo è.
function loadSyncBase(uid: string): Record<string, string> | null {
  try { return readSyncBase(localStorage.getItem(SYNCBASE_KEY), uid); } catch { return null; }
}
const hashMemo = new Map<string, { raw: string; h: string | undefined }>(); // evita di rifare l'impronta di valori grandi identici a ogni ciclo
function commitSyncBase(uid: string, last: Record<string, string>) {
  try {
    if (!last || Object.keys(last).length === 0) return; // niente da ricordare: non si cancella la base buona con una vuota
    const txt = syncBaseText(uid, last, (k, raw) => {
      const m = hashMemo.get(k);
      if (m && m.raw === raw) return m.h;
      const h = flatHashOf(raw); hashMemo.set(k, { raw, h }); return h;
    });
    if (localStorage.getItem(SYNCBASE_KEY) !== txt) localStorage.setItem(SYNCBASE_KEY, txt);
  } catch { /* storage pieno o non disponibile: la base resta quella di prima (più vecchia = più prudente) */ }
}

// A chi appartengono i dati ora salvati in locale (uid). Senza questo, un dispositivo/browser
// riusato da un account DIVERSO (demo, test, PC condiviso) con il server ancora vuoto per il
// nuovo account faceva "vincere il locale" e copiava sul server del nuovo utente i dati del
// precedente — un vero incidente di sicurezza/isolamento dati, non solo un fastidio nei test.
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

type SbClient = NonNullable<typeof supabase>;
type ServerRow = { data: Record<string, string> | null; rev: number | null; hadData?: boolean }; // hadData: (solo lettura a finestra) la riga ha prenotazioni/ospiti sul server anche se la finestra per struttura non li contiene

// ─────────────────────────────────────────────────────────────────────────────
// MODALITÀ VELOCE (Fase 2), per dispositivo: il browser scarica solo una FINESTRA di prenotazioni/ospiti (/api/sync/window) e rimanda al server solo le
// MODIFICHE (/api/sync/delta), che il server applica all'archivio completo. Il server resta completo, quindi si può tornare alla modalità normale in ogni momento.
// Nella modalità normale non cambia nulla. Acceso da Impostazioni → «Modalità veloce» (chiave locale), mai in automatico.
// ─────────────────────────────────────────────────────────────────────────────
export const DELTA_FLAG_KEY = "xn-delta-sync";        // assente o "1" = modalità veloce (DEFAULT per gli account abilitati); "0" = spenta dall'utente su questo dispositivo (non si sincronizza)
export const DELTA_FAILED_KEY = "xn-delta-failed";    // sessione: uid per cui la lettura a finestra è fallita → in questa sessione si resta in modalità normale
const DELTA_ACTIVE_KEY = "xn-delta-active";           // uid per cui la copia locale è già passata a finestra
const DELTA_PAST_KEY = "xn-delta-past";               // sessione: "all" = carica tutto lo storico (finestra illimitata)
let DELTA_MODE = false;
export { deltaAllowedFor };
export const deltaWanted = (uid: string): boolean => {
  if (!deltaAllowedFor(uid)) return false;
  let flag: string | null = null, failed: string | null = null;
  try { flag = localStorage.getItem(DELTA_FLAG_KEY); } catch { /* storage non disponibile: default */ }
  try { failed = sessionStorage.getItem(DELTA_FAILED_KEY); } catch { /* niente */ }
  return deltaWantedFrom(uid, flag, failed);
};
export const deltaIsActive = (): boolean => DELTA_MODE;
function deltaPast(): string { try { return sessionStorage.getItem(DELTA_PAST_KEY) === "all" ? "all" : ""; } catch { return ""; } }

async function readViaWindow(table: string, idVal: string): Promise<ServerRow> {
  // Apertura per struttura: solo le strutture richieste (vedi struct-load.ts); strutture/tipologie/camere di tutte arrivano sempre. Nessun parametro = tutte.
  const sp = requestedParam();
  const res = await fetch(`/api/sync/window?table=${encodeURIComponent(table)}&id=${encodeURIComponent(idVal)}${deltaPast() ? "&past=all" : ""}${sp ? "&structureIds=" + encodeURIComponent(sp) : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error("window_" + res.status); // un errore NON è «nessun dato»
  const j = await res.json() as { ok?: boolean; data?: Record<string, string> | null; rev?: number | null; stats?: { bookingsTotal?: number; guestsTotal?: number } | null; codeMax?: Record<string, number> };
  if (!j || j.ok !== true) throw new Error("window_bad");
  noteCodeMax(table + ":" + idVal, j.codeMax); // massimo progressivo dei codici prenotazione sull'archivio completo (anche delle strutture non caricate)
  return { data: j.data ?? null, rev: typeof j.rev === "number" ? j.rev : null, hadData: !!j.stats && ((j.stats.bookingsTotal ?? 0) > 0 || (j.stats.guestsTotal ?? 0) > 0) };
}

let deltaBlocked = 0;
// Invia le modifiche. Ritorna il nuovo rev, oppure null (conflitto o rifiuto: si riprova al ciclo dopo).
async function postDelta(table: string, idVal: string, expectedRev: number, delta: ReturnType<typeof buildDelta>): Promise<number | null> {
  const res = await fetch("/api/sync/delta", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ table, id: idVal, expectedRev, delta }) });
  if (res.status === 409) return null;                      // rev cambiata altrove: si rilegge e si riprova
  const j = await res.json().catch(() => null) as { ok?: boolean; rev?: number; error?: string; message?: string } | null;
  if (!res.ok || !j?.ok) {
    if (j?.error === "mass_delete") { deltaBlocked++; try { window.dispatchEvent(new CustomEvent("xenora:delta-blocked", { detail: j.message ?? "" })); } catch { /* niente */ } }
    return null;
  }
  deltaBlocked = 0;
  return typeof j.rev === "number" ? j.rev : expectedRev + 1;
}

async function readServer(client: SbClient, userId: string): Promise<ServerRow> {
  if (DELTA_MODE) return readViaWindow("app_state", userId);
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

// Legge una riga di stato da una tabella qualsiasi (app_state per user, org_state per org).
async function readRow(client: SbClient, table: string, idCol: string, idVal: string): Promise<ServerRow> {
  if (DELTA_MODE) return readViaWindow(table, idVal);
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
// ok = false se NON tutto è arrivato sul server (conflitto o rifiuto): serve a sapere se lo stato locale è «tutto sincronizzato».
async function saveOne(client: SbClient, table: string, idCol: string, idVal: string, snap: Record<string, string>, ref: SyncRef, baseHashes?: Record<string, string> | null): Promise<{ merged: Record<string, string>; wrote: boolean; ok: boolean }> {
  const scope = DELTA_MODE ? requestedIds() : null; // strutture richieste: preso PRIMA della lettura (la lettura ne userà almeno altrettante)
  const { data: serverData, rev: serverRev } = await readRow(client, table, idCol, idVal);
  const merged = mergeSnapshots(snap, serverData, ref.last, baseHashes);
  if (DELTA_MODE) {
    // Modalità veloce: solo le modifiche, mai il blocco intero (una finestra riscritta come se fosse tutto cancellerebbe l'archivio).
    // scope: le entità delle strutture non caricate non si inviano mai (un dato non caricato non è un dato cambiato né cancellato).
    const delta = buildDelta(serverData, ref.last, merged, scope);
    if (!isEmptyDelta(delta) && serverRev !== null) {
      const nr = await postDelta(table, idVal, serverRev, delta);
      if (nr === null) return { merged, wrote: false, ok: false }; // conflitto o rifiuto: ritenta al ciclo dopo
      ref.rev = nr; ref.last = merged; return { merged, wrote: true, ok: true };
    }
    if (serverRev !== null) ref.rev = serverRev;
    ref.last = merged;
    return { merged, wrote: false, ok: true };
  }
  const changedServer = contentSig(merged) !== contentSig(serverData ?? {});
  if (changedServer) {
    const nr = await writeRowWithLock(client, table, idCol, idVal, merged, serverRev);
    if (nr === null) return { merged, wrote: false, ok: false }; // conflitto: ritenta al ciclo dopo
    ref.rev = nr; ref.last = merged; return { merged, wrote: true, ok: true };
  }
  if (serverRev !== null) ref.rev = serverRev;
  ref.last = merged;
  return { merged, wrote: false, ok: true };
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
): Promise<{ changedLocal: boolean; newBlob?: Record<string, string>; wrote: boolean; synced?: boolean; allOk?: boolean; roSig?: string }> {
  const versionAtStart = kvVersion(); // contatore delle scritture locali al momento della fotografia (per l'anti-race più sotto)
  const snap = snapshot();
  if (!("spigolestay:data:v1" in snap)) return { changedLocal: false, wrote: false };
  let fullData: DataObj;
  try { fullData = JSON.parse(snap["spigolestay:data:v1"]) as DataObj; } catch { return { changedLocal: false, wrote: false }; }

  const orgIds = await fetchOrgIds(client, uid);
  const { personal, orgs } = splitByOrg(fullData);
  const orgSids = orgStructureSets(fullData); // strutture di ogni org: conti e regole di incasso di quelle strutture viaggiano nell'org (stessi per tutti i soci)

  // 1) + 2) salva il personale (le chiavi non-dati, es. impostazioni, viaggiano col personale) e ogni org di cui sono membro: IN PARALLELO
  // (righe diverse del database, nessuna dipendenza tra loro: prima erano una dopo l'altra e all'avvio sommavano i tempi di 3-4 trasferimenti da qualche MB).
  const personalSnap = { ...snap, "spigolestay:data:v1": JSON.stringify(personal) };
  const personalRef: SyncRef = { rev: revRef.current, last: lastSynced.current };
  const lastBefore = lastSynced.current;
  const baseHashes = loadSyncBase(uid) ?? {}; // base persistente (solo per lo stato personale): senza base valida vince il server sulle chiavi piatte
  for (const orgId of orgIds) if (!orgRefs.current[orgId]) orgRefs.current[orgId] = { rev: -1, last: {} };
  const [pRes, ...orgResults] = await Promise.all([
    saveOne(client, "app_state", "user_id", uid, personalSnap, personalRef, baseHashes),
    ...orgIds.map((orgId) => {
      const localOrg = orgs.get(orgId) ?? EMPTY_ORG_DATA();
      const orgSnap = { "spigolestay:data:v1": JSON.stringify(localOrg), ...extractOrgCassaConfig(snap, orgSids.get(orgId) ?? new Set<string>()), ...extractOrgPoolConfig(snap, orgSids.get(orgId) ?? new Set<string>(), orgRefs.current[orgId]?.last?.["spigolestay:inventorypool"]) };
      return saveOne(client, "org_state", "org_id", orgId, orgSnap, orgRefs.current[orgId]);
    }),
  ]);
  revRef.current = personalRef.rev; lastSynced.current = personalRef.last;
  const orgMergedDatas: DataObj[] = [];
  const orgCassa: { sids: Set<string>; merged: Record<string, string> }[] = [];
  orgIds.forEach((orgId, i) => { const r = orgResults[i]; if (r) orgCassa.push({ sids: orgSids.get(orgId) ?? new Set<string>(), merged: r.merged }); });
  for (const r of orgResults) { try { orgMergedDatas.push(JSON.parse(r.merged["spigolestay:data:v1"] || "{}") as DataObj); } catch { /* salta */ } }
  for (const k of Object.keys(orgRefs.current)) if (!orgIds.includes(k)) delete orgRefs.current[k]; // pulizia org non più membro

  // 3) ricombina il locale con i risultati (personale + org) e segnala se il locale va aggiornato
  let mergedPersonal: DataObj;
  try { mergedPersonal = JSON.parse(pRes.merged["spigolestay:data:v1"] || "{}") as DataObj; } catch { mergedPersonal = personal; }
  const combined = combineData(mergedPersonal, orgMergedDatas);
  const newBlob: Record<string, string> = { ...pRes.merged, "spigolestay:data:v1": JSON.stringify(combined) };
  // Conti, regole di incasso e conto principale delle strutture condivise: si adotta la versione fusa dell'org (tutti i soci vedono gli stessi).
  for (const oc of orgCassa) { if (oc.sids.size) { Object.assign(newBlob, applyOrgCassaConfig(newBlob, oc.merged, oc.sids)); Object.assign(newBlob, applyOrgPoolConfig(newBlob, oc.merged, oc.sids)); } }

  // ANTI-RACE: la sincronizzazione fotografa il localStorage all'inizio, poi fa round-trip di
  // rete, poi restore() riscrive. Se l'utente SALVA durante il round-trip, restore lo cancellerebbe.
  // Qui preserviamo le chiavi "piatte" modificate DURANTE il ciclo, rileggendo il localStorage attuale
  // (es. spigolestay:billing), e anche il blocco dati: se è cambiato durante il ciclo (kvVersion diverso da
  // quello della fotografia) la versione fresca viene rifusa col risultato del server invece di essere
  // sovrascritta (vedi applyRaceChanges). Le chiavi piatte si confrontano sempre: alcune pagine scrivono
  // direttamente in localStorage senza passare da kvSet (e quindi senza far salire kvVersion).
  try {
    const DK = "spigolestay:data:v1";
    const fresh = snapshot();
    if (kvVersion() === versionAtStart) fresh[DK] = snap[DK]; // nessuna scrittura via kvSet: il blocco dati è certamente quello fotografato
    applyRaceChanges(snap, fresh, newBlob, DK, (l, s, b) => mergeSnapshots({ [DK]: l }, { [DK]: s }, { [DK]: b })[DK]);
  } catch { /* localStorage non disponibile: nessun ritocco */ }

  // Rileva QUALSIASI cambiamento di contenuto (anche di un singolo campo, es. webCheckin,
  // co-ospiti, pagamenti), non solo l'insieme degli ID: altrimenti un check-in completato sul
  // server non veniva mai adottato dal browser (restava "da fare" finché non ricaricavi).
  // Il reload della pagina resta gated su reloadSig (id-set) più avanti, così non introduce loop.
  const changedLocal = contentSig(newBlob) !== contentSig(snap);
  // Modalità veloce: se TUTTO è arrivato sul server (nessun conflitto) ricordo l'impronta dei prezzi forzati locali (serve ad avviare la volta dopo senza copie stantie, vedi pruneLocalForStart).
  const allOk = pRes.ok && orgResults.every((r) => r.ok);
  let roSig: string | undefined;
  if (DELTA_MODE && allOk) { try { roSig = stableStringify((JSON.parse(newBlob["spigolestay:data:v1"] || "{}") as DataObj).rateOverrides ?? {}); } catch { /* impronta non disponibile: nessuna potatura dei prezzi */ } }
  return { changedLocal, newBlob, wrote: pRes.wrote, synced: personalRef.last !== lastBefore, allOk, roSig }; // synced: il ciclo dello stato personale è arrivato in fondo (non un conflitto da ritentare)
}

// Prepara (o disattiva) la modalità veloce per questo dispositivo. Ritorna true se DELTA_MODE è attivo dopo la chiamata.
async function prepareDeltaMode(
uid: string,
revRef: { current: number },
lastSynced: { current: Record<string, string> },
orgRefs: { current: Record<string, SyncRef> },
): Promise<boolean> {
  DELTA_MODE = false;
  let active = "";
  try { active = localStorage.getItem(DELTA_ACTIVE_KEY) || ""; } catch { /* storage non disponibile */ }
  if (!deltaWanted(uid)) { // spenta: la copia locale a finestra si fonde con l'archivio completo del server alla prossima idratazione (base vuota = unione)
    if (active) { try { localStorage.removeItem(DELTA_ACTIVE_KEY); } catch { /* niente */ } }
    return false;
  }
  if (active === uid) { DELTA_MODE = true; return true; }
  try {
    // 1) salva col sistema normale tutto ciò che il locale ha di nuovo (se ha dati di questo account)
    let hasLocal = false;
    try { hasLocal = !!kvGet("spigolestay:data:v1") && !localBelongsToOther(uid); } catch { /* niente */ }
    if (hasLocal) {
      const r = await syncOnce(supabase!, uid, revRef, lastSynced, orgRefs);
      if (r.changedLocal && r.newBlob && !restore(r.newBlob)) return false; // niente spazio: non si cambia nulla
      if (r.synced) commitSyncBase(uid, lastSynced.current);
    }
    // 2) la copia locale dei dati grandi si scarta: si riparte dalla finestra
    kvRemove("spigolestay:data:v1");
    lastSynced.current = {}; orgRefs.current = {}; revRef.current = -1;
    try { sessionStorage.removeItem("spigolestay:hydrated-for"); } catch { /* niente */ }
    try { localStorage.setItem(DELTA_ACTIVE_KEY, uid); } catch { /* niente */ }
    DELTA_MODE = true;
    return true;
  } catch { DELTA_MODE = false; return false; } // salvataggio non riuscito: modalità normale, nessun dato toccato
}

// ─────────────────────────────────────────────────────────────────────────────
// APERTURA PER STRUTTURA (solo modalità veloce): all'avvio si scaricano le prenotazioni/ospiti/eventi/prezzi della sola struttura di apertura (la principale, o quella
// scelta); le altre si caricano quando servono (cambio struttura, «Tutte»…) tramite il «caricatore» registrato da startPush. Vedi struct-load.ts e home-struct.ts.
// ─────────────────────────────────────────────────────────────────────────────
const SYNCED_AT_KEY = "xn-delta-syncedat";   // per dispositivo: quando è iniziato l'ultimo ciclo in cui TUTTO è arrivato sul server
const RO_SIG_KEY = "xn-delta-ro-sig";        // impronta dei prezzi forzati locali in quel momento
const lsRead = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };

function noteDeltaSynced(startedAt: number, roSig: string | undefined) {
  try { localStorage.setItem(SYNCED_AT_KEY, String(startedAt)); if (roSig !== undefined) localStorage.setItem(RO_SIG_KEY, roSig); } catch { /* storage non disponibile */ }
}

// Toglie dalla copia locale (rimasta dalla sessione precedente) le entità delle strutture NON richieste che sono certamente già sul server: sono stantie, appesantiscono
// il telefono e i lavori in sottofondo le scambierebbero per dati freschi. Tutto ciò che potrebbe non essere ancora sincronizzato si tiene (vedi pruneLocalToStructures).
function pruneLocalForStart(ids: string[] | null) {
  if (!ids) return; // "tutte": niente da togliere
  try {
    const raw = kvGet("spigolestay:data:v1"); if (!raw) return;
    const syncedAt = Number(lsRead(SYNCED_AT_KEY) || 0); if (!(syncedAt > 0)) return;
    const d = JSON.parse(raw) as Record<string, unknown>;
    const pruneRates = lsRead(RO_SIG_KEY) === stableStringify(d.rateOverrides ?? {}); // prezzi invariati dall'ultima sincronizzazione riuscita
    kvSet("spigolestay:data:v1", JSON.stringify(pruneLocalToStructures(d, ids, syncedAt, 120000, pruneRates)));
  } catch { /* non si tocca nulla */ }
}

// Fissa la richiesta iniziale (prima di qualsiasi lettura a finestra) e pulisce il locale dalle strutture non richieste.
function initDeltaRequest() {
  let applied = false; try { applied = sessionStorage.getItem(HOME_APPLIED_KEY) === "1"; } catch { /* niente */ }
  initRequested(startRequest({ sessionApplied: applied, savedActive: lsRead("spigolestay:activestruct"), savedSubset: lsRead("spigolestay:activestructs"), hintRaw: lsRead(START_HINT_KEY) }));
  pruneLocalForStart(requestedIds());
}

// Prima sincronizzazione della modalità veloce, PRIMA di mostrare l'app: legge personale + organizzazioni con la sola struttura di apertura, poi (se l'elenco reale delle
// strutture dice che l'apertura è un'altra: indicazione vecchia o mancante) la completa. Gli errori si lasciano al sync periodico, che riprova e usa la stessa richiesta.
async function deltaStartupSync(
  client: SbClient, uid: string,
  revRef: { current: number }, lastSynced: { current: Record<string, string> }, orgRefs: { current: Record<string, SyncRef> },
): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    const req = requestedSnapshot();
    const startedAt = Date.now();
    const r = await syncOnce(client, uid, revRef, lastSynced, orgRefs);
    if (r.changedLocal && r.newBlob) { if (!restore(r.newBlob)) return; if (r.synced) commitSyncBase(uid, lastSynced.current); }
    else if (r.synced) commitSyncBase(uid, lastSynced.current);
    if (r.synced === undefined) return; // locale senza dati: niente da verificare
    markLoaded(req);
    if (r.allOk) noteDeltaSynced(startedAt, r.roSig);
    let sids: string[] = [];
    try { const d = JSON.parse(kvGet("spigolestay:data:v1") || "{}") as { structures?: { id: string; orgId?: string; order?: number; name?: string }[] }; sids = sortStructures(Array.isArray(d.structures) ? d.structures : []).map((s) => s.id); } catch { /* elenco non leggibile */ }
    let applied = false; try { applied = sessionStorage.getItem(HOME_APPLIED_KEY) === "1"; } catch { /* niente */ }
    const sel = resolveSelection({ pref: lsRead(HOME_PREF_KEY), sortedIds: sids, savedActive: lsRead("spigolestay:activestruct"), savedSubset: lsRead("spigolestay:activestructs"), sessionApplied: applied });
    const want = selectionIds(sel, sids);
    const missing = (want === "all" ? sids : want).filter((id) => !structureLoaded(id));
    if (!missing.length) return;
    addRequested(missing, want === "all");
  }
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
  // Solo la farfalla Xenora che pulsa: niente testo e niente pulsanti durante il caricamento.
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>{/* a tutto schermo e centrata: la farfalla sta esattamente al centro, senza spostarsi quando cambia la barra del browser */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/xenora-mark.png" alt={label || "Xenora"} width={72} height={72} style={{ width: 72, height: 72, objectFit: "contain", animation: "xpulse 1.4s ease-in-out infinite" }} />
      <style>{`@keyframes xpulse{0%,100%{opacity:.55;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);
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
  const [hydrateError, setHydrateError] = useState(false);
  const [signingOut, setSigningOut] = useState(false); // uscita in corso: si vede subito un messaggio (il salvataggio finale può durare)
  const sessionUid = session?.user?.id;
  useEffect(() => {
    if (!sessionUid || hydrated) return;
    const t = setTimeout(() => setHydrateError(true), 30000); // niente risposta dal server: schermata con «Riprova» invece della farfalla all'infinito
    return () => clearTimeout(t);
  }, [sessionUid, hydrated]); // impossibile leggere i dati dal server (e nessuna copia locale)
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
  const hydratedUidRef = useRef<string>(""); // utente per cui questo AuthProvider ha avviato la sincronizzazione (se cambia sotto i piedi, es. login con un altro account in un'altra scheda, si riparte da zero)

  const stopPush = () => {
    registerLoader(null);
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
    const loadingGuard = setTimeout(() => { if (mounted) setLoading(false); }, 15000); // rete assente o lenta: si esce dall'attesa (poi login o dati locali)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { setSession(s); setLoading(false); });
    return () => { mounted = false; sub.subscription.unsubscribe(); stopPush(); };
  }, []);

  // 2) Reindirizza al login se non autenticato.
  useEffect(() => {
    if (!supabaseEnabled) return;
    // Dopo l'accesso si apre SEMPRE la dashboard, non l'ultima pagina in cui eri: il percorso si conserva solo per un link preciso (con parametri, es. /prenotazioni?b=<id>).
    if (!loading && !session) { const p = window.location.pathname + window.location.search; router.replace(p === "/" || p.startsWith("/login") || !window.location.search ? "/login" : "/login?next=" + encodeURIComponent(p)); }
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
  }, [sessionUid]); // solo al cambio di utente: un nuovo oggetto sessione (refresh del token, iframe/altra scheda) non deve rimandare in "Verifica sicurezza…" smontando la pagina aperta

  // 2c) Cancello di accesso "SU INVITO": Xenora non è a registrazione aperta. Dopo il login
  // chiediamo al server se l'utente è abilitato (owner, utente esistente, membro, invitato o in
  // allowlist). Se non lo è, lo disconnettiamo e la pagina di login mostra "accesso su invito".
  // Fail-open su errore tecnico: non blocchiamo clienti legittimi per un problema transitorio
  // (i dati restano comunque isolati da RLS).
  useEffect(() => {
    if (!supabaseEnabled || !supabase) { setAccessAllowed(true); return; }
    if (!session) { setAccessAllowed(null); return; }
    // VELOCITÀ: il controllo parte subito, in parallelo alla verifica 2FA (prima aspettava che finisse: due viaggi di rete uno dopo l'altro prima ancora di scaricare i dati).
    // Se questo utente è già stato abilitato nelle ultime 24 ore su questo dispositivo si prosegue SUBITO e il controllo si ripete in sottofondo
    // (se nel frattempo è stato tolto l'accesso, esce come prima). Il server resta comunque protetto da RLS.
    const okKey = "xn-access-ok:" + (session.user?.id ?? "");
    let cachedOk = false;
    try { const t = Number(localStorage.getItem(okKey) || 0); cachedOk = t > 0 && Date.now() - t < 24 * 3600 * 1000; } catch { /* storage non disponibile */ }
    if (cachedOk) setAccessAllowed(true);
    let cancelled = false;
    (async () => {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000);
        const res = await fetch("/api/access/status", { headers: { Authorization: `Bearer ${sessionRef.current?.access_token ?? ""}` }, signal: ctl.signal }).finally(() => clearTimeout(to));
        const j = await res.json().catch(() => null) as { allowed?: boolean } | null;
        if (cancelled) return;
        if (j && j.allowed === false) {
          setAccessAllowed(false);
          try { localStorage.setItem("xn-access-denied", "1"); localStorage.removeItem(okKey); } catch {}
          await supabase!.auth.signOut();
        } else {
          setAccessAllowed(true);
          try { localStorage.removeItem("xn-access-denied"); if (j && j.allowed === true) localStorage.setItem(okKey, String(Date.now())); } catch {}
        }
      } catch {
        if (!cancelled) setAccessAllowed(true); // fail-open: nessun lockout su errore di rete
      }
    })();
    return () => { cancelled = true; };
  }, [sessionUid]);

  // 3) Al login: scarica lo stato dal server e reidrata una sola volta per questo utente/tab.
  useEffect(() => {
    if (!supabaseEnabled || !supabase) return;
    if (!bigReady) return; // prima si carica l'archivio locale dei dati
    const uid = session?.user?.id;
    // L'utente è cambiato mentre questo AuthProvider era già montato (login con un altro account in un'altra scheda dello stesso browser, o uscita da un'altra scheda):
    // si fermano il push e i timer dell'utente precedente e si azzerano versione/base/organizzazioni. Con hydrated=false l'app (con lo stato in memoria del vecchio utente)
    // viene smontata e non può riscrivere i suoi dati sotto il nuovo account; il percorso sotto verifica poi di chi sono i dati locali.
    if (hydratedUidRef.current && hydratedUidRef.current !== (uid || "")) {
      stopPush(); setHydrated(false);
      revRef.current = -1; lastSynced.current = {}; orgRefs.current = {}; lastSigRef.current = ""; lastFullRef.current = 0;
      try { sessionStorage.removeItem("spigolestay:hydrated-for"); } catch { /* niente */ }
      hydratedUidRef.current = "";
    }
    if (!uid) { setHydrated(false); return; }
    hydratedUidRef.current = uid;
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
      // force: sincronizzazione richiesta (es. caricamento di un'altra struttura): salta il controllo «non è cambiato nulla».
      const runSync = async (force: boolean = false) => {
        if (syncingRef.current) return; // già in corso: evita run concorrenti (intervallo + focus)
        syncingRef.current = true;
        let syncOk = false;
        const reqAtStart = DELTA_MODE ? requestedSnapshot() : null; // strutture richieste all'INIZIO del ciclo: sono quelle che il ciclo, se riesce, avrà caricato
        const startedAt = Date.now();
        try {
          // Niente di nuovo né sul server né qui (e sincronizzato da meno di 45 s): non si scarica e non si fonde 4 MB per niente.
          const sigNow = await remoteSyncSig(supabase!, userId);
          const fullSig = sigNow ? sigNow + "#" + cheapLocalSig() : "";
          if (!force && fullSig && fullSig === lastSigRef.current && Date.now() - lastFullRef.current < 45000) return;
          // Sincronizzazione completa: personale (app_state) + eventuali strutture condivise (org_state),
          // con fusione 3 vie + lucchetto. Se non sei in nessuna org, è identico a prima.
          const { newBlob, changedLocal, wrote, synced, allOk, roSig } = await syncOnce(supabase!, userId, revRef, lastSynced, orgRefs);
          if (hydratedUidRef.current !== userId) return; // l'utente è cambiato durante il ciclo: il risultato è di un altro account, non si applica
          syncOk = true;
          if (changedLocal && newBlob) {
            // Il server (o una struttura condivisa) aveva novità: aggiorno SEMPRE il browser…
            const settingsBefore = settingsSig(snapshot()); // com'erano utenti/piano/moduli PRIMA di applicare gli aggiornamenti
            if (!restore(newBlob)) return; // niente spazio: si avvisa l'utente (banner) e non si prosegue
            if (synced) commitSyncBase(userId, lastSynced.current); // locale e server allineati: da qui in poi la base persistente dice "questo è lo stato sincronizzato"
            // …e avviso lo store di ri-leggere in-place (riflette anche i cambi di singolo campo,
            // es. check-in completato/pagamento, senza dover ricaricare la pagina).
            try { window.dispatchEvent(new Event("spigolestay:datasync")); } catch {}
            if (reqAtStart) { markLoaded(reqAtStart); if (allOk) noteDeltaSynced(startedAt, roSig); } // strutture arrivate (DOPO l'aggiornamento dello store: chi aspettava può ora mostrarle)
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
          if (synced) commitSyncBase(userId, lastSynced.current);
          if (reqAtStart) { markLoaded(reqAtStart); if (allOk) noteDeltaSynced(startedAt, roSig); }
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
      pushTimer.current = setInterval(() => { void runSync(); }, 4000);
      // Modalità veloce: caricamento di altre strutture su richiesta (cambio struttura, «Tutte»…). Si aggiungono alla richiesta e si fa subito un ciclo completo;
      // se ne sta già girando uno (con la richiesta di prima) si aspetta che finisca e se ne fa un altro. true = arrivate; false = non riuscito (la vista resta com'è).
      registerLoader(async (need, all) => {
        addRequested(need, all);
        for (let attempt = 0; attempt < 4; attempt++) {
          for (let w = 0; w < 100 && syncingRef.current; w++) await new Promise((r) => setTimeout(r, 150));
          if (syncingRef.current) return false;
          await runSync(true);
          if (need.every((i) => structureLoaded(i))) return true;
        }
        return false;
      });
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
        // Modalità veloce: se lo stato voluto (acceso/spento) coincide con quello di questa copia locale si prosegue com'è (e si ricorda per le letture/scritture);
        // se sta cambiando, niente scorciatoia: si passa dal percorso completo, che prepara (o scioglie) la finestra.
        const wantDelta = deltaWanted(uid);
        let activeUid = ""; try { activeUid = localStorage.getItem(DELTA_ACTIVE_KEY) || ""; } catch { /* niente */ }
        const switching = wantDelta !== (activeUid === uid);
        if (!switching) { DELTA_MODE = wantDelta; setDeltaScopeActive(DELTA_MODE); if (DELTA_MODE) initDeltaRequest(); } // modalità veloce: si fissa PRIMA di qualsiasi lettura quali strutture scaricare
        // La scorciatoia vale solo se i dati locali sono DAVVERO di questo utente: il flag è per scheda ma il localStorage è condiviso tra le schede, quindi un'altra scheda
        // con un altro login può aver messo lì i dati di un altro account (decideEntry: proprietario diverso → niente scorciatoia, si svuota).
        let localOwner: string | null = null; try { localOwner = localStorage.getItem(LOCAL_OWNER_KEY); } catch { /* storage non disponibile */ }
        const entry = decideEntry({ localOwner, uid, sessionFlag: sessionStorage.getItem(flagKey), localHasData });
        if (!switching && entry === "shortcut") {
          try {
            if (DELTA_MODE) await deltaStartupSync(supabase!, uid, revRef, lastSynced, orgRefs); // apertura per struttura: prima la sola struttura di apertura, poi (se serve) il completamento
            else {
              const res = await syncOnce(supabase!, uid, revRef, lastSynced, orgRefs);
              if (res.changedLocal && res.newBlob) { if (restore(res.newBlob) && res.synced) commitSyncBase(uid, lastSynced.current); } // l'app non è ancora montata: parte già con i dati aggiornati
              else if (res.synced) commitSyncBase(uid, lastSynced.current);
            }
          } catch { /* rete assente: riproverà il push periodico */ }
          void syncProfile(uid);
          if (localOwner === null) markLocalOwner(uid); // marcatore mancante ma scheda già reidratata per questo utente: si ripristina (mai su dati di un altro proprietario)
          setHydrated(true);
          startPush(uid);
          return;
        }
        // Il locale appartiene a UN ALTRO account (dispositivo/browser riusato, es. test o PC
        // condiviso): lo svuotiamo PRIMA di leggere/confrontare, così non può in nessun caso
        // essere scambiato per dati "non ancora sincronizzati" di questo utente.
        if (localBelongsToOther(uid)) wipeLocalAccount();
        // Modalità veloce: prima volta su questo dispositivo → si salva TUTTO ciò che c'è in locale con la modalità normale, poi la copia locale dei dati
        // si scarta e si riparte dalla finestra. Se il salvataggio non riesce non si cambia nulla (resta la modalità normale).
        await prepareDeltaMode(uid, revRef, lastSynced, orgRefs); // se non riesce DELTA_MODE resta falso: modalità normale
        setDeltaScopeActive(DELTA_MODE);
        if (DELTA_MODE) initDeltaRequest(); // quali strutture scaricare (la principale / quella scelta) e pulizia delle copie locali stantie delle altre
        const { data: serverData, rev: serverRev, hadData: serverHadData } = await readServer(supabase!, uid);
        if (cancelled) return;
        const serverReal = hasRealData(serverData) || (DELTA_MODE && serverHadData); // a finestra per struttura la riga può sembrare vuota (ospiti e prenotazioni di altre strutture non sono nella finestra)
        let localReal = false;
        try { localReal = hasRealData({ "spigolestay:data:v1": kvGet("spigolestay:data:v1") ?? "" }); } catch {}

        if (serverReal) {
          // Il server ha DATI REALI. Fondo con l'eventuale locale (per non perdere modifiche fatte
          // offline su questo dispositivo) e reidrato dal risultato.
          const snap = snapshot();
          const merged = ("spigolestay:data:v1" in snap)
            ? mergeSnapshots(snap, serverData, {}, loadSyncBase(uid) ?? {}) // prima idratazione: base in memoria vuota => unione; per le chiavi piatte conta la base persistente (senza: vince il server)
            : serverData!;
          const okR = restore(merged);
          lastSynced.current = merged;
          revRef.current = serverRev ?? 0;
          // Se la fusione ha aggiunto qualcosa al server, riallineo il server.
          // In modalità veloce NON si riscrive qui il «fuso» intero: contiene anche le strutture condivise (che vanno nell'organizzazione, non nella riga personale).
          // Ci pensa subito la prima sincronizzazione (syncOnce), che divide per organizzazione e invia solo le modifiche vere.
          let pushedOk = true; // la base persistente si aggiorna solo se il server ha davvero lo stato fuso
          if (DELTA_MODE) { /* niente scrittura all'avvio */ }
          else if (contentSig(merged) !== contentSig(serverData ?? {})) {
            const nr = await writeWithLock(supabase!, uid, merged, serverRev);
            if (nr !== null) revRef.current = nr; else pushedOk = false;
          }
          if (okR && pushedOk && !DELTA_MODE) commitSyncBase(uid, merged);
          sessionStorage.setItem(flagKey, uid); markLocalOwner(uid);
          // Modalità veloce: prima di mostrare l'app si legge anche l'elenco delle strutture condivise (organizzazioni) con la sola struttura di apertura, così all'apertura
          // c'è già tutto ciò che serve. Se fallisce non è grave: il sync periodico riprova con la stessa richiesta.
          if (DELTA_MODE && okR) { try { await deltaStartupSync(supabase!, uid, revRef, lastSynced, orgRefs); } catch { /* riprova il sync periodico */ } }
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
          // Modalità veloce: mai riscrivere la riga intera con uno stato parziale (finestra per struttura): ci pensa il sync a delta.
          const nr = DELTA_MODE ? null : await writeWithLock(supabase!, uid, merged, serverRev);
          revRef.current = nr ?? (serverRev ?? 0);
          lastSynced.current = DELTA_MODE ? (serverData ?? {}) : merged;
          if (nr !== null && !DELTA_MODE) commitSyncBase(uid, merged);
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
          if (okS && !DELTA_MODE) commitSyncBase(uid, serverData);
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
        if (nr !== null) commitSyncBase(uid, snap);
        await syncProfile(uid);
        sessionStorage.setItem(flagKey, uid); markLocalOwner(uid);
        setHydrated(true);
        startPush(uid);
        return;
      } catch {
        // Modalità veloce: se la lettura a finestra non riesce il «Riprova» riparte dalla modalità normale per tutta la sessione (mai bloccati fuori dai propri dati).
        // (marcatore di SESSIONE: niente loop di tentativi a ogni ricaricamento, ma la scelta dell'utente non si spegne per sempre per un errore passeggero.)
        if (DELTA_MODE) { try { sessionStorage.setItem(DELTA_FAILED_KEY, uid); } catch { /* niente */ } }
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
    setSigningOut(true);
    stopPush();
    let saved = false;
    const uid = session?.user?.id;
    // Il salvataggio finale ha al massimo 10 secondi: se la rete è lenta si esce lo stesso, e i dati restano su questo dispositivo (non si cancellano finché non sono sul server).
    const finalSave = async () => {
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
    };
    await Promise.race([finalSave(), new Promise<void>((r) => setTimeout(r, 10000))]);
    try { if (supabase) await supabase.auth.signOut(); } catch { /* si esce comunque */ }
    try { sessionStorage.removeItem("spigolestay:hydrated-for"); } catch {}
    // Svuota i dati locali SOLO se sono stati salvati sul server, altrimenti li perderei
    // (es. tabella app_state non ancora creata / rete assente).
    if (saved) wipeLocalAccount();
    router.replace("/login");
  };

  const value: AuthCtx = { user: session?.user ?? null, session, enabled: supabaseEnabled, signOut };

  // Modalità solo-locale (variabili non configurate): nessun gate.
  if (signingOut) return <Splash label="Uscita in corso…" />;
  if (!bigReady) return <Splash label="Avvio…" />;
  if (!supabaseEnabled) return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  if (loading) return <Splash label="Avvio…" />;
  if (!session) return <Splash label="Reindirizzamento all'accesso…" />;
  if (!mfaChecked) return <Splash label="Verifica sicurezza…" />;
  if (mfaNeeded) return <MfaChallenge onVerified={() => setMfaNeeded(false)} onSignOut={signOut} />;
  if (accessAllowed === null) return <Splash label="Verifica accesso…" />;
  if (accessAllowed === false) return <Splash label="Accesso su invito — reindirizzamento…" />;
  if (hydrateError && !hydrated) return (
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
          Spazio del browser esaurito: le ultime modifiche potrebbero non essere salvate su questo dispositivo. Svuota i dati del sito xenora.it dalle impostazioni del browser e riaccedi (i dati restano sul server), oppure scrivici.{(() => { const d = lastIdbError(); return d ? ` [${d}]` : ""; })()}
        </div>
      )}
      <DeltaBar />
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return { user: null, session: null, enabled: false, signOut: async () => {} };
  return ctx;
}
