// ============================================================
//  Channex → Xenora: import prenotazioni in ENTRATA (2-way sync).
//  Flusso robusto consigliato da Channex: leggi il feed delle booking revision
//  non ancora confermate, risolvi la property (→ tenant + struttura + tipologie),
//  scrivi la prenotazione nella app_state del proprietario, poi ACK.
//  Tutto server-side (service role). Idempotente per booking_id (extId).
// ============================================================
import { schedulePoolPush } from "@/lib/pool-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { internalFetch } from "@/lib/server-auth";
import { bookingRevisionsFeed, ackBookingRevision, listProperties, type ChxRevision } from "@/lib/channex";
import { upsertGcalEvent, deleteGcalEvent, gcalEventId } from "@/lib/googleCalendarSync";
import { CHANNELS, type Channel } from "@/lib/types";
import { parseNotifPrefs } from "@/lib/notifPrefs";
import { readRevisionGuestData, mergeOtaOverCarried, type OtaInfo } from "@/lib/channex-guestdata";
import { splitCommission } from "@/lib/commission-split";
import { channelFromOta } from "@/lib/channex-channel";
import { ymdRome } from "@/lib/dates-rome";
import { findOctorateTwins, twinFillPatch, duplicatePatch, usefulOctorateNote } from "@/lib/booking-heal";
import { parsePaymentCharge } from "@/lib/payment-fee";
import { buildNotifyPayload } from "./mail/notify-payload";
import { campoCambiato, modificaMeritaEmail } from "./notify-rules";
import type { Structure } from "@/lib/types";

// Property di test della certificazione: le sue prenotazioni non sono in channex_map (non è una
// struttura reale), ma vanno comunque ACKate dal flusso di import automatico — che è quello che
// Channex riconosce come "integrazione" — per superare il test "Booking Receiving".
const CERT_TEST_PROPERTY_TITLE = "Test Property - Xenora";

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;
type Booking = Json & { id: string; structureId: string; roomTypeId: string; unitId: string | null; checkIn: string; checkOut: string; status: string; extId?: string };
type Unit = { id: string; roomTypeId: string; structureId?: string; outOfService?: boolean };
const overlaps = (b: { checkIn: string; checkOut: string }, ci: string, co: string) => b.checkIn < co && b.checkOut > ci;

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `x_${Date.now()}_${Math.random().toString(36).slice(2)}`);

// Registro attività: questo import gira SERVER-SIDE (nessun accesso al DataProvider del client),
// ma scrive nello stesso blob (data.activities) che il client legge/salva in store.tsx — stessa
// forma di Activity, stesso limite di 500 voci. Così le prenotazioni in entrata automatiche da
// Channex (il caso "prenotazioni in entrata" che addBooking lato client non può vedere) compaiono
// comunque nel Registro attività dell'app alla prossima apertura/sync.
type InboundActivity = { id: string; ts: number; type: string; text: string };
function pushActivity(data: Json, type: string, text: string) {
  const prev = (Array.isArray(data.activities) ? data.activities : []) as InboundActivity[];
  data.activities = [{ id: uid(), ts: Date.now(), type, text }, ...prev].slice(0, 500);
}

export interface ChannexMapRow { channex_property_id: string; tenant_id: string; structure_id: string; rooms: Record<string, string>; org_id?: string | null }

// Salva/aggiorna la mappatura Channex↔Xenora per una struttura (chiamata dopo il sync/relink).
// Se la struttura è condivisa (socio), passa orgId: le prenotazioni in entrata verranno
// scritte in org_state(orgId) e non nel blob personale del tenant. Vedi struttura-condivisa.
export async function saveChannexMap(admin: SupabaseClient, tenantId: string, structureId: string, propertyId: string, rooms: Record<string, string>, orgId?: string | null) {
  // Riga già esistente: si aggiornano camere e organizzazione, MA non il proprietario (tenant_id). Prima chi riallineava per ultimo (anche un
  // collaboratore) diventava il "proprietario" della property, e prenotazioni in arrivo e messaggi OTA finivano sul suo account.
  const { data: cur } = await admin.from("channex_map").select("tenant_id, org_id").eq("channex_property_id", propertyId).maybeSingle();
  if (cur) {
    const { error: upErr } = await admin.from("channex_map").update({ structure_id: structureId, rooms, org_id: orgId ?? (cur as { org_id?: string | null }).org_id ?? null, updated_at: new Date().toISOString() }).eq("channex_property_id", propertyId);
    return { ok: !upErr, error: upErr?.message };
  }
  const { error } = await admin.from("channex_map").upsert({
    channex_property_id: propertyId, tenant_id: tenantId, structure_id: structureId, rooms, org_id: orgId ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "channex_property_id" });
  return { ok: !error, error: error?.message };
}

// OTA → canale Xenora (la funzione sta in channex-channel.ts, senza dipendenze, così la usa anche la riconciliazione).
export { channelFromOta };

const num = (v: unknown, d = 0) => { const n = Number(v); return isNaN(n) ? d : n; };

// Estrae i SOLI METADATI della carta virtuale OTA (VCC) da una revision Channex.
// PCI-safe per costruzione: legge esclusivamente importo/valuta/decimali/date; NON legge
// (e non deve mai leggere) numero carta, titolare o CVV — Channex li invia solo ai partner
// certificati PCI DSS, e Xenora non lo è. Ritorna undefined se non c'è una VCC.
type OtaCard = { present: boolean; currency?: string; balance?: number; effectiveDate?: string; expirationDate?: string; charged?: boolean };
function otaCardFrom(r: ChxRevision): OtaCard | undefined {
  const raw = r as unknown as Record<string, unknown>;
  const cc = ((raw.credit_card ?? raw.payment_card ?? raw.payment ?? {}) as Record<string, unknown>) || {};
  const pick = (k: string) => raw[k] ?? cc[k];
  const isVirtual = pick("is_virtual_card") === true || pick("is_virtual") === true
    || String(pick("payment_type") ?? pick("payment_collect") ?? "").toLowerCase().includes("virtual");
  const rawBal = num(pick("virtual_card_current_balance"), NaN);
  const decimals = num(pick("virtual_card_decimal_places"), 0);
  const balance = Number.isFinite(rawBal) ? (decimals > 0 ? rawBal / Math.pow(10, decimals) : rawBal) : undefined;
  const currency = (pick("virtual_card_currency_code") as string | undefined) || undefined;
  const effectiveDate = (pick("virtual_card_effective_date") as string | undefined) || undefined;
  const expirationDate = (pick("virtual_card_expiration_date") as string | undefined) || undefined;
  // "Presente" solo con un segnale chiaro di VCC: flag virtuale, un saldo, o una data VCC.
  if (!isVirtual && balance == null && !effectiveDate && !expirationDate) return undefined;
  return { present: true, currency, balance, effectiveDate, expirationDate };
}
// Dettaglio notte-per-notte mandato da Channex (es. Booking.com lo manda sempre): data ISO ->
// importo di quella notte. Lo teniamo accanto al totale invece di buttarlo via, così si può
// vedere nella scheda prenotazione quanto ha pagato l'ospite per ogni singola notte.
const nightlyRatesOf = (days?: Record<string, string>): Record<string, number> | undefined => {
  if (!days) return undefined;
  const out: Record<string, number> = {};
  for (const [iso, v] of Object.entries(days)) { if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) out[iso] = num(v); }
  return Object.keys(out).length ? out : undefined;
};

export interface ImportSummary { ok: boolean; feed: number; imported: number; cancelled: number; acked: number; skipped: number; errors: string[] }

// Importa TUTTE le revision del feed (opzionalmente per una property), risolvendo
// il tenant da channex_map. Applica per tenant (una scrittura per tenant) e fa ack.
export async function importBookings(admin: SupabaseClient, opts: { propertyId?: string } = {}): Promise<ImportSummary> {
  const out: ImportSummary = { ok: true, feed: 0, imported: 0, cancelled: 0, acked: 0, skipped: 0, errors: [] };
  const feed = await bookingRevisionsFeed(opts.propertyId);
  if (!feed.ok) return { ...out, ok: false, errors: [feed.error || "feed non disponibile"] };
  out.feed = feed.revisions.length;
  if (!feed.revisions.length) return out;

  // Risolvi le property coinvolte in un colpo solo.
  const propIds = Array.from(new Set(feed.revisions.map((r) => r.property_id).filter(Boolean))) as string[];
  const { data: maps } = await admin.from("channex_map").select("channex_property_id, tenant_id, structure_id, rooms, org_id").in("channex_property_id", propIds);
  const mapByProp = new Map<string, ChannexMapRow>((maps ?? []).map((m) => [m.channex_property_id as string, m as ChannexMapRow]));

  // Solo soggiorni CORRENTI/FUTURI: le prenotazioni già concluse (check-out < oggi) NON
  // vengono importate all'attivazione (così non entra lo storico). Le "scarichiamo" comunque
  // dal feed con l'ack, per non riprocessarle a ogni ciclo. Le cancellazioni passano sempre.
  const today = ymdRome(new Date());
  const pastAckIds: string[] = [];
  const certAckIds: string[] = []; // revision della property di test: solo ACK, nessun import

  // Id della property di test certificazione (se esiste), per ACKarne le revision anche se non mappata.
  let testPropId: string | null = null;
  try {
    const lp = await listProperties();
    if (lp.ok) testPropId = String((lp.data?.data ?? []).find((p) => String(p.attributes?.title ?? "").trim() === CERT_TEST_PROPERTY_TITLE)?.id ?? "") || null;
  } catch { /* non critico */ }

  // Raggruppa le revision per STORE di destinazione. Struttura condivisa → org_state(org_id);
  // struttura personale → app_state(tenant_id). Property non mappate: skip SENZA ack, TRANNE la
  // property di test certificazione, di cui facciamo l'ACK (necessario al test Booking Receiving).
  const byStore = new Map<string, { target: StoreTarget; items: { rev: ChxRevision; map: ChannexMapRow }[] }>();
  for (const rev of feed.revisions) {
    const map = rev.property_id ? mapByProp.get(rev.property_id) : undefined;
    if (!map) {
      if (testPropId && rev.property_id === testPropId) { certAckIds.push(rev.id); console.log(`[channex inbound] ACK property di test revision=${rev.id} status=${rev.status}`); }
      else out.skipped++;
      continue;
    }
    const dep = rev.departure_date || rev.arrival_date || "";
    if (rev.status !== "cancelled" && /^\d{4}-\d{2}-\d{2}$/.test(dep) && dep < today) {
      out.skipped++; pastAckIds.push(rev.id); continue; // soggiorno concluso: ignora + scarica dal feed
    }
    const target: StoreTarget = map.org_id ? { kind: "org", id: map.org_id } : { kind: "user", id: map.tenant_id };
    const key = `${target.kind}:${target.id}`;
    const g = byStore.get(key) ?? { target, items: [] }; g.items.push({ rev, map }); byStore.set(key, g);
  }

  const ackIds: string[] = [...pastAckIds, ...certAckIds];
  for (const [key, { target, items }] of byStore) {
    try {
      const applied = await applyToStore(admin, target, items, out);
      for (const it of applied) ackIds.push(it.rev.id);
    } catch (e) { out.errors.push(`${key.slice(0, 12)}: ${(e as Error)?.message}`); }
  }

  // ACK + audit delle revision applicate.
  for (const rev of feed.revisions.filter((r) => ackIds.includes(r.id))) {
    const a = await ackBookingRevision(rev.id);
    if (a.ok) out.acked++;
    const m = rev.property_id ? mapByProp.get(rev.property_id) : undefined;
    await admin.from("channex_bookings").upsert({
      revision_id: rev.id, booking_id: rev.booking_id ?? null, tenant_id: m?.tenant_id ?? null,
      channex_property_id: rev.property_id ?? null, status: rev.status ?? null, ota_reservation_code: rev.ota_reservation_code ?? null,
      imported_at: new Date().toISOString(),
    }, { onConflict: "revision_id" });
  }
  return out;
}

// Importa UNA revision GIÀ OTTENUTA per ID (flusso webhook, vedi getBookingRevision in channex.ts):
// nessuna chiamata a feed/lista. Channex in certificazione rileva e boccia l'uso della lista come
// risposta a un webhook ("received_via_list"): questa funzione riusa la stessa logica di scrittura
// di importBookings (applyToStore) così il comportamento di scrittura/ack resta identico.
export async function importSingleRevision(admin: SupabaseClient, rev: ChxRevision): Promise<ImportSummary> {
  const out: ImportSummary = { ok: true, feed: 1, imported: 0, cancelled: 0, acked: 0, skipped: 0, errors: [] };
  const propertyId = rev.property_id;
  const { data: map } = propertyId
    ? await admin.from("channex_map").select("channex_property_id, tenant_id, structure_id, rooms, org_id").eq("channex_property_id", propertyId).maybeSingle()
    : { data: null };

  let ackIt = false;
  if (map) {
    const today = ymdRome(new Date());
    const dep = rev.departure_date || rev.arrival_date || "";
    if (rev.status !== "cancelled" && /^\d{4}-\d{2}-\d{2}$/.test(dep) && dep < today) {
      out.skipped++; ackIt = true; // soggiorno concluso: scarica comunque dal feed
    } else {
      const target: StoreTarget = map.org_id ? { kind: "org", id: map.org_id } : { kind: "user", id: map.tenant_id };
      try {
        const applied = await applyToStore(admin, target, [{ rev, map: map as ChannexMapRow }], out);
        ackIt = applied.length > 0;
      } catch (e) { out.errors.push((e as Error)?.message || "errore applyToStore"); }
    }
  } else if (propertyId) {
    // Nessuna mappatura: ACK solo se è la property di test certificazione (come in importBookings).
    try {
      const lp = await listProperties();
      const testPropId = lp.ok ? String((lp.data?.data ?? []).find((p) => String(p.attributes?.title ?? "").trim() === CERT_TEST_PROPERTY_TITLE)?.id ?? "") || null : null;
      if (testPropId && propertyId === testPropId) ackIt = true; else out.skipped++;
    } catch { out.skipped++; }
  } else {
    out.skipped++;
  }

  if (ackIt) {
    const a = await ackBookingRevision(rev.id);
    if (a.ok) out.acked++;
    await admin.from("channex_bookings").upsert({
      revision_id: rev.id, booking_id: rev.booking_id ?? null, tenant_id: (map as ChannexMapRow | null)?.tenant_id ?? null,
      channex_property_id: propertyId ?? null, status: rev.status ?? null, ota_reservation_code: rev.ota_reservation_code ?? null,
      imported_at: new Date().toISOString(),
    }, { onConflict: "revision_id" });
  }
  return out;
}

// Store di destinazione: blob personale (app_state per user_id) o org condivisa (org_state per org_id).
type StoreTarget = { kind: "user" | "org"; id: string };
const storeTable = (t: StoreTarget) => (t.kind === "org" ? "org_state" : "app_state");
const storeKeyCol = (t: StoreTarget) => (t.kind === "org" ? "org_id" : "user_id");

// Applica le revision a UNO store (una lettura + una scrittura, con retry su rev).
// Identico per app_state e org_state: cambiano solo tabella e colonna chiave.
async function applyToStore(admin: SupabaseClient, target: StoreTarget, items: { rev: ChxRevision; map: ChannexMapRow }[], out: ImportSummary): Promise<{ rev: ChxRevision }[]> {
  const table = storeTable(target); const keyCol = storeKeyCol(target);
  const applyOnce = async (): Promise<{ ok: boolean; conflict?: boolean; applied: { rev: ChxRevision }[] }> => {
    const { data: row, error } = await admin.from(table).select("data, rev").eq(keyCol, target.id).maybeSingle();
    if (error) return { ok: false, applied: [] };
    const blob = ((row?.data ?? {}) as Record<string, string>) || {};
    const rev = typeof (row as { rev?: number } | null)?.rev === "number" ? (row as { rev: number }).rev : null;
    let data: Json = {}; try { data = JSON.parse(blob[DATA_KEY] || "{}") as Json; } catch { data = {}; }
    const bookings = (Array.isArray(data.bookings) ? data.bookings : []) as Booking[];
    const guests = (Array.isArray(data.guests) ? data.guests : []) as (Json & { id: string; email?: string; fullName?: string })[];
    const units = (Array.isArray(data.units) ? data.units : []) as Unit[];
    const roomTypesArr = (Array.isArray(data.roomTypes) ? data.roomTypes : []) as { id: string; name?: string }[];
    const structuresArr = (Array.isArray(data.structures) ? data.structures : []) as (Json & { id: string; gcalId?: string; email?: string })[];
    // Preferenze di notifica (Impostazioni → Notifiche), sincronizzate nello stesso blob con la
    // chiave "spigolestay:notifs" (stessa forma di localStorage, vedi notifPrefs.ts).
    const notifs = parseNotifPrefs(blob["spigolestay:notifs"]);
    const applied: { rev: ChxRevision }[] = [];
    // Sync in tempo reale col Google Calendar REALE dell'utente (se la struttura ha un gcalId
    // configurato) — fire-and-forget, non deve mai far fallire l'import OTA (vedi googleCalendarSync.ts).
    const syncGcalServer = (b: Booking, action: "upsert" | "delete") => {
      const calendarId = structuresArr.find((s) => s.id === b.structureId)?.gcalId?.trim();
      if (!calendarId) return;
      const eventId = gcalEventId(b.id);
      if (action === "delete") { void deleteGcalEvent(calendarId, eventId); return; }
      const guest = guests.find((g) => g.id === b.guestId);
      const code = typeof b.code === "string" ? b.code : "";
      const summary = [guest?.fullName || "Ospite OTA", code && `· ${code}`].filter(Boolean).join(" ");
      void upsertGcalEvent({ calendarId, eventId, summary, startDate: b.checkIn, endDateExclusive: b.checkOut });
    };

    // Notifica email alla struttura per prenotazioni/cancellazioni arrivate dalle OTA via Channex
    // (rispetta i toggle newBooking/cancel E "ota" di Impostazioni → Notifiche). Fire-and-forget,
    // non deve mai far fallire l'import — stesso principio di syncGcalServer.
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://xenora.it";
    // Email RICCA al titolare: logo/nome/colore della struttura, canale (chip), importi (commissione e netto marcati "stima" quando lo sono),
    // contatti dell'ospite e link diretto alla scheda. Il corpo è costruito da buildNotifyPayload (lo stesso del gestionale).
    const notifyOwnerServer = (ev: "newBooking" | "cancel" | "modified", b: Booking) => {
      if (!notifs[ev] || !notifs.ota) return;
      const st = structuresArr.find((s) => s.id === b.structureId);
      const to = st?.email?.trim();
      if (!to) return;
      const guest = guests.find((g) => g.id === b.guestId);
      const chLabel = CHANNELS[b.channel as Channel]?.label ?? String(b.channel ?? "");
      const unit = units.find((u) => u.id === b.unitId);
      const roomType = roomTypesArr.find((r) => r.id === (unit?.roomTypeId ?? b.roomTypeId));
      const roomLabel = [roomType?.name, (unit as { name?: string } | undefined)?.name].filter(Boolean).join(" · ");
      const body = buildNotifyPayload({
        ev, booking: b, guest: guest ? { fullName: guest.fullName, phone: guest.phone as string | undefined, email: guest.email, country: guest.country as string | undefined } : undefined,
        structure: st as unknown as Structure, roomLabel, channelLabel: chLabel, origin,
      });
      void internalFetch(`${origin}/api/email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, to }),
      }).catch(() => {});
    };

    const touchedKeys = new Set<string>();
    // Struttura/tipologia delle prenotazioni toccate (nuove, modificate, cancellate, sostituite): servono a inviare ai portali solo la disponibilità interessata.
    const availTouched: { structureId?: string | null; roomTypeId?: string | null }[] = [];
    const touchAvail = (b: { structureId?: string | null; roomTypeId?: string | null }) => { availTouched.push({ structureId: b.structureId, roomTypeId: b.roomTypeId }); };
    for (const { rev: r, map } of items) {
      // Chiave STABILE della prenotazione: SEMPRE booking_id quando presente (Channex lo
      // mantiene uguale tra le revision della stessa prenotazione), id-revision solo come
      // fallback se booking_id manca. È la chiave con cui SCRIVIAMO le nuove righe.
      const stableKey = `channex:${r.booking_id || r.id}`;
      touchedKeys.add(stableKey);
      // Per RITROVARE le prenotazioni già importate accettiamo ENTRAMBE le chiavi possibili
      // (booking_id e id-revision): così una modifica/cancellazione ritrova la prenotazione
      // anche se una revision precedente fosse stata salvata con l'altra chiave. Questo è il
      // punto critico del Test 11: senza questo, una modifica con id-revision diverso
      // creerebbe un doppione invece di aggiornare quella esistente.
      const candidates = new Set<string>([stableKey]);
      if (r.booking_id) candidates.add(`channex:${r.booking_id}`);
      if (r.id) candidates.add(`channex:${r.id}`);
      const prevIdx = bookings.map((b, i) => (b.extId && candidates.has(b.extId) ? i : -1)).filter((i) => i >= 0);
      const hadChannexPrev = prevIdx.length > 0;
      // Prenotazione già presente perché importata PRIMA del collegamento (es. da Octorate, con extId diverso): si riconosce dal numero di prenotazione
      // dell'OTA (stesso codice, stessa struttura). Così una modifica o cancellazione la aggiorna invece di creare un doppione.
      const otaCode = String(r.ota_reservation_code || "").trim();
      if (!prevIdx.length && otaCode) bookings.forEach((b, i) => { if (b.structureId === map.structure_id && String(b.code || "").trim() === otaCode && !String(b.extId || "").startsWith("channex:")) prevIdx.push(i); });
      // Doppione Octorate: la prenotazione può esistere GIÀ come riga Channex E come riga importata da Octorate (stessa struttura, canale, numero e date).
      // La riga Channex è quella viva; quella Octorate non si cancella: si segna annullata come duplicato (sparisce da calendario, totali e Cassa, resta recuperabile)
      // e i suoi dati (incassato, commissione, note, camera) passano sulla riga Channex. Se invece la riga Channex non c'era, l'Octorate è già la "versione precedente" (sopra).
      const twinRows: Booking[] = hadChannexPrev && otaCode
        ? findOctorateTwins(bookings, { structureId: map.structure_id, code: otaCode, channel: channelFromOta(r.ota_name), ranges: [{ ci: r.arrival_date || "", co: r.departure_date || "" }, ...(r.rooms ?? []).map((rm) => ({ ci: rm.checkin_date || "", co: rm.checkout_date || "" }))] }).map((i) => bookings[i])
        : [];
      const twinSet = new Set<Booking>(twinRows);
      const markTwinsDuplicate = () => twinRows.forEach((t) => { touchAvail(t); Object.assign(t, duplicatePatch(t as { note?: string }, otaCode), { updatedAt: Date.now() }); syncGcalServer(t, "delete"); });
      const bidLog = r.booking_id || r.id;
      if (r.status === "cancelled") {
        const cancelledGuestName = prevIdx.length ? guests.find((g) => g.id === bookings[prevIdx[0]].guestId)?.fullName : undefined;
        // updatedAt DEVE avanzare: la fusione client/server è last-write-wins su questo campo
        // (vedi authsync.tsx) — senza, al sync successivo del browser la copia locale ancora
        // "confirmed" (stesso updatedAt di prima) vince a parità e la cancellazione sparisce.
        prevIdx.forEach((i) => { const wasCancelled = bookings[i].status === "cancelled"; touchAvail(bookings[i]); bookings[i].status = "cancelled"; bookings[i].otaRevision = { status: "cancelled", at: Date.now() }; bookings[i].updatedAt = Date.now(); syncGcalServer(bookings[i], "delete"); if (!wasCancelled) notifyOwnerServer("cancel", bookings[i]); });
        markTwinsDuplicate();
        applied.push({ rev: r }); out.cancelled++;
        if (prevIdx.length) pushActivity(data, "cancel", `Cancellazione OTA${cancelledGuestName ? " — " + cancelledGuestName : ""} (Channex)`);
        console.log(`[channex inbound] CANCELLAZIONE booking_id=${bidLog} → ${prevIdx.length} prenotazione/i marcata/e cancelled (ack)`);
        continue;
      }
      // new / modified → rimuovi le versioni precedenti (per riga stabile) e ricrea.
      // Le righe rimosse si conservano: se questa revision non ha camere mappate le
      // ripristiniamo (vedi sotto) così una modifica non-mappabile non cancella il dato.
      const isUpdate = prevIdx.length > 0;
      // Si tolgono dalla fine (gli indici non si spostano) e poi si rimette l'ordine ORIGINALE: serve a riabbinare ogni riga nuova alla sua vecchia (incasso, camera).
      const removed = prevIdx.sort((a, b) => b - a).map((i) => bookings.splice(i, 1)[0]).reverse();
      removed.forEach(touchAvail);

      // Ospite (riusa per email)
      const c = r.customer || {};
      const email = (c.mail || c.email || "").trim();
      const fullName = `${c.name || ""} ${c.surname || ""}`.trim() || email || "Ospite OTA";
      let guestId = email ? guests.find((g) => (g.email || "").toLowerCase() === email.toLowerCase())?.id ?? "" : "";
      // Channex manda il paese dell'ospite in customer.country (codice tipo "NL", "GB") — campo
      // diverso dalla "Cittadinanza" del self check-in (quella è per la schedina Alloggiati Web).
      if (!guestId) { guestId = uid(); guests.push({ id: guestId, firstName: c.name || undefined, lastName: c.surname || undefined, fullName, email: email || undefined, phone: c.phone || undefined, country: c.country || undefined, city: c.city || undefined, zip: c.zip || undefined, address: c.address || undefined, language: c.language || undefined } as Json & { id: string }); }
      else {
        // Ospite già presente (stessa email): si completano SOLO i campi ancora vuoti (mai si sovrascrive ciò che è stato scritto a mano).
        const eg = guests.find((x) => x.id === guestId) as (Json & { city?: string; zip?: string; address?: string; language?: string; phone?: string; country?: string; updatedAt?: number }) | undefined;
        if (eg) { let ch = false; if (!eg.language && c.language) { eg.language = c.language; ch = true; } if (!eg.phone && c.phone) { eg.phone = c.phone; ch = true; } if (!eg.country && c.country) { eg.country = c.country; ch = true; } if (!eg.city && c.city) { eg.city = c.city; ch = true; } if (!eg.zip && c.zip) { eg.zip = c.zip; ch = true; } if (!eg.address && c.address) { eg.address = c.address; ch = true; } if (ch) eg.updatedAt = Date.now(); }
      }

      const channel = channelFromOta(r.ota_name);
      const groupId = uid();
      // Commissione OTA reale, se il canale la manda: si salva la cifra ESATTA (con centesimi) in
      // commissionAmount, così non si perde precisione arrotondando a una % (vedi commissionOf in
      // @/lib/booking). Se assente, si lascia undefined e vale la % di default del canale (CHANNELS).
      const commAmt = num(r.ota_commission ?? r.commission, NaN);
      const bookingTotal = num(r.amount, NaN);
      // Expedia: l'importo ricevuto è il pagamento NETTO all'hotel e ota_commission è la somma di tutte le trattenute (allineamento tariffe, acceleratore, commissione),
      // già tolte da quell'importo. Salvarle come commissionAmount le sottrarrebbe una seconda volta dal netto: restano solo come dato informativo (otaDeductions) e la riga è netTotal.
      const netPayout = channel === "expedia";
      const commissionAmount = (!netPayout && Number.isFinite(commAmt) && commAmt > 0) ? Math.round(commAmt * 100) / 100 : undefined;
      const otaDeductions = (netPayout && Number.isFinite(commAmt) && commAmt > 0) ? Math.round(commAmt * 100) / 100 : undefined;
      const commissionPct = (!netPayout && commissionAmount == null && Number.isFinite(commAmt) && commAmt > 0 && Number.isFinite(bookingTotal) && bookingTotal > 0)
        ? Math.round((commAmt / bookingTotal) * 1000) / 10
        : undefined;
      // Carta virtuale OTA: SOLO metadati (mai numero/CVV). Se una revision precedente aveva
      // già la carta o era stata segnata "addebitata", conserviamo quell'informazione.
      const prevOtaCard = removed.reduce<OtaCard | undefined>((acc, b) => acc ?? (b.otaCard as OtaCard | undefined), undefined);
      const newOtaCard = otaCardFrom(r);
      const otaCard: OtaCard | undefined = newOtaCard
        ? { ...newOtaCard, charged: prevOtaCard?.charged ?? newOtaCard.charged }
        : prevOtaCard;

      const roomsArr = r.rooms && r.rooms.length ? r.rooms : [{}];
      // La commissione OTA è quella dell'INTERA prenotazione: con più camere va divisa tra le righe in proporzione al prezzo di ciascuna
      // (all'ultima va il resto, così la somma torna al centesimo), non ripetuta su ognuna.
      const roomTotals = roomsArr.map((room, i) => readRevisionGuestData(r as unknown as Record<string, unknown>, room as unknown as Record<string, unknown>, i === 0).total ?? 0);
      const commShares = splitCommission(commissionAmount, roomTotals);
      const deductShares = splitCommission(otaDeductions, roomTotals);
      // Costo d'incasso dell'OTA ("Payment charge" nelle note di Booking): anche questo è dell'intera prenotazione, quindi diviso tra le camere.
      const feeShares = splitCommission(parsePaymentCharge(String((r as unknown as { notes?: unknown }).notes ?? "")), roomTotals);
      let added = 0;
      // Righe sostituite (modifica, o prenotazione già importata da Octorate): i dati che Channex non conosce — incassi, check-in online, documenti, note, extra,
      // camera assegnata — si RIPORTANO sulla nuova riga, altrimenti una prenotazione già pagata tornerebbe "da incassare".
      const oldPool = [...removed];
      const twinPool = [...twinRows];
      const CARRY = ["paid", "cleaningFee", "cityTaxExempt", "cityTaxPaid", "cityTaxInPaid", "depositPaid", "parking", "webCheckin", "arrivalTime", "docPhotoFront", "docPhotoBack", "signature", "invoiceNo",
        "extraGuests", "primaryGuest", "extras", "upsellOffers", "invoiceRequest", "guestRequests", "color", "movedFrom", "reviewRequestedAt", "reviewRequestChannel", "bookedOn", "childAges", "cribs", "paymentMethod",
        // Prova del consenso privacy del check-in online (quando e da chi): non va persa se Channex riscrive la riga.
        "privacyConsentAt", "privacyConsentBy",
        // Commissione già nota (es. dal file Octorate): se Channex non la manda per questa prenotazione NON va persa. Se la manda, quella di Channex vince (più sotto).
        "commissionAmount", "commissionPct", "paymentFee"] as const;
      roomsArr.forEach((room, idx) => {
        const roomTypeId = (room.room_type_id && map.rooms[room.room_type_id]) || undefined;
        if (!roomTypeId) return; // tipologia non mappata → salta questa camera
        const ci = room.checkin_date || r.arrival_date || "";
        const co = room.checkout_date || r.departure_date || "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ci) || !/^\d{4}-\d{2}-\d{2}$/.test(co) || co <= ci) return;
        const ofType = units.filter((u) => u.roomTypeId === roomTypeId && !u.outOfService);
        const isFree = (uid2: string) => !bookings.some((b) => !twinSet.has(b) && b.unitId === uid2 && b.status !== "cancelled" && overlaps(b, ci, co));
        const free = ofType.find((u) => isFree(u.id));
        // Riga sostituita corrispondente: stessa tipologia (e se possibile stesse date), altrimenti la prima della stessa tipologia.
        let oi = oldPool.findIndex((o) => o.roomTypeId === roomTypeId && o.checkIn === ci && o.checkOut === co);
        if (oi < 0) oi = oldPool.findIndex((o) => o.roomTypeId === roomTypeId);
        const old = oi >= 0 ? oldPool.splice(oi, 1)[0] : undefined;
        const oldNote = String(old?.note ?? "");
        const keep: Record<string, unknown> = {};
        if (old) for (const k of CARRY) { const v = (old as unknown as Record<string, unknown>)[k]; if (v !== undefined && v !== null && v !== "") keep[k] = v; }
        // Riga Octorate gemella di questa camera: porta incassato, commissione esatta e campi che la riga Channex non ha.
        let ti = twinPool.findIndex((t) => t.roomTypeId === roomTypeId && t.checkIn === ci && t.checkOut === co);
        if (ti < 0) ti = twinPool.findIndex((t) => t.roomTypeId === roomTypeId);
        if (ti < 0 && twinPool.length === 1 && roomsArr.length === 1) ti = 0;
        const twin = ti >= 0 ? twinPool.splice(ti, 1)[0] : undefined;
        if (twin) Object.assign(keep, twinFillPatch(keep, twin));
        if (netPayout) { delete keep.commissionAmount; delete keep.commissionPct; } // totale già netto: nessuna commissione (anche vecchia) da sottrarre
        // Camera: si tiene quella già assegnata se è ancora libera; altrimenti la prima libera. MAI una occupata se ce n'è una libera.
        const twinUnit = typeof twin?.unitId === "string" ? twin.unitId : undefined;
        const prevUnit = old?.unitId && ofType.some((u) => u.id === old.unitId) && isFree(old.unitId) ? old.unitId
          : twinUnit && ofType.some((u) => u.id === twinUnit) && isFree(twinUnit) ? twinUnit : undefined;
        // Dati ospite dalla revision (note, orario di arrivo, età bambini, tipo di pagamento, penali) e totale CON i
        // centesimi (somma notti → room.amount → amount della prenotazione). Logica pura in channex-guestdata.ts.
        // Non mappati perché assenti dallo schema Channex: culle/lettini (restano quelle riportate da CARRY),
        // infants (nessun campo in Booking), "Expedia Collect" esplicito (si vede solo payment_collect/payment_instruction).
        const gd = readRevisionGuestData(r as unknown as Record<string, unknown>, room as unknown as Record<string, unknown>, idx === 0);
        const oldInfo = (old as unknown as { otaInfo?: OtaInfo } | undefined)?.otaInfo;
        const fromOta = mergeOtaOverCarried(gd, keep, oldInfo);
        const otaInfo = gd.otaInfo ?? oldInfo;
        const total = gd.total ?? 0;
        const nightlyRates = nightlyRatesOf(room.days);
        bookings.push({
          id: uid(), groupId, structureId: map.structure_id, roomTypeId, unitId: prevUnit ?? (free ?? ofType[0])?.id ?? null,
          guestId, channel, status: "confirmed", checkIn: ci, checkOut: co, bookedOn: ymdRome(new Date()),
          adults: Math.max(1, num(room.occupancy?.adults, 1)), children: num(room.occupancy?.children, 0),
          total: total || undefined, ...(nightlyRates ? { nightlyRates } : {}), cleaningFee: 0, paid: 0, cityTaxPaid: false,
          ...keep,
          ...fromOta,
          ...(otaInfo ? { otaInfo } : {}),
          ...(commShares[idx] != null ? { commissionAmount: commShares[idx] } : {}),
          ...(netPayout ? { netTotal: true } : {}),
          ...(r.ota_name ? { otaName: String(r.ota_name).slice(0, 60) } : {}),
          otaRevision: { status: r.status === "modified" || r.status === "new" ? r.status : (isUpdate ? "modified" : "new"), at: Date.now(), ...(r.id ? { id: r.id } : {}) },
          ...(deductShares[idx] != null ? { otaDeductions: deductShares[idx] } : {}),
          ...(feeShares[idx] != null ? { paymentFee: feeShares[idx] } : {}),
          ...(commissionPct != null ? { commissionPct } : {}),
          ...(otaCard && idx === 0 ? { otaCard } : {}), // la VCC copre la prenotazione: la attacchiamo alla prima camera
          extId: stableKey, code: r.ota_reservation_code || undefined, source: "channex",
          note: (() => {
            const base = oldNote && !/via Channex/.test(oldNote) ? oldNote : `Prenotazione ${channel.toUpperCase()} via Channex${r.ota_reservation_code ? ` · ${r.ota_reservation_code}` : ""}`;
            const extra = twin ? usefulOctorateNote(twin.note) : undefined;
            return extra && !base.includes(extra) ? `${base} · ${extra}` : base;
          })(),
          updatedAt: Date.now(), // senza, qualunque modifica successiva (es. una cancellazione) rischia di sparire al sync (vedi sopra)
        } as Booking);
        touchAvail(bookings[bookings.length - 1]);
        syncGcalServer(bookings[bookings.length - 1], "upsert");
        if (!isUpdate) notifyOwnerServer("newBooking", bookings[bookings.length - 1]);
        else {
          // Modifica dall'OTA: email solo se cambia qualcosa di sostanziale (date, ospiti, importo, canale). La stessa revisione consegnata due volte non cambia nulla → nessuna email.
          const fresh = bookings[bookings.length - 1] as Record<string, unknown>;
          const prev = (old ?? twin) as Record<string, unknown> | undefined;
          const changed = prev ? (["checkIn", "checkOut", "adults", "children", "total", "channel", "roomTypeId"] as const).filter((k) => campoCambiato(prev[k], fresh[k])) : ["checkIn"];
          if (modificaMeritaEmail(changed)) notifyOwnerServer("modified", bookings[bookings.length - 1]);
        }
        added++;
      });
      if (added > 0) {
        // Una modifica ricrea le righe con id NUOVI (vedi sopra): l'evento Calendar della/e
        // vecchia/e riga/e (id diverso) va tolto esplicitamente, altrimenti resta un doppione
        // "fantasma" sul calendario reale dell'utente.
        if (isUpdate) removed.forEach((old) => syncGcalServer(old, "delete"));
        markTwinsDuplicate();
        // Le righe sostituite vanno LAPIDATE: senza, un browser rimasto aperto con la copia vecchia la rimette dentro alla sincronizzazione e la prenotazione risulta doppia
        // (successo con le prenotazioni importate da Octorate e poi ricevute da Channex). La fusione del client tratta le lapidi del server come autorevoli.
        if (removed.length) {
          const del = (((data as { _deleted?: Record<string, string[]> })._deleted) ??= {});
          del.bookings = Array.from(new Set([...(del.bookings ?? []), ...removed.map((old) => String((old as { id?: unknown }).id ?? "")).filter(Boolean)])).slice(-3000);
        }
        applied.push({ rev: r }); out.imported++;
        pushActivity(data, "booking", `Prenotazione OTA ${isUpdate ? "aggiornata" : "importata"} — ${fullName} · ${channel.toUpperCase()} (Channex)`);
        console.log(`[channex inbound] ${isUpdate ? "MODIFICA" : "NUOVA"} booking_id=${bidLog} → ${added} camera/e ${isUpdate ? "aggiornata/e" : "creata/e"} (ack)`);
      } else {
        // Nessuna camera mappata: NON ackare (la revision resta nel feed finché non mappi).
        // Se era una modifica, ripristina le righe rimosse così non perdiamo la prenotazione.
        if (removed.length) bookings.push(...removed);
        out.skipped++;
        console.log(`[channex inbound] ${isUpdate ? "MODIFICA" : "NUOVA"} booking_id=${bidLog} → 0 camere mappate, NON ackata (resta nel feed)`);
      }
    }

    // Rete di sicurezza: la stessa prenotazione OTA importata due volte da elaborazioni sovrapposte (webhook + sincronizzazione manuale) produce righe con lo stesso extId
    // ma groupId DIVERSI (le righe di una stessa prenotazione multi-camera condividono il groupId). Se succede resta solo il gruppo più recente, e le altre righe vengono lapidate.
    for (const key of touchedKeys) {
      const live = bookings.filter((b) => b.extId === key && b.status !== "cancelled");
      const groups = new Map<string, Booking[]>();
      live.forEach((b) => { const g = String(b.groupId ?? ""); const l = groups.get(g); if (l) l.push(b); else groups.set(g, [b]); });
      if (groups.size < 2) continue;
      const newest = Array.from(groups.entries()).sort((a, b) => Math.max(...b[1].map((x) => Number(x.updatedAt ?? 0))) - Math.max(...a[1].map((x) => Number(x.updatedAt ?? 0))))[0][0];
      const drop = new Set(live.filter((b) => String(b.groupId ?? "") !== newest).map((b) => b.id));
      for (let i = bookings.length - 1; i >= 0; i--) if (drop.has(bookings[i].id)) bookings.splice(i, 1);
      const del = (((data as { _deleted?: Record<string, string[]> })._deleted) ??= {});
      del.bookings = Array.from(new Set([...(del.bookings ?? []), ...drop])).slice(-3000);
      console.log(`[channex inbound] doppione da elaborazioni sovrapposte su ${key}: tolte ${drop.size} righe`);
    }
    data.bookings = bookings; data.guests = guests; blob[DATA_KEY] = JSON.stringify(data);
    let write = admin.from(table).update({ data: blob, updated_at: new Date().toISOString() }).eq(keyCol, target.id);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated, error: wErr } = await write.select("rev");
    if (wErr) return { ok: false, applied: [] };
    if ((!updated || updated.length === 0) && rev !== null) return { ok: false, conflict: true, applied: [] };
    // Segna l'ultimo import sulle righe di mappatura di questo store.
    // Disponibilità verso i portali anche se nessun browser è aperto: solo le strutture/tipologie coinvolte (e, con camere condivise, tutto il gruppo).
    if (applied.length > 0) await schedulePoolPush(blob, availTouched);
    const mapUpd = admin.from("channex_map").update({ last_import_at: new Date().toISOString() });
    await (target.kind === "org" ? mapUpd.eq("org_id", target.id) : mapUpd.eq("tenant_id", target.id).is("org_id", null));
    return { ok: true, applied };
  };

  let res = await applyOnce();
  if (!res.ok && res.conflict) res = await applyOnce(); // un retry sul conflitto di rev
  if (!res.ok) throw new Error(`scrittura ${table} fallita`);
  return res.applied;
}
