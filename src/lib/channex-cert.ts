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
  return { propertyId, structureId: "", roomTypes, combos };
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
  return { propertyId, structureId, roomTypes, combos };
}

// ── Helper per date/valori ────────────────────────────────────────────────
// Tutte le date partono da OGGI + offset, così sono sempre valide (nel futuro).
const nowBase = () => new Date();
const dISO = (offset: number) => toISO(addDays(nowBase(), offset));
// Prezzo variabile e realistico per data (base + oscillazione + maggiorazione weekend).
function variableRate(offset: number, seed = 0): string {
  const d = addDays(nowBase(), offset);
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const val = 70 + ((offset * 3 + seed * 7) % 45) + (weekend ? 20 : 0);
  return val.toFixed(2);
}
// Sceglie una combo ciclando: così scenari che vogliono 3-4 combinazioni funzionano
// anche quando la struttura ne ha meno.
const pickCombo = (combos: CertCombo[], i: number) => combos[i % combos.length];

function done(scenario: ScenarioId, calls: CertCall[]): CertResult {
  return { ok: calls.length > 0 && calls.every((c) => c.ok), scenario, label: SCENARIO_LABELS[scenario], calls };
}

// ── Esecutore principale ──────────────────────────────────────────────────
export async function runCertScenario(admin: SupabaseClient, tenantId: string, scenario: ScenarioId): Promise<CertResult> {
  const label = SCENARIO_LABELS[scenario];
  const ctx = await resolveCertContext(admin, tenantId);
  if ("error" in ctx) return { ok: false, scenario, label, calls: [], error: ctx.error };

  const { propertyId, roomTypes, combos } = ctx;
  const P = propertyId;

  // Scenari su prezzi/restrizioni: serve almeno un rate_plan reale.
  const needsRates: ScenarioId[] = ["2", "3", "4", "5", "6", "7", "8"];
  if (needsRates.includes(scenario) && combos.length === 0) {
    return { ok: false, scenario, label, calls: [], error: "Nessun piano tariffario trovato su Channex per questa struttura." };
  }

  switch (scenario) {
    // 1) FULL DATA SYNC — 500 giorni di disponibilità + tariffe/restrizioni per
    //    tutte le camere/piani, in 2 chiamate (1 availability, 1 restrictions).
    case "1": {
      const days = 500;
      const avail: AvailValue[] = [];
      for (const rt of roomTypes) {
        for (let o = 0; o < days; o++) {
          avail.push({ property_id: P, room_type_id: rt.roomTypeId, date: dISO(o), availability: 2 + (o % 4) });
        }
      }
      const restr: RestrictionRow[] = [];
      for (let ci = 0; ci < combos.length; ci++) {
        const c = combos[ci];
        for (let o = 0; o < days; o++) {
          const row: RestrictionRow = { property_id: P, rate_plan_id: c.ratePlanId, date: dISO(o), rate: variableRate(o, ci) };
          if (o % 30 === 0) row.min_stay_arrival = 2; // qualche restrizione sparsa, realistica
          restr.push(row);
        }
      }
      const calls: CertCall[] = [];
      calls.push(toCall("/availability", avail.length, await pushAvailability(avail)));
      if (restr.length > 0) calls.push(toCall("/restrictions", restr.length, await pushRestrictions(restr)));
      return done(scenario, calls);
    }

    // 2) SINGLE DATE, SINGLE RATE — 1 combinazione, 1 data (+30gg), prezzo 333. 1 chiamata.
    case "2": {
      const c = combos[0];
      const restr: RestrictionRow[] = [{ property_id: P, rate_plan_id: c.ratePlanId, date: dISO(30), rate: "333.00" }];
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 3) SINGLE DATE, MULTIPLE RATES — 3 combinazioni su date diverse, in 1 chiamata.
    case "3": {
      const offsets = [10, 20, 40];
      const rates = ["150.00", "199.00", "240.00"];
      const restr: RestrictionRow[] = [0, 1, 2].map((i) => {
        const c = pickCombo(combos, i);
        return { property_id: P, rate_plan_id: c.ratePlanId, date: dISO(offsets[i]), rate: rates[i] };
      });
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 4) MULTIPLE DATES, MULTIPLE RATES — intervalli (gg 1-10, 10-16, 1-20) per più
    //    combinazioni, espansi a una riga per data, in 1 chiamata.
    case "4": {
      const ranges = [
        { from: 1, to: 10, combo: 0, rate: "120.00" },
        { from: 10, to: 16, combo: 1, rate: "175.00" },
        { from: 1, to: 20, combo: 2, rate: "210.00" },
      ];
      const restr: RestrictionRow[] = [];
      for (const r of ranges) {
        const c = pickCombo(combos, r.combo);
        for (let o = r.from; o <= r.to; o++) {
          restr.push({ property_id: P, rate_plan_id: c.ratePlanId, date: dISO(o), rate: r.rate });
        }
      }
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 5) MIN STAY UPDATE — min_stay (3,2,5) per tre combinazioni su date indicate, 1 chiamata.
    case "5": {
      const mins = [3, 2, 5];
      const offsets = [5, 12, 25];
      const restr: RestrictionRow[] = [0, 1, 2].map((i) => {
        const c = pickCombo(combos, i);
        return { property_id: P, rate_plan_id: c.ratePlanId, date: dISO(offsets[i]), min_stay_arrival: mins[i] };
      });
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 6) STOP SELL UPDATE — stop_sell attivo per tre combinazioni, 1 chiamata.
    case "6": {
      const restr: RestrictionRow[] = [0, 1, 2].map((i) => {
        const c = pickCombo(combos, i);
        return { property_id: P, rate_plan_id: c.ratePlanId, date: dISO(7 + i * 3), stop_sell: true };
      });
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 7) MULTIPLE RESTRICTIONS — closed_to_arrival, closed_to_departure, min_stay,
    //    max_stay su 4 combinazioni, 1 chiamata.
    case "7": {
      const restr: RestrictionRow[] = [
        { property_id: P, rate_plan_id: pickCombo(combos, 0).ratePlanId, date: dISO(9), closed_to_arrival: true },
        { property_id: P, rate_plan_id: pickCombo(combos, 1).ratePlanId, date: dISO(11), closed_to_departure: true },
        { property_id: P, rate_plan_id: pickCombo(combos, 2).ratePlanId, date: dISO(13), min_stay_arrival: 4 },
        { property_id: P, rate_plan_id: pickCombo(combos, 3).ratePlanId, date: dISO(15), max_stay: 10 },
      ];
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 8) HALF-YEAR UPDATE — tariffe + restrizioni su un semestre (+30 → +210 gg) per
    //    più camere, 1 chiamata.
    case "8": {
      const restr: RestrictionRow[] = [];
      for (let ci = 0; ci < combos.length; ci++) {
        const c = combos[ci];
        for (let o = 30; o <= 210; o++) {
          const row: RestrictionRow = { property_id: P, rate_plan_id: c.ratePlanId, date: dISO(o), rate: variableRate(o, ci + 3) };
          if ((o - 30) % 14 === 0) row.min_stay_arrival = 3; // una restrizione ogni 2 settimane
          restr.push(row);
        }
      }
      return done(scenario, [toCall("/restrictions", restr.length, await pushRestrictions(restr))]);
    }

    // 9) SINGLE DATE AVAILABILITY — riduce l'inventario simulando una prenotazione:
    //    camera1 da N a N-1, camera2 da 1 a 0, su 2 date. 1 chiamata.
    case "9": {
      const rt0 = roomTypes[0];
      const rt1 = roomTypes[1] ?? roomTypes[0];
      const avail: AvailValue[] = [
        { property_id: P, room_type_id: rt0.roomTypeId, date: dISO(3), availability: 1 },
        { property_id: P, room_type_id: rt0.roomTypeId, date: dISO(4), availability: 1 },
        { property_id: P, room_type_id: rt1.roomTypeId, date: dISO(3), availability: 0 },
        { property_id: P, room_type_id: rt1.roomTypeId, date: dISO(4), availability: 0 },
      ];
      return done(scenario, [toCall("/availability", avail.length, await pushAvailability(avail))]);
    }

    // 10) MULTIPLE DATE AVAILABILITY — aggiorna inventario su intervalli per due
    //     camere (usa date_from/date_to), 1 chiamata.
    case "10": {
      const rt0 = roomTypes[0];
      const rt1 = roomTypes[1] ?? roomTypes[0];
      const avail: AvailValue[] = [
        { property_id: P, room_type_id: rt0.roomTypeId, date_from: dISO(5), date_to: dISO(15), availability: 3 },
        { property_id: P, room_type_id: rt1.roomTypeId, date_from: dISO(8), date_to: dISO(20), availability: 2 },
      ];
      return done(scenario, [toCall("/availability", avail.length, await pushAvailability(avail))]);
    }
  }
}
