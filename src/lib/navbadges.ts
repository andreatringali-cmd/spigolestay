"use client";

// Badge numerici della barra laterale: messaggi nuovi, prenotazioni nuove e le altre cose che chiedono attenzione.
// Tutto si ricava dai dati già presenti nel browser (più qualche conteggio leggero su Supabase, al massimo uno al minuto).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "./store";
import { supabase } from "./supabase";
import { inScope } from "./scope";
import { toISO } from "./dates";

export type NavBadges = Record<string, number>; // href → numero (assente o 0 = nessun badge)

const THREADS_KEY = "spigolestay:threads:v1";
const MSG_SEEN_KEY = "nav:msgseen";      // conversazione → timestamp dell'ultimo messaggio visto (solo su questo dispositivo, non sincronizzato)
const BK_SEEN_KEY = "nav:bookingseen";   // id delle prenotazioni già viste (solo su questo dispositivo: non pesa sulla sincronizzazione)
const BK_MAX = 4000;

type ThreadMsg = { dir?: string; ts?: number };

const readJson = <T,>(key: string, fallback: T): T => { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fallback; } catch { return fallback; } };
const writeJson = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };

/** Segna una conversazione come letta (chiamata dalla chat quando la apri o mentre è aperta). */
export function markThreadSeen(threadKey: string, messages: ThreadMsg[] | undefined) {
  const last = Math.max(0, ...(messages ?? []).filter((m) => m.dir === "in").map((m) => m.ts ?? 0));
  if (!last) return;
  const seen = readJson<Record<string, number>>(MSG_SEEN_KEY, {});
  if ((seen[threadKey] ?? 0) >= last) return;
  seen[threadKey] = last;
  writeJson(MSG_SEEN_KEY, seen);
  try { window.dispatchEvent(new Event("spigolestay:navseen")); } catch {}
}

/** True se nella conversazione c'è un messaggio ricevuto dopo l'ultima volta che l'hai aperta. */
export function isThreadUnread(threadKey: string, messages: ThreadMsg[] | undefined): boolean {
  const last = Math.max(0, ...(messages ?? []).filter((m) => m.dir === "in").map((m) => m.ts ?? 0));
  if (!last) return false;
  unreadMessages(); // al primo avvio fissa la base: ciò che c'è già conta come letto
  const seen = readJson<Record<string, number>>(MSG_SEEN_KEY, {});
  return last > (seen[threadKey] ?? 0);
}

function unreadMessages(): number {
  const threads = readJson<Record<string, ThreadMsg[]>>(THREADS_KEY, {});
  let seen = readJson<Record<string, number> | null>(MSG_SEEN_KEY, null);
  if (seen === null) {
    // Prima volta: tutto ciò che c'è già conta come letto, altrimenti compare un numero enorme senza senso.
    seen = {};
    for (const [k, list] of Object.entries(threads)) { const last = Math.max(0, ...(list ?? []).filter((m) => m.dir === "in").map((m) => m.ts ?? 0)); if (last) seen[k] = last; }
    writeJson(MSG_SEEN_KEY, seen);
  }
  let n = 0;
  for (const [k, list] of Object.entries(threads)) {
    const s = seen[k] ?? 0;
    for (const m of list ?? []) if (m.dir === "in" && (m.ts ?? 0) > s) n++;
  }
  return n;
}

export function useNavBadges(pathname: string): NavBadges {
  const { bookings, activeStructureId } = useData();
  const [tick, setTick] = useState(0);
  const [msgs, setMsgs] = useState(0);
  const [issues, setIssues] = useState(0);
  const [remote, setRemote] = useState({ schedine: 0, istat: 0, scartate: 0 });
  const [bkNew, setBkNew] = useState(0);
  const today = toISO(new Date());

  // Ricalcolo su sync, messaggi, ritorno sulla scheda e quando una conversazione viene letta.
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    const ev = ["focus", "spigolestay:datasync", "spigolestay:threads", "spigolestay:navseen", "storage"];
    ev.forEach((e) => window.addEventListener(e, h));
    return () => ev.forEach((e) => window.removeEventListener(e, h));
  }, []);

  // Messaggi non letti + segnalazioni di pulizia aperte (locali, istantanei)
  useEffect(() => {
    setMsgs(unreadMessages());
    const list = readJson<{ resolved?: boolean; _deleted?: boolean; structureId?: string }[]>("spigolestay:pulizie:issues", []);
    setIssues(list.filter((i) => !i.resolved && !i._deleted && inScope(i.structureId, activeStructureId)).length);
  }, [tick, activeStructureId]);

  // Prenotazioni nuove: quelle non ancora viste, ancora in corso o future (lo storico importato non conta).
  const liveIds = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" && b.checkOut >= today && inScope(b.structureId, activeStructureId)).map((b) => b.id),
    [bookings, today, activeStructureId],
  );
  useEffect(() => {
    if (!bookings.length) { setBkNew(0); return; }
    let seen = readJson<string[] | null>(BK_SEEN_KEY, null);
    const onPage = pathname === "/prenotazioni" || pathname.startsWith("/prenotazioni/");
    if (seen === null || onPage) {
      // Prima volta, oppure stai guardando la pagina Prenotazioni: tutto ciò che c'è ora è visto.
      const all = Array.from(new Set([...(seen ?? []), ...bookings.map((b) => b.id)])).slice(-BK_MAX);
      writeJson(BK_SEEN_KEY, all);
      setBkNew(0);
      return;
    }
    const set = new Set(seen);
    setBkNew(liveIds.filter((id) => !set.has(id)).length);
  }, [bookings, liveIds, pathname, tick]);

  // Conteggi leggeri su Supabase (schedine pronte, ISTAT da inviare, fatture scartate), al massimo uno al minuto
  const loadRemote = useCallback(async () => {
    if (!supabase) return;
    try {
      const head = { count: "exact" as const, head: true };
      // Ogni struttura ha i suoi conti: con una struttura attiva contano solo le sue righe (e quelle "per tutte", senza struttura), come nelle pagine.
      const mine = <T extends { or: (f: string) => T }>(q: T): T => (activeStructureId && activeStructureId !== "all" ? q.or(`structure_id.eq.${activeStructureId},structure_id.is.null`) : q);
      const [a, i, d] = await Promise.all([
        mine(supabase.from("alloggiati_schedine").select("id", head).in("stato", ["pronta", "da_validare"])),
        mine(supabase.from("istat_rows").select("id", head).eq("stato", "pending").lte("arrival", today)),
        mine(supabase.from("documents").select("id", head).eq("stato", "scartata")),
      ]);
      setRemote({ schedine: a.count ?? 0, istat: i.count ?? 0, scartate: d.count ?? 0 });
    } catch {}
  }, [today, activeStructureId]);
  useEffect(() => {
    void loadRemote();
    const id = setInterval(() => { void loadRemote(); }, 60000);
    return () => clearInterval(id);
  }, [loadRemote]);

  // Check-in da completare per gli arrivi di oggi (dati già in memoria)
  const checkinToday = useMemo(() => bookings.filter((b) => b.checkIn === today && b.status !== "cancelled" && b.status !== "no_show" && b.channel !== "blocked" && inScope(b.structureId, activeStructureId)
    && !(b.webCheckin === true || !!(b.primaryGuest?.lastName && b.primaryGuest?.docNumber))).length, [bookings, today, activeStructureId]);

  return useMemo(() => ({
    "/messaggi": msgs,
    "/prenotazioni": bkNew,
    "/adempimenti": checkinToday + remote.schedine + remote.istat,
    "/alloggiati-web": remote.schedine,
    "/istat": remote.istat,
    "/documenti": remote.scartate,
    "/pulizie": issues,
  }), [msgs, bkNew, checkinToday, remote, issues]);
}
