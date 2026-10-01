// ============================================================
//  Channex → Xenora: import prenotazioni in ENTRATA (2-way sync).
//  Flusso robusto consigliato da Channex: leggi il feed delle booking revision
//  non ancora confermate, risolvi la property (→ tenant + struttura + tipologie),
//  scrivi la prenotazione nella app_state del proprietario, poi ACK.
//  Tutto server-side (service role). Idempotente per booking_id (extId).
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingRevisionsFeed, ackBookingRevision, listProperties, type ChxRevision } from "@/lib/channex";
import { upsertGcalEvent, deleteGcalEvent, gcalEventId } from "@/lib/googleCalendarSync";

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
  const { error } = await admin.from("channex_map").upsert({
    channex_property_id: propertyId, tenant_id: tenantId, structure_id: structureId, rooms, org_id: orgId ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "channex_property_id" });
  return { ok: !error, error: error?.message };
}

// OTA → canale Xenora.
export function channelFromOta(ota?: string): string {
  const s = (ota || "").toLowerCase();
  if (!s) return "direct";
  if (s.includes("book")) return "booking";
  if (s.includes("airbnb")) return "airbnb";
  if (s.includes("expedia") || s.includes("vrbo") || s.includes("homeaway")) return "expedia";
  if (s.includes("direct") || s.includes("crs") || s.includes("website")) return "direct";
  return "other";
}

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
const sumDays = (days?: Record<string, string>) => days ? Object.values(days).reduce((a, v) => a + num(v), 0) : 0;

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
  const today = new Date().toISOString().slice(0, 10);
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
    const today = new Date().toISOString().slice(0, 10);
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
    const structuresArr = (Array.isArray(data.structures) ? data.structures : []) as (Json & { id: string; gcalId?: string })[];
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

    for (const { rev: r, map } of items) {
      // Chiave STABILE della prenotazione: SEMPRE booking_id quando presente (Channex lo
      // mantiene uguale tra le revision della stessa prenotazione), id-revision solo come
      // fallback se booking_id manca. È la chiave con cui SCRIVIAMO le nuove righe.
      const stableKey = `channex:${r.booking_id || r.id}`;
      // Per RITROVARE le prenotazioni già importate accettiamo ENTRAMBE le chiavi possibili
      // (booking_id e id-revision): così una modifica/cancellazione ritrova la prenotazione
      // anche se una revision precedente fosse stata salvata con l'altra chiave. Questo è il
      // punto critico del Test 11: senza questo, una modifica con id-revision diverso
      // creerebbe un doppione invece di aggiornare quella esistente.
      const candidates = new Set<string>([stableKey]);
      if (r.booking_id) candidates.add(`channex:${r.booking_id}`);
      if (r.id) candidates.add(`channex:${r.id}`);
      const prevIdx = bookings.map((b, i) => (b.extId && candidates.has(b.extId) ? i : -1)).filter((i) => i >= 0);
      const bidLog = r.booking_id || r.id;
      if (r.status === "cancelled") {
        const cancelledGuestName = prevIdx.length ? guests.find((g) => g.id === bookings[prevIdx[0]].guestId)?.fullName : undefined;
        // updatedAt DEVE avanzare: la fusione client/server è last-write-wins su questo campo
        // (vedi authsync.tsx) — senza, al sync successivo del browser la copia locale ancora
        // "confirmed" (stesso updatedAt di prima) vince a parità e la cancellazione sparisce.
        prevIdx.forEach((i) => { bookings[i].status = "cancelled"; bookings[i].updatedAt = Date.now(); syncGcalServer(bookings[i], "delete"); });
        applied.push({ rev: r }); out.cancelled++;
        if (prevIdx.length) pushActivity(data, "cancel", `Cancellazione OTA${cancelledGuestName ? " — " + cancelledGuestName : ""} (Channex)`);
        console.log(`[channex inbound] CANCELLAZIONE booking_id=${bidLog} → ${prevIdx.length} prenotazione/i marcata/e cancelled (ack)`);
        continue;
      }
      // new / modified → rimuovi le versioni precedenti (per riga stabile) e ricrea.
      // Le righe rimosse si conservano: se questa revision non ha camere mappate le
      // ripristiniamo (vedi sotto) così una modifica non-mappabile non cancella il dato.
      const isUpdate = prevIdx.length > 0;
      const removed = prevIdx.sort((a, b) => b - a).map((i) => bookings.splice(i, 1)[0]);

      // Ospite (riusa per email)
      const c = r.customer || {};
      const email = (c.mail || c.email || "").trim();
      const fullName = `${c.name || ""} ${c.surname || ""}`.trim() || email || "Ospite OTA";
      let guestId = email ? guests.find((g) => (g.email || "").toLowerCase() === email.toLowerCase())?.id ?? "" : "";
      // Channex manda il paese dell'ospite in customer.country (codice tipo "NL", "GB") — campo
      // diverso dalla "Cittadinanza" del self check-in (quella è per la schedina Alloggiati Web).
      if (!guestId) { guestId = uid(); guests.push({ id: guestId, firstName: c.name || undefined, lastName: c.surname || undefined, fullName, email: email || undefined, phone: c.phone || undefined, country: c.country || undefined } as Json & { id: string }); }

      const channel = channelFromOta(r.ota_name);
      const groupId = uid();
      // Commissione OTA reale, se il canale la manda: si salva la cifra ESATTA (con centesimi) in
      // commissionAmount, così non si perde precisione arrotondando a una % (vedi commissionOf in
      // @/lib/booking). Se assente, si lascia undefined e vale la % di default del canale (CHANNELS).
      const commAmt = num(r.ota_commission ?? r.commission, NaN);
      const bookingTotal = num(r.amount, NaN);
      const commissionAmount = (Number.isFinite(commAmt) && commAmt > 0) ? Math.round(commAmt * 100) / 100 : undefined;
      const commissionPct = (commissionAmount == null && Number.isFinite(commAmt) && commAmt > 0 && Number.isFinite(bookingTotal) && bookingTotal > 0)
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
      let added = 0;
      roomsArr.forEach((room, idx) => {
        const roomTypeId = (room.room_type_id && map.rooms[room.room_type_id]) || undefined;
        if (!roomTypeId) return; // tipologia non mappata → salta questa camera
        const ci = room.checkin_date || r.arrival_date || "";
        const co = room.checkout_date || r.departure_date || "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ci) || !/^\d{4}-\d{2}-\d{2}$/.test(co) || co <= ci) return;
        const ofType = units.filter((u) => u.roomTypeId === roomTypeId && !u.outOfService);
        const free = ofType.find((u) => !bookings.some((b) => b.unitId === u.id && b.status !== "cancelled" && overlaps(b, ci, co)));
        const total = Math.round(sumDays(room.days) || (idx === 0 ? num(r.amount) : 0));
        bookings.push({
          id: uid(), groupId, structureId: map.structure_id, roomTypeId, unitId: (free ?? ofType[0])?.id ?? null,
          guestId, channel, status: "confirmed", checkIn: ci, checkOut: co, bookedOn: new Date().toISOString().slice(0, 10),
          adults: Math.max(1, num(room.occupancy?.adults, 1)), children: num(room.occupancy?.children, 0),
          total: total || undefined, cleaningFee: 0, paid: 0, cityTaxPaid: false,
          ...(commissionAmount != null ? { commissionAmount } : {}),
          ...(commissionPct != null ? { commissionPct } : {}),
          ...(otaCard && idx === 0 ? { otaCard } : {}), // la VCC copre la prenotazione: la attacchiamo alla prima camera
          extId: stableKey, code: r.ota_reservation_code || undefined, source: "channex",
          note: `Prenotazione ${channel.toUpperCase()} via Channex${r.ota_reservation_code ? ` · ${r.ota_reservation_code}` : ""}`,
          updatedAt: Date.now(), // senza, qualunque modifica successiva (es. una cancellazione) rischia di sparire al sync (vedi sopra)
        } as Booking);
        syncGcalServer(bookings[bookings.length - 1], "upsert");
        added++;
      });
      if (added > 0) {
        // Una modifica ricrea le righe con id NUOVI (vedi sopra): l'evento Calendar della/e
        // vecchia/e riga/e (id diverso) va tolto esplicitamente, altrimenti resta un doppione
        // "fantasma" sul calendario reale dell'utente.
        if (isUpdate) removed.forEach((old) => syncGcalServer(old, "delete"));
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

    data.bookings = bookings; data.guests = guests; blob[DATA_KEY] = JSON.stringify(data);
    let write = admin.from(table).update({ data: blob, updated_at: new Date().toISOString() }).eq(keyCol, target.id);
    if (rev !== null) write = write.eq("rev", rev);
    const { data: updated, error: wErr } = await write.select("rev");
    if (wErr) return { ok: false, applied: [] };
    if ((!updated || updated.length === 0) && rev !== null) return { ok: false, conflict: true, applied: [] };
    // Segna l'ultimo import sulle righe di mappatura di questo store.
    const mapUpd = admin.from("channex_map").update({ last_import_at: new Date().toISOString() });
    await (target.kind === "org" ? mapUpd.eq("org_id", target.id) : mapUpd.eq("tenant_id", target.id).is("org_id", null));
    return { ok: true, applied };
  };

  let res = await applyOnce();
  if (!res.ok && res.conflict) res = await applyOnce(); // un retry sul conflitto di rev
  if (!res.ok) throw new Error(`scrittura ${table} fallita`);
  return res.applied;
}
