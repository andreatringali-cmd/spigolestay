import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { rateLimited } from "@/lib/server-auth";
import { allowedChannexProperties } from "@/lib/channex-guard";
import { channexEnabled, getBookingRevision } from "@/lib/channex";
import { channexBookingIdFromExtId } from "@/lib/channex-booking-actions";
import { findBookingStoreForTenant } from "@/lib/manage-booking";
import { normalizeRevision, stripRaw, type RevisionView } from "@/lib/booking-revisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Scheda «Revisioni» della prenotazione (SOLA LETTURA, nessun ack): elenca le revisioni Channex importate per
// quella prenotazione (id presi da channex_bookings) e ne legge il contenuto completo con GET /booking_revisions/:id.
// Body: { bookingId?: id prenotazione Xenora, channexBookingId?: "channex:<id>" o "<id>", more?: true, rawFor?: id revisione }.
// Sicurezza: la chiave Channex è unica per tutti i clienti (limite 20 richieste/min condiviso) → si legge SOLO una revisione
// la cui property è collegata a questo utente (allowedChannexProperties), altrimenti 403.
// Costo: alla prima apertura si leggono le 5 revisioni più recenti (5 chiamate al massimo); le altre (fino a 10) solo con `more: true`.
// Il JSON originale («Dati originali») non è nell'elenco: si chiede per una revisione con `rawFor`.

const INITIAL_REVISIONS = 5;
const MAX_REVISIONS = 10;
const CACHE_MS = 10 * 60_000; // le revisioni di Channex sono immutabili: si rileggono di rado
const ERR_CACHE_MS = 30_000;
const PER_MIN = 12; // per utente, solo quando servono chiamate a Channex (le letture dalla cache non contano)

// Cache in memoria per revision_id (le revisioni di Channex non cambiano una volta create): evita di rileggere
// a ogni apertura della scheda e di consumare il limite di 20 richieste/min. Vale per l'istanza serverless calda.
const cache = new Map<string, { at: number; view: RevisionView }>();
function cacheGet(id: string): RevisionView | null {
  const c = cache.get(id);
  if (!c) return null;
  if (Date.now() - c.at > CACHE_MS) { cache.delete(id); return null; }
  return c.view;
}
function cacheSet(id: string, view: RevisionView) {
  if (cache.size > 300) { const now = Date.now(); for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k); if (cache.size > 300) cache.clear(); }
  cache.set(id, { at: Date.now(), view });
}

/** Errore Channex → frase italiana (mai il testo grezzo, che può contenere dettagli tecnici). */
function channexErrorIt(status: number): string {
  if (status === 401 || status === 403) return "Channex non ha autorizzato la lettura delle revisioni: l'app non risulta attiva per questa struttura.";
  if (status === 404) return "Revisione non più disponibile su Channex.";
  if (status === 429) return "Troppe richieste a Channex in questo momento. Riprova tra un minuto.";
  if (status === 0) return "Non riesco a collegarmi a Channex. Riprova tra poco.";
  if (status >= 500) return "Channex ha un problema temporaneo. Riprova tra poco.";
  return "Channex non ha restituito la revisione. Riprova tra poco.";
}

// Errori recenti per revision_id (30 s): una revisione che Channex non restituisce non va richiesta a ogni apertura/riprova.
const errCache = new Map<string, { at: number; message: string }>();
function errGet(id: string): string | null {
  const c = errCache.get(id);
  if (!c) return null;
  if (Date.now() - c.at > ERR_CACHE_MS) { errCache.delete(id); return null; }
  return c.message;
}
function errSet(id: string, message: string) {
  if (errCache.size > 300) { const now = Date.now(); for (const [k, v] of errCache) if (now - v.at > ERR_CACHE_MS) errCache.delete(k); if (errCache.size > 300) errCache.clear(); }
  errCache.set(id, { at: Date.now(), message });
}

type Row = { revision_id: string; booking_id: string | null; tenant_id: string | null; channex_property_id: string | null; status: string | null; imported_at: string | null };

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  const body = await req.json().catch(() => ({})) as { bookingId?: unknown; channexBookingId?: unknown; more?: unknown; rawFor?: unknown };
  const xenoraId = typeof body.bookingId === "string" ? body.bookingId.trim().slice(0, 120) : "";
  const given = typeof body.channexBookingId === "string" ? body.channexBookingId.trim().slice(0, 200) : "";
  const more = body.more === true;
  const rawFor = typeof body.rawFor === "string" ? body.rawFor.trim().slice(0, 200) : "";

  // 1) id Channex della prenotazione: dal body (il client lo passa sempre) o, in mancanza, da booking.extId nello store a cui l'utente ha accesso.
  let extId: string | null | undefined = given ? (given.startsWith("channex:") ? given : `channex:${given}`) : undefined;
  if (extId === undefined) {
    if (!xenoraId) return NextResponse.json({ error: "missing_params" }, { status: 400 });
    let store = await findBookingStoreForTenant(auth.admin, auth.tenantId, xenoraId).catch(() => null);
    if (!store && auth.userId !== auth.tenantId) store = await findBookingStoreForTenant(auth.admin, auth.userId, xenoraId).catch(() => null);
    if (!store) return NextResponse.json({ error: "booking_not_found" }, { status: 404 });
    const e = (store.booking as { extId?: unknown }).extId;
    extId = typeof e === "string" && e ? e : null;
  }
  const chxId = channexBookingIdFromExtId(extId);
  if (!chxId || !/^[A-Za-z0-9_-]{1,100}$/.test(chxId)) return NextResponse.json({ ok: true, revisions: [], notLinked: true }); // non è una prenotazione Channex (o id non valido: finirebbe in un filtro)

  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "Channex non è configurato su questo server.", revisions: [] });

  // 2) righe di channex_bookings. extId può essere sia booking_id sia (raramente) revision_id: se è una revisione si risale al suo booking_id.
  const cols = "revision_id, booking_id, tenant_id, channex_property_id, status, imported_at";
  let bookingKey = chxId;
  const { data: probe, error: probeErr } = await auth.admin.from("channex_bookings").select(cols).or(`booking_id.eq.${chxId},revision_id.eq.${chxId}`).limit(50);
  if (probeErr) return NextResponse.json({ ok: false, error: "Non riesco a leggere l'elenco delle revisioni. Riprova tra poco.", revisions: [] });
  const viaRevision = ((probe ?? []) as Row[]).find((r) => r.revision_id === chxId && r.booking_id);
  if (viaRevision?.booking_id) bookingKey = viaRevision.booking_id;
  const { data: found, error: rowsErr } = await auth.admin.from("channex_bookings").select(cols).eq("booking_id", bookingKey).order("imported_at", { ascending: false }).limit(MAX_REVISIONS + 1);
  if (rowsErr) return NextResponse.json({ ok: false, error: "Non riesco a leggere l'elenco delle revisioni. Riprova tra poco.", revisions: [] });
  let rows = (found ?? []) as Row[];
  if (!rows.length) rows = ((probe ?? []) as Row[]).filter((r) => r.revision_id === chxId); // revisione senza booking_id
  if (!rows.length) return NextResponse.json({ ok: true, revisions: [], noRecords: true });

  // 3) proprietà: ogni riga deve appartenere a una property collegata a questo utente (o, senza property, importata per il suo tenant).
  const allowed = await allowedChannexProperties(auth.admin, auth.userId);
  if (auth.tenantId !== auth.userId) for (const p of await allowedChannexProperties(auth.admin, auth.tenantId)) allowed.add(p);
  const okRow = (r: Row) => (r.channex_property_id ? allowed.has(r.channex_property_id) : r.tenant_id === auth.tenantId);
  if (!rows.every(okRow)) return NextResponse.json({ error: "non_autorizzato" }, { status: 403 });

  // Il JSON originale di UNA revisione (scheda «Dati originali»): stesso controllo di proprietà, nessun elenco.
  if (rawFor) {
    const row = rows.find((r) => r.revision_id === rawFor);
    if (!row) return NextResponse.json({ ok: false, error: "Revisione non trovata per questa prenotazione." }, { status: 404 });
    let limited = false;
    const out = await readRevision(row, allowed, () => { if (rateLimited(`chx-rev:${auth.userId}`, PER_MIN, 60_000)) { limited = true; return false; } return true; });
    if (out.forbidden) return NextResponse.json({ error: "non_autorizzato" }, { status: 403 });
    if (!out.view) return NextResponse.json({ ok: false, error: limited ? "Troppe richieste in poco tempo. Riprova tra un minuto." : out.error || "Non riesco a leggere la revisione da Channex." });
    return NextResponse.json({ ok: true, revisionId: row.revision_id, raw: out.view.raw ?? {} });
  }

  // `truncated`: ci sono più di MAX_REVISIONS revisioni; `hasMore`: ce ne sono altre oltre alle prime INITIAL_REVISIONS e non sono state richieste.
  const truncated = rows.length > MAX_REVISIONS;
  const limit = more ? MAX_REVISIONS : INITIAL_REVISIONS;
  const hasMore = !more && rows.length > INITIAL_REVISIONS;
  rows = rows.slice(0, limit);

  // 4) lettura in sequenza (la coda interna limita a 20 richieste/min): prima la cache (revisioni 10 minuti, errori 30 s),
  // poi Channex solo per ciò che manca, entro il limite per utente.
  const revisions: RevisionView[] = [];
  let unreadable = 0;
  let firstError = "";
  let general = false; // errore generale (rete/autorizzazione/limite): inutile insistere sulle altre
  for (const row of rows) {
    if (general) { unreadable++; continue; }
    const out = await readRevision(row, allowed, () => !rateLimited(`chx-rev:${auth.userId}`, PER_MIN, 60_000));
    if (out.forbidden) return NextResponse.json({ error: "non_autorizzato" }, { status: 403 });
    if (out.view) { revisions.push(stripRaw(out.view)); continue; }
    unreadable++;
    if (!firstError) firstError = out.error || "Una revisione non è stata letta.";
    if (out.general) general = true;
  }

  if (!revisions.length) return NextResponse.json({ ok: false, error: firstError || "Non riesco a leggere le revisioni da Channex.", revisions: [] });
  revisions.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return NextResponse.json({
    ok: true, revisions,
    ...(unreadable ? { unreadable, warning: firstError || "Alcune revisioni non sono state lette." } : {}),
    ...(truncated ? { truncated: true } : {}),
    ...(hasMore ? { hasMore: true } : {}),
  });
}

type ReadOut = { view?: RevisionView; error?: string; general?: boolean; forbidden?: boolean };

/**
 * Una revisione: cache → (se serve) Channex. `mayCall` decide se si può fare la chiamata (limite per utente).
 * Controllo di proprietà sulla property della revisione PRIMA di costruire la vista; forma inattesa = revisione illeggibile, mai 500.
 */
async function readRevision(row: Row, allowed: Set<string>, mayCall: () => boolean): Promise<ReadOut> {
  const hit = cacheGet(row.revision_id);
  if (hit) return { view: hit };
  const cachedErr = errGet(row.revision_id);
  if (cachedErr) return { error: cachedErr };
  if (!mayCall()) return { error: "Troppe richieste in poco tempo. Riprova tra un minuto.", general: true };
  let res: Awaited<ReturnType<typeof getBookingRevision>>;
  try { res = await getBookingRevision(row.revision_id); }
  catch { res = { ok: false, status: 0 }; }
  if (!res.ok || !res.revision) {
    const message = channexErrorIt(res.status);
    const general = res.status === 0 || res.status === 401 || res.status === 403 || res.status === 429;
    errSet(row.revision_id, message);
    return { error: message, general };
  }
  // Difesa in profondità: la revisione letta deve essere della stessa property registrata.
  const pid = (res.revision as { property_id?: string }).property_id;
  if (pid && !allowed.has(pid)) return { forbidden: true };
  try {
    const view = normalizeRevision(res.revision, { importedAt: row.imported_at });
    cacheSet(row.revision_id, view);
    return { view };
  } catch {
    const message = "Una revisione ha un formato inatteso e non si può mostrare.";
    errSet(row.revision_id, message);
    return { error: message };
  }
}
