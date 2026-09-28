// ============================================================
//  Certificazione Channex — logica dei 13 scenari di test.
//  File NUOVO e ISOLATO: importa gli helper condivisi (channex.ts, dates.ts)
//  ma NON modifica nulla di esistente. Usato SOLO dalla route admin
//  /api/channex/cert/run per eseguire gli scenari e raccogliere i task_id.
//
//  Ogni scenario costruisce valori REALI (con date FUTURE e room_type/rate_plan
//  presi da Channex tramite channex_map) e li invia agli endpoint ARI reali di
//  Channex (staging). Restituisce, per ogni chiamata, il task_id (che serve per
//  compilare il form di certificazione) e l'esito.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listProperties,
  listRoomTypesFor,
  listRatePlansForRoomType,
  createProperty,
  createRoomType,
  createRatePlan,
  pushAvailability,
  pushRestrictions,
  ackBookingRevision,
  listBookingRevisions,
  type AvailValue,
  type RestrictionRow,
  type ChannexResult,
} from "@/lib/channex";
import { addDays, toISO } from "@/lib/dates";

// Scenari eseguibili con un bottone (1..10). 11/12/13 sono coperti dall'infrastruttura
// (ciclo prenotazioni, coda rate-limit in channex.ts, delta in ChannexAutoSync) e non
// si eseguono da qui.
export type ScenarioId = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";
export const SCENARIO_IDS: ScenarioId[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  "1": "Full Data Sync",
  "2": "Single date, single rate",
  "3": "Single date, multiple rates",
  "4": "Multiple dates, multiple rates",
  "5": "Min stay update",
  "6": "Stop sell update",
  "7": "Multiple restrictions",
  "8": "Half-year update",
  "9": "Single date availability",
  "10": "Multiple date availability",
};

// Una tipologia camera reale su Channex.
export interface CertRoomType { roomTypeId: string; roomTitle: string }
// Una combinazione reale room_type + rate_plan su Channex (necessaria per prezzi/restrizioni).
export interface CertCombo { roomTypeId: string; roomTitle: string; ratePlanId: string; ratePlanTitle: string }

export interface CertContext {
  propertyId: string;
  propertyTitle: string;
  structureId: string;
  roomTypes: CertRoomType[];
  combos: CertCombo[];
}

// Esito di una singola chiamata ARI a Channex.
export interface CertCall {
  endpoint: string;           // "/availability" | "/restrictions"
  ok: boolean;
  status: number;
  taskId: string | null;      // il task_id restituito da Channex (per la certificazione)
  sent: number;               // numero di righe (values) inviate
  error?: string;
  raw?: unknown;              // risposta grezza quando il task_id non è individuabile
}

export interface CertResult {
  ok: boolean;
  scenario: ScenarioId;
  label: string;
  calls: CertCall[];
  error?: string;             // errore "di contesto" (es. nessuna struttura collegata)
}

// ── Estrazione del task_id ────────────────────────────────────────────────
// La risposta ARI di Channex contiene un identificativo del task in una di
// queste posizioni (la forma varia): data.data.id, data.data.task_id,
// data.data.attributes.task_id, data.meta.task_id, data.meta.id, data.task_id,
// data.id, oppure il primo elemento di data.data se è un array.
// Se non troviamo nulla, restituiamo null e la risposta grezza (raw) così
// l'utente vede comunque cosa ha risposto Channex.
function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function prop(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}
export function extractTaskId(data: unknown): string | null {
  const dd = prop(data, "data");
  const meta = prop(data, "meta");
  const candidates = [
    asStr(prop(dd, "id")),
    asStr(prop(dd, "task_id")),
    asStr(prop(prop(dd, "attributes"), "task_id")),
    asStr(prop(meta, "task_id")),
    asStr(prop(meta, "id")),
    asStr(prop(data, "task_id")),
    asStr(prop(data, "id")),
  ];
  for (const c of candidates) if (c) return c;
  if (Array.isArray(dd) && dd.length > 0) {
    const id = asStr(prop(dd[0], "id"));
    if (id) return id;
  }
  return null;
}

function toCall(endpoint: string, sent: number, res: ChannexResult): CertCall {
  const taskId = res.ok ? extractTaskId(res.data) : null;
  return {
    endpoint,
    sent,
    ok: res.ok,
    status: res.status,
    taskId,
    error: res.ok ? undefined : res.error,
    raw: res.ok && !taskId ? res.data : undefined,
  };
}

// ── Contesto: property + room_type + rate_plan REALI presi da Channex ──────
type ChannexListRow = { id: string; attributes?: { title?: string } };

// ============================================================
//  Property di TEST dedicata alla certificazione Channex.
//  La certificazione va eseguita su una property SEPARATA dalla struttura reale.
//  La creiamo via API con una spec fissa e restituiamo TUTTI gli ID da incollare
//  nel form di certificazione.
// ============================================================
export const TEST_PROPERTY_TITLE = "Test Property - Xenora";
const TEST_TWIN_TITLE = "Twin Room";
const TEST_DOUBLE_TITLE = "Double Room";
const TEST_BAR_TITLE = "Best Available Rate";
const TEST_BB_TITLE = "Bed & Breakfast Rate";
const TEST_CURRENCY = "USD";

// Risultato del setup: tutti gli ID Channex + i titoli (per chiarezza) + eventuali errori per-step.
// Due rate plan per tipologia (BAR + B&B): 4 rate plan totali.
export interface TestPropertySetup {
  ok: boolean;
  reused: boolean;              // true se la property esisteva già ed è stata riusata
  propertyId: string | null;
  propertyTitle: string;
  twinRoomId: string | null;
  twinRoomTitle: string;
  twinBarId: string | null;    // rate plan "Best Available Rate" della Twin Room
  twinBbId: string | null;     // rate plan "Bed & Breakfast Rate" della Twin Room
  doubleRoomId: string | null;
  doubleRoomTitle: string;
  doubleBarId: string | null;  // rate plan "Best Available Rate" della Double Room
  doubleBbId: string | null;   // rate plan "Bed & Breakfast Rate" della Double Room
  errors: string[];
}

// Estrae l'id dalla risposta di una create* (forma { data: { id } }).
function createdId(res: ChannexResult<{ data?: { id?: string } }>): string | null {
  return res.ok && res.data?.data?.id ? String(res.data.data.id) : null;
}

// Crea (o riusa) la property di test con i due room type e un rate plan per tipologia.
// IDEMPOTENTE: se una property con lo stesso title esiste già, la riusa; idem per
// room type e rate plan (match per title). Cliccare due volte NON crea doppioni.
export async function setupTestProperty(): Promise<TestPropertySetup> {
  const errors: string[] = [];
  const out: TestPropertySetup = {
    ok: false,
    reused: false,
    propertyId: null,
    propertyTitle: TEST_PROPERTY_TITLE,
    twinRoomId: null,
    twinRoomTitle: TEST_TWIN_TITLE,
    twinBarId: null,
    twinBbId: null,
    doubleRoomId: null,
    doubleRoomTitle: TEST_DOUBLE_TITLE,
    doubleBarId: null,
    doubleBbId: null,
    errors,
  };

  // 1) PROPERTY — riusa se già presente (match per title), altrimenti creala (currency USD).
  const listed = await listProperties();
  if (!listed.ok) {
    errors.push(`Elenco property fallito: ${listed.error ?? listed.status}`);
    return out;
  }
  const existingProp = (listed.data?.data ?? []).find(
    (p) => String(p.attributes?.title ?? "").trim() === TEST_PROPERTY_TITLE,
  );
  if (existingProp) {
    out.propertyId = String(existingProp.id);
    out.reused = true;
  } else {
    const created = await createProperty({ title: TEST_PROPERTY_TITLE, currency: TEST_CURRENCY, country: "IT" });
    const pid = createdId(created);
    if (!pid) {
      errors.push(`Creazione property fallita: ${created.error ?? created.status}`);
      return out;
    }
    out.propertyId = pid;
  }
  const propertyId = out.propertyId;

  // 2) ROOM TYPE — Twin (count 8) e Double (count 1), occupancy adulti 2.
  //    Riusa quelli già presenti (match per title), crea solo i mancanti.
  const rtRes = await listRoomTypesFor(propertyId);
  const existingRooms = (rtRes.ok ? (rtRes.data?.data ?? []) : []) as ChannexListRow[];
  const ensureRoom = async (title: string, count: number): Promise<string | null> => {
    const found = existingRooms.find((r) => String(r.attributes?.title ?? "").trim() === title);
    if (found) return String(found.id);
    const created = await createRoomType(propertyId, { title, count, occAdults: 2 });
    const id = createdId(created);
    if (!id) errors.push(`Creazione room type "${title}" fallita: ${created.error ?? created.status}`);
    return id;
  };
  out.twinRoomId = await ensureRoom(TEST_TWIN_TITLE, 8);
  out.doubleRoomId = await ensureRoom(TEST_DOUBLE_TITLE, 1);

  // 3) RATE PLAN — DUE per tipologia: "Best Available Rate" (100) e "Bed & Breakfast Rate" (120), USD.
  //    Riusa (match ESATTO per title) il rate plan esistente, crea solo i mancanti → niente doppioni.
  const ensureRate = async (roomTypeId: string | null, title: string, rate: number, label: string): Promise<string | null> => {
    if (!roomTypeId) return null;
    const rpRes = await listRatePlansForRoomType(roomTypeId);
    const rows = (rpRes.ok ? (rpRes.data?.data ?? []) : []) as ChannexListRow[];
    const found = rows.find((r) => String(r.attributes?.title ?? "").trim() === title);
    if (found) return String(found.id);
    const created = await createRatePlan(propertyId, roomTypeId, { title, occupancy: 2, rate, currency: TEST_CURRENCY });
    const id = createdId(created);
    if (!id) errors.push(`Creazione rate plan "${title}" per ${label} fallita: ${created.error ?? created.status}`);
    return id;
  };
  out.twinBarId = await ensureRate(out.twinRoomId, TEST_BAR_TITLE, 100, "Twin Room");
  out.twinBbId = await ensureRate(out.twinRoomId, TEST_BB_TITLE, 120, "Twin Room");
  out.doubleBarId = await ensureRate(out.doubleRoomId, TEST_BAR_TITLE, 100, "Double Room");
  out.doubleBbId = await ensureRate(out.doubleRoomId, TEST_BB_TITLE, 120, "Double Room");

  out.ok = !!(out.propertyId && out.twinRoomId && out.twinBarId && out.twinBbId && out.doubleRoomId && out.doubleBarId && out.doubleBbId);
  return out;
}

// Contesto ricavato dalla property di TEST (se esiste su Channex). Serve a far girare
// gli scenari 1..10 sulla property di test invece che sulla struttura reale.
async function testPropertyContext(): Promise<CertContext | null> {
  const listed = await listProperties();
  if (!listed.ok) return null;
  const found = (listed.data?.data ?? []).find(
    (p) => String(p.attributes?.title ?? "").trim() === TEST_PROPERTY_TITLE,
  );
  if (!found) return null;

  const propertyId = String(found.id);
  const propertyTitle = String(found.attributes?.title ?? TEST_PROPERTY_TITLE);
  const rtRes = await listRoomTypesFor(propertyId);
  if (!rtRes.ok) return null;
  const roomRows = (rtRes.data?.data ?? []) as ChannexListRow[];
  if (roomRows.length === 0) return null;

  const roomTypes: CertRoomType[] = roomRows.map((r) => ({ roomTypeId: String(r.id), roomTitle: String(r.attributes?.title ?? r.id) }));
  const combos: CertCombo[] = [];
  for (const rt of roomTypes) {
    const rpRes = await listRatePlansForRoomType(rt.roomTypeId);
    const rpRows = (rpRes.ok ? (rpRes.data?.data ?? []) : []) as ChannexListRow[];
    for (const rp of rpRows) {
      combos.push({ roomTypeId: rt.roomTypeId, roomTitle: rt.roomTitle, ratePlanId: String(rp.id), ratePlanTitle: String(rp.attributes?.title ?? rp.id) });
    }
  }
  return { propertyId, propertyTitle, structureId: "", roomTypes, combos };
}

export async function resolveCertContext(admin: SupabaseClient, tenantId: string): Promise<CertContext | { error: string }> {
  // Preferisci SEMPRE la property di test se esiste: gli scenari girano su di essa,
  // separata dalla struttura reale. Se non c'è, si ripiega su channex_map.
  const test = await testPropertyContext();
  if (test) return test;

  const { data: maps } = await admin
    .from("channex_map")
    .select("channex_property_id, structure_id, rooms")
    .eq("tenant_id", tenantId)
    .limit(1);
  const map = maps?.[0] as { channex_property_id?: string; structure_id?: string } | undefined;
  if (!map?.channex_property_id) {
    return { error: "Nessuna struttura collegata a Channex. Collega prima una struttura in Channel Manager." };
  }
  const propertyId = String(map.channex_property_id);
  const structureId = String(map.structure_id ?? "");

  // Titolo della property reale (per chiarezza nel form): lo cerchiamo nell'elenco property.
  let propertyTitle = propertyId;
  const propsList = await listProperties();
  if (propsList.ok) {
    const p = (propsList.data?.data ?? []).find((x) => String(x.id) === propertyId);
    if (p) propertyTitle = String(p.attributes?.title ?? propertyId);
  }

  const rtRes = await listRoomTypesFor(propertyId);
  if (!rtRes.ok) return { error: `Impossibile leggere le tipologie camera da Channex: ${rtRes.error ?? rtRes.status}` };
  const roomRows = (rtRes.data?.data ?? []) as ChannexListRow[];
  if (roomRows.length === 0) return { error: "La struttura collegata non ha tipologie camera su Channex." };

  const roomTypes: CertRoomType[] = roomRows.map((r) => ({ roomTypeId: String(r.id), roomTitle: String(r.attributes?.title ?? r.id) }));

  const combos: CertCombo[] = [];
  for (const rt of roomTypes) {
    const rpRes = await listRatePlansForRoomType(rt.roomTypeId);
    const rpRows = (rpRes.ok ? (rpRes.data?.data ?? []) : []) as ChannexListRow[];
    for (const rp of rpRows) {
      combos.push({ roomTypeId: rt.roomTypeId, roomTitle: rt.roomTitle, ratePlanId: String(rp.id), ratePlanTitle: String(rp.attributes?.title ?? rp.id) });
    }
  }
  return { propertyId, propertyTitle, structureId, roomTypes, combos };
}

// ── Helper (valori FISSI come da specifica certificazione Channex) ─────────
// Prezzo come stringa a 2 decimali.
const RATE = (n: number) => n.toFixed(2);
// Base date per il full sync (500 giorni deterministici).
const FULL_START = new Date("2026-11-01T00:00:00Z");
const isoFull = (o: number) => toISO(addDays(FULL_START, o));

// Risolve il rate_plan per (titolo camera, titolo piano): match esatto, poi "contiene".
// Così targettiamo ESATTAMENTE i 4 piani richiesti (Twin/Double × Best Available/Bed & Breakfast)
// e non includiamo piani extra (es. eventuali piani di default creati da Channex).
function planId(ctx: CertContext, roomTitle: string, planTitle: string): string | undefined {
  const rt = roomTitle.trim().toLowerCase(), pt = planTitle.trim().toLowerCase();
  const exact = ctx.combos.find((c) => c.roomTitle.trim().toLowerCase() === rt && c.ratePlanTitle.trim().toLowerCase() === pt);
  if (exact) return exact.ratePlanId;
  const rk = rt.split(" ")[0], pk = pt.split(" ")[0]; // "twin"/"double", "best"/"bed"
  return ctx.combos.find((c) => c.roomTitle.toLowerCase().includes(rk) && c.ratePlanTitle.toLowerCase().includes(pk))?.ratePlanId;
}
function roomId(ctx: CertContext, roomTitle: string): string | undefined {
  const rt = roomTitle.trim().toLowerCase();
  return (ctx.roomTypes.find((r) => r.roomTitle.trim().toLowerCase() === rt)
    ?? ctx.roomTypes.find((r) => r.roomTitle.toLowerCase().includes(rt.split(" ")[0])))?.roomTypeId;
}
// Se manca qualche piano/camera richiesto, ritorna un errore chiaro (altrimenti null).
function missingCtx(scenario: ScenarioId, label: string, pairs: [string, string | undefined][]): CertResult | null {
  const miss = pairs.filter(([, v]) => !v).map(([n]) => n);
  return miss.length ? { ok: false, scenario, label, calls: [], error: `Non trovati su Channex: ${miss.join(", ")}. Ricrea la property di test (i titoli devono essere Twin Room / Double Room · Best Available Rate / Bed & Breakfast Rate).` } : null;
}

function done(scenario: ScenarioId, calls: CertCall[]): CertResult {
  return { ok: calls.length > 0 && calls.every((c) => c.ok), scenario, label: SCENARIO_LABELS[scenario], calls };
}

// ── Test 11: ACK delle prenotazioni di test ────────────────────────────────
// La property di test NON è in channex_map, quindi l'import normale la salta senza fare ack.
// Qui leggiamo tutte le revision della property di test e facciamo ACK di ciascuna, così Channex
// registra `booking_revision_acknowledged` per la nuova/modificata/cancellata (dal nostro IP server).
export interface AckResult { ok: boolean; acked: number; ids: string[]; error?: string }
export async function ackTestBookings(admin: SupabaseClient, tenantId: string): Promise<AckResult> {
  const ctx = await resolveCertContext(admin, tenantId);
  if ("error" in ctx) return { ok: false, acked: 0, ids: [], error: ctx.error };
  const list = await listBookingRevisions({ propertyId: ctx.propertyId, limit: 100 });
  if (!list.ok) return { ok: false, acked: 0, ids: [], error: list.error };
  const ids = Array.from(new Set(list.rows.map((r) => r.id).filter(Boolean)));
  if (ids.length === 0) return { ok: true, acked: 0, ids: [], error: "Nessuna revision trovata: crea prima la prenotazione di test (Booking CRS) e modificala/cancellala." };
  let acked = 0;
  for (const id of ids) { const a = await ackBookingRevision(id); if (a.ok) acked++; }
  return { ok: true, acked, ids };
}

// ── Esecutore principale ──────────────────────────────────────────────────
export async function runCertScenario(admin: SupabaseClient, tenantId: string, scenario: ScenarioId): Promise<CertResult> {
  const label = SCENARIO_LABELS[scenario];
  const ctx = await resolveCertContext(admin, tenantId);
  if ("error" in ctx) return { ok: false, scenario, label, calls: [], error: ctx.error };

  const P = ctx.propertyId;

  // Risolvi i 4 piani e le 2 camere richiesti dalla certificazione (per titolo).
  const twinBAR = planId(ctx, "Twin Room", "Best Available Rate");
  const twinBB = planId(ctx, "Twin Room", "Bed & Breakfast Rate");
  const dblBAR = planId(ctx, "Double Room", "Best Available Rate");
  const dblBB = planId(ctx, "Double Room", "Bed & Breakfast Rate");
  const twinRoom = roomId(ctx, "Twin Room");
  const dblRoom = roomId(ctx, "Double Room");
  // Costruttore riga restrizione (property fissa).
  const R = (rate_plan_id: string, extra: Partial<RestrictionRow>): RestrictionRow => ({ property_id: P, rate_plan_id, ...extra });

  switch (scenario) {
    // 1) FULL SYNC — 500 gg, 2 chiamate. Ogni riga restrizione include TUTTE le restrizioni
    //    dichiarate (rate, min_stay_arrival, min_stay_through, stop_sell, closed_to_arrival/departure).
    case "1": {
      const miss = missingCtx(scenario, label, [["Twin Room", twinRoom], ["Double Room", dblRoom], ["Twin Best Available Rate", twinBAR], ["Twin Bed & Breakfast Rate", twinBB], ["Double Best Available Rate", dblBAR], ["Double Bed & Breakfast Rate", dblBB]]);
      if (miss) return miss;
      const days = 500;
      const rooms = [twinRoom!, dblRoom!];
      const plans = [twinBAR!, twinBB!, dblBAR!, dblBB!];
      const avail: AvailValue[] = [];
      for (const rid of rooms) for (let o = 0; o < days; o++) avail.push({ property_id: P, room_type_id: rid, date: isoFull(o), availability: 1 + ((o * 7) % 9) });
      const restr: RestrictionRow[] = [];
      for (let pi = 0; pi < plans.length; pi++) {
        for (let o = 0; o < days; o++) {
          const wd = addDays(FULL_START, o).getUTCDay();
          const weekend = wd === 0 || wd === 6;
          restr.push(R(plans[pi], {
            date: isoFull(o),
            rate: RATE(80 + ((o * 3 + pi * 11) % 60) + (weekend ? 20 : 0)),
            min_stay_arrival: 1, min_stay_through: 1,
            stop_sell: false, closed_to_arrival: false, closed_to_departure: false,
          }));
        }
      }
      const calls: CertCall[] = [];
      calls.push(toCall("/availability", avail.length, await pushAvailability(avail)));
      calls.push(toCall("/restrictions", restr.length, await pushRestrictions(restr)));
      return done(scenario, calls);
    }

    // 2) SINGLE DATE / SINGLE RATE — Twin BAR, 2026-11-22, 333.
    case "2": {
      const miss = missingCtx(scenario, label, [["Twin Best Available Rate", twinBAR]]); if (miss) return miss;
      const restr = [R(twinBAR!, { date: "2026-11-22", rate: RATE(333) })];
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 3) SINGLE DATE / MULTIPLE RATES — 1 chiamata.
    case "3": {
      const miss = missingCtx(scenario, label, [["Twin Best Available Rate", twinBAR], ["Double Best Available Rate", dblBAR], ["Double Bed & Breakfast Rate", dblBB]]); if (miss) return miss;
      const restr = [
        R(twinBAR!, { date: "2026-11-21", rate: RATE(333) }),
        R(dblBAR!, { date: "2026-11-25", rate: RATE(444) }),
        R(dblBB!, { date: "2026-11-29", rate: "456.23" }),
      ];
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 4) MULTIPLE DATES / MULTIPLE RATES — intervalli (date_range), 1 chiamata.
    case "4": {
      const miss = missingCtx(scenario, label, [["Twin Best Available Rate", twinBAR], ["Double Best Available Rate", dblBAR], ["Double Bed & Breakfast Rate", dblBB]]); if (miss) return miss;
      const restr = [
        R(twinBAR!, { date_from: "2026-11-01", date_to: "2026-11-10", rate: RATE(241) }),
        R(dblBAR!, { date_from: "2026-11-10", date_to: "2026-11-16", rate: "312.66" }),
        R(dblBB!, { date_from: "2026-11-01", date_to: "2026-11-20", rate: RATE(111) }),
      ];
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 5) MIN STAY — SOLO min_stay_arrival (nessun altro campo), 1 chiamata.
    case "5": {
      const miss = missingCtx(scenario, label, [["Twin Best Available Rate", twinBAR], ["Double Best Available Rate", dblBAR], ["Double Bed & Breakfast Rate", dblBB]]); if (miss) return miss;
      const restr = [
        R(twinBAR!, { date: "2026-11-23", min_stay_arrival: 3 }),
        R(dblBAR!, { date: "2026-11-25", min_stay_arrival: 2 }),
        R(dblBB!, { date: "2026-11-15", min_stay_arrival: 5 }),
      ];
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 6) STOP SELL — SOLO stop_sell, 1 chiamata.
    case "6": {
      const miss = missingCtx(scenario, label, [["Twin Best Available Rate", twinBAR], ["Double Best Available Rate", dblBAR], ["Double Bed & Breakfast Rate", dblBB]]); if (miss) return miss;
      const restr = [
        R(twinBAR!, { date: "2026-11-14", stop_sell: true }),
        R(dblBAR!, { date: "2026-11-16", stop_sell: true }),
        R(dblBB!, { date: "2026-11-20", stop_sell: true }),
      ];
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 7) MULTIPLE RESTRICTIONS — intervalli + campi multipli, 1 chiamata.
    case "7": {
      const miss = missingCtx(scenario, label, [["Twin Best Available Rate", twinBAR], ["Twin Bed & Breakfast Rate", twinBB], ["Double Best Available Rate", dblBAR], ["Double Bed & Breakfast Rate", dblBB]]); if (miss) return miss;
      const restr = [
        R(twinBAR!, { date_from: "2026-11-01", date_to: "2026-11-10", closed_to_arrival: true, closed_to_departure: false, max_stay: 4, min_stay_arrival: 1 }),
        R(twinBB!, { date_from: "2026-11-12", date_to: "2026-11-16", closed_to_arrival: false, closed_to_departure: true, min_stay_arrival: 6 }),
        R(dblBAR!, { date_from: "2026-11-10", date_to: "2026-11-16", closed_to_arrival: true, min_stay_arrival: 2 }),
        R(dblBB!, { date_from: "2026-11-01", date_to: "2026-11-20", min_stay_arrival: 10 }),
      ];
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 8) HALF-YEAR — 2026-12-01..2027-05-01, rate + min_stay_arrival, 1 chiamata.
    case "8": {
      const miss = missingCtx(scenario, label, [["Twin Best Available Rate", twinBAR], ["Double Best Available Rate", dblBAR]]); if (miss) return miss;
      const restr = [
        R(twinBAR!, { date_from: "2026-12-01", date_to: "2027-05-01", rate: RATE(432), min_stay_arrival: 2 }),
        R(dblBAR!, { date_from: "2026-12-01", date_to: "2027-05-01", rate: RATE(342), min_stay_arrival: 3 }),
      ];
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 9) SINGLE DATE AVAILABILITY — Twin 2026-11-21 = 7, Double 2026-11-25 = 0.
    case "9": {
      const miss = missingCtx(scenario, label, [["Twin Room", twinRoom], ["Double Room", dblRoom]]); if (miss) return miss;
      const avail: AvailValue[] = [
        { property_id: P, room_type_id: twinRoom!, date: "2026-11-21", availability: 7 },
        { property_id: P, room_type_id: dblRoom!, date: "2026-11-25", availability: 0 },
      ];
      return done(scenario, [toCall("/availability", avail.length, await pushAvailability(avail))]);
    }

    // 10) MULTIPLE DATE AVAILABILITY — intervalli (date_range).
    case "10": {
      const miss = missingCtx(scenario, label, [["Twin Room", twinRoom], ["Double Room", dblRoom]]); if (miss) return miss;
      const avail: AvailValue[] = [
        { property_id: P, room_type_id: twinRoom!, date_from: "2026-11-10", date_to: "2026-11-16", availability: 3 },
        { property_id: P, room_type_id: dblRoom!, date_from: "2026-11-17", date_to: "2026-11-24", availability: 4 },
      ];
      return done(scenario, [toCall("/availability", avail.length, await pushAvailability(avail))]);
    }
  }
}
