// Servizi server-side del modulo fatturazione. Girano con il SERVICE ROLE
// (come /api/stripe/quote/confirm): la RLS è bypassata, quindi l'autorizzazione
// dell'utente va fatta a monte nella route API (verifica bearer → tenantId).
//
// Le prenotazioni/folio vivono nel blob JSONB (app_state, fallback org_state):
// qui li leggo, calcolo il folio con la stessa matematica dell'app e produco la
// BOZZA relazionale (documents + document_lines). L'emissione è atomica in DB.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Structure, RoomType, Booking, Guest } from "@/lib/types";
import { cityTaxOf } from "@/lib/booking";
import { nights } from "@/lib/dates";
import {
  buildDocumentDraft, toCents, type FolioLine, type Regime, type DocKind,
} from "./folio";

const DATA_KEY = "spigolestay:data:v1";

type Blob = { structures?: Structure[]; roomTypes?: RoomType[]; bookings?: Booking[]; guests?: Guest[] };
interface Ctx { booking: Booking; structure?: Structure; roomType?: RoomType; guest?: Guest }

const dmy = (iso: string) => { const [y, m, d] = (iso || "").split("-"); return d ? `${d}/${m}/${y}` : iso; };

// Legge la prenotazione dal personale del tenant; se non c'è, cerca nelle org di cui è membro.
async function loadBookingContext(admin: SupabaseClient, tenantId: string, bookingId: string): Promise<Ctx | null> {
  const find = (blob: Blob): Ctx | null => {
    const booking = (blob.bookings ?? []).find((b) => b.id === bookingId);
    if (!booking) return null;
    return {
      booking,
      structure: (blob.structures ?? []).find((s) => s.id === booking.structureId),
      roomType: (blob.roomTypes ?? []).find((rt) => rt.id === booking.roomTypeId),
      guest: (blob.guests ?? []).find((g) => g.id === booking.guestId),
    };
  };
  const parse = (data: Record<string, string> | null | undefined): Blob => {
    try { return JSON.parse((data ?? {})[DATA_KEY] || "{}") as Blob; } catch { return {}; }
  };

  const { data: row } = await admin.from("app_state").select("data").eq("user_id", tenantId).maybeSingle();
  const personal = find(parse(row?.data as Record<string, string>));
  if (personal) return personal;

  const { data: mships } = await admin.from("memberships").select("org_id").eq("user_id", tenantId);
  for (const m of (mships ?? []) as { org_id: string }[]) {
    const { data: os } = await admin.from("org_state").select("data").eq("org_id", m.org_id).maybeSingle();
    const hit = find(parse(os?.data as Record<string, string>));
    if (hit) return hit;
  }
  return null;
}

// Costruisce le righe folio (in centesimi) dalla prenotazione, con la matematica dell'app.
function folioFromBooking(ctx: Ctx): { folio: FolioLine[]; advanceCents: number } {
  const { booking: b, structure, roomType } = ctx;
  const n = nights(b.checkIn, b.checkOut);
  const acc = b.total ?? 0;
  const folio: FolioLine[] = [];

  if (acc) {
    folio.push({
      folioRef: "acc",
      description: `${(roomType?.name ?? "Soggiorno").toUpperCase()} – ${dmy(b.checkIn)} al ${dmy(b.checkOut)}`,
      qty: 1, unitCents: toCents(acc), vatRate: 10, sourceKind: "accommodation",
    });
  }
  if (b.cleaningFee) {
    folio.push({ folioRef: "clean", description: `Pulizia finale`, qty: 1, unitCents: toCents(b.cleaningFee), vatRate: 10, sourceKind: "cleaning" });
  }
  (b.extras ?? []).forEach((e, i) => {
    if (e?.price) folio.push({ folioRef: `extra:${i}`, description: e.name || `Extra ${i + 1}`, qty: 1, unitCents: toCents(e.price), vatRate: 22, sourceKind: "extra" });
  });
  const tax = cityTaxOf(structure, b.adults ?? 0, n, acc, b.cityTaxExempt);
  if (tax) {
    folio.push({ folioRef: "citytax", description: `Imposta di soggiorno (${b.adults ?? 0} × ${Math.min(n, structure?.cityTaxMaxNights ?? 3)} notti)`, qty: 1, unitCents: toCents(tax), vatRate: 0, outOfScope: true, sourceKind: "city_tax" });
  }
  return { folio, advanceCents: toCents(b.paid) };
}

// Snapshot intestatario: esplicito → id anagrafica → ospite (privato).
async function resolveCounterpart(
  admin: SupabaseClient, tenantId: string, ctx: Ctx,
  opts: CreateOptions,
): Promise<{ counterpartId: string | null; snapshot: Record<string, unknown> }> {
  if (opts.counterpart) return { counterpartId: opts.counterpartId ?? null, snapshot: opts.counterpart };
  if (opts.counterpartId) {
    const { data } = await admin.from("counterparts").select("*").eq("id", opts.counterpartId).eq("tenant_id", tenantId).maybeSingle();
    if (data) return { counterpartId: data.id as string, snapshot: data as Record<string, unknown> };
  }
  const g = ctx.guest;
  return {
    counterpartId: null,
    snapshot: { kind: "privato", name: g?.fullName || "Cliente", tax_code: null, country: g?.country || "IT", sdi_code: "0000000", email: g?.email ?? null },
  };
}

export interface CreateOptions {
  docKind?: DocKind;
  counterpartId?: string;
  counterpart?: Record<string, unknown>;   // snapshot esplicito (es. da check-in / OTA)
  selectedRefs?: string[];                  // righe folio da fatturare (parziale)
  issueDate?: string;                       // ISO; se assente sarà assegnata all'emissione
  dueDate?: string;
  paymentTerms?: string;
  paymentMethod?: string;
  vatExigibility?: string;
  notes?: string;
  sendSdi?: boolean;
  rounding?: boolean;
}

export interface CreateResult { documentId: string; toPayCents: number; totalCents: number }

// b) Crea la BOZZA a partire da una prenotazione.
export async function createDocumentFromBooking(
  admin: SupabaseClient, tenantId: string, bookingId: string, options: CreateOptions = {},
): Promise<CreateResult> {
  const ctx = await loadBookingContext(admin, tenantId, bookingId);
  if (!ctx) throw new Error("booking_not_found");

  // Impostazioni tenant (regime, provider, arrotondamento di default…).
  const { data: settings } = await admin.from("tenant_invoice_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  const regime = (settings?.regime as Regime) ?? "imprenditoriale_ordinario";
  const provider = (settings?.default_provider as string) ?? "openapi";

  const { folio, advanceCents } = folioFromBooking(ctx);
  const draft = buildDocumentDraft({
    regime,
    docKind: options.docKind,
    folio,
    selectedRefs: options.selectedRefs,
    advanceCents,
    rounding: options.rounding ?? !!settings?.rounding,
    sendSdiDefault: options.sendSdi,
  });

  const cp = await resolveCounterpart(admin, tenantId, ctx, options);

  const { data: doc, error } = await admin.from("documents").insert({
    tenant_id: tenantId,
    structure_id: ctx.booking.structureId,
    booking_id: bookingId,
    booking_code: ctx.booking.code ?? null,
    doc_kind: draft.docKind,
    sdi_type: draft.docKind === "nota_di_credito" ? "TD04" : "TD01",
    regime,
    serie: ctx.booking.structureId,          // una struttura = un sezionale
    stato: "bozza",
    counterpart_id: cp.counterpartId,
    counterpart: cp.snapshot,
    issue_date: options.issueDate ?? null,   // assegnata all'emissione se nulla
    due_date: options.dueDate ?? null,
    payment_terms: options.paymentTerms ?? null,
    vat_exigibility: options.vatExigibility ?? "I",
    payment_method: options.paymentMethod ?? null,
    notes: options.notes ?? null,
    taxable_cents: draft.totals.taxableCents,
    vat_cents: draft.totals.vatCents,
    out_of_scope_cents: draft.totals.outOfScopeCents,
    bollo_cents: draft.totals.bolloCents,
    rounding_cents: draft.totals.roundingCents,
    total_cents: draft.totals.totalCents,
    advance_cents: draft.totals.advanceCents,
    send_sdi: draft.sendSdi,
    provider,
    currency: "EUR",
    snapshot: {
      regime_note: draft.regimeNote,
      booking: { code: ctx.booking.code, checkIn: ctx.booking.checkIn, checkOut: ctx.booking.checkOut, unitId: ctx.booking.unitId, adults: ctx.booking.adults, children: ctx.booking.children },
      structure: ctx.structure ? { name: ctx.structure.name, vat: ctx.structure.vat, taxCode: ctx.structure.taxCode } : null,
    },
  }).select("id").single();
  if (error || !doc) throw new Error(error?.message || "insert_failed");
  const documentId = doc.id as string;

  if (draft.lines.length) {
    const { error: lErr } = await admin.from("document_lines").insert(
      draft.lines.map((l) => ({
        document_id: documentId, tenant_id: tenantId, pos: l.pos,
        description: l.description, qty: l.qty, unit_price_cents: l.unitPriceCents,
        vat_rate: l.vatRate, vat_nature: l.vatNature, line_total_cents: l.lineTotalCents,
        source_kind: l.sourceKind, booking_id: bookingId, folio_ref: l.folioRef,
      })),
    );
    if (lErr) throw new Error(lErr.message);
  }

  // Acconto già incassato → incasso collegato (residuo = totale − incassi).
  if (advanceCents > 0) {
    await admin.from("document_payments").insert({ document_id: documentId, tenant_id: tenantId, amount_cents: advanceCents, method: "acconto", note: "Acconto già versato alla prenotazione" });
  }

  await admin.from("document_events").insert({
    tenant_id: tenantId, document_id: documentId, kind: "created",
    message: "Bozza creata dalla prenotazione" + (ctx.booking.code ? ` ${ctx.booking.code}` : ""),
  });

  return { documentId, toPayCents: draft.totals.toPayCents, totalCents: draft.totals.totalCents };
}

export interface IssueResult { number: number; numberLabel: string; serie: string; anno: number }

// c) Emette il documento: numerazione atomica + congelamento (funzione DB).
export async function issueDocument(admin: SupabaseClient, tenantId: string, documentId: string): Promise<IssueResult> {
  const { data: doc, error } = await admin.from("documents").select("id, stato, tenant_id").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error("document_not_found");
  if (doc.stato !== "bozza") throw new Error("already_issued");

  // Tutto atomico lato DB: numero progressivo, stato, evento, anti doppia-fatturazione.
  const { data, error: rpcErr } = await admin.rpc("fn_issue_document", { p_doc: documentId });
  if (rpcErr) throw new Error(rpcErr.message);
  const r = Array.isArray(data) ? data[0] : data;
  return { number: r.number, numberLabel: r.number_label, serie: r.serie, anno: r.anno };
}
