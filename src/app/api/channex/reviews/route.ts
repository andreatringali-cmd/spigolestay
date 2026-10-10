import { NextResponse } from "next/server";
import { authTenant, isResponse } from "@/lib/invoicing/api";
import { channexEnabled, listReviews, replyToReview, isReviewsNotInstalled, getPropertyScoresDetailed, type ChxReview } from "@/lib/channex";
import { normalizeReviewScores, parseDetailedScores, mergeSummaries, REVIEW_CHANNELS, type ReviewScore, type ReviewChannel, type ScoreSummary } from "@/lib/channex-review-scores";
import { channelFromOta } from "@/lib/channex-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recensioni REALI Booking.com/Airbnb/Expedia via Channex (Reviews Collection API), unificate
// nella stessa forma usata dalla pagina Recensioni per Google/Dirette/manuali. Richiede che
// l'app "Messages & Reviews" sia installata per property su Channex — la STESSA già richiesta
// dai Messaggi (vedi channex-inbound.ts / api/channex/messages): se non installata, segnaliamo
// "non installata" per quella property invece di un elenco vuoto o un errore grezzo.
//
// POST /api/channex/reviews (bearer) { action: "list" }
//   → { ok, byStructure: { [structureId]: { reviews: ReviewRow[]; scores?: StructureScores; notInstalled?: boolean; error?: string } } }
//   `scores` = punteggi UFFICIALI Channex (GET /scores/:property/detailed) per struttura e per canale;
//   assente se Channex non li fornisce (la pagina mostra «n/d», nessun valore inventato).
// POST /api/channex/reviews (bearer) { action: "reply", structureId, reviewId, text }
//   → { ok, error? }

export interface ReviewRow {
  id: string;       // chiave UI: "chx-<reviewId>"
  reviewId: string; // id Channex reale (serve per rispondere)
  guest: string;
  date: string;     // ISO YYYY-MM-DD
  rating: number;   // 0..10
  text: string;
  source: "booking" | "airbnb" | "expedia" | "other";
  bucket: "pos" | "neu" | "neg";
  isReplied: boolean;
  reply: string | null;
  scores: ReviewScore[]; // punteggi per categoria (Review.scores), [] se il canale non li manda
}
// Punteggi aggregati ufficiali Channex: media/categorie della struttura e di ciascun canale.
export interface StructureScores { property: ScoreSummary | null; byChannel: Partial<Record<ReviewChannel, ScoreSummary>> }

function bucketOf(r10: number): "pos" | "neu" | "neg" { return r10 >= 8 ? "pos" : r10 >= 6 ? "neu" : "neg"; }

function normalize(r: ChxReview): ReviewRow {
  const rating = Math.max(0, Math.min(10, Math.round(Number(r.overall_score) || 0)));
  const dateRaw = r.received_at || r.inserted_at || "";
  const date = /^\d{4}-\d{2}-\d{2}/.test(dateRaw) ? dateRaw.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const src = channelFromOta(r.ota);
  return {
    id: `chx-${r.id}`,
    reviewId: r.id,
    guest: (r.guest_name || "Ospite").trim(),
    date,
    rating,
    text: (r.content || "").trim(),
    source: src === "booking" || src === "airbnb" || src === "expedia" ? src : "other",
    bucket: bucketOf(rating),
    isReplied: !!r.is_replied,
    reply: r.reply || null,
    scores: normalizeReviewScores(r.scores),
  };
}

async function tenantPropertyRows(auth: { admin: import("@supabase/supabase-js").SupabaseClient; tenantId: string }) {
  const { data: personalRows } = await auth.admin.from("channex_map").select("structure_id, channex_property_id").eq("tenant_id", auth.tenantId).is("org_id", null);
  const { data: mships } = await auth.admin.from("memberships").select("org_id").eq("user_id", auth.tenantId);
  const orgIds = Array.from(new Set((mships ?? []).map((m) => m.org_id as string).filter(Boolean)));
  const orgRows: { structure_id: string; channex_property_id: string }[] = [];
  for (const oid of orgIds) {
    const { data } = await auth.admin.from("channex_map").select("structure_id, channex_property_id").eq("org_id", oid);
    orgRows.push(...(data ?? []));
  }
  return [...(personalRows ?? []), ...orgRows] as { structure_id: string; channex_property_id: string }[];
}

export async function POST(req: Request) {
  const auth = await authTenant(req);
  if (isResponse(auth)) return auth;
  if (!channexEnabled()) return NextResponse.json({ ok: false, error: "CHANNEX_API_KEY non configurata" }, { status: 200 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action === "reply" ? "reply" : "list";
  const rows = await tenantPropertyRows(auth);

  if (action === "reply") {
    const reviewId = typeof body.reviewId === "string" ? body.reviewId.trim() : "";
    const structureId = typeof body.structureId === "string" ? body.structureId.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!reviewId || !text) return NextResponse.json({ ok: false, error: "reviewId o testo mancante" }, { status: 400 });
    // La struttura deve appartenere a questo tenant (o alla sua org condivisa): il reviewId
    // arriva dal client e Channex non espone un endpoint economico per verificarne il proprietario,
    // quindi ci affidiamo alla mappatura channex_map già verificata altrove in questo stesso file.
    if (!rows.some((r) => r.structure_id === structureId)) return NextResponse.json({ ok: false, error: "Struttura non trovata per questo account" }, { status: 404 });
    // Anche la recensione deve appartenere a una property di quella struttura: il reviewId arriva dal client e
    // l'account Channex è condiviso. Stessa lista che mostra la pagina (le recensioni rispondibili sono quelle elencate).
    let reviewMine = false;
    for (const r of rows.filter((x) => x.structure_id === structureId && x.channex_property_id)) {
      const lst = await listReviews(r.channex_property_id);
      if (lst.ok && lst.reviews.some((v) => v.id === reviewId)) { reviewMine = true; break; }
    }
    if (!reviewMine) return NextResponse.json({ ok: false, error: "Recensione non trovata per questa struttura" }, { status: 404 });
    const res = await replyToReview(reviewId, text);
    if (!res.ok) {
      if (isReviewsNotInstalled(res.status, res.error)) {
        return NextResponse.json({ ok: false, error: 'L\'app "Messages & Reviews" non è ancora installata su Channex per questa struttura: installala dalla dashboard Channex (Applications) per poter rispondere da qui.' });
      }
      // Channex risponde 'validation_error ... content: empty_review' quando la recensione dell'ospite non ha testo (solo punteggio): il portale non permette di rispondere.
      if (/empty_review/i.test(res.error || "")) {
        return NextResponse.json({ ok: false, error: "Questa recensione non ha testo (solo punteggio): il portale non permette di rispondere." });
      }
      return NextResponse.json({ ok: false, error: res.error || "Invio risposta non riuscito" });
    }
    return NextResponse.json({ ok: true });
  }

  // action "list": una property per volta, raggruppate per struttura. Un errore "app non
  // installata" su una property non blocca le altre strutture del tenant.
  const byStructure: Record<string, { reviews: ReviewRow[]; scores?: StructureScores; notInstalled?: boolean; error?: string }> = {};
  const scoreParts: Record<string, ReturnType<typeof parseDetailedScores>[]> = {};
  for (const r of rows) {
    const sid = r.structure_id; const pid = r.channex_property_id;
    if (!sid || !pid) continue;
    const cur = byStructure[sid] ?? { reviews: [] };
    const res = await listReviews(pid);
    if (!res.ok) {
      const notInstalled = isReviewsNotInstalled(res.status, res.error);
      byStructure[sid] = { ...cur, notInstalled: cur.notInstalled || notInstalled, error: notInstalled ? undefined : (cur.error || res.error) };
      continue;
    }
    byStructure[sid] = { ...cur, reviews: cur.reviews.concat(res.reviews.map(normalize)) };
    // Punteggi ufficiali aggregati: best-effort, un errore qui non toglie le recensioni.
    const sc = await getPropertyScoresDetailed(pid);
    if (sc.ok) (scoreParts[sid] ??= []).push(parseDetailedScores(sc.data));
  }
  // Più property per la stessa struttura → medie pesate sul numero di recensioni.
  for (const [sid, parts] of Object.entries(scoreParts)) {
    const property = mergeSummaries(parts.map((p) => p.property));
    const byChannel: StructureScores["byChannel"] = {};
    for (const ch of REVIEW_CHANNELS) {
      const m = mergeSummaries(parts.map((p) => p.byChannel[ch]));
      if (m) byChannel[ch] = m;
    }
    if (property || Object.keys(byChannel).length) byStructure[sid].scores = { property, byChannel };
  }

  return NextResponse.json({ ok: true, byStructure });
}
