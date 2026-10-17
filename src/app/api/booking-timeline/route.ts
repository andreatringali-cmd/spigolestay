import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { findBookingStoreForTenant, type BookingStore } from "@/lib/manage-booking";
import { ownerOfOrg } from "@/lib/auto-trace";
import { allowedChannexProperties } from "@/lib/channex-guard";
import { documentServerEvents, atMs, type ServerEvent } from "@/lib/booking-timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cronologia di UNA prenotazione: legge dalle tabelle del server le righe che la riguardano e le restituisce normalizzate.
// La formattazione in italiano e l'unione con i dati del browser (chat, registro attività) le fa lib/booking-timeline.ts.
//
// Sicurezza: la prenotazione deve stare nello store (personale o organizzazione condivisa) a cui l'utente ha accesso
// (stessa verifica del link di pagamento in chat). Le righe lette sono solo quelle con l'id di QUELLA prenotazione
// (o delle camere del suo gruppo) e dei tenant del suo stesso store.
//
// Fonti: invii_log (job messaggi/checkin), auto_message_log, channex_bookings, booking_events, alloggiati_schedine,
// istat_rows, documents. Se una tabella non si legge la timeline esce comunque con le altre e `partial` dice quali mancano.

const MAX_EVENTS = 200;
const PER_TABLE = 120;

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const iso = (v: unknown): string => { const s = str(v); return s && atMs(s) !== null ? s : ""; };

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const { admin, tenantId, userId } = auth;

  let bookingId = "";
  try { const b = await req.json(); bookingId = typeof b?.bookingId === "string" ? b.bookingId.trim() : ""; } catch { /* corpo non valido */ }
  if (!bookingId || bookingId.length > 100) return NextResponse.json({ error: "bad_request", message: "Prenotazione non valida." }, { status: 400 });

  try {
    // Autorizzazione: la prenotazione deve esistere nello store del tenant (o, per un titolare che co-gestisce, nel proprio).
    let store: BookingStore | null = await findBookingStoreForTenant(admin, tenantId, bookingId);
    if (!store && userId !== tenantId) store = await findBookingStoreForTenant(admin, userId, bookingId);
    if (!store) return NextResponse.json({ error: "not_found", message: "Prenotazione non trovata o non accessibile." }, { status: 404 });

    const booking = store.booking as Row;
    const groupId = str(booking.groupId);
    const members = (Array.isArray(store.data.bookings) ? (store.data.bookings as Row[]) : []).filter((x) => groupId && str(x.groupId) === groupId);
    const bookingIds = Array.from(new Set([bookingId, ...members.map((m) => str(m.id)).filter(Boolean)])).slice(0, 30);
    const channexIds = Array.from(new Set([booking, ...members].map((m) => str(m.extId)).filter((e) => e.startsWith("channex:")).map((e) => e.slice(8)).filter(Boolean)));

    // Chi può aver scritto le righe: l'utente stesso, il suo titolare, la chiave dello store e, per una struttura condivisa, il titolare dell'organizzazione e chi ha collegato Channex.
    const tenants = new Set<string>([tenantId, userId, store.keyVal]);
    if (store.table === "org_state") {
      const owner = await ownerOfOrg(admin, store.keyVal);
      if (owner) tenants.add(owner);
      try {
        const { data } = await admin.from("channex_map").select("tenant_id").eq("org_id", store.keyVal);
        for (const r of (data ?? []) as Row[]) if (str(r.tenant_id)) tenants.add(str(r.tenant_id));
      } catch { /* mappa non leggibile */ }
    }
    const tenantList = Array.from(tenants);

    // Property Channex dell'utente (proprie o di una struttura condivisa a cui è socio ATTIVO): serve a filtrare channex_bookings, che è globale per id Channex.
    let allowedProps = new Set<string>();
    if (channexIds.length) {
      try {
        allowedProps = await allowedChannexProperties(admin, tenantId);
        if (userId !== tenantId) for (const p of await allowedChannexProperties(admin, userId)) allowedProps.add(p);
      } catch { /* property non leggibili: si restringe ai soli tenant dello store */ }
    }

    const partial: string[] = [];
    const run = async (name: string, q: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<Row[]> => {
      try {
        const { data, error } = await q;
        if (error) { partial.push(name); return []; }
        return Array.isArray(data) ? (data as Row[]) : [];
      } catch { partial.push(name); return []; }
    };

    const [invii, autoLog, chx, evs, sched, istat, docs] = await Promise.all([
      run("invii_log", admin.from("invii_log").select("at, job, channel, ok, detail").in("ref", bookingIds).in("tenant_id", tenantList).in("job", ["messaggi", "checkin"]).order("at", { ascending: false }).limit(PER_TABLE)),
      run("auto_message_log", admin.from("auto_message_log").select("template_id, slot_date, sent_at").in("booking_id", bookingIds).in("tenant_id", tenantList).order("sent_at", { ascending: false }).limit(PER_TABLE)),
      channexIds.length
        ? run("channex_bookings", admin.from("channex_bookings").select("revision_id, status, ota_reservation_code, imported_at, tenant_id, channex_property_id").in("booking_id", channexIds).order("imported_at", { ascending: false }).limit(PER_TABLE))
        : Promise.resolve([] as Row[]),
      run("booking_events", admin.from("booking_events").select("ts, kind, message").in("booking_id", bookingIds).in("tenant_id", tenantList).order("ts", { ascending: false }).limit(PER_TABLE)),
      run("alloggiati_schedine", admin.from("alloggiati_schedine").select("stato, errors, updated_at").in("booking_id", bookingIds).in("tenant_id", tenantList).limit(PER_TABLE)),
      run("istat_rows", admin.from("istat_rows").select("stato, updated_at").in("booking_id", bookingIds).in("tenant_id", tenantList).limit(PER_TABLE)),
      run("documents", admin.from("documents").select("doc_kind, number_label, stato, created_at, issued_at, sent_at, delivered_at, updated_at").in("booking_id", bookingIds).in("tenant_id", tenantList).limit(PER_TABLE)),
    ]);

    const events: ServerEvent[] = [];
    for (const r of invii) { const at = iso(r.at); if (at) events.push({ src: "invii_log", at, job: str(r.job), channel: str(r.channel), ok: r.ok === true, detail: str(r.detail) || undefined }); }
    for (const r of autoLog) { const at = iso(r.sent_at); if (at) events.push({ src: "auto_message_log", at, templateId: str(r.template_id), slotDate: str(r.slot_date) || undefined }); }
    for (const r of chx) {
      // channex_bookings è globale per id Channex: con property si tiene la riga solo se la property è dell'utente (anche con tenant nullo);
      // senza property (importata prima della mappatura) solo se il tenant è uno di quelli di questo store. Tenant nullo e nessuna property: scartata.
      // (Lette dalla più recente: oltre PER_TABLE righe restano le ultime; l'ordine finale è fatto dopo, su tutti gli eventi.)
      const pid = str(r.channex_property_id), t = str(r.tenant_id);
      if (pid ? !allowedProps.has(pid) : !t || !tenants.has(t)) continue;
      const at = iso(r.imported_at); if (at) events.push({ src: "channex_bookings", at, revisionId: str(r.revision_id) || undefined, status: str(r.status), otaCode: str(r.ota_reservation_code) || undefined });
    }
    for (const r of evs) { const at = iso(r.ts); if (at) events.push({ src: "booking_events", at, kind: str(r.kind), message: str(r.message) }); }
    for (const r of sched) {
      const at = iso(r.updated_at); if (!at) continue;
      const errs = Array.isArray(r.errors) ? (r.errors as unknown[]).filter((e): e is string => typeof e === "string") : [];
      events.push({ src: "alloggiati_schedine", at, stato: str(r.stato), errorCount: errs.length, firstError: errs[0] });
    }
    for (const r of istat) { const at = iso(r.updated_at); if (at) events.push({ src: "istat_rows", at, stato: str(r.stato) }); }
    for (const r of docs) {
      events.push(...documentServerEvents({
        doc_kind: str(r.doc_kind) || null, number_label: str(r.number_label) || null, stato: str(r.stato) || null,
        created_at: iso(r.created_at) || null, issued_at: iso(r.issued_at) || null, sent_at: iso(r.sent_at) || null, delivered_at: iso(r.delivered_at) || null, updated_at: iso(r.updated_at) || null,
      }));
    }

    // Tetto: restano gli eventi più recenti.
    events.sort((a, b) => (atMs(b.at) ?? 0) - (atMs(a.at) ?? 0));
    return NextResponse.json({ ok: true, events: events.slice(0, MAX_EVENTS), ...(partial.length ? { partial } : {}) });
  } catch (e) {
    console.error("[booking-timeline]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "server_error", message: "Non riesco a leggere la cronologia, riprova tra poco." }, { status: 500 });
  }
}
