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
import { getProvider, type EInvoicePayload } from "./provider";
import { logBookingEvent } from "@/lib/booking-events";
import { decryptCred, encryptCred } from "@/lib/crypto-creds";

// Decifra i campi segreti della config provider (salvati come <campo>_enc) e li
// espone col nome atteso dal provider (token, accessToken, clientSecret…).
function decryptProviderCfg(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  for (const [k, v] of Object.entries(cfg)) {
    if (k.endsWith("_enc") && typeof v === "string") out[k.slice(0, -4)] = decryptCred(v);
  }
  return out;
}

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
  // Dati fattura raccolti al check-in online ("richiedo fattura").
  const ir = ctx.booking.invoiceRequest;
  if (ir?.wants) {
    return {
      counterpartId: null,
      snapshot: {
        kind: ir.kind ?? "privato", name: ir.name || ctx.guest?.fullName || "Cliente",
        vat: ir.vat ?? null, tax_code: ir.taxCode ?? null, address: ir.address ?? null,
        city: ir.city ?? null, cap: ir.cap ?? null, province: ir.province ?? null,
        country: ir.country || "IT",
        sdi_code: ir.sdiCode || (ir.kind === "estero" ? "XXXXXXX" : "0000000"),
        pec: ir.pec ?? null, email: ctx.guest?.email ?? null,
      },
    };
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

// Crea una BOZZA vuota (senza prenotazione): la prenotazione si collega dopo dalla scheda.
export async function createBlankDocument(admin: SupabaseClient, tenantId: string, opts: { structureId?: string } = {}): Promise<CreateResult> {
  const { data: settings } = await admin.from("tenant_invoice_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  const regime = (settings?.regime as Regime) ?? "imprenditoriale_ordinario";
  const provider = (settings?.default_provider as string) ?? "mock";
  const { data: doc, error } = await admin.from("documents").insert({
    tenant_id: tenantId, structure_id: opts.structureId ?? null, doc_kind: "fattura", sdi_type: "TD01",
    regime, serie: opts.structureId ?? null, stato: "bozza",
    counterpart: { kind: "privato", name: "", country: "IT", sdi_code: "0000000" },
    send_sdi: regime !== "non_imprenditoriale", provider, currency: "EUR",
    taxable_cents: 0, vat_cents: 0, out_of_scope_cents: 0, bollo_cents: 0, total_cents: 0, advance_cents: 0,
  }).select("id").single();
  if (error || !doc) throw new Error(error?.message || "insert_failed");
  await admin.from("document_events").insert({ tenant_id: tenantId, document_id: doc.id, kind: "created", message: "Bozza creata" });
  return { documentId: doc.id as string, toPayCents: 0, totalCents: 0 };
}

// Crea una NOTA DI CREDITO in bozza che storna un documento emesso (copia righe/intestatario).
export async function createCreditNote(admin: SupabaseClient, tenantId: string, sourceId: string): Promise<CreateResult> {
  const { data: src } = await admin.from("documents").select("*").eq("id", sourceId).eq("tenant_id", tenantId).maybeSingle();
  if (!src) throw new Error("document_not_found");
  if (src.stato === "bozza") throw new Error("source_not_issued");
  if (src.doc_kind === "nota_di_credito") throw new Error("already_credit_note");
  const { data: srcLines } = await admin.from("document_lines").select("*").eq("document_id", sourceId).order("pos");
  const { data: doc, error } = await admin.from("documents").insert({
    tenant_id: tenantId, structure_id: src.structure_id, booking_id: src.booking_id, booking_code: src.booking_code,
    doc_kind: "nota_di_credito", sdi_type: "TD04", regime: src.regime, serie: src.structure_id, stato: "bozza",
    counterpart: src.counterpart, counterpart_id: src.counterpart_id, related_document_id: src.id,
    payment_method: src.payment_method, vat_exigibility: src.vat_exigibility, send_sdi: src.send_sdi, provider: src.provider, currency: src.currency,
    taxable_cents: src.taxable_cents, vat_cents: src.vat_cents, out_of_scope_cents: src.out_of_scope_cents, bollo_cents: 0, rounding_cents: 0, total_cents: src.total_cents, advance_cents: 0,
    notes: `Storno documento ${src.number_label ?? ""}`,
  }).select("id").single();
  if (error || !doc) throw new Error(error?.message || "insert_failed");
  const nid = doc.id as string;
  if (srcLines?.length) {
    await admin.from("document_lines").insert(srcLines.map((l, i) => ({
      document_id: nid, tenant_id: tenantId, pos: i + 1, description: l.description, qty: l.qty, unit_price_cents: l.unit_price_cents,
      vat_rate: l.vat_rate, vat_nature: l.vat_nature, line_total_cents: l.line_total_cents, source_kind: l.source_kind, booking_id: l.booking_id, folio_ref: l.folio_ref,
    })));
  }
  await admin.from("document_events").insert({ tenant_id: tenantId, document_id: nid, kind: "created", message: `Nota di credito da ${src.number_label ?? "documento"}` });
  return { documentId: nid, toPayCents: src.total_cents, totalCents: src.total_cents };
}

export interface IssueResult { number: number; numberLabel: string; serie: string; anno: number }

// c) Emette il documento: numerazione atomica + congelamento (funzione DB).
export async function issueDocument(admin: SupabaseClient, tenantId: string, documentId: string): Promise<IssueResult> {
  const { data: doc, error } = await admin.from("documents").select("id, stato, tenant_id, booking_id, doc_kind").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error("document_not_found");
  if (doc.stato !== "bozza") throw new Error("already_issued");

  // Tutto atomico lato DB: numero progressivo, stato, evento, anti doppia-fatturazione.
  const { data, error: rpcErr } = await admin.rpc("fn_issue_document", { p_doc: documentId });
  if (rpcErr) throw new Error(rpcErr.message);
  const r = Array.isArray(data) ? data[0] : data;
  await logBookingEvent(admin, tenantId, doc.booking_id, "documento", `${doc.doc_kind === "nota_di_credito" ? "Nota di credito" : "Documento"} emesso n. ${r.number_label}`);
  return { number: r.number, numberLabel: r.number_label, serie: r.serie, anno: r.anno };
}

const regimeFiscale = (regime?: string) => regime === "forfettario" ? "RF19" : "RF01";

// Costruisce il payload normalizzato per l'intermediario da documento + righe.
async function buildPayload(admin: SupabaseClient, tenantId: string, documentId: string): Promise<{ payload: EInvoicePayload; docKind: string; providerName: string; providerCfg: Record<string, unknown> }> {
  const { data: doc } = await admin.from("documents").select("*").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (!doc) throw new Error("document_not_found");
  const { data: lines } = await admin.from("document_lines").select("*").eq("document_id", documentId).order("pos");
  const { data: settings } = await admin.from("tenant_invoice_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  const cp = (doc.counterpart ?? {}) as Record<string, string>;
  const { data: cred } = await admin.from("provider_credentials").select("*").eq("tenant_id", tenantId).eq("provider", doc.provider ?? "mock").maybeSingle();

  const payload: EInvoicePayload = {
    docId: doc.id, docKind: doc.doc_kind, sdiType: doc.sdi_type, numberLabel: doc.number_label ?? "",
    issueDate: doc.issue_date, regime: doc.regime, currency: doc.currency ?? "EUR",
    emittente: {
      denominazione: settings?.denominazione, vat: settings?.vat, taxCode: settings?.tax_code,
      address: settings?.address, city: settings?.city, cap: settings?.cap, province: settings?.province,
      country: settings?.country ?? "IT", regimeFiscale: regimeFiscale(doc.regime), pec: settings?.pec,
    },
    cliente: {
      kind: cp.kind ?? "privato", name: cp.name ?? "Cliente", vat: cp.vat ?? null, taxCode: cp.tax_code ?? null,
      address: cp.address ?? null, city: cp.city ?? null, cap: cp.cap ?? null, province: cp.province ?? null,
      country: cp.country ?? "IT", sdiCode: cp.sdi_code ?? "0000000", pec: cp.pec ?? null,
    },
    lines: (lines ?? []).map((l) => ({ description: l.description, qty: Number(l.qty), unitPriceCents: l.unit_price_cents, vatRate: Number(l.vat_rate), vatNature: l.vat_nature, lineTotalCents: l.line_total_cents })),
    totals: { taxableCents: doc.taxable_cents, vatCents: doc.vat_cents, outOfScopeCents: doc.out_of_scope_cents, bolloCents: doc.bollo_cents, totalCents: doc.total_cents },
    payment: { method: doc.payment_method, dueDate: doc.due_date, terms: doc.payment_terms },
    notes: doc.notes,
  };
  return { payload, docKind: doc.doc_kind, providerName: (doc.provider as string) || (settings?.default_provider as string) || "mock", providerCfg: decryptProviderCfg((cred?.config as Record<string, unknown>) ?? {}) };
}

export interface SendOutcome { providerRef: string; stato: string; message?: string; skipped?: boolean }

// Invia il documento emesso all'intermediario (SDI). Ricevuta non fiscale: nessun invio.
export async function sendDocument(admin: SupabaseClient, tenantId: string, documentId: string): Promise<SendOutcome> {
  const { data: doc } = await admin.from("documents").select("id, stato, doc_kind, send_sdi, booking_id").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (!doc) throw new Error("document_not_found");
  if (doc.stato === "bozza") throw new Error("not_issued");
  if (!doc.send_sdi) return { providerRef: "", stato: doc.stato, skipped: true, message: "Documento non trasmesso allo SdI (ricevuta/impostazione)." };
  if (doc.stato !== "emessa") return { providerRef: "", stato: doc.stato, skipped: true, message: "Documento già trasmesso." };

  const { payload, docKind, providerName, providerCfg } = await buildPayload(admin, tenantId, documentId);
  const provider = getProvider(providerName, providerCfg);
  const res = docKind === "nota_di_credito" ? await provider.sendCreditNote(payload) : await provider.send(payload);

  await admin.from("documents").update({ stato: "inviata_intermediario", provider: providerName, provider_ref: res.providerRef, sent_at: new Date().toISOString() }).eq("id", documentId);
  await admin.from("document_events").insert({ tenant_id: tenantId, document_id: documentId, kind: "sent", message: res.message || "Documento inviato all'intermediario", meta: { provider: providerName, ref: res.providerRef } });
  await logBookingEvent(admin, tenantId, doc.booking_id, "documento", "Documento inviato allo SdI");
  return { providerRef: res.providerRef, stato: "inviata_intermediario", message: res.message };
}

export interface StatusOutcome { stato: string; message: string; changed: boolean }

// e) Core del job di polling: legge l'esito dall'intermediario e aggiorna stato+timeline.
export async function refreshDocumentStatus(admin: SupabaseClient, tenantId: string, documentId: string): Promise<StatusOutcome> {
  const { data: doc } = await admin.from("documents").select("id, stato, provider, provider_ref, booking_id").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (!doc) throw new Error("document_not_found");
  if (!doc.provider_ref || doc.stato !== "inviata_intermediario") return { stato: doc?.stato, message: "Nessun aggiornamento", changed: false };

  const { providerCfg } = await buildPayload(admin, tenantId, documentId);
  const provider = getProvider((doc.provider as string) || "mock", providerCfg);
  const st = await provider.getStatus(doc.provider_ref as string);

  const patch: Record<string, unknown> = { stato: st.status };
  if (st.status === "consegnata") patch.delivered_at = new Date().toISOString();
  await admin.from("documents").update(patch).eq("id", documentId);
  await admin.from("document_events").insert({
    tenant_id: tenantId, document_id: documentId,
    kind: st.status === "scartata" ? "rejected" : "delivered",
    message: st.message, meta: { status: st.status },
  });
  await logBookingEvent(admin, tenantId, doc.booking_id, "documento", st.status === "scartata" ? "Documento SCARTATO dallo SdI" : "Documento consegnato (SdI)");
  return { stato: st.status, message: st.message, changed: true };
}

// Recupera l'XML del documento dall'intermediario (per download).
export async function getDocumentXml(admin: SupabaseClient, tenantId: string, documentId: string): Promise<string | null> {
  const { data: doc } = await admin.from("documents").select("provider, provider_ref").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
  if (!doc?.provider_ref) return null;
  const { providerCfg } = await buildPayload(admin, tenantId, documentId);
  const provider = getProvider((doc.provider as string) || "mock", providerCfg);
  return provider.getXml(doc.provider_ref as string);
}

// --- Credenziali intermediario (token cifrato) ---

export interface ProviderCfgInput { token?: string; sandbox?: boolean; signature?: boolean; legalStorage?: boolean }

// Salva la config del provider: i segreti (token) sono cifrati come token_enc.
// Token vuoto = mantieni quello già salvato.
export async function saveProviderCredentials(admin: SupabaseClient, tenantId: string, provider: string, cfg: ProviderCfgInput): Promise<{ ok: boolean; message: string }> {
  const { data: existing } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", provider).maybeSingle();
  const prev = (existing?.config as Record<string, unknown>) ?? {};
  const config: Record<string, unknown> = { ...prev, sandbox: !!cfg.sandbox, signature: !!cfg.signature, legalStorage: !!cfg.legalStorage };
  if (cfg.token) config.token_enc = encryptCred(cfg.token);
  const { error } = await admin.from("provider_credentials").upsert({ tenant_id: tenantId, provider, config, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,provider" });
  return { ok: !error, message: error ? error.message : "Credenziali salvate ✓" };
}

// Stato (senza esporre il token): se è presente e le opzioni.
export async function providerCredStatus(admin: SupabaseClient, tenantId: string, provider: string): Promise<{ hasToken: boolean; sandbox: boolean; signature: boolean; legalStorage: boolean }> {
  const { data } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", provider).maybeSingle();
  const c = (data?.config as Record<string, unknown>) ?? {};
  return { hasToken: !!c.token_enc, sandbox: !!c.sandbox, signature: !!c.signature, legalStorage: !!c.legalStorage };
}

// Verifica le credenziali con una chiamata leggera all'intermediario.
export async function testProvider(admin: SupabaseClient, tenantId: string, provider: string): Promise<{ ok: boolean; message: string }> {
  const { data } = await admin.from("provider_credentials").select("config").eq("tenant_id", tenantId).eq("provider", provider).maybeSingle();
  const cfg = decryptProviderCfg((data?.config as Record<string, unknown>) ?? {});
  try {
    await getProvider(provider, cfg).listNotifications();
    return { ok: true, message: "Connessione all'intermediario riuscita." };
  } catch (e) { return { ok: false, message: (e as Error)?.message ?? "Errore di connessione." }; }
}
