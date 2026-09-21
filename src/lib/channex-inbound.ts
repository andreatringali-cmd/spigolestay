// ============================================================
//  Channex → Xenora: import prenotazioni in ENTRATA (2-way sync).
//  Flusso robusto consigliato da Channex: leggi il feed delle booking revision
//  non ancora confermate, risolvi la property (→ tenant + struttura + tipologie),
//  scrivi la prenotazione nella app_state del proprietario, poi ACK.
//  Tutto server-side (service role). Idempotente per booking_id (extId).
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingRevisionsFeed, ackBookingRevision, type ChxRevision } from "@/lib/channex";

const DATA_KEY = "spigolestay:data:v1";
type Json = Record<string, unknown>;
type Booking = Json & { id: string; structureId: string; roomTypeId: string; unitId: string | null; checkIn: string; checkOut: string; status: string; extId?: string };
type Unit = { id: string; roomTypeId: string; structureId?: string; outOfService?: boolean };
const overlaps = (b: { checkIn: string; checkOut: string }, ci: string, co: string) => b.checkIn < co && b.checkOut > ci;
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `x_${Date.now()}_${Math.random().toString(36).slice(2)}`);

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
function channelFromOta(ota?: string): string {
  const s = (ota || "").toLowerCase();
  if (!s) return "direct";
  if (s.includes("book")) return "booking";
  if (s.includes("airbnb")) return "airbnb";
  if (s.includes("expedia") || s.includes("vrbo") || s.includes("homeaway")) return "expedia";
  if (s.includes("direct") || s.includes("crs") || s.includes("website")) return "direct";
  return "other";
}

const num = (v: unknown, d = 0) => { const n = Number(v); return isNaN(n) ? d : n; };
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

  // Raggruppa le revision per STORE di destinazione. Struttura condivisa → org_state(org_id);
  // struttura personale → app_state(tenant_id). Le property non mappate: skip SENZA ack.
  const byStore = new Map<string, { target: StoreTarget; items: { rev: ChxRevision; map: ChannexMapRow }[] }>();
  for (const rev of feed.revisions) {
    const map = rev.property_id ? mapByProp.get(rev.property_id) : undefined;
    if (!map) { out.skipped++; continue; }
    const target: StoreTarget = map.org_id ? { kind: "org", id: map.org_id } : { kind: "user", id: map.tenant_id };
    const key = `${target.kind}:${target.id}`;
    const g = byStore.get(key) ?? { target, items: [] }; g.items.push({ rev, map }); byStore.set(key, g);
  }

  const ackIds: string[] = [];
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
    const applied: { rev: ChxRevision }[] = [];

    for (const { rev: r, map } of items) {
      const extId = `channex:${r.booking_id || r.id}`;
      // Rimuovi eventuali prenotazioni precedenti di questa stessa booking (modifica/cancellazione).
      const prevIdx = bookings.map((b, i) => (b.extId === extId ? i : -1)).filter((i) => i >= 0);
      if (r.status === "cancelled") {
        prevIdx.forEach((i) => { bookings[i].status = "cancelled"; });
        applied.push({ rev: r }); out.cancelled++;
        continue;
      }
      // new / modified → ricrea
      for (const i of prevIdx.sort((a, b) => b - a)) bookings.splice(i, 1);

      // Ospite (riusa per email)
      const c = r.customer || {};
      const email = (c.mail || c.email || "").trim();
      const fullName = `${c.name || ""} ${c.surname || ""}`.trim() || email || "Ospite OTA";
      let guestId = email ? guests.find((g) => (g.email || "").toLowerCase() === email.toLowerCase())?.id ?? "" : "";
      if (!guestId) { guestId = uid(); guests.push({ id: guestId, firstName: c.name || undefined, lastName: c.surname || undefined, fullName, email: email || undefined, phone: c.phone || undefined } as Json & { id: string }); }

      const channel = channelFromOta(r.ota_name);
      const groupId = uid();
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
          extId, code: r.ota_reservation_code || undefined, source: "channex",
          note: `Prenotazione ${channel.toUpperCase()} via Channex${r.ota_reservation_code ? ` · ${r.ota_reservation_code}` : ""}`,
        } as Booking);
        added++;
      });
      if (added > 0) { applied.push({ rev: r }); out.imported++; }
      else out.skipped++; // nessuna camera mappata: non ackare (resta nel feed finché mappi)
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
