// ============================================================
//  Client API Channex (server-side)
//  - La chiave sta SOLO nelle env di Vercel (CHANNEX_API_KEY), mai nel codice/client.
//  - Base URL configurabile: default staging (ambiente di prova).
//    Staging:    https://staging.channex.io/api/v1
//    Produzione: https://secure.channex.io/api/v1  (imposta CHANNEX_API_URL quando andrai live)
//  - Autenticazione Channex: header "user-api-key".
// ============================================================

import { channexFetch } from "@/lib/channex-queue";
import { otaActionRequest, type OtaAction } from "@/lib/channex-booking-actions";
import { ratePlanCreateBody } from "@/lib/rate-model";

const BASE = process.env.CHANNEX_API_URL || "https://staging.channex.io/api/v1";
const KEY = process.env.CHANNEX_API_KEY || "";

export const channexEnabled = () => !!KEY;
export const channexBase = () => BASE;

export interface ChannexResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

// Chiamata generica all'API Channex. Non logga mai la chiave.
export async function channex<T = unknown>(path: string, init?: RequestInit): Promise<ChannexResult<T>> {
  if (!KEY) return { ok: false, status: 0, error: "CHANNEX_API_KEY non configurata" };
  try {
    // La fetch passa dalla coda con throttling (max 20/min) + retry/backoff su
    // 429 e 5xx. channexFetch ritorna la Response grezza, quindi la lettura sotto
    // resta identica a prima.
    const res = await channexFetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "user-api-key": KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
    if (!res.ok) {
      const msg = (json && typeof json === "object" && "errors" in json) ? JSON.stringify((json as { errors: unknown }).errors) : (text.slice(0, 300) || res.statusText);
      return { ok: false, status: res.status, error: msg };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "errore di rete" };
  }
}

// Elenco proprietà (usato per il test connessione e per ricostruire la mappatura).
export async function listProperties() {
  return channex<{ data: { id: string; attributes?: { title?: string } }[] }>("/properties");
}
// Elenco tipologie camera di una property (per abbinarle alle tipologie Xenora per nome).
export async function listRoomTypesFor(propertyId: string) {
  return channex<{ data: { id: string; attributes?: { title?: string } }[] }>(`/room_types?filter[property_id]=${encodeURIComponent(propertyId)}`);
}
// Piani tariffari di una tipologia camera (serve il rate_plan_id per inviare i PREZZI in ARI:
// senza di esso si spinge solo la disponibilità). Restituiamo il primo piano trovato.
export async function listRatePlansForRoomType(roomTypeId: string) {
  return channex<{ data: { id: string; attributes?: { title?: string } }[] }>(`/rate_plans?filter[room_type_id]=${encodeURIComponent(roomTypeId)}`);
}

// Canali OTA collegati a una property (Booking.com, Airbnb, …) con stato Active/Inactive —
// usato per mostrare davvero "sei collegato" invece di un flag locale scollegato da Channex.
export async function listChannels(propertyId: string) {
  return channex<{ data: { id: string; attributes?: { title?: string; channel?: string; status?: string; is_active?: boolean } }[] }>(`/channels?filter[property_id]=${encodeURIComponent(propertyId)}`);
}

// Attiva/disattiva un canale OTA già collegato. Su Channex `is_active` è READ-ONLY (verificato sulla
// documentazione ufficiale): si cambia con due endpoint dedicati, non con un PUT sull'attributo.
export async function setChannelActive(channelId: string, active: boolean) {
  return channex<Created>(`/channels/${encodeURIComponent(channelId)}/${active ? "activate" : "deactivate"}`, { method: "POST", body: "{}" });
}

export interface ChxChannelDetail {
  id: string;
  attributes?: { title?: string; channel?: string; status?: string; is_active?: boolean; settings?: { derived_option?: { rate?: [string, string][] } } };
}
// Dettaglio completo di un canale (include settings.derived_option, non presente nella lista).
export async function getChannel(channelId: string) {
  return channex<{ data: ChxChannelDetail }>(`/channels/${encodeURIComponent(channelId)}`);
}

// Correzione di prezzo derivata a livello di CONNESSIONE canale (non per singola mappatura tariffa):
// Channex applica in ordine gli step [regola, valore] al prezzo Xenora prima di mandarlo all'OTA.
export async function setChannelPriceCorrection(channelId: string, steps: [string, string][]) {
  return channex<Created>(`/channels/${encodeURIComponent(channelId)}`, {
    method: "PUT",
    body: JSON.stringify({ channel: { settings: { derived_option: { rate: steps } } } }),
  });
}

// ── Webhook (ricezione automatica prenotazioni in tempo reale) ──
// Channex chiama il callback_url a ogni nuova prenotazione/modifica/cancellazione.
export async function listWebhooks(propertyId: string) {
  return channex<{ data: { id: string; attributes?: { callback_url?: string; is_active?: boolean; headers?: Record<string, string> | null } }[] }>(`/webhooks?filter[property_id]=${encodeURIComponent(propertyId)}`);
}
export async function createWebhook(propertyId: string, callbackUrl: string, eventMask = "booking", headers?: Record<string, string>) {
  return channex<Created>("/webhooks", {
    method: "POST",
    body: JSON.stringify({ webhook: { property_id: propertyId, callback_url: callbackUrl, event_mask: eventMask, is_active: true, send_data: true, ...(headers ? { headers } : {}) } }),
  });
}

// Aggiorna un webhook esistente (usato per aggiungere/ruotare l'intestazione con il segreto condiviso).
export async function updateWebhook(webhookId: string, patch: { headers?: Record<string, string> }) {
  return channex<Created>(`/webhooks/${encodeURIComponent(webhookId)}`, {
    method: "PUT",
    body: JSON.stringify({ webhook: patch }),
  });
}

type Created = { data?: { id?: string } };

// ── Creazione (usata dalla sincronizzazione Xenora → Channex) ──
export interface SyncProperty {
  title: string; currency?: string; country?: string; city?: string; address?: string;
  email?: string; phone?: string; latitude?: string; longitude?: string; logo_url?: string; website?: string;
}
export async function createProperty(p: SyncProperty) {
  return channex<Created>("/properties", {
    method: "POST",
    body: JSON.stringify({ property: {
      title: p.title,
      currency: p.currency || "EUR",
      country: p.country || "IT",
      timezone: "Europe/Rome",
      property_type: "hotel",
      city: p.city || undefined, address: p.address || undefined,
      email: p.email || undefined, phone: p.phone || undefined,
      latitude: p.latitude || undefined, longitude: p.longitude || undefined,
      // Channex accetta solo URL http(s) validi: logo caricato (data:/relativo) e siti non-URL vengono omessi.
      logo_url: (p.logo_url && /^https?:\/\/\S+$/i.test(p.logo_url)) ? p.logo_url : undefined,
      website: (p.website && /^https?:\/\/\S+$/i.test(p.website)) ? p.website : undefined,
    } }),
  });
}

export interface SyncRoom { title: string; count: number; occAdults: number; occChildren?: number; defaultOccupancy?: number }
export async function createRoomType(propertyId: string, r: SyncRoom) {
  return channex<Created>("/room_types", {
    method: "POST",
    body: JSON.stringify({ room_type: {
      property_id: propertyId,
      title: r.title,
      count_of_rooms: Math.max(1, r.count),
      occ_adults: Math.max(1, r.occAdults),
      occ_children: r.occChildren ?? 0,
      occ_infants: 0,
      default_occupancy: r.defaultOccupancy ?? Math.max(1, r.occAdults),
      room_kind: "room",
    } }),
  });
}

// ── ARI: aggiornamento disponibilità e prezzi ──
export interface AvailValue { property_id: string; room_type_id: string; date?: string; date_from?: string; date_to?: string; availability: number }
export interface RateValue { property_id: string; rate_plan_id: string; date?: string; date_from?: string; date_to?: string; rate: string }

// Riga RESTRIZIONI Channex. Su Channex prezzo e restrizioni viaggiano sullo STESSO
// endpoint /restrictions: si mandano insieme aggiungendo campi alla stessa riga
// (rate + eventuali min_stay_arrival, stop_sell, …). I campi opzionali si inviano
// SOLO quando abbiamo un dato reale: se assenti, Channex lascia invariata la restrizione.
// NB: usiamo `min_stay_arrival` (soggiorno minimo all'ARRIVO) come nome del campo
// per il soggiorno minimo — è la restrizione standard di Channex per il min stay.
export interface RestrictionRow {
  property_id: string;
  rate_plan_id: string;
  date?: string;              // singola data
  date_from?: string;        // intervallo: inizio (con date_to). Channex accetta date OPPURE date_from/date_to.
  date_to?: string;          // intervallo: fine
  rate?: string;
  // Prezzi per occupazione (solo piani "per persona", modello tariffe attivo, vedi rate-model.ts): es. [{ occupancy: 1, rate: "90.00" }].
  rates?: { occupancy: number; rate: string }[];
  min_stay_arrival?: number;
  min_stay_through?: number;  // soggiorno minimo "through" (quello verificato dalla certificazione Channex)
  max_stay?: number;
  stop_sell?: boolean;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
}

export async function pushAvailability(values: AvailValue[]) {
  return channex("/availability", { method: "POST", body: JSON.stringify({ values }) });
}
// Invia prezzi + restrizioni insieme sullo stesso endpoint /restrictions.
export async function pushRestrictions(values: RestrictionRow[]) {
  return channex("/restrictions", { method: "POST", body: JSON.stringify({ values }) });
}
// Compatibilità storica: pushRates ora delega a pushRestrictions (stesso endpoint).
export async function pushRates(values: RateValue[]) {
  return pushRestrictions(values as unknown as RestrictionRow[]);
}

// ── Prenotazioni in ENTRATA (feed booking revisions non ancora acked) ──
// La via consigliata da Channex per ricevere le prenotazioni: si legge il feed
// delle revision non confermate, si importano e si fa l'ACK (così non tornano più).
export interface ChxOccupancy { adults?: number; children?: number; infants?: number }
// `ages` (età bambini) presente se children > 0, può essere null; `amount` = totale camera; `meta` = JSON libero per OTA
// (cancel_penalties, meal_plan, payment_instruction, free_text... vedi channex-guestdata.ts).
export interface ChxRoom { room_type_id?: string; rate_plan_id?: string; checkin_date?: string; checkout_date?: string; occupancy?: ChxOccupancy & { ages?: number[] | null }; guests?: { name?: string; surname?: string }[]; days?: Record<string, string>; amount?: string; meta?: Record<string, unknown> | null }
export interface ChxRevision {
  id: string; property_id?: string; booking_id?: string; status?: string; ota_reservation_code?: string;
  ota_name?: string; arrival_date?: string; departure_date?: string; amount?: string; currency?: string;
  // Commissione OTA reale (quando il canale la manda): il campo varia per OTA, quindi accettiamo
  // più nomi possibili. Non tutti gli OTA lo espongono → resta opzionale (fallback: % di default).
  ota_commission?: string | number; commission?: string | number;
  // Dati ospite documentati da Channex: note del cliente, orario di arrivo "HH:MM" (nullable),
  // chi incassa ("property" | "ota" | null) e modalità ("credit_card" | "bank_transfer" | null).
  notes?: string | null; arrival_hour?: string | null; payment_collect?: string | null; payment_type?: string | null;
  customer?: { name?: string; surname?: string; mail?: string; email?: string; phone?: string; country?: string };
  rooms?: ChxRoom[];
}
// Normalizza una riga JSON:API (id + attributes) in ChxRevision piatta.
function flattenRevision(row: unknown): ChxRevision {
  const r = row as { id?: string; attributes?: Record<string, unknown> } & Record<string, unknown>;
  const a = (r.attributes ?? r) as Record<string, unknown>;
  return { id: String(r.id ?? a.id ?? ""), ...(a as object) } as ChxRevision;
}
export async function bookingRevisionsFeed(propertyId?: string): Promise<ChxResultList> {
  const q = propertyId ? `?filter[property_id]=${encodeURIComponent(propertyId)}` : "";
  const res = await channex<{ data?: unknown[] }>(`/booking_revisions/feed${q}`);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, revisions: [] };
  const list = Array.isArray(res.data?.data) ? res.data!.data! : [];
  return { ok: true, status: res.status, revisions: list.map(flattenRevision) };
}
export interface ChxResultList { ok: boolean; status: number; error?: string; revisions: ChxRevision[] }
export async function ackBookingRevision(id: string) {
  return channex(`/booking_revisions/${encodeURIComponent(id)}/ack`, { method: "POST", body: "{}" });
}

// Legge UNA revision per ID (NON la lista/feed): è il flusso che Channex si aspetta alla
// ricezione del webhook "booking" — il payload del webhook dà solo il revision_id, la PMS deve
// chiamare GET /booking_revisions/:id per i dati completi, poi fare ack. Usare la lista/feed in
// risposta a un webhook viene rilevato e respinto in certificazione ("received_via_list").
export async function getBookingRevision(id: string): Promise<{ ok: boolean; status: number; error?: string; revision?: ChxRevision }> {
  const res = await channex<{ data?: unknown }>(`/booking_revisions/${encodeURIComponent(id)}`);
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  return { ok: true, status: res.status, revision: flattenRevision(res.data?.data) };
}

// Elenco COMPLETO delle revision (ackate e non), opzionalmente filtrato per property o
// per booking. A differenza del feed (solo non-ackate), qui restiamo di sola lettura e NON
// facciamo ack: serve a raccogliere gli ID (booking + revision) per la certificazione (Test #11),
// dove il form chiede l'ID della revision NUOVA, MODIFICATA e CANCELLATA. `revision` è il numero
// progressivo (1 = nuova), `status`/`is_cancellation` distinguono modifica da cancellazione.
export interface ChxRevisionRow {
  id: string;
  booking_id: string;
  property_id?: string;
  status?: string;
  revision?: number;
  is_cancellation?: boolean;
  ota_name?: string;
  ota_reservation_code?: string;
  arrival_date?: string;
  departure_date?: string;
  inserted_at?: string;
}
export async function listBookingRevisions(opts: { propertyId?: string; bookingId?: string; limit?: number } = {}) {
  const params: string[] = [];
  if (opts.propertyId) params.push(`filter[property_id]=${encodeURIComponent(opts.propertyId)}`);
  if (opts.bookingId) params.push(`filter[booking_id]=${encodeURIComponent(opts.bookingId)}`);
  params.push(`order[inserted_at]=desc`);
  params.push(`pagination[limit]=${Math.max(1, Math.min(100, opts.limit ?? 50))}`);
  const q = params.length ? `?${params.join("&")}` : "";
  const res = await channex<{ data?: unknown[] }>(`/booking_revisions${q}`);
  if (!res.ok) return { ok: false as const, status: res.status, error: res.error, rows: [] as ChxRevisionRow[] };
  const list = Array.isArray(res.data?.data) ? res.data!.data! : [];
  const rows: ChxRevisionRow[] = list.map((row) => {
    const r = row as { id?: string; attributes?: Record<string, unknown> } & Record<string, unknown>;
    const a = (r.attributes ?? r) as Record<string, unknown>;
    const str = (v: unknown) => (v == null ? undefined : String(v));
    return {
      id: String(r.id ?? a.id ?? ""),
      booking_id: String(a.booking_id ?? a.unique_id ?? ""),
      property_id: str(a.property_id),
      status: str(a.status),
      revision: a.revision != null ? Number(a.revision) : undefined,
      is_cancellation: a.is_cancellation === true || String(a.status).toLowerCase() === "cancelled" || String(a.status).toLowerCase() === "cancellation",
      ota_name: str(a.ota_name),
      ota_reservation_code: str(a.ota_reservation_code),
      arrival_date: str(a.arrival_date),
      departure_date: str(a.departure_date),
      inserted_at: str(a.inserted_at),
    };
  });
  return { ok: true as const, status: res.status, rows };
}

// ── Messaggi ospite (Messages API: chat unificata Booking.com/Airbnb/Expedia) ──
// Richiede che l'app "Messages" sia installata sulla property in Channex (dashboard →
// Applications): senza, le chiamate rispondono 403. Non copre Expedia via EPS/Affiliate.
// Si lavora per BOOKING (non per property/thread): usa l'id prenotazione Channex, lo
// stesso salvato in extId (`channex:<booking_id>`) dalle prenotazioni importate.
export interface ChxMessage { id: string; message?: string; sender?: "guest" | "property"; attachments?: string[]; inserted_at?: string }
function flattenMessage(row: unknown): ChxMessage {
  const r = row as { id?: string; attributes?: Record<string, unknown> } & Record<string, unknown>;
  const a = (r.attributes ?? r) as Record<string, unknown>;
  return { id: String(r.id ?? a.id ?? ""), ...(a as object) } as ChxMessage;
}
export async function listBookingMessages(channexBookingId: string) {
  const res = await channex<{ data?: unknown[] }>(`/bookings/${encodeURIComponent(channexBookingId)}/messages`);
  if (!res.ok) return { ok: false as const, status: res.status, error: res.error, messages: [] as ChxMessage[] };
  const list = Array.isArray(res.data?.data) ? res.data!.data! : [];
  return { ok: true as const, status: res.status, messages: list.map(flattenMessage) };
}
export async function sendBookingMessage(channexBookingId: string, text: string) {
  return channex<{ data?: unknown }>(`/bookings/${encodeURIComponent(channexBookingId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: { message: text } }),
  });
}

// ── Segnalazioni all'OTA (Reporting API, SOLO Booking.com) ──
// Doc: https://docs.channex.io/api-v.1-documentation/bookings-collection.md (sezione Reporting API):
// POST /bookings/:id/no_show {no_show_report:{waived_fees}} · /invalid_card · /cancel_due_invalid_card
// (questi ultimi due a corpo vuoto). Per OTA non supportate Channex risponde 422 method_not_supported.
// ALTO RISCHIO: chiamare SOLO da un'azione esplicita dell'utente con conferma (route
// /api/channex/booking-actions), MAI da cron, webhook o automazioni. La doc mostra solo URL di
// staging: in produzione si presume lo stesso percorso su CHANNEX_API_URL (da verificare con Channex).
export async function reportBookingToOta(action: OtaAction, channexBookingId: string) {
  const { path, body } = otaActionRequest(action, channexBookingId);
  return channex<{ meta?: { message?: string } }>(path, { method: "POST", ...(body ? { body } : {}) });
}

// ── Recensioni (Reviews Collection API: Booking.com/Airbnb/Expedia unificate) ──
// Richiede la STESSA app "Messages & Reviews" installata per property in Channex (dashboard →
// Applications) già richiesta sopra dai Messaggi: "Add the Messages & Reviews app to the
// property, then the API and UI for reviews will be available" (doc ufficiale Channex). Senza,
// le chiamate rispondono 403 con un messaggio tipo "Property is not have installed Messages
// Application" — lo intercettiamo in isReviewsNotInstalled() per mostrare un avviso chiaro
// invece di un elenco vuoto o un crash. Non copre Tripadvisor (resta a inserimento manuale).
export interface ChxReviewScore { category?: string; score?: number }
export interface ChxReview {
  id: string;
  content?: string;
  guest_name?: string;
  overall_score?: number; // 0..10
  scores?: ChxReviewScore[]; // [{category, score}] (doc Channex); normalizzato da normalizeReviewScores
  ota?: string; // "AirBNB" | "BookingCom" | "Expedia"
  ota_reservation_id?: string;
  received_at?: string;
  inserted_at?: string;
  is_replied?: boolean;
  reply?: string | null;
  is_hidden?: boolean; // Airbnb
  tags?: string[]; // Airbnb
}
function flattenReview(row: unknown): ChxReview {
  const r = row as { id?: string; attributes?: Record<string, unknown> } & Record<string, unknown>;
  const a = (r.attributes ?? r) as Record<string, unknown>;
  return { id: String(r.id ?? a.id ?? ""), ...(a as object) } as ChxReview;
}
// true se l'errore indica che l'app "Messages & Reviews" non è installata su questa property
// (403 dedicato) — distinto da un errore di rete/altro, per mostrare un avviso azionabile.
export function isReviewsNotInstalled(status: number, error?: string): boolean {
  if (status === 403) return true;
  return /messages application|not have installed/i.test(error || "");
}
export async function listReviews(propertyId: string) {
  const res = await channex<{ data?: unknown[] }>(`/reviews?filter[property_id]=${encodeURIComponent(propertyId)}`);
  if (!res.ok) return { ok: false as const, status: res.status, error: res.error, reviews: [] as ChxReview[] };
  const list = Array.isArray(res.data?.data) ? res.data!.data! : [];
  return { ok: true as const, status: res.status, reviews: list.map(flattenReview) };
}
export interface ChxPropertyScore { overall_score?: number; count?: number; scores?: Record<string, { count?: number; score?: number }> }
export async function getPropertyScores(propertyId: string) {
  const res = await channex<{ data?: unknown }>(`/scores/${encodeURIComponent(propertyId)}`);
  if (!res.ok) return { ok: false as const, status: res.status, error: res.error, score: undefined as ChxPropertyScore | undefined };
  const row = res.data?.data as { attributes?: Record<string, unknown> } | undefined;
  return { ok: true as const, status: res.status, score: (row?.attributes ?? row) as ChxPropertyScore | undefined };
}
// Punteggi aggregati per OTA e per categoria (GET /scores/:property_id/detailed): oltre ai dati
// della property porta relationships.ota_scores[] con media e categorie di ogni canale.
// Restituisce l'oggetto «data» grezzo: si normalizza con parseDetailedScores (channex-review-scores.ts).
export async function getPropertyScoresDetailed(propertyId: string) {
  const res = await channex<{ data?: unknown }>(`/scores/${encodeURIComponent(propertyId)}/detailed`);
  if (!res.ok) return { ok: false as const, status: res.status, error: res.error, data: undefined as unknown };
  return { ok: true as const, status: res.status, data: res.data?.data as unknown };
}
// Risponde a una recensione (Booking.com/Airbnb/Expedia) via Channex. Corpo verificato sulla
// documentazione ufficiale: { reply: { reply: "testo" } } (il campo interno si chiama "reply").
export async function replyToReview(reviewId: string, text: string) {
  return channex<{ data?: unknown }>(`/reviews/${encodeURIComponent(reviewId)}/reply`, {
    method: "POST",
    body: JSON.stringify({ reply: { reply: text } }),
  });
}

// ── Collegamento canali OTA (self-service) ──
// Channex espone un "one-time token" da scambiare per aprire, in un iframe, la SUA interfaccia di
// collegamento/mappatura canali (Booking.com, Airbnb, Expedia, ...): è l'unico modo per collegare
// davvero un'OTA (credenziali/OAuth gestiti da Channex, non replicabili lato nostro). Il token dura
// 15 minuti e si usa una sola volta. Vedi src/app/(app)/canali/page.tsx per l'uso.
export async function createChannelOneTimeToken(propertyId: string, username: string) {
  return channex<{ data: { token: string } }>("/auth/one_time_token", {
    method: "POST",
    body: JSON.stringify({ property_id: propertyId, username }),
  });
}

export async function createRatePlan(propertyId: string, roomTypeId: string, opts: { title?: string; occupancy: number; rate: number; currency?: string }) {
  return channex<Created>("/rate_plans", {
    method: "POST",
    body: JSON.stringify({ rate_plan: {
      title: opts.title || "Standard",
      property_id: propertyId,
      room_type_id: roomTypeId,
      currency: opts.currency || "EUR",
      sell_mode: "per_room",
      rate_mode: "manual",
      options: [{ occupancy: Math.max(1, opts.occupancy), is_primary: true, rate: Math.max(0, Math.round(opts.rate)) }],
    } }),
  });
}

// Crea un piano tariffario IN PIÙ per una tipologia (non rimborsabile, con colazione, …; eventualmente per persona).
// PREPARATA ma NON invocata da nessuna route: va usata solo da una futura creazione guidata, dopo che l'owner
// ha abilitato il modello tariffe (Impostazioni → Più piani tariffari). Il corpo è costruito in rate-model.ts.
export async function createExtraRatePlan(propertyId: string, roomTypeId: string, opts: Parameters<typeof ratePlanCreateBody>[2]) {
  return channex<Created>("/rate_plans", { method: "POST", body: JSON.stringify(ratePlanCreateBody(propertyId, roomTypeId, opts)) });
}

// Corregge l'occupazione (adulti max) di un piano tariffario già creato — serve quando la
// tipologia camera viene modificata in Xenora DOPO il collegamento a Channex (es. capienza
// sbagliata al primo sync). Non tocca prezzo/titolo, solo l'occupancy dell'opzione primaria.
export async function updateRatePlanOccupancy(ratePlanId: string, occupancy: number) {
  return channex<Created>(`/rate_plans/${encodeURIComponent(ratePlanId)}`, {
    method: "PUT",
    body: JSON.stringify({ rate_plan: {
      options: [{ occupancy: Math.max(1, occupancy), is_primary: true }],
    } }),
  });
}
